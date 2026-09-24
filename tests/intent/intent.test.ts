import { describe, expect, it } from "vitest";
import { normalizeInput, routeChatInput, inferChatLanguageMix } from "@/lib/agent-router";
import { runJsSandboxed } from "@/lib/agent-tools";
import { buildGeneralAgentPrompt, GENERAL_AGENT_SYSTEM } from "@/lib/agent-prompt";

/**
 * Intent coverage for the general-purpose agent.
 *
 * Each row of the brief's table is a contract, not an aspiration: these are
 * the inputs operators and creators actually type, and the route chosen for
 * each is what decides whether a tool is called, whether the platform's real
 * numbers are used, and whether the user gets asked one question instead of
 * receiving a guess.
 *
 * Pure functions only — no database, no network — so the suite runs in CI
 * without secrets and without the migration having been applied.
 */
describe("intent routing", () => {
  it("routes a general science question to general, with no tools implied", () => {
    const d = routeChatInput("explain quantum entanglement simply");
    expect(d.route).toBe("general");
    expect(d.clarify).toBe(false);
  });

  it("routes a capital-of question to general (static knowledge)", () => {
    expect(routeChatInput("what's the capital of peru").route).toBe("general");
  });

  it("routes a code request to code", () => {
    const d = routeChatInput("write python to reverse a list");
    expect(d.route).toBe("code");
    expect(d.clarify).toBe(false);
  });

  it("routes a fresh-facts question to web", () => {
    const d = routeChatInput("who won the 2022 world cup");
    expect(d.route).toBe("web");
    expect(d.clarify).toBe(false);
  });

  it("routes a platform question to platform with the creator intent attached", () => {
    const d = routeChatInput("how are my creators in nairobi");
    expect(d.route).toBe("platform");
    expect(d.intent).toBe("creator_intelligence");
    expect(d.clarify).toBe(false);
  });

  it("routes a typo'd creator question to platform (typo tolerated)", () => {
    const d = routeChatInput("how r my creaters doin");
    expect(d.route).toBe("platform");
    // The console classifier is not fooled either — the fuzzy pass is not
    // what carries this one.
    expect(d.intent).toBe("creator_intelligence");
  });

  it("routes mixed-language platform talk to platform", () => {
    const d = routeChatInput("niaje, niambie kuhusu revenue yangu");
    expect(d.route).toBe("platform");
    expect(d.intent).toBe("monetization_report");
  });

  it("flags a vague short request for exactly one clarifying question", () => {
    const d = routeChatInput("gimme da latest");
    expect(d.clarify).toBe(true);
  });

  it("never fuzzy-matches into a mutating intent", () => {
    // "publish" is a mind_action keyword; a typo'd variant must not drift
    // into an intent that can change platform state.
    const d = routeChatInput("pls publishh this");
    expect(d.route).toBe("platform");
  });

  it("greets without claiming platform business", () => {
    const d = routeChatInput("sasa");
    expect(d.route).toBe("general");
  });
});

describe("input normalization", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeInput("  how   are\n\tmy  creators  ")).toBe("how are my creators");
  });

  it("keeps the user's spelling exactly as typed", () => {
    // Rule 5: interpret intent; never correct the user.
    expect(normalizeInput("how r my creaters doin")).toBe("how r my creaters doin");
  });

  it("folds equivalent spellings of the same word to one form", () => {
    // NFC composes accents so "café" typed two ways compares equal; the ﬁ
    // ligature is deliberately NOT folded — that is NFKC, and expanding it
    // would rewrite words the user chose to type that way.
    expect(normalizeInput("caf\u00E9")).toBe(normalizeInput("cafe\u0301"));
    expect(normalizeInput("\uFB01ne")).toBe("\uFB01ne");
  });
});

describe("language mix inference", () => {
  it("detects Kiswahili in a chat turn", () => {
    expect(inferChatLanguageMix("niaje, niambie kuhusu revenue yangu")).toContain("Kiswahili");
  });

  it("detects Sheng slang", () => {
    expect(inferChatLanguageMix("msee hali gani")).toContain("Sheng");
  });

  it("defaults to English when nothing else is observed", () => {
    expect(inferChatLanguageMix("what is the capital of peru")).toBe("English");
  });
});

describe("code runner sandbox", () => {
  it("runs pure computation and returns the value", () => {
    const r = runJsSandboxed("(() => { const x = [3,1,2].sort(); return x.join(','); })()");
    expect(r.ok).toBe(true);
    expect(r.output).toContain("1,2,3");
  });

  it("captures console output", () => {
    const r = runJsSandboxed("console.log('hello'); 1 + 1");
    expect(r.ok).toBe(true);
    expect(r.output).toContain("hello");
  });

  it("refuses to reach the network", () => {
    const r = runJsSandboxed("fetch('http://example.com')");
    expect(r.ok).toBe(false);
  });

  it("refuses to read the filesystem or process", () => {
    expect(runJsSandboxed("require('fs')").ok).toBe(false);
    expect(runJsSandboxed("process.env.SECRET").ok).toBe(false);
  });

  it("times out an infinite loop instead of hanging the turn", () => {
    const r = runJsSandboxed("while (true) {}");
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/timed out|execution.*terminated|was terminated/i);
  });

  it("reports a thrown error as output, not a crash", () => {
    const r = runJsSandboxed("throw new Error('boom')");
    expect(r.ok).toBe(false);
    expect(r.output).toContain("boom");
  });
});

describe("system prompt contract", () => {
  it("carries every General-Purpose Mode rule", () => {
    for (const marker of [
      "NOT limited to ConnectPlus",
      "webSearch",
      "codeRunner",
      "code-switching",
      "ONE clarifying question",
      "Never fabricate",
      "UNTRUSTED",
      "Never expose another user",
    ]) {
      expect(GENERAL_AGENT_SYSTEM).toContain(marker);
    }
  });

  it("grows with context and never emits placeholder blocks", () => {
    const bare = buildGeneralAgentPrompt({});
    const full = buildGeneralAgentPrompt({
      languageMix: "English + Kiswahili",
      summary: "2026-09-24: asked about payouts",
      recall: [{ content: "how do payouts work", createdAt: "2026-09-20T10:00:00Z", score: 0.8 }],
      platformBrief: '{"creators":{"total":12}}',
    });
    expect(bare).not.toContain("remember about this user");
    expect(full).toContain("English + Kiswahili");
    expect(full).toContain("how do payouts work");
    expect(full.length).toBeGreaterThan(bare.length);
  });
});
