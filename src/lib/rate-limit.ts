/**
 * Distributed rate limiter backed by Redis, with an in-memory fallback.
 *
 * The in-memory limiter in `proxy.ts` works for a single serverless instance,
 * but with 5+ Vercel instances, the same user can hit an endpoint 500 times per
 * minute (5 instances × 100 limit). This module uses Redis's INCR + EXPIRE to
 * maintain a single counter across all instances.
 *
 * When Redis is unavailable (down, misconfigured, or not set), the limiter falls
 * back to the in-memory Map. This is a graceful degradation: a single instance's
 * rate limiting is better than no rate limiting at all.
 *
 * Design choices:
 *   • Sliding window counter (INCR + EXPIRE) rather than sorted sets: simpler,
 *     cheaper on free-tier Redis, and accurate enough for the limits we use.
 *   • One key per IP + endpoint, namespaced under `cp:rl:` so it doesn't collide
 *     with cache keys.
 *   • TTL is set on first hit, not renewed: the window starts when the first
 *     request arrives, not when the limit is checked. This is intentional — a
 *     burst at the end of a window should not extend the window.
 */

import { redisSetEx, redisIncr, activeCacheBackend } from "@/lib/redis";
import { createLogger } from "@/lib/logger";

const log = createLogger("rate-limit");

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
  // Don't let the timer keep the process alive.
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
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
  const backend = activeCacheBackend();

  // Try Redis first when available.
  if (backend !== "none") {
    try {
      const count = await redisIncr(key);
      if (count === 1) {
        // First hit in this window — set the expiry.
        await redisSetEx(key, ttlSeconds, "1");
      }
      const remaining = Math.max(0, limit - count);
      const resetAfter = ttlSeconds;
      return {
        limited: count > limit,
        remaining,
        resetAfter,
        source: "redis",
      };
    } catch (error) {
      // Redis failure: log and fall through to in-memory.
      log.warn("redis rate limit failed, falling back to memory", {
        error: String(error),
      });
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
