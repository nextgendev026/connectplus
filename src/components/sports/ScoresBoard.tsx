"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Loader2,
  RefreshCw,
  Brain,
  AlertTriangle,
  Star,
  Bell,
  BellRing,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CircleDot,
  MapPin,
  Signal,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { liveEndpoint } from "@/lib/sports-endpoint";
import {
  playSportsAlert,
  setSportsAlertsMuted,
  sportsAlertsMuted,
  unlockSportsAudio,
} from "@/lib/sports-sounds";
import ReferralCards from "./ReferralCards";
import MatchDetail from "./MatchDetail";

interface Prediction {
  id: string;
  market: string;
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

interface LiveMatch {
  id: string | null;
  externalId: string;
  provider: string;
  sport: string;
  competition: string;
  country: string | null;
  homeTeam: string;
  awayTeam: string;
  /** Crest URLs from the provider. Null on the database-fallback path. */
  homeLogo?: string | null;
  awayLogo?: string | null;
  /** Provider team ids, used to resolve head-to-head and recent form. */
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  /** Most recent results as `"WDL"`, newest first, when the provider supplies it. */
  homeForm?: string | null;
  awayForm?: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  minute: number | null;
  kickoff: string | null;
  venue: string | null;
  oddsHome: number | null;
  oddsDraw: number | null;
  oddsAway: number | null;
  prediction: Prediction | null;
  predictions: Prediction[];
}

interface LiveResponse {
  generatedAt: string;
  provider: string;
  providerLabel: string;
  demo: boolean;
  date: string;
  sport: string;
  liveCount: number;
  sources?: string[];
  stale?: boolean;
  picksPending?: number;
  competitions: { name: string; country: string | null; live: number; total: number; relevance?: number }[];
  matches: LiveMatch[];
}

/** Stable identity for a fixture across snapshot refreshes. */
function matchKeyOf(match: LiveMatch): string {
  return `${match.provider}:${match.externalId}`;
}

const LIVE = new Set(["LIVE", "HT"]);
const SPORTS = ["football", "basketball"] as const;
const DAYS_BACK = 3;
/**
 * A whole month of fixtures ahead, not a long weekend.
 *
 * Three days forward ended the horizon on the coming Thursday, which is the one
 * thing a fixture board must not do: a reader planning a weekend, or looking for
 * a midweek round, hit the end of the strip on day four. The date list is only
 * buttons and each day is fetched on demand, so widening it costs one request
 * when someone actually taps that far out.
 */
const DAYS_FORWARD = 30;
/** Beyond this many days a weekday name repeats and stops identifying a date. */
const WEEKDAY_LABEL_DAYS = 6;

const FLAGS: Record<string, string> = {
  Kenya: "🇰🇪",
  Uganda: "🇺🇬",
  Tanzania: "🇹🇿",
  Rwanda: "🇷🇼",
  England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  Spain: "🇪🇸",
  Italy: "🇮🇹",
  Germany: "🇩🇪",
};

function statusLabel(m: LiveMatch): string {
  if (m.status === "LIVE") return m.minute ? `${m.minute}'` : "LIVE";
  if (m.status === "HT") return "HT";
  if (m.status === "FT") return "FT";
  if (m.status === "POSTPONED") return "PP";
  if (m.status === "CANCELLED") return "CANC";
  if (m.status === "SUSPENDED") return "SUSP";
  return m.kickoff ? new Date(m.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
}

function dayKey(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default function ScoresBoard({
  inlineAd,
  sidebarAd,
}: {
  inlineAd?: ReactNode;
  sidebarAd?: ReactNode;
}) {
  const { data: session } = useSession();
  const isAuthed = Boolean(session?.user);

  const [hub, setHub] = useState<LiveResponse | null>(null);
  const [followed, setFollowed] = useState<string[]>([]);
  const [reminders, setReminders] = useState<string[]>([]);
  const [onlyFollowed, setOnlyFollowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sport, setSport] = useState<string>("football");
  const [dayOffset, setDayOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [liveOnly, setLiveOnly] = useState(false);
  const [alertsOn, setAlertsOn] = useState(false);
  const inFlight = useRef(false);
  const dayStrip = useRef<HTMLDivElement | null>(null);
  /** Previous score and status per fixture, so a change can be told from a poll. */
  const previous = useRef(new Map<string, { score: string; status: string }>());
  const followedRef = useRef<string[]>([]);
  const remindersRef = useRef<string[]>([]);

  const date = dayKey(dayOffset);

  /**
   * Keep the selected day visible in the horizon strip.
   *
   * With a month on the strip, selecting a day from the arrows could leave the
   * highlighted chip scrolled off-screen — the reader taps "later", the board
   * loads a new day, and the strip still shows last week, so the control looks
   * broken. Scroll the strip itself (`scrollLeft`) rather than calling
   * `scrollIntoView`, which would also scroll the page behind the sticky bar.
   */
  useEffect(() => {
    const strip = dayStrip.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-offset="${dayOffset}"]`);
    if (!strip || !chip) return;
    const left = chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [dayOffset]);

  /**
   * Turn one poll into alerts.
   *
   * A poll returns a whole board, so the interesting events are DIFFS: a score
   * that moved is a goal, a status that went SCHEDULED→LIVE is a kick-off, and
   * LIVE→FT is a full-time whistle. Each alert is only played for a fixture the
   * reader actually asked about — a followed team or a starred match — because a
   * board that beeps for all eighteen fixtures is a board people silence.
   *
   * The diff is computed against the previous snapshot in a ref, so the first
   * load of a page never fires a burst of alerts for goals that happened before
   * the reader arrived.
   */
  const reactToSnapshot = useCallback((snapshot: LiveResponse) => {
    const next = new Map<string, { score: string; status: string }>();
    const watched = new Set(followedRef.current);
    const reminded = new Set(remindersRef.current);

    for (const match of snapshot.matches) {
      const key = `${match.provider}:${match.externalId}`;
      const score = `${match.homeScore ?? "-"}:${match.awayScore ?? "-"}`;
      next.set(key, { score, status: match.status });

      const before = previous.current.get(key);
      if (!before) continue;
      const mine = watched.has(match.homeTeam) || watched.has(match.awayTeam) || reminded.has(key);
      if (!mine) continue;
      if (before.score === score && before.status === match.status) continue;

      if (before.score !== score && match.status !== "SCHEDULED") playSportsAlert("goal");
      else if (before.status === "SCHEDULED" && (match.status === "LIVE" || match.status === "HT")) {
        playSportsAlert("kickoff");
      } else if (before.status !== "FT" && match.status === "FT") playSportsAlert("fulltime");
    }

    previous.current = next;
  }, []);

  const load = useCallback(
    async (opts: { fresh?: boolean; silent?: boolean } = {}) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (!opts.silent) setRefreshing(true);
      try {
        // Routed through the Cloudflare edge when NEXT_PUBLIC_EDGE_URL is set:
        // every viewer's poll collapses into one origin fetch per TTL window.
        const res = await fetch(liveEndpoint({ sport, date, fresh: opts.fresh }), {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Livescores are unavailable right now.");
        const snapshot = (await res.json()) as LiveResponse;
        // Diff before rendering: an alert that arrives after the score has
        // already changed on screen has nothing left to tell the reader.
        reactToSnapshot(snapshot);
        setHub(snapshot);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load livescores");
      } finally {
        inFlight.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [sport, date, reactToSnapshot]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-filter-change
    setLoading(true);
    void load({ fresh: dayOffset === 0 });
  }, [load, dayOffset]);

  const loadFollows = useCallback(async () => {
    try {
      const [followRes, reminderRes] = await Promise.all([
        fetch("/api/sports/follows", { cache: "no-store" }),
        fetch("/api/sports/reminders", { cache: "no-store" }),
      ]);
      if (followRes.ok) setFollowed(((await followRes.json()) as { following?: string[] }).following ?? []);
      if (reminderRes.ok) {
        const json = (await reminderRes.json()) as { reminders?: { matchKey: string }[] };
        setReminders((json.reminders ?? []).map((r) => r.matchKey));
      }
    } catch {
      /* anonymous */
    }
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch of follows and reminders
    void loadFollows();
  }, [isAuthed, loadFollows]);

  const toggleReminder = useCallback(
    async (match: LiveMatch) => {
      if (!isAuthed) return;
      const key = matchKeyOf(match);
      const active = reminders.includes(key);
      try {
        const res = await fetch(
          active ? `/api/sports/reminders?matchKey=${encodeURIComponent(key)}` : "/api/sports/reminders",
          {
            method: active ? "DELETE" : "POST",
            ...(active
              ? {}
              : {
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    matchKey: key,
                    provider: match.provider,
                    externalId: match.externalId,
                    homeTeam: match.homeTeam,
                    awayTeam: match.awayTeam,
                    competition: match.competition,
                    kickoff: match.kickoff,
                  }),
                }),
          }
        );
        if (res.ok) {
          const json = (await res.json()) as { reminders?: { matchKey: string }[] };
          setReminders((json.reminders ?? []).map((r) => r.matchKey));
        }
      } catch {
        /* the bell is a preference, not a transaction */
      }
    },
    [reminders, isAuthed]
  );

  // Real-time refresh: 15s while something is live, 60s otherwise, and never in
  // a background tab.
  useEffect(() => {
    const interval = (hub?.liveCount ?? 0) > 0 ? 15_000 : 60_000;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load({ silent: true });
    }, interval);
    return () => clearInterval(id);
  }, [load, hub?.liveCount]);

  const toggleFollow = useCallback(
    async (team: string, sportName: string, competitionName: string) => {
      if (!isAuthed) return;
      const isFollowing = followed.includes(team);
      try {
        const res = await fetch(
          isFollowing ? `/api/sports/follows?team=${encodeURIComponent(team)}` : "/api/sports/follows",
          {
            method: isFollowing ? "DELETE" : "POST",
            ...(isFollowing
              ? {}
              : {
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ team, sport: sportName, competition: competitionName }),
                }),
          }
        );
        if (res.ok) setFollowed(((await res.json()) as { following?: string[] }).following ?? []);
      } catch {
        /* ignore */
      }
    },
    [followed, isAuthed]
  );

  // Mirror the alert-relevant state into refs so the poll callback can read the
  // reader's choices without being rebuilt (and re-subscribed) on every toggle.
  useEffect(() => {
    followedRef.current = followed;
  }, [followed]);
  useEffect(() => {
    remindersRef.current = reminders;
  }, [reminders]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the saved mute preference
    setAlertsOn(!sportsAlertsMuted());
  }, []);

  const visible = useMemo(() => {
    let matches = hub?.matches ?? [];
    if (onlyFollowed) matches = matches.filter((m) => followed.includes(m.homeTeam) || followed.includes(m.awayTeam));
    // The live filter is the one a matchday actually wants: on a Saturday
    // afternoon the board is mostly finished and upcoming games, and the reader
    // who taps "Live" is asking for the four that are actually moving.
    if (liveOnly) matches = matches.filter((m) => LIVE.has(m.status));
    return matches;
  }, [hub, onlyFollowed, followed, liveOnly]);

  const groups = useMemo(() => {
    const map = new Map<string, LiveMatch[]>();
    for (const m of visible) {
      const list = map.get(m.competition) ?? [];
      list.push(m);
      map.set(m.competition, list);
    }
    // The server ranks competitions by how much this audience cares about them
    // (regional first, then the big leagues); a merged multi-source board would
    // otherwise open on Spanish Tercera Group 12.
    const relevance = new Map((hub?.competitions ?? []).map((c) => [c.name, c.relevance ?? 3]));
    const earliest = (list: LiveMatch[]) =>
      Math.min(...list.map((m) => (m.kickoff ? new Date(m.kickoff).getTime() : Number.MAX_SAFE_INTEGER)));
    return [...map.entries()]
      .map(([name, matches]) => ({
        name,
        country: matches[0]?.country ?? null,
        live: matches.filter((m) => LIVE.has(m.status)).length,
        relevance: relevance.get(name) ?? 3,
        matches: [...matches].sort((a, b) => {
          const rank = (m: LiveMatch) => (LIVE.has(m.status) ? 0 : m.status === "SCHEDULED" ? 1 : 2);
          return rank(a) - rank(b) || (a.kickoff ?? "").localeCompare(b.kickoff ?? "");
        }),
      }))
      .sort((a, b) => a.relevance - b.relevance || b.live - a.live || earliest(a.matches) - earliest(b.matches));
  }, [visible, hub]);

  const myMatchCount = (hub?.matches ?? []).filter(
    (m) => followed.includes(m.homeTeam) || followed.includes(m.awayTeam)
  ).length;

  function toggleMatch(match: LiveMatch) {
    const key = match.id ?? match.externalId;
    const opening = expanded !== key;
    setExpanded(opening ? key : null);
    if (opening) {
      void fetch("/api/sports/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          type: match.prediction ? "prediction_view" : "match_view",
          matchId: match.id,
          predictionId: match.prediction?.id ?? null,
        }),
      }).catch(() => {});
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-[1600px] gap-5 px-3 py-4 sm:gap-6 sm:px-6 sm:py-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] xl:px-8">
      <div className="min-w-0">
        {/* Day strip — sticky so switching days never means scrolling back up. */}
        <div className="sticky top-0 z-20 -mx-3 flex items-center gap-2 border-b border-surface-900/60 bg-surface-950/90 px-3 py-2 backdrop-blur sm:-mx-6 sm:px-6">
          <button
            onClick={() => setDayOffset((d) => Math.max(-DAYS_BACK, d - 1))}
            disabled={dayOffset <= -DAYS_BACK}
            className="rounded-lg border border-surface-800 p-1.5 text-surface-400 transition hover:text-surface-50 disabled:opacity-30"
            aria-label="Earlier day"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div ref={dayStrip} className="flex flex-1 gap-1.5 overflow-x-auto pb-0.5">
            {Array.from({ length: DAYS_BACK + DAYS_FORWARD + 1 }, (_, i) => i - DAYS_BACK).map((offset) => {
              const d = new Date();
              d.setDate(d.getDate() + offset);
              let label: string;
              if (offset === 0) label = "Today";
              else if (offset === -1) label = "Yest";
              else if (offset === 1) label = "Tmrw";
              else if (Math.abs(offset) <= WEEKDAY_LABEL_DAYS) label = d.toLocaleDateString([], { weekday: "short" });
              // Over a month "Sat" appears four times and identifies nothing;
              // the month is what disambiguates, and the date below is the day.
              else label = d.toLocaleDateString([], { month: "short" });
              return (
                <button
                  key={offset}
                  data-offset={offset}
                  onClick={() => setDayOffset(offset)}
                  aria-current={dayOffset === offset ? "date" : undefined}
                  aria-label={d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
                  className={cn(
                    "flex min-w-[62px] shrink-0 flex-col items-center rounded-xl border px-2.5 py-1.5 transition",
                    dayOffset === offset
                      ? "border-brand-500 bg-brand-500/15 text-brand-200"
                      : "border-surface-800 text-surface-400 hover:border-surface-700 hover:text-surface-50"
                  )}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide">{label}</span>
                  <span className="text-sm font-bold tabular-nums">{d.getDate()}</span>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setDayOffset((d) => Math.min(DAYS_FORWARD, d + 1))}
            disabled={dayOffset >= DAYS_FORWARD}
            className="rounded-lg border border-surface-800 p-1.5 text-surface-400 transition hover:text-surface-50 disabled:opacity-30"
            aria-label="Later day"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/*
          One line, swiped sideways, not four wrapped rows of chips.
          On a phone this used to stack into three or four rows above the first
          fixture — controls the reader sees before they see a single score.
        */}
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold",
              (hub?.liveCount ?? 0) > 0 ? "bg-red-500/15 text-red-400" : "bg-surface-800 text-surface-400"
            )}
          >
            <CircleDot className={cn("h-3.5 w-3.5", (hub?.liveCount ?? 0) > 0 && "animate-pulse")} />
            {hub?.liveCount ?? 0} live
          </span>

          {(hub?.sources?.length ?? 0) > 0 ? (
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-surface-800 px-2.5 py-1 text-[11px] font-medium text-surface-400"
              title={`Live data merged from ${hub?.sources?.join(", ")}`}
            >
              <Signal className="h-3 w-3 text-emerald-400" />
              {hub?.sources?.length} source{(hub?.sources?.length ?? 0) === 1 ? "" : "s"}
            </span>
          ) : null}

          {hub?.stale ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              Showing the last saved scores
            </span>
          ) : null}

          <div className="flex shrink-0 items-center rounded-xl border border-surface-800 bg-surface-900/70 p-1">
            {SPORTS.map((s) => (
              <button
                key={s}
                onClick={() => setSport(s)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition",
                  sport === s ? "bg-brand-500 text-white" : "text-surface-400 hover:text-surface-50"
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <button
            onClick={() => setLiveOnly((v) => !v)}
            aria-pressed={liveOnly}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
              liveOnly
                ? "border-red-500 bg-red-500/15 text-red-300"
                : "border-surface-800 text-surface-400 hover:text-surface-50"
            )}
          >
            <CircleDot className={cn("h-3.5 w-3.5", liveOnly && "animate-pulse")} />
            Live now{(hub?.liveCount ?? 0) > 0 ? ` (${hub?.liveCount})` : ""}
          </button>

          {isAuthed && followed.length > 0 ? (
            <button
              onClick={() => setOnlyFollowed((v) => !v)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                onlyFollowed
                  ? "border-amber-500 bg-amber-500/15 text-amber-300"
                  : "border-surface-800 text-surface-400 hover:text-surface-50"
              )}
            >
              <Star className={cn("h-3.5 w-3.5", onlyFollowed && "fill-amber-400 text-amber-400")} />
              My teams ({myMatchCount})
            </button>
          ) : null}

          {/*
            Goal alerts, SofaScore-style: distinct tones per event, off by
            default, and enabled here because the browser will not start audio
            without a gesture — this button IS that gesture.
          */}
          <button
            onClick={() => {
              const next = !alertsOn;
              setAlertsOn(next);
              setSportsAlertsMuted(!next);
              if (next) unlockSportsAudio();
            }}
            aria-pressed={alertsOn}
            title={
              alertsOn
                ? "Goal and kick-off sounds are on for your teams"
                : "Play a sound when your teams score or kick off"
            }
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
              alertsOn
                ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                : "border-surface-800 text-surface-400 hover:text-surface-50"
            )}
          >
            {alertsOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            {alertsOn ? "Alerts on" : "Alerts off"}
          </button>

          <button
            onClick={() => void load({ fresh: true })}
            disabled={refreshing}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-surface-800 bg-surface-900/70 px-3 py-2 text-xs font-medium text-surface-300 transition hover:text-surface-50 disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </button>
        </div>

        {hub?.demo ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              These are sample fixtures. Real scores appear here once the live feed is switched on.
            </span>
          </div>
        ) : null}

        {error ? (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
        ) : null}

        {loading ? (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-surface-800/60 py-16 text-sm text-surface-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading fixtures…
          </div>
        ) : groups.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-surface-800 px-4 py-16 text-center">
            <CalendarDays className="mx-auto h-8 w-8 text-surface-600" />
            <p className="mt-2 text-sm font-medium text-surface-400">
              {liveOnly
                ? "Nothing is live right now"
                : onlyFollowed
                  ? "None of your teams play in this window"
                  : "No fixtures for this day"}
            </p>
            <p className="text-xs text-surface-500">
              {liveOnly
                ? "Turn off the Live filter to see the day's full schedule."
                : onlyFollowed
                  ? "Turn off the My teams filter to see every fixture."
                  : "Try another day or sport."}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {groups.map((group, index) => (
              <section key={group.name}>
                <div className="mb-1.5 flex items-center gap-2 px-1">
                  <span className="text-sm">{FLAGS[group.country ?? ""] ?? "🏆"}</span>
                  <h2 className="truncate text-xs font-bold uppercase tracking-wider text-surface-300">
                    {group.name}
                  </h2>
                  {group.country ? (
                    <span className="truncate text-[10px] uppercase tracking-wide text-surface-600">{group.country}</span>
                  ) : null}
                  {group.live > 0 ? (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                      {group.live} live
                    </span>
                  ) : null}
                </div>
                <div className="overflow-hidden rounded-2xl border border-surface-800/70 bg-surface-900/40">
                  {group.matches.map((match, rowIndex) => (
                    <MatchRow
                      key={match.id ?? match.externalId}
                      match={match}
                      rowIndex={rowIndex}
                      expanded={expanded === (match.id ?? match.externalId)}
                      onToggle={toggleMatch}
                      followed={followed}
                      isAuthed={isAuthed}
                      onFollow={toggleFollow}
                      reminders={reminders}
                      onRemind={toggleReminder}
                    />
                  ))}
                </div>
                {index === 1 && inlineAd ? <div className="mt-4">{inlineAd}</div> : null}
              </section>
            ))}
          </div>
        )}

        <div className="mt-6">
          <ReferralCards placement="sports-footer" layout="row" compact />
        </div>
      </div>

      {/*
        Sticky on desktop so the rail and its ads stay beside the list instead of
        scrolling away from it — the single biggest difference between how the
        wide view and the phone view feel. Capped to the viewport so a tall rail
        can never leave content stranded below the fold, and released below `lg`
        where it stacks under the list anyway.
      */}
      <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        {sidebarAd ? <div>{sidebarAd}</div> : null}
        <ReferralCards placement="sports-sidebar" />
      </aside>
    </div>
  );
}

function FollowButton({
  team,
  sport,
  competition,
  followed,
  isAuthed,
  onFollow,
}: {
  team: string;
  sport: string;
  competition: string;
  followed: string[];
  isAuthed: boolean;
  onFollow: (team: string, sport: string, competition: string) => void;
}) {
  const active = followed.includes(team);
  if (!isAuthed) {
    return (
      <Link
        href={`/auth/signin?callbackUrl=${encodeURIComponent("/sports")}`}
        title={`Sign in to follow ${team}`}
        className="rounded-lg p-1.5 text-surface-600 transition hover:text-surface-300"
      >
        <Star className="h-4 w-4" />
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onFollow(team, sport, competition)}
      title={active ? `Unfollow ${team}` : `Follow ${team}`}
      aria-pressed={active}
      className={cn("rounded-lg p-1.5 transition", active ? "text-amber-400 hover:text-amber-300" : "text-surface-600 hover:text-surface-300")}
    >
      <Star className={cn("h-4 w-4", active && "fill-amber-400")} />
    </button>
  );
}

function MatchRow({
  match,
  rowIndex = 0,
  expanded,
  onToggle,
  followed,
  isAuthed,
  onFollow,
  reminders,
  onRemind,
}: {
  match: LiveMatch;
  /** Position in its competition, used to stagger the entrance. */
  rowIndex?: number;
  expanded: boolean;
  onToggle: (m: LiveMatch) => void;
  followed: string[];
  isAuthed: boolean;
  onFollow: (team: string, sport: string, competition: string) => void;
  reminders: string[];
  onRemind: (m: LiveMatch) => void;
}) {
  const isLive = LIVE.has(match.status);
  const reminded = reminders.includes(matchKeyOf(match));
  const hasOdds = match.oddsHome != null || match.oddsDraw != null || match.oddsAway != null;
  return (
    // Rows tick in one after another rather than appearing all at once; capped
    // so a twenty-fixture competition never takes a second to fill in.
    <div
      className="border-b border-surface-800/50 last:border-b-0 motion-safe:animate-rise"
      style={{ animationDelay: `${Math.min(rowIndex, 8) * 35}ms` }}
    >
      <div className="flex items-center gap-0.5 px-2 py-2.5 transition hover:bg-surface-800/40 sm:gap-1 sm:px-4">
        <button
          onClick={() => onToggle(match)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left sm:gap-3"
          aria-expanded={expanded}
        >
          <div className="w-10 shrink-0 text-center sm:w-11">
            <span
              className={cn(
                "inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                isLive ? "bg-red-500/15 text-red-400" : match.status === "FT" ? "text-surface-500" : "text-surface-400"
              )}
            >
              {statusLabel(match)}
            </span>
          </div>

          <div className="min-w-0 flex-1 lg:max-w-[440px]">
            <TeamLine
              name={match.homeTeam}
              logo={match.homeLogo}
              form={match.homeForm}
              score={match.homeScore}
              leading={(match.homeScore ?? 0) > (match.awayScore ?? 0)}
            />
            <TeamLine
              name={match.awayTeam}
              logo={match.awayLogo}
              form={match.awayForm}
              score={match.awayScore}
              leading={(match.awayScore ?? 0) > (match.homeScore ?? 0)}
            />
          </div>

          {/*
            Desktop-only context. A phone row has no room for this, but a row a
            thousand pixels wide holding nothing but two team names throws away
            what the pipeline already paid for: the venue and the market's 1X2
            line are both fetched on every fixture and were rendered nowhere.
          */}
          <div className="hidden min-w-0 flex-1 items-center gap-2.5 lg:flex">
            {match.venue ? (
              <span className="min-w-0 truncate text-[11px] text-surface-500" title={match.venue}>
                <MapPin className="mr-1 inline h-3 w-3 align-[-2px] text-surface-600" />
                {match.venue}
              </span>
            ) : null}
            {match.country ? (
              <span className="hidden shrink-0 text-[10px] uppercase tracking-wider text-surface-600 xl:inline">
                {match.country}
              </span>
            ) : null}
          </div>

          {hasOdds ? (
            <div
              className="hidden shrink-0 items-center gap-1 lg:flex"
              title="Market prices from the provider (decimal odds, 1X2)"
            >
              {(
                [
                  ["1", match.oddsHome],
                  ["X", match.oddsDraw],
                  ["2", match.oddsAway],
                ] as const
              ).map(([label, value]) =>
                value == null ? null : (
                  <span
                    key={label}
                    className="rounded-md border border-surface-800 bg-surface-950/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-surface-400"
                  >
                    <span className="mr-1 text-surface-600">{label}</span>
                    {value.toFixed(2)}
                  </span>
                )
              )}
            </div>
          ) : null}

          <div className="flex shrink-0 items-center gap-2">
            {match.predictions.length > 0 ? (
              <span className="hidden items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 sm:inline-flex">
                <Brain className="h-3 w-3" />
                {match.predictions.length}
              </span>
            ) : null}
            <ChevronDown className={cn("h-4 w-4 text-surface-500 transition", expanded && "rotate-180")} />
          </div>
        </button>

        {isAuthed ? (
          <button
            type="button"
            onClick={() => onRemind(match)}
            title={reminded ? "Alerts on for this match" : "Notify me about this match"}
            aria-pressed={reminded}
            className={cn("rounded-lg p-1.5 transition", reminded ? "text-brand-300 hover:text-brand-200" : "text-surface-600 hover:text-surface-300")}
          >
            {reminded ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          </button>
        ) : null}

        <FollowButton
          team={match.homeTeam}
          sport={match.sport}
          competition={match.competition}
          followed={followed}
          isAuthed={isAuthed}
          onFollow={onFollow}
        />
      </div>

      {expanded ? <AnalysisPanel match={match} /> : null}
    </div>
  );
}

/**
 * A team crest that never leaves a hole in the layout.
 *
 * Crests come from whichever provider won the merge, and those URLs 404 or
 * hotlink-block often enough that a bare `<img>` would flash a broken icon.
 * The initials monogram is the fallback, and `referrerPolicy` keeps the
 * provider from rejecting the request when it checks where it came from.
 */
function TeamCrest({ name, logo }: { name: string; logo?: string | null }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  if (!logo || failed) {
    return (
      <span
        aria-hidden
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-800 text-[9px] font-bold text-surface-400 sm:h-6 sm:w-6 sm:text-[10px]"
      >
        {initials || "?"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- crests are third-party CDN assets; the optimizer would add a hop and fail on hotlink-protected hosts
    <img
      src={logo}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-5 w-5 shrink-0 object-contain sm:h-6 sm:w-6"
    />
  );
}

function TeamLine({
  name,
  logo,
  score,
  leading,
  form,
}: {
  name: string;
  logo?: string | null;
  score: number | null;
  leading: boolean;
  form?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-[1px] sm:gap-3">
      <span className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <TeamCrest name={name} logo={logo} />
        <span className={cn("truncate text-sm", leading ? "font-semibold text-surface-50" : "text-surface-300")}>{name}</span>
        {form ? <FormPills form={form} /> : null}
      </span>
      <span className={cn("w-6 text-right text-sm font-bold tabular-nums", leading ? "text-surface-50" : "text-surface-400")}>
        {score ?? "–"}
      </span>
    </div>
  );
}

/** The last five results as compact W/D/L dots — green, grey, red. */
function FormPills({ form, className }: { form: string; className?: string }) {
  const results = form.replace(/[^WDL]/gi, "").toUpperCase().slice(0, 5).split("");
  if (results.length === 0) return null;
  return (
    <span className={cn("hidden shrink-0 items-center gap-0.5 sm:inline-flex", className)} aria-label={`Recent form: ${results.join(", ")}`}>
      {results.map((r, i) => (
        <span
          key={`${r}-${i}`}
          className={cn(
            "grid h-3.5 w-3.5 place-items-center rounded-[4px] text-[8px] font-bold",
            r === "W" ? "bg-emerald-500/20 text-emerald-300" : r === "L" ? "bg-red-500/20 text-red-300" : "bg-surface-700/60 text-surface-400"
          )}
        >
          {r}
        </span>
      ))}
    </span>
  );
}

interface TeamFormSummary {
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  form: string;
  avgGoalsFor: number | null;
  avgGoalsAgainst: number | null;
}

interface H2HMeeting {
  date: string | null;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
}

interface FixtureContext {
  home: TeamFormSummary | null;
  away: TeamFormSummary | null;
  h2h: H2HMeeting[];
  source: string;
  degraded: boolean;
}

/**
 * Real form and head-to-head for one fixture, loaded only when the reader opens
 * the analysis panel.
 *
 * Deliberately lazy: the scoreboard refreshes every 15 seconds across many
 * fixtures, and fetching history for all of them would triple the request
 * volume for information most readers never look at. The server caches the
 * lookup on the team pair, so opening several fixtures costs one round trip.
 */
function useFixtureContext(match: LiveMatch) {
  // The loaded value carries the fixture it belongs to, so "still loading" is
  // derived during render rather than set from inside the effect.
  const [state, setState] = useState<{ key: string; context: FixtureContext | null } | null>(null);
  const homeTeam = match.homeTeam;
  const awayTeam = match.awayTeam;
  const homeTeamId = match.homeTeamId;
  const awayTeamId = match.awayTeamId;
  const key = `${homeTeam}::${awayTeam}`;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const params = new URLSearchParams({ home: homeTeam, away: awayTeam });
    if (homeTeamId) params.set("homeId", homeTeamId);
    if (awayTeamId) params.set("awayId", awayTeamId);

    fetch(`/api/sports/h2h?${params.toString()}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: FixtureContext | null) => {
        if (active) setState({ key: `${homeTeam}::${awayTeam}`, context: data });
      })
      .catch(() => {
        /* History is optional context — never surface it as an error. */
        if (active) setState({ key: `${homeTeam}::${awayTeam}`, context: null });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [homeTeam, awayTeam, homeTeamId, awayTeamId]);

  return { context: state?.key === key ? state.context : null, loading: state?.key !== key };
}

function FormColumn({ form, accent }: { form: TeamFormSummary | null; accent: string }) {
  if (!form) {
    return (
      <div className="rounded-lg border border-surface-800/60 bg-surface-900/30 p-2.5">
        <p className="text-[11px] text-surface-500">No recent results available.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-surface-800/60 bg-surface-900/30 p-2.5">
      <p className="truncate text-xs font-semibold text-surface-100">{form.team}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <FormPills form={form.form} className="!inline-flex" />
        <span className="text-[10px] text-surface-500">{form.played} played</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-surface-400">
        <span>
          <span className="font-semibold text-surface-200">{form.wins}</span>W ·
          <span className="ml-1 font-semibold text-surface-200">{form.draws}</span>D ·
          <span className="ml-1 font-semibold text-surface-200">{form.losses}</span>L
        </span>
        {form.avgGoalsFor != null ? (
          <span>
            {form.avgGoalsFor.toFixed(2)} scored / {form.avgGoalsAgainst?.toFixed(2) ?? "—"} conceded per game
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-800">
        <div className={cn("h-full rounded-full", accent)} style={{ width: `${form.played > 0 ? (form.wins / form.played) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

function FixtureContextPanel({ match }: { match: LiveMatch }) {
  const { context, loading } = useFixtureContext(match);

  return (
    <div className="mt-4 rounded-xl border border-surface-800/60 bg-surface-900/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Recent form</span>
        {context?.h2h && context.h2h.length > 0 ? (
          <span className="text-[10px] text-surface-500">{context.h2h.length} head-to-head found</span>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-surface-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading form and head-to-head…
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <FormColumn form={context?.home ?? null} accent="bg-brand-500" />
            <FormColumn form={context?.away ?? null} accent="bg-accent-coral" />
          </div>

          {context?.h2h && context.h2h.length > 0 ? (
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">Head to head</p>
              <ul className="mt-1.5 space-y-1">
                {context.h2h.slice(0, 5).map((meeting, i) => (
                  <li
                    key={`${meeting.date ?? "meeting"}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-lg bg-surface-900/40 px-2.5 py-1.5 text-[11px]"
                  >
                    <span className="truncate text-surface-400">
                      {meeting.date ? new Date(meeting.date).toLocaleDateString([], { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                      <span className="ml-2 text-surface-600">{meeting.competition}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-surface-200">
                      {meeting.homeTeam} <span className="font-bold text-surface-50">{meeting.homeScore ?? "–"}–{meeting.awayScore ?? "–"}</span> {meeting.awayTeam}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {context?.degraded ? (
            <p className="mt-2 text-[10px] text-amber-400/80">
              We couldn&apos;t find enough recent matches for one of these teams, so the numbers above lean
              on how other games in this competition usually go.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function AnalysisPanel({ match }: { match: LiveMatch }) {
  const hasPicks = match.predictions.length > 0;

  return (
    <div className="border-t border-surface-800/60 bg-surface-950/60 px-3 py-4 sm:px-4">
      {/**
       * The match centre replaces the old picks-only panel. It carries the model's
       * read AND the measured evidence behind it — timeline, team stats, lineups,
       * attack momentum, the shot map — so a reader can check the reasoning rather
       * than trust a percentage. Anything the fixture's feed cannot support is
       * simply a tab that is not offered.
       */}
      <MatchDetail
        match={{
          provider: match.provider,
          externalId: match.externalId,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          competition: match.competition,
          status: match.status,
          minute: match.minute,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          kickoff: match.kickoff,
        }}
      />

      {/*
        Form and head-to-head sit OUTSIDE the picks branch on purpose: they are
        real evidence about the fixture, independent of whether the analyser has
        published a call yet — and they are most useful on exactly the fixtures
        where no pick exists.
      */}
      <FixtureContextPanel match={match} />

      {hasPicks ? (
        <div className="mt-4">
          <ReferralCards placement="sports-inline" matchId={match.id} compact />
        </div>
      ) : null}

      <p className="mt-3 text-[10px] leading-relaxed text-surface-600">
        Model output, not financial advice. Predictions are probabilistic — never stake more than you can afford to lose.
      </p>
    </div>
  );
}

