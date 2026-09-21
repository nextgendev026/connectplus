import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * connectPlus offload store.
 *
 * These tables hold the two hottest write paths in the app — article views and
 * ad metrics — which used to be a Postgres UPDATE per render. Supabase's free
 * tier counts writes and egress, so keeping them here frees the database for
 * the reads that actually need relational integrity.
 *
 * ## Why every counter is sharded
 *
 * Convex runs mutations as optimistic-concurrency transactions: a mutation that
 * reads a document and writes it conflicts with any other transaction that
 * touched the same document, and the loser is retried from the start. A
 * *single* row per post (or per ad) made that row the hot spot — the popular
 * article of the day and the top-of-feed ad are exactly the keys that get many
 * views at the same instant, so those were the two rows that contended, and
 * they contended hardest precisely when traffic was highest. Convex retries
 * automatically, but a retry storm is not free and a run of conflicts fails the
 * mutation permanently, which shows up as views that quietly stop counting.
 *
 * The fix is the standard one: spread increments over a fixed number of rows
 * per key and sum on read. A writer picks a shard at random, so two concurrent
 * views collide only when they happen to choose the same one — and because a
 * retry re-runs the handler, it re-rolls the shard and usually lands somewhere
 * free. Contention falls by roughly the shard count, and reads cost a handful
 * of indexed lookups instead of one.
 *
 * `shard` is **optional** so the rows written before this change remain valid
 * documents: a legacy row is simply an extra row in the sum. Nothing has to be
 * migrated, and the read paths treat "no shard" as just another bucket.
 */
export default defineSchema({
  /** Running view total per post, plus a watermark for the Postgres sync. */
  postViews: defineTable({
    postId: v.string(),
    /** Which counter row this is; absent on pre-shard rows. */
    shard: v.optional(v.number()),
    total: v.number(),
    /** How much of `total` has already been folded into Post.viewCount. */
    synced: v.number(),
    lastViewedAt: v.number(),
  })
    .index("by_post", ["postId"])
    .index("by_post_shard", ["postId", "shard"]),

  /** Daily per-post buckets — cheap charts without scanning every post. */
  viewDays: defineTable({
    /** UTC day, YYYY-MM-DD. */
    day: v.string(),
    postId: v.string(),
    /** Which counter row this is; absent on pre-shard rows. */
    shard: v.optional(v.number()),
    count: v.number(),
  })
    .index("by_day", ["day"])
    .index("by_day_post", ["day", "postId"])
    .index("by_day_post_shard", ["day", "postId", "shard"]),

  /** Impressions/clicks per ad creative, keyed by the Postgres Ad id. */
  adStats: defineTable({
    adId: v.string(),
    /** Which counter row this is; absent on pre-shard rows. */
    shard: v.optional(v.number()),
    impressions: v.number(),
    clicks: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ad", ["adId"])
    .index("by_ad_shard", ["adId", "shard"]),
});
