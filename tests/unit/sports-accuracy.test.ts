import { describe, expect, it } from "vitest";
import {
  breakdownBy,
  calibrationBuckets,
  compareStrategies,
  dailySeries,
  summarize,
  type GradedPick,
} from "../../src/lib/sports-accuracy";

function pick(overrides: Partial<GradedPick> = {}): GradedPick {
  return {
    market: "1X2",
    confidence: 0.6,
    won: true,
    settledAt: "2026-09-10T12:00:00.000Z",
    competition: "FKF Premier League",
    ...overrides,
  };
}

/** A settled set with an exact win rate, so the arithmetic is obvious. */
function picksWith(winRate: number, count = 20): GradedPick[] {
  const won = Math.round(winRate * count);
  return Array.from({ length: count }, (_, i) => pick({ won: i < won }));
}

describe("summarize", () => {
  it("returns nulls rather than zeros when nothing is settled", () => {
    const s = summarize([]);
    expect(s.settled).toBe(0);
    expect(s.accuracy).toBeNull();
    expect(s.brier).toBeNull();
    expect(s.logLoss).toBeNull();
    expect(s.calibrationGap).toBeNull();
  });

  it("computes accuracy, Brier and log loss for a settled set", () => {
    const s = summarize([
      pick({ confidence: 0.6, won: true }),
      pick({ confidence: 0.7, won: true }),
      pick({ confidence: 0.8, won: false }),
    ]);
    expect(s.settled).toBe(3);
    expect(s.won).toBe(2);
    expect(s.lost).toBe(1);
    expect(s.accuracy).toBeCloseTo(66.7, 1);
    expect(s.avgConfidence).toBeCloseTo(70, 1);
    expect(s.brier).toBeCloseTo(0.2967, 3);
    expect(s.logLoss).toBeCloseTo(0.8256, 3);
    // Stated confidence exceeds the observed rate: mildly over-confident.
    expect(s.calibrationGap).toBeCloseTo(3.3, 1);
  });

  it("scores a perfectly calibrated coin flip better than a wild overclaim", () => {
    const calibrated = summarize([
      pick({ confidence: 0.5, won: true }),
      pick({ confidence: 0.5, won: false }),
    ]);
    const overclaim = summarize([
      pick({ confidence: 0.95, won: true }),
      pick({ confidence: 0.95, won: false }),
    ]);
    expect(calibrated.brier!).toBeLessThan(overclaim.brier!);
    expect(calibrated.calibrationGap!).toBeCloseTo(0, 1);
  });
});

describe("calibrationBuckets", () => {
  it("bands picks by stated confidence and exposes the gap", () => {
    const buckets = calibrationBuckets([
      pick({ confidence: 0.65, won: true }),
      pick({ confidence: 0.72, won: true }),
      pick({ confidence: 0.85, won: false }),
    ]);
    expect(buckets).toHaveLength(3);
    expect(buckets[0]!.label).toBe("60–70%");
    expect(buckets[0]!.actualRate).toBe(100);
    expect(buckets[0]!.gap).toBeCloseTo(35, 1);
    const top = buckets[2]!;
    expect(top.label).toBe("80–90%");
    expect(top.actualRate).toBe(0);
    expect(top.gap).toBeCloseTo(-85, 1);
  });

  it("omits empty buckets so the table stays readable", () => {
    const buckets = calibrationBuckets([pick({ confidence: 0.42 })]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.label).toBe("40–50%");
  });
});

describe("breakdownBy", () => {
  it("groups and ranks by sample size", () => {
    const rows = breakdownBy(
      [
        pick({ market: "1X2", won: true }),
        pick({ market: "1X2", won: false }),
        pick({ market: "btts", won: true }),
      ],
      (p) => p.market
    );
    expect(rows[0]!.key).toBe("1X2");
    expect(rows[0]!.settled).toBe(2);
    expect(rows[0]!.accuracy).toBe(50);
    expect(rows[1]!.key).toBe("btts");
    expect(rows[1]!.accuracy).toBe(100);
  });

  it("falls back to a label for a missing key", () => {
    const rows = breakdownBy([pick({ competition: "" })], (p) => p.competition);
    expect(rows[0]!.key).toBe("Unknown");
  });
});

describe("compareStrategies (model vs the closing line)", () => {
  it("refuses to call a verdict on a thin sample", () => {
    const c = compareStrategies(picksWith(1, 5), picksWith(0, 5));
    expect(c.overlap).toBe(5);
    expect(c.edgePp).toBe(100);
    expect(c.verdict).toBe("insufficient");
  });

  it("declares a win once the model clears the baseline by 2pp or more", () => {
    const c = compareStrategies(picksWith(0.7), picksWith(0.6));
    expect(c.overlap).toBe(20);
    expect(c.edgePp).toBe(10);
    expect(c.verdict).toBe("beats-line");
    expect(c.model.accuracy).toBe(70);
    expect(c.baseline.accuracy).toBe(60);
  });

  it("reports being behind the line rather than hiding it", () => {
    const c = compareStrategies(picksWith(0.5), picksWith(0.6));
    expect(c.edgePp).toBe(-10);
    expect(c.verdict).toBe("below-line");
  });

  it("treats a sub-2pp difference as level with the line", () => {
    const c = compareStrategies(picksWith(0.7, 30), picksWith(0.7, 30));
    expect(c.edgePp).toBe(0);
    expect(c.verdict).toBe("matches-line");
  });

  it("has no edge to report until both strategies have settled picks", () => {
    const c = compareStrategies(picksWith(0.8, 25), []);
    expect(c.edgePp).toBeNull();
    expect(c.verdict).toBe("insufficient");
    expect(c.overlap).toBe(0);
  });

  it("uses the smaller of the two samples as the honest overlap", () => {
    const c = compareStrategies(picksWith(0.7, 40), picksWith(0.6, 25));
    expect(c.overlap).toBe(25);
    expect(c.verdict).toBe("beats-line");
  });
});

describe("dailySeries", () => {
  const now = new Date("2026-09-13T09:00:00.000Z");

  it("returns a continuous window with empty days included", () => {
    const series = dailySeries(
      [
        pick({ settledAt: "2026-09-13T01:00:00.000Z", won: true }),
        pick({ settledAt: "2026-09-13T02:00:00.000Z", won: false }),
        pick({ settledAt: "2026-09-11T02:00:00.000Z", won: true }),
      ],
      3,
      now
    );
    expect(series.map((d) => d.date)).toEqual(["2026-09-11", "2026-09-12", "2026-09-13"]);
    expect(series[0]!.settled).toBe(1);
    expect(series[0]!.accuracy).toBe(100);
    expect(series[1]!.settled).toBe(0);
    expect(series[1]!.accuracy).toBeNull();
    expect(series[2]!.settled).toBe(2);
    expect(series[2]!.won).toBe(1);
    expect(series[2]!.accuracy).toBe(50);
  });

  it("ignores picks outside the window", () => {
    const series = dailySeries([pick({ settledAt: "2026-08-01T01:00:00.000Z" })], 3, now);
    expect(series.reduce((n, d) => n + d.settled, 0)).toBe(0);
  });
});
