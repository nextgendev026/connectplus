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
/** Promises the worker handed to `ctx.waitUntil` — background revalidations. */
const background: Promise<unknown>[] = [];

const CTX = {
  waitUntil: (promise: Promise<unknown>) => {
    background.push(promise);
  },
};

/** Let every queued background refresh settle before asserting on it. */
async function settleBackground(): Promise<void> {
  await Promise.allSettled([...background]);
}

const cacheStorage = {
  default: {
    /**
     * Cloudflare rewrites `Date` to the moment of the *hit*.
     *
     * Handing the stored headers back verbatim is more forgiving than
     * production and hides a whole bug class: freshness derived from `Date`
     * never ages anything, so every entry reports "fresh" until the cache
     * evicts it — and the cron, seeing a fresh copy forever, stops rebuilding.
     */
    match: async (request: Request) => {
      const hit = stored.get(request.url);
      if (!hit) return undefined;
      const headers = new Headers(hit.headers);
      headers.set("Date", new Date().toUTCString());
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
    },
    put: async (request: Request, response: Response) => {
      stored.set(request.url, response);
    },
  },
};

/**
 * A stored response the worker should consider `ageSeconds` old.
 *
 * Both headers matter. `x-edge-stored-at` is the worker's own write time and
 * the only honest clock; `Date` is present because every real response carries
 * one, and `match` above rewrites it on retrieval the way the platform does.
 */
function agedResponse(
  body: string,
  ageSeconds: number,
  headers: Record<string, string> = {}
): Response {
  const at = Date.now() - ageSeconds * 1000;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "x-edge-stored-at": String(at),
      Date: new Date(at).toUTCString(),
      ...headers,
    },
  });
}

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
  return (await worker.fetch(new Request(`https://edge.test${path}`, { headers }), ENV, CTX)) as Response;
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

  it("pins the fallback TTL constant the worker's numbers are derived from", () => {
    // Guards against a refactor silently collapsing the tiers to one TTL.
    originReturns("<html>", "text/html");
    return request("/trending").then((res) => expect(ttlOf(res)).toBe(60));
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
    // Asserted as a shape, not a literal: the value is meant to be bumped
    // whenever the caching rules change (v3 introduced the livescore tier).
    expect([...stored.keys()]).toEqual([expect.stringMatching(/__edge=std&v=\d+$/)]);
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

describe("livescore edge tier", () => {
  const LIVE_URL = "/__livescore?sport=football&date=2026-09-13";

  /** Pre-seed the cache with an entry the worker considers `ageSeconds` old. */
  function seedCached(key: string, ageSeconds: number, body = '{"matches":[]}') {
    stored.set(key, agedResponse(body, ageSeconds));
  }

  it("rewrites the alias to the live API and caches it as the live variant", async () => {
    originReturns('{"matches":[]}', "application/json");
    const res = await request(LIVE_URL);

    expect(res.headers.get("x-edge-cache")).toBe("MISS");
    expect(ttlOf(res)).toBe(15);
    // The origin sees the real API path, never the alias.
    expect(originFetches[0]).toBe("https://origin.test/api/sports/live?sport=football&date=2026-09-13");
    expect([...stored.keys()]).toEqual([
      expect.stringContaining("https://edge.test/__livescore?sport=football&date=2026-09-13&__edge=live"),
    ]);
  });

  it("answers cross-origin so the browser can read the poll", async () => {
    originReturns('{"matches":[]}', "application/json");
    const res = await request(LIVE_URL);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    // Credentialed CORS would be a promise the worker does not keep — it
    // bypasses any request carrying a Cookie.
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("snaps the query to a closed set so cache-busting params cannot shred the cache", async () => {
    originReturns('{"matches":[]}', "application/json");

    // A caller appending junk, an unknown sport and a malformed date must all
    // land on the same origin fetch as the canonical request.
    await request("/__livescore?sport=football&date=2026-09-13&_cb=99123&utm_source=x");
    await request("/__livescore?sport=netball&date=not-a-date");

    expect(originFetches).toEqual([
      "https://origin.test/api/sports/live?sport=football&date=2026-09-13",
      "https://origin.test/api/sports/live?sport=football",
    ]);
  });

  it("serves a fresh entry from the edge without touching the origin", async () => {
    originReturns('{"matches":[]}', "application/json");
    await request(LIVE_URL);
    const before = originFetches.length;

    const second = await request(LIVE_URL);
    expect(second.headers.get("x-edge-cache")).toBe("HIT");
    expect(originFetches).toHaveLength(before);
  });

  it("serves a stale entry immediately and refreshes behind the reader", async () => {
    // Past the 15s TTL but inside the 45s stale window.
    seedCached(
      "https://edge.test/__livescore?sport=football&date=2026-09-13&__edge=live&v=4",
      30,
      '{"matches":["stale"]}'
    );
    originReturns('{"matches":["fresh"]}', "application/json");

    const res = await request(LIVE_URL);

    // The reader gets the stale copy at once, and the origin is hit in the
    // background rather than making them wait for it.
    expect(res.headers.get("x-edge-cache")).toBe("HIT-STALE");
    // A range rather than an exact 30: the entry is seeded a hair before the
    // request, so the age can round either side of the seeded value.
    const age = Number(res.headers.get("x-edge-age"));
    expect(age).toBeGreaterThanOrEqual(30);
    expect(age).toBeLessThanOrEqual(31);
    expect(await res.json()).toEqual({ matches: ["stale"] });

    await settleBackground();
    expect(originFetches).toHaveLength(1);

    // The refresh replaced the stored entry, so the next caller is current.
    const next = await request(LIVE_URL);
    expect(next.headers.get("x-edge-cache")).toBe("HIT");
    expect(await next.json()).toEqual({ matches: ["fresh"] });
  });

  it("refetches synchronously once the stale window has passed", async () => {
    // Older than ttl + swr (15 + 45), so it is no longer worth serving.
    seedCached(
      "https://edge.test/__livescore?sport=football&date=2026-09-13&__edge=live&v=4",
      120,
      '{"matches":["ancient"]}'
    );
    originReturns('{"matches":["fresh"]}', "application/json");

    const res = await request(LIVE_URL);
    expect(res.headers.get("x-edge-cache")).toBe("MISS");
    expect(originFetches).toHaveLength(1);
  });

  it("never caches reader-scoped sports routes", async () => {
    originReturns('{"reminders":[]}', "application/json");
    const res = await request("/api/sports/reminders");
    expect(res.headers.get("x-edge-cache")).toBe("BYPASS");
    expect(stored.size).toBe(0);
  });

  it("advertises the alias on the liveness probe", async () => {
    const res = await request("/__edge");
    const body = (await res.json()) as { livescore: string };
    expect(body.livescore).toBe("https://edge.test/__livescore");
  });

  it("serves the status payload from the edge instead of probing upstream again", async () => {
    originReturns('{"overall":"operational"}', "application/json");

    const first = await request("/api/status");
    expect(first.headers.get("x-edge-cache")).toBe("MISS");
    // A minute of health, then the edge answers — the status route is the most
    // expensive read in the app, so a repeat visitor must not re-run it.
    expect(ttlOf(first)).toBe(60);
    expect(originFetches).toHaveLength(1);

    const second = await request("/api/status");
    expect(second.headers.get("x-edge-cache")).toBe("HIT");
    expect(originFetches).toHaveLength(1);
    // Same-origin payload: the worker must not invite other sites to read it.
    expect(second.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never caches the uptime probe beside it", async () => {
    originReturns('{"status":"operational"}', "application/json");
    const res = await request("/api/status/ping");
    expect(res.headers.get("x-edge-cache")).toBe("BYPASS");
    expect(stored.size).toBe(0);
  });

  it("hardens what it hands back, including cache hits", async () => {
    originReturns("<html>", "text/html");
    const miss = await request("/");
    expect(miss.headers.get("x-content-type-options")).toBe("nosniff");
    expect(miss.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");

    const hit = await request("/");
    expect(hit.headers.get("x-edge-cache")).toBe("HIT");
    expect(hit.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not overrule the origin's own framing policy", async () => {
    originReturns("<html>", "text/html", { headers: { "X-Frame-Options": "SAMEORIGIN" } });
    const res = await request("/embed");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});

describe("edge cron — cache-first snapshots", () => {
  const TODAY = new Date().toISOString().slice(0, 10);
  const SNAP = "https://snapshot.edge.internal";

  /** Pre-seed a worker-owned snapshot the check considers `ageSeconds` old. */
  function seedSnapshot(id: string, ageSeconds: number, body = '{"matches":[]}') {
    // `v=4` mirrors CACHE_VERSION; the key *shape* is asserted in the policy
    // suite above, so a bump fails loudly there rather than silently here.
    stored.set(`${SNAP}/${id}?v=4`, agedResponse(body, ageSeconds));
  }

  const cronFetches = () => originFetches.filter((u) => u.includes("/api/cron"));

  async function tick(cron: string): Promise<void> {
    // No execution context: a Cron Trigger has no response to return early
    // from, so the tick awaits everything itself rather than handing work to
    // `waitUntil` and losing it if the invocation ends first.
    await worker.scheduled({ cron } as never, { ...ENV, CRON_SECRET: "s3cret" });
    await settleBackground();
  }

  it("skips the rebuild entirely while the cached snapshot is fresh", async () => {
    seedSnapshot("livescore-football", 10);

    await tick("*/2 * * * *");

    // The whole point: a fresh copy means the origin is not pinged at all.
    expect(cronFetches()).toEqual([]);
    expect(originFetches).toEqual([]);
  });

  it("lets a reader's own poll keep the snapshot current", async () => {
    originReturns('{"matches":[]}', "application/json");
    // The board's real poll: today's fixtures, canonical sport.
    await request(`/__livescore?sport=football&date=${TODAY}`);

    // The readers' responses are mirrored into the snapshot namespace, so the
    // tick reads the same documents instead of rebuilding them.
    expect([...stored.keys()]).toContain(`${SNAP}/livescore-football?v=4`);

    // …and with the *snapshot's* lifetime, not the board's. The Cache API
    // expires an entry from its response headers, so a copy left carrying the
    // board's 15s max-age was gone before the tick's 120s window opened — the
    // tick then rebuilt every time, which is the bug this pins.
    const mirrored = stored.get(`${SNAP}/livescore-football?v=4`);
    expect(/max-age=(\d+)/.exec(mirrored?.headers.get("cache-control") ?? "")?.[1]).toBe("120");
    await tick("*/2 * * * *");
    expect(cronFetches()).toEqual([]);
  });

  it("retires the sport it no longer serves from the snapshot list", async () => {
    // The desk is football-only. The worker used to hold a second livescore
    // snapshot for basketball and guard `sports-live` on both; leaving the
    // retired one in the list would have kept the tick rebuilding a board that
    // no longer exists, on a trigger that only needs to run when football is
    // cold — so this asserts the list itself, not just the paths it warms.
    const probe = (await (await request("/__edge")).json()) as {
      snapshots: { id: string }[];
    };
    expect(probe.snapshots.map((s) => s.id)).toEqual(["livescore-football", "status", "radio-stations"]);
  });

  it("rebuilds when the football snapshot has no copy at all", async () => {
    // Nothing seeded: "no copy" must read as stale, or a cold deployment would
    // sit quiet forever waiting for a snapshot that never arrives.
    originReturns('{"matches":[]}', "application/json");
    await tick("*/2 * * * *");
    expect(cronFetches()).toHaveLength(1);
    expect(originFetches).toContain("https://origin.test/api/sports/live?sport=football");
  });

  it("does not let a historical day refresh the live snapshot", async () => {
    originReturns('{"matches":[]}', "application/json");
    await request("/__livescore?sport=football&date=2020-01-01");
    expect([...stored.keys()]).not.toContain(`${SNAP}/livescore-football?v=4`);
  });

  it("snaps a retired sport onto the football snapshot", async () => {
    // A stale link to the old basketball board still has to reach an origin that
    // answers, and it has to reach the *same* origin URL as the live board —
    // otherwise it is a second cache entry holding an identical payload.
    originReturns('{"matches":[]}', "application/json");
    await request(`/__livescore?sport=basketball&date=${TODAY}`);
    expect(originFetches).toEqual([`https://origin.test/api/sports/live?sport=football&date=${TODAY}`]);
    expect([...stored.keys()]).toContain(`${SNAP}/livescore-football?v=4`);
  });

  it("rebuilds and re-warms once a snapshot has actually gone stale", async () => {
    seedSnapshot("livescore-football", 300); // older than the 120s ttl
    originReturns('{"matches":[]}', "application/json");

    await tick("*/2 * * * *");

    // One ping for the job, plus one read to take back a fresh copy.
    expect(cronFetches()).toEqual(["https://origin.test/api/cron?trigger=sports-live&source=cloudflare-cron"]);
    expect(originFetches).toContain("https://origin.test/api/sports/live?sport=football");
    expect(originFetches.filter((u) => u.includes("/api/sports/live"))).toHaveLength(1);
    const warmed = stored.get(`${SNAP}/livescore-football?v=4`);
    const stamped = Number(warmed?.headers.get("x-edge-stored-at"));
    expect(stamped, "a warmed copy must carry our write time or it can never age").toBeTruthy();
    expect(Date.now() - stamped).toBeLessThan(5_000);

    // Re-warmed means the next tick has nothing left to do.
    await tick("*/2 * * * *");
    expect(cronFetches()).toHaveLength(1);
  });

  it("rebuilds when the snapshot cache cannot be read, rather than skipping", async () => {
    // A scheduler that skips because its own cache was unreachable is a
    // scheduler that quietly stops running jobs — the failure mode nobody
    // notices until the board is hours old. Unreadable means stale.
    const original = cacheStorage.default.match;
    cacheStorage.default.match = async () => {
      throw new Error("cache unavailable");
    };
    originReturns('{"matches":[]}', "application/json");
    try {
      await tick("*/2 * * * *");
    } finally {
      cacheStorage.default.match = original;
    }
    expect(cronFetches()).toHaveLength(1);
  });

  it("records what the tick decided, and reports it on the liveness probe", async () => {
    seedSnapshot("livescore-football", 300);
    originReturns('{"matches":[]}', "application/json");
    await tick("*/2 * * * *");

    const res = await request("/__edge");
    const body = (await res.json()) as {
      lastTick: { cron: string; at: string; triggers: { trigger: string; action: string; ping?: string }[] };
    };
    expect(body.lastTick.cron).toBe("*/2 * * * *");
    expect(body.lastTick.triggers).toEqual([
      expect.objectContaining({ trigger: "sports-live", action: "rebuilt", ping: "200" }),
    ]);
  });

  it("records an unmapped cron instead of returning silently", async () => {
    // Silence and "nothing to do" used to look identical from outside.
    await tick("7 3 * * *");
    expect(cronFetches()).toEqual([]);
    const res = await request("/__edge");
    const body = (await res.json()) as { lastTick: { cron: string; triggers: { action: string }[] } };
    expect(body.lastTick.cron).toBe("7 3 * * *");
    expect(body.lastTick.triggers[0]?.action).toBe("unmapped-cron");
  });

  it("leaves the jobs it does not hold a snapshot for alone", async () => {
    originReturns("{\"success\":true}", "application/json");
    await tick("*/5 * * * *");
    expect(cronFetches()).toEqual(["https://origin.test/api/cron?trigger=sports-notify&source=cloudflare-cron"]);
  });

  it("guards the status snapshot on the radio sweep", async () => {
    originReturns('{"overall":"operational"}', "application/json");
    seedSnapshot("status", 30, '{"overall":"operational"}');
    // Both snapshots this trigger guards have to be fresh for the tick to stay
    // quiet: the check is per-trigger, not per-snapshot, so a stale radio copy
    // is by itself reason enough to fire the sweep.
    seedSnapshot("radio-stations", 30, "[]");
    await tick("*/15 * * * *");
    expect(cronFetches()).toEqual([]);

    // …and refreshes it once the copy is past its five-minute window.
    seedSnapshot("status", 600, '{"overall":"operational"}');
    await tick("*/15 * * * *");
    expect(cronFetches()).toEqual([
      "https://origin.test/api/cron?trigger=radio-status-sweep&source=cloudflare-cron",
    ]);
    expect(originFetches).toContain("https://origin.test/api/status");
  });

  it("fires the radio sweep when only the radio copy has gone stale", async () => {
    // The radio station list is the single most-polled payload in the app, so it
    // earns its own guard: a stale copy must reach for the origin even while
    // service health is perfectly fresh.
    originReturns("[]", "application/json");
    seedSnapshot("status", 30, '{"overall":"operational"}');
    seedSnapshot("radio-stations", 600, "[]");

    await tick("*/15 * * * *");

    expect(cronFetches()).toEqual([
      "https://origin.test/api/cron?trigger=radio-status-sweep&source=cloudflare-cron",
    ]);
    expect(originFetches).toContain("https://origin.test/api/radio/stations");
  });

  it("still rebuilds when the snapshot entry has no usable date", async () => {
    stored.set(`${SNAP}/livescore-football?v=4`, new Response('{"matches":[]}', { status: 200 }));
    originReturns('{"matches":[]}', "application/json");
    await tick("*/2 * * * *");
    expect(cronFetches()).toHaveLength(1);
  });

  it("ages a snapshot from our own stamp, not the Date the platform rewrites", async () => {
    // The production shape that made this worker useless: Cloudflare returns a
    // cache hit with `Date` set to *now*, so a ten-minute-old copy reported as
    // brand new, the tick concluded there was nothing to rebuild, and the jobs
    // it drives stopped running. Age has to come from the stamp we wrote.
    const oldCopy = new Response('{"matches":[]}', {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-edge-stored-at": String(Date.now() - 600_000),
        Date: new Date().toUTCString(),
      },
    });
    stored.set(`${SNAP}/livescore-football?v=4`, oldCopy);
    originReturns('{"matches":[]}', "application/json");

    const probe = (await (await request("/__edge")).json()) as {
      snapshots: { id: string; ageSeconds: number | null; fresh: boolean }[];
    };
    const football = probe.snapshots.find((s) => s.id === "livescore-football");
    expect(football?.ageSeconds).toBeGreaterThanOrEqual(600);
    expect(football?.fresh).toBe(false);

    await tick("*/2 * * * *");
    expect(cronFetches()).toHaveLength(1);
  });

  it("keeps the write stamp out of what a reader receives", async () => {
    originReturns('{"matches":[]}', "application/json");
    const res = await request(`/__livescore?sport=football&date=${TODAY}`);
    expect(res.headers.get("x-edge-stored-at")).toBeNull();
  });

  it("reports snapshot ages on the liveness probe", async () => {
    seedSnapshot("livescore-football", 600);
    const res = await request("/__edge");
    const body = (await res.json()) as {
      snapshots: { id: string; ageSeconds: number | null; fresh: boolean }[];
    };
    const football = body.snapshots.find((s) => s.id === "livescore-football");
    expect(football?.fresh).toBe(false);
    expect(football?.ageSeconds).toBeGreaterThanOrEqual(600);
    expect(body.snapshots.map((s) => s.id)).toEqual([
      "livescore-football",
      "status",
      "radio-stations",
    ]);
  });
});

/**
 * The KV binding.
 *
 * Every behaviour asserted here has to hold with the binding absent too (the
 * suite above runs unbound), because a deployment that cannot create the
 * namespace is a supported configuration rather than a broken one.
 */
describe("edge cache — durable snapshots in KV", () => {
  const TODAY = new Date().toISOString().slice(0, 10);

  const kvData = new Map<string, string>();
  /** What each key was asked to live for, so expiry can be exercised. */
  const kvTtl = new Map<string, number>();
  const KV = {
    get: async (key: string, type?: string) => {
      const raw = kvData.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    put: async (
      key: string,
      value: string | unknown,
      options?: { expirationTtl?: number }
    ) => {
      // KV itself drops a key when its TTL elapses, so the fake has to as well:
      // a stub that never expires cannot tell a record that survives its own
      // freshness window from one that dies with it.
      if (options?.expirationTtl) kvTtl.set(key, options.expirationTtl);
      kvData.set(key, typeof value === "string" ? value : JSON.stringify(value));
    },
  };
  const kvTtlOf = (id: string) => kvTtl.get(`snapshot:${id}:v4`) ?? 0;

  const ENV_WITH_KV = { ...ENV, CRON_SECRET: "s3cret", SNAPSHOTS: KV };
  const snapshotKeyOf = (id: string) => `snapshot:${id}:v4`;

  async function edge(path: string, env: Record<string, unknown>): Promise<Response> {
    return (await worker.fetch(new Request(`https://edge.test${path}`), env, CTX)) as Response;
  }

  beforeEach(() => {
    kvData.clear();
    kvTtl.clear();
  });

  it("mirrors a reader's poll into the durable store", async () => {
    originReturns('{"matches":[]}', "application/json");
    await edge(`/__livescore?sport=football&date=${TODAY}`, ENV_WITH_KV);

    const record = JSON.parse(kvData.get(snapshotKeyOf("livescore-football")) ?? "null") as {
      storedAt: number;
      body: string;
    } | null;
    expect(record, "the snapshot should exist in KV").not.toBeNull();
    expect(record!.body).toContain("matches");
    expect(Date.now() - record!.storedAt).toBeLessThan(5_000);
  });

  it("ages a snapshot from the durable copy after another colo's cache is lost", async () => {
    // Exactly the production shape: the copy exists globally, the local colo
    // has never seen it. Reading it as "missing" made the tick rebuild every
    // pass; reading it as "fresh" is what makes the check work across colos.
    kvData.set(
      snapshotKeyOf("livescore-football"),
      JSON.stringify({
        storedAt: Date.now() - 300_000,
        status: 200,
        contentType: "application/json",
        body: '{"matches":[]}',
      })
    );

    const body = (await (await edge("/__edge", ENV_WITH_KV)).json()) as {
      snapshots: { id: string; ageSeconds: number | null; fresh: boolean }[];
      storage: { cache: boolean; kv: boolean };
    };
    const football = body.snapshots.find((s) => s.id === "livescore-football");
    expect(football?.ageSeconds).toBeGreaterThanOrEqual(300);
    expect(football?.fresh).toBe(false);
    expect(body.storage.kv).toBe(true);
  });

  it("skips the rebuild when the only copy is the durable one and still fresh", async () => {
    kvData.set(
      snapshotKeyOf("livescore-football"),
      JSON.stringify({ storedAt: Date.now() - 5_000, status: 200, contentType: "application/json", body: "{}" })
    );
    originReturns('{"matches":[]}', "application/json");

    await worker.scheduled({ cron: "*/2 * * * *" } as never, ENV_WITH_KV);
    await settleBackground();

    expect(originFetches).toEqual([]);
  });

  it("keeps a durable record past its freshness window, so a cold board reports its age", async () => {
    // Expiring the record at exactly the snapshot's TTL would make "40 seconds
    // past due" and "never stored at all" both read as null — the ambiguity that
    // left the cron question unanswerable. The record has to outlive its window.
    originReturns('{"matches":[]}', "application/json");
    await edge(`/__livescore?sport=football&date=${TODAY}`, ENV_WITH_KV);

    expect(kvTtlOf("livescore-football")).toBeGreaterThan(120);

    // Age the record past its 120s window but inside its retention, with this
    // colo's copy evicted (the shape that used to read as "never stored"). The
    // probe must report a stale copy, not a missing one.
    stored.clear();
    kvData.set(
      snapshotKeyOf("livescore-football"),
      JSON.stringify({
        storedAt: Date.now() - 200_000,
        status: 200,
        contentType: "application/json",
        body: '{"matches":[]}',
      })
    );

    const body = (await (await edge("/__edge", ENV_WITH_KV)).json()) as {
      snapshots: { id: string; ageSeconds: number | null; fresh: boolean }[];
    };
    const football = body.snapshots.find((s) => s.id === "livescore-football");
    expect(football?.ageSeconds, "a cold copy still reports an age").not.toBeNull();
    expect(football?.fresh).toBe(false);
  });

  it("reports the binding on the liveness probe, and its absence too", async () => {    const withKv = (await (await edge("/__edge", ENV_WITH_KV)).json()) as { storage: { kv: boolean } };
    const withoutKv = (await (await edge("/__edge", { ...ENV })).json()) as { storage: { kv: boolean } };
    expect(withKv.storage.kv).toBe(true);
    expect(withoutKv.storage.kv).toBe(false);
  });

  it("records a tick where the next reader can see it, not only where it ran", async () => {
    originReturns('{"matches":[]}', "application/json");
    await worker.scheduled({ cron: "*/5 * * * *" } as never, ENV_WITH_KV);
    await settleBackground();

    // A different colo: the local cache knows nothing about the tick.
    stored.clear();
    const body = (await (await edge("/__edge", ENV_WITH_KV)).json()) as {
      lastTick: { cron: string } | null;
    };
    expect(body.lastTick?.cron).toBe("*/5 * * * *");
  });
});
