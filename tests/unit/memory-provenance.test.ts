import { describe, expect, it, vi } from "vitest";

/**
 * Memory provenance.
 *
 * The module's job is to decide what the hive may assert. So these tests are
 * mostly about *withholding* standing: an expired memory must stop being
 * assertable the moment it expires, a rejected one must score lowest, an
 * unrecorded origin must not be promoted to `observed`, and two memories with
 * different numbers for the same subject must be recognised as disagreeing.
 */

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const {
  VERIFICATION_STATES,
  SOURCE_RELIABILITY,
  assessVolatility,
  classifySourceType,
  contentHash,
  deriveProvenance,
  describeProvenance,
  effectiveVerification,
  extractClaims,
  findContradictions,
  isAssertable,
  provenanceWeight,
  summarizeForPrompt,
  visibilityAllows,
  visibilityReason,
} = await import("@/lib/memory-provenance");

const NOW = new Date("2026-09-21T12:00:00Z");
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function memory(overrides: Record<string, unknown> = {}) {
  return {
    content: "Nairobi is the capital of Kenya",
    source: "internal",
    createdAt: NOW,
    ...overrides,
  } as Parameters<typeof effectiveVerification>[0];
}

describe("effectiveVerification", () => {
  it("defaults an unrecorded status to unverified, not to observed", () => {
    // The honest default. An unknown provenance is not evidence of having
    // observed something, and treating it as such launders every legacy row.
    expect(effectiveVerification(memory(), NOW)).toBe("unverified");
  });

  it("computes expiry at read time rather than trusting the stored status", () => {
    // A sweep can fail, be disabled, or simply not have run since the moment
    // passed. A stale fact presented as current is the failure this prevents.
    const stale = memory({
      verificationStatus: "corroborated",
      expiresAt: new Date(NOW.getTime() - 1),
    });
    expect(effectiveVerification(stale, NOW)).toBe("expired");
    expect(isAssertable(stale, NOW)).toBe(false);
  });

  it("keeps a memory assertable until the instant it expires", () => {
    const notYet = memory({ verificationStatus: "observed", expiresAt: new Date(NOW.getTime() + 1) });
    expect(effectiveVerification(notYet, NOW)).toBe("observed");
  });

  it("treats rejected as terminal, even if an expiry would have said otherwise", () => {
    // A disbelieved claim must not become citable again because time passed.
    const rejected = memory({ verificationStatus: "rejected", expiresAt: new Date(NOW.getTime() - DAY) });
    expect(effectiveVerification(rejected, NOW)).toBe("rejected");
  });

  it("refuses an unrecognised status rather than passing it through", () => {
    // A writer bug must not create a state the rest of the system cannot reason
    // about; an unknown value degrades to the lowest standing.
    expect(effectiveVerification(memory({ verificationStatus: "probably_true" }), NOW)).toBe("unverified");
  });

  it("asserts only observed, corroborated and operator-confirmed", () => {
    for (const state of VERIFICATION_STATES) {
      const m = memory({ verificationStatus: state });
      expect(isAssertable(m, NOW), `assertability of "${state}"`).toBe(
        state === "observed" || state === "corroborated" || state === "operator_confirmed"
      );
    }
  });
});

describe("classifySourceType", () => {
  it("honours a declared type over any inference", () => {
    expect(classifySourceType(memory({ sourceType: "operator", sourceUrl: "https://example.com" }))).toBe("operator");
  });

  it("infers external from a source URL when nothing was declared", () => {
    expect(classifySourceType(memory({ sourceUrl: "https://example.com/a" }))).toBe("external");
    expect(classifySourceType(memory({ source: "external" }))).toBe("external");
  });

  it("falls back to internal rather than external when it must guess", () => {
    // The asymmetry is deliberate: misfiling our own data as untrustworthy
    // suppresses it, while misfiling external data as internal promotes it.
    expect(classifySourceType(memory({ source: "something-new" }))).toBe("internal");
  });

  it("returns a recognised type for every path, never an arbitrary string", () => {
    for (const source of ["platform", "hive", "operator", "admin", "model", "llm", "generated", "external", "?"]) {
      expect(["platform", "internal", "external", "model", "operator"]).toContain(classifySourceType(memory({ source })));
    }
  });
});

describe("assessVolatility", () => {
  it("detects a match result and gives it hours, not days", () => {
    const result = assessVolatility("Gor Mahia 2 - 1 AFC Leopards, full-time");
    expect(result.volatile).toBe(true);
    expect(result.ttlMs).toBeLessThanOrEqual(6 * HOUR);
  });

  it("detects an exchange rate", () => {
    expect(assessVolatility("USD to KES is 129.40 today").volatile).toBe(true);
  });

  it("detects a platform count", () => {
    expect(assessVolatility("The platform has 12,400 users").volatile).toBe(true);
  });

  it("picks the shortest matching window when several patterns apply", () => {
    // A live match with a scoreline is volatile for minutes whatever the
    // "count" pattern would have said.
    const result = assessVolatility("1,200 viewers watching, 2 - 1 at half-time");
    expect(result.ttlMs).toBeLessThanOrEqual(2 * HOUR);
  });

  it("leaves a durable fact alone", () => {
    const result = assessVolatility("Nairobi is the capital of Kenya");
    expect(result.volatile).toBe(false);
    expect(result.ttlMs).toBeNull();
  });
});

describe("deriveProvenance", () => {
  it("forces model origin when the content was model-generated, whatever the caller said", () => {
    // The most important origin to record accurately and the easiest to lose: a
    // generated sentence re-ingested as evidence becomes a fact by repetition.
    const derived = deriveProvenance(
      { content: "The platform should focus on sports", sourceType: "platform", generatedByModel: true },
      NOW
    );
    expect(derived.sourceType).toBe("model");
    expect(derived.notes.join(" ")).toContain("overridden to \"model\"");
  });

  it("sets an expiry on volatile content and says why", () => {
    const derived = deriveProvenance({ content: "USD to KES is 129.40", sourceType: "external" }, NOW);
    expect(derived.expiresAt).not.toBeNull();
    expect(derived.expiresAt!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(derived.notes.join(" ")).toContain("expiry set");
  });

  it("gives undated external material a long expiry rather than none", () => {
    // An undated scraped claim is the case that rots silently; a long expiry is
    // cheap insurance.
    const derived = deriveProvenance(
      { content: "Parliament passed a finance bill in March", sourceUrl: "https://example.com/news", source: "external" },
      NOW
    );
    const days = (derived.expiresAt!.getTime() - NOW.getTime()) / DAY;
    expect(days).toBeGreaterThan(80);
    expect(derived.sourceHash).toBeTruthy();
  });

  it("honours an explicit expiresAt: null as 'never expires'", () => {
    const derived = deriveProvenance(
      { content: "Nairobi is the capital of Kenya", sourceUrl: "https://example.com", source: "external", expiresAt: null },
      NOW
    );
    expect(derived.expiresAt).toBeNull();
  });

  it("never raises reliability above the origin's prior", () => {
    // A caller may know its source is worse than the prior, not that it is
    // better than the platform's own reading.
    const derived = deriveProvenance(
      { content: "some claim", sourceType: "external", sourceReliability: 0.99 },
      NOW
    );
    expect(derived.sourceReliability).toBe(SOURCE_RELIABILITY.external);
  });

  it("lowers reliability when the caller declares a worse source", () => {
    const derived = deriveProvenance({ content: "some claim", sourceType: "external", sourceReliability: 0.2 }, NOW);
    expect(derived.sourceReliability).toBe(0.2);
  });

  it("clamps an out-of-range declared reliability instead of letting it dominate", () => {
    const derived = deriveProvenance({ content: "c", sourceType: "external", sourceReliability: 5 }, NOW);
    expect(derived.sourceReliability).toBeLessThanOrEqual(1);
    const negative = deriveProvenance({ content: "c", sourceType: "external", sourceReliability: -3 }, NOW);
    expect(negative.sourceReliability).toBeGreaterThanOrEqual(0);
  });

  it("classifies a platform reading as observed and external material as unverified", () => {
    expect(deriveProvenance({ content: "x", sourceType: "platform" }, NOW).verificationStatus).toBe("observed");
    expect(deriveProvenance({ content: "x", sourceType: "external" }, NOW).verificationStatus).toBe("unverified");
  });
});

describe("provenanceWeight", () => {
  it("orders the states from operator-confirmed down to rejected", () => {
    const weight = (state: string) => provenanceWeight(memory({ verificationStatus: state }), NOW);
    expect(weight("operator_confirmed")).toBeGreaterThan(weight("corroborated"));
    expect(weight("corroborated")).toBeGreaterThan(weight("observed"));
    expect(weight("observed")).toBeGreaterThan(weight("unverified"));
    expect(weight("unverified")).toBeGreaterThan(weight("expired"));
    expect(weight("expired")).toBeGreaterThan(weight("rejected"));
  });

  it("never returns zero, so a low-standing memory can still be cited", () => {
    // Surfacing with a qualification is a legitimate outcome; the read path, not
    // the weight, decides what to drop.
    expect(provenanceWeight(memory({ verificationStatus: "rejected" }), NOW)).toBeGreaterThan(0);
  });

  it("multiplies state by reliability so neither alone can carry a memory", () => {
    const trustedButUnverified = provenanceWeight(
      memory({ verificationStatus: "unverified", sourceType: "platform" }),
      NOW
    );
    const confirmedButWeak = provenanceWeight(
      memory({ verificationStatus: "operator_confirmed", sourceReliability: 0.1 }),
      NOW
    );
    const both = provenanceWeight(memory({ verificationStatus: "operator_confirmed", sourceType: "platform" }), NOW);
    expect(both).toBeGreaterThan(trustedButUnverified);
    expect(both).toBeGreaterThan(confirmedButWeak);
  });
});

describe("visibility", () => {
  it("shows an operator everything", () => {
    expect(visibilityAllows({ content: "x", sensitivity: "sensitive", scope: "tenant-a" }, "operator")).toBe(true);
  });

  it("requires both a public sensitivity and a public scope", () => {
    // Conflating the two is how a region-scoped finding reaches the homepage
    // because someone remembered to set one field.
    expect(visibilityAllows({ content: "x", sensitivity: "public", scope: "platform" }, "public")).toBe(true);
    expect(visibilityAllows({ content: "x", sensitivity: "public", scope: "region:nairobi" }, "public")).toBe(false);
    expect(visibilityAllows({ content: "x", sensitivity: "internal", scope: "platform" }, "public")).toBe(false);
  });

  it("defaults to the conservative middle when nothing is recorded", () => {
    // `internal` sensitivity is invisible to the public, which is the safe
    // default for a row whose visibility was never decided.
    expect(visibilityAllows({ content: "x" }, "public")).toBe(false);
    expect(visibilityAllows({ content: "x" }, "operator")).toBe(true);
  });

  it("explains why a memory was withheld", () => {
    expect(visibilityReason({ content: "x", sensitivity: "sensitive" }, "public")).toContain("sensitive");
    expect(visibilityReason({ content: "x", sensitivity: "public", scope: "tenant-a" }, "public")).toContain("tenant-a");
    expect(visibilityReason({ content: "x", sensitivity: "public", scope: "platform" }, "public")).toBeNull();
  });
});

describe("findContradictions", () => {
  it("flags the same subject with different numbers", () => {
    const found = findContradictions({ content: "USD to KES rate is 129" }, [
      { content: "USD to KES rate is 131" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toContain("usd");
    expect(found[0]?.incoming).toBe("129");
    expect(found[0]?.existing).toBe("131");
  });

  it("does not flag agreement as a contradiction", () => {
    expect(findContradictions({ content: "USD to KES rate is 129" }, [{ content: "USD to KES rate is 129" }])).toEqual([]);
  });

  it("does not flag different subjects with different numbers", () => {
    // The narrowness is the design: an accusation of contradiction suppresses a
    // memory, so a false positive destroys information.
    expect(
      findContradictions({ content: "USD to KES rate is 129" }, [{ content: "The platform has 1,200 users" }])
    ).toEqual([]);
  });

  it("says nothing when the incoming memory makes no numeric claim", () => {
    expect(findContradictions({ content: "Nairobi is the capital of Kenya" }, [{ content: "Kisumu is a city" }])).toEqual([]);
  });

  it("ignores a memory compared against itself", () => {
    expect(findContradictions({ content: "USD to KES rate is 129" }, [{ content: "USD to KES rate is 129" }])).toEqual([]);
  });

  it("truncates the existing content it reports, so a long body does not flood a log", () => {
    const long = `USD to KES rate is 131. ${"filler ".repeat(200)}`;
    const found = findContradictions({ content: "USD to KES rate is 129" }, [{ content: long }]);
    expect(found[0]?.existingContent.length).toBeLessThanOrEqual(200);
  });
});

describe("extractClaims", () => {
  it("pulls a subject and a value out of a plain statement", () => {
    const claims = extractClaims("Active users is 12,400 this week");
    expect(claims.some((c) => c.value === "12400")).toBe(true);
  });

  it("returns nothing for content with no number", () => {
    expect(extractClaims("Nairobi is the capital of Kenya")).toEqual([]);
  });
});

describe("summarizeForPrompt", () => {
  it("tells the model it must qualify when nothing is confirmed", () => {
    // The difference between a confidently wrong answer and an honest one.
    const summary = summarizeForPrompt(
      [memory({ verificationStatus: "unverified" }), memory({ content: "other", verificationStatus: "unverified" })],
      NOW
    );
    expect(summary.assertable).toBe(0);
    expect(summary.mustQualify).toBe(true);
    expect(summary.line).toContain("unverified");
  });

  it("does not demand qualification when at least one memory is confirmed", () => {
    const summary = summarizeForPrompt(
      [memory({ verificationStatus: "corroborated" }), memory({ content: "other", verificationStatus: "unverified" })],
      NOW
    );
    expect(summary.assertable).toBe(1);
    expect(summary.unverified).toBe(1);
    expect(summary.mustQualify).toBe(false);
  });

  it("says so plainly when nothing was retrieved at all", () => {
    expect(summarizeForPrompt([], NOW).line).toContain("No stored memories");
  });

  it("counts expired separately from unverified", () => {
    const summary = summarizeForPrompt(
      [memory({ verificationStatus: "observed", expiresAt: new Date(NOW.getTime() - DAY) })],
      NOW
    );
    expect(summary.expired).toBe(1);
    expect(summary.assertable).toBe(0);
  });
});

describe("contentHash", () => {
  it("is stable across whitespace differences, so a re-fetch is recognised", () => {
    expect(contentHash("a  b\n c")).toBe(contentHash("a b c"));
  });

  it("differs for different content", () => {
    expect(contentHash("a b")).not.toBe(contentHash("a b c"));
  });
});

describe("describeProvenance", () => {
  it("names the state, origin, reliability and expiry for the console", () => {
    const line = describeProvenance(
      {
        content: "x",
        sourceUrl: "https://www.example.com/story",
        sourceType: "external",
        verificationStatus: "corroborated",
        sourceReliability: 0.8,
        expiresAt: new Date(NOW.getTime() + DAY),
      },
      NOW
    );
    expect(line).toContain("corroborated");
    expect(line).toContain("www.example.com");
    expect(line).toContain("80%");
    expect(line).toContain("expires");
  });

  it("survives an unparseable source URL", () => {
    expect(describeProvenance({ content: "x", sourceUrl: "not a url" }, NOW)).toContain("unparseable");
  });
});
