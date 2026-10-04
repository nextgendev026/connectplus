/**
 * Rate limiter for the edge middleware (`proxy.ts`).
 *
 * This module is deliberately free of `@/lib/redis`. That module imports
 * `ioredis`, which opens raw TCP sockets — something the Cloudflare Workers
 * runtime cannot do — and pulling it into the middleware's import graph makes
 * Next compile the proxy as *Node.js* middleware, which OpenNext supports only
 * experimentally (and which cannot even be bundled on Windows without a
 * symlink privilege). The middleware therefore talks to the cache tier over
 * HTTPS only: the Upstash / Vercel KV REST API when its credentials are present,
 * and a per-instance in-memory counter otherwise. The server-side cache
 * (`@/lib/redis`) keeps the full TCP + REST tier for pages and route handlers.
 *
 * Design choices, unchanged from the TCP version:
 *   • Sliding window counter (INCR + EXPIRE) rather than sorted sets: simpler,
 *     cheaper on free-tier Redis, and accurate enough for the limits we use.
 *   • One key per IP + endpoint, namespaced under `cp:rl:` so it doesn't collide
 *     with cache keys.
 *   • TTL is set on first hit, not renewed: the window starts when the first
 *     request arrives. A burst at the end of a window does not extend it.
 */

const log = {
  warn: (message: string, meta?: unknown) => {
    // Kept local so this module has no dependency on the Node-flavoured logger,
    // which is also what keeps it loadable in an edge runtime.
    console.warn(`[rate-limit] ${message}`, meta ?? "");
  },
};

export interface RateLimitResult {
  /** Whether the request should be blocked. */
  limited: boolean;
  /** Requests remaining in the current window. */
  remaining: number;
  /** Seconds until the window resets. */
  resetAfter: number;
  /** How the limit was determined (for diagnostics). */
  source: "redis" | "memory";
}

interface MemoryEntry {
  count: number;
  resetTime: number;
}

const memoryStore = new Map<string, MemoryEntry>();

// Periodic cleanup of expired in-memory entries.
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryStore.entries()) {
      if (now > entry.resetTime) memoryStore.delete(key);
    }
  }, 60_000);
  // Don't let the timer keep a Node process alive. Edge runtimes return a
  // number here, where `unref` does not exist and the check is simply skipped.
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    (cleanupTimer as { unref: () => void }).unref();
  }
}

/** The REST tier's credentials, read once per instance. */
const restUrl =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL ||
  process.env.KV_URL ||
  "";
const restToken =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  "";

function restAvailable(): boolean {
  // `CACHE_BACKEND=redis` forces the *server-side* TCP path, which the
  // middleware cannot use — it degrades to in-memory instead of pretending.
  const preference = (process.env.CACHE_BACKEND ?? "auto").trim().toLowerCase();
  if (preference === "redis" || preference === "tcp") return false;
  return Boolean(restUrl && restToken);
}

/**
 * One command against the REST tier, in pipeline form. Answers `null` for every
 * failure — a rejected token, a non-200, a thrown fetch — so a caller can tell
 * "the store answered" from "the command was sent".
 */
async function restCommand<T>(...args: (string | number)[]): Promise<T | null> {
  if (!restAvailable()) return null;
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

/**
 * Check and increment the rate limit for a key.
 *
 * @param identifier - A unique key (typically `ip:endpoint`)
 * @param limit - Maximum requests allowed in the window
 * @param windowMs - Window duration in milliseconds
 * @returns Whether the request is limited, remaining count, and reset time
 */
export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const key = `cp:rl:${identifier}`;
  const ttlSeconds = Math.ceil(windowMs / 1000);

  // Try the distributed REST tier first when it is configured.
  if (restAvailable()) {
    try {
      const count = await restCommand<number>("INCR", key);
      if (count !== null) {
        // First hit in this window — set the expiry. A TTL just misses on the
        // first INCR, so the two commands race benignly: if EXPIRE is lost the
        // key simply lives until the next window's INCR+EXPIRE resets it.
        if (count === 1) await restCommand("EXPIRE", key, ttlSeconds);
        return {
          limited: count > limit,
          remaining: Math.max(0, limit - count),
          resetAfter: ttlSeconds,
          source: "redis",
        };
      }
      log.warn("rest rate limit unavailable, falling back to memory");
    } catch (error) {
      log.warn("rest rate limit failed, falling back to memory", { error: String(error) });
    }
  }

  // In-memory fallback.
  ensureCleanup();
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || now > entry.resetTime) {
    memoryStore.set(key, { count: 1, resetTime: now + windowMs });
    return { limited: false, remaining: limit - 1, resetAfter: ttlSeconds, source: "memory" };
  }

  entry.count += 1;
  const remaining = Math.max(0, limit - entry.count);
  const resetAfter = Math.ceil((entry.resetTime - now) / 1000);
  return {
    limited: entry.count > limit,
    remaining,
    resetAfter,
    source: "memory",
  };
}
