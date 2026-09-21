import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Ad metrics, sharded for the same reason the view counters are (see
 * `convex/schema.ts`): an impression is written once per rendered slot, so the
 * busiest placement is a single document that every reader of the home page
 * tries to increment at the same time. Convex retries a conflicting mutation,
 * but a sustained run of conflicts fails it permanently — and a counter that
 * silently stops moving is worse than one that is obviously broken, because the
 * console keeps reporting the stale number.
 */
const SHARDS = 8;
/** `SHARDS`, plus room for the pre-shard rows a deployment may still carry. */
const MAX_COUNTER_ROWS = 64;

function pickShard(): number {
  return Math.floor(Math.random() * SHARDS);
}

async function bump(ctx: { db: any }, adId: string, field: "impressions" | "clicks") {
  const now = Date.now();
  const shard = pickShard();
  const existing = await ctx.db
    .query("adStats")
    .withIndex("by_ad_shard", (q: any) => q.eq("adId", adId).eq("shard", shard))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, { [field]: existing[field] + 1, updatedAt: now });
  } else {
    await ctx.db.insert("adStats", {
      adId,
      shard,
      impressions: field === "impressions" ? 1 : 0,
      clicks: field === "clicks" ? 1 : 0,
      updatedAt: now,
    });
  }
}

/** One impression for a rendered ad slot. */
export const impression = mutation({
  args: { adId: v.string() },
  returns: v.null(),
  handler: async (ctx, { adId }) => {
    await bump(ctx, adId, "impressions");
    return null;
  },
});

/** One click-through. */
export const click = mutation({
  args: { adId: v.string() },
  returns: v.null(),
  handler: async (ctx, { adId }) => {
    await bump(ctx, adId, "clicks");
    return null;
  },
});

/** Per-ad totals, plus the campaign roll-up the console shows. */
export const stats = query({
  args: {},
  returns: v.object({
    ads: v.array(
      v.object({ adId: v.string(), impressions: v.number(), clicks: v.number() })
    ),
    impressions: v.number(),
    clicks: v.number(),
  }),
  handler: async (ctx) => {
    // Bounded, like every other read here: a full-table `collect()` is a call
    // that starts throwing once the table outgrows Convex's per-execution
    // document limit, and ad creatives are not a set that stays small forever.
    const rows = await ctx.db.query("adStats").take(2000);

    // One ad is several rows now, so they are added up per creative before the
    // console sees them. Reporting per row would show each creative several
    // times with a fraction of its real numbers.
    const perAd = new Map<string, { impressions: number; clicks: number }>();
    for (const row of rows) {
      const current = perAd.get(row.adId) ?? { impressions: 0, clicks: 0 };
      current.impressions += row.impressions;
      current.clicks += row.clicks;
      perAd.set(row.adId, current);
    }

    const ads = [...perAd.entries()].map(([adId, totals]) => ({
      adId,
      impressions: totals.impressions,
      clicks: totals.clicks,
    }));

    return {
      ads,
      impressions: ads.reduce((n, a) => n + a.impressions, 0),
      clicks: ads.reduce((n, a) => n + a.clicks, 0),
    };
  },
});
