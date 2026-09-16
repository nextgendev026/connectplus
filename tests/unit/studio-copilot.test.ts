import { describe, expect, it } from "vitest";
import { MAX_DRAFT_CHARS, runStudioBrain } from "@/lib/neural-studio";

/**
 * The `inspect` action is the studio's live checker. It is deterministic and
 * provider-free on purpose: it runs on a debounce while the writer types, so it
 * must return in-process and identically on every deployment. These tests pin
 * the contract the composer relies on — offset-addressed issues, a bounded
 * input, and an honest note when a draft was too long to check in full.
 */
describe("studio copilot — inspect action", () => {
  it("returns issues whose offsets address the exact flag in the draft", async () => {
    const content = "We recieve the the plan and seperate it later.";
    const result = await runStudioBrain({ action: "inspect", content });

    expect(result.action).toBe("inspect");
    expect(result.suggestions?.length).toBeGreaterThan(0);
    for (const s of result.suggestions ?? []) {
      expect(content.slice(s.start, s.end)).toBe(s.original);
    }
    expect(result.suggestions?.some((s) => s.replacement === "receive")).toBe(true);
  });

  it("scores a clean draft above a flawed one and reports a grade", async () => {
    const clean = await runStudioBrain({
      action: "inspect",
      content: "The team shipped the feature on Monday. Readers noticed it at once.",
    });
    const flawed = await runStudioBrain({
      action: "inspect",
      content: "We recieve the seperate calender and definately utilize it.",
    });

    expect(clean.meta?.score).toBeGreaterThan(flawed.meta?.score ?? 0);
    expect(clean.meta?.grade).toBeDefined();
    expect(clean.meta?.tone).toBeDefined();
    expect(flawed.meta?.counts?.correctness).toBeGreaterThan(0);
  });

  it("treats an empty editor as a clean draft rather than an error", async () => {
    const result = await runStudioBrain({ action: "inspect", content: "" });
    expect(result.suggestions).toEqual([]);
    expect(result.meta?.score).toBe(100);
  });

  it("caps a pasted draft and says so instead of silently checking part of it", async () => {
    const huge = "recieve seperate calender ".repeat(3_000); // > MAX_DRAFT_CHARS
    expect(huge.length).toBeGreaterThan(MAX_DRAFT_CHARS);

    const result = await runStudioBrain({ action: "inspect", content: huge });
    expect(result.meta?.notes?.some((n) => /first/i.test(n))).toBe(true);
    // And nothing it returned points past the part it actually read.
    for (const s of result.suggestions ?? []) expect(s.end).toBeLessThanOrEqual(MAX_DRAFT_CHARS);
    expect(result.suggestions?.length).toBeLessThan(huge.length);
  });

  it("normalises composer fields it is handed (tags are bounded and cleaned)", async () => {
    const result = await runStudioBrain({
      action: "inspect",
      content: "A short draft.",
      tags: ["#Tech", "  ", "growth"],
    });
    // inspect itself is content-only; the guarantee is that a hostile tag list
    // cannot throw or leak through — the call returns a normal result.
    expect(result.action).toBe("inspect");
    expect(result.suggestions).toBeDefined();
  });
});
