/**
 * openfootball — keyless, public-domain fixture schedules.
 *
 * The community-maintained `openfootball/football.json` repository publishes a
 * whole season of fixtures as plain JSON per league, on GitHub's CDN, with no
 * key and no quota. That is worth having for one specific reason: it is the only
 * source in the chain that can answer "what is on next Saturday?" for leagues and
 * dates the live scoreboards do not cover, and the calendar view and the weekly
 * prediction pass both need exactly that.
 *
 * What it deliberately is NOT is a results source. The data is edited by hand
 * and lags real life, so this provider contributes **fixtures only** — a fixture
 * is mapped when its date is today or later, never as a live or finished match,
 * and never with a score. It sits at the bottom of the provider chain, so any
 * live feed's version of the same fixture wins the merge outright, and the worst
 * case is that a scheduled kick-off time is a few hours off from the provider's
 * own local-time reading.
 *
 * Requests are cached per league for six hours, which is what keeps eight leagues
 * from becoming eight upstream calls per page view: the calendar, the hub and the
 * prediction pass all read the same cached season.
 */

import { cacheGet, cacheSet } from "@/lib/redis";
import { createLogger } from "@/lib/logger";
import type { NormalizedMatch, SportsProvider } from "@/lib/sports";

const log = createLogger("sports-openfootball");

/** The seasons this provider knows about, newest first. */
const SEASONS = ["2026-27", "2025-26"];

/** Only the leagues the repository actually publishes a season file for. */
export const OPENFOOTBALL_LEAGUES: Record<string, { name: string; country: string }> = {
  "en.1": { name: "Premier League", country: "England" },
  "en.2": { name: "Championship", country: "England" },
  "es.1": { name: "LaLiga", country: "Spain" },
  "it.1": { name: "Serie A", country: "Italy" },
  "de.1": { name: "Bundesliga", country: "Germany" },
  "fr.1": { name: "Ligue 1", country: "France" },
  "nl.1": { name: "Eredivisie", country: "Netherlands" },
  "pt.1": { name: "Primeira Liga", country: "Portugal" },
};

const RAW_BASE = "https://raw.githubusercontent.com/openfootball/football.json/master";
const SEASON_TTL_SECONDS = 6 * 60 * 60;
const FETCH_TIMEOUT_MS = 10_000;

interface OpenMatch {
  round?: string;
  date?: string;
  time?: string;
  team1?: string;
  team2?: string;
  score?: { ft?: number[] };
}

interface SeasonFile {
  name?: string;
  matches?: OpenMatch[];
}

/** `2026-09-14` for a Date, in the same calendar terms the files use. */
function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const seasonCache = new Map<string, OpenMatch[]>();

/**
 * One league's season of fixtures, cached in memory and in Redis.
 *
 * Returns an empty array rather than throwing: this provider is one of several
 * feeding one merge, and a GitHub hiccup must cost the calendar a few fixtures,
 * not the whole board.
 */
async function loadSeason(league: string, season: string): Promise<OpenMatch[]> {
  const key = `${season}:${league}`;
  const memo = seasonCache.get(key);
  if (memo) return memo;

  const cacheKey = `sports:openfootball:${key}`;
  const cached = await cacheGet<OpenMatch[]>(cacheKey).catch(() => null);
  if (cached && Array.isArray(cached)) {
    seasonCache.set(key, cached);
    return cached;
  }

  try {
    const res = await fetch(`${RAW_BASE}/${season}/${league}.json`, {
      headers: { accept: "application/json", "user-agent": "connectPlus/1.0 (+sports desk)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as SeasonFile;
    const matches = Array.isArray(body.matches) ? body.matches : [];
    seasonCache.set(key, matches);
    await cacheSet(cacheKey, matches, SEASON_TTL_SECONDS).catch(() => {});
    return matches;
  } catch (err) {
    log.warn("openfootball season fetch failed", {
      league,
      season,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** A stable, collision-free identity for a fixture the archive has no id for. */
function fixtureExternalId(season: string, league: string, match: OpenMatch): string {
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `of:${season}:${league}:${match.date}:${slug(match.team1 ?? "")}-${slug(match.team2 ?? "")}`;
}

/**
 * Map an archived fixture onto our shape.
 *
 * Only today and the future are mapped: a past fixture is exactly where a stale
 * hand-edited score would do damage, and every live source already covers it.
 * Kick-off times in these files are the league's local time with no zone, so a
 * time is read as UTC — a knowing approximation, and the reason this provider
 * ranks below every live feed.
 */
export function mapOpenFootballMatch(
  match: OpenMatch,
  league: string,
  season: string,
  now: Date = new Date()
): NormalizedMatch | null {
  const meta = OPENFOOTBALL_LEAGUES[league];
  if (!meta) return null;
  const day = match.date;
  const home = (match.team1 ?? "").trim();
  const away = (match.team2 ?? "").trim();
  if (!day || !home || !away) return null;
  // A fixture from a season that has not started (or has ended) is not today's
  // business; the comparison is on calendar days, not instants.
  if (day < dayOf(now)) return null;

  const time = /^\d{2}:\d{2}$/.test(match.time ?? "") ? match.time : "12:00";
  const kickoff = new Date(`${day}T${time}:00.000Z`);
  if (Number.isNaN(kickoff.getTime())) return null;

  return {
    externalId: fixtureExternalId(season, league, match),
    provider: "openfootball",
    sport: "football",
    competition: meta.name,
    competitionId: league,
    country: meta.country,
    homeTeam: home,
    awayTeam: away,
    homeScore: null,
    awayScore: null,
    status: "SCHEDULED",
    minute: null,
    kickoff: kickoff.toISOString(),
    // `match.round` is a competition stage ("Matchday 4"), not a ground. It used
    // to be written into `venue`, which is why an open-football fixture carried
    // a "venue" that was really a round label — and why the desktop row, once it
    // started showing the ground, would have printed "Matchday 4" under a pin.
    venue: null,
    homeForm: null,
    awayForm: null,
    oddsHome: null,
    oddsDraw: null,
    oddsAway: null,
  };
}

/** Every archived fixture on one calendar day, across the leagues we know. */
export async function openFootballDay(date: Date): Promise<NormalizedMatch[]> {
  const day = dayOf(date);
  // Prefer the newest season that has anything on this day: a 2026-27 fixture
  // and its 2025-26 counterpart must not both appear.
  for (const season of SEASONS) {
    const perLeague = await Promise.all(
      Object.keys(OPENFOOTBALL_LEAGUES).map(async (league) => {
        const matches = await loadSeason(league, season);
        return matches
          .filter((m) => m.date === day)
          .map((m) => mapOpenFootballMatch(m, league, season, date))
          .filter((m): m is NormalizedMatch => m !== null);
      })
    );
    const found = perLeague.flat();
    if (found.length > 0) return found;
  }
  return [];
}

/** Every archived fixture in a date range — what the calendar view is built on. */
export async function openFootballRange(from: Date, to: Date): Promise<NormalizedMatch[]> {
  const first = dayOf(from);
  const last = dayOf(to);
  for (const season of SEASONS) {
    const perLeague = await Promise.all(
      Object.keys(OPENFOOTBALL_LEAGUES).map(async (league) => {
        const matches = await loadSeason(league, season);
        return matches
          .filter((m) => typeof m.date === "string" && m.date >= first && m.date <= last)
          .map((m) => mapOpenFootballMatch(m, league, season, new Date(`${first}T00:00:00.000Z`)))
          .filter((m): m is NormalizedMatch => m !== null);
      })
    );
    const found = perLeague.flat();
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * The provider entry, so the fixture archive joins the normal hub merge.
 *
 * It ranks below every live source, which is the entire safety argument: the
 * archive can add fixtures nobody else has, and can never overwrite a source
 * that is actually watching the match.
 */
export const openFootballProvider: SportsProvider = {
  id: "openfootball",
  label: "openfootball archive",
  configured: true,
  priority: 6,
  keyless: true,
  supportsDate: true,
  async fetchMatches({ date }) {
    return openFootballDay(date);
  },
};
