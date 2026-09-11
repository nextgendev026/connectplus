import { ConvexHttpClient } from "convex/browser";

/**
 * Convex service layer.
 *
 * Convex owns the two highest-volume write paths (article views and ad
 * metrics) so Supabase's free tier spends its writes and egress on the reads
 * that actually need a relational store.
 *
 * Every helper is best-effort: when `NEXT_PUBLIC_CONVEX_URL` is unset — or
 * Convex is unreachable — each call resolves to a neutral value and the caller
 * falls back to its Postgres path. Offloading must never take the site down.
 */

const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? "";

let client: ConvexHttpClient | null = null;

/** True when Convex is configured, so callers can skip work entirely. */
export function convexAvailable(): boolean {
  return Boolean(url);
}

function getClient(): ConvexHttpClient | null {
  if (!url) return null;
  if (!client) client = new ConvexHttpClient(url);
  return client;
}

/** Generic best-effort mutation — never throws, never blocks a render. */
async function call<T>(fn: (c: ConvexHttpClient) => Promise<T>, fallback: T): Promise<T> {
  const c = getClient();
  if (!c) return fallback;
  try {
    return await fn(c);
  } catch {
    return fallback;
  }
}

/* ── Article views ─────────────────────────────────────────────────────── */

export async function convexRecordView(postId: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    await c.mutation("views:record" as never, { postId } as never);
    return true;
  } catch {
    return false;
  }
}

export async function convexViewCount(postId: string): Promise<number | null> {
  return call(
    (c) => c.query("views:count" as never, { postId } as never) as Promise<number>,
    null
  );
}

export interface ViewDelta {
  postId: string;
  delta: number;
  total: number;
}

/** Deltas waiting to be folded into Post.viewCount by the daily sync. */
export async function convexPendingViews(limit = 500): Promise<ViewDelta[]> {
  return call(
    (c) => c.query("views:pending" as never, { limit } as never) as Promise<ViewDelta[]>,
    []
  );
}

export async function convexMarkViewsSynced(postIds: string[]): Promise<number> {
  if (postIds.length === 0) return 0;
  return call(
    (c) => c.mutation("views:markSynced" as never, { postIds } as never) as Promise<number>,
    0
  );
}

/** Most-viewed posts today (UTC) — used by the trending sidebar. */
export async function convexTopToday(limit = 10): Promise<{ postId: string; count: number }[]> {
  return call(
    (c) =>
      c.query("views:topToday" as never, { limit } as never) as Promise<
        { postId: string; count: number }[]
      >,
    []
  );
}

/* ── Ad metrics ────────────────────────────────────────────────────────── */

export async function convexAdImpression(adId: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    await c.mutation("ads:impression" as never, { adId } as never);
    return true;
  } catch {
    return false;
  }
}

export async function convexAdClick(adId: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    await c.mutation("ads:click" as never, { adId } as never);
    return true;
  } catch {
    return false;
  }
}

export interface ConvexAdStats {
  ads: { adId: string; impressions: number; clicks: number }[];
  impressions: number;
  clicks: number;
}

export async function convexAdStats(): Promise<ConvexAdStats | null> {
  return call(
    (c) => c.query("ads:stats" as never, {} as never) as Promise<ConvexAdStats>,
    null
  );
}
