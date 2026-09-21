import { describe, expect, it, vi } from "vitest";

import {
  assessUrl,
  isBlockedAddress,
  isBlockedHostname,
  isBlockedV4,
  isBlockedV6,
  safeFetch,
  safeFetchText,
} from "@/lib/safe-fetch";

/**
 * SSRF refusals, walked one address at a time.
 *
 * These tests are the specification of what this server will not fetch. Two of
 * them are the reason the module exists rather than a `URL` allowlist:
 *
 *  • `169.254.169.254` — the cloud metadata service. On a Vercel or EC2 host the
 *    application can reach it and an attacker cannot, which is exactly what makes
 *    it worth forwarding. An RSS item with that URL turns the importer into a
 *    credential-disclosure tool.
 *  • **a redirect into a private range.** The URL we validated is not the URL the
 *    runtime fetches: a public host answering `302 → http://10.0.0.5/` defeats
 *    every check made before the request. The tests below therefore exercise the
 *    redirect path with a stubbed transport, not just `assessUrl`.
 *
 * The boundary cases matter as much as the obvious ones — `126.255.255.255` is
 * public and `172.32.0.0` is public, and a check that refuses them is a check that
 * breaks legitimate feeds.
 */

const PUBLIC = "93.184.216.34";

function textResponse(body: string, init: { status?: number; contentType?: string; contentLength?: number } = {}) {
  const headers = new Headers();
  headers.set("content-type", init.contentType ?? "text/html");
  if (init.contentLength !== undefined) headers.set("content-length", String(init.contentLength));
  return new Response(body, { status: init.status ?? 200, headers });
}

function redirectResponse(location: string) {
  return new Response(null, { status: 302, headers: { location } });
}

/** A transport that answers each URL in turn, so redirects can be walked. */
function transport(responses: Record<string, Response>, fallback?: Response) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const hit = responses[url];
    if (hit) return hit.clone();
    if (fallback) return fallback.clone();
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    resolve: async () => [PUBLIC],
    fetchImpl: transport({ "https://example.com/page": textResponse("<html>hello</html>") }),
    ...overrides,
  } as never;
}

describe("schemes", () => {
  it("allows only http and https", () => {
    expect(assessUrl("https://example.com/x").ok).toBe(true);
    expect(assessUrl("http://example.com/x").ok).toBe(true);
  });

  it("refuses schemes that are not web addresses at all", () => {
    // `file:` reads the filesystem; the rest are here so a future contributor
    // does not have to wonder whether they were considered.
    for (const url of [
      "file:///etc/passwd",
      "gopher://example.com/",
      "ftp://example.com/x",
      "data:text/html,<script>alert(1)</script>",
      "javascript:alert(1)",
      "ws://example.com/socket",
      "blob:https://example.com/x",
    ]) {
      const result = assessUrl(url);
      expect(result.ok, `${url} should be refused`).toBe(false);
      expect(result.reason).toBe("scheme_not_allowed");
    }
  });

  it("refuses something that is not a URL", () => {
    for (const notUrl of ["", "example.com", "/relative/path", "http://", "not a url"]) {
      expect(assessUrl(notUrl).ok, `${notUrl} should be refused`).toBe(false);
    }
  });
});

describe("hostnames refused by name", () => {
  it("refuses internal names before any lookup happens", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "localhost.",
      "foo.localhost",
      "anything.local",
      "db.internal",
      "metadata.google.internal",
      "kubernetes.default.svc",
      "service.cluster.local",
      "intranet",
      "corp",
    ]) {
      expect(isBlockedHostname(host), `${host} should be blocked`).toBe(true);
    }
  });

  it("allows ordinary public hostnames", () => {
    for (const host of ["example.com", "www.bbc.co.uk", "sub.domain.example.org", "xn--80ak6aa92e.com"]) {
      expect(isBlockedHostname(host), `${host} should be allowed`).toBe(false);
    }
  });
});

describe("IPv4 ranges", () => {
  it("blocks every private, loopback, link-local and reserved range", () => {
    for (const address of [
      "0.0.0.0",
      "0.1.2.3",
      "10.0.0.1",
      "10.255.255.255",
      "100.64.0.1",
      "127.0.0.1",
      "127.9.9.9",
      "169.254.0.1",
      "169.254.169.254", // cloud metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.1",
      "192.0.2.5",
      "192.88.99.1",
      "192.168.0.1",
      "192.168.255.255",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isBlockedV4(address), `${address} should be blocked`).toBe(true);
    }
  });

  it("does not refuse adjacent public addresses", () => {
    // Each of these sits immediately below or above a blocked range. Refusing
    // them would be a false positive that silently breaks real feeds.
    for (const address of [
      "1.1.1.1",
      "8.8.8.8",
      "9.255.255.255",
      "11.0.0.1",
      "100.63.255.255",
      "100.128.0.1",
      "126.255.255.255",
      "128.0.0.1",
      "169.253.255.255",
      "169.255.0.1",
      "172.15.255.255",
      "172.32.0.0",
      "192.167.255.255",
      "192.169.0.1",
      "198.17.255.255",
      "198.20.0.1",
      "223.255.255.255",
    ]) {
      expect(isBlockedV4(address), `${address} should be allowed`).toBe(false);
    }
  });

  it("refuses the non-canonical spellings of loopback", () => {
    // 127.1, 2130706433 and 0x7f.1 all mean 127.0.0.1 to a resolver or a proxy.
    for (const url of ["http://127.1/", "http://2130706433/", "http://0x7f.1/", "http://017700000001/"]) {
      expect(assessUrl(url).ok, `${url} should be refused`).toBe(false);
    }
    expect(assessUrl("http://127.0.0.1/").reason).toBe("address_blocked");
  });
});

describe("IPv6 ranges", () => {
  it("blocks loopback, unspecified, unique-local, link-local and multicast", () => {
    for (const address of ["::1", "::", "fc00::1", "fd00::1", "fe80::1", "ff02::1", "2001:db8::1"]) {
      expect(isBlockedV6(address), `${address} should be blocked`).toBe(true);
    }
  });

  it("judges the embedded address of an IPv4-mapped form", () => {
    // ::ffff:169.254.169.254 reaches the metadata service exactly as the v4 form
    // does — the wrapper is not a disguise.
    expect(isBlockedV6("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedV6("::ffff:10.0.0.1")).toBe(true);
    expect(isBlockedV6("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedV6("::ffff:93.184.216.34")).toBe(false);
  });

  it("ignores a zone index rather than treating it as unparseable", () => {
    // `fe80::1%eth0` must not slip through because the suffix broke the parser.
    expect(isBlockedV6("fe80::1%eth0")).toBe(true);
    expect(isBlockedV6("::1%lo0")).toBe(true);
  });

  it("allows ordinary public v6 addresses", () => {
    for (const address of ["2606:4700:4700::1111", "2a00:1450:4009:81f::200e"]) {
      expect(isBlockedV6(address), `${address} should be allowed`).toBe(false);
    }
  });

  it("routes any literal through the right family check", () => {
    expect(isBlockedAddress("10.0.0.1")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("2606:4700::1")).toBe(false);
  });
});

describe("safeFetch: the happy path still works", () => {
  it("returns text for a public page", async () => {
    const result = await safeFetch("https://example.com/page", options());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("<html>hello</html>");
      expect(result.contentType).toContain("text/html");
      expect(result.redirects).toBe(0);
    }
  });

  it("accepts a http (not just https) source, because Kenyan radio streams are http", async () => {
    const result = await safeFetch(
      "http://example.com/feed",
      options({
        fetchImpl: transport({ "http://example.com/feed": textResponse("<rss/>", { contentType: "application/rss+xml" }) }),
      })
    );
    expect(result.ok).toBe(true);
  });
});

describe("safeFetch: refusals", () => {
  it("refuses a private destination reached by redirect", async () => {
    // The attack the module exists for: the first URL is validated and public,
    // and the second is never validated by a `follow`-style implementation.
    const result = await safeFetch(
      "https://example.com/page",
      options({
        fetchImpl: transport({
          "https://example.com/page": redirectResponse("http://169.254.169.254/latest/meta-data/"),
        }),
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // `address_blocked`, not `host_blocked`: it is a literal address, so it is
      // caught by the range check rather than by the name denylist.
      expect(result.reason).toBe("address_blocked");
      expect(result.detail).toContain("169.254.169.254");
    }
  });

  it("refuses a redirect to an internal hostname", async () => {
    const result = await safeFetch(
      "https://example.com/page",
      options({
        fetchImpl: transport({
          "https://example.com/page": redirectResponse("http://redis.internal:6379/"),
        }),
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("host_blocked");
  });

  it("refuses a redirect whose destination resolves to a private address", async () => {
    // The destination *looks* fine and is only caught by resolving it.
    const result = await safeFetch(
      "https://example.com/page",
      options({
        resolve: async (host: string) => (host === "cdn.example.net" ? ["10.1.2.3"] : [PUBLIC]),
        fetchImpl: transport({
          "https://example.com/page": redirectResponse("https://cdn.example.net/asset"),
        }),
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("address_blocked");
  });

  it("refuses a host that answers with one public and one private address", async () => {
    const result = await safeFetch(
      "https://example.com/page",
      options({ resolve: async () => [PUBLIC, "192.168.1.10"] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("address_blocked");
  });

  it("bounds a redirect loop instead of following it forever", async () => {
    const hop = (n: number) => `https://example.com/hop${n}`;
    const result = await safeFetch(
      hop(0),
      options({
        maxRedirects: 3,
        fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
          const url = input.toString();
          const n = Number(url.replace(/\D/g, "") || "0");
          return redirectResponse(hop(n + 1));
        }),
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too_many_redirects");
  });

  it("resolves a relative redirect against the URL that sent it", async () => {
    const result = await safeFetch(
      "https://example.com/page",
      options({
        fetchImpl: transport(
          { "https://example.com/page": redirectResponse("/moved") },
          textResponse("arrived")
        ),
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://example.com/moved");
  });

  it("refuses a redirect with no destination", async () => {
    const result = await safeFetch(
      "https://example.com/page",
      options({ fetchImpl: transport({ "https://example.com/page": new Response(null, { status: 302 }) }) })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("redirect_without_location");
  });

  it("refuses a body whose declared length is too large", async () => {
    // The cheap check: a `Content-Length` that already exceeds the cap. It is a
    // claim, and an optional one, which is why the test below exists too.
    const claimed = await safeFetch(
      "https://example.com/page",
      options({
        maxBytes: 100,
        fetchImpl: transport({
          "https://example.com/page": textResponse("tiny", { contentLength: 10_000 }),
        }),
      })
    );
    expect(claimed.ok).toBe(false);
    if (!claimed.ok) expect(claimed.reason).toBe("too_large");
  });

  it("refuses an oversized body while reading it, with no declared length", async () => {
    // `await res.text()` on an endpoint that streams forever is an out-of-memory
    // denial of service, so the cap is enforced mid-stream rather than trusted
    // from a header.
    const streamed = await safeFetch(
      "https://example.com/page",
      options({
        maxBytes: 100,
        fetchImpl: transport({ "https://example.com/page": textResponse("x".repeat(5_000)) }),
      })
    );
    expect(streamed.ok).toBe(false);
    if (!streamed.ok) expect(streamed.reason).toBe("too_large");
  });

  it("refuses a content type the caller cannot handle", async () => {
    const result = await safeFetch(
      "https://example.com/page",
      options({
        accept: ["text/html"],
        fetchImpl: transport({ "https://example.com/page": textResponse("binary", { contentType: "video/mp4" }) }),
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("content_type_not_allowed");
  });

  it("reports a timeout as a timeout, not a crash", async () => {
    const result = await safeFetch("https://example.com/slow", {
      ...(options() as object),
      fetchImpl: vi.fn(async () => {
        const error = new Error("aborted");
        error.name = "TimeoutError";
        throw error;
      }),
    } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timeout");
  });

  it("treats an upstream error status as a refusal with a reason", async () => {
    const result = await safeFetch(
      "https://example.com/page",
      options({ fetchImpl: transport({ "https://example.com/page": textResponse("nope", { status: 503 }) }) })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_ok");
      expect(result.detail).toContain("503");
    }
  });

  it("treats an unresolvable host as unreachable", async () => {
    const result = await safeFetch("https://nope.example/page", {
      ...(options() as object),
      resolve: async () => {
        throw new Error("ENOTFOUND");
      },
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unreachable");
  });

  it("never throws, whatever the transport does", async () => {
    const result = await safeFetch("https://example.com/page", {
      ...(options() as object),
      fetchImpl: vi.fn(async () => {
        throw new Error("boom");
      }),
    } as never);
    expect(result.ok).toBe(false);
  });

  it("returns null from the text helper rather than throwing", async () => {
    const text = await safeFetchText("http://127.0.0.1/", options());
    expect(text).toBeNull();
  });
});

/*
 * Bracketed IPv6 literals.
 *
 * These are regression tests for a bypass that was live and silent. WHATWG
 * `hostname` returns an IPv6 literal *with* its brackets, and every check was
 * written for a bare address — so `[::1]` satisfied none of them. Worse, the
 * three checks each deferred to another: `isBlockedV6` returned false on input
 * it could not parse, with a comment asserting the literal check would have
 * caught it, and that check only knew about IPv4. `[::ffff:169.254.169.254]` is
 * the case that matters — it reaches the cloud metadata service.
 */
describe("IPv6 literals with brackets", () => {
  it.each([
    ["http://[::1]/", "loopback"],
    ["http://[::1]:8000/live", "loopback with a port"],
    ["http://[fd00::1]/live", "unique-local fc00::/7"],
    ["http://[fe80::1]/live", "link-local fe80::/10"],
    ["http://[ff02::1]/live", "multicast"],
    ["https://[2001:db8::1]/live", "documentation range"],
    ["http://[::ffff:169.254.169.254]/latest/meta-data/", "IPv4-mapped metadata service"],
    ["http://[::ffff:127.0.0.1]/", "IPv4-mapped loopback"],
  ])("refuses %s (%s)", (url) => {
    const result = assessUrl(url);
    expect(result.ok, `${url} should be refused`).toBe(false);
  });

  it("still allows a public IPv6 literal", () => {
    // The fix must strip brackets, not blanket-refuse the family: a station or
    // source served over public IPv6 is legitimate.
    expect(assessUrl("https://[2606:4700:4700::1111]/live").ok).toBe(true);
  });
});
