import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveVisitor } from "@/lib/visitor";
import { cacheIncr } from "@/lib/redis";
import { recordImpression, resolveAdClick } from "@/lib/ads";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("ads-metrics");

/**
 * POST /api/ads/metrics — the single beacon for ad impressions and clicks.
 *
 * Replaces `/api/ads/slots/track`, which incremented a counter on every call
 * with no validation at all: any client could POST an arbitrary slot id any
 * number of times and write a row, and a busy page with three network fallbacks
 * meant three Postgres writes per pageview on a free tier where writes are the
 * scarce resource. Four things now stand between a beacon and a counter:
 *
 *   1. IDENTITY. The id must resolve to a creative that exists. An unknown id is
 *      acknowledged and dropped, so the endpoint cannot be used to probe for
 *      ids or to grow a table.
 *   2. DEDUPE. One impression per visitor per creative per hour. A refresh, a
 *      back-navigation and a remount are one impression, not three.
 *   3. RATE LIMIT. A per-visitor ceiling, so a script cannot spin the counter
 *      even with valid ids.
 *   4. INTENT. A prefetch or a crawler is acknowledged without being counted —
 *      those requests are real but nobody saw anything.
 *
 * Failure is always silent to the caller: a beacon has no error UI, and a lost
 * metric is worth less than a broken page.
 */

const KINDS = ["impression", "click"] as const;
type MetricKind = (typeof KINDS)[number];

/** Beacons are tiny; anything larger is not one. */
const MAX_BODY_BYTES = 2_000;
/** Beacons per visitor per minute, across every slot on the page. */
const RATE_LIMIT_PER_MINUTE = 180;

const CRAWLER_UA = /bot|crawler|spider|crawling|preview|headless|monitor|curl|wget|python-requests|axios\/|go-http/i;

interface MetricBody {
  kind?: string;
  adId?: string;
  networkSlotId?: string;
}

/** A beacon has no error path, so every rejection is a quiet 200. */
function accepted(counted = false) {
  return NextResponse.json({ ok: true, counted }, { status: 200 });
}

export async function POST(request: NextRequest) {
  // `navigator.sendBeacon` posts a Blob with a text/plain content type, so the
  // body is read as text and parsed here rather than trusting `request.json()`.
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return accepted();

  let body: MetricBody = {};
  try {
    body = JSON.parse(raw) as MetricBody;
  } catch {
    return accepted();
  }

  const kind = body.kind as MetricKind;
  if (!KINDS.includes(kind)) return accepted();

  const adId = typeof body.adId === "string" && body.adId.length > 0 && body.adId.length <= 64 ? body.adId : null;
  const networkSlotId =
    typeof body.networkSlotId === "string" && body.networkSlotId.length > 0 && body.networkSlotId.length <= 64
      ? body.networkSlotId
      : null;
  if (!adId && !networkSlotId) return accepted();

  // Not counted, but not an error either: something fetched the page, nobody
  // looked at it.
  const purpose = request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "";
  const userAgent = request.headers.get("user-agent");
  if (purpose.includes("prefetch") || CRAWLER_UA.test(userAgent ?? "")) return accepted();

  const { visitorHash } = resolveVisitor(request);

  const perMinute = await cacheIncr(`adrl:${visitorHash}`, 60).catch(() => 0);
  if (perMinute > RATE_LIMIT_PER_MINUTE) return NextResponse.json({ ok: false, reason: "rate" }, { status: 429 });

  try {
    if (adId) {
      // The id must be a real creative. Read-only check: an unknown id costs one
      // indexed lookup and writes nothing.
      const exists = await prisma.ad.findUnique({ where: { id: adId }, select: { id: true } });
      if (!exists) return accepted();
      if (kind === "impression") return accepted(await recordImpression(adId, visitorHash));
      await resolveAdClick(adId);
      return accepted(true);
    }

    const slot = await prisma.thirdPartyAdSlot.findUnique({
      where: { id: networkSlotId! },
      select: { id: true },
    });
    if (!slot) return accepted();

    // Network counts have no Convex table, so they land in Postgres — but only
    // after the same per-visitor dedupe, which is what turns a write per view
    // into at most one write per visitor per hour.
    if (kind === "impression") {
      const seen = await cacheIncr(`adseen:${visitorHash}:nt:${networkSlotId}`, 60 * 60).catch(() => 0);
      if (seen > 1) return accepted(false);
    }

    const field = kind === "click" ? "clicks" : "impressions";
    await prisma.thirdPartyAdSlot.update({
      where: { id: networkSlotId! },
      data: { [field]: { increment: 1 } },
    });
    return accepted(true);
  } catch (err) {
    log.warn("ad metric failed", { kind, adId, networkSlotId, error: String(err) });
    return accepted();
  }
}
