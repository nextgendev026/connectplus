/**
 * Where the live board polls.
 *
 * The board refreshes on a timer — every 15s while a match is in play — and
 * that payload is byte-identical for every anonymous reader. Pointing every
 * viewer at the origin turns a popular fixture into hundreds of serverless
 * invocations a minute for the same JSON; pointing them at the Cloudflare edge
 * collapses that into one origin fetch per TTL window, and a reader arriving
 * mid-window gets an instant answer from the edge's stale copy while it
 * refreshes behind them.
 *
 * `NEXT_PUBLIC_EDGE_URL` is the worker's public URL (see workers/edge-cache).
 * Unset — local dev, previews without a worker — the helpers fall back to the
 * app's own routes, which serve the same payload.
 */
const EDGE_URL = (process.env.NEXT_PUBLIC_EDGE_URL ?? "").replace(/\/+$/, "");

/** True when polling is routed through the edge worker. */
export function isEdgeEnabled(): boolean {
  return EDGE_URL.length > 0;
}

/** The livescore feed URL: the edge alias when configured, else the app route. */
export function liveEndpoint(params: { sport: string; date?: string; fresh?: boolean }): string {
  const qs = new URLSearchParams({ sport: params.sport });
  if (params.date) qs.set("date", params.date);
  if (params.fresh) qs.set("fresh", "1");
  return EDGE_URL ? `${EDGE_URL}/__livescore?${qs.toString()}` : `/api/sports/live?${qs.toString()}`;
}

