import { NextRequest, NextResponse } from "next/server";
import { listReferralOffers, REFERRAL_PLACEMENTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sports/referrals?placement=sports-sidebar
 *
 * Active betting partners for a placement. The referral CODE is deliberately
 * never returned to the browser — the click-through route weaves it into the
 * destination on the server, so a partner code cannot be scraped off the page.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const placement = searchParams.get("placement") ?? undefined;
  const valid =
    placement && (REFERRAL_PLACEMENTS as readonly string[]).includes(placement)
      ? placement
      : undefined;

  try {
    const offers = await listReferralOffers(valid);
    return NextResponse.json(
      {
        placement: valid ?? null,
        offers: offers.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          region: o.region,
          bonus: o.bonus,
          description: o.description,
          logoUrl: o.logoUrl,
          placement: o.placement,
          ctaText: o.ctaText,
          clickUrl: `/api/sports/referral/${o.slug}`,
        })),
      },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load referral offers", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
