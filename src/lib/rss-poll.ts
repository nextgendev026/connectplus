import Parser from "rss-parser";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";

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

export async function pollFeeds(feedId?: string): Promise<PollSummary> {
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

    try {
      const parsed = await parser.parseURL(feed.url);
      let feedNewArticles = 0;

      const items = parsed.items || [];

      for (const item of items) {
        const articleUrl = item.link || item.guid;
        if (!articleUrl) continue;

        const existing = await prisma.rssArticle.findUnique({
          where: { url: articleUrl },
        });
        if (existing) continue;

        const content = item["content:encoded"] || item.content || item.contentSnippet || "";
        const summary = item.contentSnippet || item.summary || stripHtml(content).slice(0, 500);

        let imageUrl: string | null = null;
        if (item.enclosure?.url) {
          imageUrl = item.enclosure.url;
        } else if (item["media:thumbnail"]?.$?.url) {
          imageUrl = item["media:thumbnail"].$.url;
        } else if (item["media:content"]?.$?.url) {
          imageUrl = item["media:content"].$.url;
        }

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
    import("@/lib/neural-mind").then(({ neuralMind }) => {
      neuralMind.learnFromRssArticles().catch((err: unknown) =>
        log.error("neural auto-learn failed", { error: err })
      );
    });
  }

  return { feedsPolled: feeds.length, newArticles: totalNewArticles, errors: totalErrors, details };
}