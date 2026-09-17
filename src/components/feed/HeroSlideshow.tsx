"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn, timeAgo } from "@/lib/utils";
import { ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { coverSrc } from "@/lib/thumb";
import { ViewCount } from "@/components/ui/ViewCount";

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
/** Phones get a longer dwell between slides — the crossfade should read as
 *  ambient, not as a carousel demanding attention while you read. */
const AUTOPLAY_MS_MOBILE = 11000;
const MOBILE_QUERY = "(max-width: 767px)";
const SWIPE_THRESHOLD_PX = 48;

export function HeroSlideshow({ slides, stats }: HeroSlideshowProps) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Only animate while the hero actually occupies the viewport. Off-screen it
  // used to keep swapping slides (and re-decoding images) while the reader was
  // scrolled down the feed, which is the "intrusive to the interior page" feel.
  const [inView, setInView] = useState(true);
  const sectionRef = useRef<HTMLElement>(null);
  const touchStartX = useRef<number | null>(null);

  // Every published story can headline the hero — generated thumbnails cover
  // the no-cover-image case, so we never drop slides.
  const usable = slides;
  const count = usable.length;

  const go = useCallback(
    (dir: 1 | -1) => {
      if (count === 0) return;
      setActive((prev) => (prev + dir + count) % count);
    },
    [count]
  );

  // Track the viewport preferences that change how (and whether) we animate.
  useEffect(() => {
    const mqMobile = window.matchMedia(MOBILE_QUERY);
    const mqReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setIsMobile(mqMobile.matches);
      setReducedMotion(mqReduced.matches);
    };
    sync();
    mqMobile.addEventListener("change", sync);
    mqReduced.addEventListener("change", sync);
    return () => {
      mqMobile.removeEventListener("change", sync);
      mqReduced.removeEventListener("change", sync);
    };
  }, []);

  // Pause while the hero is mostly scrolled out of sight.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting) && (entry?.intersectionRatio ?? 0) >= 0.5),
      { threshold: [0, 0.5, 1] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [count]);

  useEffect(() => {
    if (count <= 1 || paused || reducedMotion || !inView) return;
    const delay = isMobile ? AUTOPLAY_MS_MOBILE : AUTOPLAY_MS;
    // `active` in the deps makes this a dwell timer rather than a fixed
    // interval: after any change — auto or a reader tapping the dots — the
    // full delay restarts instead of firing again a moment later.
    const t = setTimeout(() => setActive((prev) => (prev + 1) % count), delay);
    return () => clearTimeout(t);
  }, [count, paused, reducedMotion, inView, isMobile, active]);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
    setPaused(true);
  }

  function handleTouchEnd(e: React.TouchEvent) {
    setPaused(false);
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    const dx = end - start;
    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX) go(dx < 0 ? 1 : -1);
  }

  if (count === 0) {
    return (
      <section className="hero-viewport relative flex items-center overflow-hidden">
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
  // On a phone (or with reduced motion) a slide swap is a plain crossfade. The
  // fade-in-up on desktop keeps the more editorial entrance.
  const softSwap = isMobile || reducedMotion;
  // The outgoing image fades under the incoming one; phones get a slightly
  // slower, calmer crossfade than desktop.
  const imageFade = isMobile ? "duration-[900ms]" : "duration-1000";

  return (
    <section
      ref={sectionRef}
      className="hero-viewport relative flex items-center overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => {
        touchStartX.current = null;
        setPaused(false);
      }}
    >
      {/* Slide backgrounds — only render the active + adjacent slide images
          to avoid preloading every slide at once (saves mobile data). */}
      {usable.map((s, i) => {
        const distance = Math.abs(i - active);
        const isVisible = distance <= 1;
        if (!isVisible) return null;
        return (
          <div
            key={s.id}
            className={cn(
              "absolute inset-0 transition-opacity ease-out",
              imageFade,
              i === active ? "opacity-100" : "opacity-0"
            )}
          >
            <Image
              src={s.coverImage ?? coverSrc(null, { title: s.title, category: s.category?.name, seed: s.slug })}
              alt=""
              fill
              sizes="100vw"
              priority={i === active}
              loading={i === active ? "eager" : "lazy"}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/75 to-black/40" />
            <div className="absolute inset-0 bg-black/20" />
          </div>
        );
      })}

      {/* Floating shapes — desktop ambience only; on a phone they are pure
          decoration that costs paint while you scroll. */}
      <div className="pointer-events-none absolute inset-0 hidden overflow-hidden md:block">
        <div className="absolute top-[15%] right-[10%] w-72 h-72 bg-brand-500/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-[15%] right-[30%] w-48 h-48 bg-accent-cyan/10 rounded-full blur-3xl animate-float-delayed" />
      </div>

      {/* Slide content */}
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 w-full pt-32 md:pt-24 pb-28">
        <div
          key={slide.id}
          className={cn("max-w-3xl", softSwap ? "animate-fade-in-soft" : "animate-fade-in-up")}
        >
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/15 border border-brand-500/30 px-3.5 py-1 text-xs font-medium text-brand-400 backdrop-blur-sm">
              {slide.category?.name ?? "Featured story"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-black/40 border border-white/20 px-3 py-1 text-[11px] text-white/80 backdrop-blur-sm">
              <ViewCount value={slide.viewCount} size="md" />
            </span>
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-7xl font-display font-bold tracking-tight leading-[1.08] md:leading-[1.05] mb-4 sm:mb-6 text-white drop-shadow-lg">
            {slide.title}
          </h1>

          <p className="text-base sm:text-lg md:text-xl text-white/85 leading-relaxed max-w-2xl mb-6 sm:mb-8 line-clamp-3">
            {slide.excerpt ?? slide.title}
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-10 sm:mb-12">
            <Link
              href={`/article/${slide.slug}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white hover:bg-brand-600 transition-all shadow-glow hover:shadow-glow-lg hover:scale-[1.02] active:scale-[0.98] w-fit"
            >
              Read Story
              <ArrowRight className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-medium text-white/90">
                by {slide.author.name ?? slide.author.username}
              </span>
              <span className="w-1 h-1 rounded-full bg-white/40" />
              <span className="text-xs text-white/60">
                {timeAgo(slide.createdAt.toISOString())}
              </span>
            </div>
          </div>

          <HeroStats stats={stats} />
        </div>
      </div>

      {/* Arrows — hidden on touch screens, where swiping and the dots are the
          natural controls and two floating buttons just add clutter. */}
      <div className="absolute right-4 sm:right-8 bottom-8 hidden sm:flex items-center gap-2 z-10">
        <button
          onClick={() => go(-1)}
          aria-label="Previous story"
          className="p-2.5 rounded-full bg-black/50 border border-white/25 text-white/80 hover:text-white hover:border-brand-400/60 hover:bg-black/70 transition-all backdrop-blur-sm"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => go(1)}
          aria-label="Next story"
          className="p-2.5 rounded-full bg-black/50 border border-white/25 text-white/80 hover:text-white hover:border-brand-400/60 hover:bg-black/70 transition-all backdrop-blur-sm"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Dots — the primary slide control on mobile, so the tap targets are a
          little larger there. */}
      <div className="absolute bottom-6 sm:bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2.5 sm:gap-2 z-10">
        {usable.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setActive(i)}
            aria-label={`Show slide ${i + 1}`}
            aria-current={i === active}
            className="group p-1.5 -m-0.5"
          >
            <span
              className={cn(
                "block h-1.5 rounded-full transition-all duration-500",
                i === active ? "w-8 bg-brand-400" : "w-3 bg-white/30 group-hover:bg-white/70"
              )}
            />
          </button>
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
        <span className="text-xl sm:text-2xl md:text-3xl font-bold text-white font-display">
          {stats.writers.toLocaleString()}+
        </span>
        <p className="text-xs sm:text-sm text-white/60">Writers</p>
      </div>
      <div>
        <span className="text-xl sm:text-2xl md:text-3xl font-bold text-white font-display">
          {stats.stories.toLocaleString()}+
        </span>
        <p className="text-xs sm:text-sm text-white/60">Stories</p>
      </div>
      <div>
        <span className="inline-flex items-center gap-1.5 text-xl sm:text-2xl md:text-3xl font-bold text-white font-display">
          {stats.cities}
        </span>
        <p className="text-xs sm:text-sm text-white/60">
          Cities Connected
        </p>
      </div>
    </div>
  );
}
