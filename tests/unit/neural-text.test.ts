import { describe, expect, it } from "vitest";
import {
  extractKeywords,
  analyzeSentiment,
  summarizeText,
  stripHtml,
  wordCount,
} from "@/lib/neural-text";

describe("extractKeywords", () => {
  it("filters stop words and numbers", () => {
    const keywords = extractKeywords("the the token token token 123", 10);
    expect(keywords.map(k => k.keyword)).toEqual(["token"]);
  });

  it("ranks frequently repeated words first", () => {
    const text = "growth growth growth market market numbers";
    const keywords = extractKeywords(text, 3);
    expect(keywords[0]!.keyword).toBe("growth");
  });

  it("respects topN", () => {
    const text = "one two three four five six seven eight nine ten eleven";
    expect(extractKeywords(text, 5)).toHaveLength(5);
  });
});

describe("analyzeSentiment", () => {
  it("detects positive sentiment", () => {
    const result = analyzeSentiment("This breakthrough is amazing and excellent progress");
    expect(result.sentiment).toBe("positive");
  });

  it("detects negative sentiment", () => {
    const result = analyzeSentiment("The crisis caused a terrible decline and collapse");
    expect(result.sentiment).toBe("negative");
  });

  it("returns neutral for words outside the lexicon", () => {
    const result = analyzeSentiment("The building has wooden tables inside");
    expect(result.sentiment).toBe("neutral");
    expect(result.score).toBe(0);
  });
});

describe("summarizeText", () => {
  it("returns short text unchanged when under maxSentences", () => {
    const text = "First sentence here. Second sentence here.";
    expect(summarizeText(text, 3)).toBe(text);
  });

  it("returns at most maxSentences sentences for long text", () => {
    const text = Array.from({ length: 6 }, (_, i) => `Sentence number ${i + 1} with enough words to count as a full valid sentence.`).join(". ");
    const summary = summarizeText(text, 3);
    const sentenceCount = summary.split(/[.!?](?:\s|$)/).filter(s => s.trim().length > 0).length;
    expect(sentenceCount).toBeLessThanOrEqual(3);
  });
});

describe("stripHtml / wordCount", () => {
  it("decodes common entities and strips tags", () => {
    expect(stripHtml("<p>a&nbsp;&amp;&nbsp;b</p>")).toBe("a & b");
  });

  it("counts words across whitespace", () => {
    expect(wordCount("one two\nthree\tfour")).toBe(4);
  });
});