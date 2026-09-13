import { NextRequest, NextResponse } from "next/server";
import {
  buildReferralUrl,
  getReferralBySlug,
  recordReferralEvent,
} from "@/lib/sports";
import { resolveVisitor } from "@/lib/visitor";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sports/referral/[slug]?match=<id>
 *
 * Counts the click, weaves the partner's referral code into the destination,
 * then 302s. Doing the substitution server-side keeps codes out of page source,
 * and the redirect only ever leaves for an absolute http(s) URL so a malformed
 * template can't become an open redirect.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const matchId = request.nextUrl.searchParams.get("match");
  const fallback = NextResponse.redirect(new URL("/sports", request.nextUrl.origin), { status: 302 });

  const referral = await getReferralBySlug(slug);
  if (!referral || !referral.isActive) return fallback;

  const now = Date.now();
  if (referral.startsAt && referral.startsAt.getTime() > now) return fallback;
  if (referral.endsAt && referral.endsAt.getTime() < now) return fallback;

  let destination: URL;
  try {
    destination = new URL(buildReferralUrl(referral, matchId));
    if (destination.protocol !== "http:" && destination.protocol !== "https:") return fallback;
  } catch {
    return fallback;
  }

  let userId: string | null = null;
  try {
    const session = await auth();
    userId = session?.user?.id ?? null;
  } catch {
    /* anonymous click */
  }

  const visitor = resolveVisitor(request);
  recordReferralEvent(referral.id, "referral_click", {
    matchId,
    userId,
    visitorHash: visitor.visitorHash,
  });

  return NextResponse.redirect(destination, { status: 302 });
}
