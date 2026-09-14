"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Brain,
  Info,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
  Target,
  Timer,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { matchEndpoint } from "@/lib/sports-endpoint";
import { explainPick } from "@/lib/pick-insights";
import { PickReasons } from "./PickReasons";

/** What a caller needs to know to open one fixture's match centre. */
export interface MatchRef {
  provider: string;
  externalId: string;
  homeTeam: string;
  awayTeam: string;
  competition?: string | null;
  status?: string | null;
  minute?: number | null;
  homeScore?: number | null;
  awayScore?: number | null;
  kickoff?: string | null;
}

/* Responses mirror `src/lib/sports-detail.ts` — kept structural on purpose so
 * the panel degrades gracefully if the provider stops publishing a field. */

interface MatchEvent {
  id: string;
  minute: number | null;
  minuteLabel: string;
  kind: string;
  teamName: string | null;
  players: string[];
  text: string;
  scoring: boolean;
  position: { x: number; y: number } | null;
}

interface TeamStat {
  name: string;
  label: string;
  home: number | null;
  away: number | null;
  homeDisplay: string;
  awayDisplay: string;
  unit: string;
  higherIsBetter: boolean;
}

interface LineupPlayer {
  id: string;
  name: string;
  shortName: string;
  jersey: string | null;
  position: string | null;
  starter: boolean;
  rating: number | null;
  ratingBasis: string[];
  stats: { name: string; label: string; value: string }[];
}

interface TeamLineup {
  side: "home" | "away";
  teamName: string;
  formation: string | null;
  starters: LineupPlayer[];
  bench: LineupPlayer[];
  averageRating: number | null;
}

interface MatchDetailPayload {
  found: boolean;
  source: string;
  sourceUrl: string | null;
  competition: string | null;
  status: string | null;
  homeTeam: string;
  awayTeam: string;
  events: MatchEvent[];
  stats: TeamStat[];
  lineups: TeamLineup[];
  momentum: { minute: number; value: number }[];
  shots: MatchEvent[];
  commentary: { minute: string; text: string }[];
  insights: { label: string; text: string; basis: "measured" | "derived" }[];
  h2h: { title: string; summary: string; label: string } | null;
  lastFive: { team: string; games: string[] }[];
  info: { venue: string | null; attendance: string | null; oddsSummary: string | null };
  derived: string[];
  coverage: Record<string, boolean>;
  note?: string;
}

interface ApiPrediction {
  id: string;
  market: string;
  marketLabel: string;
  selection: string;
  confidence: number;
  homeWinPct: number | null;
  drawPct: number | null;
  awayWinPct: number | null;
  expectedHomeGoals: number | null;
  expectedAwayGoals: number | null;
  valueEdge: number | null;
  rationale: string;
  status: string;
}

interface MatchPayload {
  generatedAt: string;
  detail: MatchDetailPayload;
  predictions: ApiPrediction[];
}

type TabKey = "analysis" | "timeline" | "stats" | "lineups" | "momentum" | "shots" | "h2h" | "model";

interface TabDef {
  key: TabKey;
  label: string;
  icon: typeof Activity;
  available: boolean;
}

/**
 * The match centre: everything measurable about one fixture, in one panel.
 *
 * The tabs are built from the `coverage` the server reports, so a fixture with no
 * lineups simply has no Lineups tab — instead of a tab that opens onto an empty
 * box, which reads as a bug. Anything we cannot source at all (heatmaps, market
 * value, player careers) is named explicitly in the Analysis tab as unavailable,
 * because a reader who knows what they are missing trusts the rest more.
 */
export default function MatchDetail({ match, pollSeconds = 30 }: { match: MatchRef; pollSeconds?: number }) {
  const [payload, setPayload] = useState<MatchPayload | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey | null>(null);

  const live = match.status === "LIVE" || match.status === "HT";
  const key = `${match.provider}:${match.externalId}`;

  const load = useCallback(
    async (opts: { fresh?: boolean; regenerate?: boolean; signal?: AbortSignal } = {}) => {
      if (opts.fresh) setRefreshing(true);
      try {
        // Edge-tier read (see `matchEndpoint`): an open panel polls this every
        // 30s while the match is live, so it must not be a Vercel invocation per
        // viewer per poll.
        const url = matchEndpoint({
          provider: match.provider,
          externalId: match.externalId,
          home: match.homeTeam,
          away: match.awayTeam,
          fresh: opts.fresh,
          regenerate: opts.regenerate,
        });
        const res = await fetch(url, { signal: opts.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as MatchPayload;
        setPayload(data);
        setState("ready");
        setError(null);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setError((err as Error)?.message ?? "Could not load this match");
        setState((prev) => (prev === "ready" ? "ready" : "error"));
      } finally {
        if (opts.fresh) setRefreshing(false);
      }
    },
    [match.provider, match.externalId, match.homeTeam, match.awayTeam]
  );

  // Reset when the reader opens a different fixture: showing the previous match's
  // timeline under a new header for a moment is worse than a brief spinner.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the panel switches to another fixture
    setPayload(null);
    setState("loading");
    setTab(null);
  }, [key]);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch of this fixture's deep read
    void load({ signal: controller.signal });
    return () => controller.abort();
    // `live` is in the deps so a match going live starts the faster cadence.
  }, [load, live]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      void load({});
    }, Math.max(pollSeconds, 10) * 1000);
    return () => clearInterval(id);
  }, [live, load, pollSeconds]);

  const detail = payload?.detail ?? null;

  const tabs = useMemo<TabDef[]>(() => {
    const c = detail?.coverage ?? {};
    const available = (name: string) => c[name] === true;
    const defs: TabDef[] = [
      { key: "analysis", label: "Analysis", icon: Sparkles, available: (detail?.insights.length ?? 0) > 0 || detail?.found === true },
      { key: "timeline", label: "Timeline", icon: Timer, available: available("timeline") },
      { key: "stats", label: "Stats", icon: BarChart3, available: available("teamStats") },
      { key: "lineups", label: "Lineups", icon: Users, available: available("lineups") },
      { key: "momentum", label: "Momentum", icon: Activity, available: available("momentum") },
      { key: "shots", label: "Shot map", icon: Target, available: available("shotMap") },
      { key: "h2h", label: "H2H", icon: Trophy, available: available("h2h") || (detail?.lastFive.length ?? 0) > 0 },
      { key: "model", label: "Our model", icon: Brain, available: (payload?.predictions.length ?? 0) > 0 },
    ];
    return defs;
  }, [detail, payload]);

  const openTabs = tabs.filter((t) => t.available);
  const active: TabKey = (tab && tabs.find((t) => t.key === tab && t.available)?.key) || openTabs[0]?.key || "analysis";

  return (
    <div className="overflow-hidden rounded-2xl border border-surface-800/70 bg-surface-900/40">
      <Header match={match} detail={detail} refreshing={refreshing}          onRefresh={() => void load({ fresh: true, regenerate: true })} />

      {state === "loading" || (state === "idle" && !payload) ? (
        <div className="flex items-center gap-2 px-4 py-8 text-xs text-surface-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the full match read…
        </div>
      ) : state === "error" ? (
        <div className="px-4 py-6 text-xs text-surface-400">
          <p className="text-surface-300">We couldn&apos;t load the deep read for this fixture.</p>
          {error ? <p className="mt-1 text-surface-500">{error}</p> : null}
          <button
            onClick={() => void load({ fresh: true, regenerate: true })}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-surface-700 px-2.5 py-1.5 text-[11px] font-medium text-surface-200 transition hover:border-brand-500/60 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Try again
          </button>
        </div>
      ) : (
        <>
          {openTabs.length > 1 ? (
            <div className="flex gap-1 overflow-x-auto border-b border-surface-800/70 px-2 py-2">
              {openTabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition",
                    active === t.key
                      ? "bg-brand-500/15 text-brand-200"
                      : "text-surface-400 hover:bg-surface-800/60 hover:text-surface-100"
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="px-3 py-3 sm:px-4 sm:py-4">
            {!detail?.found ? (
              <EmptyDetail
                note={detail?.note ?? "We do not have the detailed match data for this one yet."}
                predictions={payload?.predictions ?? []}
              />
            ) : active === "analysis" ? (
              <AnalysisTab detail={detail} predictions={payload?.predictions ?? []} />
            ) : active === "timeline" ? (
              <TimelineTab detail={detail} />
            ) : active === "stats" ? (
              <StatsTab detail={detail} />
            ) : active === "lineups" ? (
              <LineupsTab detail={detail} />
            ) : active === "momentum" ? (
              <MomentumTab detail={detail} />
            ) : active === "shots" ? (
              <ShotMapTab detail={detail} />
            ) : active === "h2h" ? (
              <H2HTab detail={detail} />
            ) : (
              <ModelTab detail={detail} predictions={payload?.predictions ?? []} />
            )}
          </div>

          {detail?.sourceUrl ? (
            <p className="border-t border-surface-800/60 px-4 py-2 text-[10px] text-surface-600">
              Match data from: {detail.source === "espn-summary" ? "ESPN" : detail.source}
              {detail.derived.length > 0 ? ` · worked out by us: ${detail.derived.join(", ")}` : ""} ·{" "}
              <a href={detail.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline hover:text-surface-400">
                source
              </a>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function Header({
  match,
  detail,
  refreshing,
  onRefresh,
}: {
  match: MatchRef;
  detail: MatchDetailPayload | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const live = match.status === "LIVE" || match.status === "HT";
  const homeScore = match.homeScore ?? null;
  const awayScore = match.awayScore ?? null;
  const kickoff = match.kickoff ? new Date(match.kickoff) : null;

  return (
    <div className="border-b border-surface-800/70 bg-surface-950/60 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-surface-500">
        <span className="truncate font-medium text-surface-400">{match.competition ?? detail?.competition ?? "Fixture"}</span>
        {detail?.info.venue ? (
          <span className="inline-flex items-center gap-1 truncate">
            <MapPin className="h-3 w-3" /> {detail.info.venue}
          </span>
        ) : null}
        {detail?.info.attendance ? <span>· {detail.info.attendance}</span> : null}
        {detail?.info.oddsSummary ? <span>· {detail.info.oddsSummary}</span> : null}
        <button
          onClick={onRefresh}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-surface-800 px-2 py-1 text-[10px] font-medium text-surface-400 transition hover:border-brand-500/50 hover:text-surface-100"
          aria-label="Refresh this match"
        >
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-surface-50">{match.homeTeam}</p>
          <p className="truncate text-sm font-semibold text-surface-50">{match.awayTeam}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-black leading-tight tabular-nums text-surface-50">
            {homeScore ?? "–"}
            <span className="mx-1 text-surface-600">:</span>
            {awayScore ?? "–"}
          </p>
          <p
            className={cn(
              "mt-0.5 text-[10px] font-semibold uppercase tracking-wide",
              live ? "text-red-400" : "text-surface-500"
            )}
          >
            {live ? (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
                {match.status === "HT" ? "Half time" : match.minute ? `${match.minute}'` : "Live"}
              </span>
            ) : kickoff ? (
              kickoff.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
            ) : (
              "—"
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Analysis                                                           */
/* ------------------------------------------------------------------ */

function AnalysisTab({ detail, predictions }: { detail: MatchDetailPayload; predictions: ApiPrediction[] }) {
  const missing = [
    { key: "heatmaps", label: "Positional heatmaps", why: "this needs player-tracking data we do not have" },
    { key: "playerMarketValue", label: "Player market value", why: "this is paid data we do not licence" },
    { key: "careerAnalytics", label: "Career analytics", why: "not published by the free provider" },
  ].filter((m) => detail.coverage[m.key] !== true);

  return (
    <div className="space-y-3">
      {detail.insights.length === 0 ? (
        <p className="text-xs text-surface-500">
          Not enough measured data yet to write a read on this match. Insights appear as soon as the provider
          publishes events and stats.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {/* Three across on a wide screen: the insights are read as a panel, and
              two columns leave a dead strip on a desktop while three read cleanly. */}
          {detail.insights.map((insight, i) => (
            <li key={`${insight.label}-${i}`} className="rounded-xl border border-surface-800/60 bg-surface-900/40 p-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-brand-300">{insight.label}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                    insight.basis === "measured" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
                  )}
                  title={
                    insight.basis === "measured"
                      ? "Read straight from the match data"
                      : "Worked out by us from the match numbers"
                  }
                >
                  {insight.basis === "measured" ? "from the data" : "our working"}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-surface-300">{insight.text}</p>
            </li>
          ))}
        </ul>
      )}

      {predictions.length > 0 ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
            <Brain className="h-3.5 w-3.5" /> What our model makes of it
          </p>
          <ul className="mt-2 space-y-1.5">
            {predictions.slice(0, 4).map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className="text-surface-300">
                  <span className="text-surface-500">{p.marketLabel}:</span> {p.selection}
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-emerald-300">
                  {(p.confidence * 100).toFixed(0)}%
                  {p.valueEdge != null ? (
                    <span className={cn("ml-2 font-normal", p.valueEdge > 0 ? "text-emerald-400" : "text-amber-400")}>
value {p.valueEdge > 0 ? "+" : ""}
                      {p.valueEdge.toFixed(1)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div className="rounded-xl border border-surface-800/60 bg-surface-900/30 p-3">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-surface-500">
            <Info className="h-3 w-3" /> Not available for this fixture
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[11px] text-surface-500">
            {missing.map((m) => (
              <li key={m.key}>
                <span className="text-surface-400">{m.label}</span> — {m.why}.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                           */
/* ------------------------------------------------------------------ */

const EVENT_STYLE: Record<string, { label: string; dot: string }> = {
  goal: { label: "Goal", dot: "bg-emerald-400" },
  "own-goal": { label: "Own goal", dot: "bg-red-400" },
  penalty: { label: "Penalty", dot: "bg-emerald-400" },
  yellow: { label: "Yellow", dot: "bg-amber-400" },
  red: { label: "Red", dot: "bg-red-500" },
  sub: { label: "Sub", dot: "bg-sky-400" },
  kickoff: { label: "Kick-off", dot: "bg-surface-500" },
  halftime: { label: "Half time", dot: "bg-surface-500" },
  fulltime: { label: "Full time", dot: "bg-surface-500" },
  other: { label: "—", dot: "bg-surface-600" },
};

function TimelineTab({ detail }: { detail: MatchDetailPayload }) {
  const events = [...detail.events].sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));

  if (events.length === 0) return <p className="text-xs text-surface-500">No key events published yet.</p>;

  return (
    <div className="space-y-4">
      <ul className="relative space-y-1.5">
        {events.map((event) => {
          const style = EVENT_STYLE[event.kind] ?? EVENT_STYLE.other!;
          const isHome = !event.teamName || event.teamName === detail.homeTeam;
          return (
            <li key={event.id} className="flex items-stretch gap-2">
              <div className={cn("flex w-[46%] justify-end", isHome ? "" : "order-3 justify-start")}>
                <div className={cn("min-w-0 text-right", isHome ? "" : "text-left")}>
                  <p className="truncate text-[11px] font-semibold text-surface-100">
                    {event.players.length > 0 ? event.players.join(", ") : style.label}
                  </p>
                  {event.text ? <p className="truncate text-[10px] text-surface-500">{event.text}</p> : null}
                </div>
              </div>

              <div className={cn("flex w-[8%] shrink-0 flex-col items-center", isHome ? "order-2" : "order-2")}>
                <span className={cn("mt-1 h-2 w-2 rounded-full", style.dot)} />
                <span className="mt-0.5 text-[10px] font-bold tabular-nums text-surface-400">
                  {event.minuteLabel || (event.minute != null ? `${event.minute}'` : "—")}
                </span>
              </div>

              <div className={cn("flex w-[46%]", isHome ? "order-3" : "order-1 justify-end")} />
            </li>
          );
        })}
      </ul>

      {detail.commentary.length > 0 ? (
        <div className="rounded-xl border border-surface-800/60 bg-surface-900/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Latest commentary</p>
          <ul className="mt-2 space-y-1.5">
            {detail.commentary.slice(0, 8).map((line, i) => (
              <li key={`${line.minute}-${i}`} className="flex gap-2 text-[11px]">
                <span className="w-9 shrink-0 tabular-nums text-surface-500">{line.minute || "—"}</span>
                <span className="text-surface-300">{line.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                              */
/* ------------------------------------------------------------------ */

function StatsTab({ detail }: { detail: MatchDetailPayload }) {
  const [onlyKey, setOnlyKey] = useState(true);
  const KEY = new Set([
    "possessionPct",
    "totalShots",
    "shotsOnTarget",
    "wonCorners",
    "foulsCommitted",
    "yellowCards",
    "redCards",
    "saves",
    "offsides",
    "passPct",
  ]);
  const rows = onlyKey ? detail.stats.filter((s) => KEY.has(s.name)) : detail.stats;
  const visible = rows.length > 0 ? rows : detail.stats;

  if (visible.length === 0) return <p className="text-xs text-surface-500">No team statistics published yet.</p>;

  return (
    <div className="space-y-3">
      <button
        onClick={() => setOnlyKey((v) => !v)}
        className="rounded-lg border border-surface-800 px-2.5 py-1 text-[10px] font-medium text-surface-400 transition hover:border-brand-500/50 hover:text-surface-100"
      >
        {onlyKey ? `Show all ${detail.stats.length} statistics` : "Show key statistics only"}
      </button>

      <ul className="space-y-2.5">
        {visible.map((s) => (
          <li key={s.name}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="tabular-nums font-semibold text-surface-100">
                {s.homeDisplay}
                {s.unit === "%" ? "%" : ""}
              </span>
              <span className="text-surface-500">{s.label}</span>
              <span className="tabular-nums font-semibold text-surface-100">
                {s.awayDisplay}
                {s.unit === "%" ? "%" : ""}
              </span>
            </div>
            <StatBar stat={s} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatBar({ stat }: { stat: TeamStat }) {
  const home = stat.home ?? 0;
  const away = stat.away ?? 0;
  const total = home + away;
  const homePct = total > 0 ? (home / total) * 100 : 50;
  const homeLeads = stat.higherIsBetter ? home > away : home < away;
  const awayLeads = stat.higherIsBetter ? away > home : away < home;

  return (
    <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-800">
      <div className={cn("h-full", homeLeads ? "bg-brand-500" : "bg-surface-600")} style={{ width: `${homePct}%` }} />
      <div className={cn("h-full", awayLeads ? "bg-accent-coral" : "bg-surface-700")} style={{ width: `${100 - homePct}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lineups                                                            */
/* ------------------------------------------------------------------ */

type ChipKey = "rating" | "position" | "shirt" | "stats" | "basis";

function LineupsTab({ detail }: { detail: MatchDetailPayload }) {
  const [chips, setChips] = useState<Set<ChipKey>>(new Set(["rating", "position"]));
  const [showBench, setShowBench] = useState(false);

  function toggle(chip: ChipKey) {
    setChips((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  }

  const ledges = detail.lineups;
  if (ledges.length === 0) return <p className="text-xs text-surface-500">Lineups are not published for this fixture yet.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-surface-500">Show</span>
        {(
          [
            ["rating", "Rating"],
            ["position", "Position"],
            ["shirt", "Shirt"],
            ["stats", "Match stats"],
            ["basis", "Why that rating"],
          ] as [ChipKey, string][]
        ).map(([chip, label]) => (
          <button
            key={chip}
            onClick={() => toggle(chip)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium transition",
              chips.has(chip)
                ? "border-brand-500/50 bg-brand-500/15 text-brand-200"
                : "border-surface-800 text-surface-500 hover:text-surface-300"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-2">
        {ledges.map((lineup) => (
          <div key={lineup.side} className="rounded-xl border border-surface-800/60 bg-surface-900/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="truncate text-xs font-semibold text-surface-100">{lineup.teamName}</p>
              <div className="flex items-center gap-2 text-[10px] text-surface-500">
                {lineup.formation ? <span className="rounded bg-surface-800 px-1.5 py-0.5 font-semibold text-surface-300">{lineup.formation}</span> : null}
                {lineup.averageRating != null ? <span>avg rating {lineup.averageRating.toFixed(1)}</span> : null}
              </div>
            </div>

            <ul className="mt-2 space-y-1">
              {(showBench ? lineup.bench : lineup.starters).map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-800/40">
                  {chips.has("shirt") && p.jersey ? (
                    <span className="w-5 shrink-0 text-center text-[10px] tabular-nums text-surface-500">{p.jersey}</span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-[11px] text-surface-200">{p.shortName}</span>
                  {chips.has("position") && p.position ? (
                    <span className="shrink-0 text-[10px] text-surface-500">{p.position}</span>
                  ) : null}
                  {chips.has("stats") && p.stats.length > 0 ? (
                    <span className="hidden shrink-0 gap-1.5 text-[10px] text-surface-500 sm:flex">
                      {p.stats.slice(0, 3).map((s) => (
                        <span key={s.name} title={s.label}>
                          {s.value}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {chips.has("rating") && p.rating != null ? (
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                        p.rating >= 7.5 ? "bg-emerald-500/20 text-emerald-300" : p.rating >= 6.5 ? "bg-surface-700 text-surface-200" : "bg-amber-500/15 text-amber-300"
                      )}
                    >
                      {p.rating.toFixed(1)}
                    </span>
                  ) : null}
                  {chips.has("basis") && p.ratingBasis.length > 0 ? (
                    <span className="hidden shrink-0 text-[9px] text-surface-600 md:inline" title={p.ratingBasis.join(" · ")}>
                      {p.ratingBasis[0]}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>

            {lineup.bench.length > 0 ? (
              <button
                onClick={() => setShowBench((v) => !v)}
                className="mt-2 text-[10px] font-medium text-surface-500 transition hover:text-surface-300"
              >
                {showBench ? "Hide substitutes" : `Show ${lineup.bench.length} substitutes`}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <p className="text-[10px] leading-relaxed text-surface-600">
        Ratings are the <span className="text-surface-500">connectPlus Rating</span> — computed here from the
        provider&apos;s per-player stats, so they are marked as derived rather than measured.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Momentum                                                           */
/* ------------------------------------------------------------------ */

function MomentumTab({ detail }: { detail: MatchDetailPayload }) {
  const points = detail.momentum;
  if (points.length === 0) return <p className="text-xs text-surface-500">No play-by-play to build momentum from yet.</p>;

  const peak = Math.max(0.001, ...points.map((p) => Math.abs(p.value)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] text-surface-500">
        <span className="inline-flex items-center gap-1 text-surface-300">
          <Zap className="h-3 w-3 text-brand-400" /> {detail.homeTeam}
        </span>
        <span>Attack momentum · 5-minute windows</span>
        <span className="text-surface-300">{detail.awayTeam}</span>
      </div>

      <div className="relative">
        <div className="absolute inset-x-0 top-1/2 h-px bg-surface-700" />
        <div className="flex h-28 items-stretch gap-[2px]">
          {points.map((p) => {
            const height = (Math.abs(p.value) / peak) * 48;
            return (
              <div key={p.minute} className="flex flex-1 flex-col justify-center" title={`${p.minute}' · ${p.value.toFixed(2)}`}>
                <div className="flex flex-1 items-end">
                  <div className={cn("w-full rounded-t-sm", p.value >= 0 ? "bg-brand-500/80" : "bg-transparent")} style={{ height: p.value >= 0 ? `${height}%` : 0 }} />
                </div>
                <div className="flex flex-1 items-start">
                  <div className={cn("w-full rounded-b-sm", p.value < 0 ? "bg-accent-coral/80" : "bg-transparent")} style={{ height: p.value < 0 ? `${height}%` : 0 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-between text-[9px] tabular-nums text-surface-600">
        <span>0&apos;</span>
        <span>{Math.round(points.length / 2) * 5}&apos;</span>
        <span>{points[points.length - 1]?.minute}&apos;</span>
      </div>

      <p className="text-[10px] leading-relaxed text-surface-600">
        Computed here from the provider&apos;s play-by-play: every goal, shot, corner and foul is weighted and
        smoothed into 5-minute windows, then scaled to the biggest swing in this match. It measures pressure in
        this game only — not possession, and not quality.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shot map                                                           */
/* ------------------------------------------------------------------ */

function ShotMapTab({ detail }: { detail: MatchDetailPayload }) {
  const shots = detail.shots;
  if (shots.length === 0) return <p className="text-xs text-surface-500">No shot coordinates published for this fixture.</p>;

  const homeShots = shots.filter((s) => !s.teamName || s.teamName === detail.homeTeam);
  const awayShots = shots.filter((s) => s.teamName && s.teamName !== detail.homeTeam);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-surface-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brand-400" /> {detail.homeTeam} ({homeShots.length})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent-coral" /> {detail.awayTeam} ({awayShots.length})
        </span>
        <span className="text-surface-600">hollow = on target saved / off target · solid = goal</span>
      </div>

      <div className="relative mx-auto aspect-[3/2] w-full max-w-xl overflow-hidden rounded-xl border border-emerald-900/50 bg-emerald-950/40">
        {/* Halfway line + centre circle + both penalty boxes, so a marker's
            position is readable without a legend. */}
        <div className="absolute inset-y-0 left-1/2 w-px bg-emerald-800/50" />
        <div className="absolute left-1/2 top-1/2 h-[26%] w-[26%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-800/50" />
        <div className="absolute left-0 top-1/2 h-[52%] w-[14%] -translate-y-1/2 border border-emerald-800/50" />
        <div className="absolute right-0 top-1/2 h-[52%] w-[14%] -translate-y-1/2 border border-emerald-800/50" />

        {shots.map((shot) => {
          if (!shot.position) return null;
          const isHome = !shot.teamName || shot.teamName === detail.homeTeam;
          return (
            <span
              key={shot.id}
              title={`${shot.minuteLabel || `${shot.minute}'`} · ${shot.players.join(", ")} · ${shot.text}`}
              className={cn(
                "absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2",
                isHome ? "border-brand-400 bg-brand-500/60" : "border-accent-coral bg-accent-coral/50",
                shot.scoring && "border-white bg-white ring-2 ring-white/40"
              )}
              style={{ left: `${shot.position.x}%`, top: `${shot.position.y}%` }}
            />
          );
        })}
      </div>

      <p className="text-[10px] leading-relaxed text-surface-600">
        Positions come from the provider&apos;s shot coordinates, drawn on a 100×100 pitch. Shots the provider
        publishes without coordinates are listed in the timeline but cannot be plotted.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Head to head                                                       */
/* ------------------------------------------------------------------ */

function H2HTab({ detail }: { detail: MatchDetailPayload }) {
  return (
    <div className="space-y-3">
      {detail.h2h?.summary ? (
        <div className="rounded-xl border border-surface-800/60 bg-surface-900/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">{detail.h2h.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-surface-200">{detail.h2h.summary}</p>
        </div>
      ) : null}

      {detail.lastFive.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {detail.lastFive.map((team) => (
            <div key={team.team} className="rounded-xl border border-surface-800/60 bg-surface-900/30 p-3">
              <p className="truncate text-[11px] font-semibold text-surface-200">{team.team}</p>
              <div className="mt-1.5 flex gap-1">
                {team.games.map((g, i) => (
                  <span
                    key={`${g}-${i}`}
                    className={cn(
                      "grid h-5 w-5 place-items-center rounded text-[10px] font-bold",
                      g.startsWith("W") ? "bg-emerald-500/20 text-emerald-300" : g.startsWith("L") ? "bg-red-500/20 text-red-300" : "bg-surface-700 text-surface-300"
                    )}
                  >
                    {g.slice(0, 1)}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-surface-600">Most recent first</p>
            </div>
          ))}
        </div>
      ) : null}

      {!detail.h2h && detail.lastFive.length === 0 ? (
        <p className="text-xs text-surface-500">We have no recent meetings between these two on record.</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Model                                                              */
/* ------------------------------------------------------------------ */

const TIER_STYLES: Record<string, string> = {
  strong: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  good: "border-brand-500/30 bg-brand-500/15 text-brand-200",
  close: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  longshot: "border-surface-700 bg-surface-800 text-surface-300",
};

function ModelTab({ detail, predictions }: { detail: MatchDetailPayload; predictions: ApiPrediction[] }) {
  if (predictions.length === 0) {
    return (
      <p className="text-xs text-surface-500">
        No pick on this match yet. Our model writes one before kick-off, and updates it when team news lands.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {predictions.map((p) => {
        const insight = explainPick({
          market: p.market,
          selection: p.selection,
          confidence: p.confidence,
          valueEdge: p.valueEdge,
          expectedHomeGoals: p.expectedHomeGoals,
          expectedAwayGoals: p.expectedAwayGoals,
          homeWinPct: p.homeWinPct,
          drawPct: p.drawPct,
          awayWinPct: p.awayWinPct,
          rationale: p.rationale,
          match: { homeTeam: detail.homeTeam, awayTeam: detail.awayTeam },
        });

        return (
          <div
            key={p.id}
            className="rounded-xl border border-surface-800/60 bg-surface-900/40 p-3 motion-safe:animate-rise"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">
                {insight.marketPlain}
              </span>
              <span className="flex items-center gap-2">
                {p.status !== "PENDING" ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
                      p.status === "WON" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
                    )}
                  >
                    {p.status}
                  </span>
                ) : null}
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", TIER_STYLES[insight.tier.tone])}>
                  {insight.tier.label}
                </span>
              </span>
            </div>

            <p className="mt-1 text-sm font-semibold text-surface-50">{p.selection}</p>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-brand-400 transition-all duration-700"
                  style={{ width: `${insight.belief}%` }}
                />
              </div>
              <span className="text-[11px] font-bold tabular-nums text-emerald-300">{insight.belief}%</span>
            </div>

            <PickReasons insight={insight} className="mt-2.5" />

            {detail.info.oddsSummary ? (
              <p className="mt-2 text-[10px] text-surface-500">{detail.info.oddsSummary}</p>
            ) : null}
          </div>
        );
      })}

      <p className="text-[10px] leading-relaxed text-surface-600">
        Every pick sits beside what we measured — timeline, shots, momentum and lineups — so the
        verdict can be checked against the evidence. Model output, not financial advice.
      </p>
    </div>
  );
}

function EmptyDetail({ note, predictions }: { note: string; predictions: ApiPrediction[] }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-surface-400">{note}</p>
      {predictions.length > 0 ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
            <Brain className="h-3.5 w-3.5" /> Our model&apos;s read still stands
          </p>
          <ul className="mt-2 space-y-1.5">
            {predictions.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className="text-surface-300">
                  <span className="text-surface-500">{p.marketLabel}:</span> {p.selection}
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-emerald-300">
                  {(p.confidence * 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
