import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cacheGet, cacheSet } from "@/lib/redis";

export const dynamic = "force-dynamic";

/**
 * GET /api/profile/[username]?tab=posts|saved&page=1&sort=latest|popular|liked&q=search
 * Also: ?tab=followers&page=1, ?tab=following&page=1, ?tab=bookmarks&page=1
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const { searchParams } = new URL(request.url);
  const tab = searchParams.get("tab") ?? "posts";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const sort = searchParams.get("sort") ?? "latest";
  const q = searchParams.get("q") ?? "";
  const PAGE_SIZE = 12;

  // Find user
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const skip = (page - 1) * PAGE_SIZE;

  // Build order by
  const orderBy =
    sort === "popular"
      ? { viewCount: "desc" as const }
      : sort === "liked"
        ? { _count: { likes: "desc" as const } }
        : { createdAt: "desc" as const };

  // Build search where
  const searchWhere = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { excerpt: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  switch (tab) {
    case "posts": {
      const where = {
        authorId: user.id,
        status: "PUBLISHED" as const,
        ...searchWhere,
      };

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where,
          orderBy,
          skip,
          take: PAGE_SIZE,
          select: {
            id: true,
            slug: true,
            title: true,
            excerpt: true,
            content: true,
            coverImage: true,
            featured: true,
            viewCount: true,
            createdAt: true,
            category: { select: { name: true, slug: true } },
            tags: { select: { id: true, name: true, slug: true } },
            _count: { select: { likes: true, comments: true } },
          },
        }),
        prisma.post.count({ where }),
      ]);

      return NextResponse.json({
        items: posts.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          likeCount: p._count.likes,
          commentCount: p._count.comments,
        })),
        total,
        page,
        pageSize: PAGE_SIZE,
        totalPages: Math.ceil(total / PAGE_SIZE),
      });
    }

    case "saved": {
      // Only returns bookmarks for the authenticated user's own profile
      const bookmarks = await prisma.bookmark.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: PAGE_SIZE,
        include: {
          post: {
            select: {
              id: true,
              slug: true,
              title: true,
              excerpt: true,
              content: true,
              coverImage: true,
              featured: true,
              viewCount: true,
              createdAt: true,
              category: { select: { name: true, slug: true } },
              tags: { select: { id: true, name: true, slug: true } },
              _count: { select: { likes: true, comments: true } },
              author: { select: { name: true, username: true } },
            },
          },
        },
      });

      const totalBookmarks = await prisma.bookmark.count({
        where: { userId: user.id },
      });

      return NextResponse.json({
        items: bookmarks.map((b) => ({
          ...b.post,
          createdAt: b.post.createdAt.toISOString(),
          likeCount: b.post._count.likes,
          commentCount: b.post._count.comments,
          authorName: b.post.author.name ?? `@${b.post.author.username}`,
        })),
        total: totalBookmarks,
        page,
        pageSize: PAGE_SIZE,
        totalPages: Math.ceil(totalBookmarks / PAGE_SIZE),
      });
    }

    case "followers": {
      const [follows, total] = await Promise.all([
        prisma.follow.findMany({
          where: { followingId: user.id },
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: {
            follower: {
              select: {
                id: true,
                name: true,
                username: true,
                avatar: true,
                bio: true,
                isVerified: true,
                node: true,
                _count: { select: { posts: true, followingLinks: true } },
              },
            },
          },
        }),
        prisma.follow.count({ where: { followingId: user.id } }),
      ]);

      return NextResponse.json({
        items: follows.map((f) => ({
          ...f.follower,
          followedAt: f.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize: PAGE_SIZE,
        totalPages: Math.ceil(total / PAGE_SIZE),
      });
    }

    case "following": {
      const [follows, total] = await Promise.all([
        prisma.follow.findMany({
          where: { followerId: user.id },
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: {
            following: {
              select: {
                id: true,
                name: true,
                username: true,
                avatar: true,
                bio: true,
                isVerified: true,
                node: true,
                _count: { select: { posts: true, followersLinks: true } },
              },
            },
          },
        }),
        prisma.follow.count({ where: { followerId: user.id } }),
      ]);

      return NextResponse.json({
        items: follows.map((f) => ({
          ...f.following,
          followedAt: f.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize: PAGE_SIZE,
        totalPages: Math.ceil(total / PAGE_SIZE),
      });
    }

    default:
      return NextResponse.json({ error: "Invalid tab" }, { status: 400 });
  }
}
