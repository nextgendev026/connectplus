import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { getSiteConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Static routes with an intentionally *per-route* cadence.
 *
 * A single "weekly / 0.7" for everything throws away the strongest ranking
 * signal a sitemap carries: how much a page is actually worth re-crawling. The
 * live scores desk changes every two minutes, an article changes when it is
 * edited, and the privacy policy changes roughly never — telling a crawler they
 * are the same wastes crawl budget on the pages that matter least.
 */
const STATIC_ROUTES: {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}[] = [
  { path: "", changeFrequency: "hourly", priority: 1 },
  // The sports desk is the highest-churn surface on the site and the one we
  // most want indexed fresh.
  { path: "/sports", changeFrequency: "hourly", priority: 0.95 },
  { path: "/trending", changeFrequency: "hourly", priority: 0.9 },
  { path: "/radio", changeFrequency: "daily", priority: 0.8 },
  { path: "/categories", changeFrequency: "daily", priority: 0.8 },
  { path: "/search", changeFrequency: "weekly", priority: 0.5 },
  { path: "/pricing", changeFrequency: "weekly", priority: 0.6 },
  { path: "/monetize", changeFrequency: "weekly", priority: 0.6 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.5 },
  { path: "/help", changeFrequency: "monthly", priority: 0.5 },
  { path: "/guidelines", changeFrequency: "yearly", priority: 0.3 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let baseUrl = "https://connectplusapp.vercel.app";
  try {
    const cfg = await getSiteConfig();
    baseUrl = cfg.siteUrl || baseUrl;
  } catch {
    // fall back to env/default
  }
  const origin = baseUrl.replace(/\/$/, "");

  const staticPages: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${origin}${route.path}`,
    lastModified: new Date(),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  // Every query is individually guarded: a sitemap is a marketing asset, and it
  // must still be emitted when one of the tables behind it is unavailable,
  // rather than 500-ing and dropping the whole route from the crawl.
  const [posts, authors] = await Promise.all([
    prisma.post
      .findMany({
        where: { status: "PUBLISHED", moderationStatus: "APPROVED" },
        select: { slug: true, updatedAt: true, publishedAt: true },
        orderBy: { publishedAt: "desc" },
        take: 2000,
      })
      .catch(() => []),
    // Authors with at least one published story — public profile pages that are
    // otherwise only reachable by clicking a byline.
    prisma.user
      .findMany({
        where: { posts: { some: { status: "PUBLISHED", moderationStatus: "APPROVED" } } },
        select: { username: true, posts: { select: { updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 1 } },
        take: 500,
      })
      .catch(() => []),
  ]);

  const postPages: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${origin}/article/${post.slug}`,
    lastModified: post.updatedAt ?? post.publishedAt ?? new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const authorPages: MetadataRoute.Sitemap = authors.map((author) => ({
    url: `${origin}/profile/${author.username}`,
    lastModified: author.posts[0]?.updatedAt ?? new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  return [...staticPages, ...postPages, ...authorPages];
}
