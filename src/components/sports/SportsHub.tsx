"use client";

import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity, BadgeCheck, CalendarDays, ChevronDown, LineChart,
  Loader2, Radio, Signal, Sparkles, Trophy, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ScoresBoard from "./ScoresBoard";
import BettingTips from "./BettingTips";
import MatchCentre from "./MatchCentre";
import MatchCalendar from "./MatchCalendar";

type Tab = "scores" | "analysis" | "tips" | "calendar";
const TABS: Tab[] = ["scores", "analysis", "tips", "calendar"];

export interface SportsHubMeta {
  providers: ReadonlyArray<{ id: string; label: string; state: "live" | "fresh" | "stale" | "down"; ts: number }>;
  liveCount: number;
  picksPending: number;
  competitions: number;
  generatedAt: number;
  demo: boolean;
}

const EMPTY_META: SportsHubMeta = {
  providers: [],
  liveCount: 0,
  picksPending: 0,
  competitions: 0,
  generatedAt: Date.now(),
  demo: false,
};

type SourceState = SportsHubMeta["providers"][number]["state"];

function stateChip(state: SourceState) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        state === "live"
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
          : state === "fresh"
            ? "border-sky-500/50 bg-sky-500/10 text-sky-300"
            : state === "stale"
              ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
              : "border-red-500/50 bg-red-500/10 text-red-300"
      )}
    >
      {state === "live" ? (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-block h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
          <span className="relative inline-block h-full w-full rounded-full bg-emerald-400" />
        </span>
      ) : state === "down" ? (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
      ) : state === "stale" ? (
        <ChevronDown className="h-3 w-3 shrink-0" />
      ) : (
        <Zap className="h-3 w-3 shrink-0" />
      )}
      {state}
    </span>
  );
}

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
  const [meta, setMeta] = useState<SportsHubMeta>(EMPTY_META);
  const [sourcesKey, setSourcesKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      let fresh: SportsHubMeta | null = null;
      try {
        const res = await fetch("/api/sports/live", {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (res.status === 200) {
          const json = (await res.json()) as {
            providers?: SportsHubMeta["providers"];
            liveCount?: number;
            picksPending?: number;
            competitions?: number;
            generatedAt?: number;
            demo?: boolean;
          };
          if (!cancelled) {
            const parsed = {
              providers: Array.isArray(json.providers)
                ? json.providers.map((p) => ({
                  id: String(p.id ?? ""),
                  label: String(p.label ?? ""),
                  state: (p.state ?? "live") as SportsHubMeta["providers"][number]["state"],
                  ts: Number.isFinite(Number(p.ts)) ? Number(p.ts) : Date.now(),
                }))
                : [],
              liveCount: Number.isFinite(Number(json.liveCount)) ? Number(json.liveCount) : 0,
              picksPending: Number.isFinite(Number(json.picksPending)) ? Number(json.picksPending) : 0,
              competitions: Number.isFinite(Number(json.competitions)) ? Number(json.competitions) : 0,
              generatedAt: Number.isFinite(Number(json.generatedAt)) ? Number(json.generatedAt) : Date.now(),
              demo: Boolean(json.demo),
            };
            if (parsed?.providers?.length) {
              fresh = parsed;
            }
          }
        }
      } catch (err) {
        if (!cancelled) console.warn("[sports-hub] source poll skipped", err);
      }
      if (!cancelled) {
        if (fresh) setMeta(fresh);
        setSourcesKey((k) => k + 1);
      }
      timer = setTimeout(tick, 15_000);
    }
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

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
                <a
                  href="/trending"
                  className="ml-auto hidden text-[11px] font-medium text-surface-400 transition hover:text-surface-50 sm:inline"
                >
                  News
                </a>
              </div>

              <h1 className="mt-2.5 text-xl font-black tracking-tight text-surface-50 sm:text-4xl">
                Scores, picks &amp; the reasons
              </h1>
              <p className="mt-1.5 max-w-2xl text-[13px] text-surface-400 sm:text-sm">
                Live football and basketball, our model&apos;s prediction for every match, and why it made it.
              </p>
            </div>

            <LiveStats meta={meta} sourcesKey={sourcesKey} />
          </div>
        </div>
      </section>

      <SourceStrip meta={meta} sourcesKey={sourcesKey} />

      <nav
        ref={navRef}
        aria-label="Sports boards"
        className="sports-nav relative z-40 border-b border-surface-800/60 bg-surface-950/95 shadow-[0_6px_20px_-14px_rgb(0_0_0_/_0.9)] backdrop-blur"
      >
        <div className="mx-auto flex w-full max-w-[1600px] items-stretch gap-1 px-3 sm:gap-2 sm:px-6 sm:py-1.5 xl:px-8">
          {TABS.map((id) => (
            <TabButton key={id} id={id} active={tab === id} onClick={() => go(id)} picksPending={meta.picksPending} />
          ))}
        </div>
      </nav>

      {heroAd ? <div className="mx-auto w-full max-w-[1600px] px-3 pt-4 sm:px-6 xl:px-8">{heroAd}</div> : null}

      <div key={tab} className="motion-safe:animate-rise">
        <RobustBoard fallback={<EmptyBoard reason="This board is waiting on the feed" />}>
          {tab === "scores" ? (
            <ScoresBoard inlineAd={inlineAd} sidebarAd={sidebarAd} />
          ) : tab === "analysis" ? (
            <MatchCentre />
          ) : tab === "calendar" ? (
            <MatchCalendar />
          ) : (
            <BettingTips inlineAd={inlineAd} sidebarAd={sidebarAd} />
          )}
        </RobustBoard>
      </div>

    </div>
  );
}

function TabButton({ id, active, onClick, picksPending }: { id: Tab; active: boolean; onClick: () => void; picksPending: number }) {
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
          active
            ? "bg-white/15 text-white shadow-sm"
            : "bg-surface-800/70 text-surface-400 group-hover:text-surface-200"
        )}
      >
        <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center justify-center gap-1.5 text-[11px] font-semibold sm:justify-start sm:text-sm">
          {meta.label}
          {id === "tips" && picksPending > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300 sm:hidden">
              <Sparkles className="h-2.5 w-2.5" />
              {picksPending}
            </span>
          ) : null}
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

const TAB_META: Record<Tab, { label: string; hint: string; icon: typeof Activity }> = {
  scores: { label: "Scores", hint: "Live now", icon: Activity },
  analysis: { label: "Analysis", hint: "Deep dive", icon: LineChart },
  tips: { label: "Tips", hint: "Picks + why", icon: Sparkles },
  calendar: { label: "Fixtures", hint: "What's on", icon: CalendarDays },
};

function LiveStats({ meta, sourcesKey }: { meta: SportsHubMeta; sourcesKey: number }) {
  const live = meta.liveCount;
  const picks = meta.picksPending;
  const comps = meta.competitions;
  return (
    <div className="mx-auto mt-3 flex max-w-[1600px] flex-wrap items-center gap-3 rounded-2xl border border-surface-700/60 bg-surface-900/60 px-4 py-2.5 backdrop-blur sm:gap-5">
      <Kpi
        key={sourcesKey}
        icon={<Activity className="h-3.5 w-3.5" />}
        value={String(live)}
        label="live matches"
        tone={live > 0 ? "emerald" : "muted"}
      />
      <Kpi
        key={sourcesKey}
        icon={<Sparkles className="h-3.5 w-3.5" />}
        value={picks > 0 ? String(picks) : "—"}
        label="picks waiting"
        tone={picks > 0 ? "amber" : "muted"}
      />
      <Kpi
        key={sourcesKey}
        icon={<Trophy className="h-3.5 w-3.5" />}
        value={String(comps)}
        label="leagues"
        tone="muted"
      />
      {meta.demo ? (
        <span className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/8 px-2.5 py-1 text-[11px] font-medium text-amber-300">
          <BadgeCheck className="h-3 w-3" />
          demo mode
        </span>
      ) : null}
    </div>
  );
}

function Kpi({ icon, value, label, tone }: {
  icon: ReactNode;
  value: string;
  label: string;
  tone: "emerald" | "amber" | "sky" | "muted";
}) {
  const tint = {
    emerald: "text-emerald-300 ring-emerald-500/30",
    amber: "text-amber-300 ring-amber-500/30",
    sky: "text-sky-300 ring-sky-500/30",
    muted: "text-surface-400 ring-surface-700/50",
  }[tone];
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-900/50 px-2.5 py-1 ring-1 ring-inset ring-current/10">
      <span className={cn("shrink-0 rounded-lg bg-white/10 p-1", tint)}>{icon}</span>
      <div className="min-w-0">
        <div className="text-sm font-bold tabular-nums tracking-tight">{value}</div>
        <div className="text-[10px] uppercase tracking-wider text-surface-500">{label}</div>
      </div>
    </div>
  );
}

function SourceStrip({ meta, sourcesKey }: { meta: SportsHubMeta; sourcesKey: number }) {
  if (!meta.providers.length) {
    return null;
  }
  return (
    <div key={sourcesKey} className="mx-auto mt-2.5 max-w-[1600px] rounded-xl border border-surface-800/50 bg-surface-900/50 px-3 py-2 backdrop-blur sm:px-6 xl:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-surface-500">
          <Signal className="h-3 w-3" />
          sources
        </span>
        {meta.providers.map((p) => (
          <div key={p.id} className="flex items-center gap-1.5 text-[11px]">
            <span className="text-surface-400">{p.label}</span>
            {stateChip(p.state)}
          </div>
        ))}
        <span className="ml-auto text-[10px] uppercase tracking-wider text-surface-600">
          {meta.generatedAt ? new Date(meta.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
        </span>
      </div>
    </div>
  );
}

export function RobustBoard({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  return (
    <RobustBoardInner children={children} fallback={fallback} />
  );
}

function RobustBoardInner({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [crash, setCrash] = useState<ReactNode | null>(null);
  if (crash) return <div className="mx-auto max-w-[1600px] px-3 py-16 text-center sm:px-6 xl:px-8">{crash}</div>;
  return (
    <ErrorBoundary
      onCatch={(e) =>
        setCrash(
          <div className="mx-auto max-w-md text-center">
            <div className="mb-3 flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-red-500/10 ring-1 ring-red-500/30">
              <span className="text-2xl">⚠️</span>
            </div>
            <h3 className="text-base font-bold text-surface-50">Something went wrong here</h3>
            <p className="mt-1 text-sm text-surface-500">The {fallback ? "board" : "page"} is having trouble. Try refreshing — your scores are still live at the top of the page.</p>
            {fallback ? (
              <div className="mt-4">{fallback}</div>
            ) : (
              <button
                className="mt-4 rounded-xl border border-surface-700 bg-surface-900 px-4 py-2 text-sm font-semibold text-surface-50 transition hover:bg-surface-800"
                onClick={() => window.location.reload()}
              >
                Reload this page
              </button>
            )}
          </div>
        )
      }
    >
      {children}
    </ErrorBoundary>
  );
}

function ErrorBoundary({
  children,
  onCatch,
}: {
  children: ReactNode;
  onCatch: (e: React.ErrorInfo) => void;
}) {
  return <ErrorBoundaryFallback onCatch={onCatch}>{children}</ErrorBoundaryFallback>;
}

function ErrorBoundaryFallback({ children, onCatch }: { children: ReactNode; onCatch: (e: React.ErrorInfo) => void }) {
  const [didCatch, setDidCatch] = useState(false);
  if (didCatch) throw new Error("Boundary re-throw");
  return (
    <Inner onError={() => setDidCatch(true)}>
      {didCatch ? null : children}
    </Inner>
  );
}

const Inner = class extends React.Component<{ children?: ReactNode; onError?: (e: React.ErrorInfo) => void }, { fatal?: unknown }> {
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    this.props.onError?.(info);
  }
  render() {
    return this.props.children as React.ReactElement;
  }
};

function EmptyBoard({ reason }: { reason: string }) {
  return (
    <div className="mx-auto max-w-md px-3 py-20 text-center sm:px-6 xl:px-8">
      <div className="mb-4 flex h-14 w-14 mx-auto items-center justify-center rounded-full bg-surface-800/70 ring-1 ring-surface-700/50">
        <Loader2 className="h-6 w-6 animate-spin text-surface-500" />
      </div>
      <p className="text-sm text-surface-500">{reason}</p>
    </div>
  );
}
