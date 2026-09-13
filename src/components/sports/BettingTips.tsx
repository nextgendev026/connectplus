"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Loader2,
  Sparkles,
  Target,
  TrendingUp,
  Flame,
  Radar,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ReferralCards from "./ReferralCards";

interface TipMatch {
  id: string;
  competition: string;
  country: string | null;
  homeTeam: string;
  awayTeam: string;
  status: string;
  minute: number | null;
  kickoff: string | null;
  oddsHome: number | null;
  oddsDraw: number | null;
  oddsAway: number | null;
}

interface Tip {
  id: string;
  market: string;
  marketLabel?: string;
  selection: string;
  confidence: number;
  valueEdge: number | null;
  rationale: string;
  expectedHomeGoals: number | null;
  expectedAwayGoals: number | null;
  match: TipMatch;
}

interface TipsResponse {
  record: { settled: number; won: number; accuracy: number | null };
  market: string | null;
  sort: string;
  /** Set when the model's data store could not be reached — distinct from "no tips". */
  degraded?: boolean;
  picks: Tip[];
}

const MARKET_FILTERS = [
  { value: "", label: "All markets" },
  { value: "1X2", label: "Match result" },
  { value: "over-under", label: "Total goals" },
  { value: "btts", label: "BTTS" },
  { value: "correct-score", label: "Correct score" },
];

const LIVE = new Set(["LIVE", "HT"]);

function kickoffLabel(match: TipMatch): { text: string; live: boolean } {
  if (LIVE.has(match.status)) {
    return { text: match.status === "HT" ? "HT" : match.minute ? `${match.minute}'` : "LIVE", live: true };
  }
  if (!match.kickoff) return { text: match.status, live: false };
  const kickoff = new Date(match.kickoff);
  const today = new Date();
  const sameDay = kickoff.toDateString() === today.toDateString();
  const time = kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return { text: time, live: false };
  return { text: `${kickoff.toLocaleDateString([], { day: "numeric", month: "short" })} · ${time}`, live: false };
}

/**
 * Betting tips.
 *
 * The published model's highest-value pending picks, in one scannable board.
 * Every card shows the reasoning and the model's own record, so a tip is a
 * probabilistic lean with receipts — never a "sure thing".
 */
export default function BettingTips({
  inlineAd,
  sidebarAd,
}: {
  inlineAd?: ReactNode;
  sidebarAd?: ReactNode;
} = {}) {
  const [data, setData] = useState<TipsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState("");
  const [sort, setSort] = useState<"confidence" | "edge">("confidence");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "40", sort });
      if (market) params.set("market", market);
      const res = await fetch(`/api/sports/predictions?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Tips are unavailable right now.");
      setData((await res.json()) as TipsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tips");
    } finally {
      setLoading(false);
    }
  }, [market, sort]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-filter-change
    void load();
  }, [load]);

  const record = data?.record;

  return (
    <div className="mx-auto grid w-full max-w-[1600px] gap-5 px-3 py-5 sm:gap-6 sm:px-6 sm:py-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:px-8">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-surface-50">
            <Sparkles className="h-5 w-5 text-emerald-400" />
            Today&apos;s betting tips
          </h2>
          {record && record.settled > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
              <Target className="h-3.5 w-3.5" />
              {record.accuracy}% hit rate on {record.settled} settled picks
            </span>
          ) : (
            <span className="rounded-full border border-surface-700 px-3 py-1 text-xs text-surface-400">
              record accruing
            </span>
          )}
        </div>
        <p className="mt-1.5 max-w-2xl text-sm text-surface-400">
          Model-generated leans across every market, ranked by conviction or by edge over the closing
          line. Tap a fixture on the Scores tab for the full breakdown.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {MARKET_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setMarket(f.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                market === f.value
                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                  : "border-surface-800 text-surface-400 hover:border-surface-700 hover:text-surface-50"
              )}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex items-center rounded-xl border border-surface-800 bg-surface-900/70 p-1">
            {(
              [
                { value: "confidence", label: "Confidence", icon: Flame },
                { value: "edge", label: "Edge", icon: TrendingUp },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                onClick={() => setSort(option.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                  sort === option.value ? "bg-emerald-500 text-white" : "text-surface-400 hover:text-surface-50"
                )}
              >
                <option.icon className="h-3.5 w-3.5" />
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="mt-8 flex items-center justify-center gap-2 rounded-2xl border border-surface-800/60 py-16 text-sm text-surface-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the model…
          </div>
        ) : error ? (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
        ) : data?.degraded && data.picks.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-16 text-center">
            <Radar className="mx-auto h-8 w-8 text-amber-400" />
            <p className="mt-2 text-sm font-medium text-amber-300">The model is briefly out of reach</p>
            <p className="text-xs text-surface-400">
              This is a temporary data-store hiccup, not an empty board. Refresh in a moment.
            </p>
          </div>
        ) : !data || data.picks.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-surface-800 px-4 py-16 text-center">
            <Radar className="mx-auto h-8 w-8 text-surface-600" />
            <p className="mt-2 text-sm font-medium text-surface-400">No tips for this filter yet</p>
            <p className="text-xs text-surface-500">
              The analyser publishes picks as fixtures approach kick-off — check back closer to matchday.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {data.picks.slice(0, 6).map((tip) => (
              <TipCard key={tip.id} tip={tip} />
            ))}
            {inlineAd && data.picks.length > 6 ? (
              <div className="sm:col-span-2 xl:col-span-3 2xl:col-span-4">{inlineAd}</div>
            ) : null}
            {data.picks.slice(6).map((tip) => (
              <TipCard key={tip.id} tip={tip} />
            ))}
          </div>
        )}

        <div className="mt-6 flex items-start gap-2 rounded-xl border border-surface-800/70 bg-surface-900/40 px-3 py-2.5 text-[11px] leading-relaxed text-surface-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span>
            Tips are model output, not financial advice. 18+. Betting carries risk — never stake more
            than you can afford to lose.
          </span>
        </div>
      </div>

      <aside className="space-y-4">
        {sidebarAd ? <div>{sidebarAd}</div> : null}
        <ReferralCards placement="sports-sidebar" />
      </aside>
    </div>
  );
}

function TipCard({ tip }: { tip: Tip }) {
  const kickoff = kickoffLabel(tip.match);
  const confidencePct = Math.round(tip.confidence * 100);
  const strong = confidencePct >= 65;

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-surface-800/70 bg-gradient-to-b from-surface-900/70 to-surface-950/60 p-4 transition hover:border-emerald-500/40 hover:shadow-[0_0_0_1px_rgba(16,185,129,0.1)]">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500/60 via-brand-500/40 to-transparent" />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-surface-500">
          {tip.match.competition}
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
            kickoff.live ? "bg-red-500/15 text-red-400" : "bg-surface-800 text-surface-400"
          )}
        >
          {kickoff.live ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> : <Clock className="h-3 w-3" />}
          {kickoff.text}
        </span>
      </div>

      <h3 className="mt-2 truncate text-sm font-semibold text-surface-50">
        {tip.match.homeTeam} <span className="text-surface-500">vs</span> {tip.match.awayTeam}
      </h3>

      <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/80">
          {tip.marketLabel ?? tip.market}
        </p>
        <p className="mt-0.5 text-sm font-bold text-surface-50">{tip.selection}</p>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-surface-400">
          <span>Model confidence</span>
          <span className={cn("font-bold tabular-nums", strong ? "text-emerald-400" : "text-surface-200")}>
            {confidencePct}%
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-800">
          <div
            className={cn("h-full rounded-full", strong ? "bg-emerald-500" : "bg-brand-500")}
            style={{ width: `${confidencePct}%` }}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-surface-500">
        {tip.valueEdge != null ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 font-medium",
              tip.valueEdge > 0 ? "text-emerald-400" : "text-amber-400"
            )}
          >
            <TrendingUp className="h-3 w-3" />
            {tip.valueEdge > 0 ? "+" : ""}
            {tip.valueEdge.toFixed(1)}pp vs line
          </span>
        ) : null}
        {tip.expectedHomeGoals != null && tip.expectedAwayGoals != null ? (
          <span>
            xG {tip.expectedHomeGoals.toFixed(2)}–{tip.expectedAwayGoals.toFixed(2)}
          </span>
        ) : null}
      </div>

      <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-surface-400">{tip.rationale}</p>
    </article>
  );
}
