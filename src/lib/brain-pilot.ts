/**
 * The Brain Pilot's write vocabulary.
 *
 * The copilot used to answer in prose and leave the writer to paste it in. That
 * is a chat window, not an assistant: every suggestion cost a copy, a scroll, a
 * paste and a re-read, and a *selection*-level rewrite lost exactly the position
 * it was made for. The pilot answers with **operations against the composer**
 * instead — a small closed vocabulary of edits, each one applicable without
 * guessing where the text should go.
 *
 * This module is deliberately dependency-free and pure:
 *
 *  • the server (`app-brain`) builds ops from a model reply and the client
 *    (`CheckedEditor`, `StudioSidebar`) applies them, so the vocabulary has to
 *    be importable from both without dragging Prisma into the browser bundle;
 *  • applying ops is deterministic, so what the writer sees is exactly what the
 *    ops say — no second model call, no interpretation at apply time;
 *  • an op is only ever *data*. Nothing here evaluates a string as code, which
 *    matters because the text arrives from a language model.
 *
 * Two rules keep a model reply from corrupting a draft:
 *
 *  1. **Unknown ops are dropped, not thrown.** A model that invents
 *     `"kind": "translate"` should lose that one instruction, not the whole
 *     answer.
 *  2. **The client owns the ranges.** The ops describe *what* to do; the caller
 *     supplies the selection and caret it measured when it made the request. A
 *     model that returns stale offsets from its own view of the text cannot
 *     therefore write over the wrong words.
 */

/* ── The vocabulary ───────────────────────────────────────────────────────── */

export const PILOT_OP_KINDS = [
  /** Replace the text the writer had selected. */
  "replace-selection",
  /** Drop text in at the caret. */
  "insert-at-cursor",
  /** Replace the entire body — for "rewrite this" with nothing selected. */
  "replace-draft",
  /** Add text at the end of the body, respecting paragraph breaks. */
  "append",
  /** Set the title field. */
  "set-title",
  /** Set the excerpt field. */
  "set-excerpt",
  /** Add tags (deduplicated, normalised, capped by the caller). */
  "add-tags",
  /** Replace the first occurrence of `find` with `text` — a surgical fix. */
  "fix",
] as const;

export type PilotOpKind = (typeof PILOT_OP_KINDS)[number];

export interface PilotOp {
  kind: PilotOpKind;
  /** The replacement or inserted text. Empty string means "delete". */
  text: string;
  /** Required for `fix`: the exact substring to locate. */
  find?: string;
}

/** What the writer asked for, which decides the shape of the reply. */
export const PILOT_ACTIONS = [
  "improve",
  "shorten",
  "expand",
  "fix",
  "tone",
  "headline",
  "excerpt",
  "tags",
  "ask",
  /**
   * A whole article, staged rather than typed.
   *
   * It is not an action the model is asked for (the forge writes the piece)
   * but it *is* a set of ops from one reply — draft, headline, excerpt, tags —
   * and everything a writer is handed as ops gets reviewed. Giving it a name of
   * its own is what lets the review panel say what it is looking at.
   */
  "article",
] as const;

export type PilotAction = (typeof PILOT_ACTIONS)[number];

export function isPilotAction(value: unknown): value is PilotAction {
  return typeof value === "string" && (PILOT_ACTIONS as readonly string[]).includes(value);
}

/**
 * Actions whose result belongs in the body. The rest target a specific field, or
 * answer without editing anything (`ask`), and a reply that writes into the
 * wrong field is worse than one that writes nowhere.
 */
const BODY_ACTIONS: PilotAction[] = ["improve", "shorten", "expand", "fix", "tone"];

export interface PilotQuickAction {
  id: PilotAction;
  label: string;
  /** Shown as the tooltip / accessibility label on the inline bar. */
  hint: string;
}

/**
 * The inline bar's actions, in the order a writer reaches for them.
 *
 * Five, not fifteen: an inline toolbar that takes a second read to scan is
 * slower than typing the change by hand, which is the whole thing it exists to
 * avoid.
 */
export const PILOT_QUICK_ACTIONS: PilotQuickAction[] = [
  { id: "improve", label: "Improve", hint: "Rewrite for clarity and flow" },
  { id: "shorten", label: "Tighten", hint: "Say it in fewer words" },
  { id: "fix", label: "Fix", hint: "Correct grammar, spelling and spacing" },
  { id: "expand", label: "Expand", hint: "Add detail to this passage" },
  { id: "ask", label: "Ask", hint: "Tell the pilot what to change" },
];

/** The instruction the pilot is given for a canned action. */
export function pilotInstruction(action: PilotAction, extra?: string): string {
  const focus = extra?.trim();
  switch (action) {
    case "improve":
      return "Rewrite this passage so it reads more clearly and flows better. Keep every fact, name and number. Return only the rewritten passage.";
    case "shorten":
      return "Tighten this passage. Cut filler and hedging, keep every fact, name and number. Aim for about two thirds of the length. Return only the rewritten passage.";
    case "expand":
      return "Expand this passage with one or two concrete, supporting sentences. Do not invent statistics, quotes or sources. Return only the expanded passage.";
    case "fix":
      return "Correct the grammar, spelling, punctuation and spacing in this passage. Change nothing else — preserve voice, wording and meaning. Return only the corrected passage.";
    case "tone":
      return focus
        ? `Rewrite this passage in a ${focus} tone. Keep every fact, name and number. Return only the rewritten passage.`
        : "Rewrite this passage in a confident, warm editorial tone. Keep every fact, name and number. Return only the rewritten passage.";
    case "headline":
      return "Suggest one sharp headline for this piece, under 90 characters, no quotes and no numbering. Return only the headline.";
    case "excerpt":
      return "Write a two-sentence excerpt (max 280 characters) for this piece. No quotes, no labels. Return only the excerpt.";
    case "tags":
      return "List 5 to 8 lowercase topic tags for this piece, comma separated, no # symbols.";
    case "ask":
      return focus
        ? `Apply this instruction to the passage: ${focus}`
        : "Improve this passage for clarity and flow. Return only the rewritten passage.";
    case "article":
      // The forge never routes through here — it answers with a plan and writes
      // each section itself — but every action needs an instruction so an
      // unknown one cannot silently borrow another's shape.
      return "You are drafting a complete article. Plan it first, then finish every section you start.";
  }
}

/* ── Applying ops ─────────────────────────────────────────────────────────── */

export interface PilotComposerState {
  content: string;
  title: string;
  excerpt: string;
  tags: string[];
}

/**
 * The ranges the caller measured *before* it asked. Supplied at apply time so a
 * stale offset inside a model reply can never address the wrong words.
 */
export interface PilotRanges {
  selectionStart: number;
  selectionEnd: number;
  cursor: number;
}

export interface PilotApplyResult extends PilotComposerState {
  /** Human-readable labels for what actually changed, for the undo notice. */
  applied: string[];
}

/** Clamp a number into [0, max] — a range from the wire is never trusted raw. */
function clampIndex(value: unknown, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
  if (n < 0) return 0;
  if (n > max) return max;
  return n;
}

/** Tags arrive as a single comma-separated string from the model. */
export function normalizePilotTags(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((t) => t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-"))
    .filter((t) => t.length > 0 && t.length <= 40)
    .slice(0, 10);
}

/**
 * Apply a pilot reply to the composer.
 *
 * Every op is applied against the *current* state as it goes, so a reply that
 * inserts and then fixes text works. Ops with nothing to do (a `fix` whose
 * `find` is not in the draft, an empty `add-tags`, a `replace-selection` with no
 * selection) are skipped and left out of `applied` rather than reported as
 * changes that did not happen.
 */
export function applyPilotOps(
  state: PilotComposerState,
  ops: PilotOp[],
  ranges: PilotRanges
): PilotApplyResult {
  let content = state.content;
  let title = state.title;
  let excerpt = state.excerpt;
  let tags = [...state.tags];
  const applied: string[] = [];

  const start = Math.min(clampIndex(ranges.selectionStart, content.length), content.length);
  const end = Math.max(start, clampIndex(ranges.selectionEnd, content.length));
  const hasSelection = end > start;

  for (const op of ops) {
    switch (op.kind) {
      case "replace-selection": {
        if (!hasSelection) break;
        content = content.slice(0, start) + op.text + content.slice(end);
        applied.push("replaced the selection");
        break;
      }
      case "insert-at-cursor": {
        const at = clampIndex(ranges.cursor, content.length);
        content = content.slice(0, at) + op.text + content.slice(at);
        applied.push("inserted at the cursor");
        break;
      }
      case "replace-draft": {
        if (!op.text.trim()) break;
        content = op.text;
        applied.push("replaced the draft");
        break;
      }
      case "append": {
        if (!op.text.trim()) break;
        content = `${content.trimEnd()}\n\n${op.text.trim()}`;
        applied.push("appended to the draft");
        break;
      }
      case "set-title": {
        const next = op.text.trim();
        if (!next || next === title) break;
        title = next;
        applied.push("set the headline");
        break;
      }
      case "set-excerpt": {
        const next = op.text.trim().slice(0, 300);
        if (!next || next === excerpt) break;
        excerpt = next;
        applied.push("set the excerpt");
        break;
      }
      case "add-tags": {
        const next = normalizePilotTags(op.text);
        if (next.length === 0) break;
        const merged = [...new Set([...tags, ...next])].slice(0, 10);
        if (merged.length === tags.length) break;
        tags = merged;
        applied.push(next.length === 1 ? "added a tag" : `added ${next.length} tags`);
        break;
      }
      case "fix": {
        const find = op.find ?? "";
        if (!find) break;
        const at = content.indexOf(find);
        if (at === -1) break;
        content = content.slice(0, at) + op.text + content.slice(at + find.length);
        applied.push("applied a correction");
        break;
      }
    }
  }

  return { content, title, excerpt, tags, applied };
}

/* ── Reading a model reply ────────────────────────────────────────────────── */

/**
 * Pull the first JSON object out of a model reply.
 *
 * Models wrap JSON in prose or a code fence no matter how firmly they are told
 * not to, so scanning for the outermost braces is the difference between a
 * working reply and a raw `{...}` dumped into someone's article. Braces inside
 * strings are skipped, because a headline containing `}` is not pathological.
 */
export function extractJsonObject(raw: string): unknown | null {
  const first = raw.indexOf("{");
  if (first === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = first; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(first, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function isOpKind(value: unknown): value is PilotOpKind {
  return typeof value === "string" && (PILOT_OP_KINDS as readonly string[]).includes(value);
}

/**
 * Validate a decoded reply into ops.
 *
 * Anything unrecognised is dropped individually — a model that appends a
 * stray `{"kind":"explain"}` loses one instruction instead of the whole answer.
 */
export function coercePilotOps(value: unknown): PilotOp[] {
  if (!Array.isArray(value)) return [];
  const ops: PilotOp[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (!isOpKind(record.kind)) continue;
    const text = typeof record.text === "string" ? record.text : "";
    const find = typeof record.find === "string" ? record.find : undefined;
    if (record.kind === "fix" && !find) continue;
    if (record.kind !== "fix" && text.length === 0 && record.kind !== "replace-selection") continue;
    // A body op with no text is a no-op; a `fix` uses `find` to locate its edit.
    if (record.kind === "fix" && text.length === 0) continue;
    ops.push(find ? { kind: record.kind, text, find } : { kind: record.kind, text });
    if (ops.length >= 6) break;
  }
  return ops;
}

export interface ParsedPilotReply {
  reply: string;
  ops: PilotOp[];
  /** True when the model's JSON could not be read and we fell back to plain text. */
  degraded: boolean;
}

/**
 * Read a model reply into `{ reply, ops }`.
 *
 * The contract asked of the model is a single JSON object. When it gives us one,
 * the reply is conversational and the ops are exact. When it does not — an
 * outage in the provider's JSON mode, a model that ignored the instruction — the
 * prose is still worth something, so it becomes one body op for the action
 * rather than being thrown away. That fallback is the reason a pilot action can
 * never come back empty-handed.
 */
export function parsePilotReply(raw: string, action: PilotAction): ParsedPilotReply {
  const decoded = extractJsonObject(raw);
  if (decoded && typeof decoded === "object") {
    const record = decoded as Record<string, unknown>;
    const reply = typeof record.reply === "string" ? record.reply.trim() : "";
    const ops = coercePilotOps(record.ops);
    if (ops.length > 0) return { reply, ops, degraded: false };
    if (reply) return { reply, ops: [], degraded: false };
  }

  const text = raw.trim();
  if (!text) return { reply: "", ops: [], degraded: true };
  return { reply: "", ops: fallbackOps(action, text), degraded: true };
}

/**
 * Turn bare prose into the op the action was asking for.
 *
 * Only the field actions are addressed from prose, because the target of a body
 * action is genuinely ambiguous without the structured form: with a selection
 * out it was a rewrite of that passage, with nothing selected it was a rewrite
 * of the whole draft, and guessing wrong overwrites someone's article. The
 * caller resolves that by supplying the selection op shape itself (see
 * `defaultOpsFor`).
 */
export function fallbackOps(action: PilotAction, text: string): PilotOp[] {
  switch (action) {
    case "headline":
      return [{ kind: "set-title", text: text.split(/\n/)[0]?.trim() ?? text }];
    case "excerpt":
      return [{ kind: "set-excerpt", text }];
    case "tags":
      return [{ kind: "add-tags", text }];
    case "ask":
      return [];
    default:
      return [];
  }
}

/**
 * The op shape a body action produces when the model returned no structured
 * ops — the caller decides whether that lands on the selection or the draft.
 */
export function defaultOpsFor(
  action: PilotAction,
  text: string,
  hasSelection: boolean
): PilotOp[] {
  if (!BODY_ACTIONS.includes(action)) return fallbackOps(action, text);
  if (!text.trim()) return [];
  return [
    hasSelection
      ? { kind: "replace-selection", text }
      : { kind: "replace-draft", text },
  ];
}

/** True when this action is expected to write into the body. */
export function isBodyAction(action: PilotAction): boolean {
  return BODY_ACTIONS.includes(action);
}

/* ── Reviewing edits before they land ─────────────────────────────────────── */

/**
 * A writer should not have to *apply* an edit to find out what it does.
 *
 * The ops were already data, which is what makes this possible: each one can be
 * applied to a copy of the composer on its own and diffed, so the proposed
 * change can be shown before anything is committed. That turns the pilot from an
 * assistant you supervise into one you review, and it is the difference between
 * "the AI edited my article" and "the AI suggested this sentence".
 */

export type DiffSegment = { type: "same" | "add" | "del"; text: string };

/**
 * Tokenise for diffing, keeping whitespace attached to the preceding word.
 *
 * Attaching the space to the word that precedes it keeps the output readable:
 * splitting on whitespace alone produces a stream of alternating space-and-word
 * tokens, so a single changed word reads as four segments instead of one.
 */
function tokenize(text: string): string[] {
  return text.split(/(?<=\s)/).filter((t) => t.length > 0);
}

/** How many tokens either side of the change we are willing to run an LCS over. */
const DIFF_LCS_CAP = 600;

/**
 * A word-level diff, as runs of unchanged / added / removed text.
 *
 * Built to stay honest on a large input rather than fast on a small one. The
 * common prefix and suffix are trimmed first, which is what makes the usual case
 * — one sentence rewritten inside a 5,000-word draft — a diff over tens of
 * tokens rather than thousands. What remains is capped: past the cap the methods
 * fall back to reporting the middle as one replaced block, because a visible
 * "these words changed" is worth more than an exact alignment computed over
 * half a megabyte of prose.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  if (before === after) return before ? [{ type: "same", text: before }] : [];

  const a = tokenize(before);
  const b = tokenize(after);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const out: DiffSegment[] = [];
  const headText = a.slice(0, head).join("");
  const tailText = tail > 0 ? a.slice(a.length - tail).join("") : "";
  if (headText) out.push({ type: "same", text: headText });

  if (midA.length > DIFF_LCS_CAP || midB.length > DIFF_LCS_CAP) {
    if (midA.join("").length > 0) out.push({ type: "del", text: midA.join("") });
    if (midB.join("").length > 0) out.push({ type: "add", text: midB.join("") });
  } else {
    out.push(...lcsDiff(midA, midB));
  }

  if (tailText) out.push({ type: "same", text: tailText });
  return mergeRuns(out);
}

/** Classic dynamic-programming LCS over two short token arrays. */
function lcsDiff(a: string[], b: string[]): DiffSegment[] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  // A single flat Int32Array keeps this allocation-light; the table is small
  // because the caller has already trimmed the common prefix and suffix.
  const table = new Int32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + (j + 1)]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + (j + 1)]!);
    }
  }

  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + (j + 1)]!) {
      out.push({ type: "del", text: a[i]! });
      i += 1;
    } else {
      out.push({ type: "add", text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) out.push({ type: "del", text: a[i++]! });
  while (j < b.length) out.push({ type: "add", text: b[j++]! });
  return out;
}

/** Collapse adjacent runs of the same type so the renderer gets clean segments. */
function mergeRuns(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    const last = out[out.length - 1];
    if (last && last.type === seg.type) last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}

export type PilotField = "content" | "title" | "excerpt" | "tags";

/** Which composer field an op writes to. Used by the diff view and the learning log. */
export const PILOT_OP_FIELD: Record<PilotOpKind, PilotField> = {
  "replace-selection": "content",
  "insert-at-cursor": "content",
  "replace-draft": "content",
  append: "content",
  fix: "content",
  "set-title": "title",
  "set-excerpt": "excerpt",
  "add-tags": "tags",
};

const OP_LABEL: Record<PilotOpKind, string> = {
  "replace-selection": "Rewrite the selected passage",
  "insert-at-cursor": "Insert at the cursor",
  "replace-draft": "Rewrite the whole draft",
  append: "Add a closing passage",
  fix: "Correct a phrase",
  "set-title": "Set the headline",
  "set-excerpt": "Set the excerpt",
  "add-tags": "Add tags",
};

export interface PilotEditReview {
  /** Position in the reply's op list — what accept/reject addresses. */
  index: number;
  op: PilotOp;
  field: PilotField;
  label: string;
  /** The field's value before this edit, assuming earlier edits are kept. */
  before: string;
  /** The field's value after it. */
  after: string;
  segments: DiffSegment[];
  /** True when this edit would not change anything — nothing to accept. */
  noop: boolean;
  /** True when it cannot be applied at all (an empty reply, a missing target). */
  impossible: boolean;
}

/** Read one composer field as displayable text. */
function fieldValue(state: PilotComposerState, field: PilotField): string {
  if (field === "tags") return state.tags.join(", ");
  return state[field];
}

/**
 * Build the review list for a pilot reply.
 *
 * Each edit is previewed against the state that would exist if every earlier
 * edit were kept, so the list reads top-to-bottom like a stack of patches and
 * "keep all" reproduces exactly `applyPilotOps(state, ops)`. Editing one op and
 * not the others is then a matter of dropping it from the list before applying,
 * which is why the applier needs no per-op mode of its own.
 */
export function reviewPilotEdits(
  state: PilotComposerState,
  ops: PilotOp[],
  ranges: PilotRanges
): PilotEditReview[] {
  const reviews: PilotEditReview[] = [];
  let cursor: PilotComposerState = { ...state, tags: [...state.tags] };

  ops.forEach((op, index) => {
    const field = PILOT_OP_FIELD[op.kind];
    const before = fieldValue(cursor, field);
    const next = applyPilotOps(cursor, [op], ranges);
    const after = fieldValue(next, field);

    // Nothing changed *and* the applier said so: either it was a no-op, or it
    // had nothing to act on (no selection, a `find` that is not in the draft).
    const unchanged = next.applied.length === 0;
    const impossible =
      unchanged &&
      (op.kind === "replace-selection"
        ? ranges.selectionEnd <= ranges.selectionStart
        : op.kind === "fix"
          ? !op.find || !cursor.content.includes(op.find)
          : !op.text.trim());

    reviews.push({
      index,
      op,
      field,
      label: OP_LABEL[op.kind],
      before,
      after,
      segments: field === "content" ? diffWords(before, after) : [],
      noop: unchanged && !impossible,
      impossible,
    });

    cursor = {
      content: next.content,
      title: next.title,
      excerpt: next.excerpt,
      tags: next.tags,
    };
  });

  return reviews;
}

