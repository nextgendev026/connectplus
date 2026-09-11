import Parser from "rss-parser";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { autoTagPost } from "@/lib/auto-tag";
import { createLogger } from "@/lib/logger";
import { redisIncr } from "@/lib/redis";

const log = createLogger("rss-poll");

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; ConnectPlus RSS Reader/1.0)",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
});

/**
 * Feed transport hardening.
 *
 * The old path called `parser.parseURL()` directly, which meant: one attempt,
 * a timeout we could not observe, no conditional GET, and a parser bot UA that
 * several publishers throttle or 403. Worst of all, a failure was invisible —
 * the poll just returned 0 articles and the feed kept its previous timestamp,
 * so the admin console looked healthy while nothing was being ingested.
 *
 * Now every fetch is explicit: browser-ish UA, bounded timeout, one retry with
 * backoff, ETag/Last-Modified so an unchanged feed costs a 304 instead of the
 * whole document, and an outcome that is written back to the feed row.
 */
const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_ATTEMPTS = 2;
/** Per-poll cap on network OG-image lookups. Everything beyond this is handled
 * by recoverMissingThumbnails(), which runs on demand — polling 25 articles
 * used to fire 25 page downloads on every single cycle. */
const MAX_OG_LOOKUPS_PER_POLL = 3;

type FeedFetchStatus = "OK" | "NOT_MODIFIED" | "HTTP_ERROR" | "PARSE_ERROR" | "TIMEOUT" | "NETWORK_ERROR";

interface FeedFetchResult {
  status: FeedFetchStatus;
  xml?: string;
  error?: string;
  etag?: string | null;
  lastModified?: string | null;
  httpStatus?: number;
}

async function fetchFeedXml(feed: {
  url: string;
  httpEtag?: string | null;
  httpLastModified?: string | null;
}): Promise<FeedFetchResult> {
  let lastError = "";
  let lastStatus: FeedFetchStatus = "NETWORK_ERROR";

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        "User-Agent": FETCH_UA,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "Accept-Language": "en-US,en;q=0.9,sw;q=0.8",
        "Cache-Control": "no-cache",
      };
      if (feed.httpEtag) headers["If-None-Match"] = feed.httpEtag;
      if (feed.httpLastModified) headers["If-Modified-Since"] = feed.httpLastModified;

      const res = await fetch(feed.url, { signal: ctrl.signal, redirect: "follow", headers });
      clearTimeout(timer);

      if (res.status === 304) {
        return { status: "NOT_MODIFIED", httpStatus: 304 };
      }
      if (!res.ok) {
        lastStatus = "HTTP_ERROR";
        lastError = `HTTP ${res.status} ${res.statusText}`.trim();
        // 4xx (other than 429) will not fix itself — retrying wastes egress.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
      } else {
        const xml = await res.text();
        return {
          status: "OK",
          xml,
          etag: res.headers.get("etag"),
          lastModified: res.headers.get("last-modified"),
          httpStatus: res.status,
        };
      }
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      const aborted = err instanceof Error && (err.name === "AbortError" || /aborted/i.test(msg));
      lastStatus = aborted ? "TIMEOUT" : "NETWORK_ERROR";
      lastError = aborted ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s` : msg;
    }
    if (attempt < FETCH_ATTEMPTS) await new Promise((r) => setTimeout(r, 700 * attempt));
  }

  return { status: lastStatus, error: lastError };
}

export const DEFAULT_POLL_INTERVAL_SECONDS = Number(
  process.env.RSS_POLL_INTERVAL_SECONDS ?? 3600
);

export interface FeedSummary {
  feedId: string;
  feedName: string;
  newArticles: number;
  /** Outcome of this attempt — surfaced in the admin console. */
  status?: FeedFetchStatus | "EMPTY" | "SKIPPED" | "DISABLED";
  itemCount?: number;
  durationMs?: number;
  error?: string;
}

export interface PollSummary {
  feedsPolled: number;
  newArticles: number;
  errors: number;
  details: Array<{
    feedName: string;
    newArticles: number;
    error?: string;
    status?: string;
    itemCount?: number;
    durationMs?: number;
  }>;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

function absolutize(url: string, base: string | undefined): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  try {
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/%[0-9a-f]{2}/i.test(trimmed)) return null;
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    if (base) return new URL(trimmed, base).toString();
    return null;
  } catch {
    return null;
  }
}

function extractFirstImage(content: string): string | null {
  if (!content) return null;
  const imgTag = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgTag?.[1]) return imgTag[1];
  const anySrc = content.match(/src=["']([^"']+\.(?:jpe?g|png|gif|webp|avif))["']/i);
  return anySrc?.[1] ?? null;
}

async function fetchOgImage(articleUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(articleUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ConnectPlus RSS Reader/1.0)",
        Accept: "text/html",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (og?.[1]) return og[1];
    const image = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (image?.[1]) return image[1];
    const firstImg = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return firstImg?.[1] ?? null;
  } catch {
    return null;
  }
}

async function resolveImage(
  allowNetwork: boolean,
  item: {
  enclosure?: { url?: string } | null;
  "media:thumbnail"?: { $?: { url?: string } } | null;
  "media:content"?: { $?: { url?: string } } | null;
  content?: string;
  "content:encoded"?: string;
  contentSnippet?: string;
  link?: string;
}): Promise<string | null> {
  const base = item.link || undefined;
  const candidates = [
    item.enclosure?.url,
    item["media:thumbnail"]?.$?.url,
    item["media:content"]?.$?.url,
    extractFirstImage(item["content:encoded"] || item.content || ""),
  ];
  for (const c of candidates) {
    const abs = absolutize(c ?? "", base);
    if (abs) return abs;
  }
  // Network fallback is opt-in and capped by the caller — scraping the article
  // page for every item on every cycle is what made polling expensive.
  if (!allowNetwork) return null;
  return fetchOgImage(base ?? "");
}

/**
 * Resolve the author for syndicated posts. Prefers the seeded SUPER_ADMIN so
 * imported stories never inherit a random member's byline.
 */
export async function resolveDefaultAuthorId(): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  if (admin?.id) return admin.id;
  const any = await prisma.user.findFirst({ select: { id: true } });
  return any?.id ?? null;
}

export interface DueFeed {
  id: string;
  name: string;
  url: string;
  httpEtag?: string | null;
  httpLastModified?: string | null;
  consecutiveFailures?: number;
}

/**
 * List active feeds that are due for a poll. Splits the settings check out of
 * the poll loop so Inngest can memoize it as its own step.
 */
export async function listDueFeeds(feedId?: string): Promise<DueFeed[]> {
  // Feature flag: admins can pause ingestion from Settings & Integrations.
  if (feedId == null) {
    try {
      const { getSettings } = await import("@/lib/settings");
      const settings = await getSettings(false);
      if (settings.enableRssIngestion === "false") {
        log.info("rss ingestion disabled via settings; skipping poll cycle");
        return [];
      }
    } catch {
      // default to polling when settings are unavailable
    }
  }

  const feedWhere: { isActive: boolean; id?: string } = { isActive: true };
  if (feedId) {
    feedWhere.id = feedId;
  }

  const feeds = await prisma.rssFeed.findMany({
    where: feedWhere,
    orderBy: { lastPolled: "asc" },
    select: {
      id: true,
      name: true,
      url: true,
      pollInterval: true,
      lastPolled: true,
      httpEtag: true,
      httpLastModified: true,
      consecutiveFailures: true,
    },
  });

  const now = Date.now();
  const due: DueFeed[] = [];
  for (const feed of feeds) {
    // Respect per-feed poll intervals so scheduled cron runs never hammer a
    // slow feed before it is due.
    const intervalSec = feed.pollInterval > 0 ? feed.pollInterval : DEFAULT_POLL_INTERVAL_SECONDS;
    if (feed.lastPolled && now < feed.lastPolled.getTime() + intervalSec * 1000) {
      continue;
    }
    due.push({
      id: feed.id,
      name: feed.name,
      url: feed.url,
      httpEtag: feed.httpEtag,
      httpLastModified: feed.httpLastModified,
      consecutiveFailures: feed.consecutiveFailures,
    });
  }
  return due;
}

/**
 * Poll ONE feed: fetch, dedupe against existing articles, import new items as
 * rssArticles + published posts. Isolated per feed so a serverless timeout on
 * a slow source can only ever cost that one feed's work — the Inngest
 * function runs each feed as its own step and resumes where it left off.
 */
export async function pollSingleFeed(
  feed: DueFeed,
  defaultAuthorId: string | null
): Promise<FeedSummary> {
  const startedAt = Date.now();
  const summary: FeedSummary = { feedId: feed.id, feedName: feed.name, newArticles: 0 };

  try {
    const fetched = await fetchFeedXml(feed);

    if (fetched.status === "NOT_MODIFIED") {
      log.info("feed unchanged (304)", { feed: feed.name });
      await prisma.rssFeed.update({
        where: { id: feed.id },
        data: {
          lastPolled: new Date(),
          lastStatus: "NOT_MODIFIED",
          lastError: null,
          lastNewArticles: 0,
          lastDurationMs: Date.now() - startedAt,
          consecutiveFailures: 0,
        },
      });
      summary.status = "NOT_MODIFIED";
      summary.durationMs = Date.now() - startedAt;
      return summary;
    }

    if (fetched.status !== "OK" || !fetched.xml) {
      const failures = (feed.consecutiveFailures ?? 0) + 1;
      await prisma.rssFeed.update({
        where: { id: feed.id },
        data: {
          lastPolled: new Date(),
          lastStatus: fetched.status,
          lastError: fetched.error ?? fetched.status,
          lastDurationMs: Date.now() - startedAt,
          consecutiveFailures: failures,
        },
      });
      summary.status = fetched.status;
      summary.error = fetched.error ?? fetched.status;
      summary.durationMs = Date.now() - startedAt;
      log.warn("feed fetch failed", { feed: feed.name, status: fetched.status, error: fetched.error });
      return summary;
    }

    let parsed: Awaited<ReturnType<typeof parser.parseString>>;
    try {
      parsed = await parser.parseString(fetched.xml);
    } catch (parseErr: unknown) {
      const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
      await prisma.rssFeed.update({
        where: { id: feed.id },
        data: {
          lastPolled: new Date(),
          lastStatus: "PARSE_ERROR",
          lastError: message.slice(0, 300),
          lastDurationMs: Date.now() - startedAt,
          consecutiveFailures: (feed.consecutiveFailures ?? 0) + 1,
        },
      });
      summary.status = "PARSE_ERROR";
      summary.error = message;
      summary.durationMs = Date.now() - startedAt;
      log.warn("feed parse failed", { feed: feed.name, error: parseErr });
      return summary;
    }

    // Cap per-feed imports so one busy source can't flood Postgres in a run.
    const items = (parsed.items || []).slice(0, 25);

    // One batched lookup instead of a findUnique-per-item (keeps this loop
    // at O(1) queries instead of O(items) against Supabase).
    const urls = items
      .map((item) => item.link || item.guid)
      .filter((url): url is string => Boolean(url));
    const seen = new Set(
      (
        await prisma.rssArticle.findMany({
          where: { url: { in: urls } },
          select: { url: true },
        })
      ).map((a) => a.url)
    );

    // Resolve images (network-capped) and build the row payloads first, then
    // write them in two batched statements. Inserting article-by-article and
    // post-by-post meant ~50 serialized round trips per feed; against a remote
    // Postgres that alone pushed a full cycle past seven minutes — beyond any
    // serverless budget.
    let ogLookupsUsed = 0;
    const prepared: {
      article: Prisma.RssArticleCreateManyInput;
      title: string;
      text: string;
    }[] = [];

    for (const item of items) {
      const articleUrl = item.link || item.guid;
      if (!articleUrl) continue;
      if (seen.has(articleUrl)) continue;

      const content = item["content:encoded"] || item.content || item.contentSnippet || "";
      const summaryText = item.contentSnippet || item.summary || stripHtml(content).slice(0, 500);

      const allowNetwork = ogLookupsUsed < MAX_OG_LOOKUPS_PER_POLL;
      if (allowNetwork) ogLookupsUsed++;
      const imageUrl = await resolveImage(allowNetwork, item);
      const titleText = item.title || "Untitled";

      prepared.push({
        title: titleText,
        text: `${titleText} ${summaryText ?? ""}`,
        article: {
          feedId: feed.id,
          title: titleText,
          url: articleUrl,
          content: typeof content === "string" ? content.slice(0, 50000) : null,
          summary: typeof summaryText === "string" ? summaryText.slice(0, 2000) : null,
          author: item.creator || item.author || null,
          imageUrl,
          publishedAt: item.pubDate ? new Date(item.pubDate) : null,
        },
      });
    }

    try {
      const createdArticles = prepared.length
        ? await prisma.rssArticle.createManyAndReturn({
            data: prepared.map((p) => p.article),
            skipDuplicates: true,
            select: { id: true, url: true, title: true, imageUrl: true, summary: true },
          })
        : [];
      summary.newArticles = createdArticles.length;

      if (defaultAuthorId && createdArticles.length > 0) {
        const byUrl = new Map(prepared.map((p) => [p.article.url as string, p]));
        const createdPosts = await prisma.post.createManyAndReturn({
          data: createdArticles.map((a) => {
            const source = byUrl.get(a.url);
            const titleText = a.title || "Untitled";
            const slugBase = titleText.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
            return {
              title: titleText,
              slug: `${slugBase.slice(0, 80)}-${Math.random().toString(36).slice(2, 7)}`,
              excerpt: a.summary ?? "",
              content: (source?.article.content ?? "").slice(0, 3000),
              coverImage: a.imageUrl ?? null,
              status: "PUBLISHED",
              moderationStatus: "APPROVED",
              authorId: defaultAuthorId,
              source: feed.name,
              sourceUrl: a.url,
              publishedAt: (source?.article.publishedAt as Date | null) ?? new Date(),
              viewCount: 0,
            };
          }),
          skipDuplicates: true,
          select: { id: true, sourceUrl: true },
        });

        // Link each syndicated post back to its feed article in one statement.
        const urls = createdPosts.map((p) => p.sourceUrl).filter((u): u is string => Boolean(u));
        if (urls.length > 0) {
          await prisma
            .$executeRaw`UPDATE "RssArticle" SET "postId" = p.id FROM "Post" p WHERE p."sourceUrl" = "RssArticle".url AND "RssArticle"."postId" IS NULL AND "RssArticle".url = ANY(${urls})`
            .catch(() => {});
        }
        for (const post of createdPosts) {
          const source = post.sourceUrl ? byUrl.get(post.sourceUrl) : undefined;
          if (source) void autoTagPost(post.id, source.text);
        }
      }
    } catch (err: unknown) {
      log.error("failed creating feed articles", { feed: feed.name, error: err });
      summary.status = "PARSE_ERROR";
      summary.error = err instanceof Error ? err.message : "insert failed";
    }

    await prisma.rssFeed.update({
      where: { id: feed.id },
      data: {
        lastPolled: new Date(),
        lastStatus: summary.status === "PARSE_ERROR" ? "PARSE_ERROR" : items.length === 0 ? "EMPTY" : "OK",
        lastError: null,
        lastItemCount: parsed.items?.length ?? 0,
        lastNewArticles: summary.newArticles,
        lastDurationMs: Date.now() - startedAt,
        consecutiveFailures: 0,
        // Remember the validators so the next cycle can get a cheap 304.
        ...(fetched.etag ? { httpEtag: fetched.etag } : {}),
        ...(fetched.lastModified ? { httpLastModified: fetched.lastModified } : {}),
      },
    });
    summary.status = items.length === 0 ? "EMPTY" : "OK";
    summary.itemCount = parsed.items?.length ?? 0;
  } catch (err: unknown) {
    summary.status = "PARSE_ERROR";
    summary.error = err instanceof Error ? err.message : "Unknown error";
    await prisma.rssFeed
      .update({
        where: { id: feed.id },
        data: {
          lastPolled: new Date(),
          lastStatus: "PARSE_ERROR",
          lastError: summary.error.slice(0, 300),
          lastDurationMs: Date.now() - startedAt,
          consecutiveFailures: (feed.consecutiveFailures ?? 0) + 1,
        },
      })
      .catch(() => {});
    log.warn("feed poll failed", { feed: feed.name, error: err });
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

/**
 * True when any active feed has gone unpolled for longer than `hours`.
 *
 * This is the watchdog behind the trigger: if the Inngest queue accepts events
 * but never runs the poll function (app not synced, wrong environment, dead
 * schedule), every feed silently goes stale. Rather than keep queueing events
 * into the void, the trigger notices and runs the poll inline instead.
 */
export async function hasStaleFeeds(hours = 3): Promise<boolean> {
  const cutoff = new Date(Date.now() - hours * 3_600_000);
  const stale = await prisma.rssFeed
    .findFirst({
      where: {
        isActive: true,
        OR: [{ lastPolled: null }, { lastPolled: { lt: cutoff } }],
      },
      select: { id: true },
    })
    .catch(() => null);
  return Boolean(stale);
}

export interface ThumbnailRecoveryProgress {
  index: number;
  total: number;
  label: string;
  recovered: boolean;
  source: "content" | "og" | "none";
}

export interface ThumbnailRecoverySummary {
  checked: number;
  recovered: number;
  failed: number;
}

/**
 * Thumbnail recovery.
 *
 * Imported stories frequently arrive with no usable image, which is why so
 * many cards fall back to a generated cover. This walks the newest articles
 * that still have no image and tries two sources, cheapest first:
 *
 *   1. the article body already stored in `RssArticle.content` (an <img> in the
 *      feed's HTML) — zero network egress;
 *   2. the publisher page's og:image / twitter:image — one bounded fetch.
 *
 * A hit updates both the article and its linked post, so the feed, the article
 * page and social previews all get a real picture. It is on-demand (admin
 * console / cron) rather than part of the polling loop, so imports stay cheap.
 */
export async function recoverMissingThumbnails(
  opts: { limit?: number; network?: boolean; onProgress?: (p: ThumbnailRecoveryProgress) => void } = {}
): Promise<ThumbnailRecoverySummary> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const allowNetwork = opts.network !== false;

  const candidates = await prisma.rssArticle.findMany({
    where: { imageUrl: null },
    select: { id: true, url: true, title: true, content: true, postId: true },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });

  const summary: ThumbnailRecoverySummary = { checked: candidates.length, recovered: 0, failed: 0 };
  let index = 0;

  for (const article of candidates) {
    index++;
    let image: string | null = null;
    let source: ThumbnailRecoveryProgress["source"] = "none";

    const inline = absolutize(extractFirstImage(article.content ?? "") ?? "", article.url);
    if (inline) {
      image = inline;
      source = "content";
    } else if (allowNetwork) {
      image = await fetchOgImage(article.url);
      if (image) source = "og";
    }

    if (image) {
      await prisma.rssArticle.update({ where: { id: article.id }, data: { imageUrl: image } }).catch(() => {});
      if (article.postId) {
        await prisma.post
          .updateMany({ where: { id: article.postId, coverImage: null }, data: { coverImage: image } })
          .catch(() => {});
      }
      summary.recovered++;
    } else {
      summary.failed++;
    }

    opts.onProgress?.({
      index,
      total: candidates.length,
      label: article.title.slice(0, 70),
      recovered: Boolean(image),
      source,
    });
  }

  if (summary.recovered > 0) redisIncr("feed:version").catch(() => {});
  log.info("thumbnail recovery finished", { ...summary });
  return summary;
}

/**
 * Aggregate driver used by inline callers (admin triggers, Vercel cron
 * fallback). The Inngest function drives pollSingleFeed per feed as separate
 * steps instead, so long cycles survive serverless timeouts.
 */
export async function pollFeeds(
  feedId?: string,
  onProgress?: (p: { index: number; total: number; summary: FeedSummary }) => void
): Promise<PollSummary> {
  const due = await listDueFeeds(feedId);
  if (due.length === 0) {
    return { feedsPolled: 0, newArticles: 0, errors: 0, details: [] };
  }

  const defaultAuthorId = await resolveDefaultAuthorId();
  const startedAt = Date.now();
  const details: FeedSummary[] = [];

  for (const feed of due) {
    // Stagger feed fetches 500ms apart so a poll cycle never spikes outbound
    // egress against all sources at once. Free tier friendly.
    if (details.length > 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
    const result = await pollSingleFeed(feed, defaultAuthorId);
    details.push(result);
    // Per-feed progress for the admin console's live loading bar (the stream
    // route forwards each event as it happens).
    onProgress?.({ index: details.length, total: due.length, summary: result });
  }

  const totalNewArticles = details.reduce((n, d) => n + d.newArticles, 0);
  const totalErrors = details.filter((d) => d.error).length;

  log.info("poll cycle finished", {
    feedsConsidered: due.length,
    newArticles: totalNewArticles,
    errors: totalErrors,
    elapsedMs: Date.now() - startedAt,
  });

  if (totalNewArticles > 0) {
    // Invalidate the post-list cache so freshly syndicated stories surface.
    redisIncr("feed:version").catch(() => {});
    import("@/lib/neural-mind").then(({ neuralMind }) => {
      neuralMind.learnFromRssArticles().catch((err: unknown) =>
        log.error("neural auto-learn failed", { error: err })
      );
    });
  }

  return {
    feedsPolled: due.length,
    newArticles: totalNewArticles,
    errors: totalErrors,
    details: details.map(({ feedName, newArticles, error, status, itemCount, durationMs }) => ({
      feedName,
      newArticles,
      error,
      status,
      itemCount,
      durationMs,
    })),
  };
}
