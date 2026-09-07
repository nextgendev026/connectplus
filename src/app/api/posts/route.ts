import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { hiveBrain } from "@/lib/hive-brain";
import { moderateContent } from "@/lib/moderation";
import { embedPost } from "@/lib/neural-vector";
import { rankFeed } from "@/lib/feed-ranker";
import type { FeedRankVariant } from "@/lib/experiments";
import { autoTagPost } from "@/lib/auto-tag";
import { findDuplicate } from "@/lib/neural-vector";

const POST_SELECT = {
  author: { select: { id: true, name: true, username: true, avatar: true } },
  category: { select: { id: true, name: true, slug: true } },
  tags: { select: { id: true, name: true, slug: true } },
  _count: { select: { comments: true, likes: true } },
} as const;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
    const category = searchParams.get("category");
    const tag = searchParams.get("tag");
    const search = searchParams.get("search");
    const featured = searchParams.get("featured");
    const mine = searchParams.get("mine") === "true";
    const personalized = searchParams.get("personalized") === "true";

    const skip = (page - 1) * limit;

    const baseWhere: {
      status?: string;
      moderationStatus?: string;
      category?: { slug: string };
      tags?: { some: { slug: string } };
      OR?: { title?: { contains: string; mode: "insensitive" }; content?: { contains: string; mode: "insensitive" }; excerpt?: { contains: string; mode: "insensitive" } }[];
      featured?: boolean;
    } = {
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
    };

    let authorId: string | null = null;
    if (mine || personalized) {
      const session = await auth();
      if (!session?.user) {
        if (mine) {
          return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }
      } else {
        authorId = session.user.id;
      }
    }

    const where = authorId
      ? { authorId, category: baseWhere.category, tags: baseWhere.tags, OR: baseWhere.OR, featured: baseWhere.featured }
      : { ...baseWhere };

    if (category) {
      where.category = { slug: category };
    }

    if (tag) {
      where.tags = { some: { slug: tag } };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
        { excerpt: { contains: search, mode: "insensitive" } },
      ];
    }

    if (featured === "true") {
      where.featured = true;
    }

    const noFilters = !category && !tag && !search && !featured && !mine;
    const canPersonalize = personalized && noFilters;

    // Phase 1: adaptive ranked feed — same deterministic pool per user so
    // "load more" pagination slices stay consistent.
    if (canPersonalize) {
      const pool = await prisma.post.findMany({
        where: baseWhere,
        orderBy: { createdAt: "desc" },
        take: 200,
        include: POST_SELECT,
      });
      const { posts: ranked, variant } = await rankFeed(pool, authorId);
      const total = ranked.length;
      const pagePosts = ranked.slice(skip, skip + limit);
      return NextResponse.json({
        posts: pagePosts,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          variant,
        },
      });
    }

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: POST_SELECT,
      }),
      prisma.post.count({ where }),
    ]);

    return NextResponse.json({
      posts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        variant: "control" as FeedRankVariant,
      },
    });
  } catch (error) {
    console.error("Error fetching posts:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();
    const { title, content, excerpt, coverImage, categoryId, tags, status, scheduledAt } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    let slug = slugify(title);
    const existingSlug = await prisma.post.findUnique({ where: { slug } });
    if (existingSlug) {
      slug = `${slug}-${Date.now()}`;
    }

    let scheduleDate: Date | null = null;
    if (scheduledAt) {
      const parsed = new Date(scheduledAt);
      if (!isNaN(parsed.getTime()) && parsed.getTime() > Date.now() + 60_000) {
        scheduleDate = parsed;
      }
    }

    const wantsPublish = status === "PUBLISHED" && !scheduleDate;
    const postStatus = wantsPublish ? "PUBLISHED" : "DRAFT";

    // Phase 2: run the self-contained moderation scanner.
    const risk = moderateContent(title.trim(), content);
    let moderationStatus =
      postStatus === "DRAFT"
        ? (risk.suggested === "REJECTED" ? "REJECTED" : risk.suggested === "FLAGGED" ? "FLAGGED" : "PENDING")
        : risk.suggested === "REJECTED"
          ? "REJECTED"
          : risk.suggested === "FLAGGED"
            ? "FLAGGED"
            : "APPROVED";

    // Phase 2: near-duplicate detection against existing published content.
    let duplicate: { postId: string; score: number } | null = null;
    if (wantsPublish && moderationStatus === "APPROVED") {
      duplicate = await findDuplicate({ title: title.trim(), content: content.trim() }).catch(() => null);
      if (duplicate) {
        moderationStatus = "FLAGGED";
        risk.flags.push(`duplicate:${duplicate.score.toFixed(2)}`);
      }
    }

    const tagConnections = tags && Array.isArray(tags)
      ? await Promise.all(
          tags.map(async (tagName: string) => {
            const tagSlug = slugify(tagName);
            const tag = await prisma.tag.upsert({
              where: { slug: tagSlug },
              update: {},
              create: { name: tagName.trim().slice(0, 50), slug: tagSlug },
            });
            return { id: tag.id };
          })
        )
      : [];

    const post = await prisma.post.create({
      data: {
        title: title.trim().slice(0, 300),
        slug,
        content: content.trim(),
        excerpt: excerpt?.trim().slice(0, 500) || null,
        coverImage: coverImage || null,
        authorId: userId,
        categoryId: categoryId || null,
        status: postStatus,
        moderationStatus,
        aiScore: risk.score,
        aiFlags: risk.flags.join(",") || null,
        publishedAt: postStatus === "PUBLISHED" ? new Date() : null,
        scheduledAt: scheduleDate,
        tags: { connect: tagConnections },
      },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true } },
        category: { select: { id: true, name: true, slug: true } },
        tags: { select: { id: true, name: true, slug: true } },
        _count: { select: { comments: true, likes: true } },
      },
    });

    // Index the semantic embedding + hive engagement (fire-and-forget).
    if (postStatus === "PUBLISHED" && moderationStatus === "APPROVED") {
      embedPost(post).catch(() => {});
      autoTagPost(post.id, `${post.title} ${post.excerpt ?? ""}`).catch(() => {});
    }
    await hiveBrain.ingestPost(post).catch(() => {});

    return NextResponse.json(
      { post, moderationStatus, aiFlags: risk.flags, duplicate },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating post:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
