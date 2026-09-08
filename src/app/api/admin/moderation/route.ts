import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redisIncr } from "@/lib/redis";

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
    const status = searchParams.get("status") || "all";

    const validStatuses = ["PENDING", "APPROVED", "FLAGGED", "REJECTED"];
    if (status !== "all" && !validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const posts = await prisma.post.findMany({
      where: status === "all" ? {} : { moderationStatus: status },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true } },
        moderationLogs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ posts });
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
    const body = await request.json();
    const { postId, action, reason, aiScore, aiFlags } = body;

    if (!postId || !action) {
      return NextResponse.json({ error: "postId and action are required" }, { status: 400 });
    }

    const normalizedAction = String(action).toUpperCase();
    const validActions = ["APPROVE", "FLAG", "REJECT"];
    if (!validActions.includes(normalizedAction)) {
      return NextResponse.json({ error: "Invalid action. Must be: approve, flag, or reject" }, { status: 400 });
    }

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
    }

    return NextResponse.json({ post: updatedPost });
  } catch (error) {
    console.error("Error updating moderation:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
