import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { appBaseUrl, createEmailVerificationToken, sendVerificationEmail } from "@/lib/mailer";

const RESEND_WINDOW_MS = 60_000;

/** Issues a fresh verification token + email for the signed-in user. */
export async function POST(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        emailVerified: true,
        emailToken: true,
        emailTokenExpires: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (user.emailVerified) {
      return NextResponse.json({ message: "Email already verified" });
    }

    // Cooldown so resend can't be used as a mail-bomb.
    const lastSent = user.emailTokenExpires
      ? user.emailTokenExpires.getTime() - 24 * 60 * 60 * 1000
      : 0;
    if (user.emailToken && Date.now() - lastSent < RESEND_WINDOW_MS) {
      return NextResponse.json(
        { error: "A verification email was just sent — check your inbox, or try again in a minute." },
        { status: 429 }
      );
    }

    const { token, expiresAt } = createEmailVerificationToken();
    await prisma.user.update({
      where: { id: user.id },
      data: { emailToken: token, emailTokenExpires: expiresAt },
    });

    const verificationUrl = `${appBaseUrl()}/auth/verify-email?token=${token}`;
    const emailResult = await sendVerificationEmail({
      to: user.email,
      name: user.name ?? user.username,
      verificationUrl,
    }).catch(() => ({ ok: false as const, delivered: false as const }));

    return NextResponse.json({
      message: emailResult?.delivered
        ? "Verification email sent — check your inbox."
        : "Verification email generated.",
      emailVerification: {
        sent: emailResult?.delivered ?? false,
        devUrl: emailResult?.delivered ? undefined : verificationUrl,
        expiresInHours: 24,
      },
    });
  } catch (error) {
    console.error("Resend verification error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}