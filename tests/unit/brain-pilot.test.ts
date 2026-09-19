import { describe, expect, it } from "vitest";
import {
  applyPilotOps,
  coercePilotOps,
  defaultOpsFor,
  diffWords,
  extractJsonObject,
  normalizePilotTags,
  parsePilotReply,
  pilotInstruction,
  reviewPilotEdits,
  PILOT_ACTIONS,
  PILOT_QUICK_ACTIONS,
  type PilotComposerState,
  type PilotRanges,
} from "@/lib/brain-pilot";

/**
 * The pilot's op vocabulary is the contract between a language model and
 * someone's article, so these tests are about *restraint* as much as function:
 * an unknown op must be dropped, an out-of-range selection must clamp, and a
 * reply that writes into the wrong field must be impossible.
 */

const STATE: PilotComposerState = {
  content: "The team shipped it. It was a very really big deal for the readers.",
  title: "A draft headline",
  excerpt: "",
  tags: ["news"],
};

const AT_START: PilotRanges = { selectionStart: 0, selectionEnd: 0, cursor: 0 };

/** The range an editor reports for a chosen passage, with no extra flags. */
function range(start: number, end: number): PilotRanges {
  return { selectionStart: start, selectionEnd: end, cursor: end };
}

describe("brain pilot — applying ops", () => {
  it("replaces exactly the selection the caller measured", async () => {
    // Indices derived from the draft rather than hard-coded, because the point
    // of the test is that the caller's range is honoured exactly.
    const start = STATE.content.indexOf("It was a very really big deal");
    const end = start + "It was a very really big deal".length;

    const result = applyPilotOps(
      STATE,
      [{ kind: "replace-selection", text: "It mattered." }],
      range(start, end)
    );

    expect(result.content).toBe("The team shipped it. It mattered. for the readers.");
    expect(result.applied).toEqual(["replaced the selection"]);
  });

  it("ignores a replace-selection when nothing was selected", async () => {
    // A model cannot conjure a range. With no selection the op has no target,
    // and rewriting the whole draft from a passage-level reply is the exact
    // corruption this guard exists to prevent.
    const result = applyPilotOps(STATE, [{ kind: "replace-selection", text: "Overwritten." }], AT_START);
    expect(result.content).toBe(STATE.content);
    expect(result.applied).toEqual([]);
  });

  it("clamps a selection that runs past the end of the draft", async () => {
    const result = applyPilotOps(
      { ...STATE, content: "Short." },
      [{ kind: "replace-selection", text: "done" }],
      range(2, 9_999)
    );
    expect(result.content).toBe("Shdone");
  });

  it("applies a surgical fix by locating the text, not an offset", async () => {
    // Offsets in a model reply are stale the moment the writer types; the
    // substring is not.
    const result = applyPilotOps(
      { ...STATE, content: "We recieve the plan and seperate it." },
      [
        { kind: "fix", find: "recieve", text: "receive" },
        { kind: "fix", find: "seperate", text: "separate" },
      ],
      AT_START
    );
    expect(result.content).toBe("We receive the plan and separate it.");
    expect(result.applied).toEqual(["applied a correction", "applied a correction"]);
  });

  it("skips a fix whose target is no longer in the draft", async () => {
    const result = applyPilotOps(STATE, [{ kind: "fix", find: "calender", text: "calendar" }], AT_START);
    expect(result.content).toBe(STATE.content);
    expect(result.applied).toEqual([]);
  });

  it("applies a fix only once, even when the text repeats", async () => {
    const result = applyPilotOps(
      { ...STATE, content: "the the plan" },
      [{ kind: "fix", find: "the the", text: "the" }],
      AT_START
    );
    expect(result.content).toBe("the plan");
  });

  it("sets the field an action targets, and leaves the body alone", async () => {
    const result = applyPilotOps(
      STATE,
      [
        { kind: "set-title", text: "Nairobi's tech scene is quietly winning" },
        { kind: "set-excerpt", text: "A short summary." },
        { kind: "add-tags", text: "technology, nairobi, startups, nairobi" },
      ],
      AT_START
    );

    expect(result.title).toBe("Nairobi's tech scene is quietly winning");
    expect(result.excerpt).toBe("A short summary.");
    // Deduplicated and capped, so a chatty model cannot produce 40 tags.
    expect(result.tags).toEqual(["news", "technology", "nairobi", "startups"]);
    expect(result.content).toBe(STATE.content);
  });

  it("reports only the changes it actually made", async () => {
    const result = applyPilotOps(
      { ...STATE, title: "Same" },
      [
        { kind: "set-title", text: "Same" },
        { kind: "add-tags", text: "news" },
        { kind: "append", text: "   " },
      ],
      AT_START
    );
    expect(result.applied).toEqual([]);
  });

  it("appends without losing the last paragraph", async () => {
    const result = applyPilotOps(STATE, [{ kind: "append", text: "More to come." }], AT_START);
    expect(result.content.endsWith("More to come.")).toBe(true);
    expect(result.content).toContain("\n\n");
    expect(result.content).toContain("It was a very really big deal");
  });

  it("applies several ops against the state each previous one produced", async () => {
    const result = applyPilotOps(
      { ...STATE, content: "recieve the plan" },
      [
        { kind: "fix", find: "recieve", text: "receive" },
        { kind: "insert-at-cursor", text: " and " },
      ],
      { selectionStart: 0, selectionEnd: 0, cursor: 7 }
    );
    expect(result.content).toBe("receive and  the plan");
  });
});

describe("brain pilot — reading a model reply", () => {
  it("reads the JSON object out of a reply wrapped in prose", async () => {
    const raw = 'Sure! Here you go:\n```json\n{"reply":"Tightened it.","ops":[{"kind":"replace-selection","text":"Better."}]}\n```';
    const parsed = parsePilotReply(raw, "improve");
    expect(parsed.degraded).toBe(false);
    expect(parsed.reply).toBe("Tightened it.");
    expect(parsed.ops).toEqual([{ kind: "replace-selection", text: "Better." }]);
  });

  it("is not confused by a brace inside a string", async () => {
    const raw = '{"reply":"ok","ops":[{"kind":"set-title","text":"Why {this} matters"}]}';
    expect(extractJsonObject(raw)).toEqual({
      reply: "ok",
      ops: [{ kind: "set-title", text: "Why {this} matters" }],
    });
  });

  it("drops an operation it does not recognise instead of the whole reply", async () => {
    const ops = coercePilotOps([
      { kind: "explain", text: "why" },
      { kind: "append", text: "A closing line." },
      { kind: "fix", text: "no target" },
      { kind: "set-title" },
    ]);
    expect(ops).toEqual([{ kind: "append", text: "A closing line." }]);
  });

  it("falls back to prose as the action's own field when JSON never arrives", async () => {
    const parsed = parsePilotReply("Nairobi's transit overhaul, explained", "headline");
    expect(parsed.degraded).toBe(true);
    expect(parsed.ops).toEqual([{ kind: "set-title", text: "Nairobi's transit overhaul, explained" }]);
  });

  it("returns nothing to write for an answer that was only conversation", async () => {
    const parsed = parsePilotReply("I can rewrite that if you select it first.", "ask");
    expect(parsed.ops).toEqual([]);
    expect(parsed.degraded).toBe(true);
  });

  it("never puts bare prose into the body", async () => {
    // The ambiguity a body action has without the structured form: with a
    // selection out it was a rewrite of that passage, without one it was the
    // whole draft. The caller resolves it, so the parser must not guess.
    expect(defaultOpsFor("improve", "Some rewritten prose.", true)).toEqual([
      { kind: "replace-selection", text: "Some rewritten prose." },
    ]);
    expect(defaultOpsFor("improve", "Some rewritten prose.", false)).toEqual([
      { kind: "replace-draft", text: "Some rewritten prose." },
    ]);
    expect(defaultOpsFor("ask", "Some rewritten prose.", true)).toEqual([]);
  });
});

describe("brain pilot — reviewing edits before they land", () => {
  const RANGES = range(0, 0);

  it("diffs a rewrite as the phrase that changed, not the whole draft", async () => {
    const before = "The team shipped it. It was a very really big deal for the readers.";
    const after = "The team shipped it. It mattered to the readers.";
    const diff = diffWords(before, after);

    // The unchanged head and tail are shared, so only the rewritten middle is
    // marked. A diff that reprints the whole paragraph is noise for a writer.
    expect(diff[0]?.type).toBe("same");
    expect(diff[0]?.text).toContain("The team shipped it.");
    expect(diff.some((s) => s.type === "del" && s.text.includes("very really big deal"))).toBe(true);
    expect(diff.some((s) => s.type === "add" && s.text.includes("mattered"))).toBe(true);
    expect(diff[diff.length - 1]?.type).toBe("same");
    // Nothing that survived is marked as changed.
    for (const seg of diff) {
      if (seg.type === "same") expect(seg.text).not.toContain("very really big deal");
    }
  });

  it("reports no diff for an identical string", async () => {
    expect(diffWords("same", "same")).toEqual([{ type: "same", text: "same" }]);
    expect(diffWords("", "")).toEqual([]);
  });

  it("stays bounded on a draft too large to align exactly", async () => {
    const big = Array.from({ length: 4_000 }, (_, i) => `word${i}`).join(" ");
    const other = big.replace("word2000", "CHANGED");
    const diff = diffWords(big, other);

    // Past the alignment cap the middle is reported as one replaced block rather
    // than an exact alignment — honest, and cheap enough to run on every reply.
    expect(diff.some((s) => s.type === "del" && s.text.includes("word2000"))).toBe(true);
    expect(diff.some((s) => s.type === "add" && s.text.includes("CHANGED"))).toBe(true);
  });

  it("previews each edit as a field change the writer can read", async () => {
    const state: PilotComposerState = { content: "We recieve the plan.", title: "", excerpt: "", tags: [] };
    const reviews = reviewPilotEdits(
      state,
      [
        { kind: "fix", find: "recieve", text: "receive" },
        { kind: "set-title", text: "A better headline" },
      ],
      RANGES
    );

    expect(reviews).toHaveLength(2);
    expect(reviews[0]?.field).toBe("content");
    expect(reviews[0]?.before).toBe("We recieve the plan.");
    expect(reviews[0]?.after).toBe("We receive the plan.");
    expect(reviews[0]?.noop).toBe(false);
    expect(reviews[1]?.field).toBe("title");
    expect(reviews[1]?.after).toBe("A better headline");
  });

  it("flags an edit that cannot be applied instead of pretending it changed something", async () => {
    const state: PilotComposerState = { content: "A short draft.", title: "", excerpt: "", tags: [] };
    const reviews = reviewPilotEdits(
      state,
      [
        { kind: "fix", find: "calender", text: "calendar" },
        { kind: "replace-selection", text: "Rewritten." },
      ],
      RANGES
    );

    expect(reviews[0]?.impossible).toBe(true);
    expect(reviews[1]?.impossible).toBe(true);
    // An edit that cannot apply shows no change at all: every diff run is
    // "same", so the panel never implies something moved.
    expect(reviews[0]?.segments.every((s) => s.type === "same")).toBe(true);
    expect(reviews[0]?.before).toBe(reviews[0]?.after);
  });

  it("previews a stack of edits against the state the earlier ones produce", async () => {
    const state: PilotComposerState = { content: "recieve the plan", title: "", excerpt: "", tags: [] };
    const reviews = reviewPilotEdits(
      state,
      [
        { kind: "fix", find: "recieve", text: "receive" },
        { kind: "fix", find: "the plan", text: "the roadmap" },
      ],
      RANGES
    );

    // The second edit reads against the first, so "keep all" is exactly what the
    // panel showed — no surprise recomputation at apply time.
    expect(reviews[1]?.before).toBe("receive the plan");
    expect(reviews[1]?.after).toBe("receive the roadmap");
  });

  it("labels the field each edit targets", async () => {
    const state: PilotComposerState = { content: "draft", title: "t", excerpt: "", tags: [] };
    const reviews = reviewPilotEdits(
      state,
      [
        { kind: "add-tags", text: "tech" },
        { kind: "set-excerpt", text: "Summary" },
        { kind: "append", text: "Closing." },
      ],
      RANGES
    );
    expect(reviews.map((r) => r.field)).toEqual(["tags", "excerpt", "content"]);
  });
});

describe("brain pilot — the vocabulary itself", () => {
  it("offers a short, fixed set of inline actions", async () => {
    expect(PILOT_QUICK_ACTIONS.length).toBeLessThanOrEqual(6);
    for (const action of PILOT_QUICK_ACTIONS) {
      expect(PILOT_ACTIONS).toContain(action.id);
      expect(action.hint.length).toBeGreaterThan(5);
    }
  });

  it("gives every action a self-contained instruction", async () => {
    for (const action of PILOT_ACTIONS) {
      const instruction = pilotInstruction(action);
      expect(instruction.length).toBeGreaterThan(20);
    }
  });

  it("carries the writer's free-text instruction through to the model", async () => {
    expect(pilotInstruction("ask", "make it sound less like a press release")).toContain(
      "less like a press release"
    );
  });

  it("normalises tags the way the composer stores them", async () => {
    expect(normalizePilotTags("  #East Africa , CLIMATE ,, tech ")).toEqual([
      "east-africa",
      "climate",
      "tech",
    ]);
  });
});
