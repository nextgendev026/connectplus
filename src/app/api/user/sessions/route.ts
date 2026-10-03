import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { principalFromSession, reauthOr401, REAUTH_WINDOW_SECONDS } from "@/lib/policies";

/**
 * Session revocation, the other half of the tokenVersion mechanism (F-10).
 *
 * A JWT cannot be recalled — it is valid until it expires — so revocation is
 * done by moving the row's `tokenVersion` forward: every outstanding token now
 * carries a version the session refresh no longer accepts, and dies at its
 * next refresh (within five minutes, see the jwt callback in src/lib/auth.ts).
 *
 *   GET  — how old this session is, and how fresh a sign-in a Tier-3 action
 *          would demand. The console can show "signed in 3 days ago" without
 *          parsing a JWT itself.
 *   POST — `{ "action": "revoke_all" }`: bump the version. Deliberately
 *          including the caller's own session — "sign out everywhere" means
 *          everywhere, and a version that spared the requesting token would
 *          leave the stolen session it was meant to kill alive.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const principal = principalFromSession(session);
  const tokenVersion = await prisma.user
    .findUnique({ where: { id: principal.actorId! }, select: { tokenVersion: true } })
    .catch(() => null);

  return NextResponse.json({
    userId: principal.actorId,
    tokenVersion: tokenVersion?.tokenVersion ?? 0,
    reauthWindowSeconds: REAUTH_WINDOW_SECONDS,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const principal = principalFromSession(session);

  const body = await request.json().catch(() => ({}));
  if (body?.action !== "revoke_all") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  // Revocation is itself a security-relevant act (a phished session trying to
  // lock its victim out is worse than the session), so it demands the same
  // fresh sign-in as the other Tier-3 actions.
  const stale = await reauthOr401(request, principal);
  if (stale) return stale;

  await prisma.user.update({
    where: { id: principal.actorId! },
    data: { tokenVersion: { increment: 1 } },
  });

  return NextResponse.json({
    ok: true,
    note: "Every session is signed out, including this one. Sign in again to continue.",
  });
}
