"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { PickReasons, REASON_ICONS } from "./PickReasons";
import ReferralCards from "./ReferralCards";
import { ShareMenu } from "@/components/ui/ShareMenu";

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
   * The fixture a shared link points at (`?match=`).
   *
   * A share used to carry the board and nothing else, so a message claiming
   * "Over 2.5 at 61%" dropped its recipient on twelve cards and left them to
   * find the one being talked about. The pick's own card is the landing target
   * now: scrolled to and ringed once, on arrival, and never again — re-scrolling
   * on the 60-second refresh would hijack a reader who had already moved on.
   */
  const [focusMatch, setFocusMatch] = useState<string | null>(null);
  const scrolledToFocus = useRef(false);

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

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("match");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the ?match= deep link a shared pick carries
    if (requested) setFocusMatch(requested);
  }, []);

  useEffect(() => {
    if (!focusMatch || !data || scrolledToFocus.current) return;
    // Quote the value the same way the selector does, so an id containing a
    // quote cannot break out of the attribute selector.
    const escaped = focusMatch.replace(/["\\]/g, "\\$&");
    const target = document.querySelector(`[data-match="${escaped}"]`);
    if (!target) return;
    scrolledToFocus.current = true;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusMatch, data]);

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
          {/*
            Sharing the board leads with the record, not with an invite: a model
            that publishes how often it has been right is the reason to send this
            on, and the recipient gets something to judge before they tap through.
          */}
          <ShareMenu
            url="/sports?tab=tips"
            title="Today's football picks, with the reasoning"
            description={
              record && record.settled > 0
                ? `${data?.picks.length ?? 0} picks today from a model running at ${record.accuracy}% across ${record.settled} settled tips — each with why.`
                : `${data?.picks.length ?? 0} picks today, each with the reasoning behind it. Only picks you can still act on.`
            }
            hashtags={["Sports", "BettingTips", "Kenya"]}
            image="/og-tips.png"
            campaign="tips"
            content="board"
            ariaLabel="Share today's tips"
            align="left"
          />
        </div>

        {/*
          Market chips and the sort toggle, in one pinned bar.

          Two things were wrong with this row on a phone. It scrolled away with
          the page, so changing market meant scrolling back to the top of a long
          board; and it sat under four stacked header rows, which pushed the
          first actual pick below the fold. It now pins directly beneath the app
          navbar — the same treatment the score board's toolbar and the fixture
          calendar's month stepper get.

          The bar's contents are laid out so they can never widen the page. Four
          `shrink-0` chips with a `shrink-0` sort toggle in a nowrap flex row
          measured 799px on a 390px screen: nothing in that row could shrink or
          wrap, so the overflow escaped every ancestor and the whole document
          became sideways-scrollable — on every board, not just this one. The
          chips therefore ride a contained rail and the toggle gets its own row
          until there is room to sit beside them.
        */}
        <div className="sports-toolbar sticky -mx-3 mt-2.5 border-b border-surface-900/60 bg-surface-950/95 px-3 pb-2 pt-2 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {/* A rail, not a wrap: five market names wrap into three ragged rows
                on a phone. Contained here, so the overflow has somewhere to go
                and the edge-to-edge bleed reads as "there is more this way". */}
            <div className="scrollbar-hide -mx-3 flex shrink-0 items-center gap-2 overflow-x-auto px-3 sm:mx-0 sm:flex-1 sm:flex-wrap sm:overflow-visible sm:px-0">
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
            </div>
            <div className="flex items-center justify-between gap-2 sm:ml-auto sm:justify-end">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-500 sm:hidden">
                Sort by
              </span>
              <div className="flex items-center rounded-xl border border-surface-800 bg-surface-900/70 p-1">
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
          /*
            `auto-rows-fr` gives every row the same height, so a card whose
            reasons run to four lines sits level with one that has two instead of
            leaving a ragged bottom edge down the board — and `h-full` on the card
            makes it fill that row. The sponsored placement is deliberately NOT a
            cell in this grid: as a full-width row it cut the board in half and
            left the cards either side of it stranded at different heights, so it
            now sits below the picks as its own band, where it cannot disturb the
            rhythm of the thing the reader came for.
          */
          <div className="mt-5 grid auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {groups.map((group) => (
              <FixtureTipsCard key={group.key} group={group} focus={focusMatch === group.match.id} />
            ))}
          </div>
        )}

        {inlineAd && !loading && data && data.picks.length > 0 ? (
          <div className="mt-5">{inlineAd}</div>
        ) : null}

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
function FixtureTipsCard({ group, focus = false }: { group: FixtureGroup; focus?: boolean }) {
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
    <article
      data-match={match.id}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-gradient-to-b from-surface-900/70 to-surface-950/60 transition duration-300 hover:border-emerald-500/40 hover:shadow-[0_0_0_1px_rgba(16,185,129,0.1)] motion-safe:animate-rise",
        focus ? "border-emerald-500/60 shadow-[0_0_0_1px_rgba(16,185,129,0.28)]" : "border-surface-800/70"
      )}
    >
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500/60 via-brand-500/40 to-transparent" />

      <div className="flex items-center justify-between gap-2 border-b border-surface-800/60 px-4 py-2.5">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-surface-500">
          {match.competition}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={kickoffPill(kickoff)} title={kickoff.live ? "Happening now" : "Kick-off"}>
            {kickoff.live ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> : <Clock className="h-3 w-3" />}
            {kickoff.text}
          </span>
          {/*
            The pick and the model's own confidence travel in the message. A bare
            link gives whoever receives it nothing to weigh, and this card's whole
            argument is that the reasoning is the product.
          */}
          <ShareMenu
            // The fixture's own deep link, not the board: whoever receives this
            // lands on this card, highlighted, which is the difference between
            // "here is a claim" and "here is the claim, verified".
            url={`/sports?tab=tips&match=${encodeURIComponent(match.id)}`}
            title={`${match.homeTeam} vs ${match.awayTeam}: ${lead.selection}`}
            description={`${insight.belief}% from the model — ${insight.marketPlain.toLowerCase()} in ${match.competition}${kickoff.live ? ", in play now" : ""}.`}
            hashtags={["Sports", match.competition]}
            image="/og-tips.png"
            campaign="tips"
            content="pick"
            ariaLabel={`Share the ${match.homeTeam} vs ${match.awayTeam} pick`}
            compact
            align="right"
          />
        </div>
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

      <PickReasons insight={insight} className="mt-3 px-4" limit={3} showNote={false} />

      {/*
        The full working, one disclosure per card.

        Three reasons is what a reader takes in before they start skimming; the
        fourth, the model's own audit trail and the raw numbers it worked from
        are what they want when they are deciding whether to trust the pick. So
        the card shows the case and keeps the evidence one tap behind it, rather
        than printing both and reading as a wall of small print — which is what
        made these cards hard to scan in the first place.
      */}
      <details className="mx-4 mt-2 rounded-xl border border-surface-800 bg-surface-900/40">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-[11px] font-semibold text-surface-400 transition hover:text-surface-200">
          <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
          The full working
        </summary>
        <div className="space-y-2.5 px-2.5 pb-2.5">
          {insight.reasons.slice(3).map((reason) => {
            const Icon = REASON_ICONS[reason.icon];
            return (
              <div key={reason.label} className="flex gap-2.5">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-surface-800/80 text-emerald-300">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold text-surface-200">{reason.label}</span>
                  <span className="block text-[11px] leading-relaxed text-surface-400">{reason.detail}</span>
                </span>
              </div>
            );
          })}

          <dl className="grid grid-cols-2 gap-2">
            <WorkingDetail
              label="Goals we expect"
              value={expectedGoals(lead)}
            />
            <WorkingDetail
              label="Price vs our number"
              value={
                lead.valueEdge == null
                  ? "no price to compare"
                  : `${lead.valueEdge > 0 ? "+" : ""}${lead.valueEdge.toFixed(1)} pts`
              }
            />
            <WorkingDetail label="Kick-off" value={kickoff.text} />
            <WorkingDetail
              label="Markets priced"
              value={`${tips.length} on this match`}
            />
          </dl>

          {insight.note ? (
            <p className="border-t border-surface-800 pt-2 text-[11px] leading-relaxed text-surface-400">
              {insight.note}
            </p>
          ) : null}
        </div>
      </details>

      {rest.length > 0 ? (
        <div className="mb-3 mt-3 space-y-1.5 px-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-500">Also on this match</p>
          {/*
            Two, not four. A card that explains every market the model priced
            stops being a card and becomes a page a thumb has to fight through.
          */}
          {rest.slice(0, 2).map((tip) => (
            <SecondaryTip key={tip.id} tip={tip} match={match} />
          ))}
        </div>
      ) : (
        /* Keeps the row's bottom edge level whether a card has a second market
           on it or not — see `auto-rows-fr` on the grid. */
        <div className="mt-auto" />
      )}
    </article>
  );
}

/** One line of the model's working, as a label/value pair. */
function WorkingDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-800/50 px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-surface-500">{label}</dt>
      <dd className="mt-0.5 text-[11px] font-semibold text-surface-200">{value}</dd>
    </div>
  );
}

/** "2.4 goals", or an honest shrug when the model published none. */
function expectedGoals(tip: Tip): string {
  if (typeof tip.expectedHomeGoals !== "number" || typeof tip.expectedAwayGoals !== "number") {
    return "not published";
  }
  const total = Math.round((tip.expectedHomeGoals + tip.expectedAwayGoals) * 10) / 10;
  return `${total} total (${tip.expectedHomeGoals}–${tip.expectedAwayGoals})`;
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
