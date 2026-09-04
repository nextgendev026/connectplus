import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { articleId, categoryId } = body;

    if (!articleId || typeof articleId !== "string") {
      return NextResponse.json(
        { error: "articleId is required" },
        { status: 400 }
      );
    }

    const article = await prisma.rssArticle.findUnique({
      where: { id: articleId },
      include: { feed: true },
    });

    if (!article) {
      return NextResponse.json(
        { error: "Article not found" },
        { status: 404 }
      );
    }

    if (article.postId) {
      return NextResponse.json(
        { error: "Article has already been imported" },
        { status: 409 }
      );
    }

    let adminUser = await prisma.user.findFirst({
      where: { role: "ADMIN" },
      select: { id: true },
    });

    if (!adminUser) {
      adminUser = await prisma.user.findFirst({
        where: { role: "SUPER_ADMIN" },
        select: { id: true },
      });
    }

    if (!adminUser) {
      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.hash("system-admin-" + Date.now(), 10);
      adminUser = await prisma.user.create({
        data: {
          email: "system@connectplus.local",
          username: "system",
          name: "System",
          password: hashedPassword,
          role: "ADMIN",
          isVerified: true,
        },
        select: { id: true },
      });
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

    const post = await prisma.post.create({
      data: {
        title: article.title,
        slug,
        content: postContent,
        excerpt,
        coverImage: article.imageUrl || null,
        authorId: adminUser.id,
        categoryId: categoryId || null,
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

    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    console.error("Error importing RSS article:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
