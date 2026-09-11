import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function bump(ctx: { db: any }, adId: string, field: "impressions" | "clicks") {
  const now = Date.now();
  const existing = await ctx.db
    .query("adStats")
    .withIndex("by_ad", (q: any) => q.eq("adId", adId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, { [field]: existing[field] + 1, updatedAt: now });
  } else {
    await ctx.db.insert("adStats", {
      adId,
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
    const rows = await ctx.db.query("adStats").collect();
    return {
      ads: rows.map((r) => ({ adId: r.adId, impressions: r.impressions, clicks: r.clicks })),
      impressions: rows.reduce((n, r) => n + r.impressions, 0),
      clicks: rows.reduce((n, r) => n + r.clicks, 0),
    };
  },
});
