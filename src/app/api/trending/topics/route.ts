import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { coverSrc } from "@/lib/thumb";

// `force-static` prerendered one body at build time, so ?limit / ?refresh were
// ignored and the sidebar could never bust its own cache. The CDN's
// s-maxage=120 (+ stale-while-revalidate) in vercel.json gives the same
// caching without freezing the query params.
export const dynamic = "force-dynamic";

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

    // All tags with their published posts — rank by engagement below.
    const tags = await prisma.tag.findMany({
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
        const heat = posts.length * 4 + totalViews / 25 + totalComments * 12 + totalLikes * 3 + recencyBoost * 10;

        const top = posts[0];
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          postCount: posts.length,
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

    return NextResponse.json(
      { topics, generatedAt: new Date().toISOString(), count: topics.length },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } }
    );
  } catch {
    return NextResponse.json({ topics: [], count: 0, error: "unavailable" });
  }
}