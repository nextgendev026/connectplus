import { describe, expect, it } from "vitest";
import {
  collectMeetings,
  summariseForm,
  toRecentMatch,
  type RecentMatch,
} from "../../src/lib/sports-h2h";

/**
 * Head-to-head and form contract.
 *
 * These helpers are the model's only source of real evidence about a fixture, so
 * an error here does not crash anything — it silently fabricates form and quietly
 * moves predictions. The rules that must hold:
 *
 *   • a provider row only counts when it actually involves the tracked team;
 *   • goals are always reported from the tracked team's point of view;
 *   • an unfinished fixture never becomes a draw;
 *   • when a meeting is put back into fixture order, the sides are not swapped.
 */

/** One TheSportsDB-shaped row. */
const row = (overrides: Record<string, unknown> = {}) => ({
  strHomeTeam: "Arsenal",
  strAwayTeam: "Chelsea",
  intHomeScore: "2",
  intAwayScore: "1",
  strLeague: "English Premier League",
  dateEvent: "2026-09-06",
  strTimestamp: "2026-09-06T14:00:00",
  ...overrides,
});

const recent = (overrides: Partial<RecentMatch> = {}): RecentMatch => ({
  date: "2026-09-06T14:00:00.000Z",
  competition: "English Premier League",
  opponent: "Chelsea",
  home: true,
  goalsFor: 2,
  goalsAgainst: 1,
  result: "W",
  ...overrides,
});

describe("toRecentMatch — only real, finished results count", () => {
  it("reads a home win from the tracked team's point of view", () => {
    const match = toRecentMatch(row(), "Arsenal");
    expect(match).not.toBeNull();
    expect(match!.home).toBe(true);
    expect(match!.opponent).toBe("Chelsea");
    expect(match!.goalsFor).toBe(2);
    expect(match!.goalsAgainst).toBe(1);
    expect(match!.result).toBe("W");
  });

  it("flips a home result when the tracked team was away", () => {
    const match = toRecentMatch(row(), "Chelsea");
    expect(match).not.toBeNull();
    expect(match!.home).toBe(false);
    expect(match!.opponent).toBe("Arsenal");
    // Chelsea lost 1-2 away, so "for" is the away score.
    expect(match!.goalsFor).toBe(1);
    expect(match!.goalsAgainst).toBe(2);
    expect(match!.result).toBe("L");
  });

  it("matches team names case-insensitively", () => {
    expect(toRecentMatch(row(), "arsenal")).not.toBeNull();
    expect(toRecentMatch(row({ strHomeTeam: "  Arsenal  " }), "Arsenal")).not.toBeNull();
  });

  it("rejects a row that does not involve the tracked team", () => {
    expect(toRecentMatch(row(), "Tottenham")).toBeNull();
  });

  it("rejects a row with no teams at all", () => {
    expect(toRecentMatch(row({ strHomeTeam: "", strAwayTeam: "" }), "Arsenal")).toBeNull();
  });

  it("records no result for a fixture with no scoreline", () => {
    const match = toRecentMatch(row({ intHomeScore: null, intAwayScore: null }), "Arsenal");
    expect(match).not.toBeNull();
    expect(match!.result).toBeNull();
    expect(match!.goalsFor).toBeNull();
  });

  it("does not turn an unfinished fixture into a draw", () => {
    const match = toRecentMatch(row({ intHomeScore: "", intAwayScore: "" }), "Arsenal");
    expect(match!.result).not.toBe("D");
  });

  it("falls back to the event date when no timestamp is present", () => {
    const match = toRecentMatch(row({ strTimestamp: null, dateEvent: "2026-05-01" }), "Arsenal");
    expect(match!.date?.startsWith("2026-05-01")).toBe(true);
  });
});

describe("summariseForm — averages are never computed on filler", () => {
  it("counts wins, draws and losses", () => {
    const form = summariseForm("Arsenal", [
      recent({ result: "W" }),
      recent({ result: "D", goalsFor: 1, goalsAgainst: 1 }),
      recent({ result: "L", goalsFor: 0, goalsAgainst: 3 }),
    ]);
    expect(form.played).toBe(3);
    expect(form.wins).toBe(1);
    expect(form.draws).toBe(1);
    expect(form.losses).toBe(1);
    expect(form.form).toBe("WDL");
  });

  it("excludes unfinished fixtures entirely", () => {
    const form = summariseForm("Arsenal", [
      recent({ result: "W" }),
      recent({ result: null, goalsFor: null, goalsAgainst: null }),
    ]);
    expect(form.played).toBe(1);
    expect(form.form).toBe("W");
  });

  it("reports goals per game", () => {
    const form = summariseForm("Arsenal", [
      recent({ goalsFor: 3, goalsAgainst: 0, result: "W" }),
      recent({ goalsFor: 1, goalsAgainst: 1, result: "D" }),
    ]);
    expect(form.avgGoalsFor).toBe(2);
    expect(form.avgGoalsAgainst).toBe(0.5);
  });

  it("reports null rather than a zero average when nothing was played", () => {
    const form = summariseForm("Arsenal", [recent({ result: null, goalsFor: null, goalsAgainst: null })]);
    expect(form.played).toBe(0);
    // "0.00 goals per game" would be a much stronger and much wronger claim.
    expect(form.avgGoalsFor).toBeNull();
    expect(form.avgGoalsAgainst).toBeNull();
  });
});

describe("collectMeetings — the sides are never swapped", () => {
  const arsenal = summariseForm("Arsenal", [
    recent({ home: true, opponent: "Chelsea", goalsFor: 2, goalsAgainst: 1, result: "W" }),
    recent({ home: true, opponent: "Everton", goalsFor: 1, goalsAgainst: 0, result: "W" }),
  ]);

  it("keeps only the meetings between the two sides", () => {
    const meetings = collectMeetings(arsenal, summariseForm("Chelsea", [recent()]));
    expect(meetings).toHaveLength(1);
    expect(meetings[0]!.homeTeam).toBe("Arsenal");
    expect(meetings[0]!.awayTeam).toBe("Chelsea");
    expect(meetings[0]!.homeScore).toBe(2);
    expect(meetings[0]!.awayScore).toBe(1);
  });

  it("places a meeting the tracked team played away on the correct sides", () => {
    const awayForm = summariseForm("Arsenal", [
      recent({ home: false, opponent: "Chelsea", goalsFor: 1, goalsAgainst: 3, result: "L" }),
    ]);
    const meetings = collectMeetings(awayForm, summariseForm("Chelsea", [recent()]));
    expect(meetings).toHaveLength(1);
    // Arsenal were the visitors, so Chelsea must be the home side — and the
    // scoreline must follow, not the tracked team's point of view.
    expect(meetings[0]!.homeTeam).toBe("Chelsea");
    expect(meetings[0]!.awayTeam).toBe("Arsenal");
    expect(meetings[0]!.homeScore).toBe(3);
    expect(meetings[0]!.awayScore).toBe(1);
  });

  it("matches opponent names tolerantly", () => {
    const form = summariseForm("Arsenal", [recent({ opponent: "chelsea fc" })]);
    expect(collectMeetings(form, summariseForm("Chelsea", [recent()]))).toHaveLength(1);
  });

  it("returns nothing when either side has no form", () => {
    expect(collectMeetings(null, summariseForm("Chelsea", [recent()]))).toEqual([]);
    expect(collectMeetings(arsenal, null)).toEqual([]);
  });

  it("returns nothing when the two sides have never met in the window", () => {
    const other = summariseForm("Liverpool", [recent({ opponent: "Everton" })]);
    expect(collectMeetings(arsenal, other)).toEqual([]);
  });

  it("orders the most recent meeting first", () => {
    const form = summariseForm("Arsenal", [
      recent({ date: "2026-01-01T00:00:00.000Z", opponent: "Chelsea" }),
      recent({ date: "2026-08-01T00:00:00.000Z", opponent: "Chelsea" }),
    ]);
    const meetings = collectMeetings(form, summariseForm("Chelsea", [recent()]));
    expect(meetings[0]!.date).toBe("2026-08-01T00:00:00.000Z");
  });
});
