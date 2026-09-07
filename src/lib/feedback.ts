/**
 * Client-side learning-loop telemetry (Phase 3).
 *
 * Fire-and-forget by design: sending feedback never blocks or breaks browsing.
 * A stable per-browser session id lets anonymous users contribute impression /
 * click data, while signed-in events are attributed to the user server-side so
 * their preference vector can be updated.
 */

const SESSION_KEY = "connectplus:session";

export type FeedbackType =
  | "impression"
  | "click"
  | "like"
  | "bookmark"
  | "share"
  | "time_spent"
  | "comment";

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

interface FeedbackPayload {
  postId?: string | null;
  value?: number;
  variant?: string | null;
}

/**
 * Send a feedback event. Uses keepalive so events fired on page unload are not
 * dropped. Never throws.
 */
export function sendFeedback(
  type: FeedbackType,
  payload: FeedbackPayload = {}
): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    type,
    postId: payload.postId ?? null,
    value: payload.value ?? null,
    variant: payload.variant ?? null,
    sessionId: getSessionId(),
  });
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