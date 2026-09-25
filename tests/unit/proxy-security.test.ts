import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { isCrossSiteMutation, proxy, resolveRateIdentity } from "@/proxy";

/**
 * The middleware's two jobs, tested where they were previously wrong.
 *
 * **Attribution.** `x-forwarded-for` is a header the caller sets. Keying the
 * anonymous rate limit on its first value meant every anonymous ceiling was
 * bypassable by writing a different number into one header — a limit that looks
 * present in the code and does nothing in practice. The mark of a fixed version is
 * that a spoofed header is *not enough*: an unattributable caller is bounded by a
 * shared bucket as well as their claimed one.
 *
 * **CSRF.** A cookie-bearing cross-site POST is a mutation performed with the
 * reader's credentials. The rule is deliberately narrow — safe methods pass, a
 * request with no cookie passes (nothing to forge with, which is what keeps
 * native clients and service callers working), and everything else must present an
 * origin that is ours.
 */

const db = vi.hoisted(() => ({
  token: null as null | { sub?: string },
  checkRateLimit: vi.fn(),
}));

vi.mock("next-auth/jwt", () => ({ getToken: async () => db.token }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: db.checkRateLimit }));

function req(
  url: string,
  init: { method?: string; headers?: Record<string, string> } = {}
): NextRequest {
  return new NextRequest(url, {
    method: init.method ?? "GET",
    headers: init.headers ?? {},
  });
}

beforeEach(() => {
  db.token = null;
  db.checkRateLimit.mockReset();
  db.checkRateLimit.mockResolvedValue(null); // force the in-memory fallback path
  delete process.env.CRON_SECRET;
});

describe("rate-limit identity", () => {
  it("keys a signed-in caller by user id, which cannot be forged without a session", async () => {
    db.token = { sub: "user-42" };
    const identity = await resolveRateIdentity(req("http://localhost/api/posts"));

    expect(identity.key).toBe("uid:user-42:/api/posts");
    expect(identity.attributed).toBe(true);
  });

  it("prefers an address the platform set over one the client sent", async () => {
    const identity = await resolveRateIdentity(
      req("http://localhost/api/posts", {
        headers: {
          "x-vercel-forwarded-for": "203.0.113.9",
          "x-forwarded-for": "1.2.3.4",
        },
      })
    );

    // The client's claim is not used at all when a platform header is present.
    expect(identity.key).toBe("ip:203.0.113.9:/api/posts");
    expect(identity.attributed).toBe(true);
  });

  it("accepts the Cloudflare client address, and takes only the first hop", async () => {
    const identity = await resolveRateIdentity(
      req("http://localhost/api/posts", { headers: { "cf-connecting-ip": "198.51.100.7, 10.0.0.1" } })
    );
    expect(identity.key).toBe("ip:198.51.100.7:/api/posts");
    expect(identity.attributed).toBe(true);
  });

  it("does not treat a client-supplied forwarded address as verified", async () => {
    const identity = await resolveRateIdentity(
      req("http://localhost/api/posts", { headers: { "x-forwarded-for": "1.2.3.4" } })
    );

    expect(identity.key).toBe("unverified:1.2.3.4:/api/posts");
    expect(identity.attributed).toBe(false);
  });

  it("marks a caller with no address at all as unattributed", async () => {
    const identity = await resolveRateIdentity(req("http://localhost/api/posts"));
    expect(identity.key).toBe("anonymous:/api/posts");
    expect(identity.attributed).toBe(false);
  });
});

describe("CSRF: cookie-authenticated mutations must come from us", () => {
  it("ignores safe methods", () => {
    expect(isCrossSiteMutation(req("http://localhost/api/posts", { method: "GET" }))).toBe(false);
    expect(isCrossSiteMutation(req("http://localhost/api/posts", { method: "HEAD" }))).toBe(false);
  });

  it("ignores a request with no ambient credentials to abuse", () => {
    // No cookie means the browser is not attaching anything; a native client and
    // a cron call both look like this.
    expect(
      isCrossSiteMutation(
        req("http://localhost/api/posts", { method: "POST", headers: { origin: "https://evil.example" } })
      )
    ).toBe(false);
  });

  it("allows a same-origin cookie mutation", () => {
    expect(
      isCrossSiteMutation(
        req("http://localhost/api/posts", {
          method: "POST",
          headers: { cookie: "session=abc", origin: "http://localhost" },
        })
      )
    ).toBe(false);
  });

  it("refuses a cross-site cookie mutation", () => {
    expect(
      isCrossSiteMutation(
        req("http://localhost/api/posts", {
          method: "POST",
          headers: { cookie: "session=abc", origin: "https://evil.example" },
        })
      )
    ).toBe(true);
  });

  it("refuses a cookie mutation that presents no origin at all", () => {
    expect(
      isCrossSiteMutation(
        req("http://localhost/api/posts", { method: "POST", headers: { cookie: "session=abc" } })
      )
    ).toBe(true);
  });

  it("accepts a referer when there is no origin, and refuses a foreign one", () => {
    const sameSite = req("http://localhost/api/posts", {
      method: "POST",
      headers: { cookie: "session=abc", referer: "http://localhost/studio" },
    });
    const foreign = req("http://localhost/api/posts", {
      method: "POST",
      headers: { cookie: "session=abc", referer: "https://evil.example/page" },
    });

    expect(isCrossSiteMutation(sameSite)).toBe(false);
    expect(isCrossSiteMutation(foreign)).toBe(true);
  });

  it("refuses an unparseable origin rather than shrugging", () => {
    expect(
      isCrossSiteMutation(
        req("http://localhost/api/posts", { method: "POST", headers: { cookie: "session=abc", origin: "null" } })
      )
    ).toBe(true);
  });

  it("lets a service caller through on the shared secret", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(
      isCrossSiteMutation(
        req("http://localhost/api/cron", {
          method: "POST",
          headers: { cookie: "session=abc", origin: "https://evil.example", authorization: "Bearer s3cret-value" },
        })
      )
    ).toBe(false);
  });

  it("exempts the two verified webhook paths", () => {
    for (const path of ["/api/payments/daraja/callback", "/api/payments/paypal/webhook"]) {
      expect(
        isCrossSiteMutation(
          req(`http://localhost${path}`, {
            method: "POST",
            headers: { cookie: "session=abc", origin: "https://safaricom.example" },
          })
        ),
        `${path} should be exempt from the origin check`,
        ).toBe(false);
    }
  });

  it("accepts the configured canonical origin behind a proxy", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://connectplusapp.vercel.app";
    expect(
      isCrossSiteMutation(
        req("http://internal-host/api/posts", {
          method: "POST",
          headers: { cookie: "session=abc", origin: "https://connectplusapp.vercel.app" },
        })
      )
    ).toBe(false);
    delete process.env.NEXT_PUBLIC_APP_URL;
  });
});

describe("mutations that arrive through the Cloudflare edge worker", () => {
  const EDGE_ORIGIN = "https://connectplus-edge.connectplusapp.workers.dev";

  afterEach(() => {
    delete process.env.EDGE_URL;
    delete process.env.NEXT_PUBLIC_EDGE_URL;
  });

  it("accepts the edge origin from either configured edge URL", () => {
    // The production bug this pins: on the worker's domain the browser sends
    // Origin: https://connectplus-edge… while the request itself is addressed
    // to the origin, so every cookie-bearing mutation through Cloudflare
    // answered 403 and the Studio's publish button died with "[object Object]".
    for (const key of ["EDGE_URL", "NEXT_PUBLIC_EDGE_URL"] as const) {
      process.env[key] = EDGE_ORIGIN;
      expect(
        isCrossSiteMutation(
          req("http://origin-host/api/posts", {
            method: "POST",
            headers: { cookie: "session=abc", origin: EDGE_ORIGIN },
          })
        ),
        `${key} should bless the edge origin`
      ).toBe(false);
      delete process.env[key];
    }
  });

  it("accepts the deployed worker's host with no edge URL configured", () => {
    // The floor that keeps publishes working on a deployment that never set
    // EDGE_URL: the host is pinned in code, not globbed — any account can
    // register *.workers.dev, but nobody outside this one can register ours.
    expect(
      isCrossSiteMutation(
        req("http://origin-host/api/posts", {
          method: "POST",
          headers: { cookie: "session=abc", origin: EDGE_ORIGIN },
        })
      )
    ).toBe(false);
  });

  it("trusts the forwarded host a proxy declares for the reader", () => {
    expect(
      isCrossSiteMutation(
        req("http://origin-host/api/posts", {
          method: "POST",
          headers: {
            cookie: "session=abc",
            origin: EDGE_ORIGIN,
            "x-forwarded-host": "connectplus-edge.connectplusapp.workers.dev",
          },
        })
      )
    ).toBe(false);
  });

  it("refuses a foreign origin whose forwarded host does not match it", () => {
    expect(
      isCrossSiteMutation(
        req("http://origin-host/api/posts", {
          method: "POST",
          headers: {
            cookie: "session=abc",
            origin: "https://evil.example",
            "x-forwarded-host": "connectplus-edge.connectplusapp.workers.dev",
          },
        })
      )
    ).toBe(true);
  });
});

describe("the middleware answers in the API's own envelope", () => {
  it("refuses a cross-site mutation with 403 and a request id", async () => {
    const response = await proxy(
      req("http://localhost/api/posts", {
        method: "POST",
        headers: { cookie: "session=abc", origin: "https://evil.example" },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.requestId).toBeTruthy();
  });

  it("returns 429 with Retry-After when the limit is hit", async () => {
    db.token = { sub: "user-1" };
    db.checkRateLimit.mockResolvedValue({ limited: true, resetAfter: 30 });

    const response = await proxy(req("http://localhost/api/posts", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.requestId).toBeTruthy();
  });

  it("applies a shared ceiling on top of an unattributable caller", async () => {
    // The point of the fix: a spoofed or absent address still runs into a bucket
    // it cannot rotate out of.
    db.checkRateLimit.mockResolvedValue(null);
    await proxy(req("http://localhost/api/posts", { headers: { "x-forwarded-for": "1.2.3.4" } }));

    const keys = db.checkRateLimit.mock.calls.map((call) => String(call[0]));
    expect(keys.some((key) => key.startsWith("unverified:1.2.3.4"))).toBe(true);
    expect(keys.some((key) => key.startsWith("shared:POSTS"))).toBe(true);
  });

  it("does not apply the shared ceiling to an attributed caller", async () => {
    db.token = { sub: "user-1" };
    db.checkRateLimit.mockResolvedValue(null);
    await proxy(req("http://localhost/api/posts"));

    const keys = db.checkRateLimit.mock.calls.map((call) => String(call[0]));
    expect(keys.some((key) => key.startsWith("shared:"))).toBe(false);
  });
});
