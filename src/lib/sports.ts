import { prisma } from "@/lib/prisma";
import { cacheGet, cacheSet } from "@/lib/redis";
import { createLogger } from "@/lib/logger";
import { openFootballProvider } from "@/lib/sports-openfootball";
import {
  apisportsConfigured as apiSportsConfigured,
  apiSportsFixtureOdds,
  apiSportsIdFromExternal,
  apiSportsProvider,
  APISPORTS_ODDS_MAX_LOOKUPS,
} from "@/lib/sports-apisports";

/**
 * Sports livescore data layer.
 *
 * Database concurrency rule: the pooler connection limit is small (5), so every
 * bulk write in this file goes through a bounded worker pool. An unbounded
 * `Promise.all` over a full matchday is what makes the scoreboard itself wait on
 * a connection — the page must always win that race.
 *
 * Providers differ wildly (football-data.org, TheSportsDB, a future paid feed),
 * so every adapter is normalised onto ONE `NormalizedMatch` shape here. The
 * public hub, the betting analyser and the hive-mind learner all speak that
 * shape, which means swapping or adding a source never touches the UI.
 *
 * Failure policy: a provider error NEVER breaks a page. We fall back to the
 * last persisted snapshot, and if there is nothing at all we serve the built-in
 * demo feed (clearly labelled), so the hub is always usable while credentials
 * are being arranged.
 */

const log = createLogger("sports");

export type MatchStatus =
  | "SCHEDULED"
  | "LIVE"
  | "HT"
  | "FT"
  | "POSTPONED"
  | "CANCELLED"
  | "SUSPENDED";

export const LIVE_STATUSES: MatchStatus[] = ["LIVE", "HT"];

/**
 * How much this audience cares about a competition. Lower sorts first.
 *
 * A wide-open aggregator returns hundreds of fixtures from leagues nobody in
 * Nairobi can bet on or watch — Spanish Tercera Group 12, Vietnam V.League 2 —
 * and those must never crowd the East African and big-five matches out of the
 * first screen (or out of the analyser's per-run budget).
 */
const REGIONAL_LEAGUES =
  /(kenya|kpl|fkf|uganda|tanzania|rwanda|burundi|ethiopia|sudan|somalia|zanzibar|malawi|zambia|zimbabwe|caf|africa)/i;
/**
 * Well-known competitions, matched on the WHOLE normalised name.
 *
 * A substring match is what let "Cambodian Premier League" and "Italian Serie A
 * Womens Cup" rank beside the actual Premier League and Serie A, pushing real
 * fixtures off the first screen — the exact bug this ranking exists to prevent.
 */
const MAJOR_LEAGUE_NAMES = new Set([
  "premier league",
  "english premier league",
  "epl",
  "laliga",
  "la liga",
  "primera division",
  "serie a",
  "bundesliga",
  "1. bundesliga",
  "ligue 1",
  "eredivisie",
  "primeira liga",
  "champions league",
  "uefa champions league",
  "europa league",
  "uefa europa league",
  "uefa europa conference league",
  "conference league",
  "nba",
  "wnba",
  "euroleague",
  "fifa world cup",
  "world cup",
  "afcon",
  "africa cup of nations",
  "major league soccer",
  "mls",
  "liga mx",
  "j1 league",
  "k league 1",
]);
const BIG_FIVE_COUNTRIES = new Set(["England", "Spain", "Italy", "Germany", "France", "Europe", "United States"]);
const TOP_FLIGHT_NAME =
  /(premier|primera|serie a|laliga|la liga|bundesliga|ligue 1|eredivisie|primeira|super lig|allsvenskan|eliteserien|veikkausliiga|ekstraklasa|superliga|1\. ?liga|first division|division 1)/i;
/** Youth, women's and cup competitions are never the country's top flight. */
const NOT_TOP_FLIGHT = /(women|womens|u1\d|u2\d|youth|reserve|cup|playoff|play-off|qualif|friendl)/i;
const TOP_FLIGHT_HINT = /(premier|primera|segunda|super lig|allsvenskan|eliteserien|veikkausliiga|ekstraklasa|liga mx|mls|j1|k league|a-?league|pro league|division 1|first division|1\. ?liga)/i;

function normalizeLeagueName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

export function competitionRelevance(competition: string, country?: string | null): number {
  const name = competition ?? "";
  const where = country ?? "";
  const normalized = normalizeLeagueName(name);
  if (REGIONAL_LEAGUES.test(name) || REGIONAL_LEAGUES.test(where)) return 0;
  if (MAJOR_LEAGUE_NAMES.has(normalized)) return 1;
  // "Bundesliga" is what TheSportsDB calls the German top flight; ESPN says
  // "German Bundesliga". Accept the country-qualified top flight too.
  if (BIG_FIVE_COUNTRIES.has(where) && TOP_FLIGHT_NAME.test(name) && !NOT_TOP_FLIGHT.test(name)) return 1;
  if (TOP_FLIGHT_HINT.test(name)) return 2;
  return 3;
}

/** Live first, then relevance, then kickoff — the order every board renders in. */
export function sortByRelevance(matches: NormalizedMatch[]): NormalizedMatch[] {
  return [...matches].sort((a, b) => {
    const live = (m: NormalizedMatch) => (LIVE_STATUSES.includes(m.status) ? 0 : 1);
    return (
      live(a) - live(b) ||
      competitionRelevance(a.competition, a.country) - competitionRelevance(b.competition, b.country) ||
      (a.kickoff ?? "").localeCompare(b.kickoff ?? "") ||
      a.homeTeam.localeCompare(b.homeTeam)
    );
  });
}

export interface NormalizedMatch {
  externalId: string;
  provider: string;
  sport: string;
  competition: string;
  competitionId?: string | null;
  country?: string | null;
  homeTeam: string;
  awayTeam: string;
  /**
   * Crest/badge URLs straight from the provider, plus the provider's own team
   * id. Both stay in-memory rather than getting columns: they arrive with the
   * fixture on every fetch, so persisting them would only add a migration and a
   * second source of truth. They are null on the database-fallback path, which
   * is a degraded path where a score matters far more than a crest.
   */
  homeLogo?: string | null;
  awayLogo?: string | null;
  /** Used by the head-to-head lookups, which are keyed on the provider team id. */
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: MatchStatus;
  minute: number | null;
  /** ISO timestamp. */
  kickoff: string | null;
  venue?: string | null;
  /** Recent results as `"WDL"`, most recent first — real form, not a placeholder. */
  homeForm?: string | null;
  awayForm?: string | null;
  oddsHome?: number | null;
  oddsDraw?: number | null;
  oddsAway?: number | null;
}

export interface SportsProvider {
  id: string;
  label: string;
  /** True when the credentials/endpoint the adapter needs are present. */
  configured: boolean;
  /**
   * Lower runs first and wins conflicts when two sources describe the same
   * fixture. The order is: credentialed live feeds, then keyless live feeds,
   * then the local demo feed.
   */
  priority: number;
  /** True when the source works with no API key at all. */
  keyless: boolean;
  /**
   * True when the adapter can return a specific past/future day. Livescore-only
   * endpoints can't, so they contribute to today's board and nothing else —
   * otherwise day-strip navigation would keep showing the same live games.
   */
  supportsDate: boolean;
  fetchMatches(opts: { date: Date; sport: string }): Promise<NormalizedMatch[]>;
}

export interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
  selected: boolean;
  /** Participated in the most recent hub build for today. */
  active?: boolean;
  keyless?: boolean;
  /** Fixtures this source contributed after coalescing. */
  contributed?: number;
  hint: string;
}

/** Per-source outcome of the last hub build, surfaced to the admin console. */
export interface SportsSourceReport {
  id: string;
  label: string;
  ok: boolean;
  matches: number;
  contributed: number;
  elapsedMs: number;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Env + provider selection                                            */
/* ------------------------------------------------------------------ */

const env = (name: string): string => (process.env[name] ?? "").trim();

export const SPORTS_PROVIDER_ID = (env("SPORTS_PROVIDER") || "auto").toLowerCase();
export const SPORTS_API_KEY = env("SPORTS_API_KEY");
export const SPORTS_API_BASE = env("SPORTS_API_BASE") || "https://api.football-data.org/v4";
export const SPORTS_REGION = env("SPORTS_REGION") || "KE";
/** TheSportsDB key: a free key ("3" is their documented public test key) or a
 *  patron key. Falls back to the public key so the adapter always answers. */
export const SPORTSDB_API_KEY = env("SPORTSDB_API_KEY") || "3";
/** How long a live snapshot is served from cache before re-hitting the source. */
export const SPORTS_CACHE_TTL = Math.min(
  Math.max(Number(env("SPORTS_CACHE_TTL_SECONDS") ?? 30) || 30, 10),
  600
);
/** Future/past days move slowly, so they cache far longer than live boards. */
export const SPORTS_DAY_CACHE_TTL = Math.min(
  Math.max(Number(env("SPORTS_DAY_CACHE_TTL_SECONDS") ?? 600) || 600, 60),
  3600
);
/** Keyless sources (ESPN, OpenLigaDB, TheSportsDB's public key) can be turned
 *  off with SPORTS_KEYLESS=off when a credentialed feed is the only one you want. */
export const SPORTS_KEYLESS_ENABLED = (env("SPORTS_KEYLESS") || "on").toLowerCase() !== "off";

export const DEMO_PROVIDER_ID = "demo";

function resolveProviderId(): string {
  if (SPORTS_PROVIDER_ID && SPORTS_PROVIDER_ID !== "auto") return SPORTS_PROVIDER_ID;
  if (SPORTS_API_KEY) return "football-data";
  // No keys at all: the keyless tier is a real feed, not a placeholder, so it
  // is preferred over the synthetic demo data.
  if (SPORTS_KEYLESS_ENABLED) return "sportsdb";
  return DEMO_PROVIDER_ID;
}

/* ------------------------------------------------------------------ */
/* Normalisation helpers                                               */
/* ------------------------------------------------------------------ */

function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * The longest plausible in-play minute for a football match, extra time
 * included. Anything past this is a mis-parse, not a match that ran on.
 */
const MAX_MATCH_MINUTE = 130;

/**
 * Read an in-play minute out of a provider's clock string.
 *
 * Providers hand back the clock in several shapes and the naive version of
 * this — strip every non-digit and parse — is wrong for most of them:
 *
 *   ESPN     "4:54"   → 454   (should be 4:54 elapsed = 4)
 *   ESPN     "45:00"  → 4500  (should be 45)
 *   TheSportsDB "45+2'" → 452  (should be 47)
 *   TheSportsDB "45'"  → 45    (correct, by luck)
 *
 * A 454th minute is a very visible bug on the live board, so parse the shape
 * instead of the digits: minutes before a colon, stoppage time after a "+",
 * and reject anything that still lands outside a real match.
 */
export function parseMatchMinute(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  // A bare status word ("HT", "FT", "NS") is not a minute.
  if (/^[A-Za-z]+$/.test(text)) return null;

  const stoppageMatch = text.match(/\+\s*(\d{1,2})/);
  const stoppage = stoppageMatch ? Number.parseInt(stoppageMatch[1]!, 10) : 0;
  // Everything before the stoppage marker is the regulation clock.
  const clock = text.split("+")[0] ?? "";
  // "MM:SS" — the part before the colon is the minute.
  const leading = clock.split(":")[0] ?? "";
  const minutes = Number.parseInt(leading.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(minutes)) return null;

  const total = minutes + (Number.isFinite(stoppage) ? stoppage : 0);
  if (total <= 0 || total > MAX_MATCH_MINUTE) return null;
  return total;
}

function normalizeFootballDataStatus(raw: string, minute: number | null): MatchStatus {
  const s = raw.toUpperCase();
  if (s === "IN_PLAY" || s === "LIVE") return "LIVE";
  if (s === "PAUSED" || s === "HALFTIME" || s === "HALF_TIME") return "HT";
  if (s === "FINISHED" || s === "AWARDED") return "FT";
  if (s === "POSTPONED") return "POSTPONED";
  if (s === "SUSPENDED") return "SUSPENDED";
  if (s === "CANCELLED") return "CANCELLED";
  return minute != null && minute > 0 ? "LIVE" : "SCHEDULED";
}

function normalizeSportsDbStatus(raw: string, progress: string | null): MatchStatus {
  const s = (raw || "").toUpperCase();
  const p = (progress || "").toUpperCase();
  if (p.includes("HT") || p.includes("HALF")) return "HT";
  if (s === "1H" || s === "2H" || s === "LIVE" || s === "ET" || p.startsWith("'")) return "LIVE";
  if (s.includes("FINISH") || s === "FT" || s === "AET" || s === "PEN") return "FT";
  if (s.includes("POSTPON")) return "POSTPONED";
  if (s.includes("CANCEL")) return "CANCELLED";
  if (s.includes("SUSPEND") || s.includes("DELAY")) return "SUSPENDED";
  return "SCHEDULED";
}

function isoOrNull(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* ------------------------------------------------------------------ */
/* Adapters                                                            */
/* ------------------------------------------------------------------ */

/** football-data.org v4 — the most reliable free live feed for East African
 *  leagues; `SPORTS_API_KEY` is the (free) API token. */
const footballDataProvider: SportsProvider = {
  id: "football-data",
  label: "football-data.org",
  configured: SPORTS_API_KEY.length > 0,
  priority: 1,
  keyless: false,
  supportsDate: true,
  async fetchMatches({ date }) {
    const day = date.toISOString().slice(0, 10);
    const url = `${SPORTS_API_BASE.replace(/\/$/, "")}/matches?dateFrom=${day}&dateTo=${day}`;
    const res = await fetch(url, {
      headers: {
        "X-Auth-Token": SPORTS_API_KEY,
        "User-Agent": "connectPlus-Sports/1.0",
      },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`football-data HTTP ${res.status}`);
    const body = (await res.json()) as { matches?: unknown[] };
    const rows = Array.isArray(body.matches) ? body.matches : [];
    return rows
      .map((row): NormalizedMatch | null => {
        const m = row as Record<string, unknown>;
        const comp = (m.competition ?? {}) as Record<string, unknown>;
        const home = (m.homeTeam ?? {}) as Record<string, unknown>;
        const away = (m.awayTeam ?? {}) as Record<string, unknown>;
        const score = (m.score ?? {}) as Record<string, unknown>;
        const full = (score.fullTime ?? {}) as Record<string, unknown>;
        const homeName = (home.name ?? home.shortName ?? "") as string;
        const awayName = (away.name ?? away.shortName ?? "") as string;
        const minute = toInt(m.minute);
        if (!m.id || (!homeName && !awayName)) return null;
        const status = normalizeFootballDataStatus(String(m.status ?? ""), minute);
        return {
          externalId: String(m.id),
          provider: "football-data",
          sport: "football",
          competition: String(comp.name ?? "Unknown competition"),
          competitionId: comp.id != null ? String(comp.id) : null,
          country: (comp.area as Record<string, unknown> | undefined)?.name
            ? String((comp.area as Record<string, unknown>).name)
            : null,
          homeTeam: homeName || "Home",
          awayTeam: awayName || "Away",
          homeLogo: typeof home.crest === "string" ? home.crest : null,
          awayLogo: typeof away.crest === "string" ? away.crest : null,
          homeTeamId: home.id != null ? String(home.id) : null,
          awayTeamId: away.id != null ? String(away.id) : null,
          homeScore: toInt(full.home ?? score.regularTime),
          awayScore: toInt(full.away),
          status,
          minute,
          kickoff: isoOrNull(m.utcDate),
          venue: typeof m.venue === "string" ? m.venue : null,
        };
      })
      .filter((m): m is NormalizedMatch => m !== null);
  },
};

const SPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json";
/** Documented public key. Works without signup, which is what makes the
 *  keyless tier genuinely keyless. */
const SPORTSDB_PUBLIC_KEY = "3";

/** Set once a configured key is rejected, so we stop paying a round-trip for it. */
let sportsDbRejectedKey: string | null = null;

/** Which TheSportsDB key is actually in use, for the admin console. */
export function sportsDbKeyState(): { using: string; fallback: boolean } {
  if (sportsDbRejectedKey) return { using: "public", fallback: true };
  return SPORTSDB_API_KEY === SPORTSDB_PUBLIC_KEY
    ? { using: "public", fallback: false }
    : { using: "configured", fallback: false };
}

function sportsDbSport(sport: string): string {
  return sport === "basketball" ? "Basketball" : "Soccer";
}

/**
 * GET a TheSportsDB v1 path, tolerating a bad key.
 *
 * A patron key that has expired must not take the football board down with it:
 * on an "Invalid … API key" response we drop to the public key and carry on.
 */
export async function sportsDbGet(path: string): Promise<Record<string, unknown> | null> {
  const candidates = [...new Set([SPORTSDB_API_KEY, SPORTSDB_PUBLIC_KEY])].filter(Boolean);
  const ordered = sportsDbRejectedKey
    ? candidates.filter((k) => k !== sportsDbRejectedKey)
    : candidates;
  let lastError: string | null = null;

  for (const key of ordered) {
    try {
      const res = await fetch(`${SPORTSDB_BASE}/${key}/${path}`, {
        headers: { "User-Agent": "connectPlus-Sports/1.0" },
        signal: AbortSignal.timeout(9000),
        cache: "no-store",
      });
      if (res.ok) {
        const body = (await res.json()) as Record<string, unknown>;
        if (typeof body.Message === "string" && /invalid|pricing/i.test(body.Message)) {
          throw new Error(body.Message);
        }
        return body;
      }
      const text = await res.text().catch(() => "");
      lastError = `HTTP ${res.status} ${text.slice(0, 80)}`;
      if (/invalid|pricing/i.test(text) && key !== SPORTSDB_PUBLIC_KEY) {
        log.warn("sportsdb key rejected — falling back to the public key");
        sportsDbRejectedKey = key;
        continue;
      }
      if (res.status < 500) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (key !== SPORTSDB_PUBLIC_KEY && /invalid|pricing/i.test(lastError)) {
        sportsDbRejectedKey = key;
        continue;
      }
    }
  }

  throw new Error(lastError ?? "sportsdb unavailable");
}

/**
 * TheSportsDB — keyed feed (free key, or a patron key via SPORTSDB_API_KEY).
 *
 * Two shapes are used so the board works for *any* day, not just right now:
 *   • livescore  — today only, includes in-play minutes and scores.
 *   • eventsday  — a specific calendar day (scheduled + finished fixtures).
 * Both v2 (`livescore/{sport}`, keyed by header) and v1 (`livescore.php`,
 * keyed in the path) are tried, because free keys vary in which they can use.
 */
const sportsDbProvider: SportsProvider = {
  id: "sportsdb",
  label: "TheSportsDB",
  configured: true,
  priority: 2,
  keyless: SPORTSDB_API_KEY === "3",
  supportsDate: true,
  async fetchMatches({ date, sport }) {
    const isToday = date.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
    const day = date.toISOString().slice(0, 10);

    if (isToday) {
      try {
        const body = await sportsDbGet(`livescore.php?s=${sportsDbSport(sport)}`);
        const rows = Array.isArray(body?.livescore) ? (body!.livescore as unknown[]) : [];
        // The v1 livescore response is `{ livescore: [...] }`; older deployments
        // answered `{ events: [...] }`, so accept either.
        const events = rows.length > 0 ? rows : Array.isArray(body?.events) ? (body!.events as unknown[]) : [];
        const mapped = events.map((row) => mapSportsDbEvent(row)).filter(isMatch);
        if (mapped.length > 0) return mapped;
      } catch (err) {
        log.warn("sportsdb livescore failed, using the day fixture list", { error: err });
      }
    }

    // A specific day: scheduled and finished fixtures for that calendar date.
    const body = await sportsDbGet(`eventsday.php?d=${day}&s=${sportsDbSport(sport)}`);
    const rows = Array.isArray(body?.events) ? (body.events as unknown[]) : [];
    return rows
      .map((row) => mapSportsDbEvent(row, day))
      .filter(isMatch)
      .map((m) => ({ ...m, kickoff: m.kickoff ?? `${day}T12:00:00.000Z` }));
  },
};

/* ------------------------------------------------------------------ */
/* Keyless sources                                                     */
/* ------------------------------------------------------------------ */

/**
 * ESPN's public scoreboard API needs no key and carries live state, minute,
 * scores and — unlike every other keyless source we have — a price.
 *
 * That last part is why this list is worth keeping long. The American and
 * European majors set the tone of the board, but the fixtures underneath them
 * are what the desk is for, and a league that is not fetched here is a league
 * whose model cannot see the market it is supposed to beat: `sports-intelligence`
 * prices its edge against these odds, and an unpriced league silently falls
 * back to "No published odds to price an edge against".
 *
 * Every slug below was checked against the live feed and returns events with an
 * `odds` block attached. Cup competitions are included deliberately: a knockout
 * night is when a price is most asked for, and `uefa.europa.conf` alone prices
 * eighteen fixtures a round.
 */
export const ESPN_SOCCER_LEAGUES: Record<string, string> = {
  // The majors.
  "eng.1": "Premier League",
  "eng.2": "Championship",
  "esp.1": "LaLiga",
  "esp.2": "LaLiga 2",
  "ita.1": "Serie A",
  "ger.1": "Bundesliga",
  "fra.1": "Ligue 1",
  "ned.1": "Eredivisie",
  "por.1": "Primeira Liga",
  "usa.1": "MLS",
  "mex.1": "Liga MX",
  // The rest of Europe, where the second tiers and the smaller top flights are
  // the ones no other keyless source prices at all.
  "eng.3": "League One",
  "eng.4": "League Two",
  "ita.2": "Serie B",
  "ger.2": "2. Bundesliga",
  "fra.2": "Ligue 2",
  "ned.2": "Eerste Divisie",
  "mex.2": "Liga MX Expansion",
  "sco.1": "Scottish Premiership",
  "bel.1": "Belgian Pro League",
  "tur.1": "Turkish Super Lig",
  "aut.1": "Austrian Bundesliga",
  "sui.1": "Swiss Super League",
  "den.1": "Danish Superliga",
  "swe.1": "Allsvenskan",
  "nor.1": "Eliteserien",
  "gre.1": "Greek Super League",
  "rou.1": "Romanian Liga I",
  "rus.1": "Russian Premier League",
  "isr.1": "Israeli Premier League",
  // The Americas and Asia, where a reader is likelier to be betting a late
  // kick-off than a Saturday 3pm.
  "bra.1": "Brazilian Serie A",
  "bra.2": "Brazilian Serie B",
  "arg.1": "Argentine Primera Division",
  "chi.1": "Chilean Primera Division",
  "col.1": "Colombian Primera A",
  "ecu.1": "Ecuadorian Serie A",
  "per.1": "Peruvian Primera Division",
  "uru.1": "Uruguayan Primera Division",
  "par.1": "Paraguayan Primera Division",
  "bol.1": "Bolivian Primera Division",
  "ven.1": "Venezuelan Primera Division",
  "jpn.1": "J1 League",
  "ksa.1": "Saudi Pro League",
  "usa.usl.1": "USL Championship",
  // Continental competitions and the domestic cups that fill a midweek.
  "uefa.champions": "UEFA Champions League",
  "uefa.europa": "UEFA Europa League",
  "uefa.europa.conf": "UEFA Conference League",
  "uefa.nations": "UEFA Nations League",
  "fifa.world": "FIFA World Cup",
  "caf.champions": "CAF Champions League",
  "afc.champions": "AFC Champions League Elite",
  "afc.cup": "AFC Champions League Two",
  "concacaf.champions": "Concacaf Champions Cup",
  "conmebol.libertadores": "CONMEBOL Libertadores",
  "conmebol.sudamericana": "CONMEBOL Sudamericana",
  "eng.fa": "FA Cup",
  "eng.league_cup": "EFL Cup",
};

export const ESPN_BASKETBALL_LEAGUES: Record<string, string> = {
  "nba": "NBA",
  "wnba": "WNBA",
  "mens-college-basketball": "NCAA Basketball",
  "womens-college-basketball": "NCAA Women's Basketball",
  "nba-dleague": "NBA G League",
};

/** How many ESPN scoreboards may be in flight at once. See `mapLimit`. */
const ESPN_FETCH_CONCURRENCY = 12;

/** How many extra leagues one odds backfill may ask for. */
const ODDS_BACKFILL_MAX_LEAGUES = 12;

const ESPN_COUNTRY: Record<string, string> = {
  "eng.1": "England",
  "eng.2": "England",
  "eng.3": "England",
  "eng.4": "England",
  "eng.fa": "England",
  "eng.league_cup": "England",
  "esp.1": "Spain",
  "esp.2": "Spain",
  "ita.1": "Italy",
  "ita.2": "Italy",
  "ger.1": "Germany",
  "ger.2": "Germany",
  "fra.1": "France",
  "fra.2": "France",
  "ned.1": "Netherlands",
  "ned.2": "Netherlands",
  "por.1": "Portugal",
  "usa.1": "United States",
  "usa.usl.1": "United States",
  "mex.1": "Mexico",
  "mex.2": "Mexico",
  "sco.1": "Scotland",
  "bel.1": "Belgium",
  "tur.1": "Turkey",
  "aut.1": "Austria",
  "sui.1": "Switzerland",
  "den.1": "Denmark",
  "swe.1": "Sweden",
  "nor.1": "Norway",
  "gre.1": "Greece",
  "rou.1": "Romania",
  "rus.1": "Russia",
  "isr.1": "Israel",
  "bra.1": "Brazil",
  "bra.2": "Brazil",
  "arg.1": "Argentina",
  "chi.1": "Chile",
  "col.1": "Colombia",
  "ecu.1": "Ecuador",
  "per.1": "Peru",
  "uru.1": "Uruguay",
  "par.1": "Paraguay",
  "bol.1": "Bolivia",
  "ven.1": "Venezuela",
  "jpn.1": "Japan",
  "ksa.1": "Saudi Arabia",
  "uefa.champions": "Europe",
  "uefa.europa": "Europe",
  "uefa.europa.conf": "Europe",
  "uefa.nations": "Europe",
  "caf.champions": "Africa",
  "afc.champions": "Asia",
  "afc.cup": "Asia",
  "concacaf.champions": "North America",
  "conmebol.libertadores": "South America",
  "conmebol.sudamericana": "South America",
  "nba": "United States",
  "wnba": "United States",
  "nba-dleague": "United States",
};

/**
 * Display name → ESPN league slug.
 *
 * The scoreboard adapter stores the league inside each external id as
 * `espn:<league>:<eventId>`, and fixtures written by earlier versions hold the
 * DISPLAY name there ("Serie A") while the summary endpoint addresses leagues by
 * slug ("ita.1"). This is the lookup that reconciles the two, so a stored fixture
 * from before keeps working without rewriting anyone's external ids — and with
 * them, the predictions and reminders keyed off those ids.
 */
const ESPN_SLUG_BY_NAME: Record<string, string> = Object.fromEntries(
  [...Object.entries(ESPN_SOCCER_LEAGUES), ...Object.entries(ESPN_BASKETBALL_LEAGUES)].map(
    ([slug, name]) => [name.toLowerCase(), slug]
  )
);

/**
 * Resolve either form of the league segment to a slug, or null if it is neither.
 *
 * A slug-shaped token is accepted as-is — the registry only names the leagues we
 * fetch, and an unknown-but-well-formed slug should still address the feed rather
 * than silently lose its analysis.
 */
export function espnLeagueSlug(token: string): string | null {
  const raw = (token ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const byName = ESPN_SLUG_BY_NAME[lower];
  if (byName) return byName;
  if (!lower.includes(" ") && /^[a-z0-9.\-]+$/.test(lower)) return lower;
  return null;
}

function espnStatus(state: string, detail: string): MatchStatus {
  const s = (state || "").toLowerCase();
  const d = (detail || "").toLowerCase();
  if (s === "in") {
    if (d.includes("half") || d.includes("halftime")) return "HT";
    return "LIVE";
  }
  if (s === "post") {
    if (d.includes("postpon")) return "POSTPONED";
    if (d.includes("cancel")) return "CANCELLED";
    if (d.includes("suspend") || d.includes("delay")) return "SUSPENDED";
    return "FT";
  }
  if (d.includes("postpon")) return "POSTPONED";
  return "SCHEDULED";
}

/**
 * ESPN's ground, which arrives as an object and never as a bare string.
 *
 * `fullName` is the pitch ("Giuseppe Sinigaglia"); `address.city` is the only
 * other usable field, and it is a weaker fact than the ground itself, so it is
 * only used when the name is missing rather than concatenated onto it.
 */
function espnVenue(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const name = String(v.fullName ?? v.name ?? "").trim();
  if (name) return name;
  const address = (v.address ?? {}) as Record<string, unknown>;
  const city = String(address.city ?? "").trim();
  return city || null;
}

export function mapEspnEvent(row: unknown, league: string, sport: string): NormalizedMatch | null {
  const e = row as Record<string, unknown>;
  const competition = (e.competitions as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined;
  if (!e.id || !competition) return null;
  const competitors = (competition.competitors as unknown[] | undefined) ?? [];
  const side = (want: "home" | "away") =>
    competitors.find((c) => (c as Record<string, unknown>).homeAway === want) as
      | Record<string, unknown>
      | undefined;
  const home = side("home");
  const away = side("away");
  const nameOf = (team?: Record<string, unknown>) => {
    const t = (team?.team ?? {}) as Record<string, unknown>;
    return String(t.displayName ?? t.shortDisplayName ?? t.name ?? "");
  };
  const homeName = nameOf(home);
  const awayName = nameOf(away);
  if (!homeName && !awayName) return null;

  const statusRaw = ((competition.status ?? e.status) ?? {}) as Record<string, unknown>;
  const type = (statusRaw.type ?? {}) as Record<string, unknown>;
  const status = espnStatus(String(type.state ?? ""), String(type.description ?? ""));
  const minute = status === "LIVE" ? parseMatchMinute(statusRaw.displayClock) : null;

  const score = (team?: Record<string, unknown>) => {
    const raw = team?.score;
    if (raw == null || raw === "") return null;
    const value = typeof raw === "object" ? (raw as Record<string, unknown>).value : raw;
    return toInt(value);
  };
  const total = (competition.status as Record<string, unknown> | undefined)?.type as
    | Record<string, unknown>
    | undefined;
  const completed = String(total?.completed ?? "") === "true" || status === "FT";

  /*
   * Odds, read from the shape ESPN actually sends.
   *
   * This used to look for `odds.homeTeamOdds.moneyLine` and
   * `odds.awayTeamOdds.moneyLine`. Neither key exists: the payload nests both
   * sides under `odds.moneyline.home/away` with `open` and `close` sub-objects,
   * and only the draw price sits at the top level (`odds.drawOdds.moneyLine`).
   * The result was that home and away were always null, the draw was always
   * populated, and every consumer that requires all three — the market-baseline
   * view and the closing-line comparison — was silently dead. No error, no log,
   * just a model that never once consulted the market it was supposed to beat.
   *
   * `close` is preferred over `open`: the closing line is the sharper number and
   * the one a settled bet is graded against.
   */
  const odds = ((competition.odds as unknown[] | undefined)?.[0] ?? null) as Record<string, unknown> | null;
  const moneyline = (odds?.moneyline as Record<string, unknown> | undefined) ?? undefined;
  const pickLine = (side?: unknown): unknown => {
    const s = (side ?? {}) as Record<string, unknown>;
    const close = (s.close ?? {}) as Record<string, unknown>;
    const open = (s.open ?? {}) as Record<string, unknown>;
    return close.odds ?? open.odds;
  };
  const drawOdds = (odds?.drawOdds as Record<string, unknown> | undefined) ?? undefined;
  const americanToDecimal = (value: unknown): number | null => {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return null;
    const dec = n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
    return Math.round(dec * 100) / 100;
  };

  return {
    externalId: `espn:${league}:${String(e.id)}`,
    provider: "espn",
    sport,
    competition: league,
    // The provider's own identifier for the competition, when we know its slug.
    // `espnLeagueSlug` also reads the display-name form, so this is correct for
    // fixtures mapped by either version of the adapter.
    competitionId: espnLeagueSlug(league) ?? league,
    country: ESPN_COUNTRY[league] ?? null,
    homeTeam: homeName || "Home",
    awayTeam: awayName || "Away",
    // ESPN nests the crest differently per competition: `logo` on some, a
    // `logos[]` array on others. Take whichever exists.
    homeLogo: espnLogo(home),
    awayLogo: espnLogo(away),
    homeTeamId: espnTeamId(home),
    awayTeamId: espnTeamId(away),
    homeScore: completed || status === "LIVE" || status === "HT" ? score(home) : null,
    awayScore: completed || status === "LIVE" || status === "HT" ? score(away) : null,
    status,
    minute,
    kickoff: isoOrNull(e.date),
    // `competition.venue` is an object here, never a string — the old typeof
    // check could not pass, so every ESPN fixture carried a null venue no matter
    // how much the provider knew about the ground.
    venue: espnVenue(competition.venue),
    oddsHome: americanToDecimal(pickLine(moneyline?.home)),
    oddsDraw: americanToDecimal(drawOdds?.moneyLine),
    oddsAway: americanToDecimal(pickLine(moneyline?.away)),
  };
}

/**
 * Run `tasks` with at most `limit` in flight.
 *
 * The league registry is deliberately long, and an unbounded `Promise.all` over
 * fifty scoreboards opens fifty sockets at once — enough to get us throttled by
 * a public API that owes us nothing, and enough to make a serverless invocation
 * look like a burst. Twelve at a time keeps the wall-clock the same without the
 * burst.
 */
async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await run(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * One league's scoreboard for a day, normalised. Empty on any failure.
 *
 * The league is passed to the mapper as its **slug**, not its display name.
 * `mapEspnEvent` stores whatever it is given in the external id, and the deep
 * view is addressed by parsing that id back — `espn:<slug>:<eventId>`. Handing
 * it a name like "Copa MX" produces an id whose middle segment cannot be
 * resolved back to a slug, so the fixture is found and then thrown away, which
 * looks exactly like not finding it at all.
 */
async function espnScoreboard(slug: string, sport: string, day: string, timeoutMs = 8000): Promise<NormalizedMatch[]> {
  const sportPath = sport === "basketball" ? "basketball" : "soccer";
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/${slug}/scoreboard?dates=${day}&limit=100`,
    { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" }
  );
  if (!res.ok) throw new Error(`espn ${slug} HTTP ${res.status}`);
  const body = (await res.json()) as { events?: unknown[] };
  const rows = Array.isArray(body.events) ? body.events : [];
  return rows.map((row) => mapEspnEvent(row, slug, sport)).filter(isMatch);
}

const espnProvider: SportsProvider = {
  id: "espn",
  label: "ESPN scoreboard",
  configured: true,
  priority: 3,
  keyless: true,
  supportsDate: true,
  async fetchMatches({ date, sport }) {
    const day = espnDay(date);
    const leagues = sport === "basketball" ? ESPN_BASKETBALL_LEAGUES : ESPN_SOCCER_LEAGUES;
    const slugs = Object.keys(leagues);

    const settled = await mapLimit(slugs, ESPN_FETCH_CONCURRENCY, async (slug) => {
      try {
        return { ok: true as const, matches: await espnScoreboard(slug, sport, day) };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    });

    const matches: NormalizedMatch[] = [];
    for (const r of settled) if (r.ok) matches.push(...r.matches);
    // Every league failing is ESPN being unreachable, not a quiet day: surface it
    // so the source report shows a red light instead of "contributed 0".
    if (settled.length > 0 && settled.every((r) => !r.ok)) {
      throw new Error(settled[0] && !settled[0].ok ? settled[0].error : "espn unavailable");
    }
    return matches;
  },
};

/**
 * OpenLigaDB — keyless German-league feed (Bundesliga, 2. Bundesliga, DFB
 * Pokal). Handy as a second keyless opinion on fixtures ESPN also carries: the
 * merge prefers ESPN for live state but the fallback keeps German matchdays
 * populated when ESPN's scoreboard is down.
 */
function openLigaStatus(row: Record<string, unknown>): MatchStatus {
  const finished = row.matchIsFinished === true;
  if (finished) return "FT";
  const results = (row.matchResults as unknown[] | undefined) ?? [];
  if (results.length > 0) return "LIVE";
  return "SCHEDULED";
}

function mapOpenLigaMatch(row: unknown, competition: string): NormalizedMatch | null {
  const m = row as Record<string, unknown>;
  const team1 = (m.team1 ?? {}) as Record<string, unknown>;
  const team2 = (m.team2 ?? {}) as Record<string, unknown>;
  const home = String(team1.teamName ?? "");
  const away = String(team2.teamName ?? "");
  if (!m.matchID || (!home && !away)) return null;
  const results = (m.matchResults as unknown[] | undefined) ?? [];
  const final = results.find(
    (r) => (r as Record<string, unknown>).resultTypeID === 2
  ) as Record<string, unknown> | undefined;
  const last = results[results.length - 1] as Record<string, unknown> | undefined;
  const scoreOf = (source: Record<string, unknown> | undefined, key: "resultTeam1" | "resultTeam2") => {
    const raw = source?.[key === "resultTeam1" ? "pointsTeam1" : "pointsTeam2"] ?? source?.[key === "resultTeam1" ? "resultTeam1" : "resultTeam2"];
    return toInt(raw);
  };
  const status = openLigaStatus(m);
  const finalized = status === "FT";

  return {
    externalId: `openliga:${String(m.matchID)}`,
    provider: "openligadb",
    sport: "football",
    competition,
    competitionId: null,
    country: "Germany",
    homeTeam: home || "Home",
    awayTeam: away || "Away",
    homeScore: scoreOf(finalized ? final : last, "resultTeam1"),
    awayScore: scoreOf(finalized ? final : last, "resultTeam2"),
    status,
    minute: null,
    kickoff: isoOrNull(m.matchDateTimeUTC ?? m.matchDateTime),
    venue: null,
    oddsHome: null,
    oddsDraw: null,
    oddsAway: null,
  };
}

const openLigaProvider: SportsProvider = {
  id: "openligadb",
  label: "OpenLigaDB",
  configured: true,
  priority: 4,
  keyless: true,
  supportsDate: false,
  async fetchMatches({ date, sport }) {
    if (sport === "basketball") return [];
    const day = date.toISOString().slice(0, 10);
    const res = await fetch("https://api.openligadb.de/getmatchdata/bl1", {
      headers: { "User-Agent": "connectPlus-Sports/1.0" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`openligadb HTTP ${res.status}`);
    const body = (await res.json()) as unknown[];
    const rows = Array.isArray(body) ? body : [];
    // The endpoint returns the whole season, so narrow it to the requested day
    // (keeping anything in play, which must survive the filter).
    return rows
      .map((row) => mapOpenLigaMatch(row, "Bundesliga"))
      .filter(isMatch)
      .filter((m) => {
        if (LIVE_STATUSES.includes(m.status)) return true;
        return (m.kickoff ?? "").slice(0, 10) === day;
      });
  },
};

/* ------------------------------------------------------------------ */
/* Coalescing                                                          */
/* ------------------------------------------------------------------ */

/**
 * Collapse a club name to comparable letters.
 *
 * Club suffixes are stripped because providers disagree about them constantly
 * ("Sheffield United" vs "Sheffield Utd", "Chelsea FC" vs "Chelsea"), and an
 * unstripped suffix is the difference between recognising one fixture and
 * rendering it twice.
 */
export function teamSlug(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    // Fold accents so "Málaga" and "Malaga" are one club, not two.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|sc|ac|cf|afc|united|utd|city|club|cd|sk|fk)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Loose identity for the same real-world fixture across providers. */
export function fixtureKey(m: NormalizedMatch): string {
  const day = (m.kickoff ?? "").slice(0, 10);
  return `${teamSlug(m.homeTeam)}|${teamSlug(m.awayTeam)}|${day}`;
}

/**
 * Identity for a fixture as *stored*, where only plain columns are available.
 *
 * The live board merges providers in memory, but anything reading the database
 * (the tips feed, the accuracy record, the admin tables) sees one row per
 * provider and therefore renders the same match — and the same league under two
 * different names — twice. This is the key those readers dedupe on.
 */
export function fixtureIdentity(row: {
  homeTeam: string;
  awayTeam: string;
  kickoff?: Date | string | null;
}): string {
  const day = row.kickoff ? new Date(row.kickoff).toISOString().slice(0, 10) : "";
  return `${teamSlug(row.homeTeam)}|${teamSlug(row.awayTeam)}|${day}`;
}

/** Provider-specific country prefixes that obscure the same competition. */
const COMPETITION_PREFIX =
  /^(english|spanish|italian|german|french|dutch|portuguese|scottish|belgian|turkish|russian|japanese|danish|swedish|norwegian|polish|austrian|swiss|greek|brazilian|argentine|mexican|american|saudi|qatari|uae|kenyan|ugandan|tanzanian|nigerian|south african)\s+/i;

/** Labels providers use for one league, folded onto a single canonical name. */
const COMPETITION_ALIASES: Record<string, string> = {
  "la liga": "LaLiga",
  "la liga santander": "LaLiga",
  "primera division": "LaLiga",
  "laliga": "LaLiga",
  "laliga ea sports": "LaLiga",
  "premier league": "Premier League",
  "english premier league": "Premier League",
  "epl": "Premier League",
  championship: "Championship",
  "efl championship": "Championship",
  "serie a": "Serie A",
  bundesliga: "Bundesliga",
  "ligue 1": "Ligue 1",
  eredivisie: "Eredivisie",
  "primeira liga": "Primeira Liga",
  "uefa champions league": "UEFA Champions League",
  "champions league": "UEFA Champions League",
  "uefa europa league": "UEFA Europa League",
  "europa league": "UEFA Europa League",
  "caf champions league": "CAF Champions League",
};

/**
 * One label per competition.
 *
 * Two providers naming the same league differently is why the tips board showed
 * "LaLiga" and "Spanish La Liga" as separate leagues. Folding the known labels
 * onto one name keeps per-competition views, filters and breakdowns honest; an
 * unknown competition is titled-cased but never guessed at.
 */
export function canonicalCompetition(name: string, country?: string | null): string {
  const raw = (name ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return country ? `${country} league` : "Unknown competition";

  const stripped = raw.replace(COMPETITION_PREFIX, "").trim();
  const alias = COMPETITION_ALIASES[stripped.toLowerCase()];
  if (alias) return alias;

  // "Spanish Segunda Federación Group 1" has no canonical short form; keep the
  // provider's own wording (minus the redundant country prefix) rather than
  // merging distinct lower divisions into one bucket.
  return stripped;
}

/**
 * Merge several providers' views of the same day into one board.
 *
 * Precedence is by `priority` (lower wins) for the base record — a keyed live
 * feed outranks a keyless one — but a lower-ranked source still fills in fields
 * the winner left empty (scores, minute, odds, venue, kickoff). Sources with
 * genuinely different fixture IDs are all kept, so "wired together" means the
 * board is the union of the feeds, not just the first one that answers.
 */
export function coalesceMatches(
  batches: { provider: SportsProvider; matches: NormalizedMatch[] }[]
): { matches: NormalizedMatch[]; contributed: Map<string, number> } {
  const ordered = [...batches].sort((a, b) => a.provider.priority - b.provider.priority);
  const byKey = new Map<string, NormalizedMatch>();
  const owner = new Map<string, string>();
  const contributed = new Map<string, number>();
  const bump = (id: string) => contributed.set(id, (contributed.get(id) ?? 0) + 1);

  for (const { provider, matches } of ordered) {
    for (const m of matches) {
      const key = fixtureKey(m);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, m);
        owner.set(key, provider.id);
        bump(provider.id);
        continue;
      }

      // Same real fixture from a second source: keep the winner's identity and
      // status, borrow every field it could not supply.
      const preferIncoming =
        provider.priority <
        (ordered.find((b) => b.provider.id === owner.get(key))?.provider.priority ?? 99);
      const winner = preferIncoming ? m : existing;
      const other = preferIncoming ? existing : m;
      byKey.set(key, {
        ...winner,
        homeScore: winner.homeScore ?? other.homeScore,
        awayScore: winner.awayScore ?? other.awayScore,
        minute: winner.minute ?? other.minute,
        kickoff: winner.kickoff ?? other.kickoff,
        venue: winner.venue ?? other.venue,
        country: winner.country ?? other.country,
        oddsHome: winner.oddsHome ?? other.oddsHome,
        oddsDraw: winner.oddsDraw ?? other.oddsDraw,
        oddsAway: winner.oddsAway ?? other.oddsAway,
        // A source with no crests must not blank out one that has them, and the
        // team id is what the head-to-head lookup keys on, so it is worth
        // borrowing across sources too.
        homeLogo: winner.homeLogo ?? other.homeLogo,
        awayLogo: winner.awayLogo ?? other.awayLogo,
        homeTeamId: winner.homeTeamId ?? other.homeTeamId,
        awayTeamId: winner.awayTeamId ?? other.awayTeamId,
        homeForm: winner.homeForm ?? other.homeForm,
        awayForm: winner.awayForm ?? other.awayForm,
        status: winner.status === "SCHEDULED" && other.status !== "SCHEDULED" ? other.status : winner.status,
      });
      if (preferIncoming) owner.set(key, provider.id);
      bump(provider.id);
    }
  }

  return { matches: [...byKey.values()], contributed };
}

/* ------------------------------------------------------------------ */
/* The odds backfill                                                   */
/* ------------------------------------------------------------------ */

/*
 * ESPN is the only keyless source we have that publishes a price, and it only
 * publishes one for the leagues it was asked about. That made the model's market
 * view a function of a hand-written list: a fixture from TheSportsDB or the
 * OpenFootball archive arrived with `oddsHome: null`, `sports-intelligence`
 * priced no edge against it, and the prediction fell back to its own priors with
 * the rationale "No published odds to price an edge against" — the single
 * biggest thing standing between a pick and an opinion about the market.
 *
 * So the list is no longer the whole story. Whatever leagues the other sources
 * actually synced, the ones left unpriced get resolved against ESPN's own live
 * league registry and fetched, and the fixtures are matched back by the same
 * loose identity the merge uses. Coverage then follows the data instead of
 * following our typing.
 *
 * Two rules keep it honest:
 *
 *   1. A price is only ever *copied* from a feed that published it. Where no
 *      keyless source prices a competition — the Egyptian, Ukrainian and Baltic
 *      leagues, which come from the fixture archive and are on no free pricing
 *      feed — the odds stay null and the pick says so. Synthesising a plausible
 *      1.85 would make every "value" figure downstream a fiction.
 *   2. Ambiguity loses. A competition name that matches two registry entries is
 *      not resolved at all: fetching the wrong league costs a request, but
 *      attaching its prices to the wrong fixture would silently corrupt a pick.
 */

interface LeagueEntry {
  slug: string;
  name: string;
}

const LEAGUE_REGISTRY_TTL_MS = 12 * 60 * 60 * 1000;
let leagueRegistry: { at: number; soccer: LeagueEntry[]; basketball: LeagueEntry[] } | null = null;

/** The hand-written lists, shaped as a registry, for when the lookup fails. */
function fallbackRegistry(sport: string): LeagueEntry[] {
  const source = sport === "basketball" ? ESPN_BASKETBALL_LEAGUES : ESPN_SOCCER_LEAGUES;
  return Object.entries(source).map(([slug, name]) => ({ slug, name }));
}

/**
 * ESPN's own list of the leagues it carries — 200-odd of them, with slugs.
 *
 * Asking the provider is what makes the backfill dynamic: our registry names
 * the leagues we fetch every tick, this one names every league we *could* price,
 * including the cups and second tiers that only matter on the day they play.
 * Cached for twelve hours because it changes about once a season, and falls back
 * to the hand-written lists so a lookup failure degrades to today's behaviour
 * rather than to no odds at all.
 */
async function espnLeagueRegistry(sport: string): Promise<LeagueEntry[]> {
  const now = Date.now();
  if (leagueRegistry && now - leagueRegistry.at < LEAGUE_REGISTRY_TTL_MS) {
    return sport === "basketball" ? leagueRegistry.basketball : leagueRegistry.soccer;
  }

  const path = sport === "basketball" ? "basketball" : "soccer";
  try {
    const res = await fetch(
      `https://site.web.api.espn.com/apis/site/v2/leagues/dropdown?sport=${path}&limit=400`,
      { signal: AbortSignal.timeout(6000), cache: "no-store" }
    );
    if (!res.ok) throw new Error(`registry HTTP ${res.status}`);
    const body = (await res.json()) as { leagues?: { slug?: string; name?: string }[] };
    const entries = (body.leagues ?? [])
      .map((l) => ({ slug: (l.slug ?? "").trim(), name: (l.name ?? "").trim() }))
      .filter((l) => l.slug && l.name);
    if (entries.length === 0) throw new Error("registry empty");

    leagueRegistry = {
      at: now,
      soccer: path === "soccer" ? entries : (leagueRegistry?.soccer ?? []),
      basketball: path === "basketball" ? entries : (leagueRegistry?.basketball ?? []),
    };
    return entries;
  } catch (err) {
    log.warn("espn league registry lookup failed", {
      sport,
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackRegistry(sport);
  }
}

/** Words that appear in half the league names and so identify none of them. */
const COMPETITION_STOPWORDS = new Set([
  "the", "of", "de", "da", "do", "league", "liga", "ligue", "football", "soccer",
  "cup", "copa", "coupe", "taca", "pokal", "super", "premier", "division", "championship",
]);

function competitionTokens(name: string): Set<string> {
  const cleaned = (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return new Set(cleaned.split(" ").filter((token) => token && !COMPETITION_STOPWORDS.has(token)));
}

/** How much a provider's competition name looks like a registry entry, 0–1. */
function leagueAffinity(tokens: Set<string>, entryTokens: Set<string>): number {
  if (tokens.size === 0 || entryTokens.size === 0) return 0;
  let shared = 0;
  for (const token of tokens) if (entryTokens.has(token)) shared += 1;
  if (shared === 0) return 0;
  // Jaccard, so "Greek Super League 2" does not swallow "Greek Super League"
  // just because the shorter name is wholly contained in the longer one.
  const union = tokens.size + entryTokens.size - shared;
  return shared / union;
}

const LEAGUE_MATCH_THRESHOLD = 0.6;

/**
 * The single registry entry a competition refers to, or null.
 *
 * `hint` short-circuits the scoring when the fixture already carries an ESPN
 * slug (fixtures mapped by this adapter store one in `competitionId`), which is
 * exact rather than inferred.
 */
function resolveLeague(
  competition: string,
  hint: string | null | undefined,
  registry: LeagueEntry[]
): LeagueEntry | null {
  const direct = hint ? registry.find((entry) => entry.slug === hint) : undefined;
  if (direct) return direct;

  const tokens = competitionTokens(competition);
  if (tokens.size === 0) return null;

  let best: LeagueEntry | null = null;
  let bestScore = 0;
  let runnerUp = 0;
  for (const entry of registry) {
    const score = leagueAffinity(tokens, competitionTokens(entry.name));
    if (score > bestScore) {
      runnerUp = bestScore;
      best = entry;
      bestScore = score;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  if (!best || bestScore < LEAGUE_MATCH_THRESHOLD) return null;
  // A tie is not a match — see rule 2 above.
  if (bestScore - runnerUp < 0.05) return null;
  return best;
}

/**
 * Fill in the prices the merge could not find, for whatever is on the board.
 *
 * Runs after the sources have been coalesced, so it sees the real fixture list
 * and only the leagues it actually contains. Leagues already fetched by the ESPN
 * provider are skipped — their fixtures are priced or genuinely unpriced, and
 * asking again would cost a request to learn nothing.
 */
export async function backfillOdds(
  matches: NormalizedMatch[],
  ctx: { date: Date; sport: string }
): Promise<{ matches: NormalizedMatch[]; priced: number; leagues: string[] }> {
  const unchanged = { matches, priced: 0, leagues: [] as string[] };
  if (matches.length === 0) return unchanged;
  if (ctx.sport !== "football" && ctx.sport !== "basketball") return unchanged;

  const already = new Set(
    Object.keys(ctx.sport === "basketball" ? ESPN_BASKETBALL_LEAGUES : ESPN_SOCCER_LEAGUES)
  );
  const unpriced = matches.filter(
    (m) => m.oddsHome == null || m.oddsDraw == null || m.oddsAway == null
  );
  if (unpriced.length === 0) return unchanged;

  const registry = await espnLeagueRegistry(ctx.sport);
  const wanted = new Map<string, LeagueEntry>();
  for (const match of unpriced) {
    if (already.has(match.competitionId ?? "")) continue;
    const entry = resolveLeague(match.competition, match.competitionId, registry);
    if (entry) wanted.set(entry.slug, entry);
  }
  if (wanted.size === 0) return unchanged;

  const day = espnDay(ctx.date);
  const chosen = [...wanted.values()].slice(0, ODDS_BACKFILL_MAX_LEAGUES);
  const fetched = await mapLimit(chosen, ESPN_FETCH_CONCURRENCY, async (entry) => {
    try {
      return await espnScoreboardCached(entry.slug, ctx.sport, day, 6000);
    } catch (err) {
      log.warn("odds backfill source failed", {
        league: entry.slug,
        error: err instanceof Error ? err.message : String(err),
      });
      return [] as NormalizedMatch[];
    }
  });

  // Two indexes: the fixture's own key (teams + day), and the team pair alone so
  // a kick-off that lands on a different UTC day between providers — a 21:00
  // Buenos Aires kick-off is the next day in UTC — still finds its price.
  const byKey = new Map<string, NormalizedMatch>();
  const byPair = new Map<string, { kickoff: number; match: NormalizedMatch }[]>();
  for (const batch of fetched) {
    for (const priced of batch) {
      if (priced.oddsHome == null && priced.oddsDraw == null && priced.oddsAway == null) continue;
      byKey.set(fixtureKey(priced), priced);
      const pair = `${teamSlug(priced.homeTeam)}|${teamSlug(priced.awayTeam)}`;
      const list = byPair.get(pair) ?? [];
      list.push({ kickoff: priced.kickoff ? new Date(priced.kickoff).getTime() : 0, match: priced });
      byPair.set(pair, list);
    }
  }
  if (byKey.size === 0) return unchanged;

  let priced = 0;
  const next = matches.map((match) => {
    if (match.oddsHome != null && match.oddsDraw != null && match.oddsAway != null) return match;
    let quote = byKey.get(fixtureKey(match));
    if (!quote) {
      const pair = `${teamSlug(match.homeTeam)}|${teamSlug(match.awayTeam)}`;
      const at = match.kickoff ? new Date(match.kickoff).getTime() : 0;
      quote = byPair
        .get(pair)
        ?.slice()
        .sort((a, b) => Math.abs(a.kickoff - at) - Math.abs(b.kickoff - at))
        .find((candidate) => Math.abs(candidate.kickoff - at) <= 36 * 60 * 60 * 1000)?.match;
    }
    if (!quote) return match;
    priced += 1;
    return {
      ...match,
      oddsHome: match.oddsHome ?? quote.oddsHome ?? null,
      oddsDraw: match.oddsDraw ?? quote.oddsDraw ?? null,
      oddsAway: match.oddsAway ?? quote.oddsAway ?? null,
    };
  });

  return { matches: next, priced, leagues: chosen.map((entry) => entry.slug) };
}

/**
 * Fill in prices for the fixtures this feed itself brought in.
 *
 * The ESPN backfill above prices whatever ESPN's registry can name — the FKF
 * Premier League is not on it, which is exactly the league API-Sports exists
 * for. Fixtures whose `externalId` is an API-Sports id (`apisports:<n>`) are
 * priced from API-Sports' own `/odds` endpoint, one call per fixture, capped at
 * `APISPORTS_ODDS_MAX_LOOKUPS` so a busy FKF matchday can never blow the daily
 * budget the whole provider hangs off. Each unpriced fixture is visited at most
 * once; a fixture that already carries a price is left untouched.
 */
async function backfillApiSportsOdds(
  matches: NormalizedMatch[],
  ctx: { date: Date; sport: string }
): Promise<{ matches: NormalizedMatch[]; priced: number; lookups: number }> {
  const unchanged = { matches, priced: 0, lookups: 0 };
  if (matches.length === 0 || !apiSportsConfigured()) return unchanged;
  // The 1X2 market this desk prices is a football concept today.
  if (ctx.sport !== "football") return unchanged;

  const unpriced = matches.filter(
    (m) =>
      m.provider === "apisports" &&
      (m.oddsHome == null || m.oddsDraw == null || m.oddsAway == null)
  );
  if (unpriced.length === 0) return unchanged;

  const next = [...matches];
  const byId = new Map(next.map((m) => [m.externalId, m]));
  let priced = 0;
  let lookups = 0;

  for (const match of unpriced) {
    if (lookups >= APISPORTS_ODDS_MAX_LOOKUPS) break;
    const fixtureId = apiSportsIdFromExternal(match.externalId);
    if (!fixtureId) continue;
    lookups += 1;
    const odds = await apiSportsFixtureOdds(fixtureId).catch(() => null);
    if (!odds || odds.home <= 1 || odds.draw <= 1 || odds.away <= 1) continue;
    const target = byId.get(match.externalId);
    if (!target) continue;
    target.oddsHome = odds.home;
    target.oddsDraw = odds.draw;
    target.oddsAway = odds.away;
    priced += 1;
  }

  return priced > 0 ? { matches: next, priced, lookups } : unchanged;
}

/* ------------------------------------------------------------------ */
/* Pipeline counters                                                   */
/* ------------------------------------------------------------------ */

/*
 * Two numbers the console cannot get from the database.
 *
 * Whether a fixture has a *price* and whether it has a *deep read* are the two
 * things that decide whether a pick is an opinion about the market or a guess,
 * and neither is stored: the odds column says null for a fixture nobody priced
 * and for one that was never looked at. These counters record what the pipeline
 * did this process, so an operator can see the work happening rather than
 * inferring it from an absence — which is the same failure mode as the edge
 * cron that reported nothing in particular.
 */
const pipelineCounters = { oddsBackfilled: 0, deepDataResolved: 0 };

/** What the odds backfill and the deep-data resolver have done this process. */
export function sportsEngineCounters(): { oddsBackfilled: number; deepDataResolved: number } {
  return { ...pipelineCounters };
}

/* ------------------------------------------------------------------ */
/* Resolving a fixture to an ESPN event                                */
/* ------------------------------------------------------------------ */

/*
 * ESPN's summary endpoint is the only keyless source for the deep view — the
 * timeline, the 28 team statistics, the lineups, the play-by-play commentary and
 * the goal coordinates the shot map is drawn from. It addresses a fixture by
 * ESPN's own event id, though, and only fixtures ESPN itself returned carry one.
 * The result was that the match centre's timeline, stats, lineups, momentum and
 * shot map were all blank for every fixture that arrived from TheSportsDB, the
 * OpenFootball archive or football-data.org — which is most of the board — with a
 * note telling the reader that deep data "is only available for fixtures served
 * by ESPN's public feed".
 *
 * It is available for far more than that. ESPN runs a scoreboard for most of the
 * leagues we carry, so a fixture can be *found* rather than merely looked up: the
 * competition gives the league, the league's scoreboard for that day gives the
 * events, and the fixture is matched to one of them by the same loose team-name
 * identity the merge already trusts. That turns a blank match centre into a
 * timeline, live stats and commentary.
 */

/** One league-day of scoreboards, shared by the odds backfill and this resolver. */
const scoreboardCache = new Map<string, { at: number; matches: NormalizedMatch[] }>();
const SCOREBOARD_TTL_MS = 45_000;
const SCOREBOARD_CACHE_MAX = 240;

async function espnScoreboardCached(
  slug: string,
  sport: string,
  day: string,
  timeoutMs = 8000
): Promise<NormalizedMatch[]> {
  const key = `${sport}|${slug}|${day}`;
  const hit = scoreboardCache.get(key);
  if (hit && Date.now() - hit.at < SCOREBOARD_TTL_MS) return hit.matches;

  const matches = await espnScoreboard(slug, sport, day, timeoutMs);
  if (scoreboardCache.size >= SCOREBOARD_CACHE_MAX) {
    // Drop the oldest entry rather than clearing: clearing throws away the
    // leagues the current matchday is actually using.
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [k, v] of scoreboardCache) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey) scoreboardCache.delete(oldestKey);
  }
  scoreboardCache.set(key, { at: Date.now(), matches });
  return matches;
}

const ESPN_EVENT_TTL_MS = 10 * 60 * 1000;
const ESPN_EVENT_CACHE_MAX = 400;
const espnEventCache = new Map<string, { at: number; externalId: string | null }>();

/** `YYYYMMDD` for a provider date, which is what ESPN's `dates` filter wants. */
function espnDay(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Find the ESPN event that corresponds to a fixture from any other source.
 *
 * Returns the ESPN-style external id (`espn:<league>:<eventId>`) so the caller
 * can hand it straight to the same parser the native ESPN fixtures use, or null
 * when the fixture is not on ESPN at all — a lower-league game the archive
 * carries and ESPN does not. Null is a real answer and the UI says so; guessing
 * would attach another match's timeline to this one.
 */
export async function resolveEspnEventId(input: {
  externalId: string;
  homeTeam: string;
  awayTeam: string;
  competition?: string | null;
  competitionId?: string | null;
  kickoff?: Date | string | null;
  sport?: string;
}): Promise<string | null> {
  // A native ESPN fixture already has its id; there is nothing to resolve.
  if (/^espn:[^:]+:/.test(input.externalId)) return input.externalId;

  const sport = input.sport === "basketball" ? "basketball" : "football";
  const path = sport === "basketball" ? "basketball" : "soccer";

  const kickoff = input.kickoff ? new Date(input.kickoff) : null;
  const day = kickoff && !Number.isNaN(kickoff.getTime()) ? espnDay(kickoff) : null;
  const pair = `${teamSlug(input.homeTeam)}|${teamSlug(input.awayTeam)}`;
  if (!pair.replace(/\|/g, "")) return null;

  const registry = await espnLeagueRegistry(sport);
  const entry = resolveLeague(input.competition ?? "", input.competitionId, registry);
  if (!entry) return null;

  const cacheKey = `${entry.slug}|${day ?? "any"}|${pair}`;
  const cached = espnEventCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ESPN_EVENT_TTL_MS) return cached.externalId;

  // One day is the normal case; the neighbours cover a provider that stamps a
  // late kick-off on the following (or previous) UTC day, and a fixture with no
  // kick-off at all falls back to today.
  const days = day
    ? [day, espnDay(new Date(new Date(kickoff!).getTime() - 86_400_000)), espnDay(new Date(new Date(kickoff!).getTime() + 86_400_000))]
    : [espnDay(new Date())];

  let found: string | null = null;
  for (const probe of days) {
    let matches: NormalizedMatch[];
    try {
      matches = await espnScoreboardCached(entry.slug, sport, probe, 6000);
    } catch (err) {
      log.warn("espn event lookup failed", {
        league: entry.slug,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }
    const hits = matches.filter(
      (m) => `${teamSlug(m.homeTeam)}|${teamSlug(m.awayTeam)}` === pair
    );
    if (hits.length === 1) {
      found = hits[0]!.externalId;
      break;
    }
    // Two events on the same day with the same two clubs is a data problem, not
    // a match — take the first day that resolves and stop.
    if (hits.length > 1) break;
  }

  if (espnEventCache.size >= ESPN_EVENT_CACHE_MAX) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [k, v] of espnEventCache) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey) espnEventCache.delete(oldestKey);
  }
  espnEventCache.set(cacheKey, { at: Date.now(), externalId: found });
  if (found) pipelineCounters.deepDataResolved += 1;
  return found;
}

function mapSportsDbEvent(row: unknown, fallbackDay?: string): NormalizedMatch | null {
  const e = row as Record<string, unknown>;
  const home = String(e.strHomeTeam ?? "");
  const away = String(e.strAwayTeam ?? "");
  if (!e.idEvent || (!home && !away)) return null;
  const progress = e.strProgress != null ? String(e.strProgress) : null;
  const status = normalizeSportsDbStatus(String(e.strStatus ?? ""), progress);
  const minute = parseMatchMinute(progress);
  // `eventsday` returns a local date + time instead of a timestamp, so stitch
  // them together rather than parking the kickoff at midnight.
  const kickoff =
    isoOrNull(e.strTimestamp) ??
    (typeof e.strDate === "string" && typeof e.strTime === "string"
      ? isoOrNull(`${e.strDate}T${e.strTime}Z`)
      : fallbackDay
        ? isoOrNull(`${fallbackDay}T12:00:00Z`)
        : null);
  return {
    externalId: String(e.idEvent),
    provider: "sportsdb",
    sport: String(e.strSport ?? "Soccer").toLowerCase() === "basketball" ? "basketball" : "football",
    competition: String(e.strLeague ?? "Unknown competition"),
    competitionId: e.idLeague != null ? String(e.idLeague) : null,
    country: e.strCountry != null ? String(e.strCountry) : null,
    homeTeam: home || "Home",
    awayTeam: away || "Away",
    homeLogo: badgeOf(e, "strHomeTeamBadge", "Home"),
    awayLogo: badgeOf(e, "strAwayTeamBadge", "Away"),
    homeTeamId: e.idHomeTeam != null ? String(e.idHomeTeam) : null,
    awayTeamId: e.idAwayTeam != null ? String(e.idAwayTeam) : null,
    homeScore: toInt(e.intHomeScore),
    awayScore: toInt(e.intAwayScore),
    status,
    minute: minute ?? (status === "FT" ? 90 : null),
    kickoff,
    venue: e.strVenue != null ? String(e.strVenue) : null,
  };
}

/**
 * Read TheSportsDB's crest for one side of a fixture.
 *
 * The field name has drifted across API versions (`strHomeTeamBadge` on
 * `/eventsday`, `strBadge` on `/eventsnextleague`), so fall back rather than
 * losing every badge on one endpoint.
 */
function badgeOf(event: Record<string, unknown>, key: string, side: "Home" | "Away"): string | null {
  const candidates = [event[key], event[`str${side}TeamBadge`]];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate;
  }
  return null;
}

/** ESPN's crest lives at `team.logo` or in a `team.logos[]` array, per competition. */
function espnLogo(side: Record<string, unknown> | undefined): string | null {
  const team = side?.team as Record<string, unknown> | undefined;
  if (!team) return null;
  if (typeof team.logo === "string" && team.logo) return team.logo;
  const logos = team.logos;
  if (Array.isArray(logos)) {
    for (const entry of logos) {
      const href = (entry as Record<string, unknown> | null)?.href;
      if (typeof href === "string" && href) return href;
    }
  }
  return null;
}

/** ESPN team id — the key for its per-team schedule endpoint. */
function espnTeamId(side: Record<string, unknown> | undefined): string | null {
  const team = side?.team as Record<string, unknown> | undefined;
  const id = team?.id;
  return id != null && String(id).length > 0 ? String(id) : null;
}

function isMatch(m: NormalizedMatch | null): m is NormalizedMatch {
  return m !== null;
}

/** Built-in demo feed. Deterministic per (day, hour) so it looks stable while
 *  you click around, but scores/mins progress so the live UI can be exercised
 *  without any credential. Always labelled `provider: "demo"`. */
const demoProvider: SportsProvider = {
  id: DEMO_PROVIDER_ID,
  label: "Demo feed (no credentials)",
  configured: true,
  priority: 99,
  keyless: true,
  supportsDate: true,
  async fetchMatches({ date, sport }) {
    return buildDemoMatches(date, sport);
  },
};

interface DemoTeam {
  name: string;
  competition: string;
  country: string;
}

const DEMO_TEAMS: DemoTeam[] = [
  { name: "Gor Mahia", competition: "FKF Premier League", country: "Kenya" },
  { name: "AFC Leopards", competition: "FKF Premier League", country: "Kenya" },
  { name: "Tusker FC", competition: "FKF Premier League", country: "Kenya" },
  { name: "Bandari FC", competition: "FKF Premier League", country: "Kenya" },
  { name: "KCB", competition: "FKF Premier League", country: "Kenya" },
  { name: "Kariobangi Sharks", competition: "FKF Premier League", country: "Kenya" },
  { name: "Vipers SC", competition: "Uganda Premier League", country: "Uganda" },
  { name: "KCCA", competition: "Uganda Premier League", country: "Uganda" },
  { name: "Simba SC", competition: "Tanzania Premier League", country: "Tanzania" },
  { name: "Young Africans", competition: "Tanzania Premier League", country: "Tanzania" },
  { name: "APR FC", competition: "Rwanda Premier League", country: "Rwanda" },
  { name: "Rayon Sports", competition: "Rwanda Premier League", country: "Rwanda" },
  { name: "Arsenal", competition: "Premier League", country: "England" },
  { name: "Manchester City", competition: "Premier League", country: "England" },
  { name: "Liverpool", competition: "Premier League", country: "England" },
  { name: "Chelsea", competition: "Premier League", country: "England" },
  { name: "Barcelona", competition: "LaLiga", country: "Spain" },
  { name: "Real Madrid", competition: "LaLiga", country: "Spain" },
  { name: "Inter Milan", competition: "Serie A", country: "Italy" },
  { name: "AC Milan", competition: "Serie A", country: "Italy" },
  { name: "Bayern Munich", competition: "Bundesliga", country: "Germany" },
  { name: "Borussia Dortmund", competition: "Bundesliga", country: "Germany" },
];

/** Tiny deterministic PRNG so a given (seed) always yields the same fixture. */
function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDemoMatches(date: Date, sport = "football"): NormalizedMatch[] {
  const dayKey = date.toISOString().slice(0, 10);
  const now = date.getTime();
  const matches: NormalizedMatch[] = [];

  // Kickoff slots across the day (Africa/Nairobi friendly).
  const slots = [9, 12, 14, 16, 18, 20];
  const competitonPools = new Map<string, DemoTeam[]>();
  for (const team of DEMO_TEAMS) {
    const list = competitonPools.get(team.competition) ?? [];
    list.push(team);
    competitonPools.set(team.competition, list);
  }

  let n = 0;
  for (const [competition, teams] of competitonPools) {
    const rnd = mulberry(hashSeed(`${dayKey}:${competition}`));
    const picks = [...teams].sort(() => rnd() - 0.5).slice(0, Math.min(4, teams.length));
    for (let i = 0; i + 1 < picks.length; i += 2) {
      const home = picks[i];
      const away = picks[i + 1];
      if (!home || !away) continue;
      const kickoffHour = slots[n % slots.length] ?? 16;
      const kickoff = new Date(`${dayKey}T${String(kickoffHour).padStart(2, "0")}:00:00.000Z`);
      const elapsedMin = Math.floor((now - kickoff.getTime()) / 60_000);
      const score = mulberry(hashSeed(`${dayKey}:${home.name}:${away.name}`));
      const goals = () => {
        const r = score();
        return r > 0.82 ? 3 : r > 0.62 ? 2 : r > 0.34 ? 1 : 0;
      };

      let status: MatchStatus = "SCHEDULED";
      let minute: number | null = null;
      let homeScore: number | null = null;
      let awayScore: number | null = null;

      if (elapsedMin > 0 && elapsedMin < 105) {
        status = elapsedMin > 45 && elapsedMin < 60 ? "HT" : "LIVE";
        minute = Math.max(1, Math.min(90, elapsedMin > 45 ? elapsedMin - 15 : elapsedMin));
        const factor = status === "HT" ? 0.5 : minute / 90;
        homeScore = Math.round(goals() * factor);
        awayScore = Math.round(goals() * factor);
      } else if (elapsedMin >= 105) {
        status = "FT";
        minute = 90;
        homeScore = goals();
        awayScore = goals();
      }

      const odds = mulberry(hashSeed(`odds:${dayKey}:${home.name}:${away.name}`));
      matches.push({
        externalId: `demo-${dayKey}-${home.name}-${away.name}`.replace(/\s+/g, "_"),
        provider: DEMO_PROVIDER_ID,
        sport,
        competition,
        competitionId: `demo-${competition.toLowerCase().replace(/\s+/g, "-")}`,
        country: home.country,
        homeTeam: home.name,
        awayTeam: away.name,
        homeScore,
        awayScore,
        status,
        minute,
        kickoff: kickoff.toISOString(),
        venue: `${home.name} Stadium`,
        oddsHome: status === "SCHEDULED" ? round2(1.6 + odds() * 2.2) : null,
        oddsDraw: status === "SCHEDULED" ? round2(2.8 + odds() * 1.8) : null,
        oddsAway: status === "SCHEDULED" ? round2(1.7 + odds() * 2.6) : null,
      });
      n++;
    }
  }

  return matches;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Provider registry                                                   */
/* ------------------------------------------------------------------ */

const PROVIDERS: SportsProvider[] = [
  // The credentialed feed, and the only source that carries the FKF Premier
  // League with live minutes + basketball in one shape — first in the array so
  // it wins the priority-1 tie with football-data.
  apiSportsProvider,
  footballDataProvider,
  sportsDbProvider,
  espnProvider,
  openLigaProvider,
  // Fixture archive, ranked last on purpose: it can add scheduled fixtures no
  // live feed carries, but never overrides one (see sports-openfootball.ts).
  openFootballProvider,
  demoProvider,
];

/** Set by the most recent hub build so the admin console can show what ran. */
let lastSourceReport: SportsSourceReport[] = [];

export function lastSportsSources(): SportsSourceReport[] {
  return lastSourceReport;
}

export function selectedProvider(): SportsProvider {
  const id = resolveProviderId();
  const found = PROVIDERS.find((p) => p.id === id);
  if (found && (found.configured || found.id === DEMO_PROVIDER_ID)) return found;
  // Requested provider isn't configured — degrade to demo rather than empty.
  return demoProvider;
}

/**
 * The sources that actually run, in precedence order.
 *
 * A single export is what gives the keyless tier its value: when no key is set
 * the hub still shows real football from TheSportsDB/ESPN/OpenLigaDB instead of
 * synthetic fixtures. "auto" means "everything that is configured, best first",
 * and an explicit SPORTS_PROVIDER pins the list to that one source.
 */
export function providerChain(): SportsProvider[] {
  const explicit = SPORTS_PROVIDER_ID && SPORTS_PROVIDER_ID !== "auto";
  const enabled = PROVIDERS.filter((p) => {
    if (p.id === DEMO_PROVIDER_ID) return false;
    if (!p.configured) return false;
    if (p.keyless && !SPORTS_KEYLESS_ENABLED) return false;
    return true;
  }).sort((a, b) => a.priority - b.priority);

  if (explicit) {
    const pinned = enabled.filter((p) => p.id === SPORTS_PROVIDER_ID);
    return pinned.length > 0 ? pinned : [demoProvider];
  }
  return enabled.length > 0 ? enabled : [demoProvider];
}

export function providerInfo(): ProviderInfo[] {
  const chain = providerChain().map((p) => p.id);
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.configured,
    selected: chain.includes(p.id),
    keyless: p.keyless,
    active: lastSourceReport.find((r) => r.id === p.id)?.ok ?? false,
    contributed: lastSourceReport.find((r) => r.id === p.id)?.contributed ?? 0,
    hint:
      p.id === "apisports"
        ? "API-Sports key (APISPORTS_API_KEY) — FKF Premier League, live minutes and basketball; budget-governed at 100 calls/day on the Free plan."
        : p.id === "football-data"
          ? "Set SPORTS_API_KEY to a free football-data.org token (highest priority when present)."
          : p.id === "sportsdb"
            ? "Works with the public key; set SPORTSDB_API_KEY for a patron key and more coverage."
            : p.id === "espn"
              ? "Keyless ESPN scoreboard — live state and odds for the big leagues."
              : p.id === "openligadb"
                ? "Keyless German-league feed, used as a second opinion on Bundesliga days."
                : p.id === "openfootball"
                  ? "Keyless public-domain fixture archive — fills in scheduled fixtures for the weeks ahead, never results."
                  : "Zero-config fallback used only when every live source fails.",
  }));
}

/* ------------------------------------------------------------------ */
/* Fetch + persist                                                     */
/* ------------------------------------------------------------------ */

export interface SportsHubSnapshot {
  generatedAt: string;
  provider: string;
  providerLabel: string;
  demo: boolean;
  date: string;
  sport: string;
  liveCount: number;
  /** Every source that contributed a fixture to this snapshot. */
  sources: string[];
  /** True when the snapshot came from the database after every live source failed. */
  stale: boolean;
  matches: NormalizedMatch[];
  competitions: {
    name: string;
    country: string | null;
    live: number;
    total: number;
    /** 0 = regional, 1 = big league, 2 = other top flight, 3 = the long tail. */
    relevance?: number;
  }[];
}

function cacheKey(date: Date, sport: string): string {
  return `sports:live:${sport}:${date.toISOString().slice(0, 10)}`;
}

function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * In-process fan-out dedupe. Two visitors hitting a cold board, the 15s poll and
 * the admin console all ask for the same key within milliseconds; sharing one
 * promise means one upstream call instead of five (which is how a free provider
 * gets rate-limited into an empty board).
 */
const inflight = new Map<string, Promise<SportsHubSnapshot>>();

/**
 * Upsert a normalised snapshot into Postgres (bounded, best-effort).
 *
 * TWO, not Promise.all over the whole board. The pooler connection limit is 5,
 * and a 178-fixture fan-out firing 178 upserts at once starves every other
 * request on the instance — the scoreboard itself then times out waiting for a
 * connection. Persistence is a background nicety; it must never outrank a page.
 */
const PERSIST_CONCURRENCY = 2;
/** Only the fixtures that matter are mirrored to Postgres on a read. */
const PERSIST_MAX = 60;
let persistChain: Promise<void> = Promise.resolve();

function persistMatches(matches: NormalizedMatch[]): Promise<void> {
  if (matches.length === 0) return Promise.resolve();
  const batch = matches.slice(0, PERSIST_MAX);
  // Serialise whole batches too: two visitors refreshing at once must not each
  // start their own write.
  const run = persistChain.then(() => persistMatchesNow(batch)).catch(() => {});
  persistChain = run.catch(() => {});
  return run;
}

async function persistMatchesNow(matches: NormalizedMatch[]): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(PERSIST_CONCURRENCY, matches.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= matches.length) return;
      const m = matches[index]!;
      {
        const data = {
          provider: m.provider,
          sport: m.sport,
          competition: m.competition,
          competitionId: m.competitionId ?? null,
          country: m.country ?? null,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          status: m.status,
          minute: m.minute,
          kickoff: m.kickoff ? new Date(m.kickoff) : null,
          venue: m.venue ?? null,
          oddsHome: m.oddsHome ?? null,
          oddsDraw: m.oddsDraw ?? null,
          oddsAway: m.oddsAway ?? null,
          providerUpdatedAt: new Date(),
          lastSyncedAt: new Date(),
        };
        await prisma.sportsMatch
          .upsert({
            where: { provider_externalId: { provider: m.provider, externalId: m.externalId } },
            create: { externalId: m.externalId, ...data },
            update: data,
          })
          .catch(() => null);
      }
    }
  });
  await Promise.all(workers);
}

function fromDbRow(row: {
  externalId: string;
  provider: string;
  sport: string;
  competition: string;
  competitionId: string | null;
  country: string | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  minute: number | null;
  kickoff: Date | null;
  venue: string | null;
  oddsHome: number | null;
  oddsDraw: number | null;
  oddsAway: number | null;
}): NormalizedMatch {
  return {
    externalId: row.externalId,
    provider: row.provider,
    sport: row.sport,
    competition: row.competition,
    competitionId: row.competitionId,
    country: row.country,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    status: (row.status as MatchStatus) ?? "SCHEDULED",
    minute: row.minute,
    kickoff: row.kickoff ? row.kickoff.toISOString() : null,
    venue: row.venue,
    oddsHome: row.oddsHome,
    oddsDraw: row.oddsDraw,
    oddsAway: row.oddsAway,
    // Crests and team ids are provider-only: they are not persisted, so the
    // database-fallback path legitimately has none. The UI renders a monogram
    // badge in that case rather than a broken image.
    homeLogo: null,
    awayLogo: null,
    homeTeamId: null,
    awayTeamId: null,
  };
}

/**
 * Live + today's fixtures for a sport, grouped by competition. Serves a cached
 * snapshot for `SPORTS_CACHE_TTL` seconds, refreshes from the provider, persists
 * what it saw, and degrades to the database (then the demo feed) on any error.
 */
export async function getSportsHub(opts: {
  date?: Date;
  sport?: string;
  fresh?: boolean;
  /** Set false for jobs that write the fixtures themselves (the live sweep). */
  persist?: boolean;
} = {}): Promise<SportsHubSnapshot> {
  const date = opts.date ?? new Date();
  const sport = opts.sport ?? "football";
  const key = cacheKey(date, sport);
  const isToday = dayKeyOf(date) === dayKeyOf(new Date());
  // Live boards go stale in seconds; a future or past matchday barely changes.
  const ttl = isToday ? SPORTS_CACHE_TTL : SPORTS_DAY_CACHE_TTL;

  if (!opts.fresh) {
    const cached = await cacheGet<SportsHubSnapshot>(key).catch(() => null);
    if (cached) return cached;
    const shared = inflight.get(key);
    if (shared) return shared;
  }

  const task = fetchHubSnapshot({ date, sport, isToday, key, ttl, persist: opts.persist !== false }).finally(
    () => inflight.delete(key)
  );
  inflight.set(key, task);
  return task;
}

async function fetchHubSnapshot(ctx: {
  date: Date;
  sport: string;
  isToday: boolean;
  key: string;
  ttl: number;
  persist: boolean;
}): Promise<SportsHubSnapshot> {
  const { date, sport, isToday, key, ttl } = ctx;
  const chain = providerChain().filter((p) => p.supportsDate || isToday);
  const sources = chain.length > 0 ? chain : [demoProvider];

  const settled = await Promise.allSettled(
    sources.map(async (provider) => {
      const startedAt = Date.now();
      const matches = await provider.fetchMatches({ date, sport });
      return { provider, matches, elapsedMs: Date.now() - startedAt };
    })
  );

  const batches: { provider: SportsProvider; matches: NormalizedMatch[] }[] = [];
  const report: SportsSourceReport[] = [];
  settled.forEach((result, index) => {
    const provider = sources[index]!;
    if (result.status === "fulfilled") {
      batches.push({ provider, matches: result.value.matches });
      report.push({
        id: provider.id,
        label: provider.label,
        ok: result.value.matches.length > 0,
        matches: result.value.matches.length,
        contributed: 0,
        elapsedMs: result.value.elapsedMs,
      });
    } else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      log.warn("sports source failed", { provider: provider.id, error: message });
      report.push({ id: provider.id, label: provider.label, ok: false, matches: 0, contributed: 0, elapsedMs: 0, error: message.slice(0, 160) });
    }
  });

  const coalesced = coalesceMatches(batches);
  for (const row of report) row.contributed = coalesced.contributed.get(row.id) ?? 0;
  lastSourceReport = report;

  // Price whatever the merge could not. Without this the model only ever sees a
  // market for the leagues ESPN was hand-listed for, and every other fixture is
  // predicted with its back to the prices (see the odds backfill section).
  let matches = coalesced.matches;
  try {
    const odds = await backfillOdds(matches, { date, sport });
    if (odds.priced > 0) {
      matches = odds.matches;
      pipelineCounters.oddsBackfilled += odds.priced;
      log.info("odds backfilled", { sport, priced: odds.priced, leagues: odds.leagues });
      const espnRow = report.find((r) => r.id === "espn");
      if (espnRow) espnRow.contributed += odds.priced;
    }
  } catch (err) {
    // A missing price is a degraded model, never a broken page.
    log.warn("odds backfill failed", {
      sport,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  // The merge's ESPN backfill cannot price what this feed alone carries — the
  // FKF Premier League is not on ESPN's registry — so fixtures API-Sports
  // brought in get their prices from API-Sports' own /odds endpoint, capped by
  // the same daily budget that governs everything else in that module.
  try {
    const apiPrices = await backfillApiSportsOdds(matches, { date, sport });
    if (apiPrices.priced > 0) {
      matches = apiPrices.matches;
      pipelineCounters.oddsBackfilled += apiPrices.priced;
      log.info("api-sports odds backfilled", {
        sport,
        priced: apiPrices.priced,
        lookups: apiPrices.lookups,
      });
      const apiRow = report.find((r) => r.id === "apisports");
      if (apiRow) apiRow.contributed += apiPrices.priced;
    }
  } catch (err) {
    // A missing price is a degraded model, never a broken page.
    log.warn("api-sports odds backfill failed", {
      sport,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  let usedProvider =
    sources.find((p) => matches.some((m) => m.provider === p.id))?.id ?? sources[0]?.id ?? DEMO_PROVIDER_ID;
  let stale = false;

  if (matches.length > 0) {
    if (ctx.persist) void persistMatches(matches).catch(() => {});
  } else {
    // Every live source failed or is quiet — serve the last good snapshot from
    // the database rather than an empty screen, and mark it stale so the UI can
    // say so instead of implying the scores are current.
    const rows = await prisma.sportsMatch
      .findMany({
        where: {
          sport,
          kickoff: {
            gte: new Date(date.getTime() - 12 * 3_600_000),
            lte: new Date(date.getTime() + 36 * 3_600_000),
          },
        },
        orderBy: { kickoff: "asc" },
        take: 200,
      })
      .catch(() => []);
    if (rows.length > 0) {
      matches = rows.map(fromDbRow);
      usedProvider = rows[0]?.provider ?? usedProvider;
      stale = true;
    }
  }

  if (matches.length === 0 && sources.every((p) => p.id === DEMO_PROVIDER_ID)) {
    // Only synthesise fixtures when the demo provider is the only source — a
    // real provider having a quiet day must render an honest empty state, never
    // invented matches wearing a live badge.
    matches = buildDemoMatches(date, sport);
    usedProvider = DEMO_PROVIDER_ID;
  }

  const snapshot = buildSnapshot(matches, {
    date,
    sport,
    provider: usedProvider,
    ok: true,
    sources: [...new Set(matches.map((m) => m.provider))],
    stale,
  });
  await cacheSet(key, snapshot, ttl).catch(() => {});
  return snapshot;
}

function buildSnapshot(
  matches: NormalizedMatch[],
  ctx: { date: Date; sport: string; provider: string; ok: boolean; sources?: string[]; stale?: boolean }
): SportsHubSnapshot {
  const byComp = new Map<
    string,
    { name: string; country: string | null; live: number; total: number; relevance: number }
  >();
  for (const m of matches) {
    const entry = byComp.get(m.competition) ?? {
      name: m.competition,
      country: m.country ?? null,
      live: 0,
      total: 0,
      relevance: competitionRelevance(m.competition, m.country),
    };
    entry.total += 1;
    if (LIVE_STATUSES.includes(m.status)) entry.live += 1;
    byComp.set(m.competition, entry);
  }

  return {
    generatedAt: new Date().toISOString(),
    provider: ctx.provider,
    providerLabel: PROVIDERS.find((p) => p.id === ctx.provider)?.label ?? ctx.provider,
    demo: ctx.provider === DEMO_PROVIDER_ID,
    date: ctx.date.toISOString().slice(0, 10),
    sport: ctx.sport,
    liveCount: matches.filter((m) => LIVE_STATUSES.includes(m.status)).length,
    sources: ctx.sources ?? [ctx.provider],
    stale: ctx.stale ?? false,
    matches: sortByRelevance(matches),
    competitions: [...byComp.values()].sort(
      (a, b) => a.relevance - b.relevance || b.live - a.live || a.name.localeCompare(b.name)
    ),
  };
}

/** Matches for one competition on a day — used by the per-competition tabs. */
export function filterByCompetition(
  matches: NormalizedMatch[],
  competition: string | null
): NormalizedMatch[] {
  if (!competition) return matches;
  return matches.filter((m) => m.competition === competition);
}

/** A single stored match plus its freshest prediction, for the analysis panel. */
export async function getMatchWithPrediction(matchId: string) {
  return prisma.sportsMatch
    .findUnique({
      where: { id: matchId },
      include: { predictions: { orderBy: { createdAt: "desc" }, take: 1 } },
    })
    .catch(() => null);
}

/* ------------------------------------------------------------------ */
/* Betting partner referrals                                           */
/* ------------------------------------------------------------------ */

export const REFERRAL_PLACEMENTS = [
  "sports-hero",
  "sports-inline",
  "sports-sidebar",
  "sports-footer",
] as const;

export type ReferralPlacement = (typeof REFERRAL_PLACEMENTS)[number];

export const REFERRAL_PLACEMENT_LABELS: Record<string, string> = {
  "sports-hero": "Sports — hero banner",
  "sports-inline": "Sports — inline between fixtures",
  "sports-sidebar": "Sports — sidebar rail",
  "sports-footer": "Sports — page footer",
};

export interface ReferralOffer {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  referralCode: string | null;
  bonus: string | null;
  description: string | null;
  logoUrl: string | null;
  placement: string;
  ctaText: string;
  weight: number;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Build the tracked destination URL. The referral code lives in the database,
 * never in page markup, and `{match}` lets a partner link deep-link to the
 * fixture the visitor was reading.
 */
export function buildReferralUrl(
  offer: { urlTemplate: string; referralCode: string | null },
  matchId?: string | null
): string {
  return offer.urlTemplate
    .replace(/\{code\}/g, encodeURIComponent(offer.referralCode ?? ""))
    .replace(/\{match\}/g, encodeURIComponent(matchId ?? ""))
    .replace(/\{region\}/g, encodeURIComponent(SPORTS_REGION));
}

export async function listReferralOffers(placement?: string): Promise<ReferralOffer[]> {
  const now = new Date();
  const cacheKeyName = `sports:referrals:${placement ?? "all"}`;
  const cached = await cacheGet<ReferralOffer[]>(cacheKeyName).catch(() => null);
  if (cached) return cached;

  const rows = await prisma.bettingReferral
    .findMany({
      where: {
        isActive: true,
        ...(placement ? { placement } : {}),
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ weight: "desc" }, { createdAt: "desc" }],
      take: 12,
      select: {
        id: true,
        name: true,
        slug: true,
        region: true,
        referralCode: true,
        bonus: true,
        description: true,
        logoUrl: true,
        placement: true,
        ctaText: true,
        weight: true,
      },
    })
    .catch(() => [] as ReferralOffer[]);

  await cacheSet(cacheKeyName, rows, 60).catch(() => {});
  return rows;
}

export async function getReferralBySlug(slug: string) {
  return prisma.bettingReferral.findUnique({ where: { slug } }).catch(() => null);
}

/** Counters are fire-and-forget; the activity ledger keeps the time series. */
export function recordReferralEvent(
  referralId: string,
  type: "referral_impression" | "referral_click",
  meta: { matchId?: string | null; userId?: string | null; visitorHash?: string | null } = {}
): void {
  void prisma.bettingReferral
    .update({
      where: { id: referralId },
      data: type === "referral_click" ? { clicks: { increment: 1 } } : { impressions: { increment: 1 } },
    })
    .catch(() => {});
  void prisma.sportsActivity
    .create({
      data: {
        type,
        referralId,
        matchId: meta.matchId ?? null,
        userId: meta.userId ?? null,
        visitorHash: meta.visitorHash ?? null,
      },
    })
    .catch(() => {});
}

export function recordMatchView(meta: {
  matchId?: string | null;
  predictionId?: string | null;
  userId?: string | null;
  visitorHash?: string | null;
  type?: "match_view" | "prediction_view";
}): void {
  void prisma.sportsActivity
    .create({
      data: {
        type: meta.type ?? "match_view",
        matchId: meta.matchId ?? null,
        predictionId: meta.predictionId ?? null,
        userId: meta.userId ?? null,
        visitorHash: meta.visitorHash ?? null,
      },
    })
    .catch(() => {});
}

/**
 * How much of today's board the model can actually see, per competition.
 *
 * This is the console's answer to a question the aggregates cannot answer:
 * `matches` and `predictions` both count fine while every pick on the board is
 * being made without a price to compare against. A competition with fixtures and
 * no prices is where the model is flying blind, and naming those competitions is
 * what turns "coverage is 40%" into something an operator can act on.
 */
export interface SportsCoverage {
  from: string;
  to: string;
  matches: number;
  /** All three legs of a 1X2 price present — the pick can see the market. */
  priced: number;
  partial: number;
  unpriced: number;
  /** Fixtures ESPN itself returned, so the deep read needs no lookup. */
  nativeDeepData: number;
  unpricedCompetitions: { competition: string; matches: number }[];
}

export async function sportsCoverage(): Promise<SportsCoverage> {
  const from = new Date(Date.now() - 12 * 3_600_000);
  const to = new Date(Date.now() + 36 * 3_600_000);

  const rows = await prisma.sportsMatch
    .findMany({
      where: {
        kickoff: { gte: from, lte: to },
        sport: "football",
      },
      select: { competition: true, provider: true, oddsHome: true, oddsDraw: true, oddsAway: true },
      take: 2000,
    })
    .catch(() => []);

  let priced = 0;
  let partial = 0;
  let unpriced = 0;
  let nativeDeepData = 0;
  const blind = new Map<string, number>();
  for (const row of rows) {
    const legs = [row.oddsHome, row.oddsDraw, row.oddsAway].filter((v) => v != null).length;
    if (legs === 3) priced += 1;
    else if (legs === 0) unpriced += 1;
    else partial += 1;
    if (legs < 3) blind.set(row.competition, (blind.get(row.competition) ?? 0) + 1);
    if (row.provider === "espn") nativeDeepData += 1;
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    matches: rows.length,
    priced,
    partial,
    unpriced,
    nativeDeepData,
    unpricedCompetitions: [...blind.entries()]
      .map(([competition, matches]) => ({ competition, matches }))
      .sort((a, b) => b.matches - a.matches)
      .slice(0, 12),
  };
}

export async function getSportsStats(): Promise<{
  matches: number;
  live: number;
  predictions: number;
  pending: number;
  settled: number;
  won: number;
  lost: number;
  accuracy: number | null;
  referralImpressions: number;
  referralClicks: number;
  activity: Record<string, number>;
}> {
  const [matches, live, predictions, pending, settled, won, lost, referrals, activity] =
    await Promise.all([
      prisma.sportsMatch.count().catch(() => 0),
      prisma.sportsMatch.count({ where: { status: { in: LIVE_STATUSES } } }).catch(() => 0),
      // Stats track the published model only; the market baseline has its own
      // comparison on the accuracy dashboard.
      prisma.sportsPrediction.count({ where: { model: "hive-hybrid" } }).catch(() => 0),
      prisma.sportsPrediction.count({ where: { status: "PENDING", model: "hive-hybrid" } }).catch(() => 0),
      prisma.sportsPrediction.count({ where: { status: { in: ["WON", "LOST"] }, model: "hive-hybrid" } }).catch(() => 0),
      prisma.sportsPrediction.count({ where: { status: "WON", model: "hive-hybrid" } }).catch(() => 0),
      prisma.sportsPrediction.count({ where: { status: "LOST", model: "hive-hybrid" } }).catch(() => 0),
      prisma.bettingReferral
        .aggregate({ _sum: { impressions: true, clicks: true } })
        .catch(() => null),
      prisma.sportsActivity
        .groupBy({ by: ["type"], _count: { _all: true } })
        .catch(() => [] as { type: string; _count: { _all: number } }[]),
    ]);

  return {
    matches,
    live,
    predictions,
    pending,
    settled,
    won,
    lost,
    accuracy: settled > 0 ? Math.round((won / settled) * 1000) / 10 : null,
    referralImpressions: referrals?._sum.impressions ?? 0,
    referralClicks: referrals?._sum.clicks ?? 0,
    activity: Object.fromEntries(activity.map((a) => [a.type, a._count._all])),
  };
}
