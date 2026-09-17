/**
 * Modern forecasting core for the sports prediction engine.
 *
 * Three things live here, all pure and dependency-free so the arithmetic is
 * auditable and unit-testable — a model that moves every pick at once must not
 * be able to hide a mistake:
 *
 *   1. Dixon–Coles low-score correction. Independent Poisson treats the two
 *      sides' goals as unrelated, which is known to understate 0-0 and 1-1 and
 *      overstate 1-0 and 0-1. Every football model published since 1997 exists
 *      partly to fix that, and draws are the outcome our grid most needs to get
 *      right, because a miscalibrated draw is what turns a "value" 1X2 pick into
 *      a losing one.
 *
 *   2. A market-consistent tilt. When published odds exist we want the market's
 *      information in the model, but the pick table must stay one coherent
 *      scoreline distribution. Scaling `pHome`/`pDraw`/`pAway` after the grid is
 *      built (what the engine used to do) silently desynchronises the 1X2 pick
 *      from the correct-score, over/under and BTTS picks that still came from
 *      the untouched grid. `fitMatrixToMarket` instead moves the whole matrix so
 *      all four markets tell the same story.
 *
 *   3. An explicit decision — including the decision not to decide. A forecast
 *      that always emits a confident pick is not a forecast. `decideMatch`
 *      returns either one headline call or the concrete reasons it is holding
 *      fire, so the UI never has to invent conviction.
 */

/**
 * Dixon–Coles dependency parameter. Negative values raise the probability of
 * 0-0 and 1-1 and lower 1-0 and 0-1, which is the empirically observed
 * correction; a value of 0 recovers plain independent Poisson.
 *
 * -0.10 is a mid-range published estimate for league football. It is only the
 * fallback: when competition results exist, `estimateRho` fits the parameter to
 * the draw rate this competition is actually producing.
 */
export const DEFAULT_RHO = -0.1;
/** Fitted rho outside this band is rejected as noise, not signal. */
export const RHO_MIN = -0.18;
export const RHO_MAX = 0;

/** How much of the de-vigged market to fold in. Mirrors the engine's long-standing blend. */
export const DEFAULT_MARKET_WEIGHT = 0.4;

/** A pick needs at least this modelled probability to be called decisive. */
export const MIN_DECISIVE_CONFIDENCE = 0.5;
/** Settled picks in the competition before the model trusts its own edge. */
export const MIN_DECISIVE_SAMPLE = 20;
import { SPORTS_SCOPE, type SportsScope } from "@/lib/sports-scope";

/** Percentage points above the market's implied price before an edge is real. */
export const MIN_DECISIVE_EDGE = 2;

const round = (n: number, dp = 4): number => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * The only sport this model set describes.
 *
 * 1X2, over/under 2.5, BTTS and correct score are FOOTBALL markets and the grid
 * behind them assumes goal counts, so the model must never be pointed at
 * anything else. The feed does carry other sports — reading the live database
 * found basketball fixtures being handed a football 1X2 with a "Both teams to
 * score" headline, and a learned "149.73 goals per game" trend for a basketball
 * cup — so the gate lives here and every caller filters on it, rather than each
 * call site assuming someone upstream already did.
 *
 * The value comes from `sports-scope` rather than being written here, so the
 * desk's scope and the model's scope are one constant: they were two literals a
 * file apart, which is how the board and the picks could disagree about what
 * this desk covers.
 */
export const MODELED_SPORT: SportsScope = SPORTS_SCOPE;

/**
 * Strict equality, deliberately: unlike the request scope it does NOT accept
 * `soccer`. A fixture labelled `soccer` did not come from a provider this desk
 * controls, and quietly modelling it is the mistake this gate exists to stop.
 */
export function isModeledSport(sport: string | null | undefined): boolean {
  return (sport ?? "").trim().toLowerCase() === MODELED_SPORT;
}

/**
 * The Dixon–Coles low-score dependency factor for a single scoreline.
 *
 * Only the four lowest scorelines deviate from 1; every other cell is the plain
 * product of the two Poisson masses.
 */
export function dixonColesTau(
  h: number,
  a: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number
): number {
  if (rho === 0) return 1;
  if (h === 0 && a === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (h === 0 && a === 1) return 1 + lambdaHome * rho;
  if (h === 1 && a === 0) return 1 + lambdaAway * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

export interface GridOutcomeRates {
  home: number;
  draw: number;
  away: number;
  over25: number;
  btts: number;
}

/** Read the market-relevant rates straight off a scoreline matrix. */
export function outcomeRates(matrix: number[][]): GridOutcomeRates {
  let home = 0;
  let draw = 0;
  let away = 0;
  let over25 = 0;
  let btts = 0;
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < (matrix[h]?.length ?? 0); a++) {
      const p = matrix[h]![a] ?? 0;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
      if (h + a >= 3) over25 += p;
      if (h >= 1 && a >= 1) btts += p;
    }
  }
  return { home, draw, away, over25, btts };
}

/**
 * Apply the low-score correction and renormalise.
 *
 * The correction changes the total mass, so the matrix is rescaled afterwards;
 * without that, every downstream probability would be quietly inflated when rho
 * is negative and deflated when it is positive.
 */
export function applyDixonColes(
  matrix: number[][],
  lambdaHome: number,
  lambdaAway: number,
  rho: number
): number[][] {
  const out: number[][] = [];
  let total = 0;
  for (let h = 0; h < matrix.length; h++) {
    out[h] = [];
    for (let a = 0; a < matrix[h]!.length; a++) {
      const tau = dixonColesTau(h, a, lambdaHome, lambdaAway, rho);
      // A negative tau would be a negative probability; the bounded rho band and
      // the lambda clamps upstream make that unreachable, but clamp anyway so a
      // future caller cannot smuggle one through.
      const p = Math.max(0, (matrix[h]![a] ?? 0) * tau);
      out[h]![a] = p;
      total += p;
    }
  }
  if (total <= 0) return matrix.map((row) => [...row]);
  for (let h = 0; h < out.length; h++) {
    for (let a = 0; a < out[h]!.length; a++) out[h]![a] = out[h]![a]! / total;
  }
  return out;
}

/**
 * Fit rho to the draw rate a competition is actually producing.
 *
 * Solved by a bounded search rather than a closed form: the relationship between
 * rho and the resulting draw probability is smooth and monotonic on the rho band,
 * so 24 evaluations of an 9×9 matrix locate it far past the precision that
 * matters, and the search cannot wander off into a nonsense parameter the way an
 * unconstrained optimiser can.
 *
 * `trust` (0..1) shrinks the fitted value toward {@link DEFAULT_RHO}, so a thin
 * sample nudges and a full season leans — the same discipline the rest of the
 * engine uses for form.
 */
export function estimateRho(
  lambdaHome: number,
  lambdaAway: number,
  observedDrawRate: number,
  trust = 1
): { rho: number; fitted: number; usedDefault: boolean } {
  const trustClamped = Math.min(Math.max(trust, 0), 1);
  if (
    !Number.isFinite(observedDrawRate) ||
    observedDrawRate <= 0.05 ||
    observedDrawRate >= 0.6 ||
    !Number.isFinite(lambdaHome) ||
    !Number.isFinite(lambdaAway)
  ) {
    return { rho: DEFAULT_RHO, fitted: DEFAULT_RHO, usedDefault: true };
  }

  const base = poissonMatrix(lambdaHome, lambdaAway);
  const target = observedDrawRate;
  const drawAt = (rho: number): number => outcomeRates(applyDixonColes(base, lambdaHome, lambdaAway, rho)).draw;

  // The draw probability rises as rho falls, so search the band directly and
  // keep the closest rho. Evaluating the endpoints also proves the fit is
  // reachable: if even RHO_MIN cannot produce this draw rate, the honest answer
  // is the bound, not an extrapolated one.
  let best = DEFAULT_RHO;
  let bestGap = Infinity;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const rho = RHO_MIN + ((RHO_MAX - RHO_MIN) * i) / steps;
    const gap = Math.abs(drawAt(rho) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = rho;
    }
  }
  const fitted = round(Math.min(Math.max(best, RHO_MIN), RHO_MAX), 4);
  const rho = round(DEFAULT_RHO + (fitted - DEFAULT_RHO) * trustClamped, 4);
  return { rho, fitted, usedDefault: false };
}

/**
 * Draw probability implied by INDEPENDENT Poisson at these expectations.
 *
 * Exported because it is the counterfactual the fitted rho is judged against:
 * "this league draws 31% of the time where independent scoring predicts 24%" is
 * the sentence that justifies the correction, and it should be computed the same
 * way wherever it is printed.
 */
export function poissonDrawRate(lambdaHome: number, lambdaAway: number, maxGoals = 8): number {
  return outcomeRates(poissonMatrix(lambdaHome, lambdaAway, maxGoals)).draw;
}

function poissonMatrix(lambdaHome: number, lambdaAway: number, maxGoals = 8): number[][] {
  const mass = (k: number, lambda: number): number => {
    let fact = 1;
    for (let i = 2; i <= k; i++) fact *= i;
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / fact;
  };
  const out: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    out[h] = [];
    for (let a = 0; a <= maxGoals; a++) out[h]![a] = mass(h, lambdaHome) * mass(a, lambdaAway);
  }
  return out;
}

/**
 * Move a whole scoreline matrix so its 1X2 masses match a target, without
 * throwing away its shape.
 *
 * This is iterative proportional fitting on the three outcome groups: each pass
 * scales every home-win cell by one factor, every draw cell by another and every
 * away-win cell by a third, then renormalises. It converges in a handful of
 * passes, changes only the mass *between* outcomes, and leaves the relative
 * shape within each outcome intact — so the corrected scoreline, over/under and
 * BTTS picks all shift with the 1X2 instead of contradicting it.
 *
 * `weight` is the shrinkage toward the target (0 = ignore it, 1 = adopt it
 * outright). Keeping it below 1 is the point: the market is a strong prior, not
 * an oracle, and a model that simply adopts the closing line has no edge to
 * offer and nothing to report.
 */
export function fitMatrixToMarket(
  matrix: number[][],
  target: { home: number; draw: number; away: number },
  weight = DEFAULT_MARKET_WEIGHT
): { matrix: number[][]; moved: boolean; before: GridOutcomeRates } {
  const before = outcomeRates(matrix);
  const total = before.home + before.draw + before.away;
  const w = Math.min(Math.max(weight, 0), 1);
  if (total <= 0 || w <= 0) return { matrix: matrix.map((row) => [...row]), moved: false, before };

  const want = {
    home: (1 - w) * (before.home / total) + w * target.home,
    draw: (1 - w) * (before.draw / total) + w * target.draw,
    away: (1 - w) * (before.away / total) + w * target.away,
  };
  const wantTotal = want.home + want.draw + want.away || 1;
  const aim = { home: want.home / wantTotal, draw: want.draw / wantTotal, away: want.away / wantTotal };

  let current = matrix.map((row) => [...row]);
  let factors = { home: 1, draw: 1, away: 1 };
  for (let pass = 0; pass < 12; pass++) {
    const got = outcomeRates(current);
    const gotTotal = got.home + got.draw + got.away || 1;
    const scale = {
      home: aim.home > 0 ? aim.home / (got.home / gotTotal || 1e-9) : 1,
      draw: aim.draw > 0 ? aim.draw / (got.draw / gotTotal || 1e-9) : 1,
      away: aim.away > 0 ? aim.away / (got.away / gotTotal || 1e-9) : 1,
    };
    // Damping: a full step overshoots on the first passes because the group
    // masses are not independent. Half steps converge smoothly instead of
    // oscillating between passes.
    factors = {
      home: factors.home * (1 + (scale.home - 1) * 0.5),
      draw: factors.draw * (1 + (scale.draw - 1) * 0.5),
      away: factors.away * (1 + (scale.away - 1) * 0.5),
    };
    const next: number[][] = [];
    let sum = 0;
    for (let h = 0; h < current.length; h++) {
      next[h] = [];
      for (let a = 0; a < current[h]!.length; a++) {
        const f = h > a ? factors.home : h === a ? factors.draw : factors.away;
        const p = Math.max(0, (matrix[h]![a] ?? 0) * f);
        next[h]![a] = p;
        sum += p;
      }
    }
    if (sum <= 0) break;
    for (let h = 0; h < next.length; h++) {
      for (let a = 0; a < next[h]!.length; a++) next[h]![a] = next[h]![a]! / sum;
    }
    current = next;

    const now = outcomeRates(current);
    const nowTotal = now.home + now.draw + now.away || 1;
    if (
      Math.abs(now.home / nowTotal - aim.home) < 1e-6 &&
      Math.abs(now.draw / nowTotal - aim.draw) < 1e-6
    ) {
      break;
    }
  }

  const after = outcomeRates(current);
  return { matrix: current, moved: Math.abs(after.home - before.home) > 1e-9, before };
}

/* ------------------------------------------------------------------ */
/* Decisiveness                                                        */
/* ------------------------------------------------------------------ */

export interface DecisionCandidate {
  market: string;
  selection: string;
  /** Modelled probability of the selection, 0..1. */
  confidence: number;
  /** Percentage points above the market's implied price, when odds exist. */
  valueEdge: number | null;
}

export interface DecisionInput {
  candidates: DecisionCandidate[];
  /** Settled picks in this competition — the evidence behind the confidence. */
  settledSample: number;
  /** Observed accuracy of settled picks, 0..1, when a sample exists. */
  competitionAccuracy: number | null;
}

export interface DecisiveCall extends DecisionCandidate {
  decisive: boolean;
  /** Why it is decisive, or the specific gaps that stopped it being so. */
  reasons: string[];
  /** True when the edge is priced against a real market rather than model-only. */
  priced: boolean;
}

export function decideMatch(input: DecisionInput): DecisiveCall {
  const reasons: string[] = [];
  const usable = input.candidates.filter((c) => Number.isFinite(c.confidence));

  if (usable.length === 0) {
    return {
      market: "none",
      selection: "No call",
      confidence: 0,
      valueEdge: null,
      decisive: false,
      priced: false,
      reasons: ["No market produced a usable probability."],
    };
  }

  // Rank by confidence, and treat a priced edge as a tie-breaker rather than the
  // primary key: an unpriced strong favourite is still the better headline call
  // than a thin edge on a coin-flip.
  const ranked = [...usable].sort(
    (a, b) => b.confidence - a.confidence || (b.valueEdge ?? -99) - (a.valueEdge ?? -99)
  );
  const top = ranked[0]!;
  const priced = top.valueEdge != null;
  const evidenceOk = input.settledSample >= MIN_DECISIVE_SAMPLE;

  if (top.confidence < MIN_DECISIVE_CONFIDENCE) {
    const behind = ranked[1];
    reasons.push(
      `Strongest lean is ${(top.confidence * 100).toFixed(0)}%, below the ${(
        MIN_DECISIVE_CONFIDENCE * 100
      ).toFixed(0)}% bar for a decisive call.`
    );
    if (behind && behind.confidence >= 0.4) {
      reasons.push(
        `${behind.selection} is close behind at ${(behind.confidence * 100).toFixed(0)}%, so the fixture is genuinely open.`
      );
    }
    return { ...top, decisive: false, priced, reasons };
  }

  if (priced && top.valueEdge! < MIN_DECISIVE_EDGE) {
    reasons.push(
      `Only ${top.valueEdge!.toFixed(1)}pp above the market's implied price; ${MIN_DECISIVE_EDGE}pp is the floor for calling it value.`
    );
  }

  if (!evidenceOk) {
    reasons.push(
      `Only ${input.settledSample} settled pick${input.settledSample === 1 ? "" : "s"} in this competition, below the ${MIN_DECISIVE_SAMPLE} needed to trust the edge.`
    );
  }

  // A decisive call needs the probability bar met AND at least one form of
  // independent support: a priced edge, or a settled record in this competition.
  const decisive = (priced ? top.valueEdge! >= MIN_DECISIVE_EDGE : true) && evidenceOk;

  if (decisive) {
    if (priced) reasons.push(`${top.valueEdge!.toFixed(1)}pp of value against the closing line.`);
    reasons.push(
      `Backed by ${input.settledSample} settled picks in this competition${
        input.competitionAccuracy != null
          ? ` running at ${(input.competitionAccuracy * 100).toFixed(0)}% accuracy`
          : ""
      }.`
    );
  }

  return { ...top, decisive, priced, reasons };
}

/**
 * One-line verdict for the rationale text a reader actually sees. Kept here so
 * the wording of "we are holding fire" cannot drift between callers.
 */
export function describeDecision(call: DecisiveCall): string {
  if (call.decisive) {
    return `Decisive call: ${call.selection} at ${(call.confidence * 100).toFixed(0)}%.`;
  }
  return `Holding fire on a headline call — ${call.reasons[0] ?? "the model has no edge here"}`;
}
