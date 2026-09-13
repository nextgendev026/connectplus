import { cacheGet, cacheSet } from "@/lib/redis";
import { createLogger } from "@/lib/logger";
import { sportsDbGet, sportsDbKeyState } from "@/lib/sports";

const log = createLogger("sports-h2h");

/**
 * Head-to-head and recent form, resolved from real played matches.
 *
 * The prediction engine previously reasoned from a Poisson grid seeded by
 * competition-average priors — plausible, but it had never seen either team
 * play. This module supplies the missing real evidence: each side's last few
 * results with actual scorelines, and any direct meetings between them.
 *
 * Everything here is best-effort by design. A provider having a bad day must
 * leave the fixture panel with *less* context, never an error, so every path
 * degrades to `degraded: true` with whatever was gathered.
 */

/** How many recent events TheSportsDB returns per team; also our form window. */
const FORM_WINDOW = 5;

/** Form changes slowly — a 10-minute cache is generous and saves the quota. */
const CONTEXT_TTL_SECONDS = 600;

/** Team-name → id resolution is near-permanent; cache it for a day. */
const TEAM_ID_TTL_SECONDS = 86_400;

export interface RecentMatch {
  date: string | null;
  competition: string;
  opponent: string;
  /** True when the tracked team was at home. */
  home: boolean;
  goalsFor: number | null;
  goalsAgainst: number | null;
  result: "W" | "D" | "L" | null;
}

export interface TeamForm {
  team: string;
  /** Actual matches found — NOT a fixed count, so a rate is never computed on filler. */
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Most recent first, e.g. `"WWDLW"`. */
  form: string;
  avgGoalsFor: number | null;
  avgGoalsAgainst: number | null;
  matches: RecentMatch[];
}

export interface H2HMeeting {
  date: string | null;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface FixtureContext {
  home: TeamForm | null;
  away: TeamForm | null;
  /** Direct meetings between the two sides, most recent first. */
  h2h: H2HMeeting[];
  source: "sportsdb" | "none";
  /** True when any part of the lookup failed or came back empty. */
  degraded: boolean;
  fetchedAt: string;
}

/**
 * Club-name noise that providers disagree about: TheSportsDB ships "Chelsea FC"
 * where ESPN ships "Chelsea", and treating those as two clubs means a fixture
 * quietly gets one side's form and never finds a head-to-head meeting.
 */
const CLUB_NOISE = /\b(fc|sc|afc|cf|ac|cd|ud|sv|sk|as|club|football|futbol|calcio|the|de)\b/g;

/**
 * Do two provider team names refer to the same club?
 *
 * Deliberately strict: after stripping punctuation and club noise the names must
 * be *equal*. A loose "contains" test would collapse "Arsenal" into "Arsenal de
 * Sarandi" and hand one club's form to another, which is a far worse failure
 * than simply not knowing.
 */
export function sameTeamName(a: string, b: string): boolean {
  const norm = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(CLUB_NOISE, " ")
      .replace(/\s+/g, "")
      .trim();
  const x = norm(a);
  const y = norm(b);
  return x.length > 0 && x === y;
}

const toScore = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const str = (value: unknown): string => (value == null ? "" : String(value));

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * Map one TheSportsDB event into a result from `teamName`'s point of view.
 *
 * Returns null when the row does not actually involve the team, which is the
 * guard that stops an opponent's fixture leaking into the form line.
 */
export function toRecentMatch(row: unknown, teamName: string): RecentMatch | null {
  const e = row as Record<string, unknown>;
  const home = str(e.strHomeTeam);
  const away = str(e.strAwayTeam);
  if (!home || !away) return null;

  const isHome = sameTeamName(home, teamName);
  const isAway = sameTeamName(away, teamName);
  if (!isHome && !isAway) return null;

  const homeScore = toScore(e.intHomeScore);
  const awayScore = toScore(e.intAwayScore);
  const played = homeScore !== null && awayScore !== null;

  const goalsFor = isHome ? homeScore : awayScore;
  const goalsAgainst = isHome ? awayScore : homeScore;
  let result: RecentMatch["result"] = null;
  if (played && goalsFor !== null && goalsAgainst !== null) {
    result = goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
  }

  return {
    date: isoDate(e.strTimestamp) ?? isoDate(e.dateEvent),
    competition: str(e.strLeague) || "Unknown competition",
    opponent: isHome ? away : home,
    home: isHome,
    goalsFor,
    goalsAgainst,
    result,
  };
}

/** Roll a list of played matches (most recent first) into a form summary. */
export function summariseForm(team: string, matches: RecentMatch[]): TeamForm {
  // Only finished matches with a scoreline can contribute to form or rates —
  // an abandoned fixture must not be counted as a draw.
  const played = matches.filter((m) => m.result !== null);

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const m of played) {
    if (m.result === "W") wins += 1;
    else if (m.result === "D") draws += 1;
    else losses += 1;
    goalsFor += m.goalsFor ?? 0;
    goalsAgainst += m.goalsAgainst ?? 0;
  }

  return {
    team,
    played: played.length,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    form: played.map((m) => m.result).join(""),
    // Null rather than 0 when nothing was played: a 0.00 goals-per-game average
    // is a much stronger and much wronger claim than "we don't know".
    avgGoalsFor: played.length > 0 ? Math.round((goalsFor / played.length) * 100) / 100 : null,
    avgGoalsAgainst: played.length > 0 ? Math.round((goalsAgainst / played.length) * 100) / 100 : null,
    matches: played,
  };
}

/**
 * Resolve a TheSportsDB team id from a name.
 *
 * Fixtures merged from ESPN or football-data.org carry that provider's id, which
 * TheSportsDB cannot use — so the name is the only join key available, and a
 * lookup is needed to get an id its endpoints accept.
 */
async function resolveTeamId(teamName: string): Promise<string | null> {
  const cacheKey = `sports:teamid:${teamName.trim().toLowerCase()}`;
  const cached = await cacheGet<string>(cacheKey).catch(() => null);
  if (cached) return cached;

  try {
    const body = await sportsDbGet(`searchteams.php?t=${encodeURIComponent(teamName)}`);
    const teams = Array.isArray(body?.teams) ? (body!.teams as unknown[]) : [];
    for (const entry of teams) {
      const id = (entry as Record<string, unknown>)?.idTeam;
      if (id != null && String(id)) {
        const value = String(id);
        await cacheSet(cacheKey, value, TEAM_ID_TTL_SECONDS).catch(() => {});
        return value;
      }
    }
  } catch (error) {
    log.warn("team id lookup failed", { team: teamName, error });
  }
  return null;
}

/** TheSportsDB's last-N-events feed for one team, mapped to finished results. */
async function fetchTeamForm(teamName: string, teamId: string | null): Promise<TeamForm | null> {
  const id = teamId ?? (await resolveTeamId(teamName));
  if (!id) return null;

  try {
    const body = await sportsDbGet(`eventslast.php?id=${encodeURIComponent(id)}`);
    const rows = Array.isArray(body?.results) ? (body!.results as unknown[]) : [];
    const matches = rows
      .map((row) => toRecentMatch(row, teamName))
      .filter((m): m is RecentMatch => m !== null)
      // The feed is roughly recent-first already, but ordering it here means the
      // form string is always genuinely most-recent-first.
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, FORM_WINDOW);

    if (matches.length === 0) return null;
    return summariseForm(teamName, matches);
  } catch (error) {
    log.warn("team form lookup failed", { team: teamName, error });
    return null;
  }
}

/**
 * Direct meetings, harvested from the two form lists.
 *
 * TheSportsDB's free tier has no reliable head-to-head endpoint, but both teams'
 * recent-results feeds already contain any meeting between them — so the honest
 * move is to surface those rather than invent a fixture list. H2H is therefore
 * capped by the form window, which the UI states rather than hides.
 */
export function collectMeetings(home: TeamForm | null, away: TeamForm | null): H2HMeeting[] {
  if (!home || !away) return [];

  return home.matches
    .filter((m) => sameTeamName(m.opponent, away.team))
    .map((m) => ({
      date: m.date,
      competition: m.competition,
      homeTeam: m.home ? home.team : away.team,
      awayTeam: m.home ? away.team : home.team,
      // `goalsFor`/`goalsAgainst` are from the tracked team's point of view, so
      // they have to be put back onto the correct side of the fixture.
      homeScore: m.home ? m.goalsFor : m.goalsAgainst,
      awayScore: m.home ? m.goalsAgainst : m.goalsFor,
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/**
 * Everything the panel and the model need for one fixture, cached.
 *
 * Cached on the *pair* of teams rather than the fixture id, so opening two
 * fixtures involving the same side reuses the same work.
 */
export async function getFixtureContext(params: {
  homeTeam: string;
  awayTeam: string;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  /** Skips the cache — used by the admin "refresh" action. */
  fresh?: boolean;
}): Promise<FixtureContext> {
  const { homeTeam, awayTeam } = params;
  const cacheKey = `sports:h2h:${homeTeam.toLowerCase()}:${awayTeam.toLowerCase()}`;

  if (!params.fresh) {
    const cached = await cacheGet<FixtureContext>(cacheKey).catch(() => null);
    if (cached) return cached;
  }

  const [home, away] = await Promise.all([
    fetchTeamForm(homeTeam, params.homeTeamId ?? null),
    fetchTeamForm(awayTeam, params.awayTeamId ?? null),
  ]);

  const context: FixtureContext = {
    home,
    away,
    h2h: collectMeetings(home, away),
    source: "sportsdb",
    // Missing form on either side is worth flagging: the UI says "limited
    // history" rather than presenting one team's form as if it were both.
    degraded: !home || !away,
    fetchedAt: new Date().toISOString(),
  };

  await cacheSet(cacheKey, context, CONTEXT_TTL_SECONDS).catch(() => {});
  return context;
}

/** Which key the lookups are running on, for the admin console. */
export function h2hSourceState(): { key: string; fallback: boolean } {
  const state = sportsDbKeyState();
  return { key: state.using, fallback: state.fallback };
}
