import { describe, expect, it } from "vitest";
import {
  classifyIntent,
  applyLearnedAliases,
  extractUrls,
  isUrl,
  type Intent,
} from "@/lib/neural-intent";

describe("classifyIntent", () => {
  it("classifies system health queries", () => {
    const result = classifyIntent("how is the system running today");
    expect(result.intent).toBe("system_health");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("classifies content analysis queries", () => {
    expect(classifyIntent("analyze the posts and content quality").intent).toBe("content_analysis");
  });

  it("classifies moderation queries", () => {
    expect(classifyIntent("what is pending in the moderation queue").intent).toBe("moderation_report");
  });

  it("classifies user analysis queries", () => {
    expect(classifyIntent("user growth report").intent).toBe("user_analysis");
  });

  it("classifies growth report queries", () => {
    expect(classifyIntent("show me the growth report").intent).toBe("growth_report");
  });

  it("classifies run_sweep queries", () => {
    expect(classifyIntent("run a learning sweep").intent).toBe("run_sweep");
  });

  it("returns unknown with zero confidence for off-topic input", () => {
    const result = classifyIntent("purple unicorns fly at noon");
    expect(result.intent).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  it("classifies content-creation intents", () => {
    expect(classifyIntent("write a post about Nairobi fintech").intent).toBe("write_content");
    expect(classifyIntent("polish my draft").intent).toBe("rewrite_content");
    expect(classifyIntent("summarize this article").intent).toBe("summarize_content");
    expect(classifyIntent("suggest a headline for my post").intent).toBe("headline_suggest");
    expect(classifyIntent("suggest tags for my draft").intent).toBe("tag_suggest");
    expect(classifyIntent("make an outline for my story").intent).toBe("outline_suggest");
    expect(classifyIntent("continue writing my draft").intent).toBe("expand_content");
    expect(classifyIntent("what should I write about next").intent).toBe("curate_content");
  });

  it("classifies conversational greetings", () => {
    expect(classifyIntent("hello there").intent).toBe("general_chat");
    expect(classifyIntent("what can you do").intent).toBe("general_chat");
  });

  it("is case-insensitive", () => {
    const lower = classifyIntent("platform health");
    const upper = classifyIntent("PLATFORM HEALTH");
    expect(lower.intent).toBe(upper.intent);
  });
});

describe("applyLearnedAliases", () => {
  it("rejects empty learned maps", () => {
    expect(applyLearnedAliases("any input", [])).toBeNull();
  });

  it("returns the best matching learned intent", () => {
    const learned = [
      { phrase: "sasa vipi mitambo", intent: "system_health" as Intent },
      { phrase: "jadili maudhui", intent: "content_analysis" as Intent },
    ];
    expect(applyLearnedAliases("sasa vipi mitambo?", learned)).toBe("system_health");
  });

  it("matches case-insensitively", () => {
    const learned = [{ phrase: "how do the brains feel", intent: "hive_report" as Intent }];
    expect(applyLearnedAliases("How Do The Brains Feel today", learned)).toBe("hive_report");
  });
});

describe("extractUrls / isUrl", () => {
  it("extracts http(s) URLs from text", () => {
    expect(extractUrls("visit https://example.com and http://blog.ke/x now")).toEqual([
      "https://example.com",
      "http://blog.ke/x",
    ]);
  });

  it("returns empty array when none present", () => {
    expect(extractUrls("no links here")).toEqual([]);
  });

  it("validates standalone URLs", () => {
    expect(isUrl("https://example.com/path?q=1")).toBe(true);
    expect(isUrl("not a url")).toBe(false);
    expect(isUrl("ftp://example.com")).toBe(false);
  });
});