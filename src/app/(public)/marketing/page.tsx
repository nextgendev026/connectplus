import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  BadgeCheck,
  Brain,
  Flame,
  Globe2,
  Megaphone,
  PenLine,
  Radio,
  Search,
  Share2,
  Sparkles,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { cn, timeAgo } from "@/lib/utils";
import { coverSrc } from "@/lib/thumb";
import { formatCompact } from "@/lib/format-views";
import { BRAND_HASHTAG, BRAND_NAME, DEFAULT_OG_IMAGE, OG_CARD } from "@/lib/brand";
import { buildMarketingBrief, gatherMarketingSignals, marketingVoice, readableSubject } from "@/lib/marketing";
import { channelReadiness } from "@/lib/social-publish";
import { PageJsonLd } from "@/components/seo/PageJsonLd";
import { resolveSiteOrigin } from "@/lib/seo";

/**
 * The platform's own front door for itself.
 *
 * Not a brochure: every number on this page is read from the database at request
 * time, and the sections are the ones a marketer would otherwise have to be told
 * — what the hive has learned, which topics are heating up, where the coverage
 * gaps are, how accurate the sports model has actually been. It exists so the
 * product can argue for itself with evidence, and so the copy the engine writes
 * for Facebook and WhatsApp has a destination that isn't a generic about page.
 *
 * Rendered per request, never prerendered: a marketing page quoting yesterday's
 * counts is the exact failure it is meant to avoid.
 */
// Live platform facts, but no per-request state: no cookies, no session, no
// query params. Marked `force-dynamic`, this ran a full server render and its
// database queries for every visit and every crawl of a page whose numbers move
// over hours. ISR serves the same content from the CDN and revalidates behind
// the request, so the cost lands on a schedule instead of on each reader.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Why connectPlus",
  description:
    "East African stories, live football scores with a published model record, and radio — in one place. See what the platform is reading, what its hive mind has learned, and where the coverage gaps are.",
  keywords: [
    "East Africa news",
    "Kenya news platform",
    "live football scores Kenya",
    "African sports predictions",
    "online radio East Africa",
    "write for East Africa",
  ],
  alternates: { canonical: "/marketing" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title: `Why ${BRAND_NAME}`,
    description:
      "Stories, live scores and radio for East Africa — with a hive mind that reads the platform and a football model that publishes its own record.",
    url: "/marketing",
    images: [{ url: DEFAULT_OG_IMAGE, width: OG_CARD.width, height: OG_CARD.height, alt: `${BRAND_NAME} — East African stories, live scores and radio` }],
  },
  twitter: { card: "summary_large_image", images: [DEFAULT_OG_IMAGE] },
};

const PILLARS = [
  {
    icon: Globe2,
    title: "Stories from the region, syndicated hourly",
    body: "Kenyan and regional publishers feed the platform through the RSS pipeline, filtered for spam and filed by category — so the front page moves even on a quiet news day.",
  },
  {
    icon: Trophy,
    title: "Live scores with a model that shows its working",
    body: "Every fixture is priced by an ensemble that explains itself, and every pick is graded after the whistle. The record below is the real one, wins and losses alike.",
  },
  {
    icon: Brain,
    title: "A hive mind that reads the platform",
    body: "Publishing teaches the brain: it learns topics, engagement and language from what actually gets read, then feeds trending, recommendations and the marketing engine.",
  },
  {
    icon: Radio,
    title: "Radio that knows what is playing",
    body: "Station metadata is refreshed continuously, so now-playing and listener counts are current rather than typed in by hand.",
  },
  {
    icon: PenLine,
    title: "A studio built for writers",
    body: "A distraction-free editor, scheduled publishing, automatic topic tagging and cover generation — with an economy that shares revenue with the people who write.",
  },
  {
    icon: Search,
    title: "Search that understands meaning",
    body: "Stories are embedded semantically, so a search for a subject finds the pieces about it, not only the pieces containing the exact word.",
  },
];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
      <div className="text-2xl sm:text-3xl font-bold tracking-tight text-white">{value}</div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-surface-400">{label}</div>
      {hint ? <div className="mt-1 text-xs text-surface-500">{hint}</div> : null}
    </div>
  );
}

export default async function MarketingPage() {
  const [signals, voice, channels, origin] = await Promise.all([
    gatherMarketingSignals(),
    marketingVoice(),
    channelReadiness(),
    resolveSiteOrigin(),
  ]);

  const brief = buildMarketingBrief(signals, { hashtags: voice.hashtags });

  const latest = await prisma.post
    .findMany({
      where: { status: "PUBLISHED", moderationStatus: "APPROVED" },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        coverImage: true,
        viewCount: true,
        publishedAt: true,
        category: { select: { name: true, slug: true } },
        author: { select: { name: true, username: true } },
      },
      take: 4,
    })
    .catch(() => []);

  // The radar is built from the same signals the engine writes campaigns from:
  // trends that are rising, and categories carrying the least published weight.
  const radar = [
    ...signals.trends.slice(0, 4).map((t) => ({
      topic: readableSubject(t.subject),
      why: `${t.platform} ${t.platform === 1 ? "story" : "stories"} this week, heat ${t.velocity}/100`,
    })),
    ...signals.gaps
      .filter((g) => g.posts <= Math.max(1, Math.round(signals.counts.published / 20)))
      .slice(0, 3)
      .map((g) => ({
        topic: `${readableSubject(g.category)} — under-covered`,
        why: `${g.posts} published ${g.posts === 1 ? "story" : "stories"} on the whole platform`,
      })),
  ].slice(0, 6);

  const shareReady = channels.filter((c) => c.configured).map((c) => c.channel);

  const faq = [
    {
      q: `What is ${BRAND_NAME}?`,
      a: `${BRAND_NAME} is an East African publishing platform bringing together community journalism, live football scores with an explained model, and streaming radio in a single product.`,
    },
    {
      q: "How are the football predictions scored?",
      a: signals.sports.accuracy !== null
        ? `Picks are graded after each match. Across ${signals.sports.settled.toLocaleString()} settled selections the model has won ${signals.sports.accuracy}%, and the full record is published whether it flatters us or not.`
        : "Picks are graded after each match and the record is published whether it flatters us or not.",
    },
    {
      q: "Can I write on connectPlus?",
      a: "Yes. Anyone can publish, stories are reviewed before they go wide, and the studio includes scheduling, automatic tagging and cover generation.",
    },
    {
      q: "How does connectPlus promote its stories?",
      a: `New stories are shared to the platform's Facebook Page and prepared as WhatsApp story cards automatically, each link attributed with UTM parameters so the traffic that arrives can be traced back to the channel that carried it.`,
    },
  ];

  const faqJsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  }).replace(/</g, "\\u003c");

  return (
    <div className="min-h-screen bg-surface-950 text-surface-100">
      <PageJsonLd
        path="/marketing"
        title={`Why ${BRAND_NAME}`}
        description="Stories, live scores and radio for East Africa — with a hive mind that reads the platform and a football model that publishes its own record."
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd }} />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-mesh-gradient opacity-70" />
        <div className="relative mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-300">
            <Megaphone className="h-3.5 w-3.5" />
            The platform, described by its own numbers
          </div>
          <h1 className="mt-5 max-w-3xl text-4xl font-bold tracking-tight text-white sm:text-5xl">
            East Africa, reading and writing in one place — and the machinery to keep it moving.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-surface-300">
            {signals.counts.publishedLast7d} stories have been published in the last seven days. Below is what the
            platform is reading, what its hive mind has learned, and which subjects are still waiting for someone to
            write them.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/write"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-400"
            >
              <PenLine className="h-4 w-4" /> Start writing
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/5"
            >
              Read today&apos;s feed <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/sports"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/5"
            >
              Live scores <Trophy className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Stories published" value={formatCompact(signals.counts.published)} />
            <Stat label="Reads" value={formatCompact(signals.counts.views)} hint="across published stories" />
            <Stat label="Writers" value={formatCompact(signals.counts.writers)} />
            <Stat
              label="Model record"
              value={signals.sports.accuracy !== null ? `${signals.sports.accuracy}%` : "—"}
              hint={
                signals.sports.settled > 0
                  ? `${signals.sports.settled.toLocaleString()} settled picks`
                  : "graded after each match"
              }
            />
          </div>
        </div>
      </section>

      {/* What it does */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">What the platform actually does</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((pillar) => (
            <div key={pillar.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <pillar.icon className="h-5 w-5 text-brand-400" />
              <h3 className="mt-3 text-base font-semibold text-white">{pillar.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-surface-400">{pillar.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Live evidence */}
      <section className="border-y border-white/5 bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-300">
            <Sparkles className="h-3.5 w-3.5" /> What the brain knows right now
          </div>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {signals.hive.online
              ? `${formatCompact(signals.hive.memories)} things learned, and what the region is reading`
              : "What the region is reading"}
          </h2>
          <p className="mt-3 max-w-3xl text-sm text-surface-400">{brief.summary}</p>

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-surface-400">Heating up</h3>
              <ul className="mt-3 space-y-2">
                {signals.trends.length === 0 ? (
                  <li className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-surface-400">
                    Trend signals appear here as the platform learns from what is being read.
                  </li>
                ) : (
                  signals.trends.slice(0, 6).map((trend) => (
                    <li
                      key={trend.subject}
                      className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-white">
                        <Flame className="h-4 w-4 text-brand-400" />
                        {readableSubject(trend.subject)}
                      </span>
                      <span className="shrink-0 text-xs text-surface-400">
                        {trend.platform} {trend.platform === 1 ? "story" : "stories"} · {trend.velocity}/100
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-surface-400">Most read right now</h3>
              {signals.topStory ? (
                <Link
                  href={`/article/${signals.topStory.slug}`}
                  className="mt-3 block rounded-xl border border-brand-500/25 bg-brand-500/5 p-4 transition-colors hover:bg-brand-500/10"
                >
                  <div className="text-xs font-semibold text-brand-300">
                    {formatCompact(signals.topStory.views)} views
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">{signals.topStory.title}</div>
                </Link>
              ) : (
                <p className="mt-3 text-sm text-surface-400">Nothing has been read yet today.</p>
              )}

              <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-surface-400">Proof points</h3>
              <ul className="mt-3 space-y-1.5 text-sm text-surface-300">
                {brief.proofPoints.slice(0, 4).map((point) => (
                  <li key={point} className="flex gap-2">
                    <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Editorial radar */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-300">
          <TrendingUp className="h-3.5 w-3.5" /> Editorial radar
        </div>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Subjects the platform is waiting to publish
        </h2>
        <p className="mt-3 max-w-3xl text-sm text-surface-400">
          Generated from live trends and the categories carrying the least weight. Writers keep their own angle — this
          is a starting point with evidence behind it, not an assignment.
        </p>
        {radar.length === 0 ? (
          <p className="mt-6 text-sm text-surface-400">The radar fills as the platform gathers reading history.</p>
        ) : (
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {radar.map((item) => (
              <div key={item.topic} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-sm font-semibold text-white">{item.topic}</div>
                <div className="mt-1 text-xs text-surface-400">{item.why}</div>
                <Link
                  href={`/write?topic=${encodeURIComponent(item.topic)}`}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-300 hover:text-brand-200"
                >
                  Write this <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Latest stories */}
      {latest.length > 0 ? (
        <section className="border-y border-white/5 bg-white/[0.02]">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Published most recently</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {latest.map((post) => (
                <Link
                  key={post.id}
                  href={`/article/${post.slug}`}
                  className="group flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.06]"
                >
                  <Image
                    src={coverSrc(post.coverImage, {
                      title: post.title,
                      seed: post.id,
                      category: post.category?.name,
                    })}
                    alt=""
                    width={128}
                    height={96}
                    className="h-24 w-32 shrink-0 rounded-xl object-cover"
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-300">
                      {post.category?.name ?? "Story"}
                    </div>
                    <div className="mt-1 line-clamp-2 text-sm font-semibold text-white group-hover:text-brand-200">
                      {post.title}
                    </div>
                    <div className="mt-2 text-xs text-surface-400">
                      {post.author.name ?? post.author.username} · {formatCompact(post.viewCount)} views
                      {post.publishedAt ? ` · ${timeAgo(post.publishedAt)}` : ""}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Sharing + channels (SEO: names the distribution that exists) */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-300">
              <Share2 className="h-3.5 w-3.5" /> Distribution
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-white">Stories travel on their own</h2>
            <p className="mt-3 text-sm leading-relaxed text-surface-400">
              Every published story is composed into a share message and sent to the channels enabled for this
              deployment — the Facebook Page directly, and WhatsApp as a story card plus a one-tap share. Each link
              carries <code className="rounded bg-white/10 px-1 py-0.5 text-xs">utm_source</code> naming the channel it
              travelled through, so arriving traffic can be traced rather than guessed at, and every message carries{" "}
              <span className="text-brand-300">#{BRAND_HASHTAG}</span> for the platforms that strip links.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {(channels.length > 0 ? channels.map((c) => c.channel) : ["facebook", "whatsapp", "story"]).map(
                (channel) => (
                  <span
                    key={channel}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                      shareReady.includes(channel as never)
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                        : "border-white/15 bg-white/5 text-surface-300"
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        shareReady.includes(channel as never) ? "bg-emerald-400" : "bg-surface-500"
                      )}
                    />
                    {channel}
                  </span>
                )
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="text-base font-semibold text-white">Questions people ask</h3>
            <dl className="mt-4 space-y-4">
              {faq.map((item) => (
                <div key={item.q}>
                  <dt className="text-sm font-semibold text-white">{item.q}</dt>
                  <dd className="mt-1 text-sm text-surface-400">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Close */}
      <section className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-5 py-14 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">Put your name on the next story</h2>
            <p className="mt-1 text-sm text-surface-400">
              {origin.replace(/^https?:\/\//, "")} · stories, radio and live scores in one place.
            </p>
          </div>
          <Link
            href="/write"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-400"
          >
            Open the studio <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
