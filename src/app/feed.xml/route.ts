import { NextRequest } from "next/server";
import { buildJsonFeed, buildRssFeed } from "@/lib/feeds";
import { getFeedDocument } from "@/lib/feed-source";

export const dynamic = "force-dynamic";

/**
 * The platform's own feed, for other networks to syndicate from.
 *
 *   GET /feed.xml                    → RSS 2.0, newest 50 published stories
 *   GET /feed.xml?format=json        → JSON Feed 1.1 (same items)
 *   GET /feed.xml?category=<slug>    → one category
 *   GET /feed.xml?limit=<n>          → 1–100 items
 *
 * Discovery is declared in the root layout, so a reader that finds the site can
 * find the feed without being told the URL.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const format = (searchParams.get("format") ?? "rss").toLowerCase();
  const category = searchParams.get("category");
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  const selfPath = feedSelfPath({ format, category, limit: searchParams.get("limit") });
  const doc = await getFeedDocument({
    selfPath,
    categorySlug: category,
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  if (!doc) {
    return new Response("Category not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }

  if (format === "json") {
    return new Response(buildJsonFeed(doc.meta, doc.items), {
      headers: {
        "Content-Type": "application/feed+json; charset=utf-8",
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
      },
    });
  }

  return new Response(buildRssFeed(doc.meta, doc.items), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}

/** The exact URL to advertise as `rel="self"`, preserving the query. */
function feedSelfPath(params: {
  format: string;
  category: string | null;
  limit: string | null;
}): string {
  const qs = new URLSearchParams();
  if (params.format === "json") qs.set("format", "json");
  if (params.category) qs.set("category", params.category);
  if (params.limit) qs.set("limit", params.limit);
  const query = qs.toString();
  return query ? `/feed.xml?${query}` : "/feed.xml";
}
