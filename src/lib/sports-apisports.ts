/**
 * API-Sports — the credentialed feed, and the first source on this desk that
 * carries the audience's own league.
 *
 * ## Why it is here
 *
 * Every other source in the chain was chosen for coverage; this one changes what
 * the desk can say. Its football API carries the **FKF Premier League** (league
 * 276) with live minutes, venues, team ids and crests — the Kenyan top flight
 * that the keyless feeds either omit entirely or carry as a bare name and a
 * kick-off. For an East African audience that is the difference between a desk
 * that knows about the Premier League and one that knows about *their* league.
 *
 * ## What governs the design: 100 calls a day
 *
 * The account on this key is the **Free plan: 100 requests per day**. That
 * budget is small enough to be spent by accident — one page render fanning out to four
 * endpoints, a livescore strip polling every few seconds, an admin console
 * refresh — and a spent budget is not a slow board, it is an *empty* one. So the
 * three rules below are the module, and the API is what hangs off them:
 *
 *  1. **One call answers a whole day.** `fixtures?date=` returns every league's
 *     fixtures for that day — including the live ones, with their current minute
 *     and score — so refreshing the board costs one request, not one per league
 *     or one per live match. (`live=all`, the tempting endpoint, would cost the
 *     same and answer a strictly smaller question.)
 *  2. **Cache in front of it, with in-flight de-duplication.** The board, the
 *     live strip and the match centre all read the same cached day; a cold cache
 *     with three concurrent readers still makes ONE upstream call, because the
 *     promise is shared rather than the result.
 *  3. **A governor that stops before the wall.** Every call is counted against
 *     the UTC day, in Redis (atomically) with a per-process
 *     fallback, and the provider refuses to make the call that would cross
 *     `APISPORTS_DAY_BUDGET` — default 90, leaving a tenth of the day as
 *     headroom for a manual look-up that would otherwise be the one that fails.
 *     Past the budget the cached day is still served, so the board degrades to
 *     "slightly stale" instead of going blank.
 *
 * The budget is also why odds are fetched only where they are *worth* a call:
 * per fixture, for fixtures this feed itself brought in and the merge could not
 * price (see `apiSportsFixtureOdds` and the backfill in sports.ts). Asking for a
 * whole day of prices would be the single most expensive thing this module could
 * do, and the big leagues are already priced by the keyless feeds.
 */

import { cacheGet, cacheSet, cacheIncr } from "@/lib/redis";
import { createLogger } from "@/lib/logger";
import { isFootballScope } from "@/lib/sports-scope";
import type { MatchStatus, NormalizedMatch, SportsProvider } from "@/lib/sports";

const log = createLogger("sports-apisports");

const env = (name: string): string => (process.env[name] ?? "").trim();

function clampInt(raw: number, min: number, max: number): number {
  if (!Number.isFinite(raw)) return min;
  return Math.min(Math.max(Math.trunc(raw), min), max);
}

export const APISPORTS_API_KEY = env("APISPORTS_API_KEY");
/** Kill switch, for a day when the quota must be saved for something else. */
export const APISPORTS_DISABLED = (env("APISPORTS_DISABLED") || "").toLowerCase() === "on";
export const APISPORTS_DAY_BUDGET = clampInt(Number(env("APISPORTS_DAY_BUDGET") || 90), 1, 100);
/** Today's board is live, so it is cached briefly; other days move slowly. */
export const APISPORTS_LIVE_TTL = clampInt(Number(env("APISPORTS_CACHE_TTL_SECONDS") || 60), 15, 600);
export const APISPORTS_DAY_TTL = clampInt(Number(env("APISPORTS_DAY_CACHE_TTL_SECONDS") || 900), 60, 3600);
export const APISPORTS_ODDS_TTL = clampInt(Number(env("APISPORTS_ODDS_TTL_SECONDS") || 21_600), 600, 86_400);
/** The free plan allows ~10 requests a minute; this keeps a burst under it. */
export const APISPORTS_MIN_INTERVAL_MS = clampInt(Number(env("APISPORTS_MIN_INTERVAL_MS") || 15_000), 0, 60_000);
/** How many unpriced fixtures one hub build may spend on odds. */
export const APISPORTS_ODDS_MAX_LOOKUPS = clampInt(Number(env("APISPORTS_ODDS_MAX_LOOKUPS") || 12), 0, 40);

export const apisportsConfigured = (): boolean => APISPORTS_API_KEY.length > 0 && !APISPORTS_DISABLED;

/**
 * One product, one base URL.
 *
 * This used to be a `Product` union with a base per sport, and the second entry
 * was basketball's. The desk serves football, so the union is gone: a request can
 * no longer name a product the app does not cover, which removes a whole class of
 * "fetched the wrong thing" bug along with the dead branch that would have run it.
 */
const BASE_URL = "https://v3.football.api-sports.io";

/* ══════════════════════════════════════════════════════════════════════════
   The quota governor
   ══════════════════════════════════════════════════════════════════════════ */

/** `2026-09-14` — the API counts its own limits on the UTC day. */
function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function quotaKey(day: string): string {
  return `sports:apisports:calls:football:${day}`;
}

/**
 * Counts kept in-process when Redis is absent.
 *
 * `cacheIncr` returns 0 when there is no Redis (and in the repo's deployment
 * there always is), so a local dev box, a preview deploy without Redis, or a
 * Redis outage would otherwise count nothing — and the way you find out is the
 * quota being gone. The in-process counter is the second opinion; whichever of
 * the two is higher is what the budget is measured against.
 */
const memoryCalls = new Map<string, number>();
let quotaTrackedInRedis = true;

/** Whether the quota is being counted in Redis (authoritative) or in-process. */
export function apiSportsQuotaBackend(): "redis" | "process" {
  return quotaTrackedInRedis ? "redis" : "process";
}

/**
 * Spend one call from today's budget. Returns false when the budget is gone —
 * the caller then serves what it has rather than making the request.
 */
async function spendCall(): Promise<boolean> {
  const day = utcDay();
  const key = quotaKey(day);
  const counted = await cacheIncr(key, 26 * 60 * 60).catch(() => 0);

  let used: number;
  if (counted > 0) {
    quotaTrackedInRedis = true;
    used = counted;
  } else {
    // No Redis: keep counting locally so a single process still respects the
    // budget instead of having no idea how much of the day is gone.
    quotaTrackedInRedis = false;
    used = (memoryCalls.get(key) ?? 0) + 1;
    memoryCalls.set(key, used);
  }

  if (used > APISPORTS_DAY_BUDGET) {
    log.warn("api-sports daily budget reached — serving cache only", {
      used,
      budget: APISPORTS_DAY_BUDGET,
    });
    return false;
  }
  return true;
}

/** Today's usage without spending anything — what the console reads. */
async function usedToday(): Promise<number> {
  const key = quotaKey(utcDay());
  const counted = await cacheGet<number>(key).catch(() => null);
  const fromRedis = typeof counted === "number" && Number.isFinite(counted) ? counted : 0;
  return Math.max(fromRedis, memoryCalls.get(key) ?? 0);
}

export interface ApiSportsProductQuota {
  /** Always football. Kept in the payload so a console can label the row. */
  product: "football";
  used: number;
  budget: number;
  remaining: number;
  exhausted: boolean;
}

export interface ApiSportsState {
  configured: boolean;
  disabled: boolean;
  /** From the account itself (`/status`), not from configuration. */
  plan: string | null;
  subscriptionEnds: string | null;
  /** The provider's own daily ceiling — 100 on the Free plan. */
  limitDay: number | null;
  /** What the API says it has served today, across every consumer of the key. */
  apiUsedToday: number | null;
  products: ApiSportsProductQuota[];
  /** How this app's own counter is kept. */
  trackedIn: "redis" | "process";
  error?: string;
}

/**
 * Everything the console needs to answer "is this feed healthy, and how much of
 * today is left?".
 *
 * The `/status` call is itself a request, so it is cached for six hours: an
 * operator refreshing the console must not be able to spend the quota they are
 * trying to inspect.
 */
export async function apiSportsState(): Promise<ApiSportsState> {
  const used = await usedToday();

  // A one-row array rather than a scalar: the console renders "the products"
  // and a shape that stops being a list is a shape that stops rendering.
  const quotas: ApiSportsProductQuota[] = [
    {
      product: "football",
      used,
      budget: APISPORTS_DAY_BUDGET,
      remaining: Math.max(0, APISPORTS_DAY_BUDGET - used),
      exhausted: used >= APISPORTS_DAY_BUDGET,
    },
  ];

  if (!apisportsConfigured()) {
    return {
      configured: false,
      disabled: APISPORTS_DISABLED,
      plan: null,
      subscriptionEnds: null,
      limitDay: null,
      apiUsedToday: null,
      products: quotas,
      trackedIn: apiSportsQuotaBackend(),
    };
  }

  const status = await apiSportsGet<ApiStatusResponse>("status", 6 * 60 * 60).catch(() => null);
  const account = status?.subscription;
  const requests = status?.requests;

  return {
    configured: true,
    disabled: false,
    plan: account?.plan ?? null,
    subscriptionEnds: account?.end ?? null,
    limitDay: typeof requests?.limit_day === "number" ? requests.limit_day : null,
    apiUsedToday: typeof requests?.current === "number" ? requests.current : null,
    products: quotas,
    trackedIn: apiSportsQuotaBackend(),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   The cached, de-duplicated, budgeted GET
   ══════════════════════════════════════════════════════════════════════════ */

interface CacheEnvelope<T> {
  at: number;
  body: T;
}

interface ApiEnvelope<T> {
  results?: number;
  errors?: unknown;
  response?: T;
}

/** Shared so three concurrent readers of a cold cache make one upstream call. */
const inflight = new Map<string, Promise<unknown>>();
/** The last upstream call, for the per-minute throttle. */
let lastCallAt = 0;

/** True when `errors` carries anything — the API answers 200 with errors inside. */
function hasErrors(errors: unknown): boolean {
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === "object") return Object.keys(errors as Record<string, unknown>).length > 0;
  return String(errors).length > 0;
}

/**
 * GET an API-Sports path through the cache, the in-flight map and the budget.
 *
 * Returns null rather than throwing: this is one of several sources feeding one
 * merge, and every failure mode here has a better answer than an exception —
 * stale data, or nothing at all, while the rest of the chain carries the board.
 */
async function apiSportsGet<T>(path: string, ttlSeconds: number): Promise<T | null> {
  if (!apisportsConfigured()) return null;

  const key = `sports:apisports:football:${path}`;
  const cached = await cacheGet<CacheEnvelope<T>>(key).catch(() => null);
  if (cached && Date.now() - cached.at < ttlSeconds * 1000) return cached.body;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T | null>;

  const throttledUntil = lastCallAt + APISPORTS_MIN_INTERVAL_MS;
  if (cached && Date.now() < throttledUntil) {
    // Inside the per-minute window with something to serve: keep the request
    // budget for later rather than spending it to refresh early.
    return cached.body;
  }

  const run = (async (): Promise<T | null> => {
    if (!(await spendCall())) return cached?.body ?? null;

    try {
      lastCallAt = Date.now();
      const res = await fetch(`${BASE_URL}/${path}`, {
        headers: {
          // The current header. (`x-rapidapi-key` is the RapidAPI variant of the
          // same service; a direct key only ever works with this one.)
          "x-apisports-key": APISPORTS_API_KEY,
          accept: "application/json",
          "user-agent": "connectPlus/1.0 (+sports desk)",
        },
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      if (!res.ok) {
        log.warn("api-sports request failed", { path, status: res.status });
        return cached?.body ?? null;
      }
      const json = (await res.json()) as ApiEnvelope<T>;
      // A 200 carrying `errors` is how this API reports an exhausted plan, a
      // bad parameter or a suspended subscription. Serving the last good copy
      // beats serving an empty board for any of those.
      if (hasErrors(json.errors)) {
        log.warn("api-sports returned errors", { path, errors: json.errors });
        return cached?.body ?? null;
      }
      const body = (json.response ?? null) as T | null;
      if (body !== null) {
        await cacheSet(key, { at: Date.now(), body } satisfies CacheEnvelope<T>, ttlSeconds).catch(() => {});
      }
      return body;
    } catch (err) {
      log.warn("api-sports request threw", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
      return cached?.body ?? null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, run);
  return run;
}

/* ══════════════════════════════════════════════════════════════════════════
   Response shapes
   ══════════════════════════════════════════════════════════════════════════ */

export interface ApiScorePair {
  home?: number | null;
  away?: number | null;
}

/**
 * One football fixture row from `fixtures?date=`.
 *
 * Deliberately a narrow type: it names the football shape only, so a row that
 * does not look like this is a null rather than a silently half-mapped fixture.
 * The basketball variant of the same feed (`id`/`status`/`scores` at the top
 * level) is no longer described here, because the desk no longer asks for it.
 */
export interface ApiFixtureRow {
  fixture?: {
    id?: number | string;
    date?: string;
    venue?: { name?: string | null; city?: string | null } | null;
    status?: { long?: string; short?: string; elapsed?: number | null; extra?: number | null };
  };
  league?: { id?: number | string; name?: string; country?: string; season?: number | string };
  teams?: {
    home?: { id?: number | string; name?: string; logo?: string | null };
    away?: { id?: number | string; name?: string; logo?: string | null };
  };
  goals?: ApiScorePair | null;
  score?: { fulltime?: ApiScorePair | null; halftime?: ApiScorePair | null };
}

interface ApiStatusResponse {
  account?: { firstname?: string; lastname?: string; email?: string };
  subscription?: { plan?: string; end?: string; active?: boolean };
  requests?: { current?: number; limit_day?: number };
}

export interface ApiOddsRow {
  league?: { id?: number | string; name?: string; season?: number | string };
  fixture?: { id?: number | string; date?: string };
  bookmakers?: Array<{
    id?: number;
    name?: string;
    bets?: Array<{ id?: number; name?: string; values?: Array<{ value?: string; odd?: string }> }>;
  }>;
}

/* ══════════════════════════════════════════════════════════════════════════
   Normalisation
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * API-Sports football status codes → ours.
 *
 * Anything unrecognised falls back to a minute-based guess, because a feed that
 * says "45" and a status we do not know is still a match in progress — and "in
 * progress" is the only thing the board must not get wrong.
 */
export function apiSportsStatus(short: string | null | undefined, elapsed: number | null): MatchStatus {
  const s = (short ?? "").toUpperCase();
  switch (s) {
    case "1H":
    case "2H":
    case "ET":
    case "BT":
    case "P":
    case "LIVE":
      return "LIVE";
    case "HT":
      return "HT";
    case "FT":
    case "AET":
    case "PEN":
    case "AWD":
    case "WO":
      return "FT";
    case "PST":
    case "POST":
      return "POSTPONED";
    case "CANC":
    case "ABD":
      return "CANCELLED";
    case "SUSP":
      return "SUSPENDED";
    case "NS":
    case "TBD":
      return "SCHEDULED";
    default:
      return elapsed !== null && elapsed > 0 ? "LIVE" : "SCHEDULED";
  }
}

/**
 * The in-play minute, from the numeric clock this API gives.
 *
 * `elapsed` excludes stoppage time and `extra` is only sent during it, so the
 * displayed minute is their sum — the same number the broadcast graphics show.
 * The ceiling is the constant the shared parser uses: past it, the value is a
 * mis-parse (or a match that ran on) rather than a real clock.
 */
const MAX_MATCH_MINUTE = 130;

export function apiSportsMinute(elapsed: number | null | undefined, extra: number | null | undefined): number | null {
  if (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed <= 0) return null;
  const total = elapsed + (typeof extra === "number" && Number.isFinite(extra) ? extra : 0);
  if (total <= 0 || total > MAX_MATCH_MINUTE) return Math.min(Math.trunc(elapsed), MAX_MATCH_MINUTE);
  return Math.trunc(total);
}

/** The id our own records use, so a fixture can always be traced back. */
export function apiSportsExternalId(fixtureId: string | number): string {
  return `apisports:${fixtureId}`;
}

/** The upstream id back out of one of our records, or null if it is not ours. */
export function apiSportsIdFromExternal(externalId: string | null | undefined): string | null {
  const raw = (externalId ?? "").trim();
  if (!raw.startsWith("apisports:")) return null;
  const id = raw.slice("apisports:".length);
  return /^\d+$/.test(id) ? id : null;
}

/**
 * One row from the football feed onto the desk's fixture shape.
 *
 * Returns null for a row with no teams, or one with no nested `fixture`: a
 * fixture with no two sides is not something any board can render, and a row
 * without the football envelope is not one this mapper understands.
 */
export function mapApiSportsFixture(row: ApiFixtureRow, sport: string): NormalizedMatch | null {
  const source = row.fixture;
  if (!source) return null;
  const home = row.teams?.home;
  const away = row.teams?.away;
  const homeName = (home?.name ?? "").trim();
  const awayName = (away?.name ?? "").trim();
  if (!homeName || !awayName) return null;

  const id = source.id;
  if (id === undefined || id === null) return null;

  const leagueCountry = typeof row.league?.country === "string" ? row.league.country : null;

  const elapsed = typeof source.status?.elapsed === "number" ? source.status.elapsed : null;
  const extra = typeof source.status?.extra === "number" ? source.status.extra : null;
  const statusValue = apiSportsStatus(source.status?.short ?? null, elapsed);

  // A scheduled fixture has no score at all, which must stay null rather than
  // become 0-0 — `goals` is the live figure and `score.fulltime` fills in for a
  // match the day's payload already finished.
  const goals = row.goals ?? null;
  const homeScore = goals?.home ?? row.score?.fulltime?.home ?? null;
  const awayScore = goals?.away ?? row.score?.fulltime?.away ?? null;

  const kickoffRaw = source.date ?? null;
  const kickoff = kickoffRaw ? new Date(kickoffRaw) : null;

  const venue = source.venue?.name ?? null;

  return {
    externalId: apiSportsExternalId(id),
    provider: "apisports",
    sport,
    competition: row.league?.name ?? "Unknown competition",
    // Namespaced, because `competitionId` is matched against ESPN's slugs
    // elsewhere and a bare "276" could collide with one.
    competitionId: row.league?.id !== undefined && row.league?.id !== null ? `apisports:${row.league.id}` : null,
    country: leagueCountry,
    homeTeam: homeName,
    awayTeam: awayName,
    homeLogo: home?.logo ?? null,
    awayLogo: away?.logo ?? null,
    homeTeamId: home?.id !== undefined && home?.id !== null ? apiSportsExternalId(home.id) : null,
    awayTeamId: away?.id !== undefined && away?.id !== null ? apiSportsExternalId(away.id) : null,
    homeScore: typeof homeScore === "number" ? homeScore : null,
    awayScore: typeof awayScore === "number" ? awayScore : null,
    status: statusValue,
    minute: statusValue === "LIVE" ? apiSportsMinute(elapsed, extra) : null,
    kickoff: kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff.toISOString() : null,
    venue,
    homeForm: null,
    awayForm: null,
    oddsHome: null,
    oddsDraw: null,
    oddsAway: null,
  };
}

/**
 * The Match Winner prices out of an `/odds` payload.
 *
 * The response nests bookmakers, each with a list of bets; bet `1` is the 1X2
 * market. The FIRST bookmaker is taken rather than the best price across all of
 * them: this feeds a pick model whose whole argument is that it compares its own
 * probability against *a* market, and shopping the field for the longest price
 * would quietly inflate every edge it reports.
 */
export function apiSportsMatchOdds(rows: ApiOddsRow[] | null | undefined): {
  home: number;
  draw: number;
  away: number;
} | null {
  const first = rows?.[0];
  const books = first?.bookmakers ?? [];
  for (const book of books) {
    const matchWinner = (book.bets ?? []).find((b) => b.id === 1 || /match winner|1x2/i.test(b.name ?? ""));
    if (!matchWinner?.values?.length) continue;
    const byLabel = new Map<string, number>();
    for (const v of matchWinner.values) {
      const odd = Number(v.odd);
      if (v.value && Number.isFinite(odd) && odd > 1) byLabel.set(v.value.trim().toLowerCase(), odd);
    }
    const home = byLabel.get("home");
    const draw = byLabel.get("draw");
    const away = byLabel.get("away");
    if (home && draw && away) return { home, draw, away };
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   Public fetch surface
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The path that answers a whole day.
 *
 * Returns null for anything that is not football, and the caller treats that as
 * "nothing to fetch" rather than falling back to football's path — a request for
 * another sport should come back empty, not come back mislabelled.
 */
export function apiSportsDayPath(date: Date, sport: string): { path: string } | null {
  if (!isFootballScope(sport)) return null;
  const day = date.toISOString().slice(0, 10);
  return { path: `fixtures?date=${day}&timezone=UTC` };
}

/**
 * One day of fixtures, live state included.
 *
 * Today is cached for `APISPORTS_LIVE_TTL` (a minute by default — long enough
 * that the board, the strip and the match centre share one call, short enough
 * that a score is never visibly behind) and any other day for fifteen minutes,
 * because a fixture list for next Saturday does not change while you look at it.
 */
export async function apiSportsDay(date: Date, sport: string): Promise<NormalizedMatch[]> {
  const target = apiSportsDayPath(date, sport);
  if (!target) return [];
  const isToday = date.toISOString().slice(0, 10) === utcDay();
  const ttl = isToday ? APISPORTS_LIVE_TTL : APISPORTS_DAY_TTL;

  const rows = await apiSportsGet<ApiFixtureRow[]>(target.path, ttl);
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => mapApiSportsFixture(row, sport)).filter((m): m is NormalizedMatch => m !== null);
}

/**
 * Prices for one fixture, by the id this feed gave it.
 *
 * Cached for six hours: a 1X2 market on a fixture kicks off in an hour, and six
 * hours of a stale price still beats spending a hundredth of the day's budget to
 * re-read a number that has moved by two cents.
 */
export async function apiSportsFixtureOdds(fixtureId: string | number): Promise<{
  home: number;
  draw: number;
  away: number;
} | null> {
  const rows = await apiSportsGet<ApiOddsRow[]>(`odds?fixture=${encodeURIComponent(String(fixtureId))}`, APISPORTS_ODDS_TTL);
  if (!Array.isArray(rows)) return null;
  return apiSportsMatchOdds(rows);
}

/**
 * The provider entry.
 *
 * Priority 1 — the top of the chain — because it is the only source that carries
 * the FKF Premier League *and* live minutes in one shape. When its budget is
 * spent it returns nothing and the rest of the chain fills the board, which is
 * exactly what the priority ordering is for.
 */
export const apiSportsProvider: SportsProvider = {
  id: "apisports",
  label: "API-Sports",
  configured: apisportsConfigured(),
  priority: 1,
  keyless: false,
  supportsDate: true,
  async fetchMatches({ date, sport }) {
    return apiSportsDay(date, sport);
  },
};
