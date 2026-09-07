import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const post = await prisma.post.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true, bio: true } },
        category: { select: { id: true, name: true, slug: true } },
        tags: { select: { id: true, name: true, slug: true } },
        comments: {
          where: { parentId: null },
          include: {
            author: { select: { id: true, name: true, username: true, avatar: true } },
            replies: {
              include: { author: { select: { id: true, name: true, username: true, avatar: true } } },
              orderBy: { createdAt: "asc" },
            },
            _count: { select: { likes: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        _count: { select: { comments: true, likes: true } },
      },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.status === "PUBLISHED") {
      await prisma.post.update({
        where: { id: post.id },
        data: { viewCount: { increment: 1 } },
      });
    }

    return NextResponse.json({
      post: {
        ...post,
        viewCount: post.status === "PUBLISHED" ? post.viewCount + 1 : post.viewCount,
      },
    });
  } catch (error) {
    console.error("Error fetching post:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const userId = session.user.id;
    const userRole = session.user.role;
    const { id } = await params;

    const existingPost = await prisma.post.findUnique({
      where: { id },
      select: { authorId: true },
    });

    if (!existingPost) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (existingPost.authorId !== userId && userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "You do not have permission to edit this post" }, { status: 403 });
    }

    const body = await request.json();
    const { title, content, excerpt, coverImage, categoryId, tags, status, featured } = body;

    const updateData: {
      title?: string;
      content?: string;
      excerpt?: string | null;
      coverImage?: string | null;
      categoryId?: string | null;
      featured?: boolean;
      status?: string;
      moderationStatus?: string;
      publishedAt?: Date;
    } = {};

    if (title !== undefined) updateData.title = String(title).trim().slice(0, 300);
    if (content !== undefined) updateData.content = String(content).trim();
    if (excerpt !== undefined) updateData.excerpt = excerpt ? String(excerpt).trim().slice(0, 500) : null;
    if (coverImage !== undefined) updateData.coverImage = coverImage || null;
    if (categoryId !== undefined) updateData.categoryId = categoryId || null;
    if (featured !== undefined) updateData.featured = Boolean(featured);

    if (status !== undefined) {
      updateData.status = String(status);
      if (status === "PUBLISHED") {
        updateData.publishedAt = new Date();
        updateData.moderationStatus = "APPROVED";
      }
    }

    if (tags !== undefined && Array.isArray(tags)) {
      const tagConnections = await Promise.all(
        tags.map(async (tagName: string) => {
          const tagSlug = slugify(String(tagName));
          const tag = await prisma.tag.upsert({
            where: { slug: tagSlug },
            update: {},
            create: { name: String(tagName).trim().slice(0, 50), slug: tagSlug },
          });
          return { id: tag.id };
        })
      );

      await prisma.post.update({
        where: { id },
        data: { tags: { set: tagConnections } },
      });
    }

    const { title: _t, content: _c, excerpt: _e, coverImage: _ci, categoryId: _cat, featured: _f, status: _s, publishedAt: _pa } = updateData;
    const dataWithoutTags = { title: _t, content: _c, excerpt: _e, coverImage: _ci, categoryId: _cat, featured: _f, status: _s, publishedAt: _pa };

    const post = await prisma.post.update({
      where: { id },
      data: dataWithoutTags,
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true } },
        category: { select: { id: true, name: true, slug: true } },
        tags: { select: { id: true, name: true, slug: true } },
        _count: { select: { comments: true, likes: true } },
      },
    });

    return NextResponse.json({ post });
  } catch (error) {
    console.error("Error updating post:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const userId = session.user.id;
    const userRole = session.user.role;
    const { id } = await params;

    const existingPost = await prisma.post.findUnique({
      where: { id },
      select: { authorId: true },
    });

    if (!existingPost) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (existingPost.authorId !== userId && userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "You do not have permission to delete this post" }, { status: 403 });
    }

    await prisma.post.delete({ where: { id } });
    return NextResponse.json({ message: "Post deleted successfully" });
  } catch (error) {
    console.error("Error deleting post:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
