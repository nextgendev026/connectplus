import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";
import { validateBody } from "@/lib/api-validation";
import { WriterApplySchema } from "@/lib/schemas/validators";

/**
 * Verified-writer applications. Applying requires a confirmed email; admins
 * review via /api/admin/writer-applications. A rejected user may re-apply
 * (the old application is replaced).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await validateBody(request, WriterApplySchema);
    if (body instanceof NextResponse) return body;
    const { motivation, portfolio } = body;

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, role: true, emailVerified: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (user.role === "CREATOR" || user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      return NextResponse.json({ error: "You are already a verified writer." }, { status: 400 });
    }
    if (!user.emailVerified) {
      return NextResponse.json(
        { error: "Verify your email before applying.", code: "EMAIL_NOT_VERIFIED" },
        { status: 403 }
      );
    }

    const application = await prisma.writerApplication.upsert({
      where: { userId: user.id },
      create: { userId: user.id, motivation, portfolio: portfolio || null },
      update: {
        motivation,
        portfolio: portfolio || null,
        status: "PENDING",
        reviewedById: null,
        reviewedAt: null,
        reviewedNote: null,
      },
    });

    await createNotification({
      userId: user.id,
      type: "WRITER_APPLICATION",
      title: "Application received",
      message: "Your verified-writer application is under review.",
    });

    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    console.error("Error submitting writer application:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Returns the signed-in user's application (or null) so the settings UI can render its status. */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        role: true,
        isVerified: true,
        emailVerified: true,
        writerApplication: {
          select: {
            id: true,
            status: true,
            motivation: true,
            portfolio: true,
            reviewedNote: true,
            reviewedAt: true,
            createdAt: true,
          },
        },
      },
    });

    return NextResponse.json({
      role: user?.role ?? "USER",
      isVerified: user?.isVerified ?? false,
      emailVerified: user?.emailVerified ?? null,
      application: user?.writerApplication ?? null,
    });
  } catch (error) {
    console.error("Error fetching writer application:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}