import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";

/**
 * Admin decision on a verified-writer application.
 * Approving promotes the user to CREATOR and grants the verified badge;
 * rejecting records a reason and lets the user re-apply.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const adminId = session.user.id;
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? "").toUpperCase();
    const note = typeof body?.note === "string" ? body.note.trim() : "";

    if (action !== "APPROVE" && action !== "REJECT") {
      return NextResponse.json({ error: "Action must be: approve or reject" }, { status: 400 });
    }

    const application = await prisma.writerApplication.findUnique({
      where: { id },
      select: { id: true, status: true, userId: true },
    });
    if (!application) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    const [updated] = await prisma.$transaction([
      prisma.writerApplication.update({
        where: { id },
        data: {
          status: action === "APPROVE" ? "APPROVED" : "REJECTED",
          reviewedById: adminId,
          reviewedAt: new Date(),
          reviewedNote: note?.slice(0, 500) || null,
        },
      }),
      prisma.user.update({
        where: { id: application.userId },
        data:
          action === "APPROVE"
            ? { role: "CREATOR", isVerified: true }
            : { role: "USER", isVerified: false },
      }),
    ]);

    await createNotification({
      userId: application.userId,
      actorId: adminId,
      type: action === "APPROVE" ? "WRITER_APPROVED" : "WRITER_REJECTED",
      title: action === "APPROVE" ? "You're now a verified writer! 🎉" : "Application declined",
      message:
        action === "APPROVE"
          ? "Your verified-writer application was approved. Publish straight through, no review needed."
          : note
            ? `Your verified-writer application was declined: ${note}`
            : "Your verified-writer application was declined. You can re-apply with more detail.",
    });

    return NextResponse.json({ application: updated });
  } catch (error) {
    console.error("Error reviewing writer application:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}