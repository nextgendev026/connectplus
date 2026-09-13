import { describe, expect, it } from "vitest";
import { gradePick, predictMarkets, MARKETS } from "../../src/lib/sports-intelligence";
import type { NormalizedMatch } from "../../src/lib/sports";

const match: NormalizedMatch = {
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
};

const prior = { competitionAccuracy: 0.6, settledSample: 20 };

describe("predictMarkets", () => {
  it("emits exactly one pick for every supported market", () => {
    const picks = predictMarkets(match, prior);
    expect(picks.map((p) => p.market).sort()).toEqual([...MARKETS].sort());
  });

  it("keeps the 1X2 probabilities coherent", () => {
    const picks = predictMarkets(match, prior);
    const oneXtwo = picks.find((p) => p.market === "1X2")!;
    const sum = (oneXtwo.homeWinPct ?? 0) + (oneXtwo.drawPct ?? 0) + (oneXtwo.awayWinPct ?? 0);
    expect(sum).toBeGreaterThan(99.5);
    expect(sum).toBeLessThan(100.5);
    expect(oneXtwo.confidence).toBeGreaterThanOrEqual(0.34);
    expect(oneXtwo.confidence).toBeLessThanOrEqual(0.9);
  });

  it("labels the goal and BTTS markets in a gradeable way", () => {
    const picks = predictMarkets(match, prior);
    const ou = picks.find((p) => p.market === "over-under")!;
    const btts = picks.find((p) => p.market === "btts")!;
    const cs = picks.find((p) => p.market === "correct-score")!;
    expect(ou.selection).toMatch(/^(Over|Under) 2\.5 goals$/);
    expect(btts.selection).toMatch(/^(Both teams to score|Not both teams to score)$/);
    expect(cs.selection).toMatch(/^\d-\d$/);
    expect(cs.confidence).toBeLessThanOrEqual(0.4);
  });

  it("is deterministic for the same fixture", () => {
    expect(predictMarkets(match, prior)).toEqual(predictMarkets(match, prior));
  });
});

describe("gradePick", () => {
  const teams = { home: "Gor Mahia", away: "AFC Leopards" };

  it("grades match-result picks against the actual winner", () => {
    expect(gradePick("1X2", "Gor Mahia win", 2, 1, teams)).toBe(true);
    expect(gradePick("1X2", "Gor Mahia win", 1, 2, teams)).toBe(false);
    expect(gradePick("1X2", "Gor Mahia win", 1, 1, teams)).toBe(false);
    expect(gradePick("1X2", "AFC Leopards win", 1, 2, teams)).toBe(true);
    expect(gradePick("1X2", "Draw", 1, 1, teams)).toBe(true);
    expect(gradePick("1X2", "Draw", 2, 1, teams)).toBe(false);
  });

  it("refuses to grade a stale selection instead of guessing", () => {
    expect(gradePick("1X2", "Nairobi City Stars win", 2, 1, teams)).toBeNull();
    expect(gradePick("1X2", "Gor Mahia win", 2, 1)).toBeNull();
  });

  it("grades over/under 2.5 on total goals", () => {
    expect(gradePick("over-under", "Over 2.5 goals", 2, 1, teams)).toBe(true);
    expect(gradePick("over-under", "Over 2.5 goals", 1, 1, teams)).toBe(false);
    expect(gradePick("over-under", "Under 2.5 goals", 1, 1, teams)).toBe(true);
    expect(gradePick("over-under", "Under 2.5 goals", 3, 1, teams)).toBe(false);
  });

  it("grades both-teams-to-score either way", () => {
    expect(gradePick("btts", "Both teams to score", 1, 1, teams)).toBe(true);
    expect(gradePick("btts", "Both teams to score", 2, 0, teams)).toBe(false);
    expect(gradePick("btts", "Not both teams to score", 2, 0, teams)).toBe(true);
    expect(gradePick("btts", "Not both teams to score", 1, 1, teams)).toBe(false);
  });

  it("grades correct score exactly", () => {
    expect(gradePick("correct-score", "2-1", 2, 1, teams)).toBe(true);
    expect(gradePick("correct-score", "2-1", 1, 1, teams)).toBe(false);
  });

  it("returns null when the score is incomplete or the market is unknown", () => {
    expect(gradePick("1X2", "Gor Mahia win", null, 1, teams)).toBeNull();
    expect(gradePick("1X2", "Gor Mahia win", 2, null, teams)).toBeNull();
    expect(gradePick("half-time", "anything", 1, 0, teams)).toBeNull();
  });
});
