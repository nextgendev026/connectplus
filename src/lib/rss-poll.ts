import Parser from "rss-parser";
import { prisma } from "@/lib/prisma";
import { autoTagPost } from "@/lib/auto-tag";
import { createLogger } from "@/lib/logger";
import { redisIncr, cacheGet, cacheSet } from "@/lib/redis";

const log = createLogger("rss-poll");

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "ConnectPlus RSS Reader/1.0",
  },
});

export const DEFAULT_POLL_INTERVAL_SECONDS = Number(
  process.env.RSS_POLL_INTERVAL_SECONDS ?? 3600
);

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

export async function pollFeeds(feedId?: string): Promise<PollSummary> {
  // Feature flag: admins can pause ingestion from Settings & Integrations.
  if (feedId == null) {
    try {
      const { getSettings } = await import("@/lib/settings");
      const settings = await getSettings(false);
      if (settings.enableRssIngestion === "false") {
        log.info("rss ingestion disabled via settings; skipping poll cycle");
        return { feedsPolled: 0, newArticles: 0, errors: 0, details: [] };
      }
    } catch {
      // default to polling when settings are unavailable
    }
  }
  const defaultAuthor = await prisma.user.findFirst({ select: { id: true } });
  const feedWhere: { isActive: boolean; id?: string } = { isActive: true };
  if (feedId) {
    feedWhere.id = feedId;
  }

  const feeds = await prisma.rssFeed.findMany({
    where: feedWhere,
    orderBy: { lastPolled: "asc" },
  });

  if (feeds.length === 0) {
    return { feedsPolled: 0, newArticles: 0, errors: 0, details: [] };
  }

  let totalNewArticles = 0;
  let totalErrors = 0;
  const details: PollSummary["details"] = [];
  const startedAt = Date.now();

  for (const feed of feeds) {
    // Respect per-feed poll intervals so scheduled cron runs never hammer a
    // slow feed before it is due.
    const intervalSec = feed.pollInterval > 0 ? feed.pollInterval : DEFAULT_POLL_INTERVAL_SECONDS;
    if (feed.lastPolled) {
      const dueAt = feed.lastPolled.getTime() + intervalSec * 1000;
      if (Date.now() < dueAt) {
        continue;
      }
    }

    // Stagger feed fetches 500ms apart so a poll cycle never spikes outbound
    // egress against all sources at once. Free tier friendly.
    if (feeds.length > 1) {
      await new Promise((r) => setTimeout(r, 500));
    }

    try {
      // Check if feed was unchanged since last successful poll (ETag/Last-Modified caching)
      const feedCacheKey = `rss:etag:${feed.id}`;
      const cachedEtag = await cacheGet<string>(feedCacheKey).catch(() => null);
      
      let parsed;
      try {
        parsed = await parser.parseURL(feed.url);
      } catch (parseErr: any) {
        // 304 Not Modified or unchanged feed — skip silently
        if (parseErr?.message?.includes('304') || parseErr?.statusCode === 304) {
          log.info("feed unchanged (304)", { feed: feed.name });
          await prisma.rssFeed.update({ where: { id: feed.id }, data: { lastPolled: new Date() } });
          continue;
        }
        throw parseErr;
      }
      let feedNewArticles = 0;

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
        const summary = item.contentSnippet || item.summary || stripHtml(content).slice(0, 500);

        const imageUrl = await resolveImage(item);

        try {
await prisma.rssArticle.create({
            data: {
              feedId: feed.id,
              title: item.title || "Untitled",
              url: articleUrl,
              content: typeof content === "string" ? content.slice(0, 50000) : null,
              summary: typeof summary === "string" ? summary.slice(0, 2000) : null,
              author: item.creator || item.author || null,
              imageUrl,
              publishedAt: item.pubDate ? new Date(item.pubDate) : null,
            },
          });
          if (defaultAuthor?.id) {
            const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
            const titleText = item.title || "Untitled";
            const slugBase = titleText.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
            const slug = `${slugBase}-${Math.random().toString(36).slice(2, 7)}`;
            const post = await prisma.post.create({
              data: {
                title: titleText,
                slug,
                excerpt: summary ?? "",
                content: typeof content === "string" ? content.slice(0, 3000) : "",
                coverImage: imageUrl,
                status: "PUBLISHED",
                moderationStatus: "APPROVED",
                authorId: defaultAuthor.id,
                source: feed.name,
                sourceUrl: articleUrl,
                publishedAt,
                viewCount: 0,
              },
            });
            void autoTagPost(post.id, `${titleText} ${summary ?? ""}`);
          }
          feedNewArticles++;
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

      totalNewArticles += feedNewArticles;
      details.push({ feedName: feed.name, newArticles: feedNewArticles });
    } catch (err: unknown) {
      totalErrors++;
      details.push({
        feedName: feed.name,
        newArticles: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
      log.warn("feed poll failed", { feed: feed.name, error: err });
    }
  }

  log.info("poll cycle finished", {
    feedsConsidered: feeds.length,
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

  return { feedsPolled: feeds.length, newArticles: totalNewArticles, errors: totalErrors, details };
}