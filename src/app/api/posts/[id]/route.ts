import { NextRequest, NextResponse } from "next/server";
import { postCoverSrc } from "@/lib/thumb";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { moderateContent } from "@/lib/moderation";
import { embedPost, findDuplicate } from "@/lib/neural-vector";
import { autoTagPost } from "@/lib/auto-tag";
import { redisIncr } from "@/lib/redis";

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
      // The stored cover can be a 2–4 MB base64 data URI. Handing that to the
      // editor put megabytes into React state and localStorage and then posted
      // them straight back on the next save; the thumb route serves it instead.
      omit: { coverImage: true },
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
        coverImage: postCoverSrc(post.id),
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
    const { id } = await params;

    const existingPost = await prisma.post.findUnique({
      where: { id },
      select: { authorId: true, content: true },
    });
    const existingPostContent = existingPost?.content ?? "";

    if (!existingPost) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // Authoritative role/verification (the JWT role can lag up to 60s).
    const author = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, emailVerified: true },
    });
    const userRole = author?.role ?? session.user.role ?? "USER";
    const emailVerified = author?.emailVerified ?? null;

    if (existingPost.authorId !== userId && userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "You do not have permission to edit this post" }, { status: 403 });
    }

    const body = await request.json();
    const { title, content, excerpt, coverImage, categoryId, tags, status, featured, scheduledAt } = body;

    const updateData: {
      title?: string;
      content?: string;
      excerpt?: string | null;
      coverImage?: string | null;
      categoryId?: string | null;
      featured?: boolean;
      status?: string;
      moderationStatus?: string;
      publishedAt?: Date | null;
      scheduledAt?: Date | null;
      aiScore?: number | null;
      aiFlags?: string | null;
    } = {};

    if (title !== undefined) updateData.title = String(title).trim().slice(0, 300);
    if (content !== undefined) updateData.content = String(content).trim();
    if (excerpt !== undefined) updateData.excerpt = excerpt ? String(excerpt).trim().slice(0, 500) : null;
    // Never write a derived /api/thumb URL back over the stored cover — that
    // would erase the original image (the thumb route would resolve itself).
    const derivedCover =
      typeof coverImage === "string" && coverImage.startsWith("/api/thumb/");
    if (coverImage !== undefined && !derivedCover) updateData.coverImage = coverImage || null;
    if (categoryId !== undefined) updateData.categoryId = categoryId || null;
    if (featured !== undefined) updateData.featured = Boolean(featured);

    let parsedScheduledAt: Date | null = null;
    if (scheduledAt) {
      const parsed = new Date(scheduledAt);
      if (!isNaN(parsed.getTime())) {
        parsedScheduledAt =
          parsed.getTime() > Date.now() - 24 * 60 * 60 * 1000 ? parsed : null;
      }
    } else if (scheduledAt === null || scheduledAt === "") {
      updateData.scheduledAt = null;
    }

    // Phase 2: re-scan through moderation whenever content changes and the
    // author is (re)publishing. Keeps the AI gate consistent with POST /api/posts.
    const trusted =
      userRole === "CREATOR" || userRole === "ADMIN" || userRole === "SUPER_ADMIN";
    let finalModerationStatus: string | null = null;
    let aiFlags: string[] = [];
    if (parsedScheduledAt) {
      // Scheduling is publishing intent — requires a confirmed email.
      if (!emailVerified) {
        return NextResponse.json(
          {
            error: "Your email isn't verified yet.",
            code: "EMAIL_NOT_VERIFIED",
            message: "Confirm your email to schedule stories.",
          },
          { status: 403 }
        );
      }
      updateData.status = "DRAFT";
      updateData.publishedAt = null;
      updateData.moderationStatus = "PENDING";
      updateData.scheduledAt = parsedScheduledAt;
    } else if (status !== undefined) {
      updateData.status = String(status);
      if (status === "PUBLISHED") {
        // Publishing requires a confirmed email.
        if (!emailVerified) {
          return NextResponse.json(
            {
              error: "Your email isn't verified yet.",
              code: "EMAIL_NOT_VERIFIED",
              message: "Confirm your email to publish stories.",
            },
            { status: 403 }
          );
        }
        updateData.publishedAt = new Date();
        const bodyText = String(content ?? existingPostContent ?? "");
        const risk = moderateContent(String(title ?? ""), bodyText);
        aiFlags = [...risk.flags];
        const scan =
          risk.suggested === "REJECTED"
            ? "REJECTED"
            : risk.suggested === "FLAGGED"
              ? "FLAGGED"
              : "CLEAN";
        // Trusted writers publish straight through; others queue for review.
        let moderationStatus =
          scan === "REJECTED"
            ? "REJECTED"
            : scan === "FLAGGED"
              ? "FLAGGED"
              : trusted
                ? "APPROVED"
                : "PENDING";
        if (moderationStatus === "APPROVED") {
          const dup = await findDuplicate({
            id,
            title: String(title ?? ""),
            content: bodyText,
          }).catch(() => null);
          if (dup) {
            moderationStatus = "FLAGGED";
            aiFlags.push(`duplicate:${dup.score.toFixed(2)}`);
          }
        }
        updateData.moderationStatus = moderationStatus;
        updateData.aiScore = risk.score;
        updateData.aiFlags = aiFlags.join(",") || null;
        finalModerationStatus = moderationStatus;
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

    const { title: _t, content: _c, excerpt: _e, coverImage: _ci, categoryId: _cat, featured: _f, status: _s, publishedAt: _pa, scheduledAt: _sa, moderationStatus: _ms, aiScore: _as, aiFlags: _af } = updateData;
    const dataWithoutTags = { title: _t, content: _c, excerpt: _e, coverImage: _ci, categoryId: _cat, featured: _f, status: _s, publishedAt: _pa, scheduledAt: _sa, moderationStatus: _ms, aiScore: _as, aiFlags: _af };

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

    // Re-index embeddings + auto-tags after content changes (fire-and-forget).
    if (post.status === "PUBLISHED" && post.moderationStatus === "APPROVED") {
      embedPost(post).catch(() => {});
      autoTagPost(post.id, `${post.title} ${post.excerpt ?? ""}`).catch(() => {});
    }

    // A (re)publish or moderation change alters the feed — invalidate the
    // cache namespace with one cheap INCR instead of a scan/delete.
    if (post.status === "PUBLISHED") {
      redisIncr("feed:version").catch(() => {});
    }

    return NextResponse.json({
      post,
      moderationStatus: finalModerationStatus ?? post.moderationStatus,
      aiFlags: finalModerationStatus ? aiFlags : undefined,
    });
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
    redisIncr("feed:version").catch(() => {});
    return NextResponse.json({ message: "Post deleted successfully" });
  } catch (error) {
    console.error("Error deleting post:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
