"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Flame,
  Loader2,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tipsEndpoint } from "@/lib/sports-endpoint";
import { explainPick } from "@/lib/pick-insights";
import { PickReasons } from "./PickReasons";
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
  /** The model's win/draw/loss split, present on match-result picks. */
  homeWinPct?: number | null;
  drawPct?: number | null;
  awayWinPct?: number | null;
  match: TipMatch;
}

interface TipsResponse {
  record: { settled: number; won: number; accuracy: number | null };
  market: string | null;
  sort: string;
  /** Set when the model's data store could not be reached — distinct from "no tips". */
  degraded?: boolean;
  /** When the server assembled this payload. */
  generatedAt?: string;
  /** Newest model write behind the picks on screen. */
  updatedAt?: string | null;
  /** The rule the server applied: a pick is only shown while it is actionable. */
  stakeWindow?: { minuteCutoff: number; maxAgeMinutes: number };
  picks: Tip[];
}

/**
 * How often the board re-reads the model while the tab is open.
 *
 * The board used to fetch once on mount and then never again, so a reader who
 * left the tab open through a kick-off watched yesterday's picks: the engine had
 * published fresh ones, the server was serving them, and the page had no reason
 * to ask. Sixty seconds is well inside the two-minute model cadence, so the
 * board is never more than one pass behind.
 */
const AUTO_REFRESH_MS = 60_000;

const MARKET_FILTERS = [
  { value: "", label: "Everything" },
  { value: "1X2", label: "Who wins" },
  { value: "over-under", label: "Total goals" },
  { value: "btts", label: "Both to score" },
  { value: "correct-score", label: "Exact score" },
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
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [ageMinutes, setAgeMinutes] = useState<number | null>(null);

  /**
   * `silent` is the background refresh: it must not blank the board or flash the
   * spinner, because the reader is mid-read and the data on screen is still
   * valid — it is a second old, not wrong.
   *
   * `bust` is reserved for a refresh the reader explicitly asked for. The
   * periodic poll deliberately leaves it off so it keeps hitting the edge cache:
   * a cache-busting param on every tick would turn every viewer into an origin
   * request every minute, which is precisely the traffic the Cloudflare
   * livescore/tips tier exists to collapse.
   */
  const load = useCallback(
    async (silent = false, bust = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        // Through the edge tier: the board polls every 60s for every reader, and
        // the payload is identical for all of them.
        const res = await fetch(
          tipsEndpoint({ limit: 40, sort, market: market || undefined, bust: bust ? Date.now() : undefined }),
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error("Tips are unavailable right now.");
        const payload = (await res.json()) as TipsResponse;
        setData(payload);
        setFetchedAt(payload.generatedAt ? new Date(payload.generatedAt) : new Date());
      } catch (err) {
        // A failed *background* refresh keeps the last good board: replacing a
        // usable set of picks with an error box is a worse outcome than a
        // slightly old one.
        if (!silent) setError(err instanceof Error ? err.message : "Failed to load tips");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [market, sort]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-filter-change
    void load();
  }, [load]);

  // The relative timestamp ages on its own clock. Computing it during render
  // would make every re-render read the wall clock (and read differently), so
  // the age is a value the interval updates instead.
  useEffect(() => {
    const compute = () =>
      setAgeMinutes(
        fetchedAt ? Math.max(0, Math.round((Date.now() - fetchedAt.getTime()) / 60_000)) : null
      );
    compute();
    const timer = setInterval(compute, 30_000);
    return () => clearInterval(timer);
  }, [fetchedAt]);

  // Keep the board current while the tab is open, and catch up immediately when
  // the reader comes back to it — the two moments when stale picks are most
  // likely and most costly (a game has just started).
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = setInterval(tick, AUTO_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [load]);

  const record = data?.record;
  const freshness =
    ageMinutes === null
      ? null
      : ageMinutes < 1
        ? "just now"
        : ageMinutes === 1
          ? "1 min ago"
          : `${ageMinutes} min ago`;

  // ONE CARD PER FIXTURE.
  //
  // The model publishes a pick per market, so a single match legitimately
  // produces two or three rows. Rendered flat, the same fixture appeared again
  // and again down the board and read as duplication — the reader could not
  // tell "we have a view on both the result and the goals" from "this got
  // listed twice". Grouping keeps every market, without repeating the fixture.
  const groups = groupByFixture(data?.picks ?? []);

  return (
    <div className="mx-auto grid w-full max-w-[1600px] gap-5 px-3 py-5 sm:gap-6 sm:px-6 sm:py-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] xl:px-8">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-surface-50 sm:text-lg">
            <Sparkles className="h-4 w-4 text-emerald-400 sm:h-5 sm:w-5" />
            Today&apos;s tips
          </h2>
          {record && record.settled > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 sm:text-xs">
              <Target className="h-3.5 w-3.5" />
              {record.accuracy}% right so far
              <span className="hidden text-emerald-400/70 sm:inline">· {record.settled} settled</span>
            </span>
          ) : (
            <span className="rounded-full border border-surface-700 px-2.5 py-1 text-[11px] text-surface-400 sm:text-xs">
              Building the record
            </span>
          )}
        </div>
        {/*
          One plain sentence, not a paragraph. The reader arriving here wants to
          know what they are looking at and why it is trustworthy — everything
          else is on the cards themselves.
        */}
        <p className="mt-1.5 text-sm text-surface-400">
          Our model&apos;s picks for today, each with the reasons behind it. Not financial advice — 18+.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {data?.stakeWindow ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-surface-800 px-2.5 py-1 text-[10px] font-medium text-surface-500"
              title={`We stop showing a pick once its match reaches ${data.stakeWindow.minuteCutoff} minutes, because it can no longer be acted on.`}
            >
              <ShieldCheck className="h-3 w-3 text-emerald-400" />
              Only picks you can still act on
            </span>
          ) : null}
          {freshness ? (
            <button
              type="button"
              onClick={() => void load(true, true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-surface-800 px-2.5 py-1 text-[10px] font-medium text-surface-500 transition hover:border-emerald-500/40 hover:text-emerald-300"
              title="This board refreshes itself every minute"
            >
              <RefreshCw className="h-3 w-3" />
              Updated {freshness}
            </button>
          ) : null}
        </div>

        {/* Market chips scroll sideways on a phone instead of wrapping into a
            second row of buttons that pushes the picks below the fold. */}
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap">
          {MARKET_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setMarket(f.value)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                market === f.value
                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                  : "border-surface-800 text-surface-400 hover:border-surface-700 hover:text-surface-50"
              )}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex shrink-0 items-center rounded-xl border border-surface-800 bg-surface-900/70 p-1">
            {(
              [
                { value: "confidence", label: "Most likely", icon: Flame },
                { value: "edge", label: "Best price", icon: TrendingUp },
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
          <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-surface-800/60 py-16 text-sm text-surface-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Getting today&apos;s picks…
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
              Picks are published shortly before kick-off, and a pick stops being shown once its match is too
              far along to act on{data?.stakeWindow ? ` (past ${data.stakeWindow.minuteCutoff}')` : ""}. Try
              clearing the filter, or come back closer to matchday.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {groups.slice(0, 6).map((group) => (
              <FixtureTipsCard key={group.key} group={group} />
            ))}
            {inlineAd && groups.length > 6 ? (
              <div className="sm:col-span-2 xl:col-span-3 2xl:col-span-4">{inlineAd}</div>
            ) : null}
            {groups.slice(6).map((group) => (
              <FixtureTipsCard key={group.key} group={group} />
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

      {/* Sticky on desktop, released below `lg` — see ScoresBoard for the reasoning. */}
      <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        {sidebarAd ? <div>{sidebarAd}</div> : null}
        <ReferralCards placement="sports-sidebar" />
      </aside>
    </div>
  );
}

interface FixtureGroup {
  key: string;
  match: TipMatch;
  tips: Tip[];
}

/** Group the model's per-market picks back onto the fixture they describe. */
function groupByFixture(picks: Tip[]): FixtureGroup[] {
  const groups = new Map<string, FixtureGroup>();
  for (const tip of picks) {
    const key = `${tip.match.homeTeam}|${tip.match.awayTeam}|${tip.match.kickoff ?? ""}`.toLowerCase();
    const existing = groups.get(key);
    if (existing) existing.tips.push(tip);
    else groups.set(key, { key, match: tip.match, tips: [tip] });
  }
  return [...groups.values()];
}

const TIER_STYLES: Record<string, string> = {
  strong: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  good: "border-brand-500/30 bg-brand-500/15 text-brand-200",
  close: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  longshot: "border-surface-700 bg-surface-800 text-surface-300",
};

const kickoffPill = (kickoff: { text: string; live: boolean }) =>
  cn(
    "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
    kickoff.live ? "bg-red-500/15 text-red-400" : "bg-surface-800 text-surface-400"
  );

/**
 * One match, with the model's headline pick on it and why it likes it.
 *
 * The card is built the way a phone reads it, top to bottom: which match, what
 * the pick is, how sure we are, then the reasons. The reasons are the point —
 * a percentage with no explanation is a number a reader has no way to judge, so
 * "Why this pick" is a first-class section of the card rather than a footnote,
 * and the model's own audit trail is available in a disclosure for anyone who
 * wants the working.
 */
function FixtureTipsCard({ group }: { group: FixtureGroup }) {
  const { match, tips } = group;
  const kickoff = kickoffLabel(match);
  // The fixture's headline pick is its most confident one; the rest sit beneath
  // it so the card still answers "what does the model actually fancy here?".
  const [lead, ...rest] = [...tips].sort((a, b) => b.confidence - a.confidence);
  if (!lead) return null;

  const insight = explainPick({
    market: lead.market,
    selection: lead.selection,
    confidence: lead.confidence,
    valueEdge: lead.valueEdge,
    expectedHomeGoals: lead.expectedHomeGoals,
    expectedAwayGoals: lead.expectedAwayGoals,
    homeWinPct: lead.homeWinPct,
    drawPct: lead.drawPct,
    awayWinPct: lead.awayWinPct,
    rationale: lead.rationale,
    match: {
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      oddsHome: match.oddsHome,
      oddsDraw: match.oddsDraw,
      oddsAway: match.oddsAway,
    },
  });

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-surface-800/70 bg-gradient-to-b from-surface-900/70 to-surface-950/60 transition duration-300 hover:border-emerald-500/40 hover:shadow-[0_0_0_1px_rgba(16,185,129,0.1)] motion-safe:animate-rise">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500/60 via-brand-500/40 to-transparent" />

      <div className="flex items-center justify-between gap-2 border-b border-surface-800/60 px-4 py-2.5">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-surface-500">
          {match.competition}
        </span>
        <span className={kickoffPill(kickoff)} title={kickoff.live ? "Happening now" : "Kick-off"}>
          {kickoff.live ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> : <Clock className="h-3 w-3" />}
          {kickoff.text}
        </span>
      </div>

      <h3 className="px-4 pt-3 text-sm font-semibold text-surface-50">
        {match.homeTeam} <span className="font-normal text-surface-500">vs</span> {match.awayTeam}
      </h3>

      <div className="mt-3 px-4">
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300/80">
              {insight.marketPlain}
            </span>
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", TIER_STYLES[insight.tier.tone])}>
              {insight.tier.label}
            </span>
          </div>
          <p className="mt-1 text-base font-bold leading-snug text-surface-50">{lead.selection}</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-brand-400 transition-all duration-700"
                style={{ width: `${insight.belief}%` }}
              />
            </div>
            <span className="text-xs font-bold tabular-nums text-emerald-300">{insight.belief}%</span>
          </div>
          <p className="mt-1 text-[11px] text-surface-400">How confident the model is</p>
        </div>
      </div>

      <PickReasons insight={insight} className="mt-3 px-4" />

      {rest.length > 0 ? (
        <div className="mt-3 space-y-1.5 px-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-500">Also on this match</p>
          {/*
            Two, not four. A card that explains every market the model priced
            stops being a card and becomes a page a thumb has to fight through.
          */}
          {rest.slice(0, 2).map((tip) => (
            <SecondaryTip key={tip.id} tip={tip} match={match} />
          ))}
        </div>
      ) : null}

      <div className="h-3" />
    </article>
  );
}

/**
 * A second market on the same fixture, kept to one line.
 *
 * Three full explanation blocks on one card would bury the headline pick, so a
 * secondary market shows its selection and confidence and keeps its reasons one
 * tap away.
 */
function SecondaryTip({ tip, match }: { tip: Tip; match: TipMatch }) {
  const insight = explainPick({
    market: tip.market,
    selection: tip.selection,
    confidence: tip.confidence,
    valueEdge: tip.valueEdge,
    expectedHomeGoals: tip.expectedHomeGoals,
    expectedAwayGoals: tip.expectedAwayGoals,
    homeWinPct: tip.homeWinPct,
    drawPct: tip.drawPct,
    awayWinPct: tip.awayWinPct,
    rationale: tip.rationale,
    match: {
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      oddsHome: match.oddsHome,
      oddsDraw: match.oddsDraw,
      oddsAway: match.oddsAway,
    },
  });

  return (
    <details className="rounded-xl border border-surface-800 bg-surface-900/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-surface-500">
            {insight.marketPlain}
          </span>
          <span className="block truncate text-sm font-semibold text-surface-200">{tip.selection}</span>
        </span>
        <span className="shrink-0 text-[11px] font-bold tabular-nums text-surface-300">{insight.belief}%</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-surface-500" />
      </summary>
      <div className="px-3 pb-3">
        <PickReasons insight={insight} compact />
      </div>
    </details>
  );
}
