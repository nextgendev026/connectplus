import { describe, expect, it, vi } from "vitest";

/**
 * Retrieval.
 *
 * Three behaviours carry the weight, and each is a way an answer goes wrong:
 *
 *   1. A memory the model generated itself must not outrank a live platform
 *      reading of the same subject.
 *   2. Two memories that disagree must not both be presented as current truth —
 *      one represents the group, and the disagreement is *recorded* rather than
 *      silently resolved.
 *   3. Material the reader must not see must never be returned, however relevant
 *      it is.
 *
 * The last of those is tested adversarially: the withheld material is the
 * *highest-scoring* candidate, so a passing result cannot be an accident of
 * ranking.
 */

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const { retrieveMemories, scoreCandidate, queryTerms, freshness, formatMemoriesForPrompt, DEFAULT_MAX_CHARS } =
  await import("@/lib/retrieval");

const NOW = new Date("2026-09-21T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function candidate(overrides: Record<string, unknown> & { id: string }) {
  return {
    // The id is part of the default body so that two candidates are not
    // accidental duplicates. The duplicate-collapsing test then has to opt in
    // explicitly, which is what makes it a test of deduplication rather than of
    // the fixture.
    content: `Kenyan football league standings (${overrides.id})`,
    source: "platform",
    sourceType: "platform",
    verificationStatus: "observed",
    sensitivity: "public",
    scope: "platform",
    createdAt: NOW,
    accessCount: 0,
    ...overrides,
  } as Parameters<typeof retrieveMemories>[0][number];
}

describe("queryTerms", () => {
  it("drops stopwords and short words that would match everything", () => {
    // Including them dilutes the term fraction so a memory matching "the" looks
    // as relevant as one matching the subject.
    expect(queryTerms("what is the rate for the Kenyan shilling")).toEqual(["rate", "kenyan", "shilling"]);
  });

  it("de-duplicates repeated terms", () => {
    expect(queryTerms("football football football")).toEqual(["football"]);
  });

  it("returns nothing for a query with no scorable content", () => {
    expect(queryTerms("the and of")).toEqual([]);
  });
});

describe("freshness", () => {
  it("decays with age but never reaches zero", () => {
    const recent = freshness(candidate({ id: "a", createdAt: NOW, lastAccessedAt: NOW }), NOW);
    const old = freshness(candidate({ id: "b", createdAt: new Date(NOW.getTime() - 400 * DAY) }), NOW);
    expect(recent).toBeGreaterThan(old);
    expect(old).toBeGreaterThan(0.3);
  });

  it("measures from last use, not creation, so a well-used old memory is not punished", () => {
    const oldButCurrent = freshness(
      candidate({ id: "a", createdAt: new Date(NOW.getTime() - 900 * DAY), lastAccessedAt: NOW }),
      NOW
    );
    expect(oldButCurrent).toBeGreaterThan(0.95);
  });
});

describe("scoreCandidate", () => {
  const terms = queryTerms("Kenyan football league standings");

  it("prefers a platform reading to a model statement on the same subject", () => {
    // The single most important ordering in the module: a model asserting
    // something is not evidence for it, however fluent the sentence.
    const platform = scoreCandidate(candidate({ id: "p", sourceType: "platform" }), terms, NOW);
    const model = scoreCandidate(candidate({ id: "m", sourceType: "model", source: "model" }), terms, NOW);
    expect(platform.score).toBeGreaterThan(model.score);
  });

  it("prefers confirmed material to unverified material on the same origin", () => {
    const confirmed = scoreCandidate(candidate({ id: "a", verificationStatus: "corroborated" }), terms, NOW);
    const unverified = scoreCandidate(candidate({ id: "b", verificationStatus: "unverified" }), terms, NOW);
    expect(confirmed.score).toBeGreaterThan(unverified.score);
  });

  it("scores a rejected memory below every citable state", () => {
    const rejected = scoreCandidate(candidate({ id: "r", verificationStatus: "rejected" }), terms, NOW);
    for (const state of ["operator_confirmed", "corroborated", "observed", "unverified"]) {
      expect(scoreCandidate(candidate({ id: state, verificationStatus: state }), terms, NOW).score).toBeGreaterThan(
        rejected.score
      );
    }
  });

  it("cannot let a strong term match rescue a rejected memory", () => {
    // Multiplicative scoring, so relevance and trust both have to hold. A
    // rejected memory that matches every term must still lose to a confirmed one
    // that matches few.
    const rejectedPerfect = scoreCandidate(
      candidate({ id: "r", verificationStatus: "rejected", sourceType: "platform" }),
      queryTerms("Kenyan football league standings"),
      NOW
    );
    const confirmedOffTopic = scoreCandidate(
      candidate({ id: "c", verificationStatus: "operator_confirmed", content: "football" }),
      queryTerms("Kenyan football league standings"),
      NOW
    );
    expect(confirmedOffTopic.score).toBeGreaterThan(rejectedPerfect.score);
  });

  it("reports the grounds for its decision", () => {
    const scored = scoreCandidate(candidate({ id: "a" }), terms, NOW);
    expect(scored.reasons.join(" | ")).toContain("matched");
    expect(scored.reasons.join(" | ")).toContain("verification: observed");
    expect(scored.reasons.join(" | ")).toContain("origin: platform");
  });

  it("says an expired memory must be cited as historical", () => {
    const scored = scoreCandidate(
      candidate({ id: "a", verificationStatus: "observed", expiresAt: new Date(NOW.getTime() - 3 * DAY) }),
      terms,
      NOW
    );
    expect(scored.verification).toBe("expired");
    expect(scored.assertable).toBe(false);
    expect(scored.reasons.join(" | ")).toContain("cite as historical");
  });
});

describe("retrieveMemories — visibility", () => {
  it("never returns material a public reader must not see, however relevant", () => {
    // Adversarial: the withheld candidate scores highest on every other axis, so
    // a pass cannot be an accident of ranking.
    const result = retrieveMemories(
      [
        candidate({ id: "visible", content: "Kenyan football league standings", scope: "platform" }),
        candidate({
          id: "operator-only",
          content: "Kenyan football league standings, internal notes",
          sensitivity: "sensitive",
          sourceType: "platform",
          verificationStatus: "operator_confirmed",
          accessCount: 50,
          lastAccessedAt: NOW,
        }),
      ],
      { query: "Kenyan football league standings", audience: "public", now: NOW }
    );

    expect(result.memories.map((m) => m.id)).toEqual(["visible"]);
    const excluded = result.excluded.find((e) => e.id === "operator-only");
    expect(excluded?.reason).toContain("sensitive");
  });

  it("withholds a region-scoped memory from the public feed", () => {
    const result = retrieveMemories(
      [candidate({ id: "regional", scope: "region:nairobi", sensitivity: "public" })],
      { query: "standings", audience: "public", now: NOW }
    );
    expect(result.memories).toHaveLength(0);
    expect(result.excluded[0]?.reason).toContain("region:nairobi");
  });

  it("shows the operator console everything the public cannot see", () => {
    const result = retrieveMemories(
      [candidate({ id: "sensitive", sensitivity: "sensitive", scope: "tenant-a" })],
      { query: "standings", audience: "operator", now: NOW }
    );
    expect(result.memories).toHaveLength(1);
  });

  it("defaults to the operator audience, so nothing widens by omission", () => {
    // A public surface added later must ask the question explicitly; the default
    // must not silently change what existing callers receive.
    const result = retrieveMemories([candidate({ id: "internal", sensitivity: "internal" })], {
      query: "standings",
      now: NOW,
    });
    expect(result.memories).toHaveLength(1);
  });
});

describe("retrieveMemories — exclusion", () => {
  it("excludes expired material by default and says why", () => {
    const result = retrieveMemories(
      [candidate({ id: "stale", verificationStatus: "observed", expiresAt: new Date(NOW.getTime() - DAY) })],
      { query: "standings", now: NOW }
    );
    expect(result.memories).toHaveLength(0);
    expect(result.excluded[0]?.reason).toContain("expired");
  });

  it("can be asked for expired material, and then marks it heavily", () => {
    const result = retrieveMemories(
      [
        candidate({ id: "stale", verificationStatus: "observed", expiresAt: new Date(NOW.getTime() - DAY) }),
        candidate({ id: "fresh" }),
      ],
      { query: "standings", now: NOW, includeExpired: true }
    );
    expect(result.memories.map((m) => m.id)).toContain("stale");
    expect(result.memories.find((m) => m.id === "stale")?.assertable).toBe(false);
  });

  it("excludes a rejected memory even when expired material was requested", () => {
    // A disbelieved claim must not become citable again because a caller asked
    // for something else.
    const result = retrieveMemories([candidate({ id: "r", verificationStatus: "rejected" })], {
      query: "standings",
      now: NOW,
      includeExpired: true,
    });
    expect(result.memories).toHaveLength(0);
    expect(result.excluded[0]?.reason).toContain("rejected");
  });

  it("collapses a duplicate so the budget is not spent twice on one fact", () => {
    const result = retrieveMemories(
      [
        candidate({ id: "first", accessCount: 10, content: "Kenyan football league standings" }),
        candidate({ id: "dupe", accessCount: 1, content: "Kenyan football league standings" }),
      ],
      { query: "standings", now: NOW }
    );
    expect(result.memories).toHaveLength(1);
    expect(result.excluded.some((e) => e.id === "dupe" && e.reason.includes("duplicate"))).toBe(true);
  });
});

describe("retrieveMemories — contradictions", () => {
  it("returns one member of a contradiction group and records the disagreement", () => {
    // The brief's rule: conflicting memories must not both be presented as
    // current truth. The conflict is *recorded*, not silently resolved — an
    // operator should be able to see the hive holds two claims.
    const result = retrieveMemories(
      [
        candidate({ id: "claim-a", contradictionGroup: "usd-kes-rate", accessCount: 20, content: "USD to KES rate is 129" }),
        candidate({ id: "claim-b", contradictionGroup: "usd-kes-rate", accessCount: 1, content: "USD to KES rate is 131" }),
      ],
      { query: "USD to KES rate", now: NOW }
    );

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]?.id).toBe("claim-a");
    expect(result.contradictionsSurfaced).toEqual([{ kept: "claim-a", dropped: "claim-b" }]);
    expect(result.notes.join(" ")).toContain("conflicting claims");
  });

  it("tells the model, in the memory's own reasons, that it represents a disputed fact", () => {
    const result = retrieveMemories([candidate({ id: "claim", contradictionGroup: "g1" })], {
      query: "standings",
      now: NOW,
    });
    expect(result.memories[0]?.reasons.join(" | ")).toContain("another memory in this hive disagrees");
  });

  it("lets two unrelated groups both through", () => {
    const result = retrieveMemories(
      [
        candidate({ id: "a", contradictionGroup: "g1", content: "USD to KES rate is 129" }),
        candidate({ id: "b", contradictionGroup: "g2", content: "GBP to KES rate is 165" }),
      ],
      { query: "rate", now: NOW }
    );
    expect(result.memories).toHaveLength(2);
    expect(result.contradictionsSurfaced).toHaveLength(0);
  });

  it("applies the group rule before the budget, so a lost member never costs context", () => {
    const result = retrieveMemories(
      [
        candidate({ id: "a", contradictionGroup: "g", accessCount: 5 }),
        candidate({ id: "b", contradictionGroup: "g", accessCount: 1 }),
        candidate({ id: "c", accessCount: 3 }),
      ],
      { query: "standings", now: NOW, limit: 2 }
    );
    // "a" wins its group and "c" outranks the loser "b"; with the limit at 2,
    // the withheld member must not have occupied a slot.
    expect(result.memories.map((m) => m.id)).toEqual(["a", "c"]);
    expect(result.contradictionsSurfaced).toEqual([{ kept: "a", dropped: "b" }]);
  });
});

describe("retrieveMemories — budget", () => {
  it("caps how much material reaches the prompt", () => {
    const result = retrieveMemories(
      [
        candidate({ id: "big", content: "x".repeat(500) }),
        candidate({ id: "b", content: "y".repeat(500) }),
        candidate({ id: "c", content: "z".repeat(500) }),
      ],
      { query: "standings", now: NOW, maxChars: 1_100 }
    );
    expect(result.budgetLimited).toBe(true);
    expect(result.memories.length).toBeLessThan(3);
  });

  it("always returns at least one memory, even if it exceeds the budget alone", () => {
    // An answer grounded in one long memory is better than an answer grounded in
    // nothing because every candidate was individually too large.
    const result = retrieveMemories([candidate({ id: "huge", content: "x".repeat(DEFAULT_MAX_CHARS * 2) })], {
      query: "standings",
      now: NOW,
      maxChars: 500,
    });
    expect(result.memories).toHaveLength(1);
  });

  it("respects the limit", () => {
    const result = retrieveMemories(
      Array.from({ length: 12 }, (_, i) => candidate({ id: `m${i}` })),
      { query: "standings", now: NOW, limit: 3 }
    );
    expect(result.memories).toHaveLength(3);
  });
});

describe("retrieveMemories — the provenance line", () => {
  it("tells the model it must qualify when nothing retrieved is confirmed", () => {
    const result = retrieveMemories([candidate({ id: "u", verificationStatus: "unverified" })], {
      query: "standings",
      now: NOW,
    });
    expect(result.summary.mustQualify).toBe(true);
    expect(result.notes.join(" ")).toContain("unverified");
  });

  it("does not demand qualification when something is confirmed", () => {
    const result = retrieveMemories(
      [candidate({ id: "c", verificationStatus: "corroborated" }), candidate({ id: "u", verificationStatus: "unverified", content: "other" })],
      { query: "standings", now: NOW }
    );
    expect(result.summary.mustQualify).toBe(false);
  });

  it("states plainly when nothing was retrieved", () => {
    const result = retrieveMemories([], { query: "standings", now: NOW });
    expect(result.summary.line).toContain("No stored memories");
  });
});

describe("formatMemoriesForPrompt", () => {
  it("labels each memory individually, so the model does not have to infer which is which", () => {
    const result = retrieveMemories(
      [
        candidate({ id: "a", verificationStatus: "corroborated", content: "Confirmed fact" }),
        candidate({ id: "b", verificationStatus: "unverified", content: "Unconfirmed claim", content2: undefined } as never),
      ],
      { query: "standings", now: NOW }
    );
    const block = formatMemoriesForPrompt(result.memories, NOW);
    expect(block).toContain("CONFIRMED");
    expect(block).toContain("UNCONFIRMED");
  });

  it("marks expired material as expired rather than unconfirmed", () => {
    const block = formatMemoriesForPrompt(
      [
        {
          id: "a",
          content: "Old rate",
          verificationStatus: "observed",
          expiresAt: new Date(NOW.getTime() - DAY),
          assertable: false,
          score: 0,
          reasons: [],
          verification: "expired",
        } as never,
      ],
      NOW
    );
    expect(block).toContain("EXPIRED");
  });

  it("returns an empty string when there is nothing, so a caller can skip the block", () => {
    expect(formatMemoriesForPrompt([], NOW)).toBe("");
  });

  it("includes the source URL so a claim can be traced", () => {
    const result = retrieveMemories([candidate({ id: "a", sourceUrl: "https://example.com/story" })], {
      query: "standings",
      now: NOW,
    });
    expect(formatMemoriesForPrompt(result.memories, NOW)).toContain("https://example.com/story");
  });
});
