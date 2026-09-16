import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyDixonColes,
  DEFAULT_MARKET_WEIGHT,
  DEFAULT_RHO,
  decideMatch,
  describeDecision,
  dixonColesTau,
  estimateRho,
  fitMatrixToMarket,
  isModeledSport,
  MODELED_SPORT,
  outcomeRates,
  poissonDrawRate,
  RHO_MAX,
  RHO_MIN,
} from "../../src/lib/sports-forecast";
import { predictMarkets } from "../../src/lib/sports-intelligence";
import type { CompetitionTrend } from "../../src/lib/sports-trends";
import type { NormalizedMatch } from "../../src/lib/sports";

const LAMBDA_HOME = 1.5;
const LAMBDA_AWAY = 1.2;

function poissonGrid(lambdaHome: number, lambdaAway: number, maxGoals = 8): number[][] {
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

const sumMatrix = (m: number[][]): number => m.reduce((n, row) => n + row.reduce((x, y) => x + y, 0), 0);

describe("dixonColesTau", () => {
  it("is the standard low-score factor and leaves every other scoreline alone", () => {
    const rho = -0.1;
    expect(dixonColesTau(0, 0, LAMBDA_HOME, LAMBDA_AWAY, rho)).toBeCloseTo(1 - LAMBDA_HOME * LAMBDA_AWAY * rho, 10);
    expect(dixonColesTau(1, 1, LAMBDA_HOME, LAMBDA_AWAY, rho)).toBeCloseTo(1 - rho, 10);
    expect(dixonColesTau(0, 1, LAMBDA_HOME, LAMBDA_AWAY, rho)).toBeCloseTo(1 + LAMBDA_HOME * rho, 10);
    expect(dixonColesTau(1, 0, LAMBDA_HOME, LAMBDA_AWAY, rho)).toBeCloseTo(1 + LAMBDA_AWAY * rho, 10);
    for (const [h, a] of [[2, 0], [0, 2], [3, 3], [4, 1], [5, 0]]) {
      expect(dixonColesTau(h!, a!, LAMBDA_HOME, LAMBDA_AWAY, rho)).toBe(1);
    }
  });

  it("collapses to independent Poisson when rho is zero", () => {
    for (let h = 0; h <= 3; h++) {
      for (let a = 0; a <= 3; a++) {
        expect(dixonColesTau(h, a, LAMBDA_HOME, LAMBDA_AWAY, 0)).toBe(1);
      }
    }
  });
});

describe("applyDixonColes", () => {
  it("renormalises so the matrix is still a probability distribution", () => {
    const corrected = applyDixonColes(poissonGrid(LAMBDA_HOME, LAMBDA_AWAY), LAMBDA_HOME, LAMBDA_AWAY, DEFAULT_RHO);
    expect(sumMatrix(corrected)).toBeCloseTo(1, 9);
    for (const row of corrected) {
      for (const p of row) expect(p).toBeGreaterThanOrEqual(0);
    }
  });

  it("raises the draw probability, which is the whole point of the correction", () => {
    const base = poissonGrid(LAMBDA_HOME, LAMBDA_AWAY);
    const corrected = applyDixonColes(base, LAMBDA_HOME, LAMBDA_AWAY, DEFAULT_RHO);
    expect(outcomeRates(corrected).draw).toBeGreaterThan(outcomeRates(base).draw);
  });

  it("changes nothing but the truncation normalisation at rho 0", () => {
    // Every tau is 1 here, so the only thing left for the function to do is
    // rescale for the goals the 8x8 grid cannot represent. Every cell must
    // therefore scale by the SAME factor — that is the precise claim, and it is
    // stronger than comparing one aggregate rate.
    const base = poissonGrid(LAMBDA_HOME, LAMBDA_AWAY);
    const corrected = applyDixonColes(base, LAMBDA_HOME, LAMBDA_AWAY, 0);
    const scaleFirst = corrected[1]![1]! / base[1]![1]!;
    const scaleSecond = corrected[3]![0]! / base[3]![0]!;
    expect(scaleFirst).toBeCloseTo(scaleSecond, 12);
    expect(sumMatrix(corrected)).toBeCloseTo(1, 12);
    expect(outcomeRates(corrected).draw).toBeCloseTo(outcomeRates(base).draw, 4);
  });
});

describe("estimateRho", () => {
  it("falls back to the published default when the draw rate is unusable", () => {
    for (const bad of [NaN, 0, -0.2, 0.9, Infinity]) {
      const fit = estimateRho(LAMBDA_HOME, LAMBDA_AWAY, bad, 1);
      expect(fit.rho).toBe(DEFAULT_RHO);
      expect(fit.usedDefault).toBe(true);
    }
  });

  it("fits a league that draws more than independent scoring predicts further from zero", () => {
    const quiet = estimateRho(LAMBDA_HOME, LAMBDA_AWAY, 0.22, 1);
    const drawish = estimateRho(LAMBDA_HOME, LAMBDA_AWAY, 0.3, 1);
    expect(drawish.fitted).toBeLessThan(quiet.fitted);
    expect(drawish.fitted).toBeLessThan(0);
  });

  it("never returns a parameter outside the band, even when the data wants more", () => {
    const extreme = estimateRho(LAMBDA_HOME, LAMBDA_AWAY, 0.55, 1);
    expect(extreme.fitted).toBeGreaterThanOrEqual(RHO_MIN);
    expect(extreme.fitted).toBeLessThanOrEqual(RHO_MAX);
  });

  it("shrinks a thin sample back toward the default instead of trusting it", () => {
    const noTrust = estimateRho(LAMBDA_HOME, LAMBDA_AWAY, 0.3, 0);
    expect(noTrust.rho).toBe(DEFAULT_RHO);
    const halfTrust = estimateRho(LAMBDA_HOME, LAMBDA_AWAY, 0.3, 0.5);
    const fullTrust = estimateRho(LAMBDA_HOME, LAMBDA_AWAY, 0.3, 1);
    expect(halfTrust.rho).toBeGreaterThan(fullTrust.rho);
    expect(halfTrust.rho).toBeLessThan(DEFAULT_RHO);
  });
});

describe("poissonDrawRate", () => {
  it("agrees with the rate read off the independent grid", () => {
    expect(poissonDrawRate(LAMBDA_HOME, LAMBDA_AWAY)).toBeCloseTo(
      outcomeRates(poissonGrid(LAMBDA_HOME, LAMBDA_AWAY)).draw,
      12
    );
  });
});

describe("fitMatrixToMarket", () => {
  const base = poissonGrid(LAMBDA_HOME, LAMBDA_AWAY);
  const target = { home: 0.44, draw: 0.29, away: 0.27 };

  it("leaves the matrix untouched at zero weight", () => {
    const { matrix, moved } = fitMatrixToMarket(base, target, 0);
    expect(moved).toBe(false);
    expect(matrix).toEqual(base);
  });

  it("keeps the matrix a probability distribution however far it is moved", () => {
    for (const weight of [0.2, 0.4, 0.75, 1]) {
      const { matrix } = fitMatrixToMarket(base, target, weight);
      expect(sumMatrix(matrix)).toBeCloseTo(1, 9);
    }
  });

  it("meets the target outright at full weight", () => {
    const { matrix } = fitMatrixToMarket(base, target, 1);
    const got = outcomeRates(matrix);
    const total = got.home + got.draw + got.away;
    expect(got.home / total).toBeCloseTo(target.home, 3);
    expect(got.draw / total).toBeCloseTo(target.draw, 3);
    expect(got.away / total).toBeCloseTo(target.away, 3);
  });

  it("preserves the relative shape WITHIN an outcome rather than flattening it", () => {
    const { matrix } = fitMatrixToMarket(base, target, 1);
    // Two home wins of different likelihood must keep their ratio: the tilt is
    // allowed to move mass between outcomes, not to invent a new scoreline model.
    const before = base[2]![0]! / base[3]![0]!;
    const after = matrix[2]![0]! / matrix[3]![0]!;
    expect(after).toBeCloseTo(before, 9);
  });

  it("pulls only part of the way at the engine's default weight", () => {
    const { matrix } = fitMatrixToMarket(base, target, DEFAULT_MARKET_WEIGHT);
    const got = outcomeRates(matrix);
    const total = got.home + got.draw + got.away;
    const before = outcomeRates(base);
    const beforeTotal = before.home + before.draw + before.away;
    const moved = got.home / total - before.home / beforeTotal;
    const full = target.home - before.home / beforeTotal;
    expect(Math.abs(moved)).toBeGreaterThan(0);
    expect(Math.abs(moved)).toBeLessThan(Math.abs(full));
  });
});

describe("decideMatch", () => {
  const strong = { market: "1X2", selection: "Gor Mahia win", confidence: 0.66, valueEdge: 6.5 };

  it("refuses a headline call when the strongest lean is weak, and says why", () => {
    const call = decideMatch({
      candidates: [
        { market: "1X2", selection: "Draw", confidence: 0.42, valueEdge: null },
        { market: "over-under", selection: "Under 2.5 goals", confidence: 0.41, valueEdge: null },
      ],
      settledSample: 40,
      competitionAccuracy: 0.6,
    });
    expect(call.decisive).toBe(false);
    expect(call.reasons.join(" ")).toMatch(/below the 50% bar/);
    expect(call.reasons.join(" ")).toMatch(/genuinely open/);
  });

  it("calls it decisive with both a real edge and a settled record behind it", () => {
    const call = decideMatch({ candidates: [strong], settledSample: 40, competitionAccuracy: 0.61 });
    expect(call.decisive).toBe(true);
    expect(call.priced).toBe(true);
    expect(call.reasons.join(" ")).toMatch(/value against the closing line/);
  });

  it("holds fire when the edge is thinner than the margin", () => {
    const call = decideMatch({
      candidates: [{ ...strong, valueEdge: 0.5 }],
      settledSample: 40,
      competitionAccuracy: 0.6,
    });
    expect(call.decisive).toBe(false);
    expect(call.reasons.join(" ")).toMatch(/2pp is the floor/);
  });

  it("holds fire when the competition has too little settled history to trust the edge", () => {
    const call = decideMatch({ candidates: [strong], settledSample: 4, competitionAccuracy: null });
    expect(call.decisive).toBe(false);
    expect(call.reasons.join(" ")).toMatch(/settled picks in this competition/);
  });

  it("takes the highest-probability market as the headline", () => {
    const call = decideMatch({
      candidates: [
        { market: "1X2", selection: "Home win", confidence: 0.55, valueEdge: null },
        { market: "btts", selection: "Both teams to score", confidence: 0.71, valueEdge: null },
      ],
      settledSample: 30,
      competitionAccuracy: 0.55,
    });
    expect(call.market).toBe("btts");
  });

  it("survives a market list with nothing usable in it", () => {
    const call = decideMatch({ candidates: [], settledSample: 0, competitionAccuracy: null });
    expect(call.decisive).toBe(false);
    expect(call.market).toBe("none");
    expect(describeDecision(call)).toMatch(/Holding fire/);
  });
});

/* ------------------------------------------------------------------ */
/* Integration with the pick pipeline                                  */
/* ------------------------------------------------------------------ */

const match = (overrides: Partial<NormalizedMatch> = {}): NormalizedMatch => ({
  externalId: "test-1",
  provider: "demo",
  sport: "football",
  competition: "FKF Premier League",
  competitionId: "fkf",
  country: "Kenya",
  homeTeam: "Gor Mahia",
  awayTeam: "AFC Leopards",
  homeScore: null,
  awayScore: null,
  status: "SCHEDULED",
  minute: null,
  kickoff: new Date().toISOString(),
  venue: "Kasarani",
  oddsHome: 2.1,
  oddsDraw: 3.2,
  oddsAway: 3.4,
  ...overrides,
});

const trend: CompetitionTrend = {
  competition: "FKF Premier League",
  matches: 60,
  goalsPerMatch: 2.4,
  homeWinRate: 0.4,
  drawRate: 0.33,
  bttsRate: 0.48,
  over25Rate: 0.44,
  updatedAt: new Date().toISOString(),
};

const prior = { competitionAccuracy: 0.6, settledSample: 24 };

const oneXtwo = (picks: ReturnType<typeof predictMarkets>) => picks.find((p) => p.market === "1X2")!;

describe("predictMarkets with the forecasting core", () => {
  it("explains the low-score correction when a competition trend supports it", () => {
    const picks = predictMarkets(match(), { ...prior, trend });
    expect(oneXtwo(picks).rationale).toMatch(/Low-score correction applied/);
    expect(oneXtwo(picks).rationale).toMatch(/draws 33% of matches/);
  });

  it("stays quiet about the correction when there is no trend to fit", () => {
    const picks = predictMarkets(match(), prior);
    expect(oneXtwo(picks).rationale).not.toMatch(/Low-score correction applied/);
  });

  it("carries an explicit decision verdict on the pick a reader acts on", () => {
    const picks = predictMarkets(match(), { ...prior, trend });
    expect(oneXtwo(picks).rationale).toMatch(/(Decisive call:|Holding fire)/);
  });

  it("moves the whole 1X2 distribution toward the de-vigged market, not just one price", () => {
    const withOdds = predictMarkets(match(), prior);
    const without = predictMarkets(match({ oddsHome: null, oddsDraw: null, oddsAway: null }), prior);

    const raw = { home: 1 / 2.1, draw: 1 / 3.2, away: 1 / 3.4 };
    const over = raw.home + raw.draw + raw.away;
    const implied = { home: raw.home / over, draw: raw.draw / over, away: raw.away / over };

    const distance = (p: ReturnType<typeof predictMarkets>) => {
      const o = oneXtwo(p);
      return (
        Math.abs((o.homeWinPct ?? 0) / 100 - implied.home) +
        Math.abs((o.drawPct ?? 0) / 100 - implied.draw) +
        Math.abs((o.awayWinPct ?? 0) / 100 - implied.away)
      );
    };

    expect(distance(withOdds)).toBeLessThan(distance(without));
  });

  it("keeps the four markets coherent after the market fit", () => {
    const picks = predictMarkets(match(), { ...prior, trend });
    const o = oneXtwo(picks);
    const sum = (o.homeWinPct ?? 0) + (o.drawPct ?? 0) + (o.awayWinPct ?? 0);
    expect(sum).toBeGreaterThan(99.5);
    expect(sum).toBeLessThan(100.5);

    // A "both teams to score" headline cannot coexist with a 0-0 correct score
    // being the model's most likely line — they now come from one distribution.
    const cs = picks.find((p) => p.market === "correct-score")!;
    const btts = picks.find((p) => p.market === "btts")!;
    if (cs.selection === "0-0") expect(btts.selection).toBe("Not both teams to score");
  });

  it("still refuses to decide on a fixture with no settled history", () => {
    const picks = predictMarkets(match(), { competitionAccuracy: null, settledSample: 0, trend });
    expect(oneXtwo(picks).rationale).toMatch(/settled pick/);
  });
});

/* ------------------------------------------------------------------ */
/* Sport gate                                                          */
/* ------------------------------------------------------------------ */

const source = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("the football model is never pointed at another sport", () => {
  it("recognises football and nothing else", () => {
    expect(MODELED_SPORT).toBe("football");
    expect(isModeledSport("football")).toBe(true);
    expect(isModeledSport("FOOTBALL")).toBe(true);
    expect(isModeledSport("  Football  ")).toBe(true);
    for (const other of ["basketball", "tennis", "Soccer", "", null, undefined]) {
      expect(isModeledSport(other)).toBe(false);
    }
  });

  it("emits no picks at all for a fixture the model does not describe", () => {
    expect(predictMarkets(match({ sport: "basketball" }), prevWithTrend())).toEqual([]);
  });

  it("filters every read path that feeds the grid on the sport", () => {
    // Contract, not implementation detail: the sweep's fixture read, the
    // kick-off refresh and the trend learner must each say which sport they mean.
    const intelligence = source("src/lib/sports-intelligence.ts");
    expect(intelligence.match(/sport: MODELED_SPORT,/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source("src/lib/sports-trends.ts")).toContain("sport: MODELED_SPORT,");
  });
});

function prevWithTrend() {
  return { ...prior, trend };
}
