/**
 * Client-side learning-loop telemetry (Phase 3).
 *
 * Fire-and-forget by design: sending feedback never blocks or breaks browsing.
 * A stable per-browser session id lets anonymous users contribute impression /
 * click data, while signed-in events are attributed to the user server-side so
 * their preference vector can be updated.
 *
 * Events are buffered and flushed in batches (every 30s or on unload) so a busy
 * feed visit collapses ~20 per-event HTTP writes into one.
 */

const SESSION_KEY = "connectplus:session";
const FLUSH_INTERVAL_MS = 30_000;

export type FeedbackType =
  | "impression"
  | "click"
  | "like"
  | "bookmark"
  | "share"
  | "time_spent"
  | "comment";

interface FeedbackEvent {
  type: FeedbackType;
  postId?: string | null;
  value?: number | null;
  variant?: string | null;
  sessionId: string;
}

/** Stable per-browser session id (persisted in localStorage). */
export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

const buffer: FeedbackEvent[] = [];
let flushInterval: number | null = null;

function sendNow(body: string): void {
  try {
    navigator.sendBeacon?.("/api/feedback", body);
  } catch {
    /* ignore */
  }
  // sendBeacon always uses POST with CORS-unsafe content type, which the API
  // accepts; fall back to fetch keepalive on the off chance it is unavailable.
  if (typeof navigator.sendBeacon !== "function") {
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }
}

/**
 * Flush any buffered events. Batched events ride together in one beacon;
 * a lone event keeps the original single-event shape. Never throws.
 */
export function flushFeedback(): void {
  if (buffer.length === 0) return;
  const events = buffer.splice(0, buffer.length);
  const body =
    events.length === 1
      ? JSON.stringify(events[0])
      : JSON.stringify({ events });
  sendNow(body);
}

function scheduleFlush(): void {
  if (flushInterval !== null) return;
  flushInterval = window.setInterval(flushFeedback, FLUSH_INTERVAL_MS);
}

/**
 * Send a feedback event. Buffered and flushed in batches on an interval (or on
 * tab hide/unload) so telemetry stays cheap. Never throws.
 */
export function sendFeedback(
  type: FeedbackType,
  payload: { postId?: string | null; value?: number; variant?: string | null } = {}
): void {
  if (typeof window === "undefined") return;
  buffer.push({
    type,
    postId: payload.postId ?? null,
    value: payload.value ?? null,
    variant: payload.variant ?? null,
    sessionId: getSessionId(),
  });
  try {
    scheduleFlush();
  } catch {
    /* ignore */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushFeedback);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushFeedback();
  });
}