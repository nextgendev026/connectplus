import { prisma } from "./prisma";
import { getSiteConfig } from "./settings";
import { resolveSiteOrigin, stripSourcePromo } from "./seo";
import { absoluteUrl, type FeedItem, type FeedMeta } from "./feeds";

/**
 * The database side of outbound syndication.
 *
 * Kept apart from `feeds.ts` so the rendering stays pure and testable while this
 * file owns the query, the sanitisation and the truncation — the parts that need
 * Prisma and the content processor.
 */

const MAX_ITEMS = 100;
const DEFAULT_ITEMS = 50;
/** Cap on the HTML body we hand to `content:encoded`, so the feed stays small. */
const MAX_BODY_CHARS = 6000;

/**
 * Decode the HTML entities that survive tag-stripping.
 *
 * Feed bodies arrive HTML-encoded, so a bare strip leaves `&#8230;`, `&#8217;`
 * and friends sitting in the text — which a reader then renders literally as
 * "Sheryl Gabr&#8230;". Numeric entities cover the vast majority; the named ones
 * below are the rest that actually show up in Kenyan and regional feeds.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => codePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&hellip;/gi, "…")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&rsquo;/gi, "’")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&rdquo;/gi, "”")
    .replace(/&ldquo;/gi, "“")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function codePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  // Surrogates are not valid code points and would throw in fromCodePoint.
  if (n >= 0xd800 && n <= 0xdfff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/**
 * Plain, human text for the feed.
 *
 * Runs the share-card cleaner (`stripSourcePromo`) so the "The post … appeared
 * first on …" trailer and inline URLs a publisher appends are removed rather
 * than republished as our own words — the same reason the share cards strip
 * them — then decodes the entities that survive tag-stripping.
 */
function plainText(html: string | null | undefined, max: number): string {
  return stripSourcePromo(decodeEntities(html ?? ""), max);
}

export interface FeedRequest {
  /** Feed path for the self link, e.g. `/feed.xml` or `/feed/technology`. */
  selfPath: string;
  categorySlug?: string | null;
  limit?: number;
}

export interface FeedDocument {
  meta: FeedMeta;
  items: FeedItem[];
}

/**
 * Build the feed document for a request.
 *
 * `null` means the requested category does not exist — the caller turns that
 * into a 404 rather than silently serving the unfiltered feed under a filtered
 * URL, which is how a reader ends up subscribed to the wrong thing.
 */
export async function getFeedDocument(req: FeedRequest): Promise<FeedDocument | null> {
  const [cfg, origin] = await Promise.all([getSiteConfig(), resolveSiteOrigin()]);

  let categoryLabel: string | undefined;
  let categoryId: string | undefined;
  if (req.categorySlug) {
    const category = await prisma.category
      .findUnique({ where: { slug: req.categorySlug }, select: { id: true, name: true } })
      .catch(() => null);
    if (!category) return null;
    categoryId = category.id;
    categoryLabel = category.name;
  }

  const take = Math.min(Math.max(req.limit ?? DEFAULT_ITEMS, 1), MAX_ITEMS);

  const posts = await prisma.post
    .findMany({
      where: {
        status: "PUBLISHED",
        moderationStatus: "APPROVED",
        ...(categoryId ? { categoryId } : {}),
      },
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        content: true,
        coverImage: true,
        publishedAt: true,
        createdAt: true,
        source: true,
        sourceUrl: true,
        author: { select: { name: true, username: true } },
        category: { select: { name: true } },
        tags: { select: { name: true }, take: 6 },
      },
      orderBy: { publishedAt: "desc" },
      take,
    })
    .catch(() => []);

  const items: FeedItem[] = posts.map((post) => {
    const link = `${origin}/article/${post.slug}`;
    const summary = plainText(post.excerpt ?? post.content, 320);
    const body = plainText(post.content, MAX_BODY_CHARS);

    return {
      id: post.id,
      title: post.title,
      url: link,
      summary,
      // `content:encoded` only when the full body says more than the summary —
      // otherwise it is the same sentence twice, which bloats the feed and the
      // reader has nothing extra to show. The body is plain text, so it cannot
      // carry markup into a consumer that renders it.
      contentHtml: body.length > summary.length + 40 ? body : null,
      authorName: post.author?.name ?? post.author?.username ?? null,
      category: post.category?.name ?? null,
      tags: post.tags?.map((t) => t.name) ?? [],
      publishedAt: post.publishedAt ?? post.createdAt,
      imageUrl: absoluteUrl(origin, post.coverImage),
      sourceName: post.source ?? null,
      sourceUrl: post.sourceUrl ?? null,
    };
  });

  const meta: FeedMeta = {
    origin,
    siteName: cfg.siteName,
    tagline: cfg.siteTagline,
    description: cfg.siteDescription,
    selfPath: req.selfPath,
    updated: items[0]?.publishedAt ?? new Date(),
    categoryLabel,
  };

  return { meta, items };
}
