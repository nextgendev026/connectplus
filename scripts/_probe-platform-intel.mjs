/**
 * Read-only probe for the platform-intelligence layer.
 *
 * A typecheck cannot catch a wrong column or a bad aggregate, and these queries
 * run behind the admin console — a typo would surface as a 500 in front of an
 * operator. This script runs every read the new layer makes and prints the
 * result, so the SQL is proven against the live schema rather than assumed.
 *
 * READ ONLY. Every statement is a SELECT or a groupBy. Nothing is written.
 *
 * Run: node scripts/_probe-platform-intel.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

const prisma = new PrismaClient();
const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const n = (v) => Number(v ?? 0);
let failures = 0;

async function step(label, fn) {
  try {
    const result = await fn();
    console.log(`✅ ${label}`, typeof result === "string" ? result : JSON.stringify(result, (k, v) => (typeof v === "bigint" ? Number(v) : v)));
  } catch (err) {
    failures += 1;
    console.log(`❌ ${label}\n   ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
}

console.log("── platform-intelligence probe (read only) ──");

await step("PageView totals", async () => {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*)::bigint AS views,
           COUNT(DISTINCT "visitorHash")::bigint AS visitors,
           COUNT(DISTINCT "sessionKey")::bigint AS sessions
    FROM "PageView"
    WHERE "createdAt" >= ${since}
  `;
  const r = rows[0] ?? {};
  return `views=${n(r.views)} visitors=${n(r.visitors)} sessions=${n(r.sessions)}`;
});

await step("session depth (bounce + duration)", async () => {
  const rows = await prisma.$queryRaw`
    WITH s AS (
      SELECT "sessionKey" AS k,
             COUNT(*)::bigint AS views,
             EXTRACT(EPOCH FROM (MAX("createdAt") - MIN("createdAt")))::float AS seconds
      FROM "PageView"
      WHERE "createdAt" >= ${since} AND "sessionKey" IS NOT NULL
      GROUP BY "sessionKey"
    )
    SELECT COUNT(*)::bigint AS sessions,
           COUNT(*) FILTER (WHERE views = 1)::bigint AS bounces,
           COALESCE(AVG(views), 0)::float AS pages_per_session,
           COALESCE(AVG(seconds), 0)::float AS avg_session_seconds,
           COALESCE(SUM(seconds), 0)::float AS total_seconds
    FROM s
  `;
  const r = rows[0] ?? {};
  return `sessions=${n(r.sessions)} bounces=${n(r.bounces)} pages/session=${n(r.pages_per_session).toFixed(2)} avg=${n(r.avg_session_seconds).toFixed(1)}s total=${n(r.total_seconds).toFixed(0)}s`;
});

await step("traffic by category", async () => {
  const rows = await prisma.$queryRaw`
    SELECT c."name" AS category,
           COUNT(v."id")::bigint AS views,
           COUNT(DISTINCT v."visitorHash")::bigint AS visitors
    FROM "PageView" v
    JOIN "Post" p ON p."id" = v."postId"
    LEFT JOIN "Category" c ON c."id" = p."categoryId"
    WHERE v."createdAt" >= ${since}
    GROUP BY c."name"
    ORDER BY views DESC
    LIMIT 10
  `;
  return `${rows.length} categories`;
});

await step("traffic sources (referrer)", async () => {
  const rows = await prisma.$queryRaw`
    SELECT "referrer" AS source, COUNT(*)::bigint AS views
    FROM "PageView"
    WHERE "createdAt" >= ${since} AND "referrer" IS NOT NULL AND "referrer" <> ''
    GROUP BY "referrer"
    ORDER BY views DESC
    LIMIT 10
  `;
  return `${rows.length} sources`;
});

await step("new vs returning visitors", async () => {
  const rows = await prisma.$queryRaw`
    WITH seen AS (
      SELECT "visitorHash", MIN("createdAt") AS first_at
      FROM "PageView"
      WHERE "visitorHash" IS NOT NULL
      GROUP BY "visitorHash"
    ),
    active AS (
      SELECT DISTINCT "visitorHash" FROM "PageView" WHERE "createdAt" >= ${since}
    )
    SELECT
      COUNT(*) FILTER (WHERE s.first_at >= ${since})::bigint AS new_visitors,
      COUNT(*) FILTER (WHERE s.first_at < ${since})::bigint AS returning_visitors
    FROM seen s
    WHERE s."visitorHash" IN (SELECT "visitorHash" FROM active)
  `;
  const r = rows[0] ?? {};
  return `new=${n(r.new_visitors)} returning=${n(r.returning_visitors)}`;
});

await step("creator roster + posts aggregate", async () => {
  const creators = await prisma.user.findMany({
    where: { role: { in: ["CREATOR", "EDITOR", "ADMIN"] } },
    take: 40,
    select: { id: true, followersCount: true },
  });
  const posts = await prisma.post.findMany({
    where: { authorId: { in: creators.map((c) => c.id) }, status: "PUBLISHED" },
    take: 4000,
    select: { authorId: true, viewCount: true, category: { select: { name: true } }, tags: { select: { name: true } }, _count: { select: { comments: true, likes: true } } },
  });
  return `creators=${creators.length} posts=${posts.length}`;
});

await step("follower growth groupBy", async () => {
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.follow.groupBy({
    by: ["followingId"],
    where: { createdAt: { gte: since30 } },
    _count: { id: true },
  });
  return `${rows.length} creators gained followers`;
});

await step("subscription groupBy", async () => {
  const rows = await prisma.userSubscription.groupBy({ by: ["planId", "status", "provider"], _count: { id: true } });
  return `${rows.length} plan/status/provider rows`;
});

await step("payment intent groupBy", async () => {
  const rows = await prisma.paymentIntent.groupBy({ by: ["provider", "status"], _sum: { amount: true }, _count: { id: true } });
  return `${rows.length} provider/status rows`;
});

await step("ad creatives", async () => {
  const rows = await prisma.ad.findMany({ select: { impressions: true, clicks: true, isActive: true } });
  return `${rows.length} creatives`;
});

await step("plan currency + displayName", async () => {
  const plan = await prisma.subscriptionPlan.findFirst({ select: { currency: true, displayName: true, name: true, tier: true, audience: true, priceMonthly: true } });
  return plan ? `${plan.displayName} (${plan.tier}/${plan.audience}) ${plan.priceMonthly} ${plan.currency}` : "no plans";
});

await step("regional RSS articles", async () => {
  const rows = await prisma.rssArticle.findMany({
    where: { publishedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    take: 120,
    select: { title: true, feed: { select: { name: true } } },
  });
  return `${rows.length} articles in 7d`;
});

await step("referenced comment lookup", async () => {
  const rows = await prisma.comment.findMany({ take: 3, select: { id: true, postId: true, author: { select: { username: true } }, _count: { select: { likes: true, replies: true } } } });
  return `${rows.length} comments readable`;
});

await prisma.$disconnect();
console.log(failures === 0 ? "\n✅ every read succeeded" : `\n❌ ${failures} read(s) failed`);
process.exit(failures === 0 ? 0 : 1);
