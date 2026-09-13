import { NextRequest, NextResponse } from "next/server";
import { recordMatchView, recordReferralEvent } from "@/lib/sports";
import { resolveVisitor } from "@/lib/visitor";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["referral_impression", "match_view", "prediction_view"]);

/**
 * POST /api/sports/track
 *
 * Fire-and-forget activity beacon for the sports hub: partner impressions and
 * fixture/prediction views. Never blocks a render, never throws at the caller —
 * a dropped beacon is cheaper than a broken page.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    type?: string;
    referralId?: string;
    matchId?: string;
    predictionId?: string;
  };

  if (!body.type || !ALLOWED.has(body.type)) {
    return NextResponse.json({ ok: false, error: "Unknown activity type" }, { status: 400 });
  }

  let userId: string | null = null;
  try {
    const session = await auth();
    userId = session?.user?.id ?? null;
  } catch {
    /* anonymous */
  }

  const visitor = resolveVisitor(request);

  if (body.type === "referral_impression") {
    if (!body.referralId) return NextResponse.json({ ok: false }, { status: 400 });
    recordReferralEvent(body.referralId, "referral_impression", {
      matchId: body.matchId ?? null,
      userId,
      visitorHash: visitor.visitorHash,
    });
  } else {
    recordMatchView({
      type: body.type as "match_view" | "prediction_view",
      matchId: body.matchId ?? null,
      predictionId: body.predictionId ?? null,
      userId,
      visitorHash: visitor.visitorHash,
    });
  }

  return NextResponse.json({ ok: true });
}
