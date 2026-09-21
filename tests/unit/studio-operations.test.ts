import { describe, expect, it, vi } from "vitest";

/**
 * Structured composer operations.
 *
 * The assertions that carry the weight are the *rejections*, because that is what
 * a free-text suggestion could not do:
 *
 *   - a stale operation is refused rather than applied;
 *   - a `fix` whose target text has gone is refused rather than applied at a
 *     guessed offset;
 *   - an ambiguous `find` is refused rather than resolved by picking the first;
 *   - an operation targeting the wrong field is refused rather than written.
 *
 * Each of those, applied anyway, is a way the Copilot silently damages a writer's
 * draft.
 */

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const { applyComposerPatch, createComposerSession } = await import("@/lib/studio/composer");
const {
  OPERATION_TARGET,
  applyOperations,
  canRedo,
  canUndo,
  createEditHistory,
  describeTransaction,
  parseTagText,
  recordTransaction,
  redo,
  undo,
  validateOperations,
} = await import("@/lib/studio/operations");

type Operation = Parameters<typeof validateOperations>[0][number];

/** A composer holding a known body, and an operation base matching it. */
function setup(content = "The quick brown fox jumps over the lazy dog.") {
  const state = applyComposerPatch(createComposerSession("session-x"), { content }).state;
  const base = { baseRevision: state.revision, baseHash: state.contentHash, mode: "model" as const };
  const op = (overrides: Partial<Operation> & Pick<Operation, "kind" | "field">): Operation => ({
    id: overrides.id ?? "op-1",
    text: "replacement",
    reason: "tighten this sentence",
    confidence: 0.8,
    ...base,
    ...overrides,
  });
  return { state, op };
}

describe("validateOperations — property targeting", () => {
  it("rejects an operation aimed at a field its kind may not touch", () => {
    // A `set-title` writing into the body is the free-text failure mode made
    // concrete: nothing in a bare string said which field it belonged to.
    const { state, op } = setup();
    const result = validateOperations([op({ kind: "set-title", field: "content", text: "New title" })], state);
    expect(result.applicable).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("cannot target the content field");
  });

  it("accepts each kind on the fields it declares", () => {
    for (const [kind, fields] of Object.entries(OPERATION_TARGET)) {
      for (const field of fields) {
        const { state, op } = setup();
        const result = validateOperations([op({ kind: kind as Operation["kind"], field })], state);
        expect(result.rejected.some((r) => r.reason.includes("cannot target")), `${kind} → ${field}`).toBe(false);
      }
    }
  });

  it("rejects an unknown operation kind rather than ignoring it", () => {
    const { state, op } = setup();
    const bogus = { ...op({ kind: "set-title", field: "title", text: "T" }), kind: "delete-everything" } as unknown as Operation;
    expect(validateOperations([bogus], state).rejected[0]?.reason).toContain("unknown operation kind");
  });
});

describe("validateOperations — staleness", () => {
  it("rejects the whole set when the draft has moved on", () => {
    // The brief's rule: the Copilot must not overwrite newer content.
    const { state, op } = setup();
    const moved = applyComposerPatch(state, { content: "The quick brown fox jumps over the sleeping dog." }).state;
    const result = validateOperations([op({ kind: "replace-selection", field: "content" })], moved);

    expect(result.stale).toBe(true);
    expect(result.applicable).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("revision");
    expect(result.staleReason).toBeTruthy();
  });

  it("rejects a set written against a different document", () => {
    const { op } = setup();
    const otherState = applyComposerPatch(createComposerSession("session-x"), { content: "different" }).state;
    const result = validateOperations(
      [{ ...op({ kind: "append", field: "content" }), baseRevision: otherState.revision, baseHash: "f".repeat(64) }],
      otherState
    );
    expect(result.stale).toBe(true);
  });

  it("accepts a set written against the current draft", () => {
    const { state, op } = setup();
    const result = validateOperations([op({ kind: "append", field: "content", text: " More." })], state);
    expect(result.stale).toBe(false);
    expect(result.applicable).toHaveLength(1);
  });
});

describe("validateOperations — find-based operations", () => {
  it("rejects a fix whose target text is no longer present", () => {
    // Applying at a guessed offset is how a suggestion lands in the wrong place.
    const { state, op } = setup();
    const result = validateOperations(
      [op({ kind: "fix", field: "content", find: "purple elephant", text: "grey elephant" })],
      state
    );
    expect(result.applicable).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("not in the draft any more");
  });

  it("rejects an ambiguous find rather than replacing the first occurrence", () => {
    // "the" appears twice below; replacing either would be as likely wrong as
    // right, so the writer is asked to select the passage instead.
    const { state, op } = setup("the cat sat on the mat");
    const result = validateOperations([op({ kind: "fix", field: "content", find: "the", text: "a" })], state);
    expect(result.applicable).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("appears more than once");
  });

  it("requires a find for a fix operation", () => {
    const { state, op } = setup();
    const result = validateOperations([op({ kind: "fix", field: "content", find: null, text: "x" })], state);
    expect(result.rejected[0]?.reason).toContain("must supply the exact text");
  });

  it("resolves the range for a unique find", () => {
    const { state, op } = setup("The quick brown fox.");
    const result = validateOperations([op({ kind: "fix", field: "content", find: "brown", text: "red" })], state);
    expect(result.applicable).toHaveLength(1);
    expect(result.applicable[0]?.range).toEqual({ start: 10, end: 15 });
  });
});

describe("validateOperations — ranges and overlaps", () => {
  it("refuses a replace-selection with nothing selected", () => {
    const { state, op } = setup();
    expect(state.selection).toBeNull();
    const result = validateOperations([op({ kind: "replace-selection", field: "content" })], state);
    expect(result.rejected[0]?.reason).toContain("no selection to replace");
  });

  it("anchors an insert-at-cursor to the current selection end", () => {
    const base = setup().state;
    const withSelection = applyComposerPatch(base, { selection: { start: 4, end: 9 } }).state;
    const { op } = setup();
    const opWithBase = { ...op({ kind: "insert-at-cursor", field: "content", text: " X" }), baseRevision: withSelection.revision, baseHash: withSelection.contentHash };
    const result = validateOperations([opWithBase], withSelection);
    expect(result.applicable[0]?.range).toEqual({ start: 9, end: 9 });
  });

  it("refuses two operations that claim overlapping text", () => {
    // Applying the second would act on offsets the first has already moved.
    const base = setup().state;
    const withSelection = applyComposerPatch(base, { selection: { start: 4, end: 20 } }).state;
    const shared = { baseRevision: withSelection.revision, baseHash: withSelection.contentHash, mode: "model" as const };
    const result = validateOperations(
      [
        { id: "a", kind: "replace-selection", field: "content", text: "one", reason: "r", confidence: 0.9, ...shared },
        { id: "b", kind: "replace-selection", field: "content", text: "two", reason: "r", confidence: 0.9, ...shared },
      ],
      withSelection
    );
    expect(result.applicable).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain("overlaps another");
  });
});

describe("validateOperations — content and warnings", () => {
  it("rejects an operation with no text where text is required", () => {
    const { state, op } = setup();
    const result = validateOperations([op({ kind: "set-title", field: "title", text: "   " })], state);
    expect(result.rejected[0]?.reason).toContain("nothing to apply");
  });

  it("allows replace-draft to be empty, and warns loudly because it is the destructive one", () => {
    const { state, op } = setup();
    const result = validateOperations([op({ kind: "replace-draft", field: "content", text: "" })], state);
    expect(result.applicable).toHaveLength(1);
    expect(result.replacesWholeDraft).toBe(true);
    expect(result.warnings.join(" ")).toContain("replaces the entire draft body");
  });

  it("warns when an operation is unverified or degraded, so the writer knows to check it", () => {
    const { state, op } = setup();
    const unverified = validateOperations([op({ kind: "append", field: "content", mode: "unverified" })], state);
    expect(unverified.warnings.join(" ")).toContain("unverified");

    const { state: s2, op: op2 } = setup();
    const degraded = validateOperations([op2({ kind: "append", field: "content", mode: "degraded" })], state);
    expect(degraded.warnings.join(" ")).toContain("degraded");
    void s2;
  });

  it("warns about low confidence without refusing the suggestion", () => {
    const { state, op } = setup();
    const result = validateOperations([op({ kind: "append", field: "content", confidence: 0.1 })], state);
    expect(result.warnings.join(" ")).toContain("low confidence");
    expect(result.applicable).toHaveLength(1);
  });

  it("rejects an oversized proposal rather than applying part of it", () => {
    const { state, op } = setup();
    const many = Array.from({ length: 50 }, (_, i) => op({ id: `op-${i}`, kind: "append", field: "content", text: `${i}` }));
    const result = validateOperations(many, state);
    expect(result.applicable).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("above the limit");
  });

  it("rejects a proposal with an enormous single field", () => {
    const { state, op } = setup();
    const result = validateOperations([op({ kind: "set-title", field: "title", text: "x".repeat(300_000) })], state);
    expect(result.rejected[0]?.reason).toContain("above the limit");
  });

  it("rejects a tag proposal with no usable tags", () => {
    const { state, op } = setup();
    expect(validateOperations([op({ kind: "add-tags", field: "tags", text: ",,," })], state).rejected).toHaveLength(1);
  });
});

describe("applyOperations", () => {
  it("applies a valid set and records exactly one transaction", () => {
    // One Ctrl+Z must undo the whole editorial intention, not one operation of it.
    const { state, op } = setup();
    const validated = validateOperations(
      [
        op({ id: "a", kind: "set-title", field: "title", text: "A better title" }),
        op({ id: "b", kind: "append", field: "content", text: " More." }),
      ],
      state
    );
    const result = applyOperations(state, validated.applicable);
    expect(result.state.title).toBe("A better title");
    expect(result.state.content).toContain("More.");
    expect(result.transaction?.operationIds).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("applies edits against original offsets so a later edit does not shift an earlier one", () => {
    // Computed front-to-back, the second replacement would act on text the first
    // had already moved.
    const { state } = setup("aaa bbb ccc");
    const shared = { baseRevision: state.revision, baseHash: state.contentHash, mode: "model" as const, reason: "r", confidence: 0.9 };
    const validated = validateOperations(
      [
        { id: "1", kind: "fix", field: "content", find: "aaa", text: "AAAA", ...shared },
        { id: "2", kind: "fix", field: "content", find: "ccc", text: "CCCC", ...shared },
      ],
      state
    );
    const result = applyOperations(state, validated.applicable);
    expect(result.state.content).toBe("AAAA bbb CCCC");
  });

  it("produces no transaction when the set resolves to no change", () => {
    // Otherwise the undo history fills with entries that undo nothing.
    const { state, op } = setup();
    const validated = validateOperations([op({ kind: "append", field: "content", text: "" })], state);
    const result = applyOperations(state, validated.applicable.filter((o) => o.text !== ""));
    expect(result.transaction).toBeNull();
  });

  it("merges tags without creating duplicates and keeps the cap", () => {
    const base = applyComposerPatch(createComposerSession("s"), { content: "body" }).state;
    const withTags = applyComposerPatch(base, { tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }).state;
    const shared = { baseRevision: withTags.revision, baseHash: withTags.contentHash, mode: "model" as const, reason: "r", confidence: 0.9 };
    const validated = validateOperations(
      [{ id: "1", kind: "add-tags", field: "tags", text: "t0, fresh, another", ...shared }],
      withTags
    );
    const result = applyOperations(withTags, validated.applicable);
    expect(result.state.tags).toContain("fresh");
    expect(result.state.tags.filter((t) => t === "t0")).toHaveLength(1);
    expect(result.state.tags.length).toBeLessThanOrEqual(10);
  });

  it("advances the revision and marks the document dirty", () => {
    const { state, op } = setup();
    const validated = validateOperations([op({ kind: "append", field: "content", text: " X" })], state);
    const result = applyOperations(state, validated.applicable);
    expect(result.state.revision).toBe(state.revision + 1);
    expect(result.state.dirty).toBe(true);
  });

  it("returns the state unchanged when given nothing to apply", () => {
    const { state } = setup();
    expect(applyOperations(state, []).state).toBe(state);
    expect(applyOperations(state, []).transaction).toBeNull();
  });
});

describe("parseTagText", () => {
  it("normalises, de-duplicates and bounds tags", () => {
    expect(parseTagText("News, news,  Spaced Out , ,x")).toEqual(["news", "spaced-out"]);
  });

  it("rejects tags that are too short or too long", () => {
    expect(parseTagText("a, ok, " + "x".repeat(60))).toEqual(["ok"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseTagText(null)).toEqual([]);
    expect(parseTagText("")).toEqual([]);
  });
});

describe("undo and redo", () => {
  it("restores the document to before the transaction", () => {
    const { state, op } = setup("Original body");
    const validated = validateOperations([op({ kind: "replace-draft", field: "content", text: "Rewritten" })], state);
    const applied = applyOperations(state, validated.applicable);
    const history = recordTransaction(createEditHistory(), applied.transaction!);

    const back = undo(history, applied.state);
    expect(back.state.content).toBe("Original body");
    expect(back.transaction?.after.content).toBe("Rewritten");
  });

  it("re-applies the transaction on redo", () => {
    const { state, op } = setup("Original body");
    const validated = validateOperations([op({ kind: "replace-draft", field: "content", text: "Rewritten" })], state);
    const applied = applyOperations(state, validated.applicable);
    const history = recordTransaction(createEditHistory(), applied.transaction!);

    const back = undo(history, applied.state);
    const forward = redo(back.history, back.state);
    expect(forward.state.content).toBe("Rewritten");
  });

  it("refuses to undo past the start and to redo past the end", () => {
    const { state } = setup();
    const fresh = createEditHistory();
    expect(canUndo(fresh)).toBe(false);
    expect(canRedo(fresh)).toBe(false);
    expect(undo(fresh, state).transaction).toBeNull();
    expect(redo(fresh, state).transaction).toBeNull();
  });

  it("advances the revision on undo, so the undone state is still saveable", () => {
    // An undo is an edit, not a rollback of history: the server must be told.
    const { state, op } = setup("A");
    const validated = validateOperations([op({ kind: "replace-draft", field: "content", text: "B" })], state);
    const applied = applyOperations(state, validated.applicable);
    const history = recordTransaction(createEditHistory(), applied.transaction!);
    const back = undo(history, applied.state);
    expect(back.state.revision).toBeGreaterThan(applied.state.revision);
    expect(back.state.dirty).toBe(true);
  });

  it("discards the redo branch when a new change follows an undo", () => {
    // A timeline, not a log: pretending the abandoned edits are reachable would
    // let the composer hold a state that never existed.
    const { state, op } = setup("A");
    const first = applyOperations(state, validateOperations([op({ id: "1", kind: "replace-draft", field: "content", text: "B" })], state).applicable);
    let history = recordTransaction(createEditHistory(), first.transaction!);
    const back = undo(history, first.state);
    history = back.history;

    const second = applyOperations(
      back.state,
      validateOperations(
        [{ ...op({ id: "2", kind: "replace-draft", field: "content", text: "C" }), baseRevision: back.state.revision, baseHash: back.state.contentHash }],
        back.state
      ).applicable
    );
    history = recordTransaction(history, second.transaction!);

    expect(canRedo(history)).toBe(false);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]?.after.content).toBe("C");
  });

  it("bounds the history so a long session cannot hold every version of the body", () => {
    let history = createEditHistory();
    let state = applyComposerPatch(createComposerSession("s"), { content: "start" }).state;
    for (let i = 0; i < 60; i++) {
      const validated = validateOperations(
        [{ id: `op-${i}`, kind: "append", field: "content", text: " x", reason: "r", confidence: 0.9, baseRevision: state.revision, baseHash: state.contentHash, mode: "model" }],
        state
      );
      const applied = applyOperations(state, validated.applicable);
      state = applied.state;
      history = recordTransaction(history, applied.transaction!);
    }
    expect(history.entries.length).toBeLessThanOrEqual(50);
    expect(history.cursor).toBe(history.entries.length);
  });
});

describe("describeTransaction", () => {
  it("names the changed fields and the actor", () => {
    const { state, op } = setup("A");
    const validated = validateOperations([op({ kind: "set-title", field: "title", text: "T" })], state);
    const applied = applyOperations(state, validated.applicable, { source: "copilot", reason: "sharper title" });
    const line = describeTransaction(applied.transaction!);
    expect(line).toContain("Copilot");
    expect(line).toContain("title");
    expect(line).toContain("sharper title");
  });

  it("attributing a change to the writer when it is not from the Copilot", () => {
    const { state, op } = setup("A");
    const validated = validateOperations([op({ kind: "set-title", field: "title", text: "T" })], state);
    const applied = applyOperations(state, validated.applicable, { source: "manual", reason: "typed" });
    expect(describeTransaction(applied.transaction!)).toContain("You");
  });
});
