import { prisma } from "@/lib/prisma";
import { cacheGet, cacheSet, redisDel } from "@/lib/redis";
import { convexAdClick, convexAdImpression, convexAdStats } from "@/lib/convex";
import { createLogger } from "@/lib/logger";

const log = createLogger("ads");

/**
 * In-house ad pipeline.
 *
 * Everything is served from our own origin: no third-party ad script, no
 * client-side auction, no extra egress beyond one creative. Admins inject
 * creatives in the console; the app picks the best match for a slot, weighted
 * so a campaign can be favoured without editing code.
 */
export const AD_SLOTS = [
  "feed-inline",
  "feed-sidebar",
  "article-top",
  "article-inline",
  "article-sidebar",
  "radio-hero",
] as const;

export type AdSlotName = (typeof AD_SLOTS)[number];

export const AD_SLOT_LABELS: Record<string, string> = {
  "feed-inline": "Feed — between cards",
  "feed-sidebar": "Feed — sidebar",
  "article-top": "Article — above the fold",
  "article-inline": "Article — mid-content",
  "article-sidebar": "Article — sidebar",
  "radio-hero": "Radio — hero panel",
};

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

const SLOT_TTL_SECONDS = 60;

function isSlot(value: string): value is AdSlotName {
  return (AD_SLOTS as readonly string[]).includes(value);
}

/**
 * Active creatives for a slot, cached for a minute so a busy page does not
 * re-query per render. Expired or not-yet-started campaigns are filtered in
 * SQL, so scheduling works without a cron.
 */
export async function listSlotAds(slot: string): Promise<AdCreative[]> {
  const cacheKey = `ads:slot:${slot}`;
  const cached = await cacheGet<AdCreative[]>(cacheKey).catch(() => null);
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

/** Weighted pick so recurring campaigns can outbid one another. */
export function pickWeighted(ads: AdCreative[], seed = Math.random()): AdCreative | null {
  if (ads.length === 0) return null;
  const total = ads.reduce((sum, ad) => sum + Math.max(1, ad.weight), 0);
  let ticket = Math.min(Math.max(seed, 0), 0.999999) * total;
  for (const ad of ads) {
    ticket -= Math.max(1, ad.weight);
    if (ticket < 0) return ad;
  }
  return ads[0] ?? null;
}

/** Best ad for a slot, or null when the slot is unmonetised right now. */
export async function pickAd(slot: string, seed?: number): Promise<AdCreative | null> {
  if (!isSlot(slot)) return null;
  const ads = await listSlotAds(slot);
  return pickWeighted(ads, seed);
}

/**
 * Impressions are a cheap counter, not a ledger. Convex owns it, which keeps
 * the write off Supabase entirely (free-tier writes are the scarce resource);
 * Postgres stays as the fallback so metrics survive a Convex outage.
 */
export function recordImpression(adId: string): void {
  void convexAdImpression(adId).then((ok) => {
    if (ok) return;
    return prisma.ad
      .update({ where: { id: adId }, data: { impressions: { increment: 1 } } })
      .catch(() => {});
  });
}

/**
 * Click-through target: counts the click then hands back the destination. The
 * destination is read (not written) so Convex can own the counter without
 * costing an extra Postgres UPDATE.
 */
export async function resolveAdClick(adId: string): Promise<string | null> {
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

export const AD_SLOT_OPTIONS = AD_SLOTS.map((slot) => ({ value: slot, label: AD_SLOT_LABELS[slot] ?? slot }));
