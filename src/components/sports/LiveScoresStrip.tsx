"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { liveEndpoint } from "@/lib/sports-endpoint";

/**
 * A compact live-scores strip.
 *
 * Designed for pages that are not the sports desk — the radio page sits it under
 * the market exchange — so it is deliberately dense: one line per fixture, live
 * matches first, everything else kept out of the way. It refreshes on the same
 * cadence as the full board and shares its endpoint, so on a configured deploy
 * both are served from one Cloudflare edge entry.
 *
 * Failure is silent by design: this is decoration on someone else's page, and a
 * sports feed having a bad day must never leave an error box sitting under the
 * radio dial. With nothing to show, the component renders nothing at all.
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
/** How many fixtures fit without turning the strip into a second scoreboard. */
const MAX_ROWS = 8;

function statusText(match: StripMatch): string {
  if (match.status === "LIVE") return match.minute ? `${match.minute}'` : "LIVE";
  if (match.status === "HT") return "HT";
  if (!match.kickoff) return "—";
  return new Date(match.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Crest({ name, logo }: { name: string; logo?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!logo || failed) {
    return (
      <span
        aria-hidden
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-surface-800 text-[7px] font-bold text-surface-400"
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- third-party crest CDN; the optimizer would add a hop and break on hotlink-protected hosts
    <img
      src={logo}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-4 w-4 shrink-0 object-contain"
    />
  );
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
        /* Silent: the strip is decoration on a non-sports page. */
      } finally {
        if (mounted.current) setLoading(false);
      }
    };

    void load();
    const timer = setInterval(load, 20_000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [sport]);

  const rows = useMemo(() => {
    const visible = matches.filter(
      (m) => LIVE_STATUSES.has(m.status) || m.status === "SCHEDULED" || m.status === "FT"
    );
    // Live first, then the ones about to start, then anything just finished.
    const rank = (m: StripMatch) =>
      LIVE_STATUSES.has(m.status) ? 0 : m.status === "SCHEDULED" ? 1 : 2;
    return [...visible]
      .sort((a, b) => {
        const byRank = rank(a) - rank(b);
        if (byRank !== 0) return byRank;
        return (a.kickoff ?? "").localeCompare(b.kickoff ?? "");
      })
      .slice(0, MAX_ROWS);
  }, [matches]);

  const liveCount = useMemo(() => matches.filter((m) => LIVE_STATUSES.has(m.status)).length, [matches]);

  // Nothing to say yet, and nothing to apologise for: stay out of the layout.
  if (!loading && rows.length === 0) return null;

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-surface-800/70 bg-surface-900/40">
      <div className="flex items-center justify-between gap-3 border-b border-surface-800/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-accent-strong" />
          <h2 className="text-sm font-semibold text-surface-100">Live scores</h2>
          {liveCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              {liveCount} live
            </span>
          ) : null}
        </div>
        <Link
          href="/sports"
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-accent-strong transition hover:text-accent"
        >
          Full livescore <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-4 py-4 text-xs text-surface-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading today&apos;s fixtures…
        </div>
      ) : (
        <ul className="divide-y divide-surface-800/50">
          {rows.map((match) => {
            const isLive = LIVE_STATUSES.has(match.status);
            return (
              <li key={`${match.competition}-${match.externalId}`}>
                <Link
                  href="/sports"
                  className="flex items-center gap-2 px-3 py-2 transition hover:bg-surface-800/40 sm:gap-3 sm:px-4"
                >
                  <span
                    className={cn(
                      "w-10 shrink-0 text-center text-[10px] font-bold tabular-nums sm:w-11",
                      isLive ? "text-red-400" : match.status === "FT" ? "text-surface-500" : "text-surface-400"
                    )}
                  >
                    {statusText(match)}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <Crest name={match.homeTeam} logo={match.homeLogo} />
                      <span className="truncate text-xs text-surface-200">{match.homeTeam}</span>
                      <span className="ml-auto pl-2 text-xs font-bold tabular-nums text-surface-50">
                        {match.homeScore ?? "–"}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <Crest name={match.awayTeam} logo={match.awayLogo} />
                      <span className="truncate text-xs text-surface-300">{match.awayTeam}</span>
                      <span className="ml-auto pl-2 text-xs font-bold tabular-nums text-surface-100">
                        {match.awayScore ?? "–"}
                      </span>
                    </span>
                  </span>

                  <span className="hidden w-32 shrink-0 truncate text-[10px] text-surface-500 md:block">
                    {match.competition}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
