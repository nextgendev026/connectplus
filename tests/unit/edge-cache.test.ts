import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../workers/edge-cache/src/index.mjs";

/**
 * The worker is plain JS deployed straight to Cloudflare, so these tests drive
 * its default export through stubbed Web APIs (`caches`, `fetch`) rather than
 * importing internals. They pin the two things that are expensive to get wrong
 * in production: which entries may be stored for how long, and that anything
 * credentialed is never stored at all.
 */

const ENV = { ORIGIN: "https://origin.test" };

const stored = new Map<string, Response>();
const originFetches: string[] = [];

const cacheStorage = {
  default: {
    match: async (request: Request) => stored.get(request.url),
    put: async (request: Request, response: Response) => {
      stored.set(request.url, response);
    },
  },
};

function originReturns(body: string, contentType: string, init: ResponseInit = {}) {
  vi.stubGlobal("fetch", async (url: string) => {
    originFetches.push(String(url));
    return new Response(body, {
      ...init,
      headers: { "Content-Type": contentType, ...(init.headers ?? {}) },
    });
  });
}

async function request(path: string, headers: HeadersInit = {}): Promise<Response> {
  return (await worker.fetch(new Request(`https://edge.test${path}`, { headers }), ENV)) as Response;
}

function ttlOf(res: Response): number {
  return Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 0);
}

beforeEach(() => {
  stored.clear();
  originFetches.length = 0;
  vi.stubGlobal("caches", cacheStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("edge cache policy", () => {
  it("does not pin an unchanged root file like /favicon.ico for a year", async () => {
    originReturns("icon", "image/vnd.microsoft.icon");

    const first = await request("/favicon.ico");
    expect(first.headers.get("x-edge-cache")).toBe("MISS");
    expect(ttlOf(first)).toBe(60 * 60);
    // The bug this guards: a 365-day TTL let the fixed favicon keep serving
    // the old bytes to every reader.
    expect(ttlOf(first)).toBeLessThan(60 * 60 * 24);

    const second = await request("/favicon.ico");
    expect(second.headers.get("x-edge-cache")).toBe("HIT");
    expect(originFetches).toHaveLength(1);
  });

  it("keeps content-hashed build output immutable", async () => {
    originReturns("js", "application/javascript");
    const res = await request("/_next/static/immutable/chunk.js");
    expect(ttlOf(res)).toBe(60 * 60 * 24 * 365);
  });

  it("caches HTML for a minute", async () => {
    originReturns("<html>", "text/html");
    const res = await request("/");
    expect(ttlOf(res)).toBe(60);
  });

  it("version-stamps the cache key so a policy change drops stale entries", async () => {
    originReturns("<html>", "text/html");
    await request("/trending");
    expect([...stored.keys()]).toEqual([expect.stringContaining("__edge=std&v=2")]);
  });

  it("never stores a credentialed request", async () => {
    originReturns("<html>", "text/html");
    const res = await request("/", { Cookie: "cp_session=abc" });
    expect(res.headers.get("x-edge-cache")).toBe("BYPASS");
    expect(originFetches).toHaveLength(1);
    expect(stored.size).toBe(0);
  });

  it("never stores a response carrying Set-Cookie", async () => {
    originReturns("<html>", "text/html", { headers: { "Set-Cookie": "cp_session=abc" } });
    const res = await request("/");
    expect(res.headers.get("x-edge-cache")).toBe("MISS-UNCACHEABLE");
    expect(stored.size).toBe(0);
  });
});
