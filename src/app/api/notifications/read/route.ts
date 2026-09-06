import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : null;

    if (id) {
      const updated = await prisma.notification.updateMany({
        where: { id, userId: session.user.id },
        data: { read: true },
      });
      const unreadCount = await prisma.notification.count({
        where: { userId: session.user.id, read: false },
      });
      return NextResponse.json({ updated: updated.count > 0, unreadCount });
    }

    // Mark all as read
    await prisma.notification.updateMany({
      where: { userId: session.user.id, read: false },
      data: { read: true },
    });

    return NextResponse.json({ updated: true, unreadCount: 0 });
  } catch (error) {
    console.error("Error marking notifications read:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}