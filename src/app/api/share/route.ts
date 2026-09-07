import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSiteConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Robust share-preview metadata: given an article URL (absolute or /article/<slug>),
 * returns the full SEO components crawlers and messengers read — title,
 * description, original thumbnail, canonical URL, author, publish date, tags.
 * Falls back to the site default config for non-article URLs.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url") ?? searchParams.get("u");

    const cfg = await getSiteConfig();
    const baseUrl = cfg.siteUrl.replace(/\/$/, "");

    if (!url) {
      return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
    }

    // Resolve a relative path against the canonical site origin so shares
    // always carry absolute URLs.
    const absolute = /^https?:\/\//i.test(url) ? url : `${baseUrl}${url.startsWith("/") ? url : `/${url}`}`;
    const parsed = new URL(absolute);
    const slugMatch = parsed.pathname.match(/^\/article\/([^/]+)\/?$/);

    if (slugMatch?.[1]) {
      const post = await prisma.post.findUnique({
        where: { slug: decodeURIComponent(slugMatch[1]) },
        select: {
          title: true,
          excerpt: true,
          coverImage: true,
          slug: true,
          publishedAt: true,
          source: true,
          sourceUrl: true,
          author: { select: { name: true, username: true } },
          category: { select: { name: true } },
          tags: { select: { name: true } },
        },
      });
      if (post) {
        const image = post.coverImage
          ? post.coverImage.startsWith("http")
            ? post.coverImage
            : `${baseUrl}${post.coverImage}`
          : `${baseUrl}${cfg.ogImage}`;
        return NextResponse.json({
          url: absolute,
          canonical: `${baseUrl}/article/${post.slug}`,
          title: post.title,
          description:
            post.excerpt ||
            `Read "${post.title}" on ${cfg.siteName}${post.category ? ` — ${post.category.name}` : ""}.`,
          image,
          siteName: cfg.siteName,
          author: post.author.name ?? `@${post.author.username}`,
          publishedTime: post.publishedAt?.toISOString() ?? null,
          tags: post.tags.map((t) => t.name),
          type: "article",
          source: post.source,
          sourceUrl: post.sourceUrl,
        });
      }
    }

    // Generic fallback: site-level share card.
    return NextResponse.json({
      url: absolute,
      canonical: absolute,
      title: `${cfg.siteName} — ${cfg.siteTagline}`,
      description: cfg.siteDescription,
      image: cfg.ogImage.startsWith("http") ? cfg.ogImage : `${baseUrl}${cfg.ogImage}`,
      siteName: cfg.siteName,
      type: "website",
    });
  } catch (error) {
    console.error("Error fetching share preview:", error);
    return NextResponse.json({ error: "Failed to fetch share preview" }, { status: 500 });
  }
}