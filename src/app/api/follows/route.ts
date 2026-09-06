import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const username = request.nextUrl.searchParams.get("username");
    if (!username) {
      return NextResponse.json({ error: "Missing username" }, { status: 400 });
    }
    const target = await prisma.user.findUnique({
      where: { username },
      select: { id: true, followersCount: true, followingCount: true },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const session = await auth();
    let following = false;
    if (session?.user?.id) {
      const link = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: session.user.id,
            followingId: target.id,
          },
        },
        select: { id: true },
      });
      following = !!link;
    }
    return NextResponse.json({
      following,
      followersCount: target.followersCount,
      followingCount: target.followingCount,
    });
  } catch (error) {
    console.error("Error fetching follow status:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const body = await request.json();
    const targetId = body?.targetId as string | undefined;
    if (!targetId) {
      return NextResponse.json({ error: "Missing targetId" }, { status: 400 });
    }
    if (targetId === session.user.id) {
      return NextResponse.json({ error: "You cannot follow yourself" }, { status: 400 });
    }

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const existing = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: session.user.id,
          followingId: targetId,
        },
      },
    });

    if (existing) {
      await prisma.$transaction([
        prisma.follow.delete({ where: { id: existing.id } }),
        prisma.user.update({
          where: { id: session.user.id },
          data: { followingCount: { decrement: 1 } },
        }),
        prisma.user.update({
          where: { id: targetId },
          data: { followersCount: { decrement: 1 } },
        }),
      ]);
      return NextResponse.json({ following: false });
    }

    await prisma.$transaction([
      prisma.follow.create({
        data: { followerId: session.user.id, followingId: targetId },
      }),
      prisma.user.update({
        where: { id: session.user.id },
        data: { followingCount: { increment: 1 } },
      }),
      prisma.user.update({
        where: { id: targetId },
        data: { followersCount: { increment: 1 } },
      }),
    ]);
    const updatedTarget = await prisma.user.findUnique({
      where: { id: targetId },
      select: { followersCount: true },
    });

    // Notify the followed user
    await import("@/lib/notifications").then(({ createFollowNotification }) =>
      createFollowNotification({
        recipientId: targetId,
        actorId: session.user.id,
      })
    );

    return NextResponse.json({
      following: true,
      followersCount: updatedTarget?.followersCount ?? 0,
    });
  } catch (error) {
    console.error("Error toggling follow:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}