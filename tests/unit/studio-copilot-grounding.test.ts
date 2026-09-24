import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The studio copilot used to be write-only.
 *
 * Every keep and discard a writer made was filed as a `copilot-outcome` memory,
 * and only the inline `pilot` action ever read them back — so `rewrite`,
 * `continue`, `outline`, `summarize`, `headline` and `tags` all asked the same
 * model the same question with no knowledge of the editor's established taste,
 * with no way to improve, and without even the post's own category and tags.
 *
 * These tests pin the read half of that loop, because it is invisible in the
 * output: a prompt that silently loses its grounding still produces plausible
 * prose, so nothing but the assembled payload can prove it is still there.
 */

const captured: { system: string; user: string }[] = [];
const notes = { value: [] as string[] };

vi.mock("@/lib/ai-provider", () => ({
  generateText: async (args: { system: string; user: string }) => {
    captured.push({ system: args.system, user: args.user });
    return "A rewritten draft.";
  },
  studioSystemPrompt: (action: string) => `system-for-${action}`,
}));

vi.mock("@/lib/copilot-skills", async () => {
  const actual = await vi.importActual<typeof import("@/lib/copilot-skills")>("@/lib/copilot-skills");
  return {
    ...actual,
    copilotSkillNotesFromStore: async () => notes.value,
    recordCopilotOutcomes: async () => 0,
  };
});

import { resetCopilotGrounding, runStudioBrain } from "@/lib/neural-studio";

beforeEach(() => {
  captured.length = 0;
  notes.value = [];
  // The notes are memoised for a minute in production, which is what keeps a
  // debounced typing burst from re-reading the store on every keystroke. The
  // memo is process-global, so a suite has to clear it between cases.
  resetCopilotGrounding();
});

const DRAFT =
  "The county assembly approved the budget on Tuesday. The chair said the allocation would cover water projects.";

describe("studio copilot grounding", () => {
  it("tells the model what this publication's writers usually accept", async () => {
    notes.value = ["The corrections applied most often are: tightening."];

    await runStudioBrain({ action: "rewrite", content: DRAFT, title: "Budget passes" });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.user).toContain("usually accept");
    expect(captured[0]!.user).toContain("tightening");
  });

  it("grounds the same actions that were previously ungrounded", async () => {
    // `headline` and `outline` were among the twelve bare calls; if grounding is
    // ever lost from one action by accident, this is where it shows up.
    notes.value = ["The fields writers most often accept changes to: content, title."];

    await runStudioBrain({ action: "headline", content: DRAFT, title: "Budget passes" });
    await runStudioBrain({ action: "outline", content: DRAFT });

    expect(captured).toHaveLength(2);
    for (const call of captured) {
      expect(call.user).toContain("most often accept changes to");
    }
  });

  it("carries the rest of the composer, not just the body", async () => {
    notes.value = ["The corrections applied most often are: tightening."];

    await runStudioBrain({
      action: "rewrite",
      content: DRAFT,
      category: "County",
      tags: ["budget", "water"],
    });

    const user = captured[0]!.user;
    expect(user).toContain("The post being worked on:");
    expect(user).toContain("Category: County");
    expect(user).toContain("Tags: budget, water");
  });

  it("states the guidance before the draft, so the draft is not the last word", async () => {
    notes.value = ["The corrections applied most often are: tightening."];

    await runStudioBrain({ action: "rewrite", content: DRAFT });

    const user = captured[0]!.user;
    expect(user.indexOf("usually accept")).toBeLessThan(user.indexOf(DRAFT));
  });

  it("still works on a publication that has never used the copilot", async () => {
    // No history must mean no invented house style, not a failed request.
    const result = await runStudioBrain({ action: "rewrite", content: DRAFT });

    expect(result.text).toBeTruthy();
    expect(captured).toHaveLength(1);
    expect(captured[0]!.user).not.toContain("usually accept");
  });
});
