import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Confirms an email address via the token emailed at signup. Idempotent:
 * verifying an already-verified address succeeds so stale link taps don't 500.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json({ error: "Missing verification token" }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { emailToken: token },
      select: { id: true, email: true, emailVerified: true, emailTokenExpires: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "This verification link is invalid. Request a new one." },
        { status: 400 }
      );
    }

    if (user.emailVerified) {
      return NextResponse.json({ message: "Email already verified" });
    }

    if (!user.emailTokenExpires || user.emailTokenExpires.getTime() < Date.now()) {
      return NextResponse.json(
        { error: "This verification link has expired. Request a new one." },
        { status: 410 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date(), emailToken: null, emailTokenExpires: null },
    });

    return NextResponse.json({ message: "Email verified successfully" });
  } catch (error) {
    console.error("Email verification error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}