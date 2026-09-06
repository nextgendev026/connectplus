import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify, stripHtml } from "@/lib/utils";
import { hiveBrain } from "@/lib/hive-brain";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const { articleId, categoryId } = body;

    if (!articleId || typeof articleId !== "string") {
      return NextResponse.json({ error: "articleId is required" }, { status: 400 });
    }

    const article = await prisma.rssArticle.findUnique({
      where: { id: articleId },
      include: { feed: true },
    });

    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    if (article.postId) {
      return NextResponse.json({ error: "Article has already been imported" }, { status: 409 });
    }

    const adminUser = await prisma.user.findFirst({
      where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } },
      select: { id: true },
    });

    if (!adminUser) {
      return NextResponse.json({ error: "No admin user found to attribute imported posts" }, { status: 500 });
    }

    const postContent = article.content || article.summary || "";
    const excerpt = article.summary
      ? article.summary.slice(0, 200)
      : stripHtml(postContent).slice(0, 200);

    let slug = slugify(article.title);
    const existingSlug = await prisma.post.findUnique({ where: { slug } });
    if (existingSlug) {
      slug = `${slug}-${Date.now()}`;
    }

    let resolvedCategoryId: string | null = null;
    if (categoryId && typeof categoryId === "string") {
      const target = categoryId.trim();
      const byId = await prisma.category.findUnique({ where: { id: target }, select: { id: true } });
      if (byId) {
        resolvedCategoryId = byId.id;
      } else {
        const bySlug = slugify(target);
        const existing = await prisma.category.findFirst({
          where: { OR: [{ slug: bySlug }, { name: { equals: target, mode: "insensitive" } }] },
          select: { id: true },
        });
        if (existing) {
          resolvedCategoryId = existing.id;
        } else {
          const created = await prisma.category.create({
            data: { name: target.slice(0, 60), slug: bySlug },
            select: { id: true },
          });
          resolvedCategoryId = created.id;
        }
      }
    }

    const post = await prisma.post.create({
      data: {
        title: article.title,
        slug,
        content: postContent,
        excerpt,
        coverImage: article.imageUrl || null,
        authorId: adminUser.id,
        categoryId: resolvedCategoryId,
        status: "PUBLISHED",
        moderationStatus: "APPROVED",
        source: article.feed.name,
        sourceUrl: article.url,
        publishedAt: article.publishedAt || new Date(),
      },
    });

    await prisma.rssArticle.update({
      where: { id: articleId },
      data: { postId: post.id },
    });

    await hiveBrain.ingestPost(post).catch(() => {});

    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    console.error("Error importing RSS article:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
