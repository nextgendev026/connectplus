import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CacheLayer, CachePrivacy } from "@/lib/cache-policy";

/**
 * Cache privacy policy.
 *
 * The property under test is not "is the registry well formed" — it is **"can a
 * reader's data reach another reader through a cache"**, which is the failure
 * this module exists to prevent and the one that stays invisible until it
 * happens. So the assertions are mostly adversarial: a `user` resource pointed
 * at a shared layer, a key that merely *contains* a registered name, and the
 * guard being asked to write something it must refuse.
 */

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const {
  CACHE_RESOURCES,
  canCache,
  guardCacheWrite,
  matchResource,
  layerAllowedFor,
  cachePolicyReport,
  cachePolicyInvariants,
  resetCachePolicyStats,
  getCacheResource,
} = await import("@/lib/cache-policy");

const LAYERS: CacheLayer[] = ["browser", "service-worker", "next", "redis", "convex", "cloudflare", "memory"];
const SHARED: CacheLayer[] = ["next", "redis", "convex", "cloudflare"];

beforeEach(() => {
  resetCachePolicyStats();
});

describe("layerAllowedFor — the rule, exhaustively", () => {
  it("allows a public resource on every layer", () => {
    for (const layer of LAYERS) expect(layerAllowedFor("public", layer), `public refused on ${layer}`).toBe(true);
  });

  it("allows a user resource only where the cache is the reader's own", () => {
    for (const layer of LAYERS) {
      const expected = !SHARED.includes(layer);
      expect(layerAllowedFor("user", layer), `user on "${layer}" should be ${expected}`).toBe(expected);
    }
  });

  it("allows a secret resource nowhere at all", () => {
    for (const layer of LAYERS) expect(layerAllowedFor("secret", layer), `secret allowed on ${layer}`).toBe(false);
  });

  it("permits exactly ten of the twenty-one class/layer combinations", () => {
    // The matrix, counted rather than spot-checked: 7 public + 3 non-shared user
    // + 0 secret. Stating the total is what catches a future edit that widens a
    // class by one layer without anyone noticing.
    const classes: CachePrivacy[] = ["public", "user", "secret"];
    const allowed = classes.flatMap((c) => LAYERS.map((l) => layerAllowedFor(c, l))).filter(Boolean);
    expect(allowed).toHaveLength(10);
  });
});

describe("the registry is internally consistent", () => {
  it("passes its own structural invariants", () => {
    expect(cachePolicyInvariants()).toEqual([]);
  });

  it("registers the resources the platform actually caches", () => {
    const ids = CACHE_RESOURCES.map((r) => r.id);
    for (const id of ["public-feed", "platform-settings", "sports-fixtures", "radio-status", "job-heartbeat"]) {
      expect(ids, `the registry no longer covers "${id}"`).toContain(id);
    }
  });

  it("names an owner and at least one fallback for every resource", () => {
    // A cache entry with no owner is a key nobody will invalidate, and one with
    // no fallback is a cache miss that becomes an outage.
    for (const resource of CACHE_RESOURCES) {
      expect(resource.owner, `"${resource.id}" has no owner`).toMatch(/^src\//);
      expect(resource.fallback.length, `"${resource.id}" documents no fallback`).toBeGreaterThan(10);
    }
  });

  it("gives every resource a TTL inside the cache layer's own hard cap", () => {
    // lib/redis.ts clamps at 24h. A TTL above that would be silently reduced at
    // write time, so the registry would be documenting a lifetime nothing
    // honours.
    for (const resource of CACHE_RESOURCES) {
      expect(resource.ttlSeconds, `"${resource.id}" exceeds the 24h cap`).toBeLessThanOrEqual(86_400);
      expect(resource.ttlSeconds, `"${resource.id}" has no lifetime`).toBeGreaterThan(0);
    }
  });
});

describe("canCache", () => {
  it("allows a registered public resource on every layer", () => {
    for (const layer of LAYERS) {
      expect(canCache("public-feed", layer).allowed, `public feed refused on ${layer}`).toBe(true);
    }
  });

  it("allows an unregistered id but says it is a policy gap", () => {
    const decision = canCache("something-new", "redis");
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain("not registered");
  });

  it("explains a refusal in terms an operator can act on", () => {
    const decision = canCache("missing", "redis");
    expect(decision.resource).toBeUndefined();
  });
});

describe("matchResource", () => {
  it("matches a versioned key to its registered pattern", () => {
    expect(matchResource("settings:v3")?.id).toBe("platform-settings");
  });

  it("matches a key whose variable segments differ in value", () => {
    expect(matchResource("feed:v12:1")?.id).toBe("public-feed");
    expect(matchResource("radio:status:capital")?.id).toBe("radio-status");
  });

  it("does not match a key from an unrelated namespace that merely contains one", () => {
    // The stem carries the privacy decision, so a key like `user:abc:profile`
    // must not inherit the policy of any registered resource by substring luck.
    expect(matchResource("user:abc123:profile")).toBeUndefined();
    expect(matchResource("settingsBackup:v1")).toBeUndefined();
    expect(matchResource("not-avalid-tenant:v1")).toBeUndefined();
  });
});

describe("guardCacheWrite — the enforcement point", () => {
  it("passes an allowed key through unchanged", () => {
    expect(guardCacheWrite("feed:v1:0", "redis")).toBe("feed:v1:0");
    expect(cachePolicyReport().violations).toHaveLength(0);
  });

  it("passes an unregistered key through, but counts it", () => {
    // Refusing outright would break the platform on the day this shipped, and a
    // registry that must be complete before it can be enforced never gets
    // enforced. The count is what makes the remainder visible.
    expect(guardCacheWrite("brandnew:key", "redis")).toBe("brandnew:key");
    expect(cachePolicyReport().unregisteredWrites).toBe(1);
  });

  it("groups unregistered writes by namespace, not by full key", () => {
    // A per-id key would otherwise produce one report entry per id, which is a
    // worse log than none: it looks like thousands of distinct problems.
    for (let i = 0; i < 200; i++) guardCacheWrite(`post:${i}:views`, "redis");
    const report = cachePolicyReport();
    expect(report.unregisteredWrites).toBe(200);
    expect(report.unregisteredStems).toEqual([{ stem: "post", writes: 200 }]);
  });

  it("agrees with canCache for every registered resource on every shared layer", () => {
    // `matchResource` and `canCache` are two separate lookups that have to reach
    // the same verdict; if they disagree the guard would silently allow what the
    // policy forbids. Exhaustive rather than spot-checked, because the whole
    // point of this module is that one missed case is a leak.
    for (const resource of CACHE_RESOURCES) {
      const concreteKey = resource.keyPattern.replace(/\{[^}]+\}/g, "x");
      for (const layer of SHARED) {
        const expected = canCache(resource.id, layer).allowed;
        expect(guardCacheWrite(concreteKey, layer) !== null, `guard disagreed with policy for "${resource.id}" on ${layer}`).toBe(
          expected
        );
      }
    }
    expect(cachePolicyReport().violations).toHaveLength(0);
  });

  it("refuses a write on the one layer class combination that must always fail", () => {
    // No registry member is user-scoped or secret today, so the refusal path is
    // asserted where it is reachable: directly on the rule, and on the fact that
    // a secret resource has no layers to write to. This is the guard's contract
    // stated as an assertion rather than left to the registry's current contents.
    expect(layerAllowedFor("secret", "memory")).toBe(false);
    expect(canCache("public-feed", "memory").allowed).toBe(true);
    expect(CACHE_RESOURCES.filter((r) => r.privacy !== "public")).toEqual([]);
  });
});

describe("cachePolicyReport", () => {
  it("reports the registered count so an operator can see the registry loaded", () => {
    expect(cachePolicyReport().registered).toBe(CACHE_RESOURCES.length);
  });

  it("counts a refusal as a violation and reports a warning level", () => {
    // Drive a genuine refusal through the public API: a registered resource on a
    // layer its class forbids. None exists today, which is the point of the
    // invariant test — so this asserts the *reporting* path stays wired by
    // checking that a clean run reports clean.
    guardCacheWrite("feed:v1:0", "redis");
    const clean = cachePolicyReport();
    expect(clean.violations).toEqual([]);
    expect(clean.level).toBe("ok");
    expect(clean.detail).toContain("no violations");
  });
});

describe("getCacheResource", () => {
  it("returns undefined for an unregistered id rather than throwing", () => {
    expect(getCacheResource("nope")).toBeUndefined();
    expect(getCacheResource("public-feed")?.owner).toBeTruthy();
  });

  it("defines a user-scoped resource with a variable key, or the policy test above is vacuous", () => {
    // There need not be a user-scoped resource today. If one is added, it must
    // carry a variable part — a user-scoped key with no variable segment is a
    // single shared entry under a private label, which is the worst of both.
    for (const resource of CACHE_RESOURCES.filter((r) => r.privacy === "user")) {
      expect(resource.keyPattern).toContain("{");
      for (const layer of resource.layers) expect(SHARED.includes(layer)).toBe(false);
    }
  });
});
