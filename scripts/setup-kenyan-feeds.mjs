#!/usr/bin/env node
/**
 * Register the Kenyan media-house feeds the ingestion pipeline polls.
 *
 * Idempotent: feeds are keyed on their URL (unique in the schema), so running
 * this repeatedly only ever updates names/beats. Also ensures the `news`
 * category exists, because the intake layer routes general news there and the
 * original seed taxonomy never created it.
 *
 *   node scripts/setup-kenyan-feeds.mjs            # apply
 *   node scripts/setup-kenyan-feeds.mjs --dry-run  # show what would change
 *
 * Every URL below was checked for a live XML document with <item> entries; the
 * publishers that block automated readers (nation.africa, citizen.digital,
 * the-star.co.ke, tuko) are deliberately absent rather than sitting in the
 * registry as permanently broken feeds.
 */
import { PrismaClient } from "@prisma/client";

const DRY_RUN = process.argv.includes("--dry-run");

/** Canonical list — mirrored in prisma/seed.ts for fresh installs. */
export const KENYAN_MEDIA_FEEDS = [
  {
    name: "The Standard",
    url: "https://www.standardmedia.co.ke/rss/kenya.php",
    siteUrl: "https://www.standardmedia.co.ke",
    description: "Standard Group — national news, business, county and sport",
    category: "News",
  },
  {
    name: "NTV Kenya",
    url: "https://ntvkenya.co.ke/feed/",
    siteUrl: "https://ntvkenya.co.ke",
    description: "Nation Media Group television — breaking news and analysis",
    category: "News",
  },
  {
    name: "KBC",
    url: "https://www.kbc.co.ke/feed/",
    siteUrl: "https://www.kbc.co.ke",
    description: "Kenya Broadcasting Corporation — public broadcaster",
    category: "News",
  },
  {
    name: "Capital FM Kenya",
    url: "https://www.capitalfm.co.ke/news/feed/",
    siteUrl: "https://www.capitalfm.co.ke",
    description: "Capital FM newsroom — national news, business and lifestyle",
    category: "News",
  },
  {
    name: "Nairobi Wire",
    url: "https://nairobiwire.com/feed/",
    siteUrl: "https://nairobiwire.com",
    description: "Nairobi's digital newsroom",
    category: "News",
  },
  {
    name: "Kahawa Tungu",
    url: "https://kahawatungu.com/feed/",
    siteUrl: "https://kahawatungu.com",
    description: "Kenyan politics, current affairs and business",
    category: "News",
  },
  {
    name: "Nairobi Leo",
    url: "https://nairobileo.co.ke/feed/",
    siteUrl: "https://nairobileo.co.ke",
    description: "Nairobi Leo — city news, entertainment and lifestyle",
    category: "News",
  },
  {
    name: "Ghafla Kenya",
    url: "https://www.ghafla.co.ke/feed/",
    siteUrl: "https://www.ghafla.co.ke",
    description: "Kenyan entertainment, celebrity and music news",
    category: "Entertainment",
  },
];

const prisma = new PrismaClient();

async function main() {
  const news = await prisma.category.findUnique({ where: { slug: "news" } });
  if (!news) {
    if (DRY_RUN) {
      console.log("would create category: News (news) 📰");
    } else {
      await prisma.category.create({ data: { name: "News", slug: "news", icon: "📰" } });
      console.log("created category: News (news) 📰");
    }
  } else {
    console.log("category News already present");
  }

  for (const feed of KENYAN_MEDIA_FEEDS) {
    const existing = await prisma.rssFeed.findUnique({ where: { url: feed.url } });
    if (DRY_RUN) {
      console.log(`${existing ? "update" : "create"} feed: ${feed.name} <${feed.url}>`);
      continue;
    }
    await prisma.rssFeed.upsert({
      where: { url: feed.url },
      update: {
        name: feed.name,
        siteUrl: feed.siteUrl,
        description: feed.description,
        category: feed.category,
        isActive: true,
      },
      create: feed,
    });
    console.log(`${existing ? "updated" : "added "} feed: ${feed.name} — ${feed.category}`);
  }

  const [total, active, byCategory] = await Promise.all([
    prisma.rssFeed.count(),
    prisma.rssFeed.count({ where: { isActive: true } }),
    prisma.rssFeed.groupBy({ by: ["category"], _count: { id: true } }),
  ]);
  console.log(`\nfeeds: ${total} total, ${active} active`);
  for (const group of byCategory) {
    console.log(`  ${group.category ?? "unfiled"}: ${group._count.id}`);
  }
  if (DRY_RUN) console.log("\n(dry run — nothing written)");
}

main()
  .catch((err) => {
    console.error("setup failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
