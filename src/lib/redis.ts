/**
 * Redis service layer.
 *
 * Supports three credential formats so any free-tier Redis provider works:
 *   1. REDIS_URL                    → ioredis (Redis Cloud / local / any TCP)
 *   2. UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN  → Upstash REST API
 *   3. KV_REST_API_URL + KV_REST_API_TOKEN                → Vercel KV (REST)
 *
 * Design goals (free-tier friendly):
 *   - Every write carries a TTL — nothing is ever stored without expiry.
 *   - Lazy connect + tiny timeouts + a circuit breaker: if Redis is slow or
 *     unreachable we stop calling it after `FAIL_THRESHOLD` errors and re-probe
 *     after a cooldown, so callers transparently fall back to direct DB reads
 *     and cache misses never block the build.
 *   - Keys are namespaced and values are JSON.
 */

import Redis from "ioredis";

const PREFIX = "cp";
const FAIL_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;
const MAX_TTL_SECONDS = 86_400; // 24h hard cap

let client: Redis | null | undefined; // undefined = not decided yet
let failures = 0;
let disabledUntil = 0;

const restUrl =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL ||
  process.env.KV_URL ||
  "";
const restToken =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  "";

function canUseRedis(): boolean {
  return Boolean(process.env.REDIS_URL || (restUrl && restToken));
}

function createClient(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  const c = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    // CRITICAL: the offline queue must stay ENABLED. With it disabled, any
    // command issued while the socket is still connecting is rejected
    // immediately ("Stream isn't writeable") — and because a request typically
    // makes two cache calls (version + payload), the SECOND one always failed
    // on a cold instance. That silently disabled the whole cache on serverless:
    // no snapshot was ever written and every render re-ran the heavy queries.
    // Bounded retries + a 3s connect timeout keep a dead Redis fast to fail.
    enableOfflineQueue: true,
    enableReadyCheck: true,
    keepAlive: 30_000,
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 1000)),
  });
  c.on("error", () => {
    /* handled by the circuit breaker; never crash the build */
  });
  return c;
}

/** Shared in-flight connect so concurrent first calls cannot race: the second
 *  caller used to issue commands mid-handshake and give up on Redis entirely. */
let connecting: Promise<void> | null = null;

async function getClient(): Promise<Redis | null> {
  if (client === null) return null;
  if (client === undefined) {
    client = canUseRedis() ? createClient() : null;
    if (client) {
      const c = client;
      connecting = c
        .connect()
        .then(() => undefined)
        .catch(() => {
          client = null;
        });
      await connecting;
      connecting = null;
    }
  }
  if (!client) return null;
  if (client.status === "ready") return client;
  try {
    await client.ping();
    return client;
  } catch {
    return null;
  }
}

function recordFailure(): boolean {
  failures++;
  if (failures >= FAIL_THRESHOLD) {
    disabledUntil = Date.now() + COOLDOWN_MS;
    failures = 0;
    return true;
  }
  return false;
}

function recordSuccess(): void {
  failures = 0;
}

/** Serialize values and keys for our namespaced JSON cache. */
function cacheKey(key: string): string {
  return `${PREFIX}:${key}`;
}

// ── REST backend (Upstash / Vercel KV) ─────────────────────────────────────

async function restCommand<T>(...args: (string | number | boolean)[]): Promise<T | null> {
  if (!restUrl || !restToken) return null;
  try {
    const res = await fetch(`${restUrl}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${restToken}` },
      body: JSON.stringify(args.map((a) => [a])),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown[];
    const first = data[0];
    if (Array.isArray(first) && first[0] === "OK") return first[1] as T;
    if (Array.isArray(first) && (first[1] as string | null) !== null) return first[1] as T;
    return null;
  } catch {
    return null;
  }
}

async function restGet(key: string): Promise<string | null> {
  return restCommand<string>(`GET`, key);
}

async function restSetEx(key: string, seconds: number, value: string): Promise<void> {
  await restCommand(`SET`, key, value, `EX`, seconds);
}

async function restDel(key: string): Promise<void> {
  await restCommand(`DEL`, key);
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function redisGetRaw(key: string): Promise<string | null> {
  const fullKey = cacheKey(key);
  try {
    const c = await getClient();
    if (c) {
      const v = await c.get(fullKey);
      recordSuccess();
      return v;
    }
    if (restUrl && restToken) {
      const v = await restGet(fullKey);
      if (v !== null) recordSuccess();
      return v;
    }
    return null;
  } catch {
    if (recordFailure()) disabledUntil = Date.now() + COOLDOWN_MS;
    return null;
  }
}

export async function redisSetEx(
  key: string,
  ttlSeconds: number,
  value: string
): Promise<void> {
  if (Date.now() < disabledUntil) return;
  const safeTtl = Math.max(1, Math.min(ttlSeconds, MAX_TTL_SECONDS));
  const fullKey = cacheKey(key);
  try {
    const c = await getClient();
    if (c) {
      await c.set(fullKey, value, "EX", safeTtl);
      recordSuccess();
      return;
    }
    if (restUrl && restToken) {
      await restSetEx(fullKey, safeTtl, value);
      recordSuccess();
    }
  } catch {
    recordFailure();
  }
}

export async function redisDel(key: string): Promise<void> {
  const fullKey = cacheKey(key);
  try {
    const c = await getClient();
    if (c) {
      await c.del(fullKey);
      return;
    }
    if (restUrl && restToken) {
      await restDel(fullKey);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Atomic increment — used to version cache namespaces (e.g. the feed cache)
 * so writes invalidate instantly with one cheap op instead of a scan/delete.
 */
export async function redisIncr(key: string): Promise<number> {
  const fullKey = cacheKey(key);
  try {
    const c = await getClient();
    if (c) {
      const n = await c.incr(fullKey);
      await c.expire(fullKey, 3600); // keep the counter itself from lingering
      return n;
    }
    if (restUrl && restToken) {
      const n = await restCommand<number>("INCR", fullKey);
      if (n !== null) {
        await restCommand("EXPIRE", fullKey, 3600);
        return n;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

/** JSON cache helpers used by hot paths (settings, feed). */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await redisGetRaw(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  await redisSetEx(key, ttlSeconds, JSON.stringify(value));
}

export function redisAvailable(): boolean {
  return canUseRedis();
}