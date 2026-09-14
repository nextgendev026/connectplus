/**
 * Where the sports board polls.
 *
 * The board refreshes on a timer — every 15s while a match is in play — and
 * that payload is byte-identical for every anonymous reader. Pointing every
 * viewer at the origin turns a popular fixture into hundreds of serverless
 * invocations a minute for the same JSON; pointing them at the Cloudflare edge
 * collapses that into one origin fetch per TTL window, and a reader arriving
 * mid-window gets an instant answer from the edge's stale copy while it
 * refreshes behind them.
 *
 * That is the whole offload strategy in one function: **every pollable read
 * leaves Vercel**. Getting this wrong is not a small cost — it is the single
 * largest consumer of function invocations on the platform, because the polls
 * scale with readers × fixtures, while the data scales with fixtures alone.
 *
 * Two properties make it safe, and both are enforced by the worker rather than
 * by trust here: the edge only ever caches anonymous responses (any Cookie or
 * Authorization header is passed straight through), and the paths routed through
 * it are explicitly reader-independent. `NEXT_PUBLIC_EDGE_URL` is the worker's
 * public URL (see workers/edge-cache). Unset — local dev, previews without a
 * worker — the helpers fall back to the app's own routes, which serve the same
 * payload.
 */
const EDGE_URL = (process.env.NEXT_PUBLIC_EDGE_URL ?? "").replace(/\/+$/, "");

/** True when polling is routed through the edge worker. */
export function isEdgeEnabled(): boolean {
  return EDGE_URL.length > 0;
}

/**
 * The origin the browser should read a pollable sports endpoint from.
 *
 * Returns an absolute edge URL when configured, else the relative app path — so
 * a deployment without a worker still works, it just pays for its own traffic.
 */
export function edgeUrl(path: string, params: Record<string, string> = {}): string {
  const qs = new URLSearchParams(params).toString();
  const suffix = qs ? `?${qs}` : "";
  if (!EDGE_URL) return `${path}${suffix}`;
  return `${EDGE_URL}${path}${suffix}`;
}

/** The livescore feed URL: the edge alias when configured, else the app route. */
export function liveEndpoint(params: { sport: string; date?: string; fresh?: boolean }): string {
  const query: Record<string, string> = { sport: params.sport };
  if (params.date) query.date = params.date;
  if (params.fresh) query.fresh = "1";
  // The alias, not the bare path: the board's query string is open-ended and
  // every distinct query is a distinct edge entry, so the worker snaps it to a
  // closed set. `/__livescore` is that canonical form.
  return EDGE_URL ? edgeUrl("/__livescore", query) : edgeUrl("/api/sports/live", query);
}

/** The tips board feed. Same reasoning as the livescore tier. */
export function tipsEndpoint(params: { limit?: number; market?: string; sort?: string; bust?: number } = {}): string {
  const query: Record<string, string> = {};
  if (params.limit) query.limit = String(params.limit);
  if (params.market) query.market = params.market;
  if (params.sort) query.sort = params.sort;
  if (params.bust) query.bust = String(params.bust);
  return edgeUrl("/api/sports/predictions", query);
}

/** One fixture's deep read — the panel that polls every 30s while a match is live. */
export function matchEndpoint(params: {
  provider: string;
  externalId: string;
  home: string;
  away: string;
  fresh?: boolean;
  regenerate?: boolean;
}): string {
  const query: Record<string, string> = {
    provider: params.provider,
    externalId: params.externalId,
    home: params.home,
    away: params.away,
  };
  if (params.fresh) query.fresh = "1";
  if (params.regenerate) query.regenerate = "1";
  return edgeUrl("/api/sports/match", query);
}

/** The fixture calendar (a day, a week or a month at a time). */
export function calendarEndpoint(params: { from?: string; to?: string; sport?: string } = {}): string {
  const query: Record<string, string> = {};
  if (params.from) query.from = params.from;
  if (params.to) query.to = params.to;
  if (params.sport) query.sport = params.sport;
  return edgeUrl("/api/sports/calendar", query);
}
