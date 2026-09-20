import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redisIncr } from "@/lib/redis";
import { validateBody } from "@/lib/api-validation";
import { AdminModerationSchema } from "@/lib/schemas/validators";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const userRole = session.user.role;
    if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    // The queue opens on the work, not on the archive. `review` is PENDING +
    // FLAGGED — the items a human actually has to decide on. Before this, the
    // default was `all`, which returned every post in the table (an approved
    // story from months ago is not a moderation task) and buried the handful
    // that were.
    const status = searchParams.get("status") || "review";

    const validStatuses = ["review", "all", "PENDING", "APPROVED", "FLAGGED", "REJECTED"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Bounded like every other read here: the table grows without limit, and an
    // unpaginated query with a `moderationLogs` join per row is a payload that
    // gets slower every week. The console only ever renders a scroll box.
    const takeParam = Number(searchParams.get("take"));
    const take = Number.isFinite(takeParam) ? Math.min(Math.max(Math.trunc(takeParam), 1), 500) : 200;

    const where =
      status === "all"
        ? {}
        : status === "review"
          ? { moderationStatus: { in: ["PENDING", "FLAGGED"] } }
          : { moderationStatus: status.toUpperCase() };

    const [posts, grouped, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          author: { select: { id: true, name: true, username: true, avatar: true } },
          moderationLogs: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        // Actionable first. The stored values sort descending as
        // PENDING > FLAGGED, which is the order a reviewer wants them in.
        orderBy: [{ moderationStatus: "desc" }, { createdAt: "desc" }],
        take,
      }),
      // Counts come from the whole table, so a tab badge stays truthful even
      // though the list itself is capped to one page.
      prisma.post.groupBy({ by: ["moderationStatus"], _count: { _all: true } }),
      prisma.post.count({ where }),
    ]);

    const counts = { review: 0, pending: 0, flagged: 0, rejected: 0, approved: 0, all: 0 };
    for (const g of grouped) {
      const n = g._count._all;
      counts.all += n;
      if (g.moderationStatus === "PENDING") counts.pending += n;
      else if (g.moderationStatus === "FLAGGED") counts.flagged += n;
      else if (g.moderationStatus === "REJECTED") counts.rejected += n;
      else if (g.moderationStatus === "APPROVED") counts.approved += n;
    }
    counts.review = counts.pending + counts.flagged;

    return NextResponse.json({
      posts,
      counts,
      total,
      take,
      // The console renders this rather than silently implying it saw everything.
      truncated: total > posts.length,
    });
  } catch (error) {
    console.error("Error fetching moderation queue:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const userRole = session.user.role;
    if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const userId = session.user.id;
    const body = await validateBody(request, AdminModerationSchema);
    if (body instanceof NextResponse) return body;
    const { postId, action, reason, aiScore, aiFlags } = body;
    const normalizedAction = action.toUpperCase();

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const moderationStatusMap: Record<string, string> = {
      APPROVE: "APPROVED",
      FLAG: "FLAGGED",
      REJECT: "REJECTED",
    };

    const [updatedPost] = await prisma.$transaction([
      prisma.post.update({
        where: { id: postId },
        data: {
          moderationStatus: moderationStatusMap[normalizedAction],
          moderatedAt: new Date(),
          moderatedBy: userId,
        },
        include: { author: { select: { id: true, name: true, username: true, avatar: true } } },
      }),
      prisma.moderationLog.create({
        data: {
          postId,
          moderatorId: userId,
          action: normalizedAction,
          reason: reason?.slice(0, 500) || null,
          aiScore: typeof aiScore === "number" ? aiScore : null,
          aiFlags: aiFlags?.slice(0, 500) || null,
        },
      }),
    ]);

    if (normalizedAction === "APPROVE") {
      await prisma.post.update({
        where: { id: postId },
        data: { status: "PUBLISHED", publishedAt: post.publishedAt ?? new Date() },
      }).catch(() => {});
      // Approved posts enter the public feed — invalidate the read cache.
      redisIncr("feed:version").catch(() => {});
      await import("@/lib/notifications").then(({ createApprovalNotification }) =>
        createApprovalNotification({
          recipientId: post.authorId,
          actorId: userId,
          postId,
        })
      );

      // Marketing sees an approval the moment it happens, rather than on the
      // next fifteen-minute sweep. `after()` keeps the Graph call off the
      // reviewer's critical path — a slow Facebook response must never make an
      // approval feel broken, and a failed share is retried by the sweep.
      after(async () => {
        try {
          const { shareNewStory } = await import("@/lib/marketing");
          const category = post.categoryId
            ? await prisma.category.findUnique({ where: { id: post.categoryId }, select: { name: true } })
            : null;
          await shareNewStory({
            id: postId,
            title: post.title,
            slug: post.slug,
            excerpt: post.excerpt,
            categoryName: category?.name ?? null,
          });
        } catch {
          // the sweep is the retry path
        }
      });
    }

    return NextResponse.json({ post: updatedPost });
  } catch (error) {
    console.error("Error updating moderation:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
