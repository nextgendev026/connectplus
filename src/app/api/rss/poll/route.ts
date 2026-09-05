import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import Parser from "rss-parser";
import { prisma } from "@/lib/prisma";

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "ConnectPlus RSS Reader/1.0",
  },
});

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { feedId } = body as { feedId?: string };

    const feedWhere: { isActive: boolean; id?: string } = { isActive: true };
    if (feedId) {
      feedWhere.id = feedId;
    }

    const feeds = await prisma.rssFeed.findMany({
      where: feedWhere,
      orderBy: { lastPolled: "asc" },
    });

    if (feeds.length === 0) {
      return NextResponse.json({
        feedsPolled: 0,
        newArticles: 0,
        errors: 0,
        details: [],
      });
    }

    let totalNewArticles = 0;
    let totalErrors = 0;
    const details: Array<{ feedName: string; newArticles: number; error?: string }> = [];

    for (const feed of feeds) {
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
              console.error(`Error creating article for ${feed.name}:`, err);
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
        console.error(`Error polling feed ${feed.name}:`, err);
      }
    }

    if (totalNewArticles > 0) {
      import("@/lib/neural-mind").then(({ neuralMind }) => {
        neuralMind.learnFromRssArticles().catch((err: unknown) =>
          console.error("Neural auto-learn failed:", err)
        );
      });
    }

    return NextResponse.json({
      feedsPolled: feeds.length,
      newArticles: totalNewArticles,
      errors: totalErrors,
      details,
    });
  } catch (error) {
    console.error("RSS poll error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
