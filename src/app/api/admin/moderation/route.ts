import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
    const status = searchParams.get("status") || "PENDING";

    const validStatuses = ["PENDING", "APPROVED", "FLAGGED", "REJECTED"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const posts = await prisma.post.findMany({
      where: { moderationStatus: status },
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

    const validActions = ["APPROVE", "FLAG", "REJECT"];
    if (!validActions.includes(action)) {
      return NextResponse.json({ error: "Invalid action. Must be: APPROVE, FLAG, or REJECT" }, { status: 400 });
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
          moderationStatus: moderationStatusMap[action],
          moderatedAt: new Date(),
          moderatedBy: userId,
        },
        include: { author: { select: { id: true, name: true, username: true, avatar: true } } },
      }),
      prisma.moderationLog.create({
        data: {
          postId,
          moderatorId: userId,
          action,
          reason: reason?.slice(0, 500) || null,
          aiScore: typeof aiScore === "number" ? aiScore : null,
          aiFlags: aiFlags?.slice(0, 500) || null,
        },
      }),
    ]);

    return NextResponse.json({ post: updatedPost });
  } catch (error) {
    console.error("Error updating moderation:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
