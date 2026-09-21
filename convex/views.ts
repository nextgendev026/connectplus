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
 * How many rows each counter is spread over.
 *
 * One row per post made that row a hot spot: every reader of the day's most
 * popular story incremented the same document, and Convex's optimistic
 * concurrency means all but one of each overlapping pair is retried from the
 * start. Eight rows makes two simultaneous views collide only if they pick the
 * same one, and a retried mutation re-rolls its choice — so the retry usually
 * succeeds instead of colliding again.
 */
const SHARDS = 8;
/**
 * Cap on the rows a read will sum.
 *
 * `SHARDS` plus room for the pre-shard rows a deployment may still carry, which
 * are extra buckets in the sum rather than something to migrate. Reading past
 * the cap would be a bug, not a bigger total, so the bound is generous rather
 * than tight.
 */
const MAX_COUNTER_ROWS = 64;

/** Pick the counter row to write. Re-rolled on every automatic retry. */
function pickShard(): number {
  return Math.floor(Math.random() * SHARDS);
}

/**
 * Count one article view. Called from the browser as a beacon, so it must stay
 * a bounded indexed read plus two writes.
 *
 * The write is to a randomly chosen shard of the post's counter, and to the
 * matching shard of the day's bucket. Concurrent views of the same story now
 * usually touch different documents, which is the whole point: the old shape
 * had every one of them contend for two rows.
 */
export const record = mutation({
  args: { postId: v.string() },
  returns: v.null(),
  handler: async (ctx, { postId }) => {
    const now = Date.now();
    const day = utcDay(now);
    const shard = pickShard();

    const existing = await ctx.db
      .query("postViews")
      .withIndex("by_post_shard", (q) => q.eq("postId", postId).eq("shard", shard))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { total: existing.total + 1, lastViewedAt: now });
    } else {
      await ctx.db.insert("postViews", { postId, shard, total: 1, synced: 0, lastViewedAt: now });
    }

    const dayRow = await ctx.db
      .query("viewDays")
      .withIndex("by_day_post_shard", (q) =>
        q.eq("day", day).eq("postId", postId).eq("shard", shard)
      )
      .first();

    if (dayRow) {
      await ctx.db.patch(dayRow._id, { count: dayRow.count + 1 });
    } else {
      await ctx.db.insert("viewDays", { day, postId, shard, count: 1 });
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
    const rows = await ctx.db
      .query("postViews")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .take(MAX_COUNTER_ROWS);
    let total = 0;
    for (const row of rows) total += row.total;
    return total;
  },
});

/** Totals for a batch of posts — one round trip for a whole feed page. */
export const counts = query({
  args: { postIds: v.array(v.string()) },
  returns: v.array(v.object({ postId: v.string(), total: v.number() })),
  handler: async (ctx, { postIds }) => {
    const out: { postId: string; total: number }[] = [];
    for (const postId of postIds.slice(0, 100)) {
      const rows = await ctx.db
        .query("postViews")
        .withIndex("by_post", (q) => q.eq("postId", postId))
        .take(MAX_COUNTER_ROWS);
      if (rows.length === 0) continue;
      let total = 0;
      for (const row of rows) total += row.total;
      out.push({ postId, total });
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

/**
 * Mark a batch as reconciled after Postgres accepted the deltas.
 *
 * It marks the **amount that was folded**, not everything counted so far.
 *
 * The old version took a list of post ids and set `synced = row.total` from a
 * fresh read — so any view that arrived between the fold's read of the backlog
 * and this write was marked as reconciled without ever being added to
 * Postgres. Under load that is a steady trickle of views disappearing, and it
 * is invisible: nothing errors, the backlog drains, and the number is simply
 * lower than the traffic. Taking the folded amount per post and advancing each
 * counter row by at most that much means a view that lands mid-fold stays
 * pending and is picked up by the next pass.
 *
 * Sharded counters make the per-post total span several rows, so each row is
 * advanced until the folded amount is used up. The greediness across rows does
 * not matter: what is being recorded is a total, not a per-row figure.
 */
export const markSynced = mutation({
  args: {
    entries: v.array(v.object({ postId: v.string(), delta: v.number() })),
  },
  returns: v.number(),
  handler: async (ctx, { entries }) => {
    let patched = 0;
    for (const { postId, delta } of entries) {
      let remaining = Math.max(0, delta);
      if (remaining === 0) continue;

      const rows = await ctx.db
        .query("postViews")
        .withIndex("by_post", (q) => q.eq("postId", postId))
        .take(MAX_COUNTER_ROWS);

      for (const row of rows) {
        if (remaining <= 0) break;
        const pending = row.total - row.synced;
        if (pending <= 0) continue;
        const take = Math.min(pending, remaining);
        await ctx.db.patch(row._id, { synced: row.synced + take });
        remaining -= take;
        patched++;
      }
    }
    return patched;
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
    // A story's day is now spread across its shard rows, so the ranking has to
    // add them up first — otherwise the top list would rank a single shard of a
    // popular story against the whole of a quiet one.
    const byPost = new Map<string, number>();
    for (const row of rows) {
      byPost.set(row.postId, (byPost.get(row.postId) ?? 0) + row.count);
    }
    return [...byPost.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit ?? 10)
      .map(([postId, count]) => ({ postId, count }));
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
