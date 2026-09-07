import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { hiveBrain } from "@/lib/hive-brain";

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
    if (mine) {
      const session = await auth();
      if (!session?.user) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
      authorId = session.user.id;
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

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          author: { select: { id: true, name: true, username: true, avatar: true } },
          category: { select: { id: true, name: true, slug: true } },
          tags: { select: { id: true, name: true, slug: true } },
          _count: { select: { comments: true, likes: true } },
        },
      }),
      prisma.post.count({ where }),
    ]);

    return NextResponse.json({
      posts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
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
    const { title, content, excerpt, coverImage, categoryId, tags, status } = body;

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

    const postStatus = status === "PUBLISHED" ? "PUBLISHED" : "DRAFT";

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
        moderationStatus: postStatus === "PUBLISHED" ? "APPROVED" : "PENDING",
        publishedAt: postStatus === "PUBLISHED" ? new Date() : null,
        tags: { connect: tagConnections },
      },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true } },
        category: { select: { id: true, name: true, slug: true } },
        tags: { select: { id: true, name: true, slug: true } },
        _count: { select: { comments: true, likes: true } },
      },
    });

    await hiveBrain.ingestPost(post).catch(() => {});

    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    console.error("Error creating post:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
