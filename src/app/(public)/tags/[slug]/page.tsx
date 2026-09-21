import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ChevronRight, Hash, Tag as TagIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ViewCount } from "@/components/ui/ViewCount";
import { PostCard } from "@/components/blog/PostCard";
import { getSiteConfig } from "@/lib/settings";
import type { PostWithAuthor } from "@/types";

/**
 * A tag's landing page.
 *
 * This route did not exist, and two surfaces linked to it: the home sidebar's
 * trending topics and every `TagBadge` in the app — thousands of links on
 * article pages alone, every one of them a 404. A trending topic is a subject,
 * so the page a reader lands on when they click one has to be a real,
 * indexable list of the stories behind it.
 *
 * `revalidate` on its own is inert for a dynamic segment: without
 * `generateStaticParams` the App Router renders on demand and never writes the
 * result to the full route cache. Declaring the busiest tags makes this a
 * cached route, and every other tag is generated on its first request and
 * cached from then on — which matters more here than elsewhere, because the
 * table holds thousands of tags and only a few hundred are ever linked to.
 */
export const revalidate = 300;

interface TagParams {
  params: Promise<{ slug: string }>;
}

/** Stories shown before the reader has to go looking. */
const PAGE_SIZE = 24;

const PUBLISHED = { status: "PUBLISHED", moderationStatus: "APPROVED" } as const;

const getTag = cache((slug: string) =>
  prisma.tag.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  })
);

/**
 * The tags worth rendering ahead of time: the busiest few, which are what the
 * sidebar and the article badges point at most often.
 *
 * Deliberately a short list. Declaring *any* params is what matters — it is
 * what registers the route as a cached one, and every other tag is generated on
 * its first request and cached from then on. Rendering more at build time buys
 * nothing and costs real money at build time: this runs against the same shared
 * free-tier Postgres as the rest of the build, in parallel workers, and a long
 * prerender list exhausted the connection pool (P2024) outright when it was
 * fifty. The shortlist is also aggregated in SQL rather than through
 * `orderBy: { posts: { _count: "desc" } }`, which sorts every tag in the table
 * through a correlated subquery while holding a connection.
 *
 * A build with no database returns nothing and leaves every tag to on-demand
 * generation.
 */
export async function generateStaticParams() {
  try {
    const busiest = await prisma.$queryRaw<{ slug: string }[]>`
      SELECT t.slug
      FROM "_PostToTag" pt
      JOIN "Post" po ON po.id = pt."A"
      JOIN "Tag" t ON t.id = pt."B"
      WHERE po.status = 'PUBLISHED' AND po."moderationStatus" = 'APPROVED'
      GROUP BY t.slug
      ORDER BY COUNT(*) DESC
      LIMIT 8
    `;
    return busiest.map((tag) => ({ slug: tag.slug }));
  } catch {
    return [];
  }
}

async function siteOrigin(): Promise<string> {
  try {
    const cfg = await getSiteConfig();
    return (cfg.siteUrl ?? "https://connectplusapp.vercel.app").replace(/\/$/, "");
  } catch {
    // A missing settings row must not take the page's metadata with it.
    return "https://connectplusapp.vercel.app";
  }
}

export async function generateMetadata({ params }: TagParams): Promise<Metadata> {
  const { slug } = await params;
  const tag = await getTag(slug);

  if (!tag) {
    // Unreachable in practice — the page itself answers 404 for an unknown tag,
    // and that response never reaches the metadata. Kept so a metadata-only
    // render cannot advertise a topic that does not exist.
    return { title: "Topic not found", robots: { index: false, follow: true } };
  }

  const baseUrl = await siteOrigin();
  const published = await prisma.post
    .count({ where: { ...PUBLISHED, tags: { some: { id: tag.id } } } })
    .catch(() => 0);

  const description = `Every ${tag.name} story on connectPlus — ${published} ${
    published === 1 ? "article" : "articles"
  } from East Africa's writers, most-read first.`;

  return {
    // The brand comes from the root title template — see about/page.tsx.
    title: `#${tag.name}`,
    description,
    alternates: { canonical: `${baseUrl}/tags/${tag.slug}` },
    // A tag with a single story is a thin page: still reachable for readers,
    // not worth a crawler's index entry.
    robots: { index: published >= 2, follow: true },
    openGraph: {
      title: `#${tag.name}`,
      description,
      type: "website",
      url: `${baseUrl}/tags/${tag.slug}`,
    },
  };
}

export default async function TagPage({ params }: TagParams) {
  const { slug } = await params;
  const tag = await getTag(slug);

  // A real 404, not a 200 carrying a "not found" screen. The latter is a soft
  // 404 — it tells a crawler this URL is a genuine, indexable page — which is
  // precisely the wrong signal for a topic nobody has written under. The
  // public route group has its own branded `not-found.tsx`, so the reader still
  // lands somewhere that looks like the app and offers a way onward.
  if (!tag) notFound();

  const where = { ...PUBLISHED, tags: { some: { id: tag.id } } };

  const [posts, total, totals, related] = await Promise.all([
    prisma.post.findMany({
      where,
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true } },
        category: { select: { id: true, name: true, slug: true } },
        tags: { select: { id: true, name: true, slug: true } },
        _count: { select: { comments: true, likes: true } },
      },
      // Most-read first, then newest: the reader who clicks a trending topic
      // came for the story everyone is reading, not for the most recent one.
      orderBy: [{ viewCount: "desc" }, { createdAt: "desc" }],
      take: PAGE_SIZE,
    }) as Promise<PostWithAuthor[]>,
    prisma.post.count({ where }).catch(() => 0),
    prisma.post
      .aggregate({ where, _sum: { viewCount: true } })
      .catch(() => ({ _sum: { viewCount: 0 } })),
    // Topics that appear alongside this one, which is what makes a tag page a
      // route through the archive rather than a dead end.
    prisma.tag
      .findMany({
        where: {
          id: { not: tag.id },
          posts: { some: { ...PUBLISHED, tags: { some: { id: tag.id } } } },
        },
        select: { id: true, name: true, slug: true },
        orderBy: { name: "asc" },
        take: 10,
      })
      .catch(() => [] as { id: string; name: string; slug: string }[]),
  ]);

  const totalViews = totals._sum?.viewCount ?? 0;
  const baseUrl = await siteOrigin();
  const canonicalUrl = `${baseUrl}/tags/${tag.slug}`;
  const description = `Every ${tag.name} story on connectPlus — ${total} ${
    total === 1 ? "article" : "articles"
  } from East Africa's writers, most-read first.`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `#${tag.name}`,
    description,
    url: canonicalUrl,
    isPartOf: { "@type": "WebSite", name: "connectPlus", url: baseUrl },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: total,
      itemListElement: posts.slice(0, 10).map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${baseUrl}/article/${post.slug}`,
        name: post.title,
      })),
    },
  };

  return (
    <div className="min-h-screen bg-surface-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <div className="relative overflow-hidden border-b border-surface-800/50">
        <div className="absolute inset-0 bg-mesh-gradient" />
        <div className="absolute right-[10%] top-[12%] h-64 w-64 rounded-full bg-brand-500/6 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 md:py-14">
          <nav className="mb-6 flex items-center gap-1.5 text-xs text-surface-400">
            <Link href="/" className="transition-colors hover:text-surface-200">
              Home
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="inline-flex items-center gap-1 text-surface-500">
              <TagIcon className="h-3 w-3" />
              Topic
            </span>
          </nav>

          <h1 className="font-display text-3xl font-bold tracking-tight text-surface-50 break-words sm:text-5xl">
            #{tag.name}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-surface-400">
            <span>
              <strong className="text-surface-100">{total.toLocaleString()}</strong>{" "}
              {total === 1 ? "story" : "stories"}
            </span>
            <ViewCount value={totalViews} />
            {posts.length > 0 && (
              <span className="text-surface-500">
                showing the {posts.length} most-read
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 md:py-12">
        {posts.length === 0 ? (
          <div className="rounded-2xl border border-surface-800 bg-surface-900/50 px-6 py-16 text-center">
            <TagIcon className="mx-auto h-8 w-8 text-surface-600" />
            <p className="mt-3 text-sm text-surface-400">
              Nothing is published under #{tag.name} yet.
            </p>
            <Link
              href="/"
              className="mt-6 inline-block rounded-lg bg-brand-500 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600"
            >
              Read the latest stories
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}

        {related.length > 0 && (
          <section className="mt-14 border-t border-surface-800/60 pt-8">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-surface-50">
              <Hash className="h-4 w-4 text-brand-400" />
              Related topics
            </h2>
            <div className="flex flex-wrap gap-2">
              {related.map((t) => (
                <Link
                  key={t.id}
                  href={`/tags/${t.slug}`}
                  className="rounded-full border border-surface-700/60 bg-surface-900/60 px-3 py-1.5 text-xs text-surface-300 transition-colors hover:border-brand-500/40 hover:text-brand-400"
                >
                  #{t.name}
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
