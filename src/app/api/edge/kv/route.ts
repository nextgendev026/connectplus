import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet, redisDel, activeCacheBackend } from "@/lib/redis";
import { createLogger } from "@/lib/logger";

/**
 * A small server-side key/value tier for the edge worker.
 *
 * Cloudflare KV is an excellent fit for the worker's durable bookkeeping and a
 * terrible fit for its *write* budget: the free plan allows 1,000 writes a day,
 * and the worker's tick ledger alone is rewritten on every trigger — roughly
 * 1,200 a day at the current cadence. The store was therefore the thing most
 * likely to quietly stop persisting, which is the failure the KV copy was added
 * to eliminate in the first place.
 *
 * The fix is distribution, not a bigger plan. The platform already pays for a
 * second store — the Upstash/Vercel-KV REST tier that every page read already
 * uses — and its free limits are counted in commands, not in "one write per
 * tick forever". High-frequency records (the tick ledger, the livescore
 * snapshot) are therefore written here, and Cloudflare KV keeps the
 * low-frequency snapshots and acts as a mirrored fallback for everything.
 *
 * Guarded by `CRON_SECRET`, the same shared secret `/api/cron` verifies, so the
 * worker is the only caller. It is deliberately not a general-purpose KV: the
 * key space is namespaced, bounded, and TTL-capped, and a value that is not
 * JSON is refused, because a public write-anything endpoint on the app domain
 * is a cache-poisoning surface.
 */

const log = createLogger("edge-kv");

/** Namespacing makes the keys self-describing in Redis and prevents collisions. */
const PREFIX = "edgekv";
const MAX_KEY_LENGTH = 200;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 60 * 60 * 24 * 7;
const MAX_VALUE_BYTES = 256 * 1024;

/** Only the characters the worker's own key builders produce. */
const KEY_PATTERN = new RegExp(`^[A-Za-z0-9:_\\-.]{1,${MAX_KEY_LENGTH}}$`);

function authorized(request: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (bearer && bearer === secret) return true;

  const query = request.nextUrl.searchParams.get("secret");
  return Boolean(query && query === secret);
}

function validKey(key: string | null): key is string {
  return Boolean(key && KEY_PATTERN.test(key));
}

/** GET /api/edge/kv?key=<key> → `{ found, value, backend }` */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const key = request.nextUrl.searchParams.get("key");
  if (!validKey(key)) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  const backend = activeCacheBackend();
  if (backend === "none") {
    // Being explicit matters: the worker distinguishes "the store has no copy"
    // (stale) from "the store is unreachable" (also stale, but for a different
    // reason), and only one of those is worth a repair ticket.
    return NextResponse.json({ found: false, value: null, backend: "none" }, { status: 200 });
  }

  const value = await cacheGet<unknown>(`${PREFIX}:${key}`).catch(() => null);
  return NextResponse.json({ found: value !== null, value, backend }, { status: 200 });
}

/** PUT /api/edge/kv  body: `{ key, value, ttl }` */
export async function PUT(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backend = activeCacheBackend();
  if (backend === "none") {
    return NextResponse.json({ ok: false, backend: "none", reason: "no cache tier configured" }, { status: 200 });
  }

  const body = await request.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key : null;
  if (!validKey(key)) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  if (body?.value === undefined) {
    return NextResponse.json({ error: "Missing value" }, { status: 400 });
  }

  const serialized = JSON.stringify(body.value);
  if (serialized.length > MAX_VALUE_BYTES) {
    return NextResponse.json({ error: "Value too large" }, { status: 413 });
  }

  const requested = Number(body?.ttl);
  const ttl = Number.isFinite(requested)
    ? Math.min(Math.max(Math.round(requested), MIN_TTL_SECONDS), MAX_TTL_SECONDS)
    : MIN_TTL_SECONDS;

  try {
    await cacheSet(`${PREFIX}:${key}`, body.value, ttl);
  } catch (error) {
    log.warn("write failed", { key, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ ok: false, backend, reason: "write failed" }, { status: 200 });
  }
  return NextResponse.json({ ok: true, backend, ttl }, { status: 200 });
}

/** DELETE /api/edge/kv?key=<key> — the purge lever for a bad record. */
export async function DELETE(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const key = request.nextUrl.searchParams.get("key");
  if (!validKey(key)) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  await redisDel(`${PREFIX}:${key}`).catch(() => {});
  return NextResponse.json({ ok: true }, { status: 200 });
}
