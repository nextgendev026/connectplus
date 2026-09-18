import { prisma } from "./prisma";
import { createLogger } from "./logger";
import { STATIONS } from "./radio-stations";

const log = createLogger("platform-facts");

/**
 * The live numbers the public pages are allowed to quote.
 *
 * The marketing and informational pages were written with figures baked into
 * the prose — "real-time coverage", a fixed category count — which meant the
 * copy and the platform drifted apart the moment either changed. Gathering the
 * facts once, in one place, is what lets every page quote the same truth and
 * lets a claim on the About page match the one on the Help page.
 *
 * Two rules keep it trustworthy:
 *
 *   1. **A fact is measured, never invented.** Each field is a real query
 *      against the live database, so a page can only claim what is true now.
 *   2. **An unreadable fact is absent, not zero.** Every query is caught, and a
 *      failure yields `null` so the page can omit the claim rather than publish
 *      "0 writers". A page that silently renders zero is worse than one that
 *      says nothing.
 */

export interface PlatformFacts {
  /** Published stories readable in the feed. */
  publishedStories: number | null;
  /** Registered writers and readers. */
  writers: number | null;
  /** Lifetime reads across published stories. */
  reads: number | null;
  /** Topical categories stories are filed under. */
  categories: number | null;
  /** Distinct tags in use. */
  tags: number | null;
  /** Active sources being syndicated. */
  activeFeeds: number | null;
  /** Stories that arrived through syndication rather than being written in the studio. */
  syndicatedStories: number | null;
  /** Radio stations the player can stream. */
  radioStations: number;
  /** Settled predictions (won + lost), the honest denominator for accuracy. */
  settledPicks: number | null;
  /** Predictions that were graded correct. */
  wonPicks: number | null;
  /** `won / settled` as a whole percentage, or null when nothing has settled. */
  accuracy: number | null;
  /** Tips that were paid through a provider (not comped). */
  tipsSettled: number | null;
  /** Total value of those tips, in Kenyan shillings. */
  tipsAmount: number | null;
  /** Distinct creators who have earned at least one settled tip. */
  creatorsPaid: number | null;
  /** Net value already paid out to creators, in Kenyan shillings. */
  payoutsAmount: number | null;
  /** Members holding an active paid subscription. */
  activeMembers: number | null;
  /** Plan tiers on offer. */
  plans: number | null;
}

/** Run a query, but treat a failure as "unknown" rather than zero. */
async function safe<T>(label: string, query: () => Promise<T>): Promise<T | null> {
  try {
    return await query();
  } catch (error) {
    log.warn("fact unavailable", { fact: label, error: String(error) });
    return null;
  }
}

/**
 * Gather every public fact in one round-trip.
 *
 * The queries are independent, so they run concurrently; the whole thing
 * degrades field by field rather than failing as a unit, because a page that
 * loses one number should still render its other nine.
 */
export async function getPlatformFacts(): Promise<PlatformFacts> {
  const [
    publishedStories,
    writers,
    reads,
    categories,
    tags,
    activeFeeds,
    syndicatedStories,
    settledPicks,
    wonPicks,
    tipsAgg,
    tipCreators,
    payoutsAgg,
    activeMembers,
    plans,
  ] = await Promise.all([
    safe("publishedStories", () => prisma.post.count({ where: { status: "PUBLISHED" } })),
    safe("writers", () => prisma.user.count()),
    safe("reads", () =>
      prisma.post
        .aggregate({ _sum: { viewCount: true }, where: { status: "PUBLISHED" } })
        .then((r) => r._sum.viewCount ?? 0)
    ),
    safe("categories", () => prisma.category.count()),
    safe("tags", () => prisma.tag.count()),
    safe("activeFeeds", () => prisma.rssFeed.count({ where: { isActive: true } })),
    safe("syndicatedStories", () => prisma.post.count({ where: { source: { not: null } } })),
    safe("settledPicks", () =>
      prisma.sportsPrediction.count({ where: { status: { in: ["WON", "LOST"] } } })
    ),
    safe("wonPicks", () => prisma.sportsPrediction.count({ where: { status: "WON" } })),
    safe("tips", () =>
      prisma.tip.aggregate({
        _sum: { amount: true },
        _count: true,
        where: { status: "succeeded" },
      })
    ),
    safe("tipCreators", () =>
      prisma.tip
        .findMany({ where: { status: "succeeded" }, select: { toUserId: true }, distinct: ["toUserId"] })
        .then((rows) => rows.length)
    ),
    safe("payouts", () =>
      prisma.creatorPayout.aggregate({
        _sum: { amount: true },
        where: { status: "paid" },
      })
    ),
    safe("activeMembers", () => prisma.userSubscription.count({ where: { status: "active" } })),
    safe("plans", () => prisma.subscriptionPlan.count({ where: { isActive: true } })),
  ]);

  return {
    publishedStories,
    writers,
    reads,
    categories,
    tags,
    activeFeeds,
    syndicatedStories,
    radioStations: STATIONS.length,
    settledPicks,
    wonPicks,
    accuracy:
      settledPicks && settledPicks > 0 && wonPicks !== null
        ? Math.round((wonPicks / settledPicks) * 100)
        : null,
    tipsSettled: tipsAgg?._count ?? null,
    tipsAmount: tipsAgg?._sum.amount ?? null,
    creatorsPaid: tipCreators,
    payoutsAmount: payoutsAgg?._sum.amount ?? null,
    activeMembers,
    plans,
  };
}
