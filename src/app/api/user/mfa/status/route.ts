import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** What the settings UI needs to render the right MFA card: enabled?, how many
 *  backup codes remain, and whether this account is one MFA is enforced on. */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, mfaEnabled: true, mfaEnrolledAt: true, mfaBackupCodes: true, mfaSecret: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const enforced = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
    return NextResponse.json({
      enabled: user.mfaEnabled,
      pending: !user.mfaEnabled && Boolean(user.mfaSecret),
      enforced,
      backupCodesRemaining: user.mfaBackupCodes.length,
      enrolledAt: user.mfaEnrolledAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("Error reading MFA status:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
