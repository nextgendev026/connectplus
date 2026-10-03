import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { principalFromSession, reauthOr401 } from "@/lib/policies";
import { encryptSecret, generateEnrollment } from "@/lib/mfa";

/**
 * Begin TOTP enrollment.
 *
 * Returns the secret and the `otpauth://` URI, and parks the *encrypted* secret
 * on the row with `mfaEnabled` still false. Nothing is enforced until
 * `/api/user/mfa/verify` proves the member's app actually produces valid codes —
 * a half-finished enrollment must never lock anyone out.
 *
 * Re-auth gated: enrollment is how an attacker who has stolen a session would
 * persist access, so it demands a fresh sign-in exactly like a password change.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const stale = await reauthOr401(request, principalFromSession(session));
    if (stale) return stale;

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, mfaEnabled: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (user.mfaEnabled) {
      return NextResponse.json(
        { error: "Two-factor authentication is already enabled. Disable it first to re-enroll." },
        { status: 409 }
      );
    }

    const { secret, uri } = generateEnrollment(user.email);
    await prisma.user.update({
      where: { id: user.id },
      // Bound to the user id (AAD) so this ciphertext is useless on any other row.
      data: { mfaSecret: encryptSecret(secret, user.id), mfaEnabled: false },
    });

    return NextResponse.json({ secret, uri });
  } catch (error) {
    console.error("Error starting MFA enrollment:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
