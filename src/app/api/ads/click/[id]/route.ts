import { NextRequest, NextResponse } from "next/server";
import { resolveAdClick } from "@/lib/ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Click-through tracker for in-house ads. Counts the click, then 302s to the
 * advertiser. Ads with no destination (brand/awareness) just land back home so
 * the link is never dead.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const target = await resolveAdClick(id).catch(() => null);

  const fallback = new URL("/", request.nextUrl.origin);
  let destination = fallback;
  if (target) {
    try {
      destination = new URL(target);
    } catch {
      destination = fallback;
    }
  }

  return NextResponse.redirect(destination, { status: 302 });
}
