import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { principalFromSession, reauthOr401 } from "@/lib/policies";
import { decryptSecret, matchBackupCode, verifyTotp } from "@/lib/mfa";

/**
 * Turn two-factor off.
 *
 * Requires the account password **and** a current TOTP (or unused backup) code.
 * The password alone is not enough: a member whose session was hijacked should
 * not lose their second factor to the hijacker. Every outstanding session is
 * revoked by bumping `tokenVersion`, because the security posture just changed.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const stale = await reauthOr401(request, principalFromSession(session));
    if (stale) return stale;

    const body = await request.json().catch(() => null);
    const password = typeof body?.password === "string" ? body.password : "";
    const code = typeof body?.code === "string" ? body.code : "";
    if (!password || !code) {
      return NextResponse.json({ error: "Enter your password and a current code" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, password: true, mfaEnabled: true, mfaSecret: true, mfaBackupCodes: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (!user.mfaEnabled || !user.mfaSecret) {
      return NextResponse.json({ error: "Two-factor authentication is not enabled" }, { status: 409 });
    }

    if (!(await compare(password, user.password))) {
      return NextResponse.json({ error: "Password is incorrect" }, { status: 400 });
    }

    const secret = decryptSecret(user.mfaSecret, user.id);
    const totpOk = verifyTotp(secret, code);
    const backupIndex = totpOk ? -1 : await matchBackupCode(user.mfaBackupCodes, code);
    if (!totpOk && backupIndex === -1) {
      return NextResponse.json({ error: "That code is not valid" }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaBackupCodes: [],
        mfaEnrolledAt: null,
        tokenVersion: { increment: 1 },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error disabling MFA:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
