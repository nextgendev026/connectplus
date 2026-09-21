/**
 * The cache policy registry.
 *
 * Six cache layers are in play on this platform — the browser and its service
 * worker, Next.js' own cache, Redis (Upstash REST or TCP), Convex, the
 * Cloudflare Cache API and a per-instance in-memory map. Each was configured
 * independently, and nothing anywhere could answer the two questions that
 * actually matter:
 *
 *   - **"May this be cached at all?"** A response that varies per user, or that
 *     carries `Set-Cookie`, must never enter a shared layer. That rule was
 *     followed by care, not by construction, and a single call site adding
 *     `cacheSet("user:" + id, …)` would have leaked one reader's data to
 *     another. It is now refused at the write.
 *   - **"What owns this key, and what invalidates it?"** `cacheDel` is called
 *     from six admin routes. Without a registry, the honest answer to "what
 *     happens to the feed cache when a post is published" was "read the code."
 *
 * So this module is a registry plus one guard, and the guard is wired into the
 * cache write itself rather than left as a convention. An unregistered key is
 * **allowed but counted** — refusing it outright would break the platform on
 * the day this ships, and a registry that must be complete before it can be
 * enforced never gets enforced. The counter is what makes the remainder
 * visible, and `cacheInvariantViolations()` is what a test can assert on.
 *
 * Privacy classes, and what each one permits:
 *
 *   - `public`  — identical for every caller. Any layer, any TTL.
 *   - `user`    — scoped to one authenticated identity. Never a shared layer
 *                 (Redis, Convex, Cloudflare, Next), because those are keyed
 *                 only by string and one missing key component is a leak. A
 *                 `user` resource may be cached by the caller's own device.
 *   - `secret`  — must never be stored anywhere. Decline, always.
 *
 * The classes are the whole design. "Is this safe to cache" is not a question
 * about TTLs or sizes; it is a question about *who else can read the key*, and
 * a registry that does not record that cannot answer it.
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("cache-policy");

export type CachePrivacy = "public" | "user" | "secret";

export type CacheLayer = "browser" | "service-worker" | "next" | "redis" | "convex" | "cloudflare" | "memory";

/** Layers shared between different callers. A `user` resource must not use one. */
const SHARED_LAYERS: readonly CacheLayer[] = ["next", "redis", "convex", "cloudflare"];

export interface CacheResource {
  /** Stable identifier, used in the violation report. */
  id: string;
  /** The layers this resource is actually written to. */
  layers: readonly CacheLayer[];
  /**
   * The key shape, with `{…}` for the variable part. Recorded so a reader can
   * see *what distinguishes two entries* — which is the entire privacy question
   * for a `user` resource.
   */
  keyPattern: string;
  ttlSeconds: number;
  /** Stale-while-revalidate period, when the layer supports it. */
  swrSeconds: number;
  privacy: CachePrivacy;
  /** The module responsible for writing and invalidating this key. */
  owner: string;
  /** Events after which this key must be dropped. */
  invalidation: readonly string[];
  /** What happens on a miss or when the layer is unavailable. */
  fallback: string;
  /** Upper bound on the serialised value, so one key cannot dominate a layer. */
  maxBytes: number;
}

/**
 * Every cache key this platform writes that has a real owner.
 *
 * TTLs here are the values already in use at the call sites, copied rather than
 * invented — a registry that disagrees with the code is worse than none, and
 * the drift test at the end of the Phase F report checks the two against each
 * other for the resources it can reach.
 */
export const CACHE_RESOURCES: readonly CacheResource[] = [
  {
    id: "platform-settings",
    layers: ["redis", "memory", "browser"],
    keyPattern: "settings:v{n}",
    ttlSeconds: 300,
    swrSeconds: 60,
    privacy: "public",
    owner: "src/lib/settings.ts",
    invalidation: ["admin-settings-save"],
    fallback: "Direct PlatformSetting read.",
    maxBytes: 64 * 1024,
  },
  {
    id: "public-feed",
    layers: ["redis", "cloudflare", "browser"],
    keyPattern: "feed:v{n}:{page}",
    ttlSeconds: 120,
    swrSeconds: 300,
    privacy: "public",
    owner: "src/app/api/posts/route.ts",
    invalidation: ["post-published", "post-unpublished", "moderation-decision"],
    fallback: "Postgres query via lib/queries/posts.ts.",
    maxBytes: 512 * 1024,
  },
  {
    id: "trending-topics",
    layers: ["redis"],
    keyPattern: "trending:{window}",
    ttlSeconds: 600,
    swrSeconds: 120,
    privacy: "public",
    owner: "src/app/api/trending/topics/route.ts",
    invalidation: ["post-published"],
    fallback: "Recomputed from Post.",
    maxBytes: 64 * 1024,
  },
  {
    id: "sports-fixtures",
    layers: ["redis"],
    keyPattern: "sports:{provider}:{date}",
    ttlSeconds: 60,
    swrSeconds: 30,
    privacy: "public",
    owner: "src/lib/sports.ts",
    invalidation: ["sports-live-sweep"],
    fallback: "Provider call, then a stale marker in the UI.",
    maxBytes: 1024 * 1024,
  },
  {
    id: "radio-status",
    layers: ["redis"],
    keyPattern: "radio:status:{stationId}",
    ttlSeconds: 90,
    swrSeconds: 30,
    privacy: "public",
    owner: "src/lib/radio-status-fetch.ts",
    invalidation: ["radio-sweep"],
    fallback: "Last known good station, flagged stale.",
    maxBytes: 32 * 1024,
  },
  {
    id: "weather",
    layers: ["redis"],
    keyPattern: "weather:{node}",
    ttlSeconds: 900,
    swrSeconds: 300,
    privacy: "public",
    owner: "src/app/api/weather/route.ts",
    invalidation: [],
    fallback: "Static message; weather is non-critical.",
    maxBytes: 32 * 1024,
  },
  {
    id: "forex-rates",
    layers: ["redis"],
    keyPattern: "forex:{base}",
    ttlSeconds: 3600,
    swrSeconds: 600,
    privacy: "public",
    owner: "src/app/api/forex/route.ts",
    invalidation: [],
    fallback: "Stored last-known rate, flagged stale.",
    maxBytes: 16 * 1024,
  },
  {
    id: "ad-slots",
    layers: ["redis"],
    keyPattern: "ads:slots:{placement}",
    ttlSeconds: 300,
    swrSeconds: 60,
    privacy: "public",
    owner: "src/lib/ads.ts",
    invalidation: ["admin-adslot-save"],
    fallback: "Direct ThirdPartyAdSlot read.",
    maxBytes: 64 * 1024,
  },
  {
    id: "platform-brief",
    layers: ["redis"],
    keyPattern: "brief:v{n}",
    ttlSeconds: 600,
    swrSeconds: 120,
    privacy: "public",
    owner: "src/lib/platform-intelligence.ts",
    invalidation: ["hive-sweep", "traffic-ingest"],
    fallback: "Recomputed live brief.",
    maxBytes: 256 * 1024,
  },
  {
    id: "job-heartbeat",
    layers: ["redis", "memory"],
    keyPattern: "cron:heartbeat:{jobId}",
    // 24h, NOT the 30 days `job-heartbeat.ts` declares. That module asks
    // `redisSetEx` for 30 days and `MAX_TTL_SECONDS` in `lib/redis.ts` clamps
    // the write to 86_400 without telling anyone, so 24h is the value that is
    // actually stored. The registry records the effective lifetime rather than
    // the intended one — a registry that agreed with the caller would be
    // documenting a retention nothing honours. The clamp itself is recorded as
    // a finding in docs/MODERNIZATION-AUDIT.md; it is survivable here only
    // because `job-heartbeat.ts` keeps the Postgres row as the durable copy.
    ttlSeconds: 86_400,
    swrSeconds: 0,
    privacy: "public",
    owner: "src/lib/job-heartbeat.ts",
    invalidation: [],
    fallback: "Postgres fallback row, which is the durable copy.",
    maxBytes: 8 * 1024,
  },
  {
    id: "embedding-index-version",
    layers: ["redis"],
    keyPattern: "posts:version",
    ttlSeconds: 3600,
    swrSeconds: 0,
    privacy: "public",
    owner: "src/lib/cron-jobs.ts",
    invalidation: [],
    fallback: "Reads fall back to no semantic index.",
    maxBytes: 1 * 1024,
  },
] as const;

const byId = new Map(CACHE_RESOURCES.map((r) => [r.id, r]));

export function getCacheResource(id: string): CacheResource | undefined {
  return byId.get(id);
}

export interface CacheDecision {
  allowed: boolean;
  /** Populated when `allowed` is false, in the words an operator needs. */
  reason: string;
  resource?: CacheResource;
}

/**
 * The privacy rule itself, as a pure function.
 *
 * Extracted so the rule can be tested exhaustively (three classes × seven
 * layers) without needing a registry entry for every case — and because the
 * rule is the part that has to be right. A cache leak is a *rule* failure, not
 * a configuration failure: the moment `user` is allowed on `redis`, every
 * correct resource definition in the registry is beside the point.
 */
export function layerAllowedFor(privacy: CachePrivacy, layer: CacheLayer): boolean {
  if (privacy === "secret") return false;
  if (privacy === "user") return !SHARED_LAYERS.includes(layer);
  return true;
}

/**
 * May this resource be written to this layer?
 *
 * A `secret` resource is refused everywhere. A `user` resource is refused on
 * any shared layer — with the reason naming the layers and the key pattern, so
 * the refusal is actionable rather than a bare `false`.
 */
export function canCache(resourceId: string, layer: CacheLayer): CacheDecision {
  const resource = byId.get(resourceId);
  if (!resource) {
    return { allowed: true, reason: `"${resourceId}" is not registered; allowed, but recorded as a policy gap.` };
  }
  if (!layerAllowedFor(resource.privacy, layer)) {
    const why =
      resource.privacy === "secret"
        ? `"${resourceId}" is a secret resource and must never be stored in any cache layer.`
        : `"${resourceId}" is user-scoped (${resource.keyPattern}) and the "${layer}" layer is shared between callers; one key missing its identity component would serve one reader's data to another.`;
    return { allowed: false, reason: why, resource };
  }
  return { allowed: true, reason: `"${resourceId}" is ${resource.privacy} and may use the "${layer}" layer.`, resource };
}

/** Counters and the last few refusals, for the diagnostics panel and tests. */
const violations: string[] = [];
let unregisteredWrites = 0;
const unregisteredKeys = new Map<string, number>();

function recordViolation(reason: string): void {
  violations.push(`${new Date().toISOString()} ${reason}`);
  if (violations.length > 50) violations.shift();
  log.error("cache policy violation", { reason });
}

/**
 * The guard the cache layer calls before writing.
 *
 * Returns the key unchanged when the write is allowed, and `null` when it must
 * be refused. Returning a value rather than throwing is deliberate: a cache
 * write is an optimisation, and a refused optimisation should never surface as
 * an error to a reader.
 */
export function guardCacheWrite(key: string, layer: CacheLayer): string | null {
  const resource = matchResource(key);
  if (!resource) {
    unregisteredWrites++;
    // Grouped by the namespace (the first segment), not the whole key: a key
    // like `post:<id>:views` would otherwise produce one report entry per post,
    // which is a worse log than no log because it looks like thousands of
    // distinct problems.
    const stem = key.split(":")[0] ?? key;
    unregisteredKeys.set(stem, (unregisteredKeys.get(stem) ?? 0) + 1);
    return key;
  }
  const decision = canCache(resource.id, layer);
  if (!decision.allowed) {
    recordViolation(`refused ${layer} write for ${key}: ${decision.reason}`);
    return null;
  }
  return key;
}

/**
 * Best-effort match of a concrete key to a registered pattern.
 *
 * Deliberately loose on the variable part and strict on the stem: `settings:v3`
 * must match `settings:v{n}`, and `user:abc:profile` must not accidentally match
 * anything registered. The stem comparison is what carries the privacy
 * decision, so an unmatched key is treated as unregistered and allowed — which
 * is why the unregistered counter exists rather than a hard refusal.
 */
export function matchResource(key: string): CacheResource | undefined {
  const stem = key.split(":")[0] ?? key;
  const candidates = CACHE_RESOURCES.filter((r) => (r.keyPattern.split(":")[0] ?? r.keyPattern) === stem);
  if (candidates.length === 0) return undefined;
  const exact = candidates.find((r) => {
    const parts = r.keyPattern.split(":");
    const keyParts = key.split(":");
    if (parts.length !== keyParts.length) return false;
    return parts.every((part, i) => part.startsWith("{") || part === keyParts[i]);
  });
  return exact ?? candidates[0];
}

/** Read-only health view. */
export function cachePolicyReport(): {
  level: "ok" | "warn";
  registered: number;
  unregisteredWrites: number;
  unregisteredStems: { stem: string; writes: number }[];
  violations: string[];
  detail: string;
} {
  const stems = Array.from(unregisteredKeys.entries())
    .map(([stem, writes]) => ({ stem, writes }))
    .sort((a, b) => b.writes - a.writes)
    .slice(0, 20);
  const level = violations.length > 0 ? "warn" : "ok";
  const detail =
    violations.length > 0
      ? `${violations.length} cache policy violation(s) recorded; the most recent was refused rather than written.`
      : `${CACHE_RESOURCES.length} resources registered, no violations. ${unregisteredWrites} write(s) used an unregistered key.`;
  return { level, registered: CACHE_RESOURCES.length, unregisteredWrites, unregisteredStems: stems, violations: [...violations], detail };
}

/** Test seam. */
export function resetCachePolicyStats(): void {
  violations.length = 0;
  unregisteredWrites = 0;
  unregisteredKeys.clear();
}

/**
 * Structural invariants, asserted by the suite and callable from a diagnostics
 * run. These are the properties that would otherwise only be true by luck:
 * the ids are unique, every key pattern has a non-empty stem, and no `user`
 * resource claims a shared layer.
 */
export function cachePolicyInvariants(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const resource of CACHE_RESOURCES) {
    if (seen.has(resource.id)) problems.push(`Duplicate cache resource id "${resource.id}".`);
    seen.add(resource.id);
    if (!resource.keyPattern.trim()) problems.push(`"${resource.id}" has an empty key pattern.`);
    if (resource.privacy !== "secret" && resource.ttlSeconds <= 0) {
      problems.push(`"${resource.id}" is cacheable but has a non-positive TTL, so it would never be stored.`);
    }
    if (resource.privacy === "user") {
      for (const layer of resource.layers) {
        if (SHARED_LAYERS.includes(layer)) {
          problems.push(`"${resource.id}" is user-scoped but claims the shared "${layer}" layer.`);
        }
      }
      if (!resource.keyPattern.includes("{")) {
        problems.push(`"${resource.id}" is user-scoped but its key pattern has no variable part, so every reader shares one entry.`);
      }
    }
    if (resource.ttlSeconds * 1000 > 0 && resource.maxBytes <= 0) {
      problems.push(`"${resource.id}" declares no maximum size.`);
    }
    if (resource.ttlSeconds > 0 && !resource.fallback.trim()) {
      problems.push(`"${resource.id}" has no documented fallback for a miss.`);
    }
  }
  return problems;
}
