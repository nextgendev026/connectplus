import { prisma } from "@/lib/prisma";
import { getSiteConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function excerpt(text: string | null | undefined, max = 200): string {
  const plain = (text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}…` : plain;
}

export async function GET() {
  const cfg = await getSiteConfig();
  const url = cfg.siteUrl.replace(/\/$/, "");
  const siteName = cfg.siteName;
  const description = cfg.siteDescription;

  const posts = await prisma.post.findMany({
    where: { status: "PUBLISHED", moderationStatus: "APPROVED" },
    include: {
      author: { select: { name: true, username: true } },
      category: { select: { name: true } },
    },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });

  const items = posts
    .map((post) => {
      const link = `${url}/article/${post.slug}`;
      const pubDate = (post.publishedAt ?? post.createdAt).toUTCString();
      const author = post.author.name ?? post.author.username;
      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(excerpt(post.excerpt))}</description>
      <author>${escapeXml(author)}</author>
      ${post.category ? `<category>${escapeXml(post.category.name)}</category>` : ""}
      ${post.coverImage ? `<enclosure url="${escapeXml(post.coverImage)}" type="image/jpeg" />` : ""}
      ${post.source ? `<source url="${escapeXml(post.sourceUrl ?? link)}">${escapeXml(post.source)}</source>` : ""}
    </item>`;
    })
    .join("\n");

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteName)} — ${escapeXml(cfg.siteTagline)}</title>
    <link>${url}</link>
    <description>${escapeXml(description)}</description>
    <language>en</language>
    <atom:link href="${url}/feed.xml" rel="self" type="application/rss+xml" />
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(feed, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}