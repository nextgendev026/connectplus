"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { liveEndpoint } from "@/lib/sports-endpoint";
import { SPORTS_SCOPE } from "@/lib/sports-scope";

/**
 * The live ticker under the sports hero.
 *
 * A scoreboard is the one surface where a reader wants the *whole* picture at
 * once: which matches are on, who is winning, how far along they are. The board
 * below answers that properly, but it is a tab away and it is a list you scroll —
 * so the hero carries the same information in the form everyone already knows
 * from television: a strip of scores running past the bottom of the shot.
 *
 * Three rules keep it from being decorative noise:
 *
 *  1. **Nothing is live, nothing is shown.** An empty ticker with a "LIVE" badge
 *     over it is worse than no ticker, so the component renders `null` — the
 *     server sends no markup, the hero simply has no strip.
 *  2. **It is the board's own data, not a second feed.** The URL is the same
 *     canonical one the board polls (through the edge worker when configured),
 *     so the ticker's request is a cache hit rather than another upstream call —
 *     and the numbers can never disagree with the board behind it.
 *  3. **It pauses when you look at it.** Hovering, focusing, or touching the
 *     strip stops the scroll, because a fixture you cannot read is a fixture you
 *     cannot tap.
 *
 * The marquee technique is in globals.css (`ticker-scroll`): the track holds the
 * list twice and slides exactly half its width, which is what makes the loop
 * seamless rather than a jump back to the first fixture.
 */

interface TickerMatch {
  externalId: string;
  provider: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  minute: number | null;
}

const LIVE_STATUSES = new Set(["LIVE", "HT"]);

/**
 * Competitions a reader is most likely to be scanning for, so the strip leads
 * with them. A mirror of the board's own ranking, kept local for the same reason
 * `LiveScoresStrip` keeps one: importing the sports module here would pull Prisma
 * and every provider adapter into a client bundle for one ordering heuristic.
 */
const TOP_COMPETITIONS = [
  "premier league",
  "la liga",
  "laliga",
  "champions league",
  "serie a",
  "bundesliga",
  "ligue 1",
  "afcon",
  "caf champions",
  "fkf",
  "kenyan premier",
  "europa league",
];

function competitionRank(competition: string): number {
  const name = (competition ?? "").toLowerCase();
  const index = TOP_COMPETITIONS.findIndex((c) => name.includes(c));
  return index === -1 ? TOP_COMPETITIONS.length : index;
}

/** How many fixtures the strip holds. More than this and the loop is too long. */
const MAX_ITEMS = 12;
/** Peripheral to the page, so it polls slower than the board it mirrors. */
const POLL_MS = 45_000;

function statusText(match: TickerMatch): string {
  if (match.status === "LIVE") return match.minute ? `${match.minute}'` : "LIVE";
  if (match.status === "HT") return "HT";
  return "";
}

export default function LiveTicker({ onOpen }: { onOpen?: () => void }) {
  const [matches, setMatches] = useState<TickerMatch[]>([]);
  const [paused, setPaused] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    const load = async () => {
      try {
        const res = await fetch(liveEndpoint({ sport: SPORTS_SCOPE }), { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { matches?: TickerMatch[] };
        if (mounted.current) setMatches(Array.isArray(data.matches) ? data.matches : []);
      } catch {
        /* A ticker is the most peripheral thing on the page: it fails silently
           rather than shouting about a feed the board below will report on. */
      }
    };

    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);

  const live = useMemo(
    () =>
      [...matches]
        .filter((m) => LIVE_STATUSES.has(m.status))
        // The best competition first, then the match furthest along — the two
        // things a reader scans a ticker for.
        .sort(
          (a, b) =>
            competitionRank(a.competition) - competitionRank(b.competition) ||
            (b.minute ?? 0) - (a.minute ?? 0)
        )
        .slice(0, MAX_ITEMS),
    [matches]
  );

  if (live.length === 0) return null;

  // Seconds per fixture, floored so a short strip still moves at a readable
  // pace instead of sprinting through six matches.
  const durationSeconds = Math.max(28, live.length * 6);
  // Below this many fixtures a duplicated track fits on one screen and the
  // marquee would show the same match twice side by side; a still row is better.
  const scrolling = live.length >= 3;

  return (
    <div
      className="relative mt-4 overflow-hidden rounded-xl border border-surface-800/70 bg-surface-950/60 backdrop-blur-sm sm:mt-5"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      aria-label="Live scores ticker"
    >
      <span className="absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-surface-950 to-transparent sm:w-12" />
      <span className="absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-surface-950 to-transparent sm:w-12" />

      <div className="flex items-center gap-2 py-2 pl-3 pr-10 sm:pl-4">
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 animate-live-ring" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
        </span>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-red-400">
          Live
        </span>

        <div className="min-w-0 flex-1 overflow-hidden">
          <div
            className={scrolling ? "flex w-max animate-ticker" : "flex w-max"}
            style={
              scrolling
                ? {
                    animationDuration: `${durationSeconds}s`,
                    animationPlayState: paused ? "paused" : "running",
                  }
                : undefined
            }
          >
            {[0, 1].map((copy) => (
              <ul
                key={copy}
                className="flex items-stretch gap-1.5 pr-1.5"
                // The second copy exists only to make the loop seamless; read it
                // out once and the strip is one list, not two.
                aria-hidden={copy === 1 ? true : undefined}
              >
                {live.map((match) => (
                  <TickerItem
                    key={`${copy}-${match.provider}-${match.externalId}`}
                    match={match}
                    onOpen={onOpen}
                  />
                ))}
              </ul>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TickerItem({ match, onOpen }: { match: TickerMatch; onOpen?: () => void }) {
  const label = `${match.homeTeam} ${match.homeScore ?? 0}, ${match.awayTeam} ${
    match.awayScore ?? 0
  }, ${statusText(match) || "in play"} — ${match.competition}`;

  return (
    <li className="shrink-0">
      <button
        type="button"
        onClick={onOpen}
        title={label}
        className="flex items-center gap-2 rounded-lg border border-surface-800/60 bg-surface-900/60 px-2.5 py-1 text-left transition hover:border-brand-500/40 hover:bg-surface-900"
      >
        <span className="max-w-[104px] truncate text-[11px] font-medium text-surface-200 sm:max-w-[150px]">
          {match.homeTeam}
        </span>
        <span className="flex items-center gap-1 rounded-md bg-surface-950/80 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-surface-50">
          {match.homeScore ?? "–"}
          <span className="text-surface-600">-</span>
          {match.awayScore ?? "–"}
        </span>
        <span className="max-w-[104px] truncate text-[11px] text-surface-400 sm:max-w-[150px]">
          {match.awayTeam}
        </span>
        <span className="shrink-0 text-[10px] font-bold tabular-nums text-red-400">
          {statusText(match)}
        </span>
      </button>
    </li>
  );
}
