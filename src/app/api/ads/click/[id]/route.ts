import { NextRequest, NextResponse } from "next/server";
import { resolveAdClick } from "@/lib/ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRAWLER_UA = /bot|crawler|spider|crawling|preview|headless|monitor|curl|wget|python-requests|axios\/|go-http/i;

/**
 * Click-through tracker for in-house ads. Counts the click, then 302s to the
 * advertiser. Ads with no destination (brand/awareness) just land back home so
 * the link is never dead.
 *
 * Three things this route has to get right beyond counting:
 *
 *   1. A DESTINATION IS RESOLVED AGAINST OUR OWN ORIGIN. `new URL(target)` alone
 *      throws on a path like `/pricing`, and the catch sent the reader to the
 *      homepage — so every campaign that pointed at an internal page looked
 *      broken. Only an absolute URL or an origin-relative path is accepted;
 *      anything else still falls back rather than redirecting into the void.
 *   2. A CRAWLER IS NOT A CLICK. Crawlers and link checkers follow redirects, so
 *      a scan of the feed would have inflated every campaign's clicks. The
 *      destination still resolves; the counter is left alone.
 *   3. THE ID IS BOUNDED before it reaches the database.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fallback = new URL("/", request.nextUrl.origin);

  if (!id || id.length > 64) return NextResponse.redirect(fallback, { status: 302 });

  const isCrawler = CRAWLER_UA.test(request.headers.get("user-agent") ?? "");
  const target = await resolveAdClick(id, { count: !isCrawler }).catch(() => null);
  if (!target) return NextResponse.redirect(fallback, { status: 302 });

  let destination: URL;
  try {
    destination = new URL(target, request.nextUrl.origin);
  } catch {
    destination = fallback;
  }
  // A protocol-relative `//evil.example` parses as an absolute URL to another
  // host. That is a legitimate destination for an advertiser, but `javascript:`
  // is not, and neither is anything that is not http(s).
  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    return NextResponse.redirect(fallback, { status: 302 });
  }

  return NextResponse.redirect(destination, { status: 302 });
}
