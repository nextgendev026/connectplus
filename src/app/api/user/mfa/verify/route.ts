import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { principalFromSession, reauthOr401 } from "@/lib/policies";
import { decryptSecret, generateBackupCodes, hashBackupCodes, verifyTotp } from "@/lib/mfa";

/**
 * Confirm enrollment: the submitted code must match the pending secret.
 *
 * On success the row flips to `mfaEnabled: true`, the enrollment is stamped, and
 * a fresh set of backup codes is returned **once** — only their bcrypt hashes are
 * stored, so this response is the only time the plaintext codes exist. That is
 * deliberate: recovery codes that can be re-read from a settings page are a
 * second password sitting in plaintext.
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
    const code = typeof body?.code === "string" ? body.code : "";
    if (!code) {
      return NextResponse.json({ error: "Enter the 6-digit code from your authenticator app" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, mfaEnabled: true, mfaSecret: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (user.mfaEnabled) {
      return NextResponse.json({ error: "Two-factor authentication is already enabled" }, { status: 409 });
    }
    if (!user.mfaSecret) {
      return NextResponse.json({ error: "Start enrollment before verifying a code" }, { status: 409 });
    }

    let secret: string;
    try {
      secret = decryptSecret(user.mfaSecret, user.id);
    } catch {
      // Wrong key or a corrupted row: the pending secret is unusable, so clear
      // it and let the member start over rather than failing forever.
      await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: null } });
      return NextResponse.json(
        { error: "This enrollment could not be read. Start again to get a new secret." },
        { status: 409 }
      );
    }

    if (!verifyTotp(secret, code)) {
      return NextResponse.json({ error: "That code is not valid. Check your device clock and try again." }, { status: 400 });
    }

    const backupCodes = generateBackupCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: true,
        mfaBackupCodes: await hashBackupCodes(backupCodes),
        mfaEnrolledAt: new Date(),
        mfaLastUsedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, backupCodes });
  } catch (error) {
    console.error("Error verifying MFA enrollment:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
