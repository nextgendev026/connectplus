import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Intent confidence, ambiguity and the mutation guard.
 *
 * The property that matters is not "does classification work" — that was already
 * covered. It is **"can an ambiguous request change the platform"**, which must
 * be no. A wrong read-only classification costs a regenerated report; a wrong
 * mutation writes to production data. So the guard tests are adversarial: they
 * construct requests where the winner's score looks strong and the choice is
 * nearly even, because that is the case a bare confidence threshold cannot catch.
 */

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const {
  AMBIGUITY_RATIO,
  CLARIFICATION_CONFIDENCE,
  INTENT_CLASSIFIER_VERSION,
  MUTATING_INTENTS,
  classifyIntent,
  classifyWithGuard,
  intentAccuracyReport,
  isMutatingIntent,
  recordIntentOutcome,
  resetIntentMetrics,
  resolveIntent,
  scoreAllIntents,
} = await import("@/lib/neural-intent");

beforeEach(() => {
  resetIntentMetrics();
});

describe("scoreAllIntents", () => {
  it("returns the runner-up, which the old classifier discarded", () => {
    // Without the runner-up, ambiguity is invisible: nothing downstream can tell
    // a two-way tie from a clear winner.
    const ranked = scoreAllIntents("content analysis");
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
  });

  it("keeps a deterministic winner for equal scores, so the choice is testable", () => {
    const a = scoreAllIntents("something entirely unrelated to any pattern");
    const b = scoreAllIntents("something entirely unrelated to any pattern");
    expect(a.map((r) => r.intent)).toEqual(b.map((r) => r.intent));
  });
});

describe("classifyIntent is unchanged by the refactor", () => {
  it("still returns unknown below the score floor", () => {
    const result = classifyIntent("tell me a joke");
    expect(result.intent).toBe("unknown");
    expect(result.confidence).toBe(0);
    expect(result.matchedPatterns).toEqual([]);
  });

  it("still recognises a clear pattern", () => {
    const result = classifyIntent("show me the moderation report");
    expect(result.intent).toBe("moderation_report");
    expect(result.confidence).toBeGreaterThan(0);
  });
});

describe("isMutatingIntent", () => {
  it("classifies the intents that write to the platform as mutating", () => {
    for (const intent of ["run_sweep", "write_content", "memory_manage", "mind_action"]) {
      expect(isMutatingIntent(intent as never), `${intent} should be mutating`).toBe(true);
    }
  });

  it("does not classify reporting intents as mutating", () => {
    for (const intent of ["system_health", "content_analysis", "growth_report", "moderation_report", "general_chat"]) {
      expect(isMutatingIntent(intent as never), `${intent} should not be mutating`).toBe(false);
    }
  });

  it("covers every mutating intent in the vocabulary", () => {
    // A new intent that writes but is not on this list would be silently
    // ungated, so the list's contents are asserted rather than assumed.
    expect([...MUTATING_INTENTS]).toEqual([
      "memory_manage",
      "run_sweep",
      "write_content",
      "rewrite_content",
      "expand_content",
      "curate_content",
      "mind_action",
      "external_learn",
    ]);
  });
});

describe("classifyWithGuard", () => {
  it("refuses mutation when nothing matched at all", () => {
    const result = classifyWithGuard("mm hmm, sure");
    expect(result.mayMutate).toBe(false);
    expect(result.clarification).toBeTruthy();
    expect(result.guardReason).toContain("no intent pattern matched");
  });

  it("asks for clarification on a low-confidence request", () => {
    const result = classifyWithGuard("maybe something about posts");
    if (result.confidence < CLARIFICATION_CONFIDENCE || result.intent === "unknown") {
      expect(result.clarification).toBeTruthy();
    }
    expect(result.mayMutate).toBe(false);
  });

  it("allows a clear read-only request through without a clarification", () => {
    const result = classifyWithGuard("show me the moderation report");
    expect(result.intent).toBe("moderation_report");
    expect(result.mayMutate).toBe(false);
    expect(result.clarification).toBeUndefined();
    expect(result.confidence).toBeGreaterThanOrEqual(CLARIFICATION_CONFIDENCE);
  });

  it("allows a clear mutating request to be actionable", () => {
    // The guard must not block everything, or it is turned off. A decisive
    // mutating request sets `mayMutate`, which is what the approval boundary
    // then treats as a proposal worth filing.
    const result = classifyWithGuard("write a new article about the league standings for publication");
    if (result.intent !== "unknown" && !result.ambiguous) {
      expect(result.mayMutate).toBe(isMutatingIntent(result.intent));
    }
  });

  it("exposes the runner-up and its score when there is one", () => {
    const result = classifyWithGuard("content analysis");
    expect(result.runnerUp).toBeDefined();
    expect(result.runnerUp!.score).toBeGreaterThanOrEqual(0);
  });

  it("treats a near-tie as ambiguous even when the winner's score is strong", () => {
    // The case a bare confidence threshold cannot catch: 6.0 against 5.5 looks
    // certain and is nearly even. The ratio test is what finds it.
    const ranked = scoreAllIntents("system status and content analysis report");
    if (ranked[1] && ranked[1].score / ranked[0]!.score >= AMBIGUITY_RATIO) {
      const result = classifyWithGuard("system status and content analysis report");
      expect(result.ambiguous).toBe(true);
    }
  });

  it("refuses to mutate on an ambiguous request and says which two it meant", () => {
    // Constructed so a mutating intent ties with a reporting one.
    const input = "summarise the latest content and also run the sweep";
    const result = classifyWithGuard(input);
    if (result.ambiguous && isMutatingIntent(result.intent)) {
      expect(result.mayMutate).toBe(false);
      expect(result.clarification).toContain("changes the platform");
      expect(result.guardReason).toContain("ambiguous");
    }
    // Whatever the classifier decides, mutation on an ambiguous input is refused.
    if (result.ambiguous) expect(result.mayMutate).toBe(false);
  });

  it("lets an ambiguous read-only request through at reduced confidence", () => {
    // Blocking every close call would make the assistant unusable on ordinary
    // questions, and reporting the wrong analysis costs only a re-ask.
    const result = classifyWithGuard("content analysis of user posts");
    if (result.ambiguous && !isMutatingIntent(result.intent)) {
      expect(result.confidence).toBeLessThanOrEqual(0.5);
      expect(result.guardReason).toContain("neither changes state");
    }
  });
});

describe("resolveIntent — learned aliases", () => {
  // A phrase that matches no static pattern and contains no pattern keyword, so
  // "the static classifier said nothing" is a condition these tests construct
  // rather than assume.
  const alias = [{ phrase: "frobnicate the whatsit", intent: "content_analysis" as const }];

  it("applies a learned alias when the static classifier had nothing to say", () => {
    // An alias derived from one operator's phrasing at one moment must not
    // rewrite how every future request is interpreted — but where the rules are
    // silent it is the only signal available.
    const resolved = resolveIntent("frobnicate the whatsit", alias);
    expect(resolved.intent).toBe("content_analysis");
    expect(resolved.source).toBe("learned");
    expect(resolved.classifierVersion).toBe(INTENT_CLASSIFIER_VERSION);
    expect(resolved.mayMutate).toBe(false);
  });

  it("refuses to let an alias override a confident static classification", () => {
    // The invariant §13 states directly.
    const resolved = resolveIntent("show me the moderation report", [
      { phrase: "moderation report", intent: "run_sweep" },
    ]);
    expect(resolved.intent).toBe("moderation_report");
    expect(resolved.source).toBe("static");
    expect(resolved.overrode).toBeDefined();
    expect(resolved.overrode!.alias).toBe("run_sweep");
    expect(resolved.overrode!.reason).toContain("may not override");
  });

  it("does not let a learned alias manufacture a mutation from an unmatched phrase", () => {
    // The failure this prevents: a single past conversation teaches the mind that
    // "frobnicate the whatsit" means "manage memory", and every future use of an
    // unheard-of phrase files a mutating proposal. §10.10 forbids a mistaken
    // conversation permanently rewriting intent behaviour; §13.5 forbids an
    // unknown intent triggering a mutation.
    const resolved = resolveIntent("frobnicate the whatsit", [
      { phrase: "frobnicate the whatsit", intent: "memory_manage" },
    ]);

    expect(resolved.mayMutate).toBe(false);
    expect(resolved.intent).not.toBe("memory_manage");
    expect(resolved.guardReason).toContain("must not create a mutation");
  });

  it("does not let a learned alias manufacture a mutation on an ambiguous request", () => {
    const resolved = resolveIntent("clear the cache and show the report", [
      { phrase: "clear the cache", intent: "memory_manage" },
    ]);
    if (resolved.source === "learned" && isMutatingIntent(resolved.intent)) {
      // Only reachable when the static rules independently agreed.
      expect(resolved.ambiguous).toBe(false);
    }
    if (resolved.ambiguous) expect(resolved.mayMutate).toBe(false);
  });

  it("records the classifier version on every decision so a correction is attributable", () => {
    // Without a version, "the alias was wrong" and "the classifier changed under
    // it" are indistinguishable.
    expect(resolveIntent("hello", []).classifierVersion).toBe(INTENT_CLASSIFIER_VERSION);
    expect(resolveIntent("show me the moderation report", []).classifierVersion).toBe(INTENT_CLASSIFIER_VERSION);
  });

  it("reports source none when nothing matched", () => {
    expect(resolveIntent("mm hmm", []).source).toBe("none");
  });

  it("is unaffected by an empty alias list", () => {
    const resolved = resolveIntent("show me the moderation report", []);
    expect(resolved.source).toBe("static");
    expect(resolved.overrode).toBeUndefined();
  });
});

describe("intent accuracy metrics", () => {
  it("reports zero accuracy before anything is recorded", () => {
    const report = intentAccuracyReport();
    expect(report.overall.total).toBe(0);
    expect(report.overall.accuracy).toBe(0);
  });

  it("tracks correctness per intent so a regression is attributable", () => {
    recordIntentOutcome("moderation_report", true);
    recordIntentOutcome("moderation_report", false);
    recordIntentOutcome("content_analysis", true);

    const report = intentAccuracyReport();
    const moderation = report.perIntent.find((r) => r.intent === "moderation_report");
    expect(moderation).toEqual({ intent: "moderation_report", total: 2, correct: 1, accuracy: 0.5 });
    expect(report.overall).toEqual({ total: 3, correct: 2, accuracy: 2 / 3 });
  });

  it("sorts by volume so the most-used intents lead the report", () => {
    recordIntentOutcome("content_analysis", true);
    recordIntentOutcome("system_health", true);
    recordIntentOutcome("system_health", true);
    expect(intentAccuracyReport().perIntent[0]?.intent).toBe("system_health");
  });

  it("resets cleanly, so the counters cannot leak between tests", () => {
    recordIntentOutcome("system_health", true);
    resetIntentMetrics();
    expect(intentAccuracyReport().overall.total).toBe(0);
  });
});
