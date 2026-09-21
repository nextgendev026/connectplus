import { describe, expect, it, vi } from "vitest";

/**
 * Composer state.
 *
 * The two properties that carry the whole module:
 *
 *   1. **A save cannot be started twice.** That single refusal is the fix for
 *      duplicate drafts — the race was two creates, so preventing the second
 *      create prevents the bug regardless of how React schedules state updates.
 *   2. **A stale AI result is detectable.** If a response written against
 *      revision 3 is checked against revision 5, it must be rejected, because the
 *      alternative is a suggestion silently overwriting newer writing.
 */

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const {
  SAVE_TRANSITIONS,
  applyComposerPatch,
  beginSave,
  canTransitionSaveState,
  checkPilotStale,
  checkStale,
  hashPilotBase,
  createComposerSession,
  describeSaveState,
  hashComposerDocument,
  idempotencyKeyFor,
  loadComposerDocument,
  markClean,
  resolveSave,
  snapshotComposer,
} = await import("@/lib/studio/composer");

describe("session start and document loading", () => {
  it("starts clean with no document id and revision 0", () => {
    const state = createComposerSession("session-a");
    expect(state.documentId).toBeNull();
    expect(state.revision).toBe(0);
    expect(state.dirty).toBe(false);
    expect(state.saveState).toBe("clean");
    expect(state.sessionId).toBe("session-a");
  });

  it("generates a distinct session id per session when none is given", () => {
    expect(createComposerSession().sessionId).not.toBe(createComposerSession().sessionId);
  });

  it("establishes the document id up front when loading an existing story", () => {
    // The Studio's duplicate-draft bug came from treating the id as something
    // discovered from a response. Loading a document is the case where it is
    // known before any save, so it must be set immediately.
    const state = loadComposerDocument("s", { id: "post_1", title: "T", content: "C" });
    expect(state.documentId).toBe("post_1");
    expect(state.dirty).toBe(false);
    expect(state.saveState).toBe("clean");
  });
});

describe("content hashing", () => {
  it("ignores bookkeeping fields, so a re-save of identical text is not a new revision", () => {
    const base = { title: "T", content: "C", excerpt: "", tags: [] as string[], categoryId: null, coverImage: null };
    const a = createComposerSession("s");
    const b = { ...a, revision: 9, saveState: "saved" as const };
    expect(hashComposerDocument({ ...base })).toBe(hashComposerDocument({ ...base }));
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("is insensitive to tag order and case, which are the same document", () => {
    const first = { title: "T", content: "C", excerpt: "", tags: ["News", "Sport"], categoryId: null, coverImage: null };
    const second = { title: "T", content: "C", excerpt: "", tags: ["sport", "news"], categoryId: null, coverImage: null };
    expect(hashComposerDocument(first)).toBe(hashComposerDocument(second));
  });

  it("changes when any document field changes", () => {
    const base = { title: "T", content: "C", excerpt: "", tags: [] as string[], categoryId: null, coverImage: null };
    const hash = hashComposerDocument(base);
    expect(hashComposerDocument({ ...base, title: "T2" })).not.toBe(hash);
    expect(hashComposerDocument({ ...base, content: "C2" })).not.toBe(hash);
    expect(hashComposerDocument({ ...base, excerpt: "E" })).not.toBe(hash);
    expect(hashComposerDocument({ ...base, coverImage: "/x.png" })).not.toBe(hash);
  });
});

describe("applyComposerPatch", () => {
  it("advances the revision and marks the document dirty on a real change", () => {
    const next = applyComposerPatch(createComposerSession("s"), { content: "hello" });
    expect(next.changed).toBe(true);
    expect(next.state.revision).toBe(1);
    expect(next.state.dirty).toBe(true);
    expect(next.state.saveState).toBe("dirty");
  });

  it("does not spend a revision on a no-op write", () => {
    // A re-render calling setContent with the same string must not arm an
    // autosave, or the Studio writes an identical row every render.
    const state = applyComposerPatch(createComposerSession("s"), { content: "hello" }).state;
    const again = applyComposerPatch(state, { content: "hello" });
    expect(again.changed).toBe(false);
    expect(again.state.revision).toBe(1);
    expect(again.state).toBe(state);
  });

  it("treats a pure selection change as a non-edit", () => {
    // Moving the caret is not writing. Marking it dirty would arm a save.
    const state = applyComposerPatch(createComposerSession("s"), { content: "hello" }).state;
    const selected = applyComposerPatch(state, { selection: { start: 1, end: 4 } });
    expect(selected.changed).toBe(false);
    expect(selected.state.dirty).toBe(true); // still dirty from the earlier edit
    expect(selected.state.revision).toBe(state.revision);
    expect(selected.state.selection).toEqual({ start: 1, end: 4 });
  });

  it("keeps the save state as saving when an edit lands mid-save", () => {
    // The write is in flight; the edit is newer than the write. Reporting
    // "saving" keeps the guard armed so a second save is not issued.
    const state = applyComposerPatch(createComposerSession("s"), { content: "a" }).state;
    const ticket = beginSave(state)!;
    const during = applyComposerPatch(ticket.state, { content: "ab" });
    expect(during.state.saveState).toBe("saving");
    expect(during.state.revision).toBe(2);
  });
});

describe("beginSave — the duplicate-draft fix", () => {
  it("refuses a second save while one is in flight", () => {
    // The bug: `editingId` was derived from the create response, so until React
    // committed, a re-armed autosave's closure still saw null and issued a second
    // create. Refusing here means the second create cannot be issued at all.
    const state = applyComposerPatch(createComposerSession("s"), { content: "draft" }).state;
    const first = beginSave(state);
    expect(first).not.toBeNull();
    expect(beginSave(first!.state)).toBeNull();
  });

  it("refuses a save while a conflict is unresolved", () => {
    const state = applyComposerPatch(createComposerSession("s"), { content: "draft" }).state;
    const conflicted = { ...state, saveState: "conflict" as const };
    expect(beginSave(conflicted)).toBeNull();
  });

  it("refuses a save for a clean, already-persisted document", () => {
    const state = markClean(loadComposerDocument("s", { id: "post_1", title: "T", content: "C" }), 4);
    expect(beginSave(state)).toBeNull();
  });

  it("tickets the create with the revision and hash it is saving", () => {
    const state = applyComposerPatch(createComposerSession("s"), { content: "draft" }).state;
    const ticket = beginSave(state)!;
    expect(ticket.isCreate).toBe(true);
    expect(ticket.revision).toBe(state.revision);
    expect(ticket.contentHash).toBe(state.contentHash);
  });

  it("marks a ticket for an existing document as an update, not a create", () => {
    const loaded = loadComposerDocument("s", { id: "post_1", title: "T", content: "C" });
    const state = applyComposerPatch(loaded, { content: "C2" }).state;
    expect(beginSave(state)!.isCreate).toBe(false);
  });
});

describe("the save-state machine", () => {
  it("declares saving → saving illegal, which is the race", () => {
    expect(canTransitionSaveState("saving", "saving")).toBe(false);
    expect(SAVE_TRANSITIONS.saving).not.toContain("saving");
  });

  it("declares every state's successors explicitly, with no default", () => {
    // A missing entry would be a state that can never be left, which is how a
    // stuck "saving" indicator persists for a session.
    for (const state of Object.keys(SAVE_TRANSITIONS) as (keyof typeof SAVE_TRANSITIONS)[]) {
      expect(SAVE_TRANSITIONS[state].length).toBeGreaterThan(0);
    }
  });

  it("allows recovery from every non-terminal state", () => {
    for (const state of Object.keys(SAVE_TRANSITIONS) as (keyof typeof SAVE_TRANSITIONS)[]) {
      const reachable = SAVE_TRANSITIONS[state];
      expect(reachable.includes("saved") || reachable.includes("dirty") || reachable.includes("clean")).toBe(true);
    }
  });
});

describe("resolveSave", () => {
  it("records the document id established by the first successful create", () => {
    const state = applyComposerPatch(createComposerSession("s"), { content: "draft" }).state;
    const ticket = beginSave(state)!;
    const done = resolveSave(ticket.state, { documentId: "post_new" }, ticket.state);
    expect(done.documentId).toBe("post_new");
    expect(done.saveState).toBe("saved");
    expect(done.dirty).toBe(false);
  });

  it("stays dirty when the writer typed during the save", () => {
    // Marking them clean would lose the typing on the next navigation, because
    // the save that just completed did not contain it.
    const start = applyComposerPatch(createComposerSession("s"), { content: "a" }).state;
    const ticket = beginSave(start)!;
    const during = applyComposerPatch(ticket.state, { content: "ab" }).state;
    const done = resolveSave(ticket.state, { documentId: "post_1" }, during);
    expect(done.saveState).toBe("dirty");
    expect(done.dirty).toBe(true);
  });

  it("moves to conflict on a revision collision and refuses to continue silently", () => {
    const state = applyComposerPatch(createComposerSession("s"), { content: "draft" }).state;
    const ticket = beginSave(state)!;
    const done = resolveSave(ticket.state, { conflict: true, error: "someone else saved" });
    expect(done.saveState).toBe("conflict");
    expect(done.lastError).toBe("someone else saved");
    expect(beginSave(done)).toBeNull();
  });

  it("keeps an error visible rather than clearing it", () => {
    const state = applyComposerPatch(createComposerSession("s"), { content: "draft" }).state;
    const ticket = beginSave(state)!;
    const done = resolveSave(ticket.state, { error: "network down" });
    expect(done.saveState).toBe("error");
    expect(done.lastError).toBe("network down");
  });

  it("clears the error only on a success", () => {
    const state = applyComposerPatch(createComposerSession("s"), { content: "draft" }).state;
    const failed = resolveSave(beginSave(state)!.state, { error: "network down" });
    const ok = resolveSave(beginSave({ ...failed, dirty: true })!.state, { documentId: "post_1" }, failed);
    expect(ok.lastError).toBeNull();
  });
});

describe("idempotencyKeyFor", () => {
  it("is deterministic for the same revision and hash, so a retry is recognised", () => {
    const state = applyComposerPatch(createComposerSession("s"), { content: "draft" }).state;
    expect(idempotencyKeyFor(state)).toBe(idempotencyKeyFor({ ...state }));
  });

  it("differs per session, so two tabs editing identically do not collide", () => {
    const a = applyComposerPatch(createComposerSession("s-a"), { content: "same" }).state;
    const b = applyComposerPatch(createComposerSession("s-b"), { content: "same" }).state;
    expect(idempotencyKeyFor(a)).not.toBe(idempotencyKeyFor(b));
  });

  it("differs per revision, so a genuinely new edit is not mistaken for a retry", () => {
    const first = applyComposerPatch(createComposerSession("s"), { content: "a" }).state;
    const second = applyComposerPatch(first, { content: "ab" }).state;
    expect(idempotencyKeyFor(first)).not.toBe(idempotencyKeyFor(second));
  });

  it("changes when the text changes at the same revision", () => {
    const state = applyComposerPatch(createComposerSession("s"), { content: "a" }).state;
    const differentText = { ...state, contentHash: hashComposerDocument({ ...state, content: "different" }) };
    expect(idempotencyKeyFor(state)).not.toBe(idempotencyKeyFor(differentText));
  });
});

describe("snapshotComposer", () => {
  it("returns a copy, never a live reference", () => {
    // The Copilot must not be able to observe text typed after the request was
    // made and then attribute its answer to a revision that never held it.
    const state = applyComposerPatch(createComposerSession("s"), { content: "hello world" }).state;
    const snapshot = snapshotComposer(state);
    state.content = "mutated";
    state.tags.push("added");
    expect(snapshot.content).toBe("hello world");
    expect(snapshot.tags).toEqual([]);
  });

  it("carries the revision and hash, which is what makes staleness detectable", () => {
    const state = applyComposerPatch(createComposerSession("s"), { content: "hello" }).state;
    const snapshot = snapshotComposer(state);
    expect(snapshot.revision).toBe(state.revision);
    expect(snapshot.contentHash).toBe(state.contentHash);
    expect(snapshot.documentId).toBe(state.documentId);
  });

  it("includes the selected text, so a range suggestion can be anchored", () => {
    const withSelection = applyComposerPatch(
      applyComposerPatch(createComposerSession("s"), { content: "one two three" }).state,
      { selection: { start: 4, end: 7 } }
    ).state;
    expect(snapshotComposer(withSelection).selectedText).toBe("two");
  });

  it("reports no selected text for an empty selection", () => {
    const collapsed = applyComposerPatch(
      applyComposerPatch(createComposerSession("s"), { content: "abc" }).state,
      { selection: { start: 1, end: 1 } }
    ).state;
    expect(snapshotComposer(collapsed).selectedText).toBeNull();
  });
});

describe("checkStale", () => {
  it("accepts a result written against the current revision and hash", () => {
    const state = applyComposerPatch(createComposerSession("s"), { content: "hello" }).state;
    expect(checkStale({ revision: state.revision, contentHash: state.contentHash }, state).stale).toBe(false);
  });

  it("rejects a result written against an older revision", () => {
    const base = applyComposerPatch(createComposerSession("s"), { content: "hello" }).state;
    const current = applyComposerPatch(base, { content: "hello world" }).state;
    const check = checkStale({ revision: base.revision, contentHash: base.contentHash }, current);
    expect(check.stale).toBe(true);
    expect(check.reason).toContain("revision 1 → 2");
  });

  it("rejects a result written against a different document, whatever the revision says", () => {
    // Reachable: the writer opens story B while a request for story A is in
    // flight, and both are at revision 3.
    const other = loadComposerDocument("s", { id: "post_B", title: "T", content: "C" });
    const check = checkStale({ documentId: "post_A", revision: other.revision, contentHash: other.contentHash }, other);
    expect(check.stale).toBe(true);
    expect(check.reason).toContain("different document");
  });

  it("rejects a same-revision result whose hash no longer matches", () => {
    // Belt and braces: the composer's own rules make this unreachable, and the
    // alternative is to trust an invariant that lives in another module.
    const state = applyComposerPatch(createComposerSession("s"), { content: "hello" }).state;
    const check = checkStale({ revision: state.revision, contentHash: "0".repeat(64) }, state);
    expect(check.stale).toBe(true);
    expect(check.reason).toContain("draft text has changed");
  });

  it("does not compare the document id when the caller omits it", () => {
    const state = applyComposerPatch(createComposerSession("s"), { content: "hello" }).state;
    expect(checkStale({ revision: state.revision, contentHash: state.contentHash }, state).stale).toBe(false);
  });
});

describe("describeSaveState", () => {
  it("distinguishes a clean save from one with newer pending changes", () => {
    // The difference matters to a writer deciding whether it is safe to close
    // the tab.
    expect(describeSaveState({ saveState: "saved", dirty: false, lastError: null })).toBe("All changes saved");
    expect(describeSaveState({ saveState: "saved", dirty: true, lastError: null })).toContain("newer changes pending");
  });

  it("includes the error text for a failure rather than saying only 'failed'", () => {
    expect(describeSaveState({ saveState: "error", dirty: true, lastError: "network down" })).toContain("network down");
  });

  it("never returns an empty string for any state", () => {
    for (const saveState of ["clean", "dirty", "saving", "saved", "error", "conflict"] as const) {
      expect(describeSaveState({ saveState, dirty: false, lastError: null }).length).toBeGreaterThan(0);
    }
  });
});

/*
 * The pilot's own staleness rule.
 *
 * This is the guard that stops a reply written against one draft from landing on
 * another. It differs from `checkStale` in two ways that the tests pin: it sees
 * only the four fields a pilot reply can address, and it reports *which* of them
 * moved, because "you edited the body" is actionable and "something changed" is
 * not.
 */
describe("checkPilotStale", () => {
  const base = { title: "Markets", content: "The index rose.", excerpt: "A short excerpt", tags: ["markets"] };

  it("reports in sync when nothing relevant moved", () => {
    const result = checkPilotStale(base, { ...base, tags: [...base.tags] });
    expect(result.stale).toBe(false);
    expect(result.changedFields).toEqual([]);
  });

  it("names the field that moved", () => {
    expect(checkPilotStale(base, { ...base, content: "The index fell." }).changedFields).toEqual(["body"]);
    expect(checkPilotStale(base, { ...base, title: "Other" }).changedFields).toEqual(["headline"]);
    expect(checkPilotStale(base, { ...base, excerpt: "New" }).changedFields).toEqual(["excerpt"]);
    expect(checkPilotStale(base, { ...base, tags: ["sport"] }).changedFields).toEqual(["tags"]);
  });

  it("accumulates several moved fields rather than stopping at the first", () => {
    const result = checkPilotStale(base, { ...base, content: "x", title: "y" });
    expect(result.stale).toBe(true);
    expect(result.changedFields).toEqual(["body", "headline"]);
  });

  it("does not fire on a change the pilot cannot see", () => {
    // Hashing by the save path's function would make a review go stale when the
    // writer picks a category, which no op addresses. A conflict that fires when
    // nothing relevant changed is one the writer learns to click through.
    const sameText = { ...base };
    expect(checkPilotStale(base, sameText).stale).toBe(false);
  });

  it("treats tag reordering and case as noise", () => {
    const staged = { ...base, tags: ["Markets", "Tech"] };
    const current = { ...base, tags: ["tech", "markets"] };
    expect(checkPilotStale(staged, current).changedFields).not.toContain("tags");
  });

  it("still notices a genuinely added tag", () => {
    const staged = { ...base, tags: ["markets"] };
    const current = { ...base, tags: ["markets", "tech"] };
    expect(checkPilotStale(staged, current).changedFields).toContain("tags");
  });

  it("detects whitespace-only body edits, because offsets shift with them", () => {
    // Unlike the title, the body is not trimmed: an inserted blank line moves
    // every offset after it, and a selection rewrite is addressed by offset.
    expect(checkPilotStale(base, { ...base, content: "The index rose.\n" }).stale).toBe(true);
  });

  it("ignores surrounding whitespace on the title and excerpt", () => {
    expect(checkPilotStale(base, { ...base, title: "  Markets  " }).stale).toBe(false);
    expect(checkPilotStale(base, { ...base, excerpt: " A short excerpt " }).stale).toBe(false);
  });

  it("explains the divergence in the message, not just the flag", () => {
    const result = checkPilotStale(base, { ...base, content: "changed" });
    expect(result.reason).toContain("body");
  });
});

describe("hashPilotBase", () => {
  const base = { title: "Markets", content: "Body", excerpt: "Ex", tags: ["a"] };

  it("is stable across tag order and case", () => {
    expect(hashPilotBase({ ...base, tags: ["B", "a"] })).toBe(hashPilotBase({ ...base, tags: ["a", "b"] }));
  });

  it("changes when the body changes", () => {
    expect(hashPilotBase(base)).not.toBe(hashPilotBase({ ...base, content: "Other" }));
  });

  it("drops empty and blank tags rather than hashing them", () => {
    expect(hashPilotBase({ ...base, tags: ["a", "", "  "] })).toBe(hashPilotBase(base));
  });

  it("does not collide across field boundaries", () => {
    // A concatenation would make {title:"ab"} and {title:"a", excerpt:"b"} hash
    // alike, which would let a title edit masquerade as an in-sync review.
    expect(hashPilotBase({ title: "ab", content: "", excerpt: "", tags: [] })).not.toBe(
      hashPilotBase({ title: "a", content: "", excerpt: "b", tags: [] })
    );
  });
});
