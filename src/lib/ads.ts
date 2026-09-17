import { prisma } from "@/lib/prisma";
import { cacheGet, cacheSet, cacheIncr, redisDel } from "@/lib/redis";
import { convexAdClick, convexAdImpression, convexAdStats } from "@/lib/convex";
import { createLogger } from "@/lib/logger";
import {
  AD_SLOTS,
  eligibleCreatives,
  slotAllowsDevice,
  type AdDevice,
  type AdSlotName,
  type SelectionContext,
} from "@/lib/ad-selection";

const log = createLogger("ads");

/**
 * In-house ad pipeline — the server half.
 *
 * Everything is served from our own origin: no third-party ad script, no
 * client-side auction, no extra egress beyond one creative. Admins inject
 * creatives in the console; the app decides what a slot may show and the browser
 * picks which of those this reader sees (see `@/lib/ad-selection` for why that
 * split is where it is).
 *
 * Four properties this module has to hold, because each one was a real defect:
 *
 *   1. AN IMPRESSION IS A VIEWABLE ONE. Counting moved out of server render and
 *      into the beacon in `POST /api/ads/metrics`. Rendering an ad below the fold
 *      used to count as an impression nobody saw, and a React re-render counted
 *      again.
 *   2. THE READ PATH NEVER WRITES. A slot resolution is reads only — a Redis
 *      cache and, on a miss, one indexed query. Impressions are the only writes.
 *   3. ONE RESOLVER. In-house creatives and third-party network fallbacks used to
 *      be two pipelines with two caches and two trackers; `resolveSlot` answers
 *      both, so a placement cannot disagree with itself.
 *   4. A SLOT ALWAYS RENDERS SOMETHING OR NOTHING — never an error. No database
 *      and no Redis means no ads, not a broken page.
 */

export { AD_SLOT_LABELS, AD_SLOTS, matchesTargeting, normalizeTargetList } from "@/lib/ad-selection";
export type { AdDevice, AdSlotName };

/** The creative as the components see it — never carries targeting internals. */
export interface AdCreative {
  id: string;
  name: string;
  slot: string;
  format: string;
  imageUrl: string | null;
  html: string | null;
  targetUrl: string | null;
  sponsor: string | null;
  weight: number;
}

/** A creative plus the fields only eligibility needs. */
export interface AdCandidate extends AdCreative {
  categories: string | null;
  devices: string | null;
  frequencyCap: number | null;
}

/** Third-party slot config, resolved on the server and handed to the client. */
export interface NetworkSlotConfig {
  id: string;
  provider: string;
  scriptTag: string | null;
  adUnitId: string | null;
  sizes: string | null;
}

/**
 * What a slot may show.
 *
 * Both tiers are resolved together rather than one-or-the-other, because the
 * frequency cap is applied in the browser (it is the browser that knows what
 * this reader has already been shown). A slot whose first-party pool is capped
 * out must still be able to fall through to the network tier, and the server
 * cannot know that in advance.
 */
export interface AdResolution {
  /** Eligible first-party creatives, best first. Empty when none are live. */
  creatives: AdCreative[];
  /** Third-party fallback, when one is configured for the slot. */
  network: NetworkSlotConfig | null;
  /**
   * Whether the page should hold the slot's box open before it fills. True when
   * there is something that can fill it — a reserved box for a slot that will
   * stay empty is worse than no box at all.
   */
  reserve: boolean;
}

const SLOT_TTL_SECONDS = 60;
const NETWORK_TTL_SECONDS = 300;
/**
 * How many eligible creatives travel to the browser. The cap keeps the payload
 * honest — the reader fetches one image, and a slot with twenty live campaigns
 * is not a reason to ship twenty URLs down with the page.
 */
const MAX_CLIENT_POOL = 8;

function isSlot(value: string): value is AdSlotName {
  return (AD_SLOTS as readonly string[]).includes(value);
}

export interface AdContext {
  categories?: string[];
  device?: AdDevice;
}

/* ── Cached reads ─────────────────────────────────────────────────────────── */

/**
 * Live creatives for a slot, cached for a minute so a busy page does not
 * re-query per render. Expired or not-yet-started campaigns are filtered in
 * SQL, so scheduling works without a cron.
 */
export async function listSlotAds(slot: string): Promise<AdCandidate[]> {
  const cacheKey = `ads:slot:${slot}`;
  const cached = await cacheGet<AdCandidate[]>(cacheKey).catch(() => null);
  if (cached) return cached;

  const now = new Date();
  try {
    const rows = await prisma.ad.findMany({
      where: {
        slot,
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ weight: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        name: true,
        slot: true,
        format: true,
        imageUrl: true,
        html: true,
        targetUrl: true,
        sponsor: true,
        weight: true,
        categories: true,
        devices: true,
        frequencyCap: true,
      },
    });
    void cacheSet(cacheKey, rows, SLOT_TTL_SECONDS).catch(() => {});
    return rows;
  } catch (err) {
    log.warn("ad lookup failed", { slot, error: err });
    return [];
  }
}

/** Drop the cached creative list for a slot after an admin edit. */
export async function invalidateSlotAds(slot: string): Promise<void> {
  await redisDel(`ads:slot:${slot}`).catch(() => {});
}

/**
 * The third-party fallback for a slot, resolved on the server.
 *
 * This used to be a browser `fetch("/api/ads/slots?slot=…")` per placement: a
 * round trip per slot, an empty box flashing while it resolved, and a request
 * that could abort mid-flight. The cache is shared with the legacy endpoint so
 * both paths stay warm off one query.
 */
export async function networkSlotFor(slot: string): Promise<NetworkSlotConfig | null> {
  const cacheKey = `adslot:${slot}`;
  // The miss is cached too. "No network slot is configured" is the normal state
  // for most placements, and without this every render of every page carrying an
  // unconfigured slot pays for a database query that always answers the same.
  const cached = await cacheGet<{ network: NetworkSlotConfig | null }>(cacheKey).catch(() => null);
  if (cached) return cached.network;

  try {
    const row = await prisma.thirdPartyAdSlot.findFirst({
      where: { slot, isActive: true },
      orderBy: { weight: "desc" },
      select: { id: true, scriptTag: true, provider: true, adUnitId: true, sizes: true },
    });
    void cacheSet(cacheKey, { network: row }, NETWORK_TTL_SECONDS).catch(() => {});
    return row;
  } catch (err) {
    log.warn("network slot lookup failed", { slot, error: err });
    return null;
  }
}

/* ── Resolution ───────────────────────────────────────────────────────────── */

/**
 * What a slot may show: the eligible first-party creatives, a third-party
 * fallback, or nothing.
 *
 * Revenue order is deliberate — a direct campaign outranks a network script,
 * because a direct campaign is worth more per impression and costs no
 * third-party egress. The network tier is only consulted once the first-party
 * pool is genuinely empty, not when the browser later declines to pick from it.
 */
export async function resolveSlot(slot: string, ctx: AdContext = {}): Promise<AdResolution | null> {
  if (!isSlot(slot)) return null;
  if (ctx.device && !slotAllowsDevice(slot, ctx.device)) return null;

  const [candidates, network] = await Promise.all([listSlotAds(slot), networkSlotFor(slot)]);

  const eligible = eligibleCreatives(candidates, {
    categories: ctx.categories,
    device: ctx.device,
  } as SelectionContext);

  // Strongest campaigns first, so the browser's bounded pool holds the ones most
  // worth showing rather than an arbitrary eight.
  const ranked = [...eligible].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const creatives: AdCreative[] = ranked.slice(0, MAX_CLIENT_POOL).map((ad) => ({
    id: ad.id,
    name: ad.name,
    slot: ad.slot,
    format: ad.format,
    imageUrl: ad.imageUrl,
    html: ad.html,
    targetUrl: ad.targetUrl,
    sponsor: ad.sponsor,
    weight: ad.weight,
  }));

  if (creatives.length === 0 && !network) return null;
  return { creatives, network, reserve: true };
}

/* ── Metrics ──────────────────────────────────────────────────────────────── */

/**
 * Record a viewable impression.
 *
 * Convex owns the counter, which keeps the write off Supabase entirely (free-tier
 * writes are the scarce resource); Postgres stays as the fallback so metrics
 * survive a Convex outage.
 *
 * Deduped per visitor per creative per hour: a refresh, a back-navigation and a
 * remount are one impression, not three. Without Redis the check is skipped
 * rather than the impression dropped — an uncounted view is a smaller problem
 * than an unmeasured campaign.
 */
export async function recordImpression(adId: string, visitorKey?: string): Promise<boolean> {
  if (visitorKey) {
    const seen = await cacheIncr(`adseen:${visitorKey}:${adId}`, 60 * 60).catch(() => 0);
    if (seen > 1) return false;
  }

  const offloaded = await convexAdImpression(adId).catch(() => false);
  if (!offloaded) {
    await prisma.ad
      .update({ where: { id: adId }, data: { impressions: { increment: 1 } } })
      .catch(() => {});
  }
  return true;
}

/**
 * Click-through target: counts the click then hands back the destination.
 *
 * The destination is read (not written) so Convex can own the counter without
 * costing an extra Postgres UPDATE. `count: false` is for a click that was not a
 * person — a crawler following the redirect — where the destination still has to
 * resolve but the counter must be left alone.
 */
export async function resolveAdClick(
  adId: string,
  options: { count?: boolean } = {}
): Promise<string | null> {
  if (options.count === false) {
    const ad = await prisma.ad
      .findUnique({ where: { id: adId }, select: { targetUrl: true } })
      .catch(() => null);
    return ad?.targetUrl ?? null;
  }

  const recorded = await convexAdClick(adId);
  if (!recorded) {
    const bumped = await prisma.ad
      .update({ where: { id: adId }, data: { clicks: { increment: 1 } }, select: { targetUrl: true } })
      .catch(() => null);
    return bumped?.targetUrl ?? null;
  }
  const ad = await prisma.ad
    .findUnique({ where: { id: adId }, select: { targetUrl: true } })
    .catch(() => null);
  return ad?.targetUrl ?? null;
}

/**
 * Merged impression/click totals for the admin console. Convex holds live
 * counts; any Postgres totals on top of the Convex baseline are added so
 * history recorded before the offload is not lost.
 */
export async function getAdStats(): Promise<{
  byAd: Record<string, { impressions: number; clicks: number }>;
  impressions: number;
  clicks: number;
}> {
  const [convex, ads] = await Promise.all([
    convexAdStats(),
    prisma.ad
      .findMany({ select: { id: true, impressions: true, clicks: true } })
      .catch(() => [] as { id: string; impressions: number; clicks: number }[]),
  ]);

  const byAd: Record<string, { impressions: number; clicks: number }> = {};
  for (const ad of ads) byAd[ad.id] = { impressions: 0, clicks: 0 };

  if (convex) {
    for (const row of convex.ads) {
      byAd[row.adId] = { impressions: row.impressions, clicks: row.clicks };
    }
  } else {
    for (const ad of ads) byAd[ad.id] = { impressions: ad.impressions, clicks: ad.clicks };
  }

  const impressions = Object.values(byAd).reduce((n, a) => n + a.impressions, 0);
  const clicks = Object.values(byAd).reduce((n, a) => n + a.clicks, 0);
  return { byAd, impressions, clicks };
}

