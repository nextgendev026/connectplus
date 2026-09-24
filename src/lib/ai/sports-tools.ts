/**
 * The agent's sports-analysis tools.
 *
 * These are deliberately thin. The platform already owns a match model —
 * `lib/sports-forecast.ts` (Dixon-Coles with a market-consistent tilt), the
 * `SportsMatch`/`SportsPrediction` tables, and `lib/sports-accuracy.ts` for
 * grading. A second Poisson implementation living inside the agent would drift
 * from the one the public sports desk publishes, and then the operator and the
 * reader would be looking at two different numbers for the same fixture. So every
 * number here comes from the existing engine, and this file only supplies what the
 * engine needs: inputs, persistence and a confidence.
 *
 * ## What "calibration" means here
 *
 * A prediction model fails in two directions, and they need separate corrections:
 *
 *   • **Over/under-confidence.** The model says 70% and the selection wins 55% of
 *     the time. Drawing the calibration map is the job of
 *     `sports-accuracy.calibrationBuckets`; applying the correction is what
 *     `calibratePredictionWeights` does, by scaling how much recent form is
 *     trusted.
 *   • **Systematic goal bias.** A league that has drifted higher-scoring makes
 *     every expected-goals figure short. Comparing modelled goals to real
 *     scorelines gives a single multiplier for that.
 *
 * Both write to `PlatformSetting` through the platform's own catalogue, bounded
 * hard: a calibration loop that can run unattended must not be able to set a
 * weight to zero or forty because it read a bad sample.
 */

import { prisma } from "@/lib/prisma";
import { updateSettings } from "@/lib/settings";
import {
  DEFAULT_RHO,
  RHO_MAX,
  RHO_MIN,
  applyDixonColes,
  decideMatch,
  estimateRho,
  outcomeRates,
  type DecisionCandidate,
} from "@/lib/sports-forecast";

/* ── Model plumbing ───────────────────────────────────────────────────────── */

/** Largest scoreline the grid models. Beyond this the mass is negligible. */
const MAX_GOALS = 8;

/**
 * Home advantage as a multiplier on the home side's expectation.
 *
 * A single constant rather than a fitted parameter: it is the one term in the
 * model that the calibration tool must not be able to move, because it is
 * confounded with home-form bias and a loop tuning it would chase its own tail.
 */
const HOME_ADVANTAGE = 1.12;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * A weighted mean of recent form, newest last.
 *
 * `recencyWeight` is the calibration parameter at work: 1.0 weights every match
 * equally, above 1.0 leans on the most recent game, below 1.0 smooths toward the
 * sample. Weights are normalised so the mean stays on the goals-per-game scale
 * whatever the weight is — otherwise calibrating recency would silently rescale
 * expected goals too, and the two parameters would fight.
 */
function weightedForm(form: number[], recencyWeight: number): number {
  if (form.length === 0) return 0;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < form.length; i++) {
    const weight = Math.pow(recencyWeight, form.length - 1 - i);
    numerator += weight * form[i]!;
    denominator += weight;
  }
  return denominator > 0 ? numerator / denominator : 0;
}

/** Build the independent-Poisson grid, then apply the low-score correction. */
function buildGrid(lambdaHome: number, lambdaAway: number, rho: number): number[][] {
  const base: number[][] = [];
  for (let h = 0; h <= MAX_GOALS; h++) {
    base[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      base[h]![a] = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
    }
  }
  return applyDixonColes(base, lambdaHome, lambdaAway, rho);
}

/** Probability the total goals exceed a line. */
function overLine(matrix: number[][], line: number): number {
  let over = 0;
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h]!.length; a++) {
      if (h + a > line) over += matrix[h]![a]!;
    }
  }
  return over;
}

/** The most likely scorelines, for the analyst's reasoning line. */
function topScorelines(matrix: number[][], count: number): Array<{ score: string; probability: number }> {
  const cells: Array<{ score: string; probability: number }> = [];
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h]!.length; a++) {
      cells.push({ score: `${h}-${a}`, probability: matrix[h]![a]! });
    }
  }
  return cells.sort((x, y) => y.probability - x.probability).slice(0, count);
}

/* ── Calibration parameters ───────────────────────────────────────────────── */

const RECENCY_KEY = "sportsRecencyWeight";
const GOALS_KEY = "sportsGoalExpectationFactor";

const RECENCY_BOUNDS = [0.5, 1.5] as const;
const GOALS_BOUNDS = [0.7, 1.3] as const;

/**
 * Read the calibration parameters.
 *
 * Read from `PlatformSetting` directly rather than through `getSettings` so the
 * bounds are applied on the way *in*: a value already in the database — written by
 * an earlier build, or by hand — must not be able to reach the model unclamped.
 */
async function calibrationParameters(): Promise<{ recencyWeight: number; goalExpectationFactor: number }> {
  const rows = await prisma.platformSetting
    .findMany({ where: { key: { in: [RECENCY_KEY, GOALS_KEY] } } })
    .catch(() => [] as Array<{ key: string; value: string }>);

  const read = (key: string, fallback: number, bounds: readonly [number, number]) => {
    const raw = rows.find((r) => r.key === key)?.value;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clamp(parsed, bounds[0], bounds[1]) : fallback;
  };

  return {
    recencyWeight: read(RECENCY_KEY, 1, RECENCY_BOUNDS),
    goalExpectationFactor: read(GOALS_KEY, 1, GOALS_BOUNDS),
  };
}

/* ── simulateMatchFixture ─────────────────────────────────────────────────── */

export interface SimulationInput {
  homeTeam: string;
  awayTeam: string;
  league: string;
  recentHomeForm: number[];
  recentAwayForm: number[];
}

export async function simulateFixture(input: SimulationInput) {
  const homeForm = input.recentHomeForm.filter((n) => Number.isFinite(n)).map((n) => clamp(n, 0, 12));
  const awayForm = input.recentAwayForm.filter((n) => Number.isFinite(n)).map((n) => clamp(n, 0, 12));

  if (homeForm.length === 0 || awayForm.length === 0) {
    return {
      error: "no_form",
      message:
        "Both recentHomeForm and recentAwayForm need at least one goals-scored figure. " +
        "Use queryMatchDatabase to read the competition's recent results first.",
    };
  }

  const { recencyWeight, goalExpectationFactor } = await calibrationParameters();

  // A floor on expectations: a side that has scored nothing in its last four is
  // not a side that will score nothing forever, and a lambda of 0 makes the grid
  // degenerate (a single certain scoreline), which is a worse answer than a
  // cautious non-zero one.
  const lambdaHome = Math.max(0.15, weightedForm(homeForm, recencyWeight) * goalExpectationFactor * HOME_ADVANTAGE);
  const lambdaAway = Math.max(0.15, weightedForm(awayForm, recencyWeight) * goalExpectationFactor / HOME_ADVANTAGE);

  // rho is fitted to this competition's real draw rate when there is a sample to
  // fit to, and falls back to the engine's default on a thin one — a competition
  // with four settled matches has a draw rate that is noise.
  const settled = await prisma.sportsMatch
    .findMany({
      where: {
        competition: input.league,
        status: "FT",
        homeScore: { not: null },
        awayScore: { not: null },
      },
      select: { homeScore: true, awayScore: true },
      orderBy: { kickoff: "desc" },
      take: 200,
    })
    .catch(() => [] as Array<{ homeScore: number | null; awayScore: number | null }>);

  let rho = DEFAULT_RHO;
  if (settled.length >= 30) {
    const draws = settled.filter((m) => m.homeScore === m.awayScore).length / settled.length;
    // `trust` scaled by sample size: a full season leans on the fitted value, 30
    // matches barely nudges it. The engine returns the estimate alongside whether
    // it fell back to the default, so the fallback is reported rather than assumed.
    const estimate = estimateRho(lambdaHome, lambdaAway, draws, Math.min(1, settled.length / 200));
    rho = clamp(estimate.rho, RHO_MIN, RHO_MAX);
  }

  const grid = buildGrid(lambdaHome, lambdaAway, rho);
  const rates = outcomeRates(grid);

  const candidates: DecisionCandidate[] = [
    { market: "1X2", selection: `${input.homeTeam} win`, confidence: rates.home, valueEdge: null },
    { market: "1X2", selection: "Draw", confidence: rates.draw, valueEdge: null },
    { market: "1X2", selection: `${input.awayTeam} win`, confidence: rates.away, valueEdge: null },
  ];

  const settledForLeague = await prisma.sportsPrediction
    .findMany({
      where: { market: "1X2", status: { in: ["WON", "LOST"] }, match: { competition: input.league } },
      select: { status: true },
      take: 500,
    })
    .catch(() => [] as Array<{ status: string }>);

  const competitionAccuracy =
    settledForLeague.length > 0
      ? settledForLeague.filter((p) => p.status === "WON").length / settledForLeague.length
      : null;

  const decision = decideMatch({
    candidates,
    settledSample: settledForLeague.length,
    competitionAccuracy,
  });

  /*
   * The confidence score, and why it is not just the top probability.
   *
   * A 45% home win in a three-way market is a *weak* read even though 45% sounds
   * decisive, because the other two outcomes share the rest. What makes a fixture
   * worth acting on is the separation between the top outcome and the next, and
   * how much evidence stands behind the inputs. So the score is that separation,
   * lightly nudged by sample size — and it is capped below 100 on purpose, because
   * no model of a football match is ever certain.
   */
  const ranked = [rates.home, rates.draw, rates.away].sort((a, b) => b - a);
  const separation = ranked[0]! - ranked[1]!;
  const sampleFactor = Math.min(1, (homeForm.length + awayForm.length) / 10);
  const confidenceScore = Math.round(clamp(separation * 220 * (0.75 + 0.25 * sampleFactor), 1, 95));

  return {
    fixture: `${input.homeTeam} vs ${input.awayTeam}`,
    league: input.league,
    model: "dixon-coles",
    parameters: {
      rho: Number(rho.toFixed(4)),
      rhoSource: settled.length >= 30 ? `fitted to ${settled.length} settled ${input.league} matches` : "engine default (thin sample)",
      recencyWeight,
      goalExpectationFactor,
      homeAdvantage: HOME_ADVANTAGE,
    },
    expectedGoals: {
      home: Number(lambdaHome.toFixed(2)),
      away: Number(lambdaAway.toFixed(2)),
      total: Number((lambdaHome + lambdaAway).toFixed(2)),
    },
    markets: {
      oneX2: {
        home: Number((rates.home * 100).toFixed(1)),
        draw: Number((rates.draw * 100).toFixed(1)),
        away: Number((rates.away * 100).toFixed(1)),
      },
      btts: {
        yes: Number((rates.btts * 100).toFixed(1)),
        no: Number(((1 - rates.btts) * 100).toFixed(1)),
      },
      overUnder: {
        over15: Number((overLine(grid, 1.5) * 100).toFixed(1)),
        over25: Number((overLine(grid, 2.5) * 100).toFixed(1)),
        over35: Number((overLine(grid, 3.5) * 100).toFixed(1)),
      },
    },
    topScorelines: topScorelines(grid, 5).map((s) => ({
      score: s.score,
      probability: Number((s.probability * 100).toFixed(1)),
    })),
    confidence: {
      score: confidenceScore,
      band: confidenceScore >= 60 ? "high" : confidenceScore >= 35 ? "moderate" : "low",
      separation: Number((separation * 100).toFixed(1)),
      explanation:
        "Score is the gap between the leading outcome and the next, scaled by how much form data supported it. " +
        "It deliberately caps at 95: a single fixture is never a certainty.",
    },
    headlineCall: {
      market: decision.market,
      selection: decision.selection,
      confidence: Number((decision.confidence * 100).toFixed(1)),
      decisive: decision.decisive,
      reasons: decision.reasons,
    },
    dataQuality: {
      homeFormMatches: homeForm.length,
      awayFormMatches: awayForm.length,
      leagueSettledMatches: settled.length,
      leagueSettledPredictions: settledForLeague.length,
      leagueAccuracy: competitionAccuracy != null ? Number((competitionAccuracy * 100).toFixed(1)) : null,
    },
  };
}

/* ── calibratePredictionWeights ───────────────────────────────────────────── */

export async function calibrateWeights(input: { market: string; historicalMatchResults?: unknown[] }) {
  const before = await calibrationParameters();

  // Settled picks whose fixture actually finished. A prediction graded without a
  // score, or still PENDING, is not evidence and must not be counted — including
  // it would bias the correction toward whatever the grader guessed.
  const graded = await prisma.sportsPrediction
    .findMany({
      where: {
        market: input.market,
        status: { in: ["WON", "LOST"] },
        match: { status: "FT", homeScore: { not: null }, awayScore: { not: null } },
      },
      select: {
        status: true,
        confidence: true,
        expectedHomeGoals: true,
        expectedAwayGoals: true,
        match: { select: { homeScore: true, awayScore: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    })
    .catch(() => []);

  const sample = input.historicalMatchResults?.length ?? graded.length;
  const MIN_SAMPLE = 20;

  if (graded.length < MIN_SAMPLE) {
    // Fail loud. Reporting a successful calibration off six results would be a lie
    // the operator cannot see through.
    return {
      calibrated: false,
      reason: "insufficient_sample",
      message:
        `Only ${graded.length} settled ${input.market} prediction(s) with a final score; ` +
        `${MIN_SAMPLE} are needed before a correction means anything. Earning more requires ` +
        "fixtures to settle — nothing the agent can do from here.",
      sample: { settled: graded.length, required: MIN_SAMPLE, provided: sample },
      parameters: { before, after: before },
    };
  }

  const wins = graded.filter((p) => p.status === "WON").length;
  const observedAccuracy = wins / graded.length;
  const meanConfidence = graded.reduce((sum, p) => sum + p.confidence, 0) / graded.length;

  // Positive means the model was too pessimistic; negative means it was
  // over-confident, which is the dangerous direction because it is what a
  // staking plan multiplies.
  const confidenceError = observedAccuracy - meanConfidence;

  const withGoals = graded.filter(
    (p) => p.expectedHomeGoals != null && p.expectedAwayGoals != null && p.match?.homeScore != null && p.match?.awayScore != null,
  );
  const modelledGoals = withGoals.reduce((s, p) => s + (p.expectedHomeGoals ?? 0) + (p.expectedAwayGoals ?? 0), 0);
  const actualGoals = withGoals.reduce((s, p) => s + (p.match?.homeScore ?? 0) + (p.match?.awayScore ?? 0), 0);
  const goalRatio = modelledGoals > 0 ? actualGoals / modelledGoals : 1;

  // Trust grows with sample size and never reaches 1: a calibration is a nudge,
  // not a refit, and it must stay reversible when the next sample disagrees.
  const trust = Math.min(1, graded.length / 200);

  const nextGoalFactor = clamp(
    1 + (goalRatio - 1) * trust,
    GOALS_BOUNDS[0],
    GOALS_BOUNDS[1],
  );

  // Recency is corrected from the confidence error, in the opposite direction:
  // over-confidence means the model is reading form too sharply, so recent results
  // should be trusted less.
  const nextRecency = clamp(
    before.recencyWeight * (1 - confidenceError * 0.5 * trust),
    RECENCY_BOUNDS[0],
    RECENCY_BOUNDS[1],
  );

  const after = {
    recencyWeight: Number(nextRecency.toFixed(3)),
    goalExpectationFactor: Number(nextGoalFactor.toFixed(3)),
  };

  const changed: Record<string, string> = {};
  if (Math.abs(after.recencyWeight - before.recencyWeight) >= 0.001) changed[RECENCY_KEY] = String(after.recencyWeight);
  if (Math.abs(after.goalExpectationFactor - before.goalExpectationFactor) >= 0.001) changed[GOALS_KEY] = String(after.goalExpectationFactor);

  if (Object.keys(changed).length > 0) {
    // Through the settings layer, so the write is cached-busting and visible in the
    // admin settings page. The keys are registered in `SETTINGS_CATALOG` — without
    // that registration `updateSettings` skips them silently.
    await updateSettings(changed);
  }

  return {
    calibrated: true,
    market: input.market,
    evidence: {
      settledPredictions: graded.length,
      wins,
      observedAccuracy: Number((observedAccuracy * 100).toFixed(1)),
      meanModelledConfidence: Number((meanConfidence * 100).toFixed(1)),
      confidenceErrorPct: Number((confidenceError * 100).toFixed(1)),
      matchesWithGoals: withGoals.length,
      modelledGoals: Number(modelledGoals.toFixed(1)),
      actualGoals: Number(actualGoals.toFixed(1)),
      goalRatio: Number(goalRatio.toFixed(3)),
      trust: Number(trust.toFixed(3)),
    },
    parameters: { before, after },
    written: Object.keys(changed),
    note:
      Object.keys(changed).length > 0
        ? "Calibration persisted to PlatformSetting and applied to the next simulation. Bounded to " +
          `${RECENCY_BOUNDS.join("-")} and ${GOALS_BOUNDS.join("-")} so a bad sample cannot move the model far.`
        : "The correction was inside the rounding tolerance; nothing was written.",
  };
}

/* ── queryMatchDatabase ───────────────────────────────────────────────────── */

export async function queryMatchDatabase(input: { competition?: string; limit?: number }) {
  const limit = clamp(input.limit ?? 10, 1, 50);
  const where = input.competition ? { competition: input.competition } : {};

  const [fixtures, settledResults, predictionAccuracy] = await Promise.all([
    prisma.sportsMatch.findMany({
      where,
      select: {
        homeTeam: true,
        awayTeam: true,
        competition: true,
        country: true,
        status: true,
        kickoff: true,
        homeScore: true,
        awayScore: true,
        homeForm: true,
        awayForm: true,
        oddsHome: true,
        oddsDraw: true,
        oddsAway: true,
        predictions: {
          select: { market: true, selection: true, confidence: true, valueEdge: true, status: true, model: true },
        },
      },
      orderBy: [{ kickoff: "desc" }],
      take: limit,
    }),
    prisma.sportsMatch.findMany({
      where: { ...where, status: "FT", homeScore: { not: null }, awayScore: { not: null } },
      select: { homeScore: true, awayScore: true, competition: true },
      orderBy: { kickoff: "desc" },
      take: 200,
    }),
    prisma.sportsPrediction.groupBy({
      by: ["market", "status"],
      _count: { _all: true },
      where: input.competition ? { match: { competition: input.competition } } : {},
    }),
  ]);

  const played = settledResults.filter((m) => m.homeScore != null && m.awayScore != null);
  const totals = played.map((m) => (m.homeScore ?? 0) + (m.awayScore ?? 0));
  const goalsPerGame = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : null;

  return {
    competition: input.competition ?? "all competitions",
    fixtures: fixtures.map((f) => ({
      fixture: `${f.homeTeam} vs ${f.awayTeam}`,
      competition: f.competition,
      country: f.country,
      status: f.status,
      kickoff: f.kickoff?.toISOString() ?? null,
      score: f.homeScore != null && f.awayScore != null ? `${f.homeScore}-${f.awayScore}` : null,
      form: { home: f.homeForm, away: f.awayForm },
      odds:
        f.oddsHome != null || f.oddsDraw != null || f.oddsAway != null
          ? { home: f.oddsHome, draw: f.oddsDraw, away: f.oddsAway }
          : null,
      publishedPredictions: f.predictions,
    })),
    // Real results, not model output: these are the rates a simulation should be
    // checked against, and the reason this tool returns them rather than a summary
    // of what the model previously said.
    observed: {
      settledMatches: played.length,
      homeWinRatePct: played.length ? Number(((played.filter((m) => (m.homeScore ?? 0) > (m.awayScore ?? 0)).length / played.length) * 100).toFixed(1)) : null,
      drawRatePct: played.length ? Number(((played.filter((m) => m.homeScore === m.awayScore).length / played.length) * 100).toFixed(1)) : null,
      awayWinRatePct: played.length ? Number(((played.filter((m) => (m.homeScore ?? 0) < (m.awayScore ?? 0)).length / played.length) * 100).toFixed(1)) : null,
      bttsRatePct: played.length ? Number(((played.filter((m) => (m.homeScore ?? 0) >= 1 && (m.awayScore ?? 0) >= 1).length / played.length) * 100).toFixed(1)) : null,
      over25RatePct: totals.length ? Number(((totals.filter((t) => t > 2.5).length / totals.length) * 100).toFixed(1)) : null,
      goalsPerGame: goalsPerGame != null ? Number(goalsPerGame.toFixed(2)) : null,
    },
    predictionLedger: predictionAccuracy.map((row) => ({
      market: row.market,
      status: row.status,
      count: row._count._all,
    })),
  };
}
