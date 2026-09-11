import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Count one article view. Called from the article page render, so it must stay
 * a single indexed read + two writes at most.
 */
export const record = mutation({
  args: { postId: v.string() },
  returns: v.null(),
  handler: async (ctx, { postId }) => {
    const now = Date.now();
    const day = utcDay(now);

    const existing = await ctx.db
      .query("postViews")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { total: existing.total + 1, lastViewedAt: now });
    } else {
      await ctx.db.insert("postViews", { postId, total: 1, synced: 0, lastViewedAt: now });
    }

    const dayRow = await ctx.db
      .query("viewDays")
      .withIndex("by_day_post", (q) => q.eq("day", day).eq("postId", postId))
      .unique();

    if (dayRow) {
      await ctx.db.patch(dayRow._id, { count: dayRow.count + 1 });
    } else {
      await ctx.db.insert("viewDays", { day, postId, count: 1 });
    }

    return null;
  },
});

/** Total views for one post (Convex-side truth). */
export const count = query({
  args: { postId: v.string() },
  returns: v.number(),
  handler: async (ctx, { postId }) => {
    const row = await ctx.db
      .query("postViews")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .unique();
    return row?.total ?? 0;
  },
});

/** Totals for a batch of posts — one round trip for a whole feed page. */
export const counts = query({
  args: { postIds: v.array(v.string()) },
  returns: v.array(v.object({ postId: v.string(), total: v.number() })),
  handler: async (ctx, { postIds }) => {
    const out: { postId: string; total: number }[] = [];
    for (const postId of postIds.slice(0, 100)) {
      const row = await ctx.db
        .query("postViews")
        .withIndex("by_post", (q) => q.eq("postId", postId))
        .unique();
      if (row) out.push({ postId, total: row.total });
    }
    return out;
  },
});

/**
 * View deltas not yet folded into Post.viewCount. The daily Inngest step reads
 * this, applies the deltas in Postgres, then calls `markSynced`.
 */
export const pending = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({ postId: v.string(), delta: v.number(), total: v.number() })),
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("postViews").collect();
    return rows
      .filter((r) => r.total > r.synced)
      .slice(0, limit ?? 500)
      .map((r) => ({ postId: r.postId, delta: r.total - r.synced, total: r.total }));
  },
});

/** Mark a batch as reconciled after Postgres accepted the deltas. */
export const markSynced = mutation({
  args: { postIds: v.array(v.string()) },
  returns: v.number(),
  handler: async (ctx, { postIds }) => {
    let n = 0;
    for (const postId of postIds) {
      const row = await ctx.db
        .query("postViews")
        .withIndex("by_post", (q) => q.eq("postId", postId))
        .unique();
      if (row && row.total > row.synced) {
        await ctx.db.patch(row._id, { synced: row.total });
        n++;
      }
    }
    return n;
  },
});

/** Most-viewed posts for a UTC day — powers the trending sidebar. */
export const topToday = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({ postId: v.string(), count: v.number() })),
  handler: async (ctx, { limit }) => {
    const day = utcDay(Date.now());
    const rows = await ctx.db
      .query("viewDays")
      .withIndex("by_day", (q) => q.eq("day", day))
      .collect();
    return rows
      .sort((a, b) => b.count - a.count)
      .slice(0, limit ?? 10)
      .map((r) => ({ postId: r.postId, count: r.count }));
  },
});
