import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { createLogger } from "@/lib/logger";

const log = createLogger("convex");

/**
 * Convex service layer.
 *
 * Convex owns the two highest-volume write paths (article views and ad
 * metrics) so Supabase's free tier spends its writes and egress on the reads
 * that actually need a relational store.
 *
 * Two properties this layer has to get right:
 *
 *   1. OFFLOADING MUST NEVER TAKE THE SITE DOWN. Every helper is best-effort:
 *      when `NEXT_PUBLIC_CONVEX_URL` is unset — or Convex is unreachable — each
 *      call resolves to a neutral value and the caller falls back to Postgres.
 *
 *   2. FAILURE MUST BE VISIBLE. Best-effort used to mean silent, which is how a
 *      whole integration can be configured, reachable, and still storing
 *      nothing: a renamed argument or an undeployed function made every call
 *      throw into an empty `catch`, and the site looked perfectly healthy while
 *      view deltas silently never accumulated. Failures are therefore logged,
 *      and the first success/failure is remembered so the console can report the
 *      real state rather than merely "a URL is set".
 *
 * The calls use the GENERATED api wrapper (`api.views.record`) rather than a
 * string name cast through `never`. That is what makes an argument rename a
 * compile error instead of a silent no-op.
 */

const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? "";

let client: ConvexHttpClient | null = null;

/** True when Convex is configured, so callers can skip work entirely. */
export function convexAvailable(): boolean {
  return Boolean(url);
}

/**
 * Last observed outcome, for the admin console. `unknown` until a call is made:
 * a configured URL is not evidence that anything works.
 */
export type ConvexHealth = "unknown" | "ok" | "failing";
let health: ConvexHealth = "unknown";
let lastError: string | null = null;

export function convexHealth(): { state: ConvexHealth; error: string | null } {
  return { state: health, error: lastError };
}

function getClient(): ConvexHttpClient | null {
  if (!url) return null;
  if (!client) client = new ConvexHttpClient(url);
  return client;
}

/**
 * Generic best-effort call — never throws, never blocks a render — that still
 * records that something went wrong.
 */
async function call<T>(fn: (c: ConvexHttpClient) => Promise<T>, fallback: T, op: string): Promise<T> {
  const c = getClient();
  if (!c) return fallback;
  try {
    const value = await fn(c);
    if (health !== "ok") {
      log.info("convex reachable", { op });
      health = "ok";
      lastError = null;
    }
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Log the first failure and each change of state, not every miss: a visitor
    // storm against a down deployment must not become a log storm.
    if (health !== "failing" || lastError !== message) {
      log.warn("convex call failed — falling back to Postgres", { op, error: message });
    }
    health = "failing";
    lastError = message;
    return fallback;
  }
}

/* ── Article views ─────────────────────────────────────────────────────── */

export async function convexRecordView(postId: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    await c.mutation(api.views.record, { postId });
    health = "ok";
    lastError = null;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (health !== "failing" || lastError !== message) {
      log.warn("view could not be offloaded", { postId, error: message });
    }
    health = "failing";
    lastError = message;
    return false;
  }
}

export async function convexViewCount(postId: string): Promise<number | null> {
  return call((c) => c.query(api.views.count, { postId }), null, "views.count");
}

export interface ViewDelta {
  postId: string;
  delta: number;
  total: number;
}

/** Deltas waiting to be folded into Post.viewCount by the daily sync. */
export async function convexPendingViews(limit = 500): Promise<ViewDelta[]> {
  return call((c) => c.query(api.views.pending, { limit }), [], "views.pending");
}

export async function convexMarkViewsSynced(postIds: string[]): Promise<number> {
  if (postIds.length === 0) return 0;
  return call((c) => c.mutation(api.views.markSynced, { postIds }), 0, "views.markSynced");
}

/** Most-viewed posts today (UTC) — used by the trending sidebar. */
export async function convexTopToday(limit = 10): Promise<{ postId: string; count: number }[]> {
  return call((c) => c.query(api.views.topToday, { limit }), [], "views.topToday");
}

/* ── Ad metrics ────────────────────────────────────────────────────────── */

export async function convexAdImpression(adId: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    await c.mutation(api.ads.impression, { adId });
    health = "ok";
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (health !== "failing" || lastError !== message) {
      log.warn("ad impression could not be offloaded", { adId, error: message });
    }
    health = "failing";
    lastError = message;
    return false;
  }
}

export async function convexAdClick(adId: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    await c.mutation(api.ads.click, { adId });
    health = "ok";
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (health !== "failing" || lastError !== message) {
      log.warn("ad click could not be offloaded", { adId, error: message });
    }
    health = "failing";
    lastError = message;
    return false;
  }
}

export interface ConvexAdStats {
  ads: { adId: string; impressions: number; clicks: number }[];
  impressions: number;
  clicks: number;
}

export async function convexAdStats(): Promise<ConvexAdStats | null> {
  return call((c) => c.query(api.ads.stats, {}), null, "ads.stats");
}
