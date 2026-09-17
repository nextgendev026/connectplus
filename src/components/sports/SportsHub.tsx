"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Activity, ArrowRight, CalendarDays, LineChart, Radio, Sparkles, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import ScoresBoard from "./ScoresBoard";
import BettingTips from "./BettingTips";
import MatchCentre from "./MatchCentre";
import MatchCalendar from "./MatchCalendar";
import LiveTicker from "./LiveTicker";

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
 *
 * ## Why the switcher moves
 *
 * A four-tab bar that just swaps a background colour tells the reader nothing
 * about where they are relative to the other boards. Here the highlight is a
 * single element that *travels* to the tab you picked, the tab you picked lifts
 * its icon, and the bar answers the arrow keys and a sideways swipe on a phone.
 * All three are the same idea — the switcher should feel like one control you
 * move, not four buttons that each happen to be on or off.
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
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement | null>());
  /**
   * The travelling highlight's geometry, in the bar's own coordinate space.
   *
   * Height and top are measured, not stretched. The highlight used to be pinned
   * with `top-0 bottom-0`, which made it the height of the BAR — padding
   * included — while the buttons are inset by that padding. On desktop the
   * switcher carries `sm:py-1.5`, so the highlight stood taller than the tab it
   * was highlighting and the label sat visibly off-centre in it. Measuring the
   * button's own box means the highlight is the tab, at any padding, any
   * breakpoint, either type scale.
   */
  const [indicator, setIndicator] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null
  );

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

  /**
   * Measure the active tab so the highlight can travel to it.
   *
   * Measured rather than calculated from an index: on a phone the four buttons
   * share the bar equally, from `sm` up they size to their own content, and the
   * desk's type scale changes all four widths at breakpoints in between. An
   * index-times-width formula would be right at exactly one screen size — which
   * is the class of bug this avoids. A ResizeObserver re-measures on rotation,
   * on a font swap and when the type scale kicks in.
   */
  const positionIndicator = useCallback(() => {
    const nav = navRef.current;
    const button = tabRefs.current.get(tab);
    if (!nav || !button) return;
    const navBox = nav.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    setIndicator({
      left: box.left - navBox.left,
      top: box.top - navBox.top,
      width: box.width,
      height: box.height,
    });
  }, [tab]);

  useEffect(() => {
    positionIndicator();
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => positionIndicator());
    observer.observe(nav);
    for (const button of tabRefs.current.values()) if (button) observer.observe(button);
    return () => observer.disconnect();
  }, [positionIndicator]);

  const go = useCallback((next: Tab) => {
    setTab(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", next === "scores" ? "/sports" : `/sports?tab=${next}`);
      // A tab change is a new page's worth of content in the same document, so
      // the reader belongs at the top of it rather than wherever the last one
      // left them.
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  /**
   * Arrow keys, Home and End across the switcher.
   *
   * The standard tablist contract, and the reason this is not optional: a board
   * with four tabs and no keyboard path is a board someone using a keyboard
   * cannot leave the first tab of. Focus follows selection, so the reader can
   * arrow along the strip and read each board's name as they arrive.
   */
  function onNavKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const current = TABS.indexOf(tab);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    const target = TABS[next];
    if (!target) return;
    go(target);
    tabRefs.current.get(target)?.focus();
  }

  /**
   * Sideways swipe between boards, for the phone.
   *
   * Registered on the board container rather than on `window`, so a swipe inside
   * a horizontally scrolling table or the day strip is left alone. The vertical
   * guard matters as much as the horizontal threshold: without it, a reader
   * flicking *down* the page with a slightly diagonal thumb would change board
   * under them.
   */
  const swipe = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    swipe.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  function onTouchEnd(event: React.TouchEvent) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 64 || Math.abs(dy) > 48) return;
    const current = TABS.indexOf(tab);
    const next = TABS[dx < 0 ? current + 1 : current - 1];
    if (!next) return;
    go(next);
  }

  const activeMeta = useMemo(() => TAB_META[tab], [tab]);

  return (
    <div className="sports-desk min-h-screen bg-surface-950 pb-16 text-surface-50">
      <section className="relative overflow-hidden border-b border-surface-800/60 bg-gradient-to-br from-surface-900 via-surface-950 to-surface-900">
        {/* The pitch: mown stripes in perspective, a centre circle, and a band of
            light that travels across them every eighteen seconds. All of it is
            `pointer-events-none` and `aria-hidden` — decoration a reader can
            ignore, on a page whose job is numbers. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "repeating-linear-gradient(90deg, #ffffff 0 1px, transparent 1px 60px)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full border border-white/[0.06]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent animate-pitch-sweep"
        />
        <div className="pointer-events-none absolute -left-24 -top-16 h-72 w-72 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-10 bottom-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />

        <div className="relative mx-auto w-full max-w-[1600px] px-3 pb-5 pt-4 sm:px-6 sm:pt-8 xl:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-300">
                  <Trophy className="h-3 w-3" />
                  Football
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 w-6 bg-white/25 blur-[6px] animate-badge-shine"
                  />
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-surface-700 bg-surface-900/60 px-2.5 py-1 text-[11px] font-medium text-surface-400">
                  <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 animate-live-ring" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                  </span>
                  Updating live
                  <Radio className="h-3 w-3 text-red-400/70" />
                </span>
                <Link
                  href="/trending"
                  className="ml-auto hidden items-center gap-1 text-[11px] font-medium text-surface-400 transition hover:text-surface-50 sm:inline-flex"
                >
                  News
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              <h1 className="mt-2.5 text-xl font-black tracking-tight text-surface-50 sm:text-4xl">
                Scores, picks &amp; the reasons
              </h1>
              {/* One sentence. The old copy listed the whole feature set, which
                  is what made the top of this page read like a spec sheet. */}
              <p className="mt-1.5 max-w-2xl text-[13px] text-surface-400 sm:text-sm">
                Live football, our model&apos;s prediction for every match, and why it made it.
              </p>
            </div>
          </div>

          {/* The scores that are happening right now, above the fold, on every
              board — tap one to jump to the full board. Renders nothing at all
              when nothing is in play. */}
          <LiveTicker onOpen={() => go("scores")} />
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
        onKeyDown={onNavKeyDown}
        className="sports-nav relative z-40 border-b border-surface-800/60 bg-surface-950/95 shadow-[0_6px_20px_-14px_rgb(0_0_0_/_0.9)] backdrop-blur"
      >
        <div
          role="tablist"
          className="relative mx-auto flex w-full max-w-[1600px] items-stretch gap-1 px-3 sm:gap-2 sm:px-6 sm:py-1.5 xl:px-8"
        >
          {/* The travelling highlight, behind the buttons. */}
          {indicator ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute rounded-xl bg-brand-500 shadow-lg shadow-brand-500/20 transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{
                top: indicator.top,
                height: indicator.height,
                width: indicator.width,
                transform: `translateX(${indicator.left}px)`,
                left: 0,
              }}
            />
          ) : null}
          {TABS.map((id) => (
            <TabButton
              key={id}
              id={id}
              active={tab === id}
              onClick={() => go(id)}
              register={(node) => tabRefs.current.set(id, node)}
            />
          ))}
        </div>
      </nav>

      {heroAd ? <div className="mx-auto w-full max-w-[1600px] px-3 pt-4 sm:px-6 xl:px-8">{heroAd}</div> : null}

      {/* Keyed so a tab change reads as a new board arriving, not a silent swap.
          The swipe handlers live here rather than on the body so a sideways drag
          inside a table or the day strip is never mistaken for a board change. */}
      <div
        key={tab}
        id="sports-board"
        role="tabpanel"
        aria-label={`${activeMeta.label} — ${activeMeta.hint}`}
        className="motion-safe:animate-rise"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
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

      {/*
        What this board is, in the reader's own words, at the foot of the page —
        and a way straight to the top of a long board without hunting for the
        switcher. The hint line is what a reader would say if they were
        describing this tab to someone else.
      */}
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-3 pt-6 sm:px-6 xl:px-8">
        <p className="text-[11px] text-surface-500">
          <span className="font-semibold text-surface-400">{activeMeta.label}</span> · {activeMeta.hint}
        </p>
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-surface-800 px-2.5 py-1 text-[11px] font-medium text-surface-400 transition hover:border-brand-500/40 hover:text-surface-50"
        >
          Back to top
          <ArrowRight className="h-3 w-3 -rotate-90" />
        </button>
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
 *
 * The highlight colour is NOT applied here — it travels on a separate element
 * behind these buttons, so a tab change animates as one movement. What each
 * button does own is its own text colour and its icon's lift.
 */
function TabButton({
  id,
  active,
  onClick,
  register,
}: {
  id: Tab;
  active: boolean;
  onClick: () => void;
  register: (node: HTMLButtonElement | null) => void;
}) {
  const meta = TAB_META[id];
  const Icon = meta.icon;
  return (
    <button
      ref={register}
      onClick={onClick}
      role="tab"
      aria-selected={active}
      aria-controls="sports-board"
      aria-label={`${meta.label} — ${meta.hint}`}
      tabIndex={active ? 0 : -1}
      className={cn(
        // Equal shares at every width. From `sm` up the four used to size to
        // their own content (`sm:flex-none`), so on a desktop the switcher ended
        // two-thirds of the way across a left-aligned row and read as a bar that
        // had come loose from the page it belongs to.
        "group relative z-10 flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center transition duration-200 sm:flex-row sm:gap-2.5 sm:px-3 sm:text-left",
        active
          ? "text-white"
          : "text-surface-400 hover:bg-surface-900/70 hover:text-surface-50 active:scale-[0.97]"
      )}
    >
      <span
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-lg transition duration-200 sm:h-8 sm:w-8",
          active
            ? "bg-white/15 text-white"
            : "bg-surface-800/70 text-surface-400 group-hover:-translate-y-0.5 group-hover:text-surface-200"
        )}
      >
        <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center justify-center gap-1.5 text-[11px] font-semibold sm:text-sm">
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
