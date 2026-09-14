import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSiteConfig } from "@/lib/settings";
import { articleShareCard, resolveSiteOrigin } from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * Share-preview metadata: given `/article/<slug>` (relative or absolute),
 * returns the components crawlers and messengers read — title, description,
 * our own thumbnail, our canonical URL, author, publish date, tags.
 *
 * It deliberately does NOT report where a syndicated story came from. The
 * preview card is the whole of connectPlus that most readers on other platforms
 * ever see, and it has to be our article: our thumbnail and our details, with
 * no raw upstream URL in the payload for a platform to render instead. The
 * origin publisher is still credited on the article page itself.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url") ?? searchParams.get("u");

    const cfg = await getSiteConfig();
    const origin = await resolveSiteOrigin();
    const siteCard = {
      url: origin,
      canonical: origin,
      title: `${cfg.siteName} — ${cfg.siteTagline}`,
      description: cfg.siteDescription,
      image: cfg.ogImage.startsWith("http") ? cfg.ogImage : `${origin}${cfg.ogImage}`,
      siteName: cfg.siteName,
      author: null,
      publishedTime: null,
      tags: [] as string[],
      type: "website" as const,
    };

    if (!url) {
      return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
    }

    // Resolve a relative path against our own origin so shares always carry
    // absolute URLs, then look for an article. Anything that is not one of our
    // articles gets the site card — we never echo a caller-supplied URL back in
    // a share payload.
    const absolute = /^https?:\/\//i.test(url)
      ? url
      : `${origin}${url.startsWith("/") ? url : `/${url}`}`;

    let slug: string | null = null;
    try {
      const parsed = new URL(absolute);
      if (parsed.origin === origin) {
        slug = parsed.pathname.match(/^\/article\/([^/]+)\/?$/)?.[1] ?? null;
      }
    } catch {
      slug = null;
    }

    if (slug) {
      const post = await prisma.post.findUnique({
        where: { slug: decodeURIComponent(slug) },
        select: {
          id: true,
          title: true,
          excerpt: true,
          content: true,
          slug: true,
          publishedAt: true,
          author: { select: { name: true, username: true } },
          category: { select: { name: true } },
          tags: { select: { name: true } },
        },
      });

      if (post) {
        return NextResponse.json(await articleShareCard(post));
      }
    }

    return NextResponse.json(siteCard);
  } catch (error) {
    console.error("Error fetching share preview:", error);
    return NextResponse.json({ error: "Failed to fetch share preview" }, { status: 500 });
  }
}
