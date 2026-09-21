/**
 * The fixture calendar — a day, a week or a month of fixtures in one read.
 *
 * Two keyless sources, used for what each is actually good at:
 *
 *   • **ESPN's scoreboard** accepts a date RANGE (`dates=YYYYMMDD-YYYYMMDD`), so
 *     a month of the big leagues arrives in one request per league, carrying
 *     kick-off times, crests and odds. It is the accurate one.
 *   • **The openfootball archive** has no range endpoint but its whole season is
 *     already in cache (see sports-openfootball.ts), so filling the gaps it
 *     covers costs no upstream request at all.
 *
 * Everything is cached, and the TTL follows the question: a calendar containing
 * today is worthless if it is hours old, while next month's fixtures do not
 * change minute to minute. That is also what keeps this affordable — the
 * calendar is the most expensive read on the sports desk, so it is the one that
 * must never be recomputed per viewer.
 */

import { cacheGet, cacheSet } from "@/lib/redis";
import { createLogger } from "@/lib/logger";
import {
  ESPN_SOCCER_LEAGUES,
  mapEspnEvent,
  type NormalizedMatch,
} from "@/lib/sports";
import { openFootballRange } from "@/lib/sports-openfootball";
import { ESPN_SPORT_PATH, footballScope } from "@/lib/sports-scope";

const log = createLogger("sports-calendar");

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const FETCH_TIMEOUT_MS = 12_000;

/** Ranges longer than this use only the leagues people actually plan around. */
const LONG_RANGE_DAYS = 10;

/** The leagues worth a request on a month-long range. */
const LONG_RANGE_LEAGUES = [
  "eng.1",
  "esp.1",
  "ita.1",
  "ger.1",
  "fra.1",
  "uefa.champions",
  "usa.1",
] as const;

export interface SportsCalendar {
  generatedAt: string;
  from: string;
  to: string;
  sport: string;
  days: number;
  matches: NormalizedMatch[];
  sources: string[];
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function compact(date: Date): string {
  return dayKey(date).replace(/-/g, "");
}

/** Team-name slug, for de-duplicating the two sources' spelling of one fixture. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(fc|cf|sc|afc|ac|sk|if|bk|club|de|city)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function withinRange(date: Date, days: number): boolean {
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const at = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return at >= start - 86_400_000 && at <= start + days * 86_400_000;
}

async function fetchEspnRange(
  from: Date,
  to: Date,
  sport: string
): Promise<{ matches: NormalizedMatch[]; sources: string[] }> {
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  // A month-long range is asked of the leagues people actually plan around; a
  // short one of everything we carry. There is no per-sport league set any
  // more — the desk covers one sport.
  const leagues = days > LONG_RANGE_DAYS ? [...LONG_RANGE_LEAGUES] : Object.keys(ESPN_SOCCER_LEAGUES);

  const sportPath = ESPN_SPORT_PATH;
  const range = `${compact(from)}-${compact(to)}`;

  const results = await Promise.allSettled(
    leagues.map(async (slugName) => {
      const url = `${ESPN_BASE}/${sportPath}/${slugName}/scoreboard?dates=${range}&limit=400`;
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "connectPlus/1.0 (+sports desk)" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`espn ${slugName} HTTP ${res.status}`);
      const body = (await res.json()) as { events?: unknown[] };
      const display = ESPN_SOCCER_LEAGUES[slugName];
      return (Array.isArray(body.events) ? body.events : [])
        .map((row) => mapEspnEvent(row, display ?? slugName, sport))
        .filter((m): m is NormalizedMatch => m !== null);
    })
  );

  const matches: NormalizedMatch[] = [];
  let failed = 0;
  for (const result of results) {
    if (result.status === "fulfilled") matches.push(...result.value);
    else failed++;
  }
  if (failed === results.length && results.length > 0) {
    log.warn("calendar: every ESPN league failed");
  }
  return { matches, sources: matches.length > 0 ? ["espn"] : [] };
}

/**
 * Fixtures between two dates, newest-first sources winning.
 *
 * The openfootball archive is merged in only where ESPN produced nothing for the
 * same pairing on the same day, so the accurate feed's kick-off time and crests
 * always win and the archive is strictly additive — more fixtures, never a
 * conflicting duplicate of one already shown.
 */
export async function getSportsCalendar(input: {
  from?: Date;
  to?: Date;
  sport?: string;
  fresh?: boolean;
}): Promise<SportsCalendar> {
  // Coerced rather than rejected: a bookmarked `?sport=basketball` link should
  // still land on a calendar, and the calendar it lands on is football's.
  const sport = footballScope(input.sport);
  const now = new Date();
  const from = input.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = input.to ?? new Date(from.getTime() + 6 * 86_400_000);
  const days = Math.max(1, Math.min(Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1, 62));

  const cacheKey = `sports:calendar:${sport}:${dayKey(from)}:${dayKey(to)}`;
  if (!input.fresh) {
    const cached = await cacheGet<SportsCalendar>(cacheKey).catch(() => null);
    if (cached) return cached;
  }

  let espn = await fetchEspnRange(from, to, sport).catch(() => ({ matches: [], sources: [] }));

  // Fallback: when the requested range returns nothing, try the nearest
  // available fixtures so the calendar is never a blank wall.
  if (espn.matches.length === 0) {
    try {
      const fallback = await fetch(`${ESPN_BASE}/${ESPN_SPORT_PATH}/scoreboard?limit=20`, {
        headers: { accept: "application/json", "user-agent": "connectPlus/1.0 (+sports desk)" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      });
      if (fallback.ok) {
        const body = (await fallback.json()) as { events?: unknown[] };
        const display = "Upcoming";
        const mapped = (Array.isArray(body.events) ? body.events : [])
          .map((row) => mapEspnEvent(row, display, sport))
          .filter((m): m is NormalizedMatch => m !== null);
        if (mapped.length > 0) {
          espn = { matches: mapped, sources: ["espn-fallback"] };
        }
      }
    } catch {
      // Fallback failure is not fatal — the calendar just stays empty.
    }
  }

  // What the archive can add: any pairing ESPN did not already give us.
  const seen = new Set(
    espn.matches.map((m) => `${slug(m.homeTeam)}|${slug(m.awayTeam)}|${m.kickoff ? dayKey(new Date(m.kickoff)) : ""}`)
  );
  const archive = await openFootballRange(from, to).catch(() => [] as NormalizedMatch[]);
  const extras = archive.filter((m) => {
    const key = `${slug(m.homeTeam)}|${slug(m.awayTeam)}|${m.kickoff ? dayKey(new Date(m.kickoff)) : ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const matches = [...espn.matches, ...extras]
    .filter((m) => {
      if (!m.kickoff) return true;
      const kickoff = new Date(m.kickoff);
      if (Number.isNaN(kickoff.getTime())) return true;
      return withinRange(kickoff, days + 1);
    })
    .sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));

  const sources = [...new Set(matches.map((m) => m.provider))];
  const calendar: SportsCalendar = {
    generatedAt: new Date().toISOString(),
    from: dayKey(from),
    to: dayKey(to),
    sport,
    days,
    matches,
    sources,
  };

  // A calendar with today in it moves (kick-offs confirmed, fixtures moved), so
  // it gets a short TTL; a purely future one is effectively static.
  const todayKey = dayKey(new Date());
  const includesToday = dayKey(from) <= todayKey && todayKey <= dayKey(to);
  await cacheSet(cacheKey, calendar, includesToday ? 30 * 60 : 6 * 60 * 60).catch(() => {});

  return calendar;
}
