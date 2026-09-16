import { describe, expect, it } from "vitest";
import {
  applySuggestion,
  applySuggestions,
  readingStats,
  runWritingChecks,
  type WritingSuggestion,
} from "../../src/lib/writing-checks";

/** The suggestion a rule produced, or undefined. */
function rule(suggestions: WritingSuggestion[], name: string): WritingSuggestion | undefined {
  return suggestions.find((s) => s.rule === name);
}

describe("writing checks — mechanics and spelling", () => {
  it("flags a misspelling with an exact, applyable range", () => {
    const content = "We recieve the report tomorrow.";
    const found = rule(runWritingChecks(content).suggestions, "spelling.recieve");

    expect(found).toBeDefined();
    expect(found!.original).toBe("recieve");
    expect(found!.replacement).toBe("receive");
    // The offsets must slice the original out of the draft — that is the whole
    // contract the composer relies on to apply a fix in place.
    expect(content.slice(found!.start, found!.end)).toBe("recieve");
  });

  it("preserves the author's capitalisation when replacing", () => {
    const found = rule(runWritingChecks("Recieve this first.").suggestions, "spelling.recieve");
    expect(found!.replacement).toBe("Receive");
  });

  it("does not match a misspelling inside a longer word", () => {
    // Word boundaries matter: "alotment" is not "a lot".
    expect(rule(runWritingChecks("The alotment was generous.").suggestions, "spelling.alot")).toBeUndefined();
  });

  it("tightens wordy phrases and redundant pairs", () => {
    const { suggestions } = runWritingChecks(
      "In order to ship, we had to cut the each and every check."
    );
    // Sentence-initial match keeps its capital: "In order to" -> "To".
    expect(rule(suggestions, "wordy.in-order-to")?.replacement).toBe("To");
    expect(rule(suggestions, "redundant.each-and-every")?.replacement).toBe("every");
  });

  it("catches a doubled word and collapses it", () => {
    const found = rule(runWritingChecks("This is the the plan.").suggestions, "mechanics.doubled-word");
    expect(found?.original).toBe("the the");
    expect(found?.replacement).toBe("the");
  });

  it("collapses runs of spaces but never line breaks", () => {
    const { suggestions } = runWritingChecks("Two  spaces here.\n\nNew  para.");
    const doubles = suggestions.filter((s) => s.rule === "mechanics.double-space");
    expect(doubles.length).toBe(2);
    // The blank line between paragraphs must not be treated as doubled spaces.
    expect(suggestions.some((s) => s.original.includes("\n"))).toBe(false);
  });

  it("removes a space before punctuation", () => {
    const found = rule(
      runWritingChecks("Wait , then go .").suggestions,
      "mechanics.space-before-punctuation"
    );
    expect(found?.replacement).toBe(",");
  });
});

describe("writing checks — advice without an automatic fix", () => {
  it("reports long sentences as advice (no replacement)", () => {
    const long =
      "This sentence is deliberately padded with a great many extra words so that it runs well past the point where a reader can comfortably follow it in one breath without losing the thread of what it is actually saying.";
    const found = rule(runWritingChecks(long).suggestions, "readability.long-sentence");
    expect(found).toBeDefined();
    expect(found!.replacement).toBeNull();
    expect(found!.kind).toBe("clarity");
  });

  it("flags clichés as engagement advice and hedges as clarity", () => {
    const { suggestions } = runWritingChecks("At the end of the day, it is very basically simple.");
    expect(rule(suggestions, "cliche.at-the-end-of-the-day")?.kind).toBe("engagement");
    expect(rule(suggestions, "filler.very")?.replacement).toBeNull();
  });

  it("never overlaps two suggestions", () => {
    const { suggestions } = runWritingChecks("We utilize utilize things.");
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i]!.start).toBeGreaterThanOrEqual(suggestions[i - 1]!.end);
    }
  });
});

describe("writing checks — score, tone and stats", () => {
  it("scores clean prose higher than a draft with mechanical errors", () => {
    const clean = runWritingChecks(
      "The team shipped the feature on Monday. Users noticed the change immediately."
    );
    const messy = runWritingChecks(
      "We recieve the seperate report. In order to proceed, we must utilize the calender."
    );
    expect(clean.score).toBeGreaterThan(messy.score);
    expect(clean.grade === "A" || clean.grade === "B").toBe(true);
    expect(messy.counts.correctness).toBeGreaterThan(0);
  });

  it("never drops below the floor", () => {
    const garbage = "recieve seperate definately occured neccessary alot ".repeat(20);
    expect(runWritingChecks(garbage).score).toBeGreaterThanOrEqual(40);
  });

  it("labels optimistic copy as confident/warm and hedging copy as hesitant", () => {
    const upbeat = runWritingChecks("Growth and success. The team celebrates a breakthrough.");
    const hedging = runWritingChecks("Maybe this could possibly work, perhaps, it seems likely.");
    expect(["Confident", "Warm"]).toContain(upbeat.tone.label);
    expect(hedging.tone.label).toBe("Hesitant");
  });

  it("counts words, sentences and paragraphs", () => {
    const stats = readingStats("One two three. Four five.\n\nSecond paragraph here.");
    expect(stats.words).toBe(8);
    expect(stats.sentences).toBe(3);
    expect(stats.paragraphs).toBe(2);
    expect(stats.readingTimeMinutes).toBe(1);
  });
});

describe("writing checks — applying fixes", () => {
  it("applies one suggestion to the exact range", () => {
    const content = "We recieve it.";
    const found = rule(runWritingChecks(content).suggestions, "spelling.recieve")!;
    expect(applySuggestion(content, found)).toBe("We receive it.");
  });

  it("applies many suggestions without shifting each other's offsets", () => {
    const content = "We recieve the the seperate files.";
    const { suggestions } = runWritingChecks(content);
    const fixed = applySuggestions(content, suggestions);
    expect(fixed).toBe("We receive the separate files.");
  });

  it("treats a replacement-less suggestion as a no-op", () => {
    const content = "It is very simple.";
    const found = rule(runWritingChecks(content).suggestions, "filler.very")!;
    expect(applySuggestion(content, found)).toBe(content);
  });

  it("ignores an out-of-range suggestion rather than corrupting the draft", () => {
    const bogus: WritingSuggestion = {
      id: "x",
      kind: "correctness",
      rule: "bogus",
      message: "bogus",
      original: "nope",
      replacement: "yes",
      start: 999,
      end: 1004,
      severity: "low",
    };
    expect(applySuggestion("short draft", bogus)).toBe("short draft");
  });
});
