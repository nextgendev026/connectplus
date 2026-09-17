import { NextRequest, NextResponse } from "next/server";
import { isAdSlot } from "@/lib/ad-selection";
import { resolveSlot } from "@/lib/ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ads/slots?slot=feed-inline — what a placement may show.
 *
 * Server components get this as a prop from `AdSlot` and make no request at all.
 * This exists for the pages that are client components (`/radio`), which cannot
 * render an async server component and so have to ask after mount.
 *
 *   1. Both tiers are returned — the eligible first-party creatives and the
 *      network fallback — because the per-reader choice (and the frequency cap)
 *      happens in the browser.
 *   2. The slot name is validated against the catalogue. It used to be pasted
 *      straight into a Redis key, so any caller could mint unbounded cache keys.
 *   3. The answer is identical for every reader, so it is edge-cacheable. A
 *      placement on a client page therefore costs a cached read, not a render.
 */
export async function GET(request: NextRequest) {
  const slotKey = new URL(request.url).searchParams.get("slot") ?? "";
  if (!slotKey) return NextResponse.json({ error: "slot parameter required" }, { status: 400 });
  if (!isAdSlot(slotKey)) return NextResponse.json({ error: "Unknown slot" }, { status: 400 });

  const categoryParam = new URL(request.url).searchParams.get("categories") ?? "";
  const categories = categoryParam
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const resolution = await resolveSlot(slotKey, { categories }).catch(() => null);

  return NextResponse.json(
    { resolution },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    }
  );
}
