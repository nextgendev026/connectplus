/**
 * Structured composer operations: what the Copilot may propose, and how it lands.
 *
 * The Copilot returned a **string**. Applying it meant the caller deciding where
 * the string went, which made three things impossible:
 *
 *   - **Validation.** A string has no field, no target and no range, so there was
 *     nothing to check before it was applied. A suggestion aimed at the excerpt
 *     could be written into the body and nothing would notice.
 *   - **Anchoring.** `selection` was sent to the model as a bare string, so a
 *     suggestion could not be tied to the offsets it was written for. A `find`
 *     that no longer matches is a suggestion that no longer applies, and the old
 *     shape could not express that.
 *   - **Undo.** Each accepted change has to be reversible as a unit. A string
 *     with no transaction around it can only be undone by the browser's own
 *     textarea undo, which is destroyed by any programmatic `setContent`.
 *
 * So an operation is a *typed intent with a target*, and everything downstream —
 * preview, validation, application, undo — works on the same structure. The set
 * of kinds is deliberately small and closed: every kind here has an unambiguous
 * meaning on a document, and a new kind would need its own validation rather than
 * inheriting it.
 *
 * Two rules run through the whole module:
 *
 * **A stale operation is rejected, never applied.** Every operation carries the
 * revision and hash it was written against. This is the brief's "the Copilot must
 * not silently overwrite newer content", and it is enforced here rather than
 * trusted to the caller.
 *
 * **Interpreting an operation is separate from applying it.** `validateOperations`
 * classifies; `applyOperations` mutates. That separation is what makes a preview
 * possible — the writer can see exactly what would change before anything does.
 */

// `@/lib/sha256`, not `node:crypto`: the operation path is reached from the
// composer page, so it is bundled for the browser too. See that module for why
// the digest is byte-identical to `createHash("sha256")`.
import { sha256Hex } from "@/lib/sha256";
import {
  applyComposerPatch,
  checkStale,
  hashComposerDocument,
  type ComposerState,
} from "@/lib/studio/composer";

/**
 * How a response was produced.
 *
 * The brief requires every AI output to be classifiable, and the reason is that a
 * degraded answer and a model answer are otherwise indistinguishable at the point
 * of use. `unverified` is the honest default for anything the model wrote without
 * a source behind it.
 */
export type OutputMode = "deterministic" | "model" | "degraded" | "unverified";

export const OUTPUT_MODES: readonly OutputMode[] = ["deterministic", "model", "degraded", "unverified"] as const;

export type ComposerOperationKind =
  | "replace-selection"
  | "insert-at-cursor"
  | "replace-draft"
  | "append"
  | "set-title"
  | "set-excerpt"
  | "add-tags"
  | "fix";

export type ComposerField = "content" | "title" | "excerpt" | "tags";

/** Which field each kind may target. A kind that targeted anything would be unvalidatable. */
export const OPERATION_TARGET: Readonly<Record<ComposerOperationKind, readonly ComposerField[]>> = {
  "replace-selection": ["content"],
  "insert-at-cursor": ["content"],
  "replace-draft": ["content"],
  append: ["content"],
  "set-title": ["title"],
  "set-excerpt": ["excerpt"],
  "add-tags": ["tags"],
  fix: ["content", "title", "excerpt"],
} as const;

export interface ComposerOperation {
  /** Stable within a response, so a preview can reference a specific operation. */
  id: string;
  kind: ComposerOperationKind;
  field: ComposerField;
  /** The replacement text. Null for a kind that changes no text (none today). */
  text: string | null;
  /**
   * For `fix`: the exact substring to replace. A literal, not a pattern — a
   * regex supplied by a model would be an execution surface, and an ambiguous
   * match is better rejected than guessed at.
   */
  find?: string | null;
  /** The revision this operation was written against. */
  baseRevision: number;
  /** The document hash this operation was written against. */
  baseHash: string;
  /** Why the model proposes it. Shown in the preview; never empty. */
  reason: string;
  /** Model self-assessed confidence, 0–1. Advisory, and labelled as such. */
  confidence: number;
  /** For applied operations, the range to replace. Derived during validation. */
  range?: { start: number; end: number } | null;
  mode: OutputMode;
}

export interface OperationRejection {
  operation: ComposerOperation;
  reason: string;
}

export interface ValidationResult {
  /** Operations that can be applied, in the order given. */
  applicable: ComposerOperation[];
  /** Operations that cannot, each with the reason. Never silently dropped. */
  rejected: OperationRejection[];
  /** Non-fatal notes: a claim the writer should weigh rather than a refusal. */
  warnings: string[];
  stale: boolean;
  /** The reason the set as a whole is stale, when it is. */
  staleReason?: string;
  /** True when applying the set would replace the entire body. */
  replacesWholeDraft: boolean;
}

const MAX_OPERATIONS = 40;
const MAX_TEXT_LENGTH = 200_000;

/**
 * Validate a proposed operation set against the *current* composer.
 *
 * Every rejection path is here rather than in the caller because a caller that
 * forgets one is a caller that applies a stale suggestion. The checks, and what
 * each prevents:
 *
 *  - **Staleness** (revision/hash) — the whole point. Applied first, because
 *    nothing else is worth checking about an operation written for other text.
 *  - **Target field** — `set-title` cannot write to `content`.
 *  - **`find` actually present** — a `fix` whose target text has gone must be
 *    rejected, not applied at a guessed offset.
 *  - **`find` unambiguous** — if the search string appears twice, replacing the
 *    first occurrence is as likely to be wrong as right, so the operation is
 *    rejected and the writer can select the passage instead.
 *  - **Non-empty text**, except where emptiness is meaningful (`replace-draft`
 *    is a legitimate clear).
 *  - **Size bounds** — a response cannot be trusted to be small.
 */
export function validateOperations(
  operations: ComposerOperation[],
  current: ComposerState
): ValidationResult {
  const rejected: OperationRejection[] = [];
  const warnings: string[] = [];

  if (operations.length === 0) {
    return { applicable: [], rejected: [], warnings, stale: false, replacesWholeDraft: false };
  }

  if (operations.length > MAX_OPERATIONS) {
    return {
      applicable: [],
      rejected: operations.map((operation) => ({
        operation,
        reason: `the response proposed ${operations.length} operations, above the limit of ${MAX_OPERATIONS}`,
      })),
      warnings,
      stale: false,
      replacesWholeDraft: false,
    };
  }

  // One staleness verdict for the whole set: they share a base revision by
  // construction, and reporting a different reason per operation would be noise.
  const base = operations[0]!;
  const stale = checkStale(
    { documentId: null, revision: base.baseRevision, contentHash: base.baseHash },
    current
  );
  if (stale.stale) {
    return {
      applicable: [],
      rejected: operations.map((operation) => ({ operation, reason: stale.reason })),
      warnings,
      stale: true,
      staleReason: stale.reason,
      replacesWholeDraft: false,
    };
  }

  const applicable: ComposerOperation[] = [];
  const claimedRanges: { start: number; end: number }[] = [];
  let replacesWholeDraft = false;

  for (const operation of operations) {
    const allowed = OPERATION_TARGET[operation.kind];
    if (!allowed) {
      rejected.push({ operation, reason: `unknown operation kind "${operation.kind}"` });
      continue;
    }
    if (!allowed.includes(operation.field)) {
      rejected.push({
        operation,
        reason: `a "${operation.kind}" operation cannot target the ${operation.field} field (allowed: ${allowed.join(", ")})`,
      });
      continue;
    }

    if (operation.text !== null && operation.text !== undefined && operation.text.length > MAX_TEXT_LENGTH) {
      rejected.push({ operation, reason: `operation text is ${operation.text.length} characters, above the limit` });
      continue;
    }

    if (operation.kind === "add-tags") {
      const tags = parseTagText(operation.text);
      if (tags.length === 0) {
        rejected.push({ operation, reason: "no usable tags in the proposal" });
        continue;
      }
    } else if (operation.kind === "replace-draft") {
      // A legitimate clear, but a full replacement is the one operation that can
      // destroy a writer's work, so it is flagged loudly regardless.
      replacesWholeDraft = true;
      warnings.push("this proposal replaces the entire draft body — review it carefully before accepting");
    } else if (!operation.text || operation.text.trim().length === 0) {
      rejected.push({ operation, reason: `a "${operation.kind}" operation with no text has nothing to apply` });
      continue;
    }

    let range: { start: number; end: number } | null = null;

    if (operation.field === "content") {
      if (operation.kind === "insert-at-cursor") {
        const cursor = current.selection?.end ?? current.content.length;
        range = { start: cursor, end: cursor };
      } else if (operation.kind === "append") {
        range = { start: current.content.length, end: current.content.length };
      } else if (operation.kind === "replace-draft") {
        range = { start: 0, end: current.content.length };
      } else if (operation.kind === "replace-selection") {
        const selection = current.selection;
        if (!selection || selection.end <= selection.start) {
          rejected.push({
            operation,
            reason: "there is no selection to replace — select the passage first, or ask for an insertion",
          });
          continue;
        }
        range = { start: selection.start, end: selection.end };
      } else if (operation.kind === "fix") {
        const found = locateFind(operation, current.content);
        if ("reason" in found) {
          rejected.push({ operation, reason: found.reason });
          continue;
        }
        range = { start: found.start, end: found.end };
      }
    } else if (operation.kind === "fix") {
      const source = operation.field === "title" ? current.title : current.excerpt;
      const found = locateFind(operation, source);
      if ("reason" in found) {
        rejected.push({ operation, reason: found.reason });
        continue;
      }
      range = { start: found.start, end: found.end };
    }

    // Two operations cannot claim overlapping text: applying the second would
    // act on offsets the first has already moved.
    if (range && range.end > range.start) {
      const overlap = claimedRanges.find((r) => range!.start < r.end && range!.end > r.start);
      if (overlap) {
        rejected.push({
          operation,
          reason: "this operation overlaps another in the same proposal; apply them separately",
        });
        continue;
      }
      claimedRanges.push(range);
    }

    if (operation.confidence < 0.3) {
      warnings.push(`"${operation.reason}" was proposed with low confidence (${operation.confidence.toFixed(2)})`);
    }
    if (operation.mode === "unverified" || operation.mode === "degraded") {
      warnings.push(
        operation.mode === "degraded"
          ? `"${operation.reason}" came from a degraded provider — treat the wording as provisional`
          : `"${operation.reason}" is model-generated and unverified — check any fact or name in it`
      );
    }

    applicable.push({ ...operation, range });
  }

  return { applicable, rejected, warnings, stale: false, replacesWholeDraft };
}

/** Locate an unambiguous literal match, or explain why it cannot be located. */
function locateFind(
  operation: ComposerOperation,
  source: string
): { start: number; end: number } | { reason: string } {
  const needle = operation.find;
  if (!needle || needle.length === 0) {
    return { reason: `a "${operation.kind}" operation must supply the exact text to replace` };
  }
  const first = source.indexOf(needle);
  if (first === -1) {
    return {
      reason:
        "the text this operation wanted to replace is not in the draft any more — it may have already been edited",
    };
  }
  if (source.indexOf(needle, first + 1) !== -1) {
    return {
      reason: "the text to replace appears more than once, so applying it would be a guess",
    };
  }
  return { start: first, end: first + needle.length };
}

/** Tags from a comma/newline separated string, normalised and bounded. */
export function parseTagText(text: string | null | undefined, limit = 10): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,\n]/)) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (tag.length < 2 || tag.length > 40) continue;
    seen.add(tag);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/** The before/after of one accepted change, so it can be undone as a unit. */
export interface EditTransaction {
  id: string;
  at: string;
  source: "manual" | "copilot" | "autofix";
  /** Why, in the writer's terms. Shown in the revision timeline. */
  reason: string;
  revision: number;
  before: DocumentFields;
  after: DocumentFields;
  /** Ids of the operations that made up this change. */
  operationIds: string[];
}

interface DocumentFields {
  title: string;
  content: string;
  excerpt: string;
  tags: string[];
}

function fieldsOf(state: ComposerState): DocumentFields {
  return { title: state.title, content: state.content, excerpt: state.excerpt, tags: [...state.tags] };
}

export interface AppliedOperations {
  state: ComposerState;
  transaction: EditTransaction | null;
  applied: ComposerOperation[];
  rejected: OperationRejection[];
}

/**
 * Apply a validated operation set as one transaction.
 *
 * **One transaction for the whole set**, not one per operation. A proposal is a
 * single editorial intention — "tighten this paragraph and fix its tense" — and a
 * writer who accepts it expects one Ctrl+Z to undo it. Per-operation undo would
 * make them press it four times and, more importantly, would let them stop
 * halfway through a change that only makes sense as a whole.
 *
 * Operations are applied against a working copy in order, so a later operation in
 * the same set sees the result of an earlier one. Ranges were computed during
 * validation against the *original* text, so they are applied in reverse document
 * order to keep the earlier offsets valid — the standard edit-application
 * ordering, and the reason it matters is that applying them front-to-back shifts
 * every later offset.
 *
 * `applied` and `rejected` are returned separately and the transaction is null
 * when nothing was applied, so a caller cannot record an empty change in the
 * undo history.
 */
export function applyOperations(
  state: ComposerState,
  operations: ComposerOperation[],
  opts: { source?: EditTransaction["source"]; reason?: string } = {}
): AppliedOperations {
  if (operations.length === 0) {
    return { state, transaction: null, applied: [], rejected: [] };
  }

  const before = fieldsOf(state);
  const working: DocumentFields = { ...before, tags: [...before.tags] };
  const applied: ComposerOperation[] = [];

  const ordered = [...operations].sort((a, b) => {
    // Text operations by descending start, so earlier offsets stay valid.
    const aStart = a.range?.start ?? Number.MAX_SAFE_INTEGER;
    const bStart = b.range?.start ?? Number.MAX_SAFE_INTEGER;
    return bStart - aStart;
  });

  for (const operation of ordered) {
    const text = operation.text ?? "";
    switch (operation.kind) {
      case "replace-draft": {
        working.content = text;
        break;
      }
      case "insert-at-cursor":
      case "append":
      case "replace-selection":
      case "fix": {
        const range = operation.range;
        if (!range) break;
        if (operation.field === "content") {
          working.content = working.content.slice(0, range.start) + text + working.content.slice(range.end);
        } else if (operation.field === "title") {
          working.title = working.title.slice(0, range.start) + text + working.title.slice(range.end);
        } else if (operation.field === "excerpt") {
          working.excerpt = working.excerpt.slice(0, range.start) + text + working.excerpt.slice(range.end);
        }
        break;
      }
      case "set-title": {
        working.title = text;
        break;
      }
      case "set-excerpt": {
        working.excerpt = text;
        break;
      }
      case "add-tags": {
        const merged = [...working.tags];
        for (const tag of parseTagText(text)) if (!merged.includes(tag)) merged.push(tag);
        working.tags = merged.slice(0, 10);
        break;
      }
    }
    applied.push(operation);
  }

  if (applied.length === 0) {
    return { state, transaction: null, applied: [], rejected: [] };
  }

  const next = applyComposerPatch(state, working).state;

  // A set that resolved to no actual change produces no transaction. Otherwise
  // the undo history fills with entries that undo nothing.
  if (hashComposerDocument(next) === state.contentHash) {
    return { state, transaction: null, applied: [], rejected: [] };
  }

  const transaction: EditTransaction = {
    id: `tx-${sha256Hex(`${state.sessionId}:${state.revision}:${Date.now()}`).slice(0, 12)}`,
    at: new Date().toISOString(),
    source: opts.source ?? "copilot",
    reason: opts.reason ?? summariseOperations(applied),
    revision: next.revision,
    before,
    after: fieldsOf(next),
    operationIds: applied.map((o) => o.id),
  };

  return { state: next, transaction, applied, rejected: [] };
}

function summariseOperations(operations: ComposerOperation[]): string {
  const kinds = [...new Set(operations.map((o) => o.kind))];
  return kinds.length === 1 ? kinds[0]! : `${operations.length} edits (${kinds.join(", ")})`;
}

export interface EditHistory {
  /** Oldest first. */
  entries: EditTransaction[];
  /** Index into `entries`; the number of applied transactions. */
  cursor: number;
}

export function createEditHistory(): EditHistory {
  return { entries: [], cursor: 0 };
}

const HISTORY_LIMIT = 50;

/**
 * Record an accepted change.
 *
 * Anything after the cursor is discarded, which is what makes this a *timeline*
 * rather than a log: undoing three edits and then making a new one means the
 * three undone edits are no longer reachable, and pretending otherwise would let
 * the composer hold a state that never existed. The limit exists because a
 * session can last hours and each entry holds a full copy of the body.
 */
export function recordTransaction(history: EditHistory, transaction: EditTransaction): EditHistory {
  const entries = [...history.entries.slice(0, history.cursor), transaction];
  const trimmed = entries.length > HISTORY_LIMIT ? entries.slice(entries.length - HISTORY_LIMIT) : entries;
  return { entries: trimmed, cursor: trimmed.length };
}

export interface UndoResult {
  state: ComposerState;
  history: EditHistory;
  /** Null when there was nothing to undo. */
  transaction: EditTransaction | null;
}

/** Restore the fields as they were before the transaction at the cursor. */
export function undo(history: EditHistory, state: ComposerState): UndoResult {
  if (history.cursor <= 0) return { state, history, transaction: null };
  const transaction = history.entries[history.cursor - 1]!;
  return {
    state: restoreFields(state, transaction.before),
    history: { ...history, cursor: history.cursor - 1 },
    transaction,
  };
}

/** Re-apply the transaction the cursor is sitting on. */
export function redo(history: EditHistory, state: ComposerState): UndoResult {
  if (history.cursor >= history.entries.length) return { state, history, transaction: null };
  const transaction = history.entries[history.cursor]!;
  return {
    state: restoreFields(state, transaction.after),
    history: { ...history, cursor: history.cursor + 1 },
    transaction,
  };
}

export function canUndo(history: EditHistory): boolean {
  return history.cursor > 0;
}

export function canRedo(history: EditHistory): boolean {
  return history.cursor < history.entries.length;
}

/**
 * Put fields back, advancing the revision.
 *
 * An undo is an *edit*, not a rollback of history: the document must still be
 * saveable afterwards and the revision must still move forward, or a save that
 * followed an undo would carry a revision the server had already seen and be
 * rejected as a no-op.
 *
 * `dirty` is set on purpose. Undoing back to the last saved state still produces
 * a document the server has not been told about, and treating it as clean would
 * leave the server holding the version the writer just rejected.
 */
function restoreFields(state: ComposerState, fields: DocumentFields): ComposerState {
  return applyComposerPatch(state, {
    title: fields.title,
    content: fields.content,
    excerpt: fields.excerpt,
    tags: [...fields.tags],
  }).state;
}

/** A human-readable summary of a transaction, for the revision timeline. */
export function describeTransaction(transaction: EditTransaction): string {
  const deltas: string[] = [];
  if (transaction.before.title !== transaction.after.title) deltas.push("title");
  if (transaction.before.content !== transaction.after.content) deltas.push("body");
  if (transaction.before.excerpt !== transaction.after.excerpt) deltas.push("excerpt");
  if (transaction.before.tags.join(",") !== transaction.after.tags.join(",")) deltas.push("tags");
  const what = deltas.length > 0 ? deltas.join(", ") : "no visible field";
  const actor = transaction.source === "copilot" ? "Copilot" : transaction.source === "autofix" ? "Auto-fix" : "You";
  return `${actor} changed ${what} — ${transaction.reason}`;
}
