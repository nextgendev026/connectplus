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
