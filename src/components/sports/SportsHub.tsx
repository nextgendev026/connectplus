"use client";

import { useEffect, useState, type ReactNode } from "react";
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
 * Navigation is deliberately different on a phone and on a desktop. A phone
 * gets a bottom bar, because that is where a thumb already is and this page is
 * long; a desktop gets the strip in the header, where the eye already is. Both
 * drive the same state.
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

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (!requested || !TABS.includes(requested as Tab)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the ?tab= deep link
    setTab(requested as Tab);
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
    <div className="min-h-screen bg-surface-950 pb-28 text-surface-50 sm:pb-16">
      <section className="relative overflow-hidden border-b border-surface-800/60 bg-gradient-to-br from-surface-900 via-surface-950 to-surface-900">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, #ffffff 0 1px, transparent 1px 60px)" }}
        />
        <div className="pointer-events-none absolute -left-24 -top-16 h-72 w-72 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-10 bottom-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />

        <div className="relative mx-auto w-full max-w-[1600px] px-3 pb-4 pt-4 sm:px-6 sm:pt-8 xl:px-8">
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

            {/* Desktop tab strip: beside the title, not stretched across it. */}
            <div className="hidden shrink-0 items-center rounded-2xl border border-surface-800 bg-surface-900/70 p-1 backdrop-blur sm:flex">
              {TABS.map((id) => (
                <TabButton
                  key={id}
                  id={id}
                  active={tab === id}
                  onClick={() => go(id)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

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

      {/* ── Mobile navigation ──────────────────────────────────────────────
          Pinned to the bottom of the viewport: on a page this long, a control
          at the top is a control the reader has to scroll back to find. */}
      <nav
        aria-label="Sports boards"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-800 bg-surface-950/95 pb-[max(env(safe-area-inset-bottom),0.25rem)] backdrop-blur sm:hidden"
      >
        <div className="flex items-stretch">
          {TABS.map((id) => {
            const meta = TAB_META[id];
            const Icon = meta.icon;
            const active = tab === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={active}
                onClick={() => go(id)}
                className={cn(
                  "relative flex flex-1 flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 transition active:scale-95",
                  active ? "text-brand-300" : "text-surface-500"
                )}
              >
                {active ? (
                  <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand-400" />
                ) : null}
                <Icon className={cn("h-5 w-5 transition", active && "drop-shadow-[0_0_8px_rgba(234,88,12,0.45)]")} />
                <span className="text-[10px] font-semibold">{meta.label}</span>
                <span className="text-[9px] text-surface-600">{meta.hint}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function TabButton({ id, active, onClick }: { id: Tab; active: boolean; onClick: () => void }) {
  const meta = TAB_META[id];
  const Icon = meta.icon;
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        "group flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition",
        active ? "bg-brand-500 text-white shadow-lg shadow-brand-500/20" : "text-surface-400 hover:text-surface-50"
      )}
    >
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg transition",
          active ? "bg-white/15 text-white" : "bg-surface-800/70 text-surface-400 group-hover:text-surface-200"
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold">{meta.label}</span>
        <span className={cn("block truncate text-[10px] uppercase tracking-wider", active ? "text-white/70" : "text-surface-600")}>
          {meta.hint}
        </span>
      </span>
    </button>
  );
}
