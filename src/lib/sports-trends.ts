/**
 * Trend learning — what the model has actually observed about a competition, and
 * how that observation moves the numbers.
 *
 * The prediction pipeline already learns from single fixtures (a real scoreline
 * becomes a result lesson) and from its own record (per-market accuracy). What it
 * could not see was the shape of a LEAGUE: that the Bundesliga is running hot,
 * that this division is drawing half its games, that a competition has quietly
 * become low-scoring. Those are the patterns that move a goals model, and they
 * are only visible in aggregate.
 *
 * So this module aggregates finished matches per competition into a small,
 * explainable set of rates, caches them, writes them to the hive mind's memory as
 * lessons, and hands them to the model as a prior. The model then blends them
 * toward the league's observed reality — bounded, sample-weighted, and never
 * allowed to override team-specific form, because "this league averages 3 goals"
 * is a weaker statement about one fixture than "these two teams have conceded 12
 * in five games".
 *
 * Deliberately no AI: every number here is a rate over real matches, so it is
 * reproducible, cheap, and auditable — a reader can be shown exactly why the
 * model moved.
 */

import { cacheGet, cacheSet } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";

const log = createLogger("sports-trends");

const TREND_CACHE_KEY = "sports:trends:v1";
const TREND_TTL_SECONDS = 6 * 60 * 60;
/** Default lookback: enough matches to be a trend, recent enough to matter. */
const DEFAULT_LOOKBACK_DAYS = 60;
/** Below this, a "trend" is noise and is not used at all. */
export const MIN_TREND_MATCHES = 8;
/** The most a trend may move the expected goals, as a fraction. */
const MAX_GOALS_PULL = 0.28;
/** Matches at which the trend pull reaches its ceiling. */
const FULL_TREND_SAMPLE = 40;

export interface CompetitionTrend {
  competition: string;
  /** Finished matches observed in the window. */
  matches: number;
  /** Total goals per match. */
  goalsPerMatch: number;
  /** Share of matches won by the home side, 0..1. */
  homeWinRate: number;
  drawRate: number;
  /** Share of matches where both sides scored, 0..1. */
  bttsRate: number;
  /** Share of matches with three goals or more, 0..1. */
  over25Rate: number;
  updatedAt: string;
}

/**
 * Turn observed results into rates.
 *
 * Pure and exported so the arithmetic is unit-testable: a trend that is wrong is
 * worse than no trend, because it moves every pick in that competition at once.
 */
export function summarizeTrend(
  competition: string,
  results: { homeScore: number; awayScore: number }[],
  now: Date = new Date()
): CompetitionTrend | null {
  const played = results.filter(
    (r) => Number.isFinite(r.homeScore) && Number.isFinite(r.awayScore) && r.homeScore >= 0 && r.awayScore >= 0
  );
  if (played.length < MIN_TREND_MATCHES) return null;

  let goals = 0;
  let homeWins = 0;
  let draws = 0;
  let btts = 0;
  let over25 = 0;
  for (const m of played) {
    const total = m.homeScore + m.awayScore;
    goals += total;
    if (m.homeScore > m.awayScore) homeWins++;
    else if (m.homeScore === m.awayScore) draws++;
    if (m.homeScore > 0 && m.awayScore > 0) btts++;
    if (total >= 3) over25++;
  }

  const n = played.length;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    competition,
    matches: n,
    goalsPerMatch: round(goals / n),
    homeWinRate: round(homeWins / n),
    drawRate: round(draws / n),
    bttsRate: round(btts / n),
    over25Rate: round(over25 / n),
    updatedAt: now.toISOString(),
  };
}

/**
 * How far the league's observed scoring should pull these expected goals.
 *
 * The pull is proportional to how much evidence there is, and capped, so a
 * 12-match sample nudges a fixture and a 60-match sample leans on it — but never
 * past `MAX_GOALS_PULL`. The returned pair keeps the two sides' RELATIVE
 * strength intact: it scales both toward the league mean rather than flattening
 * the fixture into an average game.
 */
export function trendGoalAdjustment(
  trend: CompetitionTrend,
  lambdaHome: number,
  lambdaAway: number
): { lambdaHome: number; lambdaAway: number; applied: number } {
  if (trend.matches < MIN_TREND_MATCHES) return { lambdaHome, lambdaAway, applied: 0 };
  const total = lambdaHome + lambdaAway;
  if (total <= 0) return { lambdaHome, lambdaAway, applied: 0 };

  const weight = Math.min(trend.matches, FULL_TREND_SAMPLE) / FULL_TREND_SAMPLE;
  const observed = trend.goalsPerMatch;
  // The ratio the model should move toward, damped by sample size and capped.
  const rawRatio = observed / total;
  const cappedRatio = 1 + Math.max(-MAX_GOALS_PULL, Math.min(MAX_GOALS_PULL, (rawRatio - 1) * weight));
  return {
    lambdaHome: lambdaHome * cappedRatio,
    lambdaAway: lambdaAway * cappedRatio,
    applied: Math.round((cappedRatio - 1) * 1000) / 1000,
  };
}

/** Read the cached trend table; an empty map means "no trends learned yet". */
export async function loadCompetitionTrends(): Promise<Map<string, CompetitionTrend>> {
  const cached = await cacheGet<CompetitionTrend[]>(TREND_CACHE_KEY).catch(() => null);
  if (!cached || !Array.isArray(cached)) return new Map();
  return new Map(cached.map((t) => [t.competition, t]));
}

/**
 * Re-derive every competition's trend from finished matches and cache it.
 *
 * Also writes one lesson per competition into the hive mind, so the same
 * observation that tunes this model is recallable by every other consumer of the
 * mind (editorial summaries, the admin console, and future models) instead of
 * living only inside a cache key.
 */
export async function learnCompetitionTrends(
  opts: { days?: number; now?: Date } = {}
): Promise<{
  competitions: number;
  lessons: number;
  trends: CompetitionTrend[];
}> {
  const now = opts.now ?? new Date();
  const days = Math.min(Math.max(opts.days ?? DEFAULT_LOOKBACK_DAYS, 7), 365);
  const since = new Date(now.getTime() - days * 86_400_000);

  const rows = await prisma.sportsMatch
    .findMany({
      where: {
        status: "FT",
        kickoff: { gte: since },
        homeScore: { not: null },
        awayScore: { not: null },
      },
      select: { competition: true, homeScore: true, awayScore: true },
      orderBy: { kickoff: "desc" },
      take: 5000,
    })
    .catch((error) => {
      log.warn("trend read failed", { error: error instanceof Error ? error.message : String(error) });
      return [] as { competition: string; homeScore: number | null; awayScore: number | null }[];
    });

  const byCompetition = new Map<string, { homeScore: number; awayScore: number }[]>();
  for (const row of rows) {
    if (row.homeScore == null || row.awayScore == null) continue;
    const list = byCompetition.get(row.competition) ?? [];
    list.push({ homeScore: row.homeScore, awayScore: row.awayScore });
    byCompetition.set(row.competition, list);
  }

  const trends: CompetitionTrend[] = [];
  for (const [competition, results] of byCompetition) {
    const trend = summarizeTrend(competition, results, now);
    if (trend) trends.push(trend);
  }

  await cacheSet(TREND_CACHE_KEY, trends, TREND_TTL_SECONDS).catch(() => {});

  // One lesson per competition, refreshed in place: the mind is a corpus of
  // observations, and stacking a new "Premier League averages X" line every six
  // hours would drown it in near-duplicates that all say the same thing.
  let lessons = 0;
  for (const trend of trends) {
    const content = `Trend lesson: ${trend.competition} observed over ${trend.matches} matches — ${trend.goalsPerMatch.toFixed(
      2
    )} goals per game, ${(trend.homeWinRate * 100).toFixed(0)}% home wins, ${(trend.drawRate * 100).toFixed(
      0
    )}% draws, ${(trend.bttsRate * 100).toFixed(0)}% both to score, ${(trend.over25Rate * 100).toFixed(0)}% over 2.5.`;
    const tags = `trend,lesson,sport:pattern,${trend.competition.toLowerCase()}`;
    try {
      const existing = await prisma.neuralMemory.findFirst({
        where: { source: "sports", category: "wisdom", tags: { contains: `${trend.competition.toLowerCase()}` }, content: { startsWith: "Trend lesson:" } },
        select: { id: true },
      });
      if (existing) {
        await prisma.neuralMemory.update({
          where: { id: existing.id },
          data: {
            content,
            tags,
            confidence: 0.8,
            metadata: JSON.stringify({ competition: trend.competition, matches: trend.matches }),
          },
        });
      } else {
        await prisma.neuralMemory.create({
          data: {
            source: "sports",
            category: "wisdom",
            content,
            tags,
            confidence: 0.8,
            metadata: JSON.stringify({ competition: trend.competition, matches: trend.matches }),
          },
        });
      }
      lessons++;
    } catch {
      /* the mind is a bonus; the trend table is the part the model needs */
    }
  }

  log.info("competition trends learned", {
    competitions: trends.length,
    observed: rows.length,
    lessons,
    days,
  });

  return { competitions: trends.length, lessons, trends };
}

/**
 * The trend table for the admin console: the same numbers the model is using,
 * in the order of how much evidence stands behind them.
 */
export async function trendReport(): Promise<CompetitionTrend[]> {
  const trends = await loadCompetitionTrends();
  return [...trends.values()].sort((a, b) => b.matches - a.matches).slice(0, 25);
}
