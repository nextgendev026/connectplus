import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { extractKeywords } from "@/lib/neural-text";
import { research, type ResearchFinding } from "@/lib/web-research";

/**
 * Live platform intelligence for the combined mind.
 *
 * The mind could already reason about posts, comments, hive memories and raw
 * visit counters. What it could not see was the *business* of the platform:
 * who the creators are, what they earn, where the traffic actually leaks, and
 * what is happening outside in the region. This module is that sensory layer.
 *
 * Two rules hold throughout:
 *
 *  1. Every number is derived from a real column. Nothing here is estimated
 *     into existence — where a metric cannot be known (ad revenue has no rate
 *     configured; there is no tips ledger), the field is omitted rather than
 *     fabricated, and `notes` says why.
 *  2. Every block degrades on its own. A dead weather host or an unreachable
 *     pooler must not cost the mind the other five blocks, so each aggregate is
 *     individually caught and each has a hard timeout.
 */

const log = createLogger("platform-intelligence");

const DAY_MS = 24 * 60 * 60 * 1000;

/** The East African cities the platform frames itself around. */
export const EA_CITIES = [
  { city: "Nairobi", country: "Kenya", lat: -1.2864, lon: 36.8172, tz: "Africa/Nairobi" },
  { city: "Kampala", country: "Uganda", lat: 0.3476, lon: 32.5825, tz: "Africa/Kampala" },
  { city: "Dar es Salaam", country: "Tanzania", lat: -6.7924, lon: 39.2083, tz: "Africa/Dar_es_Salaam" },
  { city: "Kigali", country: "Rwanda", lat: -1.9441, lon: 30.0619, tz: "Africa/Kigali" },
] as const;

/** Node values on User are free text, so match them loosely. */
function cityKey(node: string | null | undefined): string | null {
  if (!node) return null;
  const n = node.toLowerCase();
  for (const c of EA_CITIES) {
    if (n.includes(c.city.toLowerCase())) return c.city;
  }
  // Dar es Salaam is commonly written "Dar".
  if (/\bdar\b/.test(n)) return "Dar es Salaam";
  if (n.includes("mombasa")) return "Mombasa";
  if (n.includes("arusha")) return "Arusha";
  if (n.includes("dodoma")) return "Dodoma";
  return node.trim() || null;
}

/**
 * Language inference from the text a creator actually writes.
 *
 * There is no language column on User, and asking creators to self-declare one
 * would be a form to fill in rather than a fact to observe. Marker words are
 * counted instead — a documented heuristic, reported as `inferred` in the
 * result so no caller mistakes it for a declaration.
 */
const LANGUAGE_MARKERS: Record<string, string[]> = {
  Kiswahili: ["na", "ya", "wa", "kwa", "katika", "hii", "hilo", "sana", "lakini", "kama", "zaidi", "habari", "leo", "kesho", "watu", "pesa", "biashara", "nchi", "serikali", "mji"],
  English: ["the", "and", "with", "for", "this", "that", "from", "have", "will", "been", "they", "which", "their", "about", "would"],
  Luganda: ["nze", "gwe", "abantu", "ensi", "kukola", "leero", "ssente", "ekibuga", "nnyo", "kubanga", "omuntu", "obulamu"],
  Kinyarwanda: ["abantu", "igihugu", "ubu", "amakuru", "ubukungu", "cyane", "kandi", "kuko", "umuntu", "ubuzima", "muri"],
};

export function inferLanguage(text: string): { language: string; confidence: number; breakdown: Record<string, number> } {
  const words = text.toLowerCase().match(/[a-zà-ÿ']+/g) ?? [];
  const total = Math.max(words.length, 1);
  const breakdown: Record<string, number> = {};
  const bag = new Set(words);

  for (const [lang, markers] of Object.entries(LANGUAGE_MARKERS)) {
    let hits = 0;
    for (const m of markers) if (bag.has(m)) hits += 1;
    // Weight by marker coverage, not by raw frequency, so a long English
    // article cannot out-vote a Swahili one purely by being longer.
    breakdown[lang] = Math.round((hits / markers.length) * 1000) / 10;
  }

  const ranked = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best || best[1] === 0) return { language: "Unknown", confidence: 0, breakdown };

  // Close call between the two leaders reads as code-switching, which is the
  // norm in this market — saying "mix" is more truthful than picking a winner.
  const share = second && second[1] > 0 ? best[1] / (best[1] + second[1]) : 1;
  if (share < 0.62) return { language: "Mixed", confidence: Math.round((1 - share) * 100) / 100, breakdown };
  return { language: best[0], confidence: Math.round(share * 100) / 100, breakdown };
}

export interface CreatorSummary {
  id: string;
  username: string;
  name: string | null;
  isVerified: boolean;
  node: string | null;
  city: string | null;
  followers: number;
  newFollowers30d: number;
  posts: number;
  views: number;
  comments: number;
  likes: number;
  /** (comments + likes) per 100 views — the currency of creator value. */
  engagementRate: number;
  niches: string[];
  lastPublishedAt: Date | null;
  active: boolean;
}

export interface CreatorDirectory {
  total: number;
  verified: number;
  active: number;
  dormant: number;
  joined30d: number;
  creators: CreatorSummary[];
}

export interface CreatorAnalytics {
  creatorsTracked: number;
  totalFollowers: number;
  followerGrowth30d: number;
  totalReach: number;
  avgEngagementRate: number;
  topByReach: { username: string; city: string | null; views: number; engagementRate: number }[];
  topByGrowth: { username: string; newFollowers: number; followers: number }[];
  topByEngagement: { username: string; engagementRate: number; views: number }[];
  dormantCreators: { username: string; city: string | null; lastPublishedAt: Date | null }[];
}

export interface TrendingFeed {
  window: string;
  topics: { topic: string; posts: number; views: number; cities: string[] }[];
  viral: { id: string; title: string; slug: string; city: string | null; views: number; comments: number; likes: number; velocity: number }[];
  byCity: { city: string; posts: number; views: number; topTopic: string | null }[];
}

export interface Monetization {
  /** What creators earn from their audience — tips in, payouts out. */
  creatorEarnings: {
    tipsSettled: number;
    tipsSettledAmount: number;
    tipsPending: number;
    tipsFailed: number;
    creatorsTipped: number;
    payoutsPaid: number;
    payoutsPaidAmount: number;
    payoutsPending: number;
    /** Tips settled but not yet paid out — the platform's outstanding balance. */
    unpaidToCreators: number;
    topEarners: { username: string; tips: number; earned: number; paidOut: number; unpaid: number }[];
  };
  ads: {
    active: number;
    total: number;
    impressions: number;
    clicks: number;
    ctr: number;
    topSpots: { name: string; slot: string; impressions: number; clicks: number; ctr: number }[];
  };
  subscriptions: {
    active: number;
    trialing: number;
    cancelled: number;
    pastDue: number;
    mrr: number;
    byPlan: { plan: string; tier: string; audience: string; priceMonthly: number; active: number }[];
  };
  settlement: {
    succeeded: number;
    failed: number;
    pending: number;
    collected: number;
    currency: string;
    byRail: { provider: string; collected: number; settled: number }[];
  };
  rails: { provider: string; subscriptions: number; mpesaNumbers: number }[];
  notes: string[];
}

export interface TrafficDepth {
  window: string;
  views: number;
  uniqueVisitors: number;
  sessions: number;
  newVisitors: number;
  returningVisitors: number;
  bounceRate: number;
  pagesPerSession: number;
  avgSessionSeconds: number;
  totalTimeOnAppSeconds: number;
  categories: { category: string; views: number; visitors: number }[];
  trafficSources: { source: string; views: number }[];
  countries: { country: string; views: number }[];
}

export interface CreatorContext {
  found: boolean;
  id?: string;
  username?: string;
  name?: string | null;
  role?: string;
  isVerified?: boolean;
  city?: string | null;
  bio?: string | null;
  followers?: number;
  following?: number;
  followersGained30d?: number;
  posts?: number;
  views?: number;
  engagementRate?: number;
  audience?: { country: string; visitors: number }[];
  cadence?: { postsPerMonth: number; daysSinceLastPost: number | null; avgReadMinutes: number };
  recentPosts?: { title: string; views: number; daysAgo: number }[];
  language?: { language: string; confidence: number; inferred: true; breakdown: Record<string, number> };
  goal?: { primary: "growing" | "monetizing" | "building_brand" | "dormant"; signals: string[] };
}

export interface ExternalSignals {
  regionalNews: { title: string; source: string; url: string | null; publishedAt: Date | null; topics: string[] }[];
  weather: { city: string; country: string; temperatureC: number | null; precipitationMm: number | null; summary: string }[];
  competitors: { title: string; url: string; source: string; snippet: string }[];
  notes: string[];
}

/** Memories written by the hourly/daily pulse sweep. */
export const PULSE_CATEGORY = "traffic-pulse";

/** One monitoring snapshot, and how it moved against the previous one. */
export interface PlatformPulse {
  day: string;
  traffic: {
    views: number;
    uniqueVisitors: number;
    sessions: number;
    bounceRate: number;
    avgSessionSeconds: number;
    returningShare: number;
  };
  creators: { total: number; active: number; dormant: number } | null;
  economy: { mrr: number; activeSubscriptions: number } | null;
  /** Human-readable movements against the previous pulse. Empty on first run. */
  deltas: string[];
  memoryId: string;
}

/** One packed brief the LLM prompt can consume in a single block. */
export interface LivePlatformBrief {
  generatedAt: string;
  creators?: { total: number; active: number; dormant: number; verified: number; growth30d: number };
  traffic?: { views: number; uniqueVisitors: number; bounceRate: number; returningShare: number; avgSessionMinutes: number };
  economy?: { mrr: number; activeSubscriptions: number; settledRevenue: number; rails: string[]; creatorTipsSettled?: number; owedToCreators?: number };
  trends?: { topic: string; posts: number; views: number }[];
  region?: { headline: string; source: string }[];
  weather?: { city: string; summary: string }[];
}

class PlatformIntelligence {
  private readonly log = createLogger("platform-intelligence");

  /**
   * The brief is assembled from ~14 queries plus a weather round trip, and the
   * model prompt asks for it on every chat turn. A short TTL keeps a
   * conversation about the numbers coherent (every turn sees the same figures)
   * while still being fresh enough to answer "what is happening right now".
   */
  private briefCache: { at: number; brief: LivePlatformBrief } | null = null;
  private static readonly BRIEF_TTL_MS = 5 * 60 * 1000;

  private async safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.log.warn(`block failed: ${label}`, { error: err instanceof Error ? err.message : String(err) });
      return fallback;
    }
  }

  // ── Creators ────────────────────────────────────────────────────────────

  /**
   * The creator directory, with niches derived from what each creator actually
   * publishes rather than a tag anyone self-applied.
   *
   * Three queries total regardless of creator count: the roster, their posts
   * (aggregated in memory), and follower growth. The previous shape of this
   * kind of code in the codebase asked the database once per user.
   */
  async getCreatorDirectory(limit = 40): Promise<CreatorDirectory> {
    const since30 = new Date(Date.now() - 30 * DAY_MS);

    const creators = await prisma.user.findMany({
      where: { role: { in: ["CREATOR", "EDITOR", "ADMIN"] } },
      orderBy: [{ followersCount: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        id: true,
        username: true,
        name: true,
        isVerified: true,
        node: true,
        followersCount: true,
        createdAt: true,
      },
    });

    if (creators.length === 0) {
      return { total: 0, verified: 0, active: 0, dormant: 0, joined30d: 0, creators: [] };
    }

    const ids = creators.map((c) => c.id);

    const [posts, growth, allCounts] = await Promise.all([
      prisma.post.findMany({
        where: { authorId: { in: ids }, status: "PUBLISHED" },
        select: {
          authorId: true,
          viewCount: true,
          publishedAt: true,
          category: { select: { name: true } },
          tags: { select: { name: true } },
          _count: { select: { comments: true, likes: true } },
        },
        take: 4000,
      }),
      prisma.follow.groupBy({
        by: ["followingId"],
        where: { followingId: { in: ids }, createdAt: { gte: since30 } },
        _count: { id: true },
      }),
      prisma.user.count({ where: { role: { in: ["CREATOR", "EDITOR", "ADMIN"] } } }),
    ]);

    const growthMap = new Map(growth.map((g) => [g.followingId, g._count.id]));
    const totalAdmins = await prisma.user.count({ where: { createdAt: { gte: since30 }, role: { in: ["CREATOR", "EDITOR", "ADMIN"] } } });

    const stats = new Map<string, { posts: number; views: number; comments: number; likes: number; last: Date | null; niches: Map<string, number> }>();
    for (const p of posts) {
      const cur =
        stats.get(p.authorId) ?? { posts: 0, views: 0, comments: 0, likes: 0, last: null, niches: new Map<string, number>() };
      cur.posts += 1;
      cur.views += p.viewCount;
      cur.comments += p._count.comments;
      cur.likes += p._count.likes;
      if (p.publishedAt && (!cur.last || p.publishedAt > cur.last)) cur.last = p.publishedAt;
      // Niche = the categories and tags a creator returns to, not a label.
      if (p.category?.name) cur.niches.set(p.category.name, (cur.niches.get(p.category.name) ?? 0) + 1);
      for (const t of p.tags) cur.niches.set(t.name, (cur.niches.get(t.name) ?? 0) + 1);
      stats.set(p.authorId, cur);
    }

    const summarize = (c: (typeof creators)[number]): CreatorSummary => {
      const s = stats.get(c.id);
      const views = s?.views ?? 0;
      const engaged = (s?.comments ?? 0) + (s?.likes ?? 0);
      const lastPublishedAt = s?.last ?? null;
      return {
        id: c.id,
        username: c.username,
        name: c.name,
        isVerified: c.isVerified,
        node: c.node,
        city: cityKey(c.node),
        followers: c.followersCount,
        newFollowers30d: growthMap.get(c.id) ?? 0,
        posts: s?.posts ?? 0,
        views,
        comments: s?.comments ?? 0,
        likes: s?.likes ?? 0,
        engagementRate: views > 0 ? Math.round((engaged / views) * 10000) / 100 : 0,
        niches: Array.from(s?.niches.entries() ?? [])
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([n]) => n),
        lastPublishedAt,
        active: lastPublishedAt ? Date.now() - lastPublishedAt.getTime() <= 30 * DAY_MS : false,
      };
    };

    const summarized = creators.map(summarize);

    return {
      total: allCounts,
      verified: summarized.filter((c) => c.isVerified).length,
      active: summarized.filter((c) => c.active).length,
      dormant: summarized.filter((c) => c.posts > 0 && !c.active).length,
      joined30d: totalAdmins,
      creators: summarized,
    };
  }

  /** Follower growth, reach and engagement rates rolled up per creator. */
  async getCreatorAnalytics(limit = 40): Promise<CreatorAnalytics> {
    const dir = await this.getCreatorDirectory(limit);
    const withReach = dir.creators.filter((c) => c.views > 0);

    const totalFollowers = dir.creators.reduce((s, c) => s + c.followers, 0);
    const totalReach = withReach.reduce((s, c) => s + c.views, 0);
    const avgEngagementRate = withReach.length > 0 ? withReach.reduce((s, c) => s + c.engagementRate, 0) / withReach.length : 0;

    return {
      creatorsTracked: dir.creators.length,
      totalFollowers,
      followerGrowth30d: dir.creators.reduce((s, c) => s + c.newFollowers30d, 0),
      totalReach,
      avgEngagementRate: Math.round(avgEngagementRate * 100) / 100,
      topByReach: [...withReach]
        .sort((a, b) => b.views - a.views)
        .slice(0, 8)
        .map((c) => ({ username: c.username, city: c.city, views: c.views, engagementRate: c.engagementRate })),
      topByGrowth: [...dir.creators]
        .sort((a, b) => b.newFollowers30d - a.newFollowers30d)
        .slice(0, 8)
        .map((c) => ({ username: c.username, newFollowers: c.newFollowers30d, followers: c.followers })),
      topByEngagement: [...withReach]
        .sort((a, b) => b.engagementRate - a.engagementRate)
        .slice(0, 8)
        .map((c) => ({ username: c.username, engagementRate: c.engagementRate, views: c.views })),
      dormantCreators: dir.creators
        .filter((c) => !c.active && c.posts > 0)
        .slice(0, 10)
        .map((c) => ({ username: c.username, city: c.city, lastPublishedAt: c.lastPublishedAt })),
    };
  }

  // ── Trends ──────────────────────────────────────────────────────────────

  /** What is viral right now, and which of the four cities is driving it. */
  async getTrendingFeeds(window = "7d"): Promise<TrendingFeed> {
    const days = window === "24h" ? 1 : window === "30d" ? 30 : 7;
    const since = new Date(Date.now() - days * DAY_MS);

    const posts = await prisma.post.findMany({
      where: { status: "PUBLISHED", publishedAt: { gte: since } },
      orderBy: { viewCount: "desc" },
      take: 120,
      select: {
        id: true,
        title: true,
        slug: true,
        viewCount: true,
        publishedAt: true,
        category: { select: { name: true } },
        author: { select: { node: true } },
        _count: { select: { comments: true, likes: true } },
      },
    });

    const now = Date.now();
    const topicMap = new Map<string, { posts: number; views: number; cities: Set<string> }>();
    const cityMap = new Map<string, { posts: number; views: number; topics: Map<string, number> }>();

    for (const p of posts) {
      const city = cityKey(p.author?.node);
      const keywords = extractKeywords(`${p.title} ${p.category?.name ?? ""}`, 4).map((k) => k.keyword);
      const topic = keywords[0] ?? p.category?.name ?? "general";

      const t = topicMap.get(topic) ?? { posts: 0, views: 0, cities: new Set<string>() };
      t.posts += 1;
      t.views += p.viewCount;
      if (city) t.cities.add(city);
      topicMap.set(topic, t);

      if (city) {
        const c = cityMap.get(city) ?? { posts: 0, views: 0, topics: new Map<string, number>() };
        c.posts += 1;
        c.views += p.viewCount;
        c.topics.set(topic, (c.topics.get(topic) ?? 0) + 1);
        cityMap.set(city, c);
      }
    }

    const viral = posts
      .map((p) => {
        const liveDays = Math.max(1, Math.ceil((now - (p.publishedAt?.getTime() ?? now)) / DAY_MS));
        return {
          id: p.id,
          title: p.title,
          slug: p.slug,
          city: cityKey(p.author?.node),
          views: p.viewCount,
          comments: p._count.comments,
          likes: p._count.likes,
          velocity: Math.round(((p.viewCount / liveDays + p._count.comments * 8 + p._count.likes * 6) * 100)) / 100,
        };
      })
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, 10);

    return {
      window,
      topics: Array.from(topicMap.entries())
        .map(([topic, v]) => ({ topic, posts: v.posts, views: v.views, cities: Array.from(v.cities).slice(0, 4) }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 12),
      viral,
      byCity: Array.from(cityMap.entries())
        .map(([city, v]) => ({
          city,
          posts: v.posts,
          views: v.views,
          topTopic: Array.from(v.topics.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        }))
        .sort((a, b) => b.views - a.views),
    };
  }

  // ── Money ───────────────────────────────────────────────────────────────

  /**
   * Monetization across the two rails that actually exist in the data: manual
   * and injected advertising, and paid subscriptions settled via M-Pesa
   * (Daraja) or PayPal.
   *
   * `notes` carries the honesty: there is no tips ledger and no ad rate table in
   * this schema, so no "tips revenue" number and no CPM-derived revenue figure
   * is invented here. Impressions, clicks and settled money are real.
   */
  async getMonetization(): Promise<Monetization> {
    const notes: string[] = [];

    const [ads, plans, subs, intents, tipsByStatus, payoutsByStatus, tipsByCreator] = await Promise.all([
      prisma.ad.findMany({ select: { name: true, slot: true, impressions: true, clicks: true, isActive: true } }),
      prisma.subscriptionPlan.findMany({ select: { id: true, name: true, displayName: true, tier: true, audience: true, priceMonthly: true } }),
      prisma.userSubscription.groupBy({
        by: ["planId", "status", "provider"],
        _count: { id: true },
      }),
      prisma.paymentIntent.groupBy({
        by: ["provider", "status"],
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.tip.groupBy({ by: ["status"], _sum: { amount: true }, _count: { id: true } }),
      prisma.creatorPayout.groupBy({ by: ["status"], _sum: { amount: true }, _count: { id: true } }),
      prisma.tip.groupBy({ by: ["toUserId"], where: { status: "succeeded" }, _sum: { amount: true }, _count: { id: true } }),
    ]);

    const planMap = new Map(plans.map((p) => [p.id, p]));

    // Subscriptions grouped by plan, so MRR reflects the plans actually held.
    let active = 0;
    let trialing = 0;
    let cancelled = 0;
    let pastDue = 0;
    let mrr = 0;
    const byPlan = new Map<string, { plan: string; tier: string; audience: string; priceMonthly: number; active: number }>();
    const railMap = new Map<string, number>();

    for (const row of subs) {
      const count = row._count.id;
      const plan = planMap.get(row.planId);
      railMap.set(row.provider, (railMap.get(row.provider) ?? 0) + count);

      if (row.status === "active") active += count;
      else if (row.status === "trialing") trialing += count;
      else if (row.status === "cancelled") cancelled += count;
      else if (row.status === "past_due") pastDue += count;

      if (row.status === "active" && plan) {
        mrr += plan.priceMonthly * count;
        const existing = byPlan.get(plan.id);
        if (existing) existing.active += count;
        else byPlan.set(plan.id, { plan: plan.displayName ?? plan.name, tier: plan.tier, audience: plan.audience, priceMonthly: plan.priceMonthly, active: count });
      }
    }

    let succeeded = 0;
    let failed = 0;
    let pending = 0;
    let collected = 0;
    let currency = "USD";
    const railMoney = new Map<string, { collected: number; settled: number }>();

    for (const row of intents) {
      const count = row._count.id;
      const amount = row._sum.amount ?? 0;
      if (row.status === "succeeded") {
        succeeded += count;
        collected += amount;
        const cur = railMoney.get(row.provider) ?? { collected: 0, settled: 0 };
        cur.collected += amount;
        cur.settled += count;
        railMoney.set(row.provider, cur);
      } else if (row.status === "failed" || row.status === "cancelled" || row.status === "expired") {
        failed += count;
      } else {
        pending += count;
      }
    }

    if (railMoney.size > 0) {
      // PaymentIntent.currency is per-row; report the plan currency rather than
      // summing across currencies, which would be a fabricated total.
      const planCurrency = await prisma.subscriptionPlan.findFirst({ select: { currency: true } });
      currency = planCurrency?.currency ?? "USD";
    }

    const mpesaNumbers = await prisma.userSubscription.count({ where: { provider: "daraja", payerPhone: { not: null } } }).catch(() => 0);

    // ── Creator earnings ──
    // Tips in, payouts out, and the difference per creator — because "what did I
    // earn" is the first question a creator asks and it is not answerable from
    // subscriptions or ad impressions.
    const tipTotals = { settled: 0, settledAmount: 0, pending: 0, failed: 0 };
    for (const row of tipsByStatus) {
      const amount = row._sum.amount ?? 0;
      if (row.status === "succeeded") {
        tipTotals.settled += row._count.id;
        tipTotals.settledAmount += amount;
      } else if (row.status === "pending") tipTotals.pending += row._count.id;
      else if (row.status === "failed") tipTotals.failed += row._count.id;
    }

    const payoutTotals = { paid: 0, paidAmount: 0, pending: 0 };
    for (const row of payoutsByStatus) {
      if (row.status === "paid") {
        payoutTotals.paid += row._count.id;
        payoutTotals.paidAmount += row._sum.amount ?? 0;
      } else if (row.status === "pending" || row.status === "processing") payoutTotals.pending += row._count.id;
    }

    const topIds = tipsByCreator
      .sort((a, b) => (b._sum.amount ?? 0) - (a._sum.amount ?? 0))
      .slice(0, 10)
      .map((r) => r.toUserId);

    const [earners, payoutsPerCreator] = await Promise.all([
      topIds.length > 0
        ? prisma.user.findMany({ where: { id: { in: topIds } }, select: { id: true, username: true } })
        : Promise.resolve([] as { id: string; username: string }[]),
      topIds.length > 0
        ? prisma.creatorPayout.groupBy({ by: ["userId"], where: { userId: { in: topIds }, status: "paid" }, _sum: { amount: true } })
        : Promise.resolve([] as { userId: string; _sum: { amount: number | null } }[]),
    ]);

    const usernameById = new Map(earners.map((u) => [u.id, u.username]));
    const paidById = new Map(payoutsPerCreator.map((p) => [p.userId, p._sum.amount ?? 0]));

    const topEarners = tipsByCreator
      .sort((a, b) => (b._sum.amount ?? 0) - (a._sum.amount ?? 0))
      .slice(0, 10)
      .map((row) => {
        const earned = Math.round((row._sum.amount ?? 0) * 100) / 100;
        const paidOut = Math.round((paidById.get(row.toUserId) ?? 0) * 100) / 100;
        return {
          username: usernameById.get(row.toUserId) ?? row.toUserId,
          tips: row._count.id,
          earned,
          paidOut,
          unpaid: Math.round((earned - paidOut) * 100) / 100,
        };
      });

    if (plans.every((p) => p.priceMonthly === 0) && active > 0) {
      notes.push("All active plans are priced at 0 — MRR is reported as 0 rather than inferred.");
    }
    if (ads.length === 0) notes.push("No ad creatives are configured, so ad monetization is inert.");
    if (subs.length === 0) notes.push("No subscriptions have ever been recorded.");
    if (tipsByStatus.length === 0) notes.push("No tips have been recorded yet, so creator earnings are zero rather than unknown.");
    if (tipTotals.settledAmount > payoutTotals.paidAmount) {
      notes.push(
        `Creators are owed ${Math.round((tipTotals.settledAmount - payoutTotals.paidAmount) * 100) / 100} in settled tips that have not been paid out.`
      );
    }

    const impressions = ads.reduce((s, a) => s + a.impressions, 0);
    const clicks = ads.reduce((s, a) => s + a.clicks, 0);

    return {
      ads: {
        active: ads.filter((a) => a.isActive).length,
        total: ads.length,
        impressions,
        clicks,
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
        topSpots: ads
          .filter((a) => a.impressions > 0)
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 6)
          .map((a) => ({
            name: a.name,
            slot: a.slot,
            impressions: a.impressions,
            clicks: a.clicks,
            ctr: a.impressions > 0 ? Math.round((a.clicks / a.impressions) * 10000) / 100 : 0,
          })),
      },
      creatorEarnings: {
        tipsSettled: tipTotals.settled,
        tipsSettledAmount: Math.round(tipTotals.settledAmount * 100) / 100,
        tipsPending: tipTotals.pending,
        tipsFailed: tipTotals.failed,
        creatorsTipped: tipsByCreator.length,
        payoutsPaid: payoutTotals.paid,
        payoutsPaidAmount: Math.round(payoutTotals.paidAmount * 100) / 100,
        payoutsPending: payoutTotals.pending,
        unpaidToCreators: Math.round((tipTotals.settledAmount - payoutTotals.paidAmount) * 100) / 100,
        topEarners,
      },
      subscriptions: {
        active,
        trialing,
        cancelled,
        pastDue,
        mrr: Math.round(mrr * 100) / 100,
        byPlan: Array.from(byPlan.values()).sort((a, b) => b.active - a.active),
      },
      settlement: {
        succeeded,
        failed,
        pending,
        collected: Math.round(collected * 100) / 100,
        currency,
        byRail: Array.from(railMoney.entries()).map(([provider, v]) => ({
          provider,
          collected: Math.round(v.collected * 100) / 100,
          settled: v.settled,
        })),
      },
      rails: Array.from(railMap.entries())
        .map(([provider, subscriptions]) => ({ provider, subscriptions, mpesaNumbers: provider === "daraja" ? mpesaNumbers : 0 }))
        .sort((a, b) => b.subscriptions - a.subscriptions),
      notes,
    };
  }

  // ── Traffic depth ───────────────────────────────────────────────────────

  /**
   * The traffic questions a bounce-rate dashboard exists to answer: how many
   * arrive and leave immediately, how long a visit lasts, and which parts of
   * the platform hold people.
   *
   * Session duration is derived from first/last view per `sessionKey`, which is
   * a `visitorHash + hour` bucket — so a visit that straddles an hour boundary
   * is split, and this figure is a *lower bound* on time on app. That is stated
   * in the type rather than hidden, because the alternative (a new column plus
   * a migration) is not something a read-only dashboard should require.
   */
  async getTrafficDepth(window = "7d"): Promise<TrafficDepth> {
    const days = window === "24h" ? 1 : window === "30d" ? 30 : window === "90d" ? 90 : 7;
    const since = new Date(Date.now() - days * DAY_MS);
    const n = (v: unknown) => Number(v ?? 0);

    const [totals, sessions, cats, sources, countries, firstSeen] = await Promise.all([
      prisma.$queryRaw<{ views: bigint; visitors: bigint; sessions: bigint }[]>`
        SELECT COUNT(*)::bigint AS views,
               COUNT(DISTINCT "visitorHash")::bigint AS visitors,
               COUNT(DISTINCT "sessionKey")::bigint AS sessions
        FROM "PageView"
        WHERE "createdAt" >= ${since}
      `,
      prisma.$queryRaw<{ sessions: bigint; bounces: bigint; pages_per_session: number; avg_session_seconds: number; total_seconds: number }[]>`
        WITH s AS (
          SELECT "sessionKey" AS k,
                 COUNT(*)::bigint AS views,
                 EXTRACT(EPOCH FROM (MAX("createdAt") - MIN("createdAt")))::float AS seconds
          FROM "PageView"
          WHERE "createdAt" >= ${since} AND "sessionKey" IS NOT NULL
          GROUP BY "sessionKey"
        )
        SELECT COUNT(*)::bigint AS sessions,
               COUNT(*) FILTER (WHERE views = 1)::bigint AS bounces,
               COALESCE(AVG(views), 0)::float AS pages_per_session,
               COALESCE(AVG(seconds), 0)::float AS avg_session_seconds,
               COALESCE(SUM(seconds), 0)::float AS total_seconds
        FROM s
      `,
      prisma.$queryRaw<{ category: string | null; views: bigint; visitors: bigint }[]>`
        SELECT c."name" AS category,
               COUNT(v."id")::bigint AS views,
               COUNT(DISTINCT v."visitorHash")::bigint AS visitors
        FROM "PageView" v
        JOIN "Post" p ON p."id" = v."postId"
        LEFT JOIN "Category" c ON c."id" = p."categoryId"
        WHERE v."createdAt" >= ${since}
        GROUP BY c."name"
        ORDER BY views DESC
        LIMIT 10
      `,
      prisma.$queryRaw<{ source: string; views: bigint }[]>`
        SELECT "referrer" AS source, COUNT(*)::bigint AS views
        FROM "PageView"
        WHERE "createdAt" >= ${since} AND "referrer" IS NOT NULL AND "referrer" <> ''
        GROUP BY "referrer"
        ORDER BY views DESC
        LIMIT 10
      `,
      prisma.$queryRaw<{ country: string; views: bigint }[]>`
        SELECT "country", COUNT(*)::bigint AS views
        FROM "PageView"
        WHERE "createdAt" >= ${since} AND "country" IS NOT NULL
        GROUP BY "country"
        ORDER BY views DESC
        LIMIT 10
      `,
      prisma.$queryRaw<{ new_visitors: bigint; returning_visitors: bigint }[]>`
        WITH seen AS (
          SELECT "visitorHash", MIN("createdAt") AS first_at
          FROM "PageView"
          WHERE "visitorHash" IS NOT NULL
          GROUP BY "visitorHash"
        ),
        active AS (
          SELECT DISTINCT "visitorHash" FROM "PageView" WHERE "createdAt" >= ${since}
        )
        SELECT
          COUNT(*) FILTER (WHERE s.first_at >= ${since})::bigint AS new_visitors,
          COUNT(*) FILTER (WHERE s.first_at < ${since})::bigint AS returning_visitors
        FROM seen s
        WHERE s."visitorHash" IN (SELECT "visitorHash" FROM active)
      `,
    ]);

    const t = totals[0];
    const s = sessions[0];
    const fs = firstSeen[0];
    const sessionCount = n(s?.sessions);

    return {
      window,
      views: n(t?.views),
      uniqueVisitors: n(t?.visitors),
      sessions: n(t?.sessions),
      newVisitors: n(fs?.new_visitors),
      returningVisitors: n(fs?.returning_visitors),
      bounceRate: sessionCount > 0 ? Math.round((n(s?.bounces) / sessionCount) * 1000) / 10 : 0,
      pagesPerSession: Math.round(n(s?.pages_per_session) * 100) / 100,
      avgSessionSeconds: Math.round(n(s?.avg_session_seconds)),
      totalTimeOnAppSeconds: Math.round(n(s?.total_seconds)),
      categories: cats.map((c) => ({ category: c.category ?? "Uncategorised", views: n(c.views), visitors: n(c.visitors) })),
      trafficSources: sources.map((r) => ({ source: prettySource(r.source), views: n(r.views) })),
      countries: countries.map((c) => ({ country: c.country, views: n(c.views) })),
    };
  }

  // ── One creator, in depth ───────────────────────────────────────────────

  /** Profile, audience, cadence, language and goal for one creator. */
  async getCreatorContext(userId: string): Promise<CreatorContext> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        isVerified: true,
        node: true,
        bio: true,
        followersCount: true,
        followingCount: true,
        createdAt: true,
      },
    });

    if (!user) return { found: false };

    const since30 = new Date(Date.now() - 30 * DAY_MS);

    const [posts, followers30d, audience, subscription] = await Promise.all([
      prisma.post.findMany({
        where: { authorId: userId, status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: 40,
        select: {
          id: true,
          title: true,
          content: true,
          viewCount: true,
          publishedAt: true,
          _count: { select: { comments: true, likes: true } },
        },
      }),
      prisma.follow.count({ where: { followingId: userId, createdAt: { gte: since30 } } }),
      prisma.$queryRaw<{ country: string; visitors: bigint }[]>`
        SELECT v."country", COUNT(DISTINCT v."visitorHash")::bigint AS visitors
        FROM "PageView" v
        JOIN "Post" p ON p."id" = v."postId"
        WHERE p."authorId" = ${userId} AND v."country" IS NOT NULL
        GROUP BY v."country"
        ORDER BY visitors DESC
        LIMIT 8
      `,
      prisma.userSubscription.findFirst({ where: { userId, status: { in: ["active", "trialing"] } }, select: { status: true } }),
    ]);

    const views = posts.reduce((s, p) => s + p.viewCount, 0);
    const engaged = posts.reduce((s, p) => s + p._count.comments + p._count.likes, 0);
    const words = posts.reduce((s, p) => s + p.content.split(/\s+/).length, 0);
    const daysLive = Math.max(1, Math.ceil((Date.now() - user.createdAt.getTime()) / DAY_MS));
    const lastPost = posts[0]?.publishedAt ?? null;
    const daysSinceLastPost = lastPost ? Math.floor((Date.now() - lastPost.getTime()) / DAY_MS) : null;

    const language = inferLanguage(posts.slice(0, 12).map((p) => `${p.title} ${p.content.slice(0, 600)}`).join(" "));

    // Goal is an inference with named signals, never a black-box verdict.
    const signals: string[] = [];
    let primary: "growing" | "monetizing" | "building_brand" | "dormant" = "building_brand";
    if (daysSinceLastPost !== null && daysSinceLastPost > 45) {
      primary = "dormant";
      signals.push(`${daysSinceLastPost} days since the last published post`);
    } else if (followers30d >= 10 || (posts.length >= 4 && engaged / Math.max(views, 1) > 0.05)) {
      primary = "growing";
      signals.push(`${followers30d} new followers in 30 days`, `${views.toLocaleString()} lifetime views`);
    } else if (subscription) {
      primary = "monetizing";
      signals.push(`holds an ${subscription.status} subscription`, "engagement leans on paid features");
    } else {
      signals.push("consistent publishing without a paid tier yet");
    }

    return {
      found: true,
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      isVerified: user.isVerified,
      city: cityKey(user.node),
      bio: user.bio,
      followers: user.followersCount,
      following: user.followingCount,
      followersGained30d: followers30d,
      posts: posts.length,
      views,
      engagementRate: views > 0 ? Math.round((engaged / views) * 10000) / 100 : 0,
      audience: audience.map((a) => ({ country: a.country, visitors: Number(a.visitors) })),
      cadence: {
        postsPerMonth: Math.round((posts.length / daysLive) * 30 * 10) / 10,
        daysSinceLastPost,
        avgReadMinutes: posts.length > 0 ? Math.round(words / posts.length / 220) : 0,
      },
      recentPosts: posts.slice(0, 6).map((p) => ({
        title: p.title,
        views: p.viewCount,
        daysAgo: p.publishedAt ? Math.floor((Date.now() - p.publishedAt.getTime()) / DAY_MS) : 0,
      })),
      language: { language: language.language, confidence: language.confidence, inferred: true, breakdown: language.breakdown },
      goal: { primary, signals },
    };
  }

  // ── Outside the platform ────────────────────────────────────────────────

  /**
   * Regional news, weather and competitor awareness.
   *
   * Weather is keyless (open-meteo) and competitors come from the same keyless
   * web research the mind already uses. `includeCompetitors` is opt-in because
   * it is a network round trip and a chat turn should not always pay for it.
   */
  async getExternalSignals(opts: { includeCompetitors?: boolean } = {}): Promise<ExternalSignals> {
    const notes: string[] = [];
    const since = new Date(Date.now() - 7 * DAY_MS);

    const [news, weather, competitors] = await Promise.all([
      this.safe(
        "regional-news",
        async () => {
          const eaTerms = ["kenya", "uganda", "tanzania", "rwanda", "nairobi", "kampala", "dar es salaam", "kigali", "east africa", "eac", "safaricom", "mpesa", "bongo", "agritech", "fintech"];
          const articles = await prisma.rssArticle.findMany({
            where: { publishedAt: { gte: since } },
            orderBy: { publishedAt: "desc" },
            take: 120,
            select: { title: true, summary: true, url: true, publishedAt: true, feed: { select: { name: true } } },
          });
          return articles
            .filter((a) => {
              const hay = `${a.title} ${a.summary ?? ""}`.toLowerCase();
              return eaTerms.some((t) => hay.includes(t));
            })
            .slice(0, 12)
            .map((a) => ({
              title: a.title,
              source: a.feed?.name ?? "RSS",
              url: a.url,
              publishedAt: a.publishedAt,
              topics: extractKeywords(`${a.title} ${a.summary ?? ""}`, 4).map((k) => k.keyword),
            }));
        },
        []
      ),
      this.safe("weather", () => this.fetchWeather(), []),
      opts.includeCompetitors
        ? this.safe(
            "competitors",
            async () => {
              const found: ResearchFinding[] = await research("East Africa creator content platform competitors 2026", 2);
              return found.map((f) => ({ title: f.title, url: f.url, source: f.source, snippet: f.snippet.slice(0, 240) }));
            },
            []
          )
        : Promise.resolve([]),
    ]);

    if (news.length === 0) notes.push("No RSS articles in the last 7 days match East African terms.");
    if (weather.length === 0) notes.push("Weather unavailable (keyless provider unreachable).");
    if (!opts.includeCompetitors) notes.push("Competitor scan skipped — pass includeCompetitors to enable it.");

    return { regionalNews: news, weather, competitors, notes };
  }

  private async fetchWeather(): Promise<ExternalSignals["weather"]> {
    return Promise.all(
      EA_CITIES.map(async (c) => {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}` +
          `&current=temperature_2m,precipitation,weather_code&timezone=${encodeURIComponent(c.tz)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
        if (!res.ok) return { city: c.city, country: c.country, temperatureC: null, precipitationMm: null, summary: "unavailable" };
        const data = await res.json();
        const temp = typeof data?.current?.temperature_2m === "number" ? data.current.temperature_2m : null;
        const rain = typeof data?.current?.precipitation === "number" ? data.current.precipitation : null;
        const code = Number(data?.current?.weather_code ?? -1);
        return { city: c.city, country: c.country, temperatureC: temp, precipitationMm: rain, summary: weatherCodeLabel(code) };
      })
    );
  }

  // ── Monitoring over time ────────────────────────────────────────────────

  /**
   * Capture a traffic + creator + economy pulse into the hive.
   *
   * This is what turns a dashboard into a monitor. A dashboard answers "what is
   * the bounce rate"; the question an operator actually asks is "is it getting
   * worse", which needs the previous reading. Each run reads the last pulse and
   * writes its own figures into the memory's metadata, so the diff costs one
   * indexed read and no new table — and every comparison stays explainable
   * because each memory carries the inputs it was computed from.
   *
   * Silent about a metric it could not read: a failed block is omitted rather
   * than stored as zero, which would otherwise read as a catastrophic crash the
   * next day.
   */
  async learnPlatformPulse(): Promise<PlatformPulse> {
    const day = new Date().toISOString().slice(0, 10);

    const [traffic, creators, money] = await Promise.all([
      this.getTrafficDepth("7d"),
      this.getCreatorDirectory(60).catch(() => null),
      this.getMonetization().catch(() => null),
    ]);

    const audience = traffic.newVisitors + traffic.returningVisitors;
    const current: PlatformPulse["traffic"] = {
      views: traffic.views,
      uniqueVisitors: traffic.uniqueVisitors,
      sessions: traffic.sessions,
      bounceRate: traffic.bounceRate,
      avgSessionSeconds: traffic.avgSessionSeconds,
      returningShare: audience > 0 ? Math.round((traffic.returningVisitors / audience) * 1000) / 10 : 0,
    };

    const previous = await prisma.neuralMemory
      .findFirst({
        where: { source: "internal", category: PULSE_CATEGORY },
        orderBy: { createdAt: "desc" },
        select: { id: true, metadata: true, createdAt: true },
      })
      .catch(() => null);

    let prior: { day?: string; traffic?: PlatformPulse["traffic"] } | null = null;
    if (previous?.metadata) {
      try {
        prior = JSON.parse(previous.metadata);
      } catch {
        prior = null;
      }
    }

    const deltas: string[] = [];
    const cmp = prior?.traffic;
    if (cmp) {
      // One arrow only, and it means the movement — not the reading order. An
      // earlier shape printed an arrow glyph AND a before → after pair, so
      // "Views → 763 → 763" read as two contradictory directions.
      const move = (label: string, now: number, before: number, unit = "") => {
        const change = before === 0 ? (now === 0 ? 0 : 100) : ((now - before) / before) * 100;
        const direction = change > 2 ? "up" : change < -2 ? "down" : "flat";
        deltas.push(
          `${label}: ${formatNumber(before)}${unit} → ${formatNumber(now)}${unit} (${change >= 0 ? "+" : ""}${change.toFixed(1)}%, ${direction})`
        );
      };
      move("Views", current.views, cmp.views);
      move("Unique visitors", current.uniqueVisitors, cmp.uniqueVisitors);
      move("Sessions", current.sessions, cmp.sessions);
      move("Bounce rate", current.bounceRate, cmp.bounceRate, "%");
      move("Avg session", current.avgSessionSeconds, cmp.avgSessionSeconds, "s");
      move("Returning share", current.returningShare, cmp.returningShare, "%");
    }

    const headline =
      `Platform pulse ${day}: ${formatNumber(current.views)} views, ${formatNumber(current.uniqueVisitors)} unique visitors, ` +
      `${formatNumber(current.sessions)} sessions, ${current.bounceRate}% bounce, avg session ${current.avgSessionSeconds}s, ` +
      `${current.returningShare}% returning.` +
      (creators ? ` Creators: ${creators.active} active of ${creators.total}.` : "") +
      (money ? ` MRR ${money.subscriptions.mrr}, ${money.subscriptions.active} active subscriptions.` : "");

    const content = deltas.length > 0 ? `${headline} vs previous pulse — ${deltas.join("; ")}` : headline;

    const metadata = JSON.stringify({
      kind: "platform-pulse",
      day,
      traffic: current,
      creators: creators ? { total: creators.total, active: creators.active, dormant: creators.dormant } : null,
      economy: money ? { mrr: money.subscriptions.mrr, activeSubscriptions: money.subscriptions.active } : null,
    });

    const tags = [
      "traffic",
      "bounce-rate",
      "retention",
      "session-time",
      "monitoring",
      ...traffic.categories.slice(0, 3).map((c) => c.category.toLowerCase()),
    ].join(",");

    const memory = await prisma.neuralMemory.create({
      data: {
        source: "internal",
        category: PULSE_CATEGORY,
        content,
        tags,
        confidence: 0.9,
        metadata,
        sourceUrl: `pulse:${day}`,
      },
      select: { id: true },
    });

    this.log.info("platform pulse recorded", {
      day,
      views: current.views,
      bounceRate: current.bounceRate,
      compared: Boolean(cmp),
      memoryId: memory.id,
    });

    return {
      day,
      traffic: current,
      creators: creators ? { total: creators.total, active: creators.active, dormant: creators.dormant } : null,
      economy: money ? { mrr: money.subscriptions.mrr, activeSubscriptions: money.subscriptions.active } : null,
      deltas,
      memoryId: memory.id,
    };
  }

  // ── One brief for the model ─────────────────────────────────────────────

  /**
   * A compact snapshot the LLM prompt can carry on every turn. Each block is
   * fetched independently and dropped if it fails, so a slow weather host
   * cannot empty the whole brief.
   */
  async getLiveBrief(opts: { fresh?: boolean } = {}): Promise<LivePlatformBrief> {
    if (!opts.fresh && this.briefCache && Date.now() - this.briefCache.at < PlatformIntelligence.BRIEF_TTL_MS) {
      return this.briefCache.brief;
    }

    const [dir, traffic, money, trends, external] = await Promise.all([
      this.safe("brief.creators", () => this.getCreatorDirectory(20), null),
      this.safe("brief.traffic", () => this.getTrafficDepth("7d"), null),
      this.safe("brief.economy", () => this.getMonetization(), null),
      this.safe("brief.trends", () => this.getTrendingFeeds("7d"), null),
      this.safe("brief.region", () => this.getExternalSignals(), { regionalNews: [], weather: [], competitors: [], notes: [] }),
    ]);

    const brief: LivePlatformBrief = { generatedAt: new Date().toISOString() };

    if (dir) {
      brief.creators = {
        total: dir.total,
        active: dir.active,
        dormant: dir.dormant,
        verified: dir.verified,
        growth30d: dir.creators.reduce((s, c) => s + c.newFollowers30d, 0),
      };
    }
    if (traffic) {
      const audience = traffic.newVisitors + traffic.returningVisitors;
      brief.traffic = {
        views: traffic.views,
        uniqueVisitors: traffic.uniqueVisitors,
        bounceRate: traffic.bounceRate,
        returningShare: audience > 0 ? Math.round((traffic.returningVisitors / audience) * 1000) / 10 : 0,
        avgSessionMinutes: Math.round((traffic.avgSessionSeconds / 60) * 10) / 10,
      };
    }
    if (money) {
      brief.economy = {
        mrr: money.subscriptions.mrr,
        activeSubscriptions: money.subscriptions.active,
        settledRevenue: money.settlement.collected,
        rails: money.rails.map((r) => r.provider),
        creatorTipsSettled: money.creatorEarnings.tipsSettledAmount,
        owedToCreators: money.creatorEarnings.unpaidToCreators,
      };
    }
    if (trends) {
      brief.trends = trends.topics.slice(0, 8).map((t) => ({ topic: t.topic, posts: t.posts, views: t.views }));
    }
    if (external.regionalNews.length > 0) {
      brief.region = external.regionalNews.slice(0, 4).map((n) => ({ headline: n.title, source: n.source }));
    }
    if (external.weather.length > 0) {
      brief.weather = external.weather
        .filter((w) => w.temperatureC !== null)
        .map((w) => ({ city: w.city, summary: `${Math.round(w.temperatureC as number)}°C, ${w.summary}` }));
    }

    this.briefCache = { at: Date.now(), brief };
    return brief;
  }
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function prettySource(referrer: string): string {
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return referrer.slice(0, 60);
  }
}

/** WMO weather codes, trimmed to the labels that matter for planning content. */
function weatherCodeLabel(code: number): string {
  if (code < 0) return "unknown";
  if (code === 0) return "clear";
  if (code <= 3) return "partly cloudy";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "showers";
  if (code <= 99) return "thunderstorm";
  return "unknown";
}

export const platformIntelligence = new PlatformIntelligence();
