import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * connectPlus offload store.
 *
 * These tables hold the two hottest write paths in the app — article views and
 * ad metrics — which used to be a Postgres UPDATE per render. Supabase's free
 * tier counts writes and egress, so keeping them here frees the database for
 * the reads that actually need relational integrity.
 */
export default defineSchema({
  /** Running view total per post, plus a watermark for the Postgres sync. */
  postViews: defineTable({
    postId: v.string(),
    total: v.number(),
    /** How much of `total` has already been folded into Post.viewCount. */
    synced: v.number(),
    lastViewedAt: v.number(),
  }).index("by_post", ["postId"]),

  /** Daily per-post buckets — cheap charts without scanning every post. */
  viewDays: defineTable({
    /** UTC day, YYYY-MM-DD. */
    day: v.string(),
    postId: v.string(),
    count: v.number(),
  })
    .index("by_day", ["day"])
    .index("by_day_post", ["day", "postId"]),

  /** Impressions/clicks per ad creative, keyed by the Postgres Ad id. */
  adStats: defineTable({
    adId: v.string(),
    impressions: v.number(),
    clicks: v.number(),
    updatedAt: v.number(),
  }).index("by_ad", ["adId"]),
});
