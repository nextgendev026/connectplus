"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Activity, CalendarDays, LineChart, Radio, Sparkles, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import ScoresBoard from "./ScoresBoard";
import BettingTips from "./BettingTips";
import MatchCentre from "./MatchCentre";
import MatchCalendar from "./MatchCalendar";

type Tab = "scores" | "analysis" | "tips" | "calendar";
const TABS: Tab[] = ["scores", "analysis", "tips", "calendar"];

/**
 * The four boards, described the way a reader would describe them.
 *
 * `hint` is what the tab means in one word — "Live now", "Picks + why" — because
 * "Match centre" and "Model picks" are our words, not the reader's.
 */
const TAB_META: Record<Tab, { label: string; hint: string; icon: typeof Activity }> = {
  scores: { label: "Scores", hint: "Live now", icon: Activity },
  analysis: { label: "Analysis", hint: "Deep dive", icon: LineChart },
  tips: { label: "Tips", hint: "Picks + why", icon: Sparkles },
  calendar: { label: "Fixtures", hint: "What's on", icon: CalendarDays },
};

/**
 * Sports hub shell.
 *
 * Four boards share one frame: **Scores** (the live board), **Analysis** (the
 * match centre, where fixtures are pinned side by side), **Tips** (the model's
 * picks, each with the reasons behind it) and **Fixtures** (the calendar). The
 * active tab lives in the URL (`?tab=tips`) so any view can be shared or linked
 * from a notification.
 *
 * The switcher is a sibling of the hero, not a child of it, and that is load
 * bearing: a `position: sticky` element only pins inside its nearest scrolling
 * ancestor, and the hero is `overflow-hidden` so its decorative glows can be
 * clipped. Nested there, the switcher could never escape the hero's box and
 * scrolled away with it — which is why the menu felt like it was in the wrong
 * place on a phone.
 *
 * The root carries `.sports-desk`, which is what applies the desk's type scale
 * (see globals.css): the board is the densest surface in the app and it was
 * written at 9–11px, so every size here is scaled by one multiplier — 1.1875
 * after the 5% reduction — and every weight moves one step up in one place
 * rather than in a hundred class names.
 */
export default function SportsHub({
  heroAd,
  inlineAd,
  sidebarAd,
}: {
  heroAd?: ReactNode;
  inlineAd?: ReactNode;
  sidebarAd?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("scores");
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (!requested || !TABS.includes(requested as Tab)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the ?tab= deep link
    setTab(requested as Tab);
  }, []);

  /**
   * Publish the switcher's real height as `--sports-nav-h`.
   *
   * The board toolbars pin at `navbar + switcher`, and that offset used to be a
   * number written by hand in globals.css. It was wrong in both directions: the
   * desk's type scale makes the switcher taller than the literal classes
   * suggest, so on a phone the toolbars pinned *behind* the switcher and on a
   * tablet they floated in a gap below it. Measuring removes the guess — a copy
   * tweak, a longer label or a change to the type scale can no longer silently
   * break the pinning.
   */
  useEffect(() => {
    const el = navRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const publish = () => {
      const next = `${Math.round(el.getBoundingClientRect().height) / 16}rem`;
      const root = el.parentElement;
      if (root && root.style.getPropertyValue("--sports-nav-h") !== next) {
        root.style.setProperty("--sports-nav-h", next);
      }
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function go(next: Tab) {
    setTab(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", next === "scores" ? "/sports" : `/sports?tab=${next}`);
      // A tab change is a new page's worth of content in the same document, so
      // the reader belongs at the top of it rather than wherever the last one
      // left them.
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <div className="sports-desk min-h-screen bg-surface-950 pb-16 text-surface-50">
      <section className="relative overflow-hidden border-b border-surface-800/60 bg-gradient-to-br from-surface-900 via-surface-950 to-surface-900">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, #ffffff 0 1px, transparent 1px 60px)" }}
        />
        <div className="pointer-events-none absolute -left-24 -top-16 h-72 w-72 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-10 bottom-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />

        <div className="relative mx-auto w-full max-w-[1600px] px-3 pb-5 pt-4 sm:px-6 sm:pt-8 xl:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-300">
                  <Trophy className="h-3 w-3" />
                  Sports
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-surface-700 bg-surface-900/60 px-2.5 py-1 text-[11px] font-medium text-surface-400">
                  <Radio className="h-3 w-3 text-red-400" />
                  Updating live
                </span>
                <Link
                  href="/trending"
                  className="ml-auto hidden text-[11px] font-medium text-surface-400 transition hover:text-surface-50 sm:inline"
                >
                  News
                </Link>
              </div>

              <h1 className="mt-2.5 text-xl font-black tracking-tight text-surface-50 sm:text-4xl">
                Scores, picks &amp; the reasons
              </h1>
              {/* One sentence. The old copy listed the whole feature set, which
                  is what made the top of this page read like a spec sheet. */}
              <p className="mt-1.5 max-w-2xl text-[13px] text-surface-400 sm:text-sm">
                Live football and basketball, our model&apos;s prediction for every match, and why it made it.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/*
        The board switcher, pinned directly beneath the hero on every screen.

        Sits outside the hero so `position: sticky` can reach the viewport, at a
        `top` that keeps it just under the app navbar for the rest of the page —
        the menu for a board stays with the board it switches rather than
        scrolling out of reach at the top of a very long page.
      */}
      <nav
        ref={navRef}
        aria-label="Sports boards"
        className="sports-nav relative z-40 border-b border-surface-800/60 bg-surface-950/95 shadow-[0_6px_20px_-14px_rgb(0_0_0_/_0.9)] backdrop-blur"
      >
        <div className="mx-auto flex w-full max-w-[1600px] items-stretch gap-1 px-3 sm:gap-2 sm:px-6 sm:py-1.5 xl:px-8">
          {TABS.map((id) => (
            <TabButton key={id} id={id} active={tab === id} onClick={() => go(id)} />
          ))}
        </div>
      </nav>

      {heroAd ? <div className="mx-auto w-full max-w-[1600px] px-3 pt-4 sm:px-6 xl:px-8">{heroAd}</div> : null}

      {/* Keyed so a tab change reads as a new board arriving, not a silent swap. */}
      <div key={tab} className="motion-safe:animate-rise">
        {tab === "scores" ? (
          <ScoresBoard inlineAd={inlineAd} sidebarAd={sidebarAd} />
        ) : tab === "analysis" ? (
          <MatchCentre />
        ) : tab === "calendar" ? (
          <MatchCalendar />
        ) : (
          <BettingTips inlineAd={inlineAd} sidebarAd={sidebarAd} />
        )}
      </div>

    </div>
  );
}

/**
 * One board in the switcher.
 *
 * A phone gets a short two-line button — icon over a label — and deliberately
 * drops the one-word hint, because a 12px hint line plus the desk's type scale
 * made the bar about 90px tall and ate the top of every board underneath it.
 * From `sm` up there is room for the full card: hint included, icon beside the
 * label. Both still stretch to fill the bar, so the four are always one even row
 * and neither shape jumps as the page scrolls.
 */
function TabButton({ id, active, onClick }: { id: Tab; active: boolean; onClick: () => void }) {
  const meta = TAB_META[id];
  const Icon = meta.icon;
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      aria-label={`${meta.label} — ${meta.hint}`}
      className={cn(
        "group relative flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center transition duration-200 sm:flex-none sm:flex-row sm:gap-2.5 sm:px-3 sm:text-left",
        active
          ? "bg-brand-500 text-white shadow-lg shadow-brand-500/20"
          : "text-surface-400 hover:bg-surface-900/70 hover:text-surface-50"
      )}
    >
      {active ? (
        <span className="absolute inset-x-6 -top-2 h-0.5 rounded-full bg-brand-400 sm:hidden" />
      ) : null}
      <span
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-lg transition sm:h-8 sm:w-8",
          active ? "bg-white/15 text-white" : "bg-surface-800/70 text-surface-400 group-hover:text-surface-200"
        )}
      >
        <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center justify-center gap-1.5 text-[11px] font-semibold sm:justify-start sm:text-sm">
          {meta.label}
        </span>
        <span
          className={cn(
            "hidden truncate text-[10px] uppercase tracking-wider sm:block",
            active ? "text-white/70" : "text-surface-600"
          )}
        >
          {meta.hint}
        </span>
      </span>
    </button>
  );
}
