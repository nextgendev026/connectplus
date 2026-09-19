import { describe, expect, it } from "vitest";
import {
  coerceCopilotOutcome,
  copilotSkillNotes,
  summarizeCopilotSkills,
  type CopilotOutcome,
} from "@/lib/copilot-skills";

const outcome = (action: string, kind: CopilotOutcome["kind"], extra: Partial<CopilotOutcome> = {}): CopilotOutcome => ({
  action,
  kind,
  at: "2026-09-19T10:00:00.000Z",
  ...extra,
});

describe("summarising what the writers decided", () => {
  it("counts decisions per action and overall", () => {
    const profile = summarizeCopilotSkills([
      outcome("tighten", "kept", { field: "content" }),
      outcome("tighten", "kept", { field: "content" }),
      outcome("tighten", "discarded", { field: "content" }),
      outcome("expand", "discarded"),
      outcome("headline", "kept", { field: "title" }),
      outcome("inspect", "fix", { opKind: "correctness" }),
      outcome("inspect", "fix", { opKind: "correctness" }),
      outcome("inspect", "fix", { opKind: "clarity" }),
      outcome("article", "article", { field: "content" }),
    ]);

    expect(profile.total).toBe(9);
    expect(profile.kept).toBe(3);
    expect(profile.discarded).toBe(2);
    expect(profile.keptRate).toBeCloseTo(0.6);
    expect(profile.perAction.tighten).toEqual({ kept: 2, discarded: 1 });
    expect(profile.topFixes[0]).toEqual({ kind: "correctness", count: 2 });
    // Fields are counted for decisions that carry one: the two kept body edits
    // and the three inline fixes with a field, not the fixes logged without one.
    expect(profile.topFields[0]).toEqual({ field: "content", count: 2 });
    expect(profile.articles).toBe(1);
    expect(profile.lastAt).toBe("2026-09-19T10:00:00.000Z");
  });

  it("reports no rate when nothing has been decided", () => {
    const profile = summarizeCopilotSkills([outcome("article", "article")]);
    expect(profile.keptRate).toBeNull();
    expect(copilotSkillNotes(profile)).toEqual([]);
  });
});

describe("what the pilot is told", () => {
  const many = (action: string, kind: CopilotOutcome["kind"], count: number) =>
    Array.from({ length: count }, () => outcome(action, kind));

  it("stays silent until there is a real sample", () => {
    // Two decisions are an anecdote, and a prompt that learns from an anecdote
    // teaches the model a falsehood.
    expect(copilotSkillNotes(summarizeCopilotSkills([...many("expand", "discarded", 2)]))).toEqual([]);
  });

  it("says what is usually rejected and what is usually wanted", () => {
    const notes = copilotSkillNotes(
      summarizeCopilotSkills([
        ...many("expand", "discarded", 4),
        ...many("tighten", "kept", 6),
        ...many("tighten", "discarded", 1),
      ])
    );
    expect(notes.some((n) => n.includes('"expand"') && n.includes("usually rejected"))).toBe(true);
    expect(notes.some((n) => n.includes('"tighten"') && n.includes("usually accepted"))).toBe(true);
    expect(notes.some((n) => /keep about \d+% of proposed edits/.test(n))).toBe(true);
  });

  it("names the corrections this publication keeps getting wrong", () => {
    const notes = copilotSkillNotes(
      summarizeCopilotSkills([
        outcome("inspect", "fix", { opKind: "correctness" }),
        outcome("inspect", "fix", { opKind: "correctness" }),
        outcome("inspect", "fix", { opKind: "clarity" }),
      ])
    );
    expect(notes.some((n) => n.includes("correctness"))).toBe(true);
  });
});

describe("what may be stored", () => {
  it("accepts a well-formed outcome and bounds its strings", () => {
    const coerced = coerceCopilotOutcome({
      action: `tighten${"x".repeat(100)}`,
      kind: "kept",
      field: "content",
      opKind: "replace-selection",
      edits: 2.6,
    });
    expect(coerced).not.toBeNull();
    expect(coerced!.action.length).toBe(40);
    expect(coerced!.kind).toBe("kept");
    expect(coerced!.edits).toBe(3);
  });

  it("rejects anything it cannot learn from", () => {
    expect(coerceCopilotOutcome(null)).toBeNull();
    expect(coerceCopilotOutcome("kept")).toBeNull();
    expect(coerceCopilotOutcome({ action: "", kind: "kept" })).toBeNull();
    expect(coerceCopilotOutcome({ action: "tighten", kind: "whatever" })).toBeNull();
  });
});
