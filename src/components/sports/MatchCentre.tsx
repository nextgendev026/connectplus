"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, Loader2, RefreshCw, Search, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { liveEndpoint } from "@/lib/sports-endpoint";
import MatchDetail from "./MatchDetail";

interface Prediction {
  id: string;
  market: string;
  selection: string;
  confidence: number;
}

interface Fixture {
  id: string | null;
  externalId: string;
  provider: string;
  sport: string;
  competition: string;
  country: string | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  minute: number | null;
  kickoff: string | null;
  predictions: Prediction[];
}

interface LiveResponse {
  liveCount: number;
  matches: Fixture[];
}

const LIVE = new Set(["LIVE", "HT"]);
/** How many fixtures a reader may pin to one screen. */
const MAX_PINNED = 3;

/**
 * Does this fixture have a provider that publishes a full match summary?
 *
 * The rail says so out loud: a reader choosing what to open should not have to
 * click three matches to discover which one has a timeline. Fixtures without it
 * still open — they show the model's picks — they are just not marked as full.
 */
function hasDeepRead(fixture: Fixture): boolean {
  return fixture.externalId.startsWith("espn:");
}

type Filter = "live" | "upcoming" | "mine" | "all";

/**
 * The match centre.
 *
 * A reader who follows two clubs on a Saturday afternoon does not want to
 * scroll a single-fixture accordion: they want both games, live, side by side,
 * each with its own timeline and momentum. That is what this surface is — a rail
 * of the day's fixtures, up to three pinned into a board, each panel self-
 * contained and polling on its own cadence.
 *
 * The rail is deliberately cheap (one shared feed poll) and the panels are
 * deliberately expensive (each fetches its own deep read). Only the fixtures a
 * reader actually pins pay for the second request.
 */
export default function MatchCentre() {
  const [feed, setFeed] = useState<LiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("live");
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<Fixture[]>([]);
  const [favourites, setFavourites] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(liveEndpoint({ sport: "football" }), { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as LiveResponse;
      setFeed(data);
      // A pinned fixture is re-read from the new snapshot so its score and clock
      // advance with the rest of the board instead of freezing when it was pinned.
      setPinned((current) =>
        current
          .map((pin) => data.matches.find((m) => m.provider === pin.provider && m.externalId === pin.externalId) ?? pin)
          .slice(0, MAX_PINNED)
      );
    } catch {
      /* the rail is context, not a transaction */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch of the shared fixture rail
    void load();
  }, [load]);

  useEffect(() => {
    const interval = (feed?.liveCount ?? 0) > 0 ? 15_000 : 60_000;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, interval);
    return () => clearInterval(id);
  }, [load, feed?.liveCount]);

  // Favourites come from the signed-in reader's follows; anonymous readers get
  // an empty list and the "My teams" filter simply is not offered.
  useEffect(() => {
    let active = true;
    fetch("/api/sports/follows", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { following?: string[] } | null) => {
        if (active && data?.following) setFavourites(data.following);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const fixtures = useMemo(() => {
    const list = feed?.matches ?? [];
    const q = query.trim().toLowerCase();
    return list
      .filter((m) => {
        if (filter === "live" && !LIVE.has(m.status)) return false;
        if (filter === "upcoming" && m.status !== "SCHEDULED") return false;
        if (filter === "mine" && !(favourites.includes(m.homeTeam) || favourites.includes(m.awayTeam))) return false;
        if (q && !`${m.homeTeam} ${m.awayTeam} ${m.competition}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const rank = (m: Fixture) => (LIVE.has(m.status) ? 0 : m.status === "SCHEDULED" ? 1 : 2);
        return rank(a) - rank(b) || (a.kickoff ?? "").localeCompare(b.kickoff ?? "");
      });
  }, [feed, filter, query, favourites]);

  // Default the board to whatever is on, so opening the tab is never an empty
  // panel — and prefer the fixtures that can actually fill one. Only some
  // providers publish the play-by-play this panel is built from, and landing on a
  // panel with no timeline when a full one was one row away is a bad first
  // impression. Done in an effect (not during render) so the reader's own pins are
  // never overwritten by a poll.
  useEffect(() => {
    if (pinned.length > 0) return;
    // The pool is the WHOLE feed, not the rail's filtered view: opening the
    // Analysis tab while the rail happens to be filtered to "Live" should not
    // decide which matches are worth analysing.
    const pool = feed?.matches ?? [];
    if (pool.length === 0) return;
    const livePool = pool.filter((m) => LIVE.has(m.status));
    const seed = [
      ...livePool.filter(hasDeepRead),
      ...pool.filter(hasDeepRead),
      ...livePool,
      ...pool,
    ].slice(0, 2);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed of the board from the first fixtures worth analysing
    if (seed.length > 0) setPinned(seed);
  }, [feed, pinned.length]);

  function togglePin(fixture: Fixture) {
    setPinned((current) => {
      const exists = current.find((p) => p.provider === fixture.provider && p.externalId === fixture.externalId);
      if (exists) return current.filter((p) => !(p.provider === fixture.provider && p.externalId === fixture.externalId));
      if (current.length >= MAX_PINNED) return [...current.slice(1), fixture];
      return [...current, fixture];
    });
  }

  const liveCount = fixtures.filter((m) => LIVE.has(m.status)).length;

  return (
    <div className="mx-auto grid w-full max-w-[1600px] gap-4 px-3 py-4 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)] xl:px-8">
      {/* Fixture rail */}
      {/* Rail sticks beside the analysis on desktop so the fixture you are
          studying never scrolls out of reach. */}
      <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-2xl border border-surface-800/70 bg-surface-900/40">
          <div className="border-b border-surface-800/70 p-2.5">
            <div className="flex items-center gap-1">
              {(
                [
                  ["live", `Live${liveCount > 0 ? ` ${liveCount}` : ""}`],
                  ["upcoming", "Upcoming"],
                  ...(favourites.length > 0 ? ([["mine", "My teams"]] as [Filter, string][]) : []),
                  ["all", "All"],
                ] as [Filter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition",
                    filter === key ? "bg-brand-500/15 text-brand-200" : "text-surface-400 hover:text-surface-100"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-1.5 rounded-lg border border-surface-800 bg-surface-950/60 px-2 py-1.5">
              <Search className="h-3 w-3 text-surface-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Team or league"
                className="min-w-0 flex-1 bg-transparent text-[11px] text-surface-200 placeholder:text-surface-600 focus:outline-none"
              />
            </label>
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-1.5">
            {loading ? (
              <p className="flex items-center gap-2 px-2 py-6 text-[11px] text-surface-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading fixtures…
              </p>
            ) : fixtures.length === 0 ? (
              <div className="px-2 py-8 text-center">
                <CalendarDays className="mx-auto h-6 w-6 text-surface-600" />
                <p className="mt-2 text-[11px] text-surface-500">
                  {filter === "live" ? "Nothing is in play right now." : "No fixtures match that."}
                </p>
              </div>
            ) : (
              <ul className="space-y-1">
                {fixtures.slice(0, 80).map((fixture) => {
                  const isPinned = pinned.some(
                    (p) => p.provider === fixture.provider && p.externalId === fixture.externalId
                  );
                  const isLive = LIVE.has(fixture.status);
                  const mine =
                    favourites.includes(fixture.homeTeam) || favourites.includes(fixture.awayTeam);
                  return (
                    <li key={`${fixture.provider}:${fixture.externalId}`}>
                      <button
                        onClick={() => togglePin(fixture)}
                        className={cn(
                          "w-full rounded-lg px-2 py-1.5 text-left transition",
                          isPinned ? "bg-brand-500/10 ring-1 ring-brand-500/40" : "hover:bg-surface-800/50"
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {isLive ? (
                            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500" />
                          ) : null}
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-surface-200">
                            {fixture.homeTeam} <span className="text-surface-600">v</span> {fixture.awayTeam}
                          </span>
                          {hasDeepRead(fixture) ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/80" title="Full analysis available" />
                          ) : null}
                          {mine ? <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" /> : null}
                          <span className="shrink-0 text-[10px] font-bold tabular-nums text-surface-500">
                            {isLive || fixture.status === "FT"
                              ? `${fixture.homeScore ?? 0}-${fixture.awayScore ?? 0}`
                              : fixture.kickoff
                                ? new Date(fixture.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                : "—"}
                          </span>
                        </div>
                        <p className="truncate text-[10px] text-surface-600">
                          {fixture.competition}
                          {isLive ? ` · ${fixture.status === "HT" ? "HT" : fixture.minute ? `${fixture.minute}'` : "live"}` : ""}
                          {fixture.predictions.length > 0 ? ` · ${fixture.predictions.length} picks` : ""}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="border-t border-surface-800/70 px-2.5 py-2 text-[10px] leading-relaxed text-surface-600">
            Pin up to {MAX_PINNED} matches to watch them together. A green dot marks a fixture whose provider
            publishes a full match summary — timeline, stats, lineups, momentum and the shot map. Every
            fixture still opens, with our model&apos;s picks on it.
          </p>
        </div>
      </aside>

      {/* The board */}
      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-800/70 px-2.5 py-1 text-[11px] font-semibold text-surface-300">
            <Activity className="h-3 w-3 text-brand-400" />
            Match centre
          </span>
          <span className="text-[11px] text-surface-500">
            {pinned.length === 0
              ? "Nothing pinned yet — pick a fixture on the left."
              : `${pinned.length} of ${MAX_PINNED} pinned`}
          </span>
          <button
            onClick={() => void load()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-surface-800 px-2.5 py-1.5 text-[11px] font-medium text-surface-400 transition hover:text-surface-100"
          >
            <RefreshCw className="h-3 w-3" /> Refresh rail
          </button>
        </div>

        {pinned.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-surface-800 px-4 py-16 text-center">
            <Activity className="mx-auto h-8 w-8 text-surface-600" />
            <p className="mt-2 text-sm font-medium text-surface-400">Pick a match to analyse</p>
            <p className="text-xs text-surface-500">
              Every panel carries the timeline, team stats, lineups with connectPlus Ratings, attack momentum,
              the shot map and our model&apos;s picks — measured and derived, labelled as such.
            </p>
          </div>
        ) : (
          <div className={cn("grid gap-4", pinned.length > 1 ? "xl:grid-cols-2" : "")}>
            {pinned.map((fixture) => (
              <div key={`${fixture.provider}:${fixture.externalId}`} className="min-w-0">
                <div className="mb-1.5 flex items-center gap-2 px-1">
                  <span className="truncate text-[11px] font-semibold text-surface-300">
                    {fixture.homeTeam} v {fixture.awayTeam}
                  </span>
                  <span className="truncate text-[10px] text-surface-600">{fixture.competition}</span>
                  <button
                    onClick={() => togglePin(fixture)}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] text-surface-500 transition hover:text-surface-200"
                    aria-label="Unpin this match"
                  >
                    <X className="h-3 w-3" /> Unpin
                  </button>
                </div>
                <MatchDetail
                  match={{
                    provider: fixture.provider,
                    externalId: fixture.externalId,
                    homeTeam: fixture.homeTeam,
                    awayTeam: fixture.awayTeam,
                    competition: fixture.competition,
                    status: fixture.status,
                    minute: fixture.minute,
                    homeScore: fixture.homeScore,
                    awayScore: fixture.awayScore,
                    kickoff: fixture.kickoff,
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
