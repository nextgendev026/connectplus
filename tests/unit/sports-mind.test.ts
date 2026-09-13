import { describe, expect, it } from "vitest";
import {
  consultMind,
  mapWithConcurrency,
  predictMarkets,
  type MindMemory,
  type PredictionPrior,
} from "../../src/lib/sports-intelligence";
import type { NormalizedMatch } from "../../src/lib/sports";

/**
 * Combined-mind contract.
 *
 * The prediction model blends the Poisson grid with the hive's own learned
 * memories. The rules that must hold:
 *   • a fixture with no history is predicted by the base model, untouched;
 *   • a lesson only votes when it names BOTH teams (never a same-name accident);
 *   • the mind's influence grows with the evidence and is capped.
 */

function fixture(overrides: Partial<NormalizedMatch> = {}): NormalizedMatch {
  return {
    externalId: "e1",
    provider: "demo",
    sport: "football",
    competition: "FKF Premier League",
    country: "Kenya",
    homeTeam: "Gor Mahia",
    awayTeam: "AFC Leopards",
    homeScore: null,
    awayScore: null,
    status: "SCHEDULED",
    minute: null,
    kickoff: "2026-09-13T15:00:00.000Z",
    venue: null,
    oddsHome: null,
    oddsDraw: null,
    oddsAway: null,
    ...overrides,
  };
}

function lesson(home: number, away: number): MindMemory {
  return {
    source: "sports",
    category: "wisdom",
    content: `Result lesson: Gor Mahia win landed — Gor Mahia ${home}-${away} AFC Leopards (FKF Premier League). Modelled confidence was 61%.`,
    tags: "result,lesson,sport:football,fkf premier league,gor mahia,afc leopards",
    metadata: JSON.stringify({ won: home > away, confidence: 0.61 }),
    confidence: 0.75,
  };
}

function trend(goals: number, finished: number): MindMemory {
  return {
    source: "sports",
    category: "trend",
    content: "FKF Premier League snapshot",
    tags: "sport:football:fkf premier league,sports,football,fkf premier league",
    metadata: JSON.stringify({ goals, finished }),
    confidence: 0.6,
  };
}

const prior: PredictionPrior = { competitionAccuracy: null, settledSample: 0 };

describe("consultMind", () => {
  it("leaves a fixture with no history entirely to the base model", () => {
    const signal = consultMind([], fixture());
    expect(signal.heat).toBe(0);
    expect(signal.momentum.home).toBe(0.5);
    expect(signal.notes).toEqual([]);
  });

  it("refuses to speak from fewer than three lessons", () => {
    const signal = consultMind([lesson(2, 0), lesson(1, 0)], fixture());
    expect(signal.lessons).toBe(2);
    expect(signal.heat).toBe(0);
    expect(signal.momentum.home).toBe(0.5);
  });

  it("turns comparable lessons into a home-side momentum read", () => {
    const signal = consultMind(
      [lesson(2, 0), lesson(3, 1), lesson(0, 1), lesson(1, 1), lesson(2, 1)],
      fixture()
    );
    expect(signal.lessons).toBe(5);
    expect(signal.momentum.home).toBeCloseTo(3 / 5, 5);
    expect(signal.heat).toBeCloseTo(5 / 8, 5);
    expect(signal.notes[0]).toContain("5 comparable lessons");
  });

  it("ignores a lesson that does not name both teams", () => {
    const other: MindMemory = {
      ...lesson(1, 0),
      content: "Result lesson: Simba SC win landed — Simba SC 1-0 Young Africans (Tanzania Premier League).",
      tags: "result,lesson,sport:football,tanzania premier league,simba sc,young africans",
    };
    const signal = consultMind([other, other, other, other], fixture());
    expect(signal.lessons).toBe(0);
    expect(signal.heat).toBe(0);
  });

  it("learns competition scoring without pretending to know the teams", () => {
    const signal = consultMind([trend(60, 20)], fixture());
    expect(signal.avgGoals).toBeCloseTo(3, 5);
    expect(signal.momentum.home).toBe(0.5);
    expect(signal.heat).toBeLessThanOrEqual(0.4);
    expect(signal.notes.join(" ")).toContain("3.00 goals/game");
  });

  it("caps heat at 1 however much history exists", () => {
    const many = Array.from({ length: 20 }, () => lesson(2, 0));
    expect(consultMind(many, fixture()).heat).toBe(1);
  });
});

describe("predictMarkets with the combined mind", () => {
  it("produces one pick per market regardless of the mind", () => {
    const picks = predictMarkets(fixture(), prior, consultMind([], fixture()));
    expect(picks.map((p) => p.market)).toEqual(["1X2", "over-under", "btts", "correct-score"]);
  });

  it("moves towards the team the mind has seen win, and says so", () => {
    const neutral = predictMarkets(fixture(), prior, consultMind([], fixture()));
    const learned = predictMarkets(
      fixture(),
      prior,
      consultMind(Array.from({ length: 8 }, () => lesson(3, 0)), fixture())
    );

    const neutralHome = neutral.find((p) => p.market === "1X2")!.homeWinPct!;
    const learnedHome = learned.find((p) => p.market === "1X2")!.homeWinPct!;
    expect(learnedHome).toBeGreaterThan(neutralHome);
    expect(learned[0]!.rationale).toContain("Hive mind:");
    expect(neutral[0]!.rationale).not.toContain("Hive mind:");
  });

  it("keeps the markets mutually consistent after the mind adjusts the grid", () => {
    const picks = predictMarkets(
      fixture(),
      prior,
      consultMind(Array.from({ length: 8 }, () => lesson(4, 0)), fixture())
    );
    const over = picks.find((p) => p.market === "over-under")!;
    const score = picks.find((p) => p.market === "correct-score")!;
    // A heavy home lean must not also produce an "Under" lean with a 0-0 modal
    // scoreline — both come from the same grid.
    if (/^over/i.test(over.selection)) {
      expect(score.selection).not.toBe("0-0");
    }
  });
});

describe("mapWithConcurrency", () => {
  it("processes every item exactly once", async () => {
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      seen.push(n);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("never exceeds the in-flight limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("handles an empty list and a limit larger than the list", async () => {
    await expect(mapWithConcurrency([], 4, async () => {})).resolves.toBeUndefined();
    const seen: number[] = [];
    await mapWithConcurrency([1, 2], 99, async (n) => {
      seen.push(n);
    });
    expect(seen).toHaveLength(2);
  });
});
