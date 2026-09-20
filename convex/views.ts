import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Ceilings. Every read below is capped by one of these, because an unbounded
 * `collect()` is not a slow query on Convex — it is a *failing* one. A function
 * execution may read at most ~16k documents, and past that the call does not
 * return a short answer, it throws. So a read that is correct today silently
 * becomes an outage the day the table crosses the limit, and the symptom is
 * "views stopped counting" with no obvious cause.
 */
const MAX_PAGE = 500;
/** Most of a day's buckets any single top-list call will look at. */
const MAX_DAY_ROWS = 8000;
const MAX_PRUNE_BATCH = 500;

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
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { total: existing.total + 1, lastViewedAt: now });
    } else {
      await ctx.db.insert("postViews", { postId, total: 1, synced: 0, lastViewedAt: now });
    }

    const dayRow = await ctx.db
      .query("viewDays")
      .withIndex("by_day_post", (q) => q.eq("day", day).eq("postId", postId))
      .first();

    if (dayRow) {
      await ctx.db.patch(dayRow._id, { count: dayRow.count + 1 });
    } else {
      await ctx.db.insert("viewDays", { day, postId, count: 1 });
    }

    return null;
  },
});

/**
 * Total views for one post (Convex-side truth).
 *
 * `first()` rather than `unique()`, deliberately. `unique()` throws when it
 * finds more than one match, and since it is used on the *write* path that
 * would mean a single stray duplicate row — one that could only come from a
 * concurrent insert — permanently breaks view counting for that post: every
 * future render throws, forever, and the article shows a number that never
 * moves. `first()` is the strictly safer read here, because the failure mode of
 * a duplicate is then one undercounted row instead of a dead counter.
 */
export const count = query({
  args: { postId: v.string() },
  returns: v.number(),
  handler: async (ctx, { postId }) => {
    const row = await ctx.db
      .query("postViews")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .first();
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
        .first();
      if (row) out.push({ postId, total: row.total });
    }
    return out;
  },
});

/**
 * One page of view deltas not yet folded into Post.viewCount.
 *
 * This used to be `ctx.db.query("postViews").collect()` followed by a filter
 * and a slice — which reads *every row in the table* to return at most 500 of
 * them. Two consequences, and the second is the one that hurts:
 *
 *   1. The cost of the nightly fold grew with the table, not with the backlog.
 *   2. Once `postViews` passed Convex's per-execution document limit the query
 *      stopped returning a short answer and started throwing. The fold would
 *      then record "Convex unreachable", the admin health view would blame the
 *      deployment, and the real cause — a read that outgrew its ceiling —
 *      would look like an outage.
 *
 * Paginating over the table's creation order keeps each execution bounded no
 * matter how many posts exist, and the caller walks the pages until `isDone`.
 * `paginationOpts.numItems` is clamped so a caller cannot ask for a page big
 * enough to hit the ceiling anyway.
 *
 * A page may legitimately contain nothing while more pages remain: the filter
 * is on the *values* of the rows on this page, not on their position. So
 * `isDone` — never `views.length` — is what ends the walk.
 */
export const pending = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    views: v.array(v.object({ postId: v.string(), delta: v.number(), total: v.number() })),
    continueCursor: v.string(),
    isDone: v.boolean(),
    /** Rows examined on this page, so the caller can tell a full scan from an empty one. */
    scanned: v.number(),
  }),
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db
      .query("postViews")
      .order("asc")
      .paginate({
        numItems: Math.min(Math.max(1, paginationOpts.numItems), MAX_PAGE),
        cursor: paginationOpts.cursor,
      });

    const views = page.page
      .filter((row) => row.total > row.synced)
      .map((row) => ({ postId: row.postId, delta: row.total - row.synced, total: row.total }));

    return {
      views,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      scanned: page.page.length,
    };
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
        .first();
      if (row && row.total > row.synced) {
        await ctx.db.patch(row._id, { synced: row.total });
        n++;
      }
    }
    return n;
  },
});

/**
 * Rows still waiting to be folded, up to `limit`.
 *
 * Kept for the admin health view, which wants a number rather than a walk. It
 * reads at most one page, so a large backlog is reported as "500+" instead of
 * costing an unbounded read.
 */
export const pendingSummary = query({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ views: v.number(), posts: v.number(), done: v.boolean() }),
  handler: async (ctx, { limit }) => {
    const page = await ctx.db
      .query("postViews")
      .order("asc")
      .paginate({
        numItems: Math.min(Math.max(1, limit ?? MAX_PAGE), MAX_PAGE),
        cursor: null,
      });
    const pendingRows = page.page.filter((row) => row.total > row.synced);
    return {
      views: pendingRows.reduce((sum, row) => sum + (row.total - row.synced), 0),
      posts: pendingRows.length,
      done: page.isDone,
    };
  },
});

/**
 * Most-viewed posts for a UTC day — powers the trending sidebar.
 *
 * Bounded by `MAX_DAY_ROWS`. A day's bucket count is bounded by the number of
 * posts viewed that day, so the cap is only reachable on a platform far larger
 * than this one; past it the list is the top of the first 8000 rather than an
 * error, which is the right way for a sidebar to degrade.
 */
export const topToday = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({ postId: v.string(), count: v.number() })),
  handler: async (ctx, { limit }) => {
    const day = utcDay(Date.now());
    const rows = await ctx.db
      .query("viewDays")
      .withIndex("by_day", (q) => q.eq("day", day))
      .take(MAX_DAY_ROWS);
    return rows
      .sort((a, b) => b.count - a.count)
      .slice(0, limit ?? 10)
      .map((r) => ({ postId: r.postId, count: r.count }));
  },
});

/**
 * Retention for the daily buckets.
 *
 * `viewDays` gains one row per post per day and nothing ever removed them, so
 * the table grew without bound — on a free tier that counts *stored data*,
 * that is a slow-motion outage with the same symptom as the read limit: one
 * day the writes start failing. Rows older than the window are deleted in
 * bounded batches; the caller repeats until a batch comes back short.
 */
export const pruneDays = mutation({
  args: { before: v.string(), limit: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, { before, limit }) => {
    const rows = await ctx.db
      .query("viewDays")
      .withIndex("by_day", (q) => q.lt("day", before))
      .take(Math.min(Math.max(1, limit ?? MAX_PRUNE_BATCH), MAX_PRUNE_BATCH));
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return rows.length;
  },
});
