import { describe, expect, it } from "vitest";
import { mapOpenFootballMatch, OPENFOOTBALL_LEAGUES } from "@/lib/sports-openfootball";

/**
 * The fixture archive's contract.
 *
 * This provider exists to add fixtures nobody else has, so the tests that matter
 * are the ones about what it must NOT do: it must never claim a result, never
 * present a past fixture, and never let two sources' spellings of the same club
 * collide on an id.
 */

const now = new Date("2026-09-14T09:00:00.000Z");

describe("mapOpenFootballMatch", () => {
  it("maps a future fixture as scheduled, with no score", () => {
    const match = mapOpenFootballMatch(
      { round: "Matchday 5", date: "2026-09-20", time: "15:00", team1: "Arsenal FC", team2: "Chelsea FC" },
      "en.1",
      "2026-27",
      now
    )!;

    expect(match).not.toBeNull();
    expect(match.provider).toBe("openfootball");
    expect(match.status).toBe("SCHEDULED");
    expect(match.homeScore).toBeNull();
    expect(match.awayScore).toBeNull();
    expect(match.minute).toBeNull();
    expect(match.competition).toBe(OPENFOOTBALL_LEAGUES["en.1"]!.name);
    expect(match.country).toBe("England");
    expect(match.kickoff).toBe("2026-09-20T15:00:00.000Z");
  });

  it("still maps a fixture later today", () => {
    const match = mapOpenFootballMatch(
      { date: "2026-09-14", time: "18:30", team1: "Como FC", team2: "Parma FC" },
      "it.1",
      "2026-27",
      now
    );
    expect(match?.status).toBe("SCHEDULED");
  });

  it("refuses a fixture from a past day, score or not", () => {
    // The archive is hand-edited and lags real life, so a past date is exactly
    // where a stale score would do damage — live feeds own results.
    const match = mapOpenFootballMatch(
      { date: "2026-09-01", time: "15:00", team1: "Arsenal FC", team2: "Chelsea FC", score: { ft: [2, 0] } },
      "en.1",
      "2026-27",
      now
    );
    expect(match).toBeNull();
  });

  it("needs both sides and a date", () => {
    expect(mapOpenFootballMatch({ date: "2026-09-20", team1: "Arsenal FC" }, "en.1", "2026-27", now)).toBeNull();
    expect(mapOpenFootballMatch({ team1: "A", team2: "B" }, "en.1", "2026-27", now)).toBeNull();
  });

  it("ignores a league it does not publish", () => {
    expect(
      mapOpenFootballMatch({ date: "2026-09-20", team1: "A", team2: "B" }, "zz.9", "2026-27", now)
    ).toBeNull();
  });

  it("gives the same fixture the same id, and different fixtures different ids", () => {
    const fixture = { date: "2026-09-20", time: "15:00", team1: "Arsenal FC", team2: "Chelsea FC" };
    const a = mapOpenFootballMatch(fixture, "en.1", "2026-27", now)!;
    const b = mapOpenFootballMatch(fixture, "en.1", "2026-27", now)!;
    expect(a.externalId).toBe(b.externalId);

    const other = mapOpenFootballMatch({ ...fixture, team2: "Everton FC" }, "en.1", "2026-27", now)!;
    expect(other.externalId).not.toBe(a.externalId);
  });

  it("falls back to a neutral kick-off time when the archive omits one", () => {
    const match = mapOpenFootballMatch(
      { date: "2026-09-20", team1: "Arsenal FC", team2: "Chelsea FC" },
      "en.1",
      "2026-27",
      now
    )!;
    // A date with no time is a known-day fixture, not a midnight one; noon is the
    // neutral reading, and this source ranks below every live feed anyway.
    expect(match.kickoff).toBe("2026-09-20T12:00:00.000Z");
  });
});
