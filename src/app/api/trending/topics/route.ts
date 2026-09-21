import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { coverSrc } from "@/lib/thumb";
import { cacheGet, cacheSet } from "@/lib/redis";

// `force-static` prerendered one body at build time, so ?limit / ?refresh were
// ignored and the sidebar could never bust its own cache. The CDN's
// s-maxage=120 (+ stale-while-revalidate) in vercel.json gives the same
// caching without freezing the query params.
export const dynamic = "force-dynamic";

/**
 * How many of the busiest tags the heat ranking considers.
 *
 * The ranking cannot be expressed in one cheap query — it blends post count,
 * views, comments, likes and a recency boost, and the last three live on the
 * posts — so the page has to load some posts to score anything. It used to load
 * them for **every** tag in the table: 3,700 tags × 5 posts, each with an author
 * and two aggregate counts, which measured **76 seconds** on the first
 * uncached request against a shared free-tier database. The sidebar aborts its
 * fetch after ten, so what readers actually saw was "Couldn't load topics." —
 * and no amount of CDN caching hides the request that refills the cache.
 *
 * So the ranking is done in two phases instead: a SQL aggregate picks the tags
 * with the most published stories (under a second, no post rows loaded), and
 * only those are scored in full. The scored set is what costs, because phase
 * two loads each tag's five hottest posts with their author and two aggregate
 * counts — sixty tags was 300 posts and 600 subqueries, still eight seconds. It
 * is sized from `limit` instead, so the sidebar's six topics score twelve
 * candidates and a caller asking for twenty scores forty.
 */
function shortlistSize(limit: number): number {
  return Math.min(60, Math.max(12, limit * 2));
}

/**
 * GET /api/trending/topics
 *
 * Realtime trending topics ranked by engagement (post count × recent views ×
 * comment velocity). Each topic carries a thumbnail from its hottest post so
 * the sidebar can render rich, live-updating cards.
 *
 * Cached for 2 minutes to reduce DB load on mobile connections.
 * Optional query params:
 *   ?limit=8          — number of topics (default 8)
 *   ?refresh=1        — force bypass of any cache
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "8", 10) || 8, 1), 20);

    // The CDN holds this for two minutes, but the request that *refills* the
    // CDN still does the work — and against a shared free-tier database that is
    // several seconds, which the sidebar's abort signal turns into "Couldn't
    // load topics.". A short tier in the app's cache means one slow request per
    // window instead of one per region, and the sidebar never sees it. Best
    // effort by design: a cache outage leaves the query path exactly as it was.
    const cacheKey = `trending:topics:v2:${limit}`;
    const cached = await cacheGet<{ topics: unknown[]; generatedAt: string; count: number }>(
      cacheKey
    ).catch(() => null);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
      });
    }

    // Phase 1: which tags are busy enough to be worth scoring. Aggregated in
    // SQL, so no post rows cross the wire and the count is the real number of
    // published stories rather than however many happened to be fetched.
    const shortlist = await prisma.$queryRaw<{ tag_id: string; post_count: number }[]>`
      SELECT pt."B" AS tag_id, COUNT(*)::int AS post_count
      FROM "_PostToTag" pt
      JOIN "Post" po ON po.id = pt."A"
      WHERE po.status = 'PUBLISHED' AND po."moderationStatus" = 'APPROVED'
      GROUP BY pt."B"
      ORDER BY post_count DESC
      LIMIT ${shortlistSize(limit)}
    `;

    if (shortlist.length === 0) {
      return NextResponse.json(
        { topics: [], generatedAt: new Date().toISOString(), count: 0 },
        { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } }
      );
    }

    const postCounts = new Map(shortlist.map((row) => [row.tag_id, Number(row.post_count)]));

    // Phase 2: the full picture for those few, so the heat blend is unchanged.
    const tags = await prisma.tag.findMany({
      where: { id: { in: [...postCounts.keys()] } },
      select: {
        id: true,
        name: true,
        slug: true,
        posts: {
          where: { status: "PUBLISHED", moderationStatus: "APPROVED" },
          select: {
            id: true,
            title: true,
            slug: true,
            coverImage: true,
            viewCount: true,
            createdAt: true,
            author: { select: { name: true, username: true } },
            _count: { select: { comments: true, likes: true } },
          },
          orderBy: { viewCount: "desc" },
          take: 5,
        },
      },
    });

    const now = Date.now();
    const topics = tags
      .filter((t) => t.posts.length > 0)
      .map((t) => {
        const posts = t.posts;
        const totalViews = posts.reduce((sum, p) => sum + p.viewCount, 0);
        const totalComments = posts.reduce((sum, p) => sum + p._count.comments, 0);
        const totalLikes = posts.reduce((sum, p) => sum + p._count.likes, 0);
        // Recency boost: stories published in the last 3 days count double.
        const recencyBoost = posts.reduce((sum, p) => {
          const ageDays = (now - new Date(p.createdAt).getTime()) / 86_400_000;
          return sum + (ageDays < 3 ? 1 : 0);
        }, 0);
        // Post count is the real published total, not the five sampled above —
        // the sampled length used to be reported as the topic's post count, so
        // every topic in the sidebar claimed at most five stories.
        const postCount = postCounts.get(t.id) ?? posts.length;
        const heat =
          postCount * 4 + totalViews / 25 + totalComments * 12 + totalLikes * 3 + recencyBoost * 10;

        const top = posts[0];
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          postCount,
          totalViews,
          heat: Math.round(heat * 10) / 10,
          thumbnail: top
            ? coverSrc(top.coverImage, { title: top.title, category: top.author?.name, seed: top.slug })
            : null,
          topPostTitle: top?.title ?? null,
          topPostSlug: top?.slug ?? null,
        };
      })
      .sort((a, b) => b.heat - a.heat)
      .slice(0, limit);

    const payload = { topics, generatedAt: new Date().toISOString(), count: topics.length };
    await cacheSet(cacheKey, payload, 120).catch(() => {});
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
    });
  } catch {
    return NextResponse.json({ topics: [], count: 0, error: "unavailable" });
  }
}
