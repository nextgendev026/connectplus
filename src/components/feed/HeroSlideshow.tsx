"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { cn, timeAgo } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Eye,
} from "lucide-react";

export interface HeroSlide {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  coverImage: string | null;
  category: { name: string; slug: string } | null;
  author: { name: string | null; username: string };
  createdAt: Date;
  viewCount: number;
}

interface HeroSlideshowProps {
  slides: HeroSlide[];
  stats: { writers: number; stories: number; cities: number };
}

const FALLBACK_TITLE = ["Stories", "that", "connect", "East", "Africa"];
const FALLBACK_SUBTITLE =
  "Discover perspectives on technology, culture, business, and lifestyle from Nairobi to Kigali, Kampala to Dar es Salaam. Written by the people shaping the region.";

const AUTOPLAY_MS = 7000;

export function HeroSlideshow({ slides, stats }: HeroSlideshowProps) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const usable = slides.filter((s) => s.coverImage);
  const count = usable.length;

  const go = useCallback(
    (dir: 1 | -1) => {
      if (count === 0) return;
      setActive((prev) => (prev + dir + count) % count);
    },
    [count]
  );

  useEffect(() => {
    if (count === 0 || paused) return;
    const t = setInterval(() => setActive((prev) => (prev + 1) % count), AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [count, paused]);

  if (count === 0) {
    return (
      <section className="relative min-h-screen flex items-center overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-mesh-gradient" />
          <div className="absolute inset-0 bg-hero-gradient opacity-60" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 w-full pt-32 md:pt-24 pb-20">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-500/10 border border-brand-500/20 px-4 py-1.5 mb-8 animate-fade-in-up">
              <span className="text-xs font-medium text-brand-400">
                The Home of East African Stories
              </span>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-7xl font-display font-bold tracking-tight leading-[1.05] mb-6">
              {FALLBACK_TITLE.map((word, i) => (
                <span
                  key={i}
                  className={cn(
                    "inline-block mr-[0.3em] animate-word-in",
                    word === "connect"
                      ? "text-transparent bg-clip-text bg-gradient-to-r from-brand-400 via-brand-500 to-accent-cyan"
                      : "text-surface-50"
                  )}
                  style={{ animationDelay: `${0.1 + i * 0.12}s` }}
                >
                  {word}
                </span>
              ))}
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-surface-400 leading-relaxed max-w-xl mb-8 animate-fade-in-up animation-delay-800">
              {FALLBACK_SUBTITLE}
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 mb-16 animate-fade-in-up animation-delay-1000">
              <Link
                href="/studio"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white hover:bg-brand-600 transition-all shadow-glow hover:shadow-glow-lg hover:scale-[1.02] active:scale-[0.98]"
              >
                Start Writing
              </Link>
              <a
                href="#feed"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-surface-700 px-6 py-3.5 text-sm font-medium text-surface-300 hover:bg-surface-800/50 hover:border-surface-600 hover:text-surface-50 transition-all"
              >
                Explore Stories
              </a>
            </div>
            <HeroStats stats={stats} />
          </div>
        </div>
      </section>
    );
  }

  const slide = usable[active] ?? usable[0]!;

  return (
    <section
      className="relative min-h-screen flex items-center overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Slide backgrounds */}
      {usable.map((s, i) => (
        <div
          key={s.id}
          className={cn(
            "absolute inset-0 transition-opacity duration-1000",
            i === active ? "opacity-100" : "opacity-0"
          )}
        >
          <img
            src={s.coverImage ?? ""}
            alt=""
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface-950 via-surface-950/75 to-surface-950/40" />
          <div className="absolute inset-0 bg-surface-950/20" />
        </div>
      ))}

      {/* Floating shapes */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[15%] right-[10%] w-72 h-72 bg-brand-500/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-[15%] right-[30%] w-48 h-48 bg-accent-cyan/10 rounded-full blur-3xl animate-float-delayed" />
      </div>

      {/* Slide content */}
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 w-full pt-32 md:pt-24 pb-28">
        <div key={slide.id} className="max-w-3xl animate-fade-in-up">
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/15 border border-brand-500/30 px-3.5 py-1 text-xs font-medium text-brand-400 backdrop-blur-sm">
              {slide.category?.name ?? "Featured story"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-950/40 border border-surface-700/50 px-3 py-1 text-[11px] text-surface-300">
              <Eye className="w-3 h-3" />
              {slide.viewCount.toLocaleString()} reads
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-7xl font-display font-bold tracking-tight leading-[1.05] mb-6 text-surface-50 drop-shadow-lg">
            {slide.title}
          </h1>

          <p className="text-base sm:text-lg md:text-xl text-surface-300 leading-relaxed max-w-2xl mb-8 line-clamp-3">
            {slide.excerpt ?? slide.title}
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-12">
            <Link
              href={`/article/${slide.slug}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white hover:bg-brand-600 transition-all shadow-glow hover:shadow-glow-lg hover:scale-[1.02] active:scale-[0.98] w-fit"
            >
              Read Story
              <ArrowRight className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-medium text-surface-200">
                by {slide.author.name ?? slide.author.username}
              </span>
              <span className="w-1 h-1 rounded-full bg-surface-600" />
              <span className="text-xs text-surface-400">
                {timeAgo(slide.createdAt.toISOString())}
              </span>
            </div>
          </div>

          <HeroStats stats={stats} />
        </div>
      </div>

      {/* Arrows */}
      <div className="absolute right-4 sm:right-8 bottom-8 flex items-center gap-2 z-10">
        <button
          onClick={() => go(-1)}
          aria-label="Previous story"
          className="p-2.5 rounded-full bg-surface-950/50 border border-surface-700/60 text-surface-300 hover:text-surface-50 hover:border-brand-500/40 hover:bg-surface-900/70 transition-all backdrop-blur-sm"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => go(1)}
          aria-label="Next story"
          className="p-2.5 rounded-full bg-surface-950/50 border border-surface-700/60 text-surface-300 hover:text-surface-50 hover:border-brand-500/40 hover:bg-surface-900/70 transition-all backdrop-blur-sm"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Dots */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
        {usable.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setActive(i)}
            aria-label={`Show slide ${i + 1}`}
            className={cn(
              "h-1.5 rounded-full transition-all duration-500",
              i === active
                ? "w-8 bg-brand-400"
                : "w-3 bg-surface-600 hover:bg-surface-400"
            )}
          />
        ))}
      </div>
    </section>
  );
}

function HeroStats({
  stats,
}: {
  stats: { writers: number; stories: number; cities: number };
}) {
  return (
    <div className="grid grid-cols-3 gap-4 sm:gap-8 max-w-md animate-fade-in-up">
      <div>
        <span className="text-xl sm:text-2xl md:text-3xl font-bold text-surface-50 font-display">
          {stats.writers.toLocaleString()}+
        </span>
        <p className="text-xs sm:text-sm text-surface-400">Writers</p>
      </div>
      <div>
        <span className="text-xl sm:text-2xl md:text-3xl font-bold text-surface-50 font-display">
          {stats.stories.toLocaleString()}+
        </span>
        <p className="text-xs sm:text-sm text-surface-400">Stories</p>
      </div>
      <div>
        <span className="inline-flex items-center gap-1.5 text-xl sm:text-2xl md:text-3xl font-bold text-surface-50 font-display">
          {stats.cities}
        </span>
        <p className="text-xs sm:text-sm text-surface-400">
          Cities Connected
        </p>
      </div>
    </div>
  );
}