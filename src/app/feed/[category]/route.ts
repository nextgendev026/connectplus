import { NextRequest } from "next/server";
import { buildJsonFeed, buildRssFeed } from "@/lib/feeds";
import { getFeedDocument } from "@/lib/feed-source";

export const dynamic = "force-dynamic";

/**
 * Per-category feed: `/feed/<category-slug>` (+ `?format=json`).
 *
 * A network that only syndicates technology should not have to pull the whole
 * firehose and filter it. Each category therefore gets its own feed with its own
 * `rel="self"`, and an unknown slug is a 404 — never the unfiltered feed wearing
 * a filtered URL, which is how a partner silently republishes the wrong things.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  const { category } = await params;
  const format = (request.nextUrl.searchParams.get("format") ?? "rss").toLowerCase();
  const limitRaw = request.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  const selfPath = `/feed/${category}${format === "json" ? "?format=json" : ""}`;
  const doc = await getFeedDocument({
    selfPath,
    categorySlug: category,
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  if (!doc) {
    return new Response("Category not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }

  const body = format === "json" ? buildJsonFeed(doc.meta, doc.items) : buildRssFeed(doc.meta, doc.items);
  return new Response(body, {
    headers: {
      "Content-Type":
        format === "json"
          ? "application/feed+json; charset=utf-8"
          : "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}
