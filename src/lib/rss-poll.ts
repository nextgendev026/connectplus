import Parser from "rss-parser";
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

export const DEFAULT_POLL_INTERVAL_SECONDS = Number(
  process.env.RSS_POLL_INTERVAL_SECONDS ?? 3600
);

export interface FeedSummary {
  feedId: string;
  feedName: string;
  newArticles: number;
  error?: string;
}

export interface PollSummary {
  feedsPolled: number;
  newArticles: number;
  errors: number;
  details: Array<{ feedName: string; newArticles: number; error?: string }>;
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

async function resolveImage(item: {
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
    select: { id: true, name: true, url: true, pollInterval: true, lastPolled: true },
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
    due.push({ id: feed.id, name: feed.name, url: feed.url });
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
  const summary: FeedSummary = { feedId: feed.id, feedName: feed.name, newArticles: 0 };

  try {
    let parsed;
    try {
      parsed = await parser.parseURL(feed.url);
    } catch (parseErr: unknown) {
      // 304 Not Modified or unchanged feed — skip silently
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      if (msg.includes("304") || (parseErr as { statusCode?: number })?.statusCode === 304) {
        log.info("feed unchanged (304)", { feed: feed.name });
        await prisma.rssFeed.update({ where: { id: feed.id }, data: { lastPolled: new Date() } });
        return summary;
      }
      throw parseErr;
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

    for (const item of items) {
      const articleUrl = item.link || item.guid;
      if (!articleUrl) continue;
      if (seen.has(articleUrl)) continue;

      const content = item["content:encoded"] || item.content || item.contentSnippet || "";
      const summaryText = item.contentSnippet || item.summary || stripHtml(content).slice(0, 500);

      const imageUrl = await resolveImage(item);

      try {
        await prisma.rssArticle.create({
          data: {
            feedId: feed.id,
            title: item.title || "Untitled",
            url: articleUrl,
            content: typeof content === "string" ? content.slice(0, 50000) : null,
            summary: typeof summaryText === "string" ? summaryText.slice(0, 2000) : null,
            author: item.creator || item.author || null,
            imageUrl,
            publishedAt: item.pubDate ? new Date(item.pubDate) : null,
          },
        });
        if (defaultAuthorId) {
          const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
          const titleText = item.title || "Untitled";
          const slugBase = titleText.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
          const slug = `${slugBase}-${Math.random().toString(36).slice(2, 7)}`;
          const post = await prisma.post.create({
            data: {
              title: titleText,
              slug,
              excerpt: summaryText ?? "",
              content: typeof content === "string" ? content.slice(0, 3000) : "",
              coverImage: imageUrl,
              status: "PUBLISHED",
              moderationStatus: "APPROVED",
              authorId: defaultAuthorId,
              source: feed.name,
              sourceUrl: articleUrl,
              publishedAt,
              viewCount: 0,
            },
          });
          void autoTagPost(post.id, `${titleText} ${summaryText ?? ""}`);
        }
        summary.newArticles++;
      } catch (err: unknown) {
        if (err && typeof err === "object" && "code" in err && err.code !== "P2002") {
          log.error("failed creating article", { feed: feed.name, error: err });
        }
      }
    }

    await prisma.rssFeed.update({
      where: { id: feed.id },
      data: { lastPolled: new Date() },
    });
  } catch (err: unknown) {
    summary.error = err instanceof Error ? err.message : "Unknown error";
    log.warn("feed poll failed", { feed: feed.name, error: err });
  }

  return summary;
}

/**
 * Aggregate driver used by inline callers (admin triggers, Vercel cron
 * fallback). The Inngest function drives pollSingleFeed per feed as separate
 * steps instead, so long cycles survive serverless timeouts.
 */
export async function pollFeeds(feedId?: string): Promise<PollSummary> {
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
    details.push(await pollSingleFeed(feed, defaultAuthorId));
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
    details: details.map(({ feedName, newArticles, error }) => ({ feedName, newArticles, error })),
  };
}
