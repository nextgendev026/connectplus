/**
 * Grouped analytics reads.
 *
 * This module exists because the intelligence layer's regional and growth
 * reports were the most expensive things the platform did, and they were
 * expensive for a reason nobody would guess from the call site: they ran a
 * query *per region* and a query *per day*.
 *
 * The measured shapes, before this module:
 *
 *   - `getRegionalIntelligence()` issued **two queries per city, with no bound
 *     at all** on how many cities there were. Cost grew with the size of the
 *     `node` column, so the answer to "how are our regions doing?" got slower
 *     every time a new region gained its first user — forever, without anyone
 *     changing a line of code.
 *   - `getGrowthReport()` issued **three queries per day across 30 days** — 90
 *     round trips to draw one chart, each one an indexed count. Ninety fast
 *     queries is not fast: on a serverless instance with a connection pool of
 *     10 and a cold start, that is the whole pool held for the duration of one
 *     dashboard render.
 *   - `getPlatformStats()` and `analyzeUsers()` repeated the same per-node
 *     pattern for the regional breakdown.
 *
 * Everything here is aggregated in the database and then merged in JavaScript,
 * which is the reverse of what it looks like it should be. The instinct is one
 * clever query with CTEs and a join across three tables; that instinct is
 * wrong here. Three separate `GROUP BY date_trunc(...)` aggregates hit three
 * narrow indexes (`PageView(createdAt)`, `Post(createdAt)`, `User(createdAt)`),
 * where a single joined statement forces a plan that scans the largest table
 * once and then joins it against everything else. The round-trip count is what
 * mattered, and it drops from 90 to 3 either way.
 *
 * The merge also has to fill the days the database did not return. A
 * `GROUP BY` answers only for days that have rows, so a day with no page views
 * is *absent*, not zero — and a chart that silently skips a day compresses the
 * x-axis and lies about the trend. `dailySeries()` therefore generates the day
 * list from the requested window and fills the gaps.
 */

import { prisma } from "@/lib/prisma";
import { withinBudget, type QueryBudget } from "@/lib/query-budget";
import { createLogger } from "@/lib/logger";

const log = createLogger("queries:analytics");
const DAY_MS = 24 * 60 * 60 * 1000;

/** Postgres returns COUNT/SUM as bigint, which arrives as a JS BigInt. */
function n(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

export interface RegionalRow {
  node: string;
  users: number;
  posts: number;
  views: number;
}

export interface DailyRow {
  /** `YYYY-MM-DD` in UTC, so the key is stable regardless of server timezone. */
  date: string;
  users: number;
  posts: number;
  views: number;
}

/**
 * Per-region totals in two queries regardless of how many regions exist.
 *
 * The old implementation was `nodes.map(async (node) => { post.count(...);
 * post.aggregate(...) })`: 2N round trips, and `$queryRaw`-free so nothing
 * bounded it. A `LIMIT` on the region list is applied separately by the caller
 * for display, but the aggregation itself no longer needs one — two grouped
 * scans are constant cost whether there are 4 regions or 400.
 *
 * `p."status" = 'PUBLISHED'` is a plain string comparison because `Post.status`
 * is a `String` in this schema, not a Postgres enum. Worth noting at the call
 * site: if that column ever becomes an enum, this line needs a cast rather than
 * silently comparing an enum to text.
 *
 * Users are counted separately from posts on purpose. An `INNER JOIN` would
 * have reported zero users for a region whose members have never published —
 * and "no one lives there" is a different fact from "no one has posted".
 */
export async function regionalBreakdown(): Promise<RegionalRow[]> {
  const [userRows, postRows] = await Promise.all([
    withinBudget("analytics.regionalUsers", "aggregate", () =>
      prisma.$queryRaw<{ node: string; users: bigint }[]>`
        SELECT u."node" AS node, COUNT(*)::bigint AS users
        FROM "User" u
        WHERE u."node" IS NOT NULL AND u."node" <> ''
        GROUP BY u."node"
      `
    ),
    withinBudget("analytics.regionalPosts", "aggregate", () =>
      prisma.$queryRaw<{ node: string; posts: bigint; views: bigint }[]>`
        SELECT u."node" AS node,
               COUNT(p."id")::bigint AS posts,
               COALESCE(SUM(p."viewCount"), 0)::bigint AS views
        FROM "User" u
        JOIN "Post" p ON p."authorId" = u."id"
        WHERE u."node" IS NOT NULL AND u."node" <> ''
          AND p."status" = 'PUBLISHED'
        GROUP BY u."node"
      `
    ),
  ]);

  const merged = new Map<string, RegionalRow>();
  for (const row of userRows) {
    merged.set(row.node, { node: row.node, users: n(row.users), posts: 0, views: 0 });
  }
  for (const row of postRows) {
    const existing = merged.get(row.node) ?? { node: row.node, users: 0, posts: 0, views: 0 };
    existing.posts = n(row.posts);
    existing.views = n(row.views);
    merged.set(row.node, existing);
  }

  return Array.from(merged.values()).sort((a, b) => b.users - a.users);
}

/**
 * Platform totals for the `getPlatformStats` shape.
 *
 * One grouped scan instead of a `findMany` of every published author id — the
 * old `analyzeUsers()` pulled `authorId` for **every published post on the
 * platform** into memory purely to `distinct`-count them in JS. That is a
 * table-sized payload to compute one integer.
 */
export async function platformTotals(): Promise<{
  totalUsers: number;
  totalPosts: number;
  totalComments: number;
  totalViews: number;
  pendingModeration: number;
  usersThisWeek: number;
  postsThisWeek: number;
  activeAuthors: number;
}> {
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);

  /*
   * Budgets here are `aggregate`, not `point`.
   *
   * Every one of these is a whole-table aggregate — `COUNT(*)` over User, Post or
   * Comment, or a `SUM` over every published post's `viewCount`. Postgres answers
   * each with a sequential scan, and the `point` budget (1.5s) is documented for a
   * single indexed row. On a cold pooled connection the platform's own `User`
   * count exceeded it in practice, and because `withinBudget` *rejects*, one slow
   * count took the whole `platformTotals()` call with it — which surfaced as the
   * admin console reporting the audience as "unavailable" and the platform-senses
   * engine as degraded, when nothing was actually wrong with the query.
   *
   * `aggregate` is the right ceiling by the module's own rule: the grouped
   * `regionalUsers`/`regionalPosts` queries scan these exact tables under an
   * `aggregate` budget and complete. A plain count of the same table cannot
   * honestly be given a tighter one than the group-by it is cheaper than.
   */
  const [totalUsers, totalPosts, totalComments, viewAgg, pendingModeration, usersThisWeek, postsThisWeek, activeRows] =
    await Promise.all([
      withinBudget("analytics.totalUsers", "aggregate", () => prisma.user.count()),
      withinBudget("analytics.totalPosts", "aggregate", () => prisma.post.count({ where: { status: "PUBLISHED" } })),
      withinBudget("analytics.totalComments", "aggregate", () => prisma.comment.count()),
      withinBudget("analytics.totalViews", "aggregate", () =>
        prisma.post.aggregate({ _sum: { viewCount: true }, where: { status: "PUBLISHED" } })
      ),
      withinBudget("analytics.pendingModeration", "aggregate", () =>
        prisma.post.count({ where: { moderationStatus: "PENDING" } })
      ),
      withinBudget("analytics.usersThisWeek", "aggregate", () => prisma.user.count({ where: { createdAt: { gte: weekAgo } } })),
      withinBudget("analytics.postsThisWeek", "aggregate", () => prisma.post.count({ where: { createdAt: { gte: weekAgo } } })),
      withinBudget("analytics.activeAuthors", "aggregate", () =>
        prisma.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(DISTINCT "authorId")::bigint AS n
          FROM "Post"
          WHERE "status" = 'PUBLISHED'
        `
      ),
    ]);

  return {
    totalUsers,
    totalPosts,
    totalComments,
    totalViews: viewAgg._sum.viewCount ?? 0,
    pendingModeration,
    usersThisWeek,
    postsThisWeek,
    activeAuthors: n(activeRows[0]?.n),
  };
}

/**
 * Daily activity across the three tables that drive every growth chart.
 *
 * Three grouped queries replace 3N, and the window is explicit: the caller
 * cannot ask for "all time" by omitting an argument, because an unbounded
 * `date_trunc` group over `PageView` is a full-table sort and the one query
 * shape on this platform most likely to be killed by a statement timeout.
 *
 * The day list is generated from `days`, not from the rows, so a day with no
 * traffic reads as `0` rather than disappearing. `since` is floored to UTC
 * midnight and `until` is exclusive, which keeps the bucket boundaries aligned
 * with `date_trunc('day', ...)` — passing a mid-day `until` would drop that
 * day's rows while still printing a bucket for it.
 */
export async function dailySeries(days = 30, budget: QueryBudget = "sweep"): Promise<DailyRow[]> {
  const span = Math.min(Math.max(Math.floor(days), 1), 180);
  const until = new Date();
  const since = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate()) - (span - 1) * DAY_MS);

  const [userRows, postRows, viewRows] = await Promise.all([
    withinBudget("analytics.dailyUsers", budget, () =>
      prisma.$queryRaw<{ day: Date; n: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS n
        FROM "User"
        WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
        GROUP BY day
      `
    ),
    withinBudget("analytics.dailyPosts", budget, () =>
      prisma.$queryRaw<{ day: Date; n: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS n
        FROM "Post"
        WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
        GROUP BY day
      `
    ),
    withinBudget("analytics.dailyViews", budget, () =>
      prisma.$queryRaw<{ day: Date; n: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS n
        FROM "PageView"
        WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
        GROUP BY day
      `
    ),
  ]);

  const key = (d: Date) => d.toISOString().slice(0, 10);
  const toMap = (rows: { day: Date; n: bigint }[]) => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(key(row.day), n(row.n));
    return map;
  };

  const users = toMap(userRows);
  const posts = toMap(postRows);
  const views = toMap(viewRows);

  const series: DailyRow[] = [];
  for (let i = 0; i < span; i++) {
    const date = new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    series.push({ date, users: users.get(date) ?? 0, posts: posts.get(date) ?? 0, views: views.get(date) ?? 0 });
  }

  log.debug("daily series", { days: span, rows: series.length });
  return series;
}

/**
 * The four-week trend summary `getGrowthReport` presents, derived from the same
 * series rather than a second set of queries.
 *
 * `weekOverWeekGrowth` compares the average of the final *complete* week
 * against the previous one. The last bucket is partial by construction — it is
 * the current day — so comparing raw totals would make every report look like a
 * collapse depending on what time the dashboard was opened, which is the kind
 * of bug that gets a metric distrusted rather than fixed.
 */
export function weeklyTrend(series: DailyRow[]): {
  weeklyAverages: { avgUsers: number; avgPosts: number; avgViews: number }[];
  weekOverWeekGrowth: number;
} {
  const chunks: DailyRow[][] = [];
  for (let i = 0; i < series.length; i += 7) chunks.push(series.slice(i, i + 7));

  const weeklyAverages = chunks.map((week) => ({
    avgUsers: week.reduce((s, d) => s + d.users, 0) / Math.max(week.length, 1),
    avgPosts: week.reduce((s, d) => s + d.posts, 0) / Math.max(week.length, 1),
    avgViews: week.reduce((s, d) => s + d.views, 0) / Math.max(week.length, 1),
  }));

  // Compare the last two *complete* weeks. With a 30-day window that is buckets
  // 2 and 3 (days 15–21 and 22–28), leaving days 29–30 out of the comparison
  // exactly because they are mid-week.
  const complete = weeklyAverages.slice(0, -1);
  const last = complete[complete.length - 1]?.avgUsers ?? 0;
  const prev = complete[complete.length - 2]?.avgUsers ?? 0;
  const weekOverWeekGrowth = prev > 0 ? ((last - prev) / prev) * 100 : 0;

  return { weeklyAverages, weekOverWeekGrowth };
}
