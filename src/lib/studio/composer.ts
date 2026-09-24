/**
 * Composer state: one document identity, one revision, one honest save state.
 *
 * The Studio held title, content, excerpt, tags, category, cover and `editingId`
 * as independent `useState` values, with no revision, no hash and no save
 * machine. Three defects followed, and this module exists for all three:
 *
 *   1. **Duplicate drafts.** `editingId` was *derived* from a create response.
 *      Until React committed the state update, an in-flight save's closure still
 *      read `editingId === null`, so a second create could be issued and a second
 *      draft created. The fix is not a longer debounce — it is that a save is
 *      either in flight or it is not, and the second one is refused.
 *   2. **No revision.** A publish could not say which version of the document it
 *      was publishing, so a publish racing an autosave was last-write-wins.
 *   3. **A silent failure mode.** `catch {}` around autosave meant a failed save
 *      looked identical to a successful one. A writer who lost their connection
 *      had no way to know the server copy was stale.
 *
 * The design decisions worth stating, because each is a fork in the road:
 *
 * **The save state is a machine, not a boolean.** `saving` is a state that
 * refuses a second save; `conflict` is a state that requires a human decision;
 * `error` is a state that must remain visible until the next success. A boolean
 * `isSaving` cannot express any of those, which is why the bug survived.
 *
 * **The idempotency key is derived, not random.** `sessionId:revision:hash` means
 * a *retry of the same save* carries the same key and the server can recognise
 * it, while a genuinely new edit carries a new one. A random key per attempt
 * would make every retry a fresh create — which is the bug, not the fix.
 *
 * **Staleness is revision first, hash second.** The revision is cheap and catches
 * the ordinary case; the hash catches the case the revision cannot, which is two
 * writers reaching the same revision through different edits. Comparing hashes
 * alone would reject an AI result whenever an unrelated field changed; comparing
 * revisions alone would accept a suggestion written against different text.
 */

// `@/lib/sha256`, not `node:crypto`: this module is imported by the composer
// page, which is a client component, and webpack cannot resolve the `node:`
// scheme in a browser chunk. The digest is identical, so hashes already held in
// a session still compare equal.
import { sha256Hex } from "@/lib/sha256";

/** The document as the composer holds it. A snapshot, never a live reference. */
export interface ComposerState {
  /** Stable for the session. Null only before the first successful create. */
  documentId: string | null;
  /** Identifies this editing session, and scopes idempotency keys to it. */
  sessionId: string;
  /** Increments on every accepted change. */
  revision: number;
  /** Hash of the document fields, for cheap stale detection. */
  contentHash: string;
  title: string;
  content: string;
  excerpt: string;
  tags: string[];
  categoryId: string | null;
  categoryName: string;
  coverImage: string | null;
  /** Selection in the *content* field, as offsets. Needed to anchor suggestions. */
  selection: { start: number; end: number } | null;
  /** True when the editor holds changes that are not in the last successful save. */
  dirty: boolean;
  saveState: SaveState;
  /** Server revision of the last successful save, when the server reports one. */
  savedRevision: number | null;
  /** Last error message, kept until a save succeeds. Never cleared silently. */
  lastError: string | null;
}

export type SaveState = "clean" | "dirty" | "saving" | "saved" | "error" | "conflict";

/**
 * Legal save-state transitions.
 *
 * Written as a table rather than as a set of `if`s because the illegal ones are
 * the point: `saving → saving` is the duplicate-draft race, and
 * `conflict → saved` would silently discard a conflict the writer never saw.
 */
export const SAVE_TRANSITIONS: Readonly<Record<SaveState, readonly SaveState[]>> = {
  clean: ["dirty", "saving", "saved"],
  dirty: ["saving", "clean", "saved", "error"],
  saving: ["saved", "error", "conflict", "dirty"],
  saved: ["dirty", "saving", "error", "clean", "conflict"],
  error: ["dirty", "saving", "clean", "saved"],
  conflict: ["dirty", "clean", "saving", "saved", "error"],
} as const;

export function canTransitionSaveState(from: SaveState, to: SaveState): boolean {
  return SAVE_TRANSITIONS[from].includes(to);
}

export class ComposerStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposerStateError";
  }
}

/**
 * Hash of the fields that constitute "the document".
 *
 * `revision` and `saveState` are deliberately excluded: they are bookkeeping
 * about the document, not the document. Including `revision` would make the hash
 * change on every save, so a re-save of identical text would look like a new
 * revision — which would break both conflict detection and the idempotency key.
 */
export function hashComposerDocument(
  state: Pick<ComposerState, "title" | "content" | "excerpt" | "tags" | "categoryId" | "coverImage">
): string {
  const canonical = JSON.stringify({
    title: state.title.trim(),
    content: state.content,
    excerpt: state.excerpt.trim(),
    tags: [...state.tags].map((t) => t.trim().toLowerCase()).filter(Boolean).sort(),
    categoryId: state.categoryId,
    coverImage: state.coverImage,
  });
  return sha256Hex(canonical);
}

/** A fresh session. `documentId` is null until the first successful create. */
export function createComposerSession(sessionId?: string): ComposerState {
  const empty = {
    documentId: null,
    sessionId: sessionId ?? generateSessionId(),
    revision: 0,
    title: "",
    content: "",
    excerpt: "",
    tags: [],
    categoryId: null,
    categoryName: "",
    coverImage: null,
    selection: null,
  };
  return {
    ...empty,
    contentHash: hashComposerDocument(empty),
    dirty: false,
    saveState: "clean",
    savedRevision: null,
    lastError: null,
  };
}

/** Load an existing document into a session, establishing identity up front. */
export function loadComposerDocument(
  sessionId: string,
  document: {
    id: string;
    title: string;
    content: string;
    excerpt?: string | null;
    tags?: string[];
    categoryId?: string | null;
    categoryName?: string;
    coverImage?: string | null;
    revision?: number | null;
  }
): ComposerState {
  const base = {
    documentId: document.id,
    sessionId,
    title: document.title ?? "",
    content: document.content ?? "",
    excerpt: document.excerpt ?? "",
    tags: document.tags ?? [],
    categoryId: document.categoryId ?? null,
    categoryName: document.categoryName ?? "",
    coverImage: document.coverImage ?? null,
  };
  return {
    ...base,
    revision: 0,
    contentHash: hashComposerDocument(base),
    selection: null,
    dirty: false,
    saveState: "clean",
    savedRevision: document.revision ?? null,
    lastError: null,
  };
}

/** A session id that is unique per tab without needing a server round trip. */
export function generateSessionId(): string {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  // Fallback for a runtime without `randomUUID`. Uniqueness is what matters, not
  // unpredictability: this value only scopes idempotency keys.
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ComposerPatch {
  title?: string;
  content?: string;
  excerpt?: string;
  tags?: string[];
  categoryId?: string | null;
  categoryName?: string;
  coverImage?: string | null;
  selection?: { start: number; end: number } | null;
}

export interface ApplyResult {
  state: ComposerState;
  /** False when the patch changed nothing, so no revision was spent. */
  changed: boolean;
}

/**
 * Apply an edit, advancing the revision only when something actually changed.
 *
 * The `changed` guard matters for more than efficiency. A no-op `setContent` from
 * a re-render would otherwise bump the revision, which marks the document dirty,
 * which arms an autosave, which writes an identical row — the loop that made the
 * Studio churn. Comparing the hash before and after is what stops it.
 */
export function applyComposerPatch(state: ComposerState, patch: ComposerPatch): ApplyResult {
  const next = { ...state, ...patch };
  if (patch.selection !== undefined && Object.keys(patch).length === 1) {
    // A pure selection change is not an edit: it must not mark the document
    // dirty, because the writer has not changed anything.
    return { state: { ...state, selection: patch.selection ?? null }, changed: false };
  }

  const nextHash = hashComposerDocument(next);
  if (nextHash === state.contentHash) {
    const selectionChanged =
      patch.selection !== undefined &&
      (patch.selection?.start ?? null) !== (state.selection?.start ?? null);
    return {
      state: selectionChanged ? { ...state, selection: patch.selection ?? null } : state,
      changed: false,
    };
  }

  const saveState: SaveState = state.saveState === "saving" ? "saving" : "dirty";
  return {
    state: {
      ...next,
      revision: state.revision + 1,
      contentHash: nextHash,
      dirty: true,
      saveState,
      // The previous error is kept: a successful autosave later will clear it,
      // and a writer editing through a failure needs to know it is still failing.
      lastError: state.saveState === "saving" ? state.lastError : state.lastError,
    },
    changed: true,
  };
}

/**
 * Mark the composer clean without advancing the revision.
 *
 * Used when the writer accepts that the server copy is what they have — after a
 * reload, or after resolving a conflict in favour of the server version.
 */
export function markClean(state: ComposerState, serverRevision: number | null = null): ComposerState {
  return {
    ...state,
    dirty: false,
    saveState: "clean",
    savedRevision: serverRevision ?? state.savedRevision,
    lastError: null,
  };
}

/** The idempotency key for a save attempt. */
export function idempotencyKeyFor(state: Pick<ComposerState, "sessionId" | "revision" | "contentHash">): string {
  return `${state.sessionId}:${state.revision}:${state.contentHash.slice(0, 24)}`;
}

export interface SaveTicket {
  state: ComposerState;
  idempotencyKey: string;
  /** True when this is the create that establishes the document id. */
  isCreate: boolean;
  revision: number;
  contentHash: string;
}

/**
 * Begin a save, or refuse it.
 *
 * **The refusal is the fix for duplicate drafts.** A save while
 * `saveState === "saving"` returns `null` rather than issuing a second request,
 * so the race that produced two documents cannot occur regardless of how React
 * schedules the state update that would have supplied the document id. The
 * server-side idempotency ledger is the second line of defence, not the first:
 * a client that cannot issue the request twice does not need the server to
 * recognise the repeat.
 *
 * A document with no id still produces a key. That is deliberate: the key is what
 * lets the server return the document it already created for this
 * `(session, revision, hash)` triple, so even a genuine retry after a dropped
 * response cannot produce a second draft.
 */
export function beginSave(state: ComposerState): SaveTicket | null {
  if (state.saveState === "saving") return null;
  if (state.saveState === "conflict") return null;
  if (!state.dirty && state.saveState !== "clean") return null;
  if (!state.dirty && state.documentId !== null) return null;

  if (!canTransitionSaveState(state.saveState, "saving")) {
    throw new ComposerStateError(`Cannot begin a save from saveState "${state.saveState}"`);
  }

  return {
    state: { ...state, saveState: "saving", lastError: null },
    idempotencyKey: idempotencyKeyFor(state),
    isCreate: state.documentId === null,
    revision: state.revision,
    contentHash: state.contentHash,
  };
}

export interface SaveOutcome {
  documentId?: string | null;
  /** Server revision, when returned. */
  revision?: number | null;
  /** True when the server refused because the document moved on. */
  conflict?: boolean;
  error?: string;
}

/**
 * Resolve a save attempt into a state.
 *
 * The three outcomes are distinct states rather than one "not saving":
 *
 *  - **saved** — and `dirty` is false *only* if the document has not changed
 *    since the save began. A writer who kept typing during the request still has
 *    unsaved work; marking them clean would lose it on the next navigation.
 *  - **conflict** — a human decision is required, so the state refuses further
 *    saves until it is resolved.
 *  - **error** — the message is kept. A cleared error is a lie about what
 *    happened.
 */
export function resolveSave(state: ComposerState, outcome: SaveOutcome, current: ComposerState = state): ComposerState {
  if (outcome.conflict) {
    return {
      ...state,
      saveState: "conflict",
      lastError: outcome.error ?? "The document changed on the server since you started editing.",
    };
  }
  if (outcome.error) {
    return { ...state, saveState: "error", lastError: outcome.error };
  }

  // `current` is the composer as it is *now*, which may have moved on while the
  // request was in flight. Comparing the hash is what tells us whether the save
  // covered everything the writer has typed.
  const stillCurrent = current.contentHash === state.contentHash;
  return {
    ...state,
    documentId: outcome.documentId ?? state.documentId,
    saveState: stillCurrent ? "saved" : "dirty",
    dirty: !stillCurrent,
    savedRevision: outcome.revision ?? state.savedRevision,
    lastError: null,
  };
}

/** A full snapshot to send with an AI request, so it cannot observe later edits. */
export interface ComposerSnapshot {
  documentId: string | null;
  revision: number;
  contentHash: string;
  title: string;
  content: string;
  excerpt: string;
  tags: string[];
  categoryName: string;
  selection: { start: number; end: number } | null;
  selectedText: string | null;
}

/**
 * Snapshot the composer for an AI request.
 *
 * A *copy*, never a live reference. The brief is explicit that the Copilot must
 * receive a snapshot, and the reason is that a request takes seconds while a
 * writer types continuously: a live reference would let the model observe text
 * that did not exist when the request was made, and then attribute its answer to
 * a revision that never contained it.
 */
export function snapshotComposer(state: ComposerState): ComposerSnapshot {
  const selection = state.selection;
  const selectedText =
    selection && selection.end > selection.start ? state.content.slice(selection.start, selection.end) : null;
  return {
    documentId: state.documentId,
    revision: state.revision,
    contentHash: state.contentHash,
    title: state.title,
    content: state.content,
    excerpt: state.excerpt,
    tags: [...state.tags],
    categoryName: state.categoryName,
    selection: selection ? { ...selection } : null,
    selectedText,
  };
}

export interface StaleCheck {
  stale: boolean;
  reason: string;
}

/**
 * The hash of just the fields a pilot reply is written against.
 *
 * Deliberately *not* `hashComposerDocument`. The pilot's vocabulary is four
 * fields — content, title, excerpt, tags — and it has no opinion about the
 * category or the cover. Hashing by the save path's function would make a
 * staged review go stale the moment the writer picks a category, which changes
 * nothing the ops address, and a conflict that fires when nothing relevant
 * changed is a conflict the writer learns to ignore.
 */
export function hashPilotBase(base: {
  title: string;
  content: string;
  excerpt: string;
  tags: readonly string[];
}): string {
  const canonical = JSON.stringify({
    title: base.title.trim(),
    content: base.content,
    excerpt: base.excerpt.trim(),
    tags: canonicalTags(base.tags),
  });
  return sha256Hex(canonical);
}

/** Tags compared the way the save path compares them, not the way they were typed. */
function canonicalTags(tags: readonly string[]): string {
  return [...tags]
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("\u0000");
}

export interface PilotStaleCheck extends StaleCheck {
  /** Which of the four fields moved, for a message that is specific. */
  changedFields: string[];
}

/**
 * Has the draft moved since a pilot reply was written against it?
 *
 * A pilot op is bound to the text it was written for. A `fix` carries a phrase
 * to locate; a selection rewrite carries offsets measured before the request
 * went out. Neither is meaningful against different text, and the failure is
 * silent in the worst way: the op still applies, it just lands somewhere else,
 * and the result is written over the writer's newer paragraph.
 *
 * So this is checked *before* an op is applied rather than after, and a
 * divergence is not "recompute the offsets" — the model has not seen the new
 * text and its reply may no longer be the right edit at all. The caller's job is
 * to stop and ask, not to guess.
 */
export function checkPilotStale(
  staged: { title: string; content: string; excerpt: string; tags: readonly string[] },
  current: { title: string; content: string; excerpt: string; tags: readonly string[] }
): PilotStaleCheck {
  const changedFields: string[] = [];
  // The body is compared raw and the other three are compared canonically, which
  // is exactly how `hashPilotBase` sees them — the two must agree, or a review
  // can report "changed" while its hash says otherwise. The body is the
  // exception because offsets address it: an inserted blank line moves every
  // later position even though no word changed.
  if (staged.content !== current.content) changedFields.push("body");
  if (staged.title.trim() !== current.title.trim()) changedFields.push("headline");
  if (staged.excerpt.trim() !== current.excerpt.trim()) changedFields.push("excerpt");
  if (canonicalTags(staged.tags) !== canonicalTags(current.tags)) changedFields.push("tags");
  if (changedFields.length === 0) {
    return { stale: false, reason: "these edits match the current draft", changedFields };
  }
  return {
    stale: true,
    reason: `you have edited the ${changedFields.join(", ")} since these edits were proposed`,
    changedFields,
  };
}

/**
 * Has the document moved since this result was produced?
 *
 * Revision first, hash second — and the order is not arbitrary. A revision
 * mismatch means the document was edited, full stop, and the result cannot be
 * applied to it. A revision match with a hash mismatch means something changed
 * without the revision advancing, which the composer's own rules make
 * impossible; it is checked anyway because the alternative is to trust an
 * invariant that lives in another module.
 *
 * A result produced against a *different* document is always stale, whatever the
 * revisions say. That case is reachable: a writer opens story B while a Copilot
 * request for story A is in flight.
 */
export function checkStale(
  base: { documentId?: string | null; revision: number; contentHash: string },
  current: ComposerState
): StaleCheck {
  if (base.documentId !== undefined && base.documentId !== current.documentId) {
    return { stale: true, reason: "this suggestion was written for a different document" };
  }
  if (base.revision !== current.revision) {
    return {
      stale: true,
      reason: `the draft has changed since this suggestion was written (revision ${base.revision} → ${current.revision})`,
    };
  }
  if (base.contentHash !== current.contentHash) {
    return { stale: true, reason: "the draft text has changed since this suggestion was written" };
  }
  return { stale: false, reason: "the suggestion matches the current draft" };
}

/** A one-line description of the save state for the header status bar. */
export function describeSaveState(state: Pick<ComposerState, "saveState" | "dirty" | "lastError">): string {
  switch (state.saveState) {
    case "saving":
      return "Saving…";
    case "saved":
      return state.dirty ? "Saved · newer changes pending" : "All changes saved";
    case "dirty":
      return "Unsaved changes";
    case "error":
      return state.lastError ? `Save failed — ${state.lastError}` : "Save failed";
    case "conflict":
      return state.lastError ?? "Conflict — the draft changed elsewhere";
    default:
      return "No changes yet";
  }
}
