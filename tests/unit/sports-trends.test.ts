import { describe, expect, it } from "vitest";
import { MIN_TREND_MATCHES, summarizeTrend, trendGoalAdjustment } from "@/lib/sports-trends";

/**
 * Competition trends.
 *
 * A wrong trend is worse than no trend: it moves every pick in that competition
 * at once, so the arithmetic that produces it is pinned here rather than trusted.
 */

const now = new Date("2026-09-14T12:00:00.000Z");

function results(pattern: [number, number][]) {
  return pattern.map(([homeScore, awayScore]) => ({ homeScore, awayScore }));
}

describe("summarizeTrend", () => {
  it("refuses to call a handful of matches a trend", () => {
    expect(summarizeTrend("Serie A", results(Array(MIN_TREND_MATCHES - 1).fill([1, 1])), now)).toBeNull();
  });

  it("derives goals, home wins, draws, BTTS and over-2.5 from real scorelines", () => {
    const trend = summarizeTrend(
      "Serie A",
      results([
        [2, 1], // home win, btts, over
        [0, 0], // draw, no btts, under
        [1, 1], // draw, btts, under
        [3, 0], // home win, no btts, over
        [0, 2], // away win, no btts, under
        [2, 2], // draw, btts, over
        [1, 0], // home win, no btts, under
        [4, 2], // home win, btts, over
      ]),
      now
    )!;

    expect(trend.matches).toBe(8);
    // 3 + 0 + 2 + 3 + 2 + 4 + 1 + 6 = 21 goals across 8 matches.
    expect(trend.goalsPerMatch).toBeCloseTo(2.625, 3);
    // 4 home wins of 8.
    expect(trend.homeWinRate).toBeCloseTo(0.5, 3);
    // 3 draws of 8.
    expect(trend.drawRate).toBeCloseTo(0.375, 3);
    // 4 of 8 had both scoring.
    expect(trend.bttsRate).toBeCloseTo(0.5, 3);
    // 4 of 8 reached three goals.
    expect(trend.over25Rate).toBeCloseTo(0.5, 3);
    expect(trend.updatedAt).toBe(now.toISOString());
  });

  it("ignores rows that are not a real scoreline", () => {
    const trend = summarizeTrend(
      "Serie A",
      [
        ...results(Array(8).fill([1, 1])),
        // A provider that published a placeholder must not drag the average.
        { homeScore: -1, awayScore: 3 },
        { homeScore: Number.NaN, awayScore: 2 },
      ],
      now
    )!;
    expect(trend.matches).toBe(8);
    expect(trend.goalsPerMatch).toBe(2);
  });
});

describe("trendGoalAdjustment", () => {
  const highScoring = summarizeTrend("X", results(Array(40).fill([2, 2])), now)!; // 4.0 goals/game
  const lowScoring = summarizeTrend("Y", results(Array(40).fill([0, 0])), now)!; // 0.0 goals/game

  it("lifts both sides toward a high-scoring league without flattening them", () => {
    const { lambdaHome, lambdaAway, applied } = trendGoalAdjustment(highScoring, 1.6, 1.0);
    expect(applied).toBeGreaterThan(0);
    expect(lambdaHome).toBeGreaterThan(1.6);
    expect(lambdaAway).toBeGreaterThan(1.0);
    // The gap between the sides survives: both scale by the same factor.
    expect(lambdaHome / lambdaAway).toBeCloseTo(1.6, 5);
  });

  it("dampens toward a low-scoring league", () => {
    const { lambdaHome, lambdaAway, applied } = trendGoalAdjustment(lowScoring, 1.6, 1.0);
    expect(applied).toBeLessThan(0);
    expect(lambdaHome).toBeLessThan(1.6);
    expect(lambdaAway).toBeLessThan(1.0);
  });

  it("caps how far a trend may move the model", () => {
    // A wildly high-scoring league must not be allowed to double the expectation.
    const absurd = summarizeTrend("Z", results(Array(40).fill([8, 8])), now)!;
    const { lambdaHome, lambdaAway } = trendGoalAdjustment(absurd, 1.5, 1.5);
    expect(lambdaHome).toBeLessThanOrEqual(1.5 * 1.29);
    expect(lambdaAway).toBeLessThanOrEqual(1.5 * 1.29);
  });

  it("leaves the model untouched without enough evidence", () => {
    const thin = summarizeTrend("W", results(Array(MIN_TREND_MATCHES).fill([2, 2])), now);
    if (thin) {
      const { lambdaHome, lambdaAway, applied } = trendGoalAdjustment({ ...thin, matches: 2 }, 1.4, 1.1);
      expect(applied).toBe(0);
      expect(lambdaHome).toBe(1.4);
      expect(lambdaAway).toBe(1.1);
    }
  });

  it("never divides by zero on a degenerate grid", () => {
    const { applied } = trendGoalAdjustment(highScoring, 0, 0);
    expect(applied).toBe(0);
  });
});
