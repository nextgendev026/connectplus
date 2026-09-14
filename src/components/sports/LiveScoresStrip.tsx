"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Trophy } from "lucide-react";
import { liveEndpoint } from "@/lib/sports-endpoint";
import { TeamCrest } from "./TeamCrest";

/**
 * A deliberately SUBTLE live-scores panel for pages that are not the sports
 * desk.
 *
 * This is a neighbour of the Forex and Latest Stories panels inside the radio
 * hero, not a scoreboard: it shares their width, their header treatment and
 * their weight. An earlier version rendered eight fixtures in a bordered
 * section with its own chrome, which read as a second page bolted onto the
 * radio dial and dominated the column it sat in.
 *
 * So it shows a handful of the most relevant fixtures, one line each, in the
 * same muted register as its siblings. The full board is one tap away, and
 * with nothing worth showing it renders NOTHING rather than an empty frame —
 * decoration on someone else's page must never be a liability.
 */

interface StripMatch {
  externalId: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  homeLogo?: string | null;
  awayLogo?: string | null;
  status: string;
  minute: number | null;
  kickoff: string | null;
}

interface StripResponse {
  matches: StripMatch[];
}

const LIVE_STATUSES = new Set(["LIVE", "HT"]);
/** Three lines: enough to be useful, few enough to stay decoration. */
const MAX_ROWS = 3;

/**
 * Competitions worth surfacing when several are live at once.
 *
 * A mirror of the server's relevance ranking, kept local on purpose: importing
 * the sports module here would drag Prisma and the provider adapters into a
 * client bundle for one ordering heuristic. Anything unmatched sorts last, so
 * the panel prefers a league a reader recognises over whichever obscure
 * division happens to be mid-match.
 */
const TOP_COMPETITIONS = [
  "premier league",
  "laliga",
  "la liga",
  "serie a",
  "bundesliga",
  "ligue 1",
  "eredivisie",
  "primeira liga",
  "champions league",
  "europa league",
  "afcon",
  "caf champions",
];

function competitionRank(competition: string): number {
  const name = (competition ?? "").toLowerCase();
  const idx = TOP_COMPETITIONS.findIndex((c) => name.includes(c));
  return idx === -1 ? TOP_COMPETITIONS.length : idx;
}

function statusText(match: StripMatch): string {
  if (match.status === "LIVE") return match.minute ? `${match.minute}'` : "LIVE";
  if (match.status === "HT") return "HT";
  if (!match.kickoff) return "—";
  return new Date(match.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function LiveScoresStrip({ sport = "football" }: { sport?: string }) {
  const [matches, setMatches] = useState<StripMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    const load = async () => {
      try {
        const res = await fetch(liveEndpoint({ sport }), { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as StripResponse;
        if (mounted.current) setMatches(Array.isArray(data.matches) ? data.matches : []);
      } catch {
        /* Silent: decoration on a non-sports page must never surface an error. */
      } finally {
        if (mounted.current) setLoading(false);
      }
    };

    void load();
    // Slower than the full board: this panel is peripheral, and every poll is a
    // request the free tiers pay for.
    const timer = setInterval(load, 45_000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [sport]);

  const rows = useMemo(() => {
    const inPlay = matches.filter((m) => LIVE_STATUSES.has(m.status));
    // Live only. A finished or not-yet-started fixture is not "live scores", and
    // including them is what made the panel long enough to look like a board.
    return [...inPlay]
      .sort(
        (a, b) =>
          competitionRank(a.competition) - competitionRank(b.competition) ||
          (b.minute ?? 0) - (a.minute ?? 0)
      )
      .slice(0, MAX_ROWS);
  }, [matches]);

  const liveCount = matches.reduce(
    (n, m) => (LIVE_STATUSES.has(m.status) ? n + 1 : n),
    0
  );

  // Nothing live, nothing shown — and no placeholder either.
  if (loading || rows.length === 0) return null;

  return (
    <div className="mt-3 border-t border-surface-800/40 pt-3">
      {/* Mirrors the Forex / Latest Stories header exactly, so the three panels
          read as one row of siblings rather than three different designs. */}
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500/15">
          <Trophy className="h-3.5 w-3.5 text-accent-strong" />
        </span>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-300">
          Live Scores
        </h3>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/25 px-1.5 py-0.5 text-[9px] font-medium text-red-400">
          <span className="h-1 w-1 rounded-full bg-red-500 animate-pulse" />
          {liveCount} live
        </span>
      </div>

      <ul className="space-y-1">
        {rows.map((match) => (
          <li key={`${match.competition}-${match.externalId}`}>
            <Link
              href="/sports"
              className="flex items-center gap-2 rounded-lg border border-surface-800/60 bg-surface-900/50 px-2.5 py-1.5 transition hover:border-brand-500/30"
            >
              <span className="w-7 shrink-0 text-[10px] font-bold tabular-nums text-red-400">
                {statusText(match)}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <TeamCrest name={match.homeTeam} logo={match.homeLogo} size="xs" />
                  <span className="truncate text-[11px] text-surface-200">{match.homeTeam}</span>
                  <span className="ml-auto pl-1.5 text-[11px] font-bold tabular-nums text-surface-50">
                    {match.homeScore ?? "–"}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <TeamCrest name={match.awayTeam} logo={match.awayLogo} size="xs" />
                  <span className="truncate text-[11px] text-surface-300">{match.awayTeam}</span>
                  <span className="ml-auto pl-1.5 text-[11px] font-bold tabular-nums text-surface-100">
                    {match.awayScore ?? "–"}
                  </span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <Link
        href="/sports"
        className="mt-1.5 inline-flex items-center gap-0.5 text-[10px] font-medium text-accent-strong transition hover:text-accent"
      >
        All live scores <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
