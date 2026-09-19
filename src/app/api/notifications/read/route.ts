import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateBody } from "@/lib/api-validation";
import { NotificationsReadSchema } from "@/lib/schemas/validators";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await validateBody(request, NotificationsReadSchema);
    if (body instanceof NextResponse) return body;
    const id = body.ids?.[0] ?? null;

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

    if (body.all) {
      // Mark all as read
      await prisma.notification.updateMany({
        where: { userId: session.user.id, read: false },
        data: { read: true },
      });
      return NextResponse.json({ updated: true, unreadCount: 0 });
    }

    return NextResponse.json({ updated: false, unreadCount: 0 });
  } catch (error) {
    console.error("Error marking notifications read:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}