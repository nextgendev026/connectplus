import { imageMimeFromUrl } from "./image-src";

/**
 * Outbound syndication.
 *
 * The platform consumes dozens of publisher feeds, so it should publish one
 * worth consuming. That means doing the fiddly parts correctly, because feed
 * readers and aggregators are unforgiving:
 *
 *   • `dc:creator` for a human byline. RSS 2.0's `<author>` is defined as an
 *     *email address*; putting a display name there is the single most common
 *     feed error and some aggregators drop the field over it.
 *   • Absolute URLs everywhere. A relative `/uploads/…` in an `<enclosure>` or
 *     `media:content` resolves against the *reader's* idea of the site, which is
 *     frequently wrong.
 *   • The real MIME type and dimensions, so a reader shows a thumbnail rather
 *     than downloading a "JPEG" that is actually WebP.
 *   • A `media:` namespace, so image-aware readers render the cover instead of
 *     ignoring the item.
 *
 * Pure and dependency-free: the routes gather rows, these functions render them,
 * and the exact bytes are testable without a database.
 */

export interface FeedMeta {
  /** Site origin with no trailing slash, e.g. `https://connectplus.example`. */
  origin: string;
  siteName: string;
  tagline: string;
  description: string;
  /** Path this feed is served from, e.g. `/feed.xml` or `/feed/tech`. */
  selfPath: string;
  /** ISO date the feed content last changed. */
  updated?: Date;
  language?: string;
  copyright?: string;
  /** Set when this feed is filtered to one category. */
  categoryLabel?: string;
}

export interface FeedItem {
  id: string;
  title: string;
  url: string;
  summary: string;
  /** Sanitized HTML body, when the caller has it. */
  contentHtml?: string | null;
  authorName?: string | null;
  authorUrl?: string | null;
  category?: string | null;
  tags?: string[];
  publishedAt: Date;
  /** Absolute or root-relative cover URL. */
  imageUrl?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Resolve a possibly-relative URL against the site origin; pass through `data:`. */
export function absoluteUrl(origin: string, url: string | null | undefined): string | null {
  if (!url) return null;
  const value = url.trim();
  if (!value) return null;
  if (value.startsWith("data:")) return null; // feeds cannot carry inline payloads
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${origin.replace(/\/$/, "")}${value}`;
  try {
    return new URL(value, origin).toString();
  } catch {
    return null;
  }
}

/** Wrap text in CDATA, escaping the one sequence that would close the section. */
function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function sourceOrigin(item: FeedItem): string | null {
  if (!item.sourceUrl) return null;
  try {
    return new URL(item.sourceUrl).origin;
  } catch {
    return null;
  }
}

function rssItem(meta: FeedMeta, item: FeedItem): string {
  const link = absoluteUrl(meta.origin, item.url) ?? item.url;
  const image = absoluteUrl(meta.origin, item.imageUrl);
  const lines: string[] = [
    `      <title>${escapeXml(item.title)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
    `      <pubDate>${item.publishedAt.toUTCString()}</pubDate>`,
  ];

  if (item.authorName) lines.push(`      <dc:creator>${escapeXml(item.authorName)}</dc:creator>`);
  if (item.category) lines.push(`      <category>${escapeXml(item.category)}</category>`);
  for (const tag of item.tags ?? []) lines.push(`      <category>${escapeXml(tag)}</category>`);

  lines.push(`      <description>${cdata(item.summary)}</description>`);
  if (item.contentHtml) lines.push(`      <content:encoded>${cdata(item.contentHtml)}</content:encoded>`);

  if (image) {
    const type = imageMimeFromUrl(image);
    lines.push(`      <enclosure url="${escapeXml(image)}" type="${type}" length="0" />`);
    lines.push(`      <media:content url="${escapeXml(image)}" type="${type}" medium="image" />`);
    lines.push(`      <media:thumbnail url="${escapeXml(image)}" />`);
  }

  const origin = sourceOrigin(item);
  if (item.sourceName && origin) {
    lines.push(`      <source url="${escapeXml(origin)}">${escapeXml(item.sourceName)}</source>`);
  }

  return `    <item>\n${lines.join("\n")}\n    </item>`;
}

/** Render an RSS 2.0 document. */
export function buildRssFeed(meta: FeedMeta, items: readonly FeedItem[]): string {
  const origin = meta.origin.replace(/\/$/, "");
  const self = `${origin}${meta.selfPath}`;
  const updated = meta.updated ?? new Date();
  const copyright =
    meta.copyright ?? `© ${updated.getFullYear()} ${meta.siteName}. All rights reserved.`;

  const channelMeta = [
    `    <title>${escapeXml(
      meta.categoryLabel ? `${meta.siteName} — ${meta.categoryLabel}` : `${meta.siteName} — ${meta.tagline}`
    )}</title>`,
    `    <link>${origin}</link>`,
    `    <description>${escapeXml(meta.description)}</description>`,
    `    <language>${escapeXml(meta.language ?? "en")}</language>`,
    `    <generator>${escapeXml(meta.siteName)}</generator>`,
    `    <copyright>${escapeXml(copyright)}</copyright>`,
    `    <lastBuildDate>${updated.toUTCString()}</lastBuildDate>`,
    `    <ttl>15</ttl>`,
    `    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml" />`,
  ];
  if (meta.categoryLabel) channelMeta.push(`    <category>${escapeXml(meta.categoryLabel)}</category>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
${channelMeta.join("\n")}
${items.map((item) => rssItem(meta, item)).join("\n")}
  </channel>
</rss>`;
}

/** Render a JSON Feed 1.1 document — easier for modern aggregators to consume. */
export function buildJsonFeed(meta: FeedMeta, items: readonly FeedItem[]): string {
  const origin = meta.origin.replace(/\/$/, "");
  const self = `${origin}${meta.selfPath}`;
  const updated = meta.updated ?? new Date();

  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: meta.categoryLabel
      ? `${meta.siteName} — ${meta.categoryLabel}`
      : `${meta.siteName} — ${meta.tagline}`,
    home_page_url: origin,
    feed_url: self,
    description: meta.description,
    language: meta.language ?? "en",
    authors: [{ name: meta.siteName, url: origin }],
    items: items.map((item) => {
      const image = absoluteUrl(meta.origin, item.imageUrl);
      return {
        id: item.id,
        url: absoluteUrl(meta.origin, item.url) ?? item.url,
        title: item.title,
        summary: item.summary,
        ...(item.contentHtml ? { content_html: item.contentHtml } : {}),
        date_published: item.publishedAt.toISOString(),
        ...(item.authorName
          ? { authors: [{ name: item.authorName, ...(item.authorUrl ? { url: item.authorUrl } : {}) }] }
          : {}),
        ...(item.category || (item.tags?.length ?? 0) > 0
          ? { tags: [item.category, ...(item.tags ?? [])].filter(Boolean) as string[] }
          : {}),
        ...(image
          ? {
              image,
              attachments: [{ url: image, mime_type: imageMimeFromUrl(image) }],
            }
          : {}),
      };
    }),
    _updated: updated.toISOString(),
  };

  return JSON.stringify(feed);
}
