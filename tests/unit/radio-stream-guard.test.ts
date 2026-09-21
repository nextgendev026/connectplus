import { describe, expect, it, vi } from "vitest";

/**
 * The radio stream guard.
 *
 * `redirect: "follow"` was the defect: the platform fetched from inside its own
 * network, so a redirect was a destination chosen by the third party rather than
 * by us. These tests pin the property that replaced it — every hop is inspected,
 * and a hop into private address space stops the request instead of following it.
 *
 * They also pin the thing that makes this module exist at all rather than
 * `safeFetch`: the body is returned as a stream, never read into memory. A test
 * asserting `body` is a `ReadableStream` is the difference between a proxy and a
 * 512 KB truncation of a live radio station.
 */

const { guardStreamUrl, openValidatedStream } = await import("@/lib/radio-stream-guard");

/** A response whose body is a stream, as a real upstream gives us. */
function streamResponse(status = 200, headers: Record<string, string> = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([0xff, 0xfb, 0x90, 0x00]));
      controller.close();
    },
  });
  return new Response(body, { status, headers });
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

describe("guardStreamUrl", () => {
  it("accepts an ordinary public https stream", () => {
    const result = guardStreamUrl("https://atunwadigital.streamguys1.com/capitalfm");
    expect(result.ok).toBe(true);
  });

  it.each([
    ["http://localhost:8000/stream", "localhost"],
    ["http://127.0.0.1/stream", "loopback"],
    ["http://10.0.0.5:8000/live", "private class A"],
    ["http://172.16.4.4/live", "private class B"],
    ["http://192.168.1.10/live", "private class C"],
    ["http://169.254.169.254/latest/meta-data/", "cloud metadata"],
    ["http://0.0.0.0/stream", "unspecified"],
    ["http://[::1]/stream", "IPv6 loopback"],
    ["http://metadata.google.internal/computeMetadata/v1/", "metadata hostname"],
    ["http://kubernetes.default.svc/live", "cluster DNS"],
  ])("refuses %s (%s)", (url) => {
    expect(guardStreamUrl(url).ok).toBe(false);
  });

  it.each(["ftp://host/stream", "file:///etc/passwd", "gopher://host/1"])(
    "refuses the unsupported scheme %s",
    (url) => {
      expect(guardStreamUrl(url).ok).toBe(false);
    }
  );

  it("reports a reason rather than a bare false", () => {
    const result = guardStreamUrl("http://127.0.0.1/live");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeTruthy();
  });
});

describe("openValidatedStream", () => {
  it("returns the upstream body as a stream, unread", async () => {
    const fetchImpl = vi.fn(async () => streamResponse());
    const opened = await openValidatedStream("https://stream.example/live", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // The whole reason this module exists: a buffering fetch would have consumed
    // the body, and a radio station cannot be buffered.
    expect(opened.response.body).toBeInstanceOf(ReadableStream);
    expect(opened.response.bodyUsed).toBe(false);
  });

  it("never issues a request for a blocked URL", async () => {
    const fetchImpl = vi.fn(async () => streamResponse());
    const opened = await openValidatedStream("http://169.254.169.254/latest/meta-data/", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(opened.ok).toBe(false);
    // Nothing left the process — the refusal happens before the connection.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("follows an ordinary redirect and reports the hop count", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("https://cdn.example/live"))
      .mockResolvedValueOnce(streamResponse());
    const opened = await openValidatedStream("https://stream.example/live", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.redirects).toBe(1);
    expect(opened.url).toBe("https://cdn.example/live");
  });

  it("refuses a redirect into private address space", async () => {
    // The attack this exists for: a normal-looking host answers with a redirect
    // to the cloud metadata service, and `redirect: "follow"` would have fetched
    // it and streamed the response back to the caller.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("http://169.254.169.254/latest/meta-data/"));
    const opened = await openValidatedStream("https://stream.example/live", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.reason).toBe("redirect_blocked");
    // Only the first, legitimate hop was attempted — the blocked destination was
    // never requested.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect to localhost", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(redirectResponse("http://localhost:8080/admin"));
    const opened = await openValidatedStream("https://stream.example/live", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.reason).toBe("redirect_blocked");
  });

  it("resolves a relative Location before assessing it", async () => {
    // A relative Location is legal, and it is also the shape that would slip past
    // a naive string check — so it must be resolved against the hop first.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("/live-320"))
      .mockResolvedValueOnce(streamResponse());
    const opened = await openValidatedStream("https://stream.example/radio/", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.url).toBe("https://stream.example/live-320");
  });

  it("stops after the redirect ceiling instead of chasing forever", async () => {
    const fetchImpl = vi.fn(async () => redirectResponse("https://stream.example/next"));
    const opened = await openValidatedStream("https://stream.example/live", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRedirects: 3,
    });

    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.reason).toBe("too_many_redirects");
  });

  it("refuses a redirect that carries no Location", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302 }));
    const opened = await openValidatedStream("https://stream.example/live", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.reason).toBe("redirect_without_location");
  });

  it("surfaces a transport failure as unreachable rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const opened = await openValidatedStream("https://stream.example/live", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.reason).toBe("unreachable");
  });

  it("does not treat a non-redirect error status as a redirect", async () => {
    // A 401 (the Zeno case this proxy exists for) must reach the caller as a
    // response so the player can tune the next channel, not be mistaken for a
    // redirect and retried internally.
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    const opened = await openValidatedStream("https://stream.example/live", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.response.status).toBe(401);
  });
});
