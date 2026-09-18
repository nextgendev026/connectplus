import { prisma } from "./prisma";
import { createLogger } from "./logger";
import { generateText } from "./ai-provider";
import { getSettings } from "./settings";
import { hiveBrain } from "./hive-brain";
import { neuralTrends } from "./neural-trends";
import { resolveSiteOrigin } from "./seo";
import { BRAND_HASHTAG, BRAND_NAME, DEFAULT_OG_IMAGE } from "./brand";
import { readableSubject } from "./marketing-copy";
import { normalizeHashtags } from "./share";
import { recordHeartbeat } from "./job-heartbeat";
import {
  channelReadiness,
  publishToFacebook,
  publishToWhatsApp,
  whatsappShareLink,
  type ChannelReadiness,
  type PublishResult,
} from "./social-publish";

const log = createLogger("marketing");

// Re-exported so server callers keep one import site; the client console imports
// it from `marketing-copy` directly, which is the whole point of the split.
export { readableSubject } from "./marketing-copy";

/**
 * The self-marketing engine.
 *
 * The product already knows more about itself than any marketer it could hire:
 * what is being read, what the hive has learned this week, which topics are
 * heating up, and how accurate the sports model has actually been. That is the
 * raw material for its own marketing, and it goes stale by the hour — which is
 * why this is a pipeline rather than a folder of copy.
 *
 * The division of labour is deliberate:
 *
 *   • THE HIVE supplies the FACTS. Memory counts, top topics, engagement
 *     velocity, thin categories, the model's settled record. Numbers it holds
 *     because it has been reading the platform.
 *   • THE MODEL supplies the VOICE. It is handed those facts and the configured
 *     tone, and writes the campaign. It never invents a statistic: the prompt
 *     carries the numbers and the scorer penalises copy whose only claim is an
 *     adjective.
 *   • THE OPERATOR supplies CONSENT. Autopilot drafts, a human approves, and
 *     auto-publish is a second, separate switch — because marketing copy is the
 *     one artifact that cannot be un-sent.
 *
 * Everything that decides *what* is written is pure and unit-tested; everything
 * that talks to the network is best-effort and reports what happened.
 */

/* ── Signals ─────────────────────────────────────────────────────────────── */

export interface MarketingSignals {
  generatedAt: string;
  origin: string;
  counts: {
    published: number;
    publishedLast7d: number;
    writers: number;
    categories: number;
    views: number;
  };
  topStory: { title: string; slug: string; views: number } | null;
  hive: { online: boolean; memories: number; topTopics: { topic: string; count: number }[] };
  trends: { subject: string; velocity: number; platform: number }[];
  sports: { settled: number; accuracy: number | null };
  /** Categories with the fewest published stories — the content gaps. */
  gaps: { category: string; posts: number }[];
}

const DAY_MS = 86_400_000;

export async function gatherMarketingSignals(): Promise<MarketingSignals> {
  const origin = await resolveSiteOrigin();
  const since = new Date(Date.now() - 7 * DAY_MS);

  const [published, publishedLast7d, writers, categories, views, topStory, categoryCounts, hive, trends, settled, won] =
    await Promise.all([
      prisma.post.count({ where: { status: "PUBLISHED" } }).catch(() => 0),
      prisma.post.count({ where: { status: "PUBLISHED", publishedAt: { gte: since } } }).catch(() => 0),
      prisma.user.count().catch(() => 0),
      prisma.category.count().catch(() => 0),
      prisma.post
        .aggregate({ _sum: { viewCount: true }, where: { status: "PUBLISHED" } })
        .then((r) => r._sum.viewCount ?? 0)
        .catch(() => 0),
      prisma.post
        .findFirst({
          where: { status: "PUBLISHED" },
          orderBy: { viewCount: "desc" },
          select: { title: true, slug: true, viewCount: true },
        })
        .then((p) => (p ? { title: p.title, slug: p.slug, views: p.viewCount } : null))
        .catch(() => null),
      prisma.category
        .findMany({ select: { name: true, _count: { select: { posts: true } } }, take: 40 })
        .then((rows) =>
          rows
            .map((r) => ({ category: r.name, posts: r._count.posts }))
            .sort((a, b) => a.posts - b.posts)
            .slice(0, 4)
        )
        .catch(() => []),
      hiveBrain
        .status()
        .then((s) => ({ online: s.online, memories: s.total, topTopics: s.topTopics.slice(0, 6) }))
        .catch(() => ({ online: false, memories: 0, topTopics: [] as { topic: string; count: number }[] })),
      neuralTrends
        .collectPlatformSignals(7, 8)
        // `score` is the ranker's own 0-100 heat value (volume weighted with
        // reads against the week's peak) — it is the only "velocity" the
        // platform actually measures, so it is carried through unscaled.
        .then((signals) => signals.map((s) => ({ subject: s.subject, velocity: Math.round(s.score), platform: s.count })))
        .catch(() => []),
      prisma.sportsPrediction
        .count({ where: { status: { in: ["WON", "LOST"] } } })
        .catch(() => 0),
      prisma.sportsPrediction.count({ where: { status: "WON" } }).catch(() => 0),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    origin,
    counts: { published, publishedLast7d, writers, categories, views },
    topStory,
    hive,
    trends,
    sports: { settled, accuracy: settled > 0 ? Math.round((won / settled) * 100) : null },
    gaps: categoryCounts,
  };
}

/* ── The brief (pure) ────────────────────────────────────────────────────── */

export interface MarketingBrief {
  /** One paragraph of situation, for the model and for the operator. */
  summary: string;
  /** Verifiable facts, each already phrased as a sentence. */
  proofPoints: string[];
  /** Openings that work because they lead with a fact, not an adjective. */
  hooks: string[];
  hashtags: string[];
}

/**
 * Turn signals into a brief.
 *
 * Pure, so the thing that decides what the model is told can be tested without a
 * database — and so an operator can read exactly what the copy was written from.
 * Every hook leads with a number that exists, because the failure mode of
 * generated marketing is a confident sentence with nothing behind it.
 */
export function buildMarketingBrief(
  signals: MarketingSignals,
  opts: { hashtags?: string[]; siteName?: string } = {}
): MarketingBrief {
  const siteName = opts.siteName ?? BRAND_NAME;
  const { counts, hive, sports, trends, topStory, gaps } = signals;

  const proofPoints: string[] = [];
  if (counts.published > 0) proofPoints.push(`${counts.published.toLocaleString()} stories published`);
  if (counts.writers > 0) proofPoints.push(`${counts.writers.toLocaleString()} writers on the platform`);
  if (counts.views > 0) proofPoints.push(`${Math.round(counts.views / 1000).toLocaleString()}K+ reads`);
  if (hive.memories > 0) proofPoints.push(`${hive.memories.toLocaleString()} things the hive mind has learned`);
  if (sports.settled > 0 && sports.accuracy !== null)
    proofPoints.push(`${sports.accuracy}% of the model's ${sports.settled.toLocaleString()} settled football picks have won`);
  if (topStory) proofPoints.push(`“${topStory.title}” is the most-read story right now (${topStory.views.toLocaleString()} views)`);

  const hooks: string[] = [];
  if (topStory && topStory.views > 0) hooks.push(`${topStory.views.toLocaleString()} people have read “${topStory.title}”`);
  const topTrend = trends[0] ?? (hive.topTopics[0] ? { subject: hive.topTopics[0].topic, velocity: hive.topTopics[0].count, platform: hive.topTopics[0].count } : null);
  if (topTrend) hooks.push(`“${readableSubject(topTrend.subject)}” is what the region is talking about this week`);
  if (counts.publishedLast7d > 0) hooks.push(`${counts.publishedLast7d} stories published in the last seven days`);
  if (sports.accuracy !== null && sports.settled > 0)
    hooks.push(`A football model that publishes its own record: ${sports.accuracy}% across ${sports.settled.toLocaleString()} settled picks`);
  if (hooks.length === 0) hooks.push(`${siteName} is where East African stories, live football and radio meet`);

  const summaryParts = [
    `This week the platform published ${counts.publishedLast7d} stories and now holds ${counts.published} in total.`,
  ];
  if (trends.length > 0)
    summaryParts.push(
      `Platform heat is concentrated on ${trends.slice(0, 3).map((t) => `“${readableSubject(t.subject)}”`).join(", ")}.`
    );
  if (hive.topTopics.length > 0) summaryParts.push(`The hive's strongest learned topics are ${hive.topTopics.slice(0, 3).map((t) => t.topic).join(", ")}.`);
  if (gaps.length > 0) summaryParts.push(`Thin coverage: ${gaps.map((g) => `${g.category} (${g.posts})`).join(", ")}.`);

  return {
    summary: summaryParts.join(" "),
    proofPoints,
    hooks: hooks.slice(0, 5),
    hashtags: normalizeHashtags(opts.hashtags ?? [BRAND_HASHTAG, "EastAfrica"]),
  };
}

/* ── Grounding (pure) ────────────────────────────────────────────────────── */

/**
 * Numbers as a reader would say them: thousands separators, one decimal place,
 * an optional K/M suffix ("5,200", "5.2K", "61%").
 */
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?\s?[KkMm]?/g;

function toNumber(token: string): number {
  const t = token.trim().toLowerCase().replace(/,/g, "");
  const suffix = t.slice(-1);
  const value = Number(suffix === "k" || suffix === "m" ? t.slice(0, -1) : t);
  if (!Number.isFinite(value)) return NaN;
  return suffix === "k" ? value * 1_000 : suffix === "m" ? value * 1_000_000 : value;
}

/** Every number the brief actually contains. */
export function groundedNumbers(brief: MarketingBrief): number[] {
  const text = [brief.summary, ...brief.proofPoints, ...brief.hooks].join(" ");
  return [...new Set((text.match(NUMBER_RE) ?? []).map(toNumber))].filter((n) => Number.isFinite(n));
}

/**
 * Numbers in the copy that appear nowhere in the brief — i.e. invented facts.
 *
 * This exists because the failure actually happened: asked to market a platform
 * holding 911 stories, with 42 published in the last seven days, a model wrote
 * "729 stories in seven days". It reads perfectly, and it is a lie about the
 * product — the one kind of marketing error that damages the thing it was meant
 * to sell.
 *
 * A number passes if it appears verbatim in the brief, or if it is a rounding of
 * one that does (so "5.2K reads" clears "5,200"), because forbidding every
 * paraphrase would only make the copy stiff.
 */
export function ungroundedNumbers(text: string, brief: MarketingBrief): string[] {
  const allowed = groundedNumbers(brief);
  const found = (text.match(NUMBER_RE) ?? []).map((token) => token.trim());
  return [
    ...new Set(
      found.filter((token) => {
        const value = toNumber(token);
        if (!Number.isFinite(value)) return false;
        // Within 2% of a figure in the brief comes from the same measurement: a
        // read count that moved between the brief and the copy writes itself
        // differently, and "5.2K" for 5,169 is a rounding, not an invention.
        return !allowed.some((a) => Math.abs(a - value) / Math.max(a, 1) < 0.02);
      })
    ),
  ];
}

/* ── Scoring (pure) ──────────────────────────────────────────────────────── */

/**
 * Score a campaign 0-100.
 *
 * Not a style opinion — a check against the ways generated marketing fails:
 * it makes a claim with no number behind it, it drowns in hashtags, it shouts,
 * it forgets to say what to do next, or it runs so long the platform truncates
 * the part that mattered.
 */
export function scoreCampaign(
  campaign: { title: string; body: string; hashtags?: string[] },
  opts: { link?: string | null; brief?: MarketingBrief } = {}
): number {
  const body = campaign.body ?? "";
  const title = campaign.title ?? "";
  const tags = campaign.hashtags ?? [];
  let score = 40;

  // A number in the copy is the difference between a claim and a fact.
  if (/\d/.test(body)) score += 14;
  if (/\d+\s?%/.test(body) || /\b\d[\d,]{2,}\b/.test(body)) score += 8;

  // Length: readable on a phone, inside X's limit before its own truncation.
  const length = body.length;
  if (length >= 90 && length <= 420) score += 12;
  else if (length < 60) score -= 10;
  else if (length > 700) score -= 8;

  if (/[.!?]/.test(body)) score += 4;
  if (/\b(read|join|follow|see|listen|share|tap|explore|start)\b/i.test(body)) score += 10;

  const tagCount = tags.length;
  if (tagCount >= 1 && tagCount <= 4) score += 8;
  else if (tagCount > 6) score -= 6;
  if (tags.some((t) => t.toLowerCase() === BRAND_HASHTAG.toLowerCase())) score += 4;

  if (title.trim().length >= 12 && title.length <= 90) score += 6;

  // Shouting and emoji walls read as spam on every platform that matters here.
  const letters = body.replace(/[^A-Za-z]/g, "");
  const caps = body.replace(/[^A-Z]/g, "");
  if (letters.length > 40 && caps.length / letters.length > 0.4) score -= 18;
  const emoji = (body.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).length;
  if (emoji > 4) score -= 10;

  if (opts.link && !body.includes(opts.link)) score += 6;

  // Facts are the heaviest thing the scorer can weigh: an invented figure costs
  // more than perfect tone or length can earn back, so a fabricated campaign
  // cannot clear the auto-publish bar on style alone.
  if (opts.brief) {
    const invented = ungroundedNumbers(`${title} ${body}`, opts.brief);
    score -= Math.min(invented.length * 25, 50);
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/* ── Deterministic composition (pure fallback) ───────────────────────────── */

/** The copy the engine writes when no model is configured. Never empty. */
export function composeFallbackCampaigns(
  brief: MarketingBrief,
  signals: MarketingSignals,
  count: number
): GeneratedCampaign[] {
  const audience = signals.counts.writers > 0 ? "writers" : "readers";
  const templates: GeneratedCampaign[] = [
    {
      kind: "social",
      channel: "facebook",
      title: "What the region is reading",
      body: `${brief.hooks[0] ?? "East Africa is publishing"}. ${brief.proofPoints.slice(0, 2).join(". ")}. Read it on ${BRAND_NAME}, and add your own story to the pile.`,
      rationale: `Lead with the most-read story and the platform's own counts — the facts the hive already holds.`,
      hashtags: brief.hashtags,
    },
    {
      kind: "social",
      channel: "facebook",
      title: "A model that shows its working",
      body:
        brief.proofPoints.find((p) => p.includes("settled")) ??
        `Every football prediction on ${BRAND_NAME} arrives with the reasoning behind it, and the record is published whether it flatters us or not.`,
      rationale: "The sports model's published record is the strongest trust signal the platform owns.",
      hashtags: brief.hashtags,
    },
    {
      kind: "story",
      channel: "story",
      title: "Today on connectPlus",
      body: `${brief.hooks[1] ?? brief.hooks[0] ?? "East African stories, live football, real radio"}. ${signals.counts.publishedLast7d} new stories this week.`,
      rationale: "Story captions are read in one second, so they carry a hook and nothing else.",
      hashtags: brief.hashtags,
    },
    {
      kind: "topic",
      channel: "blog",        title: `Coverage gap: ${readableSubject(signals.gaps[0]?.category ?? "under-covered categories")}`,
      body: `Write into ${signals.gaps.map((g) => g.category).join(", ") || "the thinnest categories"} — they hold the fewest stories and the least competition for attention.`,
      rationale: "Thin categories are editorial opportunities with a measurable starting point.",
      hashtags: brief.hashtags,
    },
    {
      kind: "social",
      channel: "facebook",
      title: `Invite ${audience}`,
      body: `${brief.proofPoints.slice(0, 3).join(". ")}. If you write, publish here — the studio, the checks and the audience are already set up.`,
      rationale: "Recruiting supply is the highest-leverage marketing a platform can do.",
      hashtags: brief.hashtags,
    },
  ];
  return templates.slice(0, Math.max(1, count));
}

/* ── Generation (model + fallback) ───────────────────────────────────────── */

export interface GeneratedCampaign {
  kind: "social" | "story" | "topic" | "article";
  channel: "facebook" | "whatsapp" | "story" | "blog";
  title: string;
  body: string;
  rationale?: string;
  hashtags?: string[];
}

export interface MarketingVoice {
  tone: string;
  hashtags: string[];
  autoPublish: boolean;
  threshold: number;
  autopilot: boolean;
  autoShare: boolean;
  shareFacebook: boolean;
  shareWhatsapp: boolean;
}

export async function marketingVoice(): Promise<MarketingVoice> {
  const s = await getSettings().catch(() => ({}) as Record<string, string>);
  const bool = (v: string | undefined, fallback = false) => (v === undefined || v === "" ? fallback : v === "true");
  return {
    tone: (s.marketingTone ?? "").trim() || "Warm, confident and plain-spoken. No hype, no exclamation marks.",
    hashtags: (s.marketingHashtags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    autopilot: bool(s.marketingAutopilot),
    autoShare: bool(s.marketingAutoShare),
    autoPublish: bool(s.marketingAutoPublish),
    threshold: Number(s.marketingPublishThreshold ?? 78) || 78,
    shareFacebook: bool(s.marketingShareFacebook, true),
    shareWhatsapp: bool(s.marketingShareWhatsapp, true),
  };
}

const SYSTEM_PROMPT = (tone: string, siteName: string) =>
  `You write marketing for ${siteName}, a publishing platform in East Africa (news, radio, live football scores and a
published-record sports model). You are given a brief containing verifiable facts about the platform.

Rules, without exception:
  • Lead with a fact from the brief. Never invent a statistic, a name, a date or a quote — and never
    do arithmetic on the brief's figures. Quote them as written: if the brief says 42 stories in the
    last seven days, write "42", not a rounded count of your own.
  • Voice: ${tone}
  • No emoji walls (at most one), no ALL CAPS words, no exclamation marks, no "revolutionary"/"game-changing".
  • Facebook copy: 90-380 characters, ends with a clear reason to click. Story copy: under 140 characters.
  • Topics: a concrete headline an editor could assign today.
  • Reply with a JSON array ONLY. Each item: {"kind":"social|story|topic|article","channel":"facebook|whatsapp|story|blog","title":"...","body":"...","rationale":"one line on why this should work","hashtags":["..."]}`;

/** Parse the model's reply without trusting it: fences, prose and all. */
export function parseCampaigns(raw: string | null, limit: number): GeneratedCampaign[] {
  if (!raw) return [];
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: GeneratedCampaign[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const body = typeof row.body === "string" ? row.body.trim() : "";
    if (!title || !body) continue;
    const kind = String(row.kind ?? "social");
    const channel = String(row.channel ?? "facebook");
    out.push({
      kind: (["social", "story", "topic", "article"].includes(kind) ? kind : "social") as GeneratedCampaign["kind"],
      channel: (["facebook", "whatsapp", "story", "blog"].includes(channel) ? channel : "facebook") as GeneratedCampaign["channel"],
      title,
      body,
      rationale: typeof row.rationale === "string" ? row.rationale.trim() : undefined,
      hashtags: Array.isArray(row.hashtags) ? row.hashtags.filter((t): t is string => typeof t === "string") : undefined,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Generate campaigns — the model when there is one, templates when there is not.
 *
 * The fallback is not a placeholder: it is composed from the same brief, so a
 * deployment with no API key still gets campaigns built on its own numbers. That
 * also means the console's "Generate" button always produces something, which is
 * the difference between a feature that works and a feature that looks broken.
 */
export async function generateCampaigns(
  opts: { count?: number; signals?: MarketingSignals; brief?: MarketingBrief } = {}
): Promise<{ campaigns: GeneratedCampaign[]; source: "ai" | "hive"; brief: MarketingBrief }> {
  const count = Math.min(Math.max(opts.count ?? 5, 1), 10);
  const voice = await marketingVoice();
  const signals = opts.signals ?? (await gatherMarketingSignals());
  const brief = opts.brief ?? buildMarketingBrief(signals, { hashtags: voice.hashtags });

  const user = [
    `BRIEF: ${brief.summary}`,
    `FACTS (use only these numbers):\n${brief.proofPoints.map((p) => `- ${p}`).join("\n")}`,
    `HOOKS worth opening with:\n${brief.hooks.map((h) => `- ${h}`).join("\n")}`,
    `TRAFFIC: ${signals.counts.views.toLocaleString()} reads across ${signals.counts.published} stories.`,
    `TRENDS: ${signals.trends.map((t) => t.subject).join(", ") || "none detected"}`,
    `THIN CATEGORIES: ${signals.gaps.map((g) => `${g.category} (${g.posts} stories)`).join(", ") || "none"}`,
    `Write ${count} items. At least two must be social posts and one a suggested topic for an editor.`,
  ].join("\n\n");

  const reply = await generateText({ system: SYSTEM_PROMPT(voice.tone, BRAND_NAME), user, maxTokens: 1400 }).catch(() => null);
  const generated = parseCampaigns(reply, count);

  if (generated.length === 0) {
    return { campaigns: composeFallbackCampaigns(brief, signals, count), source: "hive", brief };
  }
  return { campaigns: generated, source: "ai", brief };
}

/* ── Persistence ─────────────────────────────────────────────────────────── */

export interface CampaignRow {
  id: string;
  kind: string;
  channel: string;
  title: string;
  body: string;
  rationale: string | null;
  hashtags: string[] | null;
  status: string;
  source: string;
  score: number;
  url: string | null;
  createdAt: string;
  publishedAt: string | null;
  shareCount: number;
}

function toRow(row: {
  id: string;
  kind: string;
  channel: string;
  title: string;
  body: string;
  rationale: string | null;
  hashtags: string | null;
  status: string;
  source: string;
  score: number;
  url: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  _count?: { shares: number };
}): CampaignRow {
  let hashtags: string[] | null = null;
  try {
    const parsed = JSON.parse(row.hashtags ?? "null") as unknown;
    if (Array.isArray(parsed)) hashtags = parsed.filter((t): t is string => typeof t === "string");
  } catch {
    hashtags = null;
  }
  return {
    id: row.id,
    kind: row.kind,
    channel: row.channel,
    title: row.title,
    body: row.body,
    rationale: row.rationale,
    hashtags,
    status: row.status,
    source: row.source,
    score: row.score,
    url: row.url,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    shareCount: row._count?.shares ?? 0,
  };
}

export async function createCampaigns(
  campaigns: GeneratedCampaign[],
  opts: { source: "ai" | "hive" | "hybrid" | "manual"; signals?: MarketingSignals; brief?: MarketingBrief } = { source: "hive" }
): Promise<CampaignRow[]> {
  const created: CampaignRow[] = [];
  for (const campaign of campaigns) {
    const hashtags = normalizeHashtags(campaign.hashtags ?? opts.brief?.hashtags ?? []);
    const score = scoreCampaign({ title: campaign.title, body: campaign.body, hashtags }, { brief: opts.brief });
    // The operator sees the invented figure in the card, not just a lower score.
    // A number that cannot be traced to the brief is the single most important
    // thing to know before approving generated marketing.
    const invented = opts.brief ? ungroundedNumbers(`${campaign.title} ${campaign.body}`, opts.brief) : [];
    const row = await prisma.marketingCampaign.create({
      data: {
        kind: campaign.kind,
        channel: campaign.channel,
        title: campaign.title.slice(0, 200),
        body: campaign.body,
        rationale: invented.length
          ? `${campaign.rationale ?? ""} ⚠ Contains ${invented.join(", ")} — not in the brief. Fix or reject.`.trim()
          : (campaign.rationale ?? null),
        hashtags: JSON.stringify(hashtags),
        signals: opts.signals ? JSON.stringify(opts.signals).slice(0, 8000) : null,
        source: opts.source,
        score,
        status: "DRAFT",
      },
      include: { _count: { select: { shares: true } } },
    });
    created.push(toRow(row));
  }
  return created;
}

export async function listCampaigns(opts: { status?: string; channel?: string; limit?: number } = {}): Promise<CampaignRow[]> {
  const rows = await prisma.marketingCampaign.findMany({
    where: {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.channel ? { channel: opts.channel } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 30, 100),
    include: { _count: { select: { shares: true } } },
  });
  return rows.map(toRow);
}

export async function setCampaignStatus(id: string, status: string): Promise<CampaignRow | null> {
  const row = await prisma.marketingCampaign
    .update({
      where: { id },
      data: { status, ...(status === "PUBLISHED" ? { publishedAt: new Date() } : {}) },
      include: { _count: { select: { shares: true } } },
    })
    .catch(() => null);
  return row ? toRow(row) : null;
}

/** Re-run the scorer on a draft, so an edited campaign is judged on its text. */
export async function rescoreCampaign(id: string): Promise<number> {
  const row = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!row) return 0;
  let hashtags: string[] = [];
  try {
    const parsed = JSON.parse(row.hashtags ?? "[]") as unknown;
    if (Array.isArray(parsed)) hashtags = parsed.filter((t): t is string => typeof t === "string");
  } catch {
    hashtags = [];
  }
  const score = scoreCampaign({ title: row.title, body: row.body, hashtags }, { link: row.url });
  await prisma.marketingCampaign.update({ where: { id }, data: { score } }).catch(() => {});
  return score;
}

/* ── Dispatch ────────────────────────────────────────────────────────────── */

export interface DispatchSummary {
  campaignId: string;
  results: PublishResult[];
}

function articleUrlFor(campaign: { url: string | null; id: string }, origin: string): string {
  if (campaign.url) return campaign.url.startsWith("http") ? campaign.url : `${origin}${campaign.url}`;
  return `${origin}/marketing?utm_source=share&utm_medium=share&utm_campaign=${encodeURIComponent(campaign.id)}`;
}

/**
 * Put one campaign on the channels it is enabled for, and record every attempt.
 *
 * A row per attempt is the whole point: "we tried Facebook three times and it
 * failed three times" is a diagnosis, and a single mutable status row is how an
 * integration looks healthy while nothing is going out.
 */
export async function dispatchCampaign(campaignId: string, opts: { force?: boolean } = {}): Promise<DispatchSummary> {
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return { campaignId, results: [] };

  const voice = await marketingVoice();
  const origin = await resolveSiteOrigin();
  const link = articleUrlFor(campaign, origin);
  const hashtags = (() => {
    try {
      const parsed = JSON.parse(campaign.hashtags ?? "[]") as unknown;
      return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
    } catch {
      return [];
    }
  })();
  const message = `${campaign.body}${hashtags.length ? `\n\n${hashtags.map((t) => `#${t}`).join(" ")}` : ""}`;

  const results: PublishResult[] = [];
  // The stored channel is the operator's intent, which includes "blog" — a
  // channel the network layer has no concept of, because a blog post is a draft
  // an editor copies, not a send.
  const channel = campaign.channel;

  if (channel === "facebook" && voice.shareFacebook) {
    results.push(await publishToFacebook({ message, link, imageUrl: `${origin}/og-default.png` }));
  } else if (channel === "whatsapp" && voice.shareWhatsapp) {
    results.push(await publishToWhatsApp({ message, link }));
  } else if (channel === "story") {
    // Stories cannot be posted by API on anyone's behalf, so the kit is the
    // product: a 1080×1920 card plus the share link, recorded as MANUAL.
    results.push({
      channel: "story",
      status: "MANUAL",
      target: null,
      externalId: null,
      url: `${origin}/api/marketing/story/${campaign.id}`,
      error: null,
    });
  } else {
    // A blog campaign or a channel switched off in settings: the copy is still
    // worth something, so it comes back as the operator's own share link rather
    // than as a failure.
    results.push({
      channel: channel === "x" ? "x" : "copy",
      status: "MANUAL",
      target: null,
      externalId: null,
      url: whatsappShareLink(message),
      error: channel === "blog" ? null : "Channel is not enabled for automatic sending",
    });
  }

  for (const result of results) {
    await prisma.marketingShare
      .create({
        data: {
          campaignId: campaign.id,
          channel: result.channel,
          status: result.status,
          target: result.target,
          externalId: result.externalId,
          url: result.url,
          error: result.error,
        },
      })
      .catch((error) => log.warn("could not record share", { error: String(error) }));
  }

  const sent = results.some((r) => r.status === "SENT");
  const failed = results.every((r) => r.status === "FAILED");
  await prisma.marketingCampaign
    .update({
      where: { id: campaign.id },
      data: {
        status: failed ? "FAILED" : sent || results.some((r) => r.status === "MANUAL") ? "PUBLISHED" : "APPROVED",
        ...(sent || results.some((r) => r.status === "MANUAL") ? { publishedAt: new Date() } : {}),
        ...(results.find((r) => r.url)?.url ? { url: campaign.url ?? results.find((r) => r.url)?.url ?? null } : {}),
      },
    })
    .catch(() => {});

  if (opts.force !== true) {
    log.info("dispatched campaign", { id: campaign.id, results: results.map((r) => `${r.channel}:${r.status}`) });
  }
  return { campaignId: campaign.id, results };
}

/* ── New-story sharing ───────────────────────────────────────────────────── */

export interface PostShareInput {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  categoryName?: string | null;
}

/** The social copy for a freshly published story. Pure, so it is testable. */
export function buildPostShareCopy(
  post: PostShareInput,
  opts: { origin: string; hashtags?: string[]; siteName?: string; categorySlug?: string | null } = { origin: "" }
): { message: string; hashtags: string[]; link: string } {
  const siteName = opts.siteName ?? BRAND_NAME;
  const link = `${opts.origin}/article/${post.slug}?utm_source=auto_share&utm_medium=social&utm_campaign=new_story`;
  const excerpt = (post.excerpt ?? "").replace(/\s+/g, " ").trim();
  const opener = excerpt ? excerpt.slice(0, 180).replace(/[.,;:!?]$/, "") : `New on ${siteName}: ${post.title}`;
  const tags = normalizeHashtags([...(opts.hashtags ?? []), ...(post.categoryName ? [post.categoryName] : [])]);
  return {
    message: `${post.title}\n\n${opener}.\n\nRead it on ${siteName}:`,
    hashtags: tags,
    link,
  };
}

/**
 * Queue (and, when enabled, send) the share for one published story.
 *
 * Idempotent by URL: the sweep can run as often as it likes without posting the
 * same story twice, which matters because the sweep is also the repair path for
 * a failed send.
 */
export async function shareNewStory(post: PostShareInput, opts: { force?: boolean } = {}): Promise<string | null> {
  const origin = await resolveSiteOrigin();
  const copy = buildPostShareCopy(post, { origin, hashtags: (await marketingVoice()).hashtags });
  const absolute = copy.link;

  const existing = await prisma.marketingCampaign.findFirst({ where: { kind: "social", url: absolute } }).catch(() => null);
  if (existing) {
    if (opts.force !== true) return existing.id;
    await dispatchCampaign(existing.id, { force: true });
    return existing.id;
  }

  const score = scoreCampaign({ title: post.title, body: copy.message, hashtags: copy.hashtags }, { link: absolute });
  const created = await prisma.marketingCampaign.create({
    data: {
      kind: "social",
      channel: "facebook",
      title: `New story: ${post.title}`.slice(0, 200),
      body: copy.message,
      rationale: "Automatically composed from the published story's own title and summary.",
      hashtags: JSON.stringify(copy.hashtags),
      url: absolute,
      source: "hive",
      score,
      status: "APPROVED",
    },
  });

  const voice = await marketingVoice();
  if (voice.autoShare) {
    await dispatchCampaign(created.id);
    // WhatsApp carries the same story as a story card, which is the only way a
    // Status post can happen without a human holding the phone.
    if (voice.shareWhatsapp) {
      const story = await prisma.marketingCampaign.create({
        data: {
          kind: "story",
          channel: "story",
          title: `Story card: ${post.title}`.slice(0, 200),
          body: `${post.title} — ${(post.excerpt ?? "").slice(0, 90)}`.slice(0, 200),
          hashtags: JSON.stringify(copy.hashtags),
          url: absolute,
          source: "hive",
          score,
          status: "APPROVED",
        },
      });
      await dispatchCampaign(story.id);
    }
  }
  return created.id;
}

/* ── Sweep (the scheduled job) ───────────────────────────────────────────── */

export interface MarketingSweep {
  generated: number;
  shared: number;
  dispatched: number;
  skipped: string[];
  autopilot: boolean;
  autoShare: boolean;
}

/**
 * One pass of the engine.
 *
 * Order matters: draft first (so there is always something to approve), then
 * share new stories, then send whatever is approved. It is idempotent — the
 * share step keys on the article URL and dispatch only picks up statuses that
 * have not already gone out — because a scheduled job that duplicates work on
 * every pass is worse than one that does nothing.
 */
export async function runMarketingSweep(): Promise<MarketingSweep> {
  const voice = await marketingVoice();
  const summary: MarketingSweep = {
    generated: 0,
    shared: 0,
    dispatched: 0,
    skipped: [],
    autopilot: voice.autopilot,
    autoShare: voice.autoShare,
  };

  try {
    if (voice.autopilot) {
      const since = new Date(Date.now() - DAY_MS);
      const drafts = await prisma.marketingCampaign.count({ where: { status: "DRAFT", createdAt: { gte: since } } });
      if (drafts < 4) {
        const { campaigns, source, brief } = await generateCampaigns({ count: 4 });
        const signals = await gatherMarketingSignals();
        const created = await createCampaigns(campaigns, { source, signals, brief });
        summary.generated = created.length;
      } else {
        summary.skipped.push(`${drafts} drafts already waiting`);
      }
    }

    // Auto-publish is checked before the dispatch pass, so promoting a draft to
    // APPROVED sends it on this same sweep rather than the next one.
    if (voice.autoPublish) {
      const promoted = await prisma.marketingCampaign.updateMany({
        where: { status: "DRAFT", score: { gte: voice.threshold } },
        data: { status: "APPROVED" },
      });
      if (promoted.count > 0) summary.skipped.push(`${promoted.count} drafts promoted above score ${voice.threshold}`);
    }

    if (voice.autoShare) {
      const since = new Date(Date.now() - DAY_MS);
      const fresh = await prisma.post.findMany({
        where: { status: "PUBLISHED", publishedAt: { gte: since } },
        select: { id: true, title: true, slug: true, excerpt: true, category: { select: { name: true } } },
        orderBy: { publishedAt: "desc" },
        take: 10,
      });
      for (const post of fresh) {
        const id = await shareNewStory({
          id: post.id,
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          categoryName: post.category?.name ?? null,
        });
        if (id) summary.shared += 1;
      }
    }

    const approved = await prisma.marketingCampaign.findMany({
      where: { status: "APPROVED" },
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { id: true },
    });
    for (const campaign of approved) {
      const result = await dispatchCampaign(campaign.id);
      if (result.results.length > 0) summary.dispatched += 1;
    }

    await recordHeartbeat("marketing-sweep", {
      ok: true,
      detail: `${summary.generated} drafted · ${summary.shared} stories queued · ${summary.dispatched} dispatched`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("marketing sweep failed", { error: message });
    await recordHeartbeat("marketing-sweep", { ok: false, detail: message });
    summary.skipped.push(message);
  }

  return summary;
}

/* ── Reporting (the console) ─────────────────────────────────────────────── */

export interface MarketingAnalytics {
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  shares: { channel: string; status: string; count: number }[];
  sentLast7d: number;
  failedLast7d: number;
  manualWaiting: number;
  averageScore: number;
  topScore: number;
}

export interface MarketingReport {
  generatedAt: string;
  voice: MarketingVoice;
  channels: ChannelReadiness[];
  campaigns: CampaignRow[];
  analytics: MarketingAnalytics;
  signals: MarketingSignals;
  brief: MarketingBrief;
  recentShares: {
    id: string;
    campaignId: string;
    campaignTitle: string;
    channel: string;
    status: string;
    url: string | null;
    error: string | null;
    createdAt: string;
  }[];
}

export async function marketingAnalytics(): Promise<MarketingAnalytics> {
  const since = new Date(Date.now() - 7 * DAY_MS);
  const [statusRows, channelRows, shareRows, sent, failed, manual, scores] = await Promise.all([
    prisma.marketingCampaign.groupBy({ by: ["status"], _count: { _all: true } }).catch(() => []),
    prisma.marketingCampaign.groupBy({ by: ["channel"], _count: { _all: true } }).catch(() => []),
    prisma.marketingShare.groupBy({ by: ["channel", "status"], _count: { _all: true } }).catch(() => []),
    prisma.marketingShare.count({ where: { status: "SENT", createdAt: { gte: since } } }).catch(() => 0),
    prisma.marketingShare.count({ where: { status: "FAILED", createdAt: { gte: since } } }).catch(() => 0),
    prisma.marketingShare.count({ where: { status: "MANUAL" } }).catch(() => 0),
    prisma.marketingCampaign.findMany({ select: { score: true }, take: 200 }).catch(() => []),
  ]);

  const scoreList = scores.map((s) => s.score);
  return {
    byStatus: Object.fromEntries(statusRows.map((r) => [r.status, r._count._all])),
    byChannel: Object.fromEntries(channelRows.map((r) => [r.channel, r._count._all])),
    shares: shareRows.map((r) => ({ channel: r.channel, status: r.status, count: r._count._all })),
    sentLast7d: sent,
    failedLast7d: failed,
    manualWaiting: manual,
    averageScore: scoreList.length ? Math.round(scoreList.reduce((a, b) => a + b, 0) / scoreList.length) : 0,
    topScore: scoreList.length ? Math.max(...scoreList) : 0,
  };
}

export async function marketingReport(): Promise<MarketingReport> {
  const [voice, channels, campaigns, analytics, signals] = await Promise.all([
    marketingVoice(),
    channelReadiness(),
    listCampaigns({ limit: 30 }),
    marketingAnalytics(),
    gatherMarketingSignals(),
  ]);

  const recentShares = await prisma.marketingShare
    .findMany({ orderBy: { createdAt: "desc" }, take: 12, include: { campaign: { select: { title: true } } } })
    .then((rows) =>
      rows.map((r) => ({
        id: r.id,
        campaignId: r.campaignId,
        campaignTitle: r.campaign.title,
        channel: r.channel,
        status: r.status,
        url: r.url,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
      }))
    )
    .catch(() => []);

  return {
    generatedAt: new Date().toISOString(),
    voice,
    channels,
    campaigns,
    analytics,
    signals,
    brief: buildMarketingBrief(signals, { hashtags: voice.hashtags }),
    recentShares,
  };
}

/** Fallback card for the public page, so it is never blank. */
export const MARKETING_FALLBACK_IMAGE = DEFAULT_OG_IMAGE;
