"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, Flame, Radio, Sparkles, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import ScoresBoard from "./ScoresBoard";
import BettingTips from "./BettingTips";

type Tab = "scores" | "tips";

/**
 * Sports hub shell.
 *
 * Two boards share one sporty frame: **Scores** (the SofaScore-style live board)
 * and **Betting tips** (the published model's top picks). The active tab lives in
 * the URL (`?tab=tips`) so a tip board can be shared or linked from a push.
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
    if (requested !== "tips" && requested !== "scores") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the ?tab= deep link
    setTab(requested);
  }, []);

  function go(next: Tab) {
    setTab(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", next === "tips" ? "/sports?tab=tips" : "/sports");
    }
  }

  return (
    <div className="min-h-screen bg-surface-950 pb-16 text-surface-50">
      <section className="relative overflow-hidden border-b border-surface-800/60 bg-gradient-to-br from-surface-900 via-surface-950 to-surface-900">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, #ffffff 0 1px, transparent 1px 60px)" }}
        />
        <div className="pointer-events-none absolute -left-24 -top-16 h-72 w-72 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-10 bottom-0 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />

        <div className="relative mx-auto w-full max-w-[1600px] px-3 pb-4 pt-5 sm:px-6 sm:pt-8 xl:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-300">
              <Trophy className="h-3.5 w-3.5" />
              Sports desk
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-surface-700 bg-surface-900/60 px-3 py-1 text-[11px] font-medium text-surface-400">
              <Radio className="h-3 w-3 text-red-400" />
              Real-time scores
            </span>
            <Link
              href="/trending"
              className="ml-auto hidden items-center gap-1 text-[11px] font-medium text-surface-400 transition hover:text-surface-50 sm:inline-flex"
            >
              Trending elsewhere
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Solid token colour, not a gradient: the surface scale inverts between
              themes, so a gradient that fades to a light brand tone washes out on
              the light theme's dark text. */}
          <h1 className="mt-3 text-2xl font-black tracking-tight text-surface-50 sm:text-4xl">
            Live scores &amp; betting tips
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-surface-400">
            Every match, updating minute by minute. Open any fixture for our model&apos;s read on it —
            who wins, how many goals, both teams to score — plus the recent form and past meetings behind
            that view.
          </p>

          <div className="mt-5 flex w-full max-w-md items-center rounded-2xl border border-surface-800 bg-surface-900/70 p-1 backdrop-blur">
            <TabButton
              active={tab === "scores"}
              onClick={() => go("scores")}
              icon={<Activity className="h-4 w-4" />}
              label="Scores"
              hint="Live & upcoming"
            />
            <TabButton
              active={tab === "tips"}
              onClick={() => go("tips")}
              icon={<Sparkles className="h-4 w-4" />}
              label="Betting tips"
              hint="Model picks"
            />
          </div>
        </div>
      </section>

      {heroAd ? <div className="mx-auto w-full max-w-[1600px] px-3 pt-5 sm:px-6 xl:px-8">{heroAd}</div> : null}

      {tab === "scores" ? (
        <ScoresBoard inlineAd={inlineAd} sidebarAd={sidebarAd} />
      ) : (
        <BettingTips inlineAd={inlineAd} sidebarAd={sidebarAd} />
      )}

    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        "group flex flex-1 items-center gap-2.5 rounded-xl px-3 py-2 text-left transition",
        active ? "bg-brand-500 text-white shadow-lg shadow-brand-500/20" : "text-surface-400 hover:text-surface-50"
      )}
    >
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg transition",
          active ? "bg-white/15 text-white" : "bg-surface-800/70 text-surface-400 group-hover:text-surface-200"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {label}
          {active ? <Flame className="h-3 w-3" /> : null}
        </span>
        <span className={cn("block truncate text-[10px] uppercase tracking-wider", active ? "text-white/70" : "text-surface-600")}>
          {hint}
        </span>
      </span>
    </button>
  );
}
