import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Get posts published in the last 30 days with engagement data
  const recentPosts = await prisma.post.findMany({
    where: {
      status: "PUBLISHED",
      publishedAt: { gte: thirtyDaysAgo },
    },
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      title: true,
      slug: true,
      publishedAt: true,
      viewCount: true,
      category: { select: { name: true } },
      author: { select: { name: true, username: true } },
      _count: { select: { comments: true, likes: true } },
    },
  });

  // Daily views over last 30 days
  const dailyData = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dayStr = day.toISOString().slice(0, 10);
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const dayPosts = recentPosts.filter((p) => {
      const pub = p.publishedAt;
      return pub && pub >= dayStart && pub < dayEnd;
    });

    dailyData.push({
      date: dayStr,
      posts: dayPosts.length,
      views: dayPosts.reduce((sum, p) => sum + p.viewCount, 0),
      comments: dayPosts.reduce((sum, p) => sum + p._count.comments, 0),
      likes: dayPosts.reduce((sum, p) => sum + p._count.likes, 0),
    });
  }

  // Category breakdown
  const categoryMap = new Map<string, { posts: number; views: number; comments: number }>();
  for (const post of recentPosts) {
    const cat = post.category?.name ?? "Uncategorized";
    const cur = categoryMap.get(cat) ?? { posts: 0, views: 0, comments: 0 };
    cur.posts += 1;
    cur.views += post.viewCount;
    cur.comments += post._count.comments;
    categoryMap.set(cat, cur);
  }
  const categories = Array.from(categoryMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.views - a.views);

  // Top performing articles
  const topPosts = recentPosts
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, 10)
    .map((p) => ({
      title: p.title,
      slug: p.slug,
      views: p.viewCount,
      comments: p._count.comments,
      likes: p._count.likes,
      author: p.author?.name ?? p.author?.username ?? "Unknown",
      category: p.category?.name ?? "Uncategorized",
      publishedAt: p.publishedAt?.toISOString(),
    }));

  // Author performance
  const authorMap = new Map<string, { posts: number; views: number; comments: number }>();
  for (const post of recentPosts) {
    const author = post.author?.name ?? post.author?.username ?? "Unknown";
    const cur = authorMap.get(author) ?? { posts: 0, views: 0, comments: 0 };
    cur.posts += 1;
    cur.views += post.viewCount;
    cur.comments += post._count.comments;
    authorMap.set(author, cur);
  }
  const authors = Array.from(authorMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.views - a.views);

  // Summary stats
  const totalViews = recentPosts.reduce((sum, p) => sum + p.viewCount, 0);
  const totalComments = recentPosts.reduce((sum, p) => sum + p._count.comments, 0);
  const totalLikes = recentPosts.reduce((sum, p) => sum + p._count.likes, 0);

  const lastWeekPosts = recentPosts.filter((p) => p.publishedAt && p.publishedAt >= sevenDaysAgo);
  const lastWeekViews = lastWeekPosts.reduce((sum, p) => sum + p.viewCount, 0);

  return NextResponse.json({
    summary: {
      totalPosts: recentPosts.length,
      totalViews,
      totalComments,
      totalLikes,
      avgViewsPerPost: recentPosts.length > 0 ? Math.round(totalViews / recentPosts.length) : 0,
      lastWeekPosts: lastWeekPosts.length,
      lastWeekViews,
      viewsTrend: totalViews > 0 ? Math.round((lastWeekViews / totalViews) * 100) : 0,
    },
    dailyData,
    categories,
    topPosts,
    authors,
  });
}
