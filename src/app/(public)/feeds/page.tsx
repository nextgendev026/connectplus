import type { Metadata } from "next";
import Link from "next/link";
import { Rss, FileJson, Radio, BookOpen, Clock, Link2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageJsonLd } from "@/components/seo/PageJsonLd";
import { resolveSiteOrigin } from "@/lib/seo";
import { BRAND_NAME, BRAND_SUPPORT_EMAIL } from "@/lib/brand";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Every connectPlus feed a third party can syndicate: RSS 2.0 and JSON Feed endpoints, per-category subscriptions, update cadence, item fields and the attribution we ask for in return.";

export const metadata: Metadata = {
  title: "Feeds & Syndication",
  description: DESCRIPTION,
  keywords: [
    "connectPlus RSS feed",
    "JSON Feed East Africa",
    "syndicate Kenyan news",
    "East Africa content feed",
    "RSS feed API",
  ],
  alternates: {
    canonical: "/feeds",
    types: {
      "application/rss+xml": [{ url: "/feed.xml", title: "All stories" }],
      "application/feed+json": [{ url: "/feed.xml?format=json", title: "JSON feed" }],
    },
  },
  robots: { index: true, follow: true },
  openGraph: { title: "Feeds & Syndication · connectPlus", description: DESCRIPTION, type: "website", url: "/feeds" },
  twitter: { card: "summary", title: "Feeds & Syndication · connectPlus", description: DESCRIPTION },
};

function endpoint(origin: string, path: string): string {
  return `${origin}${path}`;
}

export default async function FeedsPage() {
  const origin = await resolveSiteOrigin();
  const categories = await prisma.category
    .findMany({
      select: { slug: true, name: true, _count: { select: { posts: true } } },
      orderBy: { name: "asc" },
    })
    .catch(() => []);

  const liveCategories = categories.filter((c) => c._count.posts > 0);

  const endpoints = [
    {
      icon: Rss,
      label: "All stories — RSS 2.0",
      href: endpoint(origin, "/feed.xml"),
      note: "The newest published stories, newest first.",
    },
    {
      icon: FileJson,
      label: "All stories — JSON Feed 1.1",
      href: endpoint(origin, "/feed.xml?format=json"),
      note: "Same items, machine-friendly JSON.",
    },
    {
      icon: Radio,
      label: "One category",
      href: endpoint(origin, "/feed/<category-slug>"),
      note: "Subscribe to a single subject instead of the firehose.",
    },
    {
      icon: BookOpen,
      label: "Item count",
      href: endpoint(origin, "/feed.xml?limit=100"),
      note: "1–100 items; 50 by default.",
    },
  ];

  const attributions: { icon: typeof Link2; title: string; body: string }[] = [
    {
      icon: Link2,
      title: "Keep the link back",
      body: "Every item's <link> and <guid> are the canonical article URL on this site. Republishing the item means linking to it, not republishing it as your own.",
    },
    {
      icon: BookOpen,
      title: "Credit the author",
      body: "The byline is in <dc:creator> (RSS) and authors[] (JSON Feed). RSS 2.0's <author> is reserved for an email address, so read the creator field instead.",
    },
    {
      icon: Radio,
      title: "Honour the syndicated source",
      body: "Some items arrive here from other publishers. Their <source> and <media:content> name the original, and the copyright stays theirs — credit them too.",
    },
    {
      icon: Clock,
      title: "Respect the cadence",
      body: "The feed is cached for 10 minutes and both feeds advertise a 15-minute TTL. Polling more often only burns your bandwidth; nothing changes in between.",
    },
  ];

  return (
    <div className="min-h-screen bg-surface-950">
      <PageJsonLd path="/feeds" title="Feeds & Syndication" description={DESCRIPTION} />

      <div className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-mesh-gradient opacity-70" />
        <div className="relative mx-auto max-w-4xl px-4 sm:px-6 py-16 sm:py-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/25 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-300">
            <Rss className="h-3.5 w-3.5" />
            For publishers, aggregators and feed readers
          </div>
          <h1 className="mt-5 font-display text-4xl sm:text-5xl font-bold tracking-tight text-white">
            Syndicate {BRAND_NAME}
          </h1>
          <p className="mt-4 max-w-2xl text-base sm:text-lg text-white/70 leading-relaxed">
            The same feeds this platform consumes from others, published for anyone who wants to carry
            East African stories, live scores and radio. No API key, no sign-up — the endpoints below
            are open.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 sm:px-6 pb-20 -mt-4">
        <div className="rounded-3xl border border-surface-800/60 bg-surface-900/50 p-6 sm:p-10 shadow-card-hover">
          <section>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-surface-50 mb-4">Endpoints</h2>
            <div className="space-y-3">
              {endpoints.map((e) => (
                <div
                  key={e.label}
                  className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <e.icon className="h-4 w-4 shrink-0 text-brand-400" />
                    <div>
                      <div className="text-sm font-semibold text-white">{e.label}</div>
                      <div className="text-xs text-surface-400">{e.note}</div>
                    </div>
                  </div>
                  <code className="shrink-0 rounded-lg bg-black/30 px-2 py-1 text-[11px] text-brand-300 break-all">
                    {e.href}
                  </code>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-10 border-t border-surface-800/60 pt-10">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-surface-50 mb-4">
              Categories you can subscribe to
            </h2>
            {liveCategories.length === 0 ? (
              <p className="text-sm text-surface-400">Category feeds appear as stories are published.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {liveCategories.map((c) => (
                  <Link
                    key={c.slug}
                    href={`/feed/${c.slug}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-surface-200 transition-colors hover:border-brand-500/40 hover:text-brand-300"
                  >
                    <Rss className="h-3 w-3" />
                    {c.name}
                    <span className="text-surface-500">{c._count.posts}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="mt-10 border-t border-surface-800/60 pt-10">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-surface-50 mb-4">
              What each item carries
            </h2>
            <ul className="space-y-2 text-sm text-surface-300">
              <li>
                <strong className="text-white">title</strong>, <strong className="text-white">link</strong> and a
                permalink <strong className="text-white">guid</strong> pointing at the canonical article
              </li>
              <li>
                <strong className="text-white">dc:creator</strong> — the human byline (JSON Feed:{" "}
                <code>authors[]</code>)
              </li>
              <li>
                <strong className="text-white">pubDate</strong> in RFC 822 (JSON Feed: <code>date_published</code> in
                ISO 8601)
              </li>
              <li>
                <strong className="text-white">description</strong> — a plain-text summary with the publisher&apos;s
                promo trailer already stripped
              </li>
              <li>
                <strong className="text-white">enclosure</strong>, <strong className="text-white">media:content</strong>{" "}
                and <strong className="text-white">media:thumbnail</strong> — the cover image, with its real MIME type
              </li>
              <li>
                <strong className="text-white">category</strong> — the section plus its tags
              </li>
              <li>
                <strong className="text-white">source</strong> — present only on syndicated items, naming the original
                publisher
              </li>
            </ul>
          </section>

          <section className="mt-10 border-t border-surface-800/60 pt-10">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-surface-50 mb-4">
              What we ask in return
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {attributions.map((a) => (
                <div key={a.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <a.icon className="h-4 w-4 text-brand-400" />
                  <h3 className="mt-2 text-sm font-semibold text-white">{a.title}</h3>
                  <p className="mt-1 text-xs text-surface-400 leading-relaxed">{a.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-10 border-t border-surface-800/60 pt-10">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-surface-50 mb-3">Questions</h2>
            <p className="text-sm text-surface-400 leading-relaxed">
              Feed problems, takedown requests, or a format you need that is not listed here — email{" "}
              <a href={`mailto:${BRAND_SUPPORT_EMAIL}`} className="text-brand-300 hover:text-brand-200">
                {BRAND_SUPPORT_EMAIL}
              </a>
              . If you are a publisher and one of your syndicated items should come down, a link is all we
              need; no formal process.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
