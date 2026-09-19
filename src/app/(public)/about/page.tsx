import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Globe2, PenLine, Radio, Search, Shield, Sparkles, Trophy, Users } from "lucide-react";
import { formatCompact } from "@/lib/format-views";
import { resolveSiteOrigin } from "@/lib/seo";
import { BRAND_NAME } from "@/lib/brand";
import { getPlatformFacts } from "@/lib/platform-facts";
import { StatGrid } from "@/components/ui/StatGrid";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About",
  description:
    "connectPlus is a modern social blogging platform connecting East Africa through stories, ideas, and perspectives — with live radio, real-time football scores, and a hive mind that learns from what the region reads.",
  alternates: { canonical: "/about" },
  robots: { index: true, follow: true },
};

export default async function AboutPage() {
  const [origin, facts] = await Promise.all([resolveSiteOrigin(), getPlatformFacts()]);
  const { publishedStories, writers, reads, categories, accuracy } = facts;

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND_NAME,
    url: origin,
    description: "East African publishing platform — stories, live radio, real-time football scores and model-generated betting insight.",
    foundingLocation: { "@type": "Place", name: "Nairobi, Kenya" },
    sameAs: [],
  }).replace(/</g, "\\u003c");

  // A fact that could not be read is omitted rather than rendered as zero, so
  // the page never claims "0 writers" because a query was briefly unavailable.
  const stats = [
    { label: "Stories published", value: publishedStories, icon: PenLine },
    { label: "Writers", value: writers, icon: Users },
    { label: "Reads", value: reads, icon: Globe2 },
    { label: "Categories", value: categories, icon: Shield },
    { label: "Model accuracy", value: accuracy, suffix: "%", icon: Trophy },
  ]
    .filter((s) => s.value !== null)
    .map((s) => ({ label: s.label, value: `${formatCompact(s.value as number)}${s.suffix ?? ""}`, icon: s.icon }));

  return (
    <div className="min-h-screen bg-surface-950">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-mesh-gradient" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/40 to-black/70" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 py-16 md:py-24">
          <nav className="mb-8 flex items-center gap-1.5 text-xs text-white/60">
            {/* `py-1.5` on the crumb: a breadcrumb link is a control, and at
                16px tall it was the smallest thing on the page. */}
            <Link href="/" className="py-1.5 transition-colors hover:text-brand-300">
              Home
            </Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-white/70">About</span>
          </nav>

          <div className="inline-flex items-center gap-2 rounded-full bg-brand-500/10 border border-brand-500/20 px-4 py-1.5 mb-6">
            <Sparkles className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-xs font-medium text-brand-400">{BRAND_NAME}</span>
          </div>

          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-tight text-white mb-4">
            East Africa, reading and writing in one place
          </h1>
          <p className="text-base sm:text-lg text-white/75 leading-relaxed max-w-2xl">
            connectPlus is where East African voices come alive — from the tech startups of Nairobi to the music scenes of Kampala, from Kigali&apos;s coffee farms to Dar es Salaam&apos;s coast. We connect readers with writers who are shaping the region today.
          </p>
        </div>
      </div>

      {/* Live stats */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 -mt-4">
        <StatGrid stats={stats} columns={5} />
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-20 mt-8">
        <div className="rounded-3xl border border-surface-800/60 bg-surface-900/50 p-6 sm:p-10 shadow-card-hover">
          {/* Mission */}
          <section>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-surface-50 mb-3 flex items-center gap-2.5">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-brand-500/10 border border-brand-500/20 shrink-0">
                <span className="w-2 h-2 rounded-full bg-brand-400" />
              </span>
              Our mission
            </h2>
            <div className="prose prose-sm sm:prose-base max-w-none">
              <p>
                connectPlus exists to make East African voices impossible to ignore. Every story published on the platform is filtered for spam, filed by category, and surfaced by what the community actually reads — not by an algorithm that has never visited the region.
              </p>
            </div>
          </section>

          {/* What we build */}
          <section className="mt-10 border-t border-surface-800/60 pt-10">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-surface-50 mb-3 flex items-center gap-2.5">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-brand-500/10 border border-brand-500/20 shrink-0">
                <span className="w-2 h-2 rounded-full bg-brand-400" />
              </span>
              What we build
            </h2>
            <div className="prose prose-sm sm:prose-base max-w-none">
              <p>A social blogging platform with five things at its heart:</p>
              <ul>
                <li><strong>Writing without barriers</strong> — a focused studio where your words lead the way, with scheduled publishing, automatic tagging, and cover generation</li>
                <li><strong>Discovery built on community</strong> — trending topics, categories, and writers worth following, ranked by what gets read</li>
                <li><strong>Live radio</strong> — station metadata refreshed continuously, so now-playing and listener counts are current</li>
                <li><strong>Football scores with a published model</strong> — every fixture priced by an ensemble that explains itself, every pick graded after the whistle</li>
                <li><strong>A story economy</strong> — writers get rewarded for engagement, joined-up thinking, and honest voices</li>
              </ul>
            </div>
          </section>

          {/* Who it is for */}
          <section className="mt-10 border-t border-surface-800/60 pt-10">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-surface-50 mb-3 flex items-center gap-2.5">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-brand-500/10 border border-brand-500/20 shrink-0">
                <span className="w-2 h-2 rounded-full bg-brand-400" />
              </span>
              Who it is for
            </h2>
            <div className="prose prose-sm sm:prose-base max-w-none">
              <p>
                Students, journalists, creators, founders, and everyday East Africans. If you can tell a story, there is a place for you here. Every writer starts equal, and the community decides what rises.
              </p>
            </div>
          </section>

          {/* Where we're going */}
          <section className="mt-10 border-t border-surface-800/60 pt-10">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-surface-50 mb-3 flex items-center gap-2.5">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-brand-500/10 border border-brand-500/20 shrink-0">
                <span className="w-2 h-2 rounded-full bg-brand-400" />
              </span>
              Where we&apos;re going
            </h2>
            <div className="prose prose-sm sm:prose-base max-w-none">
              <p>
                We&apos;re growing node by node — Nairobi, Kampala, Dar es Salaam, Kigali and beyond. Every new city we connect adds a new perspective to the conversation, and makes the region at large feel a little smaller.
              </p>
            </div>
          </section>

          {/* How it works (new) */}
          <section className="mt-10 border-t border-surface-800/60 pt-10">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-surface-50 mb-3 flex items-center gap-2.5">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-brand-500/10 border border-brand-500/20 shrink-0">
                <span className="w-2 h-2 rounded-full bg-brand-400" />
              </span>
              How the platform works
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 mt-4">
              {[
                { icon: Globe2, title: "Syndicated hourly", body: "Kenyan and regional publishers feed the platform through RSS, filtered for spam and filed by category." },
                { icon: Search, title: "Search that understands meaning", body: "Stories are embedded semantically, so a search for a subject finds the pieces about it, not only the ones containing the exact word." },
                { icon: Radio, title: "Radio that knows what is playing", body: "Station metadata is refreshed continuously, so now-playing and listener counts are current rather than typed in by hand." },
                { icon: Trophy, title: "A model that shows its working", body: "Every prediction arrives with its reasoning, and the full record is published whether it flatters us or not." },
              ].map((item) => (
                <div key={item.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <item.icon className="h-4 w-4 text-brand-400" />
                  <h3 className="mt-2 text-sm font-semibold text-white">{item.title}</h3>
                  <p className="mt-1 text-xs text-surface-400">{item.body}</p>
                </div>
              ))}
            </div>
          </section>

          <p className="mt-10 pt-6 border-t border-surface-800/60 text-xs text-surface-500">
            Numbers are live from the platform. Last updated: {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.
          </p>
        </div>
      </div>
    </div>
  );
}
