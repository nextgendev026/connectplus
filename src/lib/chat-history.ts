/**
 * Turning stored messages into the context a reply is composed against.
 *
 * This exists as its own module because the same two mistakes are easy to make
 * and invisible when you make them.
 *
 *   1. **Fetching the wrong end of the conversation.** The query used to be
 *      `orderBy: createdAt asc, take: 10`, which reads as "the first ten
 *      messages" — so the longer a conversation ran, the less of the recent
 *      discussion the mind could see. Past ten turns it was answering the
 *      current question while looking at the opening of the thread, and the
 *      operator experienced that as the assistant losing the plot.
 *
 *   2. **Forgetting to reverse.** The database has to be asked for the *newest*
 *      rows (`desc`), but a prompt has to be ordered *oldest first*, the way the
 *      exchange actually happened. Feeding a desc page straight to the model
 *      presents the conversation backwards.
 *
 * Splitting the two apart makes each checkable: the route owns the `desc`
 * ordering, this function owns the reversal, and `chronologicalHistory` refuses
 * to be called with anything but a newest-first page so the pair cannot drift.
 */

/** How many prior turns of a conversation are carried into a reply. */
export const HISTORY_TURNS = 12;

/** A single turn is truncated to this before entering the prompt. */
const MAX_TURN_CHARS = 2_000;

export interface StoredMessage {
  role: string;
  content: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * The recent turns of a conversation, oldest first, ready for a prompt.
 *
 * `newestFirst` must be the page as a `createdAt desc` query returns it. Rows
 * that are neither user nor assistant turns (a tool notice, a system row) are
 * dropped rather than sent, because a prompt role the backend does not accept
 * is worse than one turn of missing context.
 */
export function chronologicalHistory(
  newestFirst: StoredMessage[],
  limit: number = HISTORY_TURNS
): ChatTurn[] {
  const bounded = Math.max(1, Math.trunc(limit) || 1);
  return newestFirst
    .filter((row): row is ChatTurn => row.role === "user" || row.role === "assistant")
    .slice(0, bounded)
    .reverse()
    .map((row) => ({ role: row.role, content: row.content.slice(0, MAX_TURN_CHARS) }));
}

/**
 * How many stored rows to ask for when filling a window of `limit` turns.
 *
 * More than `limit`, because the filter above drops non-conversational rows: a
 * query sized exactly to the window could come back with nothing usable after
 * filtering and silently hand the model an empty history.
 */
export function historyFetchSize(limit: number = HISTORY_TURNS): number {
  const bounded = Math.max(1, Math.trunc(limit) || 1);
  return bounded * 2;
}

/**
 * A conversation's title, derived from the question that opened it.
 *
 * Trimmed at a word boundary rather than mid-word, so a history list reads as a
 * list of subjects instead of a list of truncations.
 */
export function deriveConversationTitle(message: string, max = 60): string {
  const clean = (message ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean || "New conversation";
  const clipped = clean.slice(0, max);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

/** How much of the last thing said the history list shows. */
export const PREVIEW_CHARS = 140;

/** The shape the list query selects, as plain data. */
export interface ConversationSummarySource {
  id: string;
  title: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  shareToken: string | null;
  _count: { messages: number };
  /** The newest message only, as `orderBy createdAt desc, take 1` returns it. */
  messages: { content: string; role: string }[];
}

/** One row of the saved-chat list. Serialisable, because it is sent as JSON. */
export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
  shared: boolean;
}

/** A date that is already a string, or is unparseable, must not throw. */
function isoOrEmpty(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/**
 * The one-line gist of a message, safe for a list row.
 *
 * Collapsed to a single line because the source is model output or a pasted
 * article and both arrive full of newlines — a preview that keeps them breaks
 * the row layout and shows the reader the whitespace instead of the words.
 */
export function previewOf(content: string | null | undefined, max = PREVIEW_CHARS): string {
  return (content ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/* ── The evidence a saved turn was grounded in ───────────────────────────── */

export type ReadingState = "ok" | "warn" | "critical" | "unknown";

export interface StoredReading {
  id: string;
  area: string;
  label: string;
  value: string;
  state: ReadingState;
  detail?: string;
}

/** What the console renders under a saved answer. */
export interface ReadingsSummary {
  taken: number;
  missing: number;
  state: ReadingState;
  items: StoredReading[];
}

function readingState(value: unknown): ReadingState {
  return value === "ok" || value === "warn" || value === "critical" || value === "unknown" ? value : "unknown";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toStoredReading(value: unknown): StoredReading | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const label = typeof raw.label === "string" ? raw.label : "";
  const id = typeof raw.id === "string" ? raw.id : label;
  // An entry with neither an id nor a label has nothing to render, and keeping
  // it would put an empty row in the evidence list.
  if (!id && !label) return null;
  return {
    id,
    area: typeof raw.area === "string" ? raw.area : "",
    label,
    value: typeof raw.value === "string" ? raw.value : String(raw.value ?? ""),
    state: readingState(raw.state),
    ...(typeof raw.detail === "string" ? { detail: raw.detail } : {}),
  };
}

/**
 * Read the readings a turn was grounded in, from whatever shape was stored.
 *
 * This exists because of a crash, and the crash is worth describing, because the
 * shape of it is the shape of every bug in this file.
 *
 * The chat route streamed a turn to the console with its readings *including*
 * the individual items, and persisted the same turn to the database with only
 * the counts. The live answer therefore rendered perfectly while the stored copy
 * was a different object — and reopening a conversation from history fed the
 * thinner one to a panel that read `readings.items.length`, which is a
 * `TypeError` on `undefined`. Coming from React, that surfaced as the whole
 * admin page falling into its error boundary: clicking a saved chat appeared to
 * lead nowhere, and the transcript that caused it was fine all along.
 *
 * So this is deliberately total over its input and never throws. An absent
 * `items` becomes an empty list (the panel already has honest copy for "the
 * individual readings were not kept with this turn"), counts fall back to what
 * the items can prove, and anything unrecognisable yields `null` so the panel is
 * omitted rather than rendered wrong.
 */
export function toReadingsSummary(value: unknown): ReadingsSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const hasItems = Array.isArray(raw.items);
  if (!hasItems && !("taken" in raw) && !("missing" in raw)) return null;

  const items = hasItems
    ? (raw.items as unknown[]).map(toStoredReading).filter((r): r is StoredReading => r !== null)
    : [];

  return {
    // Counts are stored, but when they are absent the items are better evidence
    // than a zero would be — and a zero here reads as "grounded in nothing".
    taken: isNumber(raw.taken) ? raw.taken : items.length,
    missing: isNumber(raw.missing) ? raw.missing : 0,
    state: readingState(raw.state),
    items,
  };
}

/**
 * Turn a row of the history query into what the console renders.
 *
 * This lives here, and not in the route, for one reason: it is the part of the
 * saved-chat read path that can be wrong without anything failing. A list that
 * is empty because a mapper threw is indistinguishable, from the console, from
 * a list that is empty because there is nothing in it — and the same is true of
 * a preview that is blank, a count that reads zero, or a thread that claims to
 * be shared when it is not. Being a plain function over plain data makes each of
 * those assertable.
 *
 * Defensive about its input because the row is a join: `messages` can be an
 * empty array for a thread whose transcript was pruned, `_count` is a nested
 * object that a future query might stop selecting, and dates deserialise as
 * strings the moment a row comes back from a cache instead of Postgres. Any of
 * those used to be an unhandled throw in a route — which the console showed as
 * "no saved chats".
 */
export function toConversationSummary(row: ConversationSummarySource): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: isoOrEmpty(row.createdAt),
    updatedAt: isoOrEmpty(row.updatedAt),
    messageCount: row._count?.messages ?? 0,
    preview: previewOf(row.messages?.[0]?.content),
    shared: Boolean(row.shareToken),
  };
}
