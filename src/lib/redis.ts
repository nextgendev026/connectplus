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
import { guardCacheWrite } from "@/lib/cache-policy";

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

export type CacheBackend = "upstash-rest" | "redis-tcp" | "none";

/**
 * Which cache tier is actually in use, and why.
 *
 * The REST tier (Upstash / Vercel KV) is preferred when its credentials exist,
 * and that is a deliberate reversal of the obvious instinct. On serverless, a TCP
 * client means every function instance opens its own socket — a cold start pays
 * a handshake, and a traffic spike opens hundreds of connections against a
 * free-tier connection limit. The REST tier is one stateless HTTPS call with no
 * connection to exhaust, which is exactly what a 15-second livescore poll needs.
 *
 * `CACHE_BACKEND=redis` forces the TCP path (a local docker Redis, or an
 * instance that must be reused), and `CACHE_BACKEND=upstash` refuses to fall
 * back so a misconfiguration shows up as a cache miss rather than silently
 * serving from the tier you were trying to move away from.
 */
function resolveBackend(): CacheBackend {
  const rest = Boolean(restUrl && restToken);
  const tcp = Boolean(process.env.REDIS_URL);
  const preference = (process.env.CACHE_BACKEND ?? "auto").trim().toLowerCase();
  if (preference === "upstash" || preference === "rest" || preference === "kv") {
    return rest ? "upstash-rest" : "none";
  }
  if (preference === "redis" || preference === "tcp") return tcp ? "redis-tcp" : "none";
  if (rest) return "upstash-rest";
  if (tcp) return "redis-tcp";
  return "none";
}

let backendMemo: CacheBackend | null = null;

/** Memoised so the decision is read once per instance and cannot drift mid-request. */
export function activeCacheBackend(): CacheBackend {
  if (backendMemo === null) backendMemo = resolveBackend();
  return backendMemo;
}

/**
 * A one-line description of the cache tier for the admin console: which tier is
 * live, which credentials produced it, and what is missing when nothing is.
 */
export function cacheBackendDetail(): string {
  const backend = activeCacheBackend();
  const preference = (process.env.CACHE_BACKEND ?? "auto").trim().toLowerCase() || "auto";
  if (backend === "upstash-rest") {
    const source = process.env.UPSTASH_REDIS_REST_URL ? "UPSTASH_REDIS_REST_URL" : "KV_REST_API_URL";
    return `Upstash / Vercel KV REST tier active (from ${source}) — no TCP connection per function instance.`;
  }
  if (backend === "redis-tcp") {
    return preference === "auto"
      ? "TCP Redis active (REDIS_URL). Add KV_REST_API_URL + KV_REST_API_TOKEN to move the cache onto the REST tier, which does not consume a connection per serverless instance."
      : "TCP Redis active (REDIS_URL), forced by CACHE_BACKEND=redis.";
  }
  return "No cache tier configured — every render re-reads Postgres. Add KV_REST_API_URL + KV_REST_API_TOKEN (Upstash / Vercel KV) or REDIS_URL.";
}

function canUseRedis(): boolean {
  return activeCacheBackend() !== "none";
}

/**
 * Turn a Redis driver error into something an operator can act on.
 *
 * Every cache call deliberately swallows its errors — a broken cache must never
 * break a page — but that left the Integrations console only able to report
 * "Probe write/read failed", which is true and useless. The real causes are all
 * distinguishable from the server's own text, and the wrong-password case is by
 * far the most common (a rotated Redis Cloud credential, or an endpoint that
 * needs TLS).
 */
export function explainRedisError(raw: string, url: string): string {
  const message = raw.trim();
  if (/WRONGPASS|invalid username-password|invalid password/i.test(message)) {
    // Deliberately no TLS suggestion here. The server answered and rejected the
    // credential, which means the scheme already reached it — telling an operator
    // to switch to `rediss://` in this case sends them at the wrong problem, and
    // a genuinely TLS-only endpoint fails with a TLS error, not this one.
    const scheme = url.startsWith("rediss://") ? "rediss" : "redis";
    return `Credentials rejected — the endpoint answered over ${scheme}://, so the host and port are right. Re-copy the password from the provider dashboard; a rotated credential is the usual cause.`;
  }
  if (/NOAUTH|without any password/i.test(message)) {
    return "The server requires a password but REDIS_URL supplies none.";
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return "Hostname in REDIS_URL does not resolve — check for a typo or a deleted database.";
  }
  if (/ECONNREFUSED/i.test(message)) {
    return "Connection refused — check the port in REDIS_URL.";
  }
  if (/ETIMEDOUT|timed out|timeout/i.test(message)) {
    return "Timed out reaching Redis — the host may be wrong, or the database asleep.";
  }
  if (/ssl|tls|certificate/i.test(message)) {
    return `TLS problem — try rediss:// instead of redis://. (${message})`;
  }
  return message || "Connection failed with no error text.";
}

/**
 * Explain *why* Redis is unreachable, by opening a throwaway connection purely
 * to capture the server's error.
 *
 * The error arrives as an `error` event slightly before `connect()` rejects (the
 * rejection itself just says "Connection is closed"), so the message has to be
 * captured from the event listener — reading the thrown error alone loses the
 * only useful part.
 */
export async function redisProbeError(): Promise<string | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  let lastError = "";
  const probe = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 4000,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });
  probe.on("error", (error) => {
    lastError = error instanceof Error ? error.message : String(error);
  });

  try {
    await probe.connect();
    await probe.ping();
    return null;
  } catch (error) {
    const thrown = error instanceof Error ? error.message : String(error);
    return explainRedisError(lastError || thrown, url);
  } finally {
    probe.disconnect();
  }
}

function createClient(): Redis | null {
  if (!process.env.REDIS_URL || activeCacheBackend() !== "redis-tcp") return null;
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

/**
 * Retire a client whose connection was *refused* — wrong password, dead host,
 * bad port.
 *
 * Dropping the reference is not enough, and assuming it was cost real work: an
 * ioredis client whose `connect()` rejects keeps retrying in the background, so
 * simply setting `client = null` left the socket reconnecting (and re-sending a
 * credential the server had already rejected) for the lifetime of the process.
 * Measured against the live endpoint: two further failed auth attempts inside
 * 2.5s with the reference merely dropped, and none once `disconnect()` is
 * called. On serverless, where every instance does this, that is a steady drip
 * of pointless connections at the provider — exactly the kind of thing that
 * spends a free tier's connection budget.
 *
 * `disconnect()` ends the retry loop. The next process — or the next cooldown
 * window — re-probes from scratch with whatever credentials are configured then.
 */
function retire(c: Redis): void {
  client = null;
  try {
    c.disconnect();
  } catch {
    // Already closed; nothing left to stop.
  }
}

async function getClient(): Promise<Redis | null> {
  if (client === null) return null;
  // Honour the breaker here, not only inside the individual command helpers.
  // This is the single entry point every read, write, delete and increment
  // funnels through, and it used to skip the cooldown entirely — so a Redis that
  // was configured but rejecting credentials made *every* cache call on *every*
  // request pay a doomed round-trip, while the breaker sat unarmed because a
  // failed ping (unlike a failed command) never counted as a failure.
  if (Date.now() < disabledUntil) return null;
  if (client === undefined) {
    client = canUseRedis() ? createClient() : null;
    if (client) {
      const c = client;
      connecting = c
        .connect()
        .then(() => undefined)
        .catch(() => {
          retire(c);
        });
      await connecting;
      connecting = null;
    }
  }
  if (!client) return null;
  if (client.status === "ready") return client;
  try {
    await client.ping();
    recordSuccess();
    return client;
  } catch {
    // Count it. A socket that answers the handshake and then fails every command
    // is exactly the evidence the breaker exists to act on; leaving the count
    // untouched meant `disabledUntil` never armed for this case, so each cache
    // call kept paying a doomed round-trip instead of being skipped for the
    // cooldown. (A refused credential never reaches here — that is caught above,
    // and the client is retired outright.)
    if (recordFailure()) disabledUntil = Date.now() + COOLDOWN_MS;
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
  if (!restUrl || !restToken || activeCacheBackend() !== "upstash-rest") return null;
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

async function restSetEx(key: string, seconds: number, value: string): Promise<boolean> {
  // `restCommand` answers `null` for every failure — a rejected token, a non-200,
  // a thrown fetch — and a completed `SET` replies `OK`, which the pipeline
  // parser surfaces as a defined (if empty) result. So "not null" is exactly
  // "the store took it", which is what the caller needs told apart from "the
  // command was sent".
  const result = await restCommand<unknown>(`SET`, key, value, `EX`, seconds);
  return result !== null;
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

/**
 * Write a value with a TTL. Returns **true only when a store actually took it**.
 *
 * The return value is load-bearing, not decoration. This used to resolve to
 * `void` after swallowing every failure, and callers that need durability read
 * "the promise resolved" as "the write landed" — which is how the job-heartbeat
 * ledger ended up writing *nowhere* whenever Redis was configured but rejecting
 * credentials: the heartbeat stores a fallback copy in Postgres when the cache
 * declines the write, but it could never see a decline. The symptom was the
 * admin console reporting that neither store had any run history, on a platform
 * whose scheduled jobs were all firing.
 *
 * A cache read or write must still never break a page, so this still never
 * throws — it reports.
 */
export async function redisSetEx(
  key: string,
  ttlSeconds: number,
  value: string
): Promise<boolean> {
  if (Date.now() < disabledUntil) return false;

  // The privacy check runs *here*, at the one write path every caller funnels
  // through, rather than at each call site. A user-scoped or secret key is
  // refused before any layer sees it, so a future call site cannot leak one
  // reader's data into a shared cache by forgetting to call a guard.
  if (guardCacheWrite(key, "redis") === null) return false;

  const safeTtl = Math.max(1, Math.min(ttlSeconds, MAX_TTL_SECONDS));
  const fullKey = cacheKey(key);
  try {
    const c = await getClient();
    if (c) {
      await c.set(fullKey, value, "EX", safeTtl);
      recordSuccess();
      return true;
    }
    if (restUrl && restToken) {
      const ok = await restSetEx(fullKey, safeTtl, value);
      if (ok) recordSuccess();
      return ok;
    }
    // No tier accepted it. This is the case that used to look like success.
    return false;
  } catch {
    recordFailure();
    return false;
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

/**
 * Counter with an explicit TTL. Used by the visitor tracker so daily visit
 * counters live exactly as long as they are useful instead of a fixed hour.
 */
export async function cacheIncr(key: string, ttlSeconds = 3600): Promise<number> {
  const fullKey = cacheKey(key);
  const ttl = Math.min(Math.max(1, ttlSeconds), MAX_TTL_SECONDS);
  try {
    const c = await getClient();
    if (c) {
      const n = await c.incr(fullKey);
      await c.expire(fullKey, ttl);
      return n;
    }
    if (restUrl && restToken) {
      const n = await restCommand<number>("INCR", fullKey);
      if (n !== null) {
        await restCommand("EXPIRE", fullKey, ttl);
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

/**
 * Round-trip a real write/read/delete against whichever tier is live.
 *
 * The admin console needs to distinguish "credentials present" from "the cache
 * actually works" — a store that answers /version while rejecting every command
 * looks configured and caches nothing. This is the honest check, and it names
 * the tier it exercised so a green light can never be attributed to the wrong
 * backend.
 */
export async function cacheProbe(): Promise<{
  backend: CacheBackend;
  ok: boolean;
  latencyMs: number | null;
  detail: string;
}> {
  const backend = activeCacheBackend();
  if (backend === "none") {
    return { backend, ok: false, latencyMs: null, detail: cacheBackendDetail() };
  }

  const key = `${PREFIX}:probe:${Date.now()}`;
  const started = Date.now();
  try {
    if (backend === "upstash-rest") {
      const res = await fetch(`${restUrl}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${restToken}` },
        body: JSON.stringify([
          ["SET", key, "1", "EX", 60],
          ["GET", key],
          ["DEL", key],
        ]),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      const ms = Date.now() - started;
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return {
          backend,
          ok: false,
          latencyMs: ms,
          detail: `Upstash REST tier rejected the probe (HTTP ${res.status})${body ? `: ${body.slice(0, 120)}` : ""} — check KV_REST_API_URL and KV_REST_API_TOKEN.`,
        };
      }
      const rows = (await res.json()) as unknown[];
      const got = Array.isArray(rows[1]) ? rows[1][1] : null;
      const ok = got === "1";
      return {
        backend,
        ok,
        latencyMs: ms,
        detail: ok
          ? `Write, read and delete round-tripped in ${ms}ms.`
          : "Connected, but the value read back does not match what was written.",
      };
    }

    const error = await redisProbeError();
    const ms = Date.now() - started;
    return {
      backend,
      ok: !error,
      latencyMs: ms,
      detail: error ?? `PING answered in ${ms}ms.`,
    };
  } catch (err) {
    return {
      backend,
      ok: false,
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}