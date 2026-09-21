/**
 * When to keep trying a dead radio stream, and when to stop.
 *
 * This is a pure function of the attempt count, kept out of the player component
 * for one reason: it is the part of the reconnect behaviour that was wrong, and
 * it was wrong in a way that no test could see. The player held the curve inline
 * and the cap not at all, so the only way to observe "it retries forever" was to
 * leave a tab open for an hour. Expressed as a function of `attempt`, both the
 * curve and the terminus are exhaustively checkable in milliseconds.
 *
 * The two properties that matter, and that the tests pin:
 *
 *   1. The delay grows and is bounded.
 *   2. It ends. `shouldRetry` is false from some attempt onwards, and the caller
 *      must treat that as final rather than as "try again later".
 */

/** The first retry waits this long. */
export const RECONNECT_FLOOR_MS = 8_000;

/** The delay never exceeds this, however many attempts are made. */
export const RECONNECT_CEILING_MS = 60_000;

/**
 * How many retries before the player gives up.
 *
 * Five attempts spans roughly two minutes — 8s, 16s, 32s, 60s, 60s — which is
 * long enough to ride out a genuine blip (a mount restarting, a handover) and
 * short enough that a listener is not left watching a spinner for a station that
 * is not coming back.
 *
 * The number is deliberately small rather than "large but finite". The harm being
 * avoided is not the wasted retry, it is the *upstream session*: a relay that
 * sells listener time plays a pre-roll at the start of every new connection, so
 * each attempt costs the listener an advert. Six minutes of adverts replayed
 * over silence is a worse outcome than an honest "unavailable" and a button.
 */
export const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * The wait before the retry that follows `attempt` failures.
 *
 * `attempt` is the number of retries already spent, so the first retry
 * (`attempt === 0`) waits the floor. Jitter is deliberately absent: the player is
 * a single client against one upstream, not a fleet, so there is no thundering
 * herd to spread — and an unpredictable delay makes the behaviour harder to
 * reason about for the listener watching a countdown.
 */
export function reconnectDelayMs(attempt: number): number {
  const spent = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  // `2 ** spent` overflows to Infinity for large counts, which `Math.min` maps
  // back to the ceiling — so the guard is arithmetic rather than a special case.
  return Math.min(RECONNECT_FLOOR_MS * 2 ** spent, RECONNECT_CEILING_MS);
}

/**
 * Is there another attempt left after `attempt` failures?
 *
 * False means the caller must stop and hand control back to the listener. Wiring
 * this up without a terminal UI state is what made the old behaviour a silent
 * loop: the retries ended conceptually but the interface kept saying
 * "Reconnecting…", so nothing on screen distinguished it from progress.
 */
export function shouldRetry(attempt: number): boolean {
  const spent = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  return spent < MAX_RECONNECT_ATTEMPTS;
}

/**
 * How many attempts are left, for a message that can be specific.
 *
 * The UI is better telling a listener on attempt 4 that it is about to stop than
 * letting them discover it by waiting.
 */
export function attemptsRemaining(attempt: number): number {
  const spent = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  return Math.max(0, MAX_RECONNECT_ATTEMPTS - spent);
}
