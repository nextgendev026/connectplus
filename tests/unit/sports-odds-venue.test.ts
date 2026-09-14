import { describe, expect, it } from "vitest";
import { mapEspnEvent } from "@/lib/sports";
import { mapOpenFootballMatch } from "@/lib/sports-openfootball";

/**
 * Odds and venue, mapped from the shapes the providers actually send.
 *
 * Both of these were wrong in a way no test could have caught without a fixture
 * copied from a real response:
 *
 *   • ESPN nests the two sides under `odds.moneyline.home/away`, with `open` and
 *     `close` sub-objects, while the code read `odds.homeTeamOdds.moneyLine` and
 *     `odds.awayTeamOdds.moneyLine` — keys that do not exist. Home and away were
 *     always null and the draw was always populated, so every consumer needing
 *     all three (the market-baseline prediction path, the closing-line check)
 *     was dead code that failed silently.
 *
 *   • `competition.venue` is an object, not a string, so a `typeof === "string"`
 *     test rejected it every time and ESPN fixtures never carried a ground.
 *
 * The fixtures below are trimmed to the fields the mapper reads, with the odds
 * block copied verbatim from a live serie A scoreboard response.
 */

function espnEvent(odds: unknown, venue: unknown) {
  return {
    id: "401823456",
    date: "2026-09-14T18:45:00Z",
    competitions: [
      {
        venue,
        odds,
        competitors: [
          {
            homeAway: "home",
            score: "0",
            team: { displayName: "Como", abbreviation: "COM" },
          },
          {
            homeAway: "away",
            score: "0",
            team: { displayName: "Parma", abbreviation: "PAR" },
          },
        ],
        status: {
          displayClock: "12'",
          type: { state: "in", description: "In Progress", completed: false },
        },
      },
    ],
  };
}

const liveOdds = [
  {
    overUnder: 3.5,
    provider: { name: "DraftKings" },
    drawOdds: { moneyLine: 500 },
    moneyline: {
      displayName: "Moneyline",
      home: { open: { odds: "-350" }, close: { odds: "-500" } },
      away: { open: { odds: "+280" }, close: { odds: "+400" } },
    },
  },
];

describe("ESPN odds mapping", () => {
  it("reads both sides off moneyline.home/away and prefers the closing line", () => {
    const m = mapEspnEvent(
      espnEvent(liveOdds, { id: "5934", fullName: "Giuseppe Sinigaglia", address: { city: "Como" } }),
      "ita.1",
      "football"
    );
    expect(m).not.toBeNull();
    // -500 American → 1.20 decimal; +400 → 5.00; 500 → 6.00.
    expect(m!.oddsHome).toBe(1.2);
    expect(m!.oddsAway).toBe(5);
    expect(m!.oddsDraw).toBe(6);
  });

  it("falls back to the opening line when no close has been posted", () => {
    const m = mapEspnEvent(
      espnEvent([{ ...liveOdds[0], moneyline: { home: { open: { odds: "-200" } }, away: { open: { odds: "+170" } } } }], null),
      "ita.1",
      "football"
    );
    expect(m!.oddsHome).toBe(1.5);
    expect(m!.oddsAway).toBe(2.7);
  });

  it("returns all three as null rather than a lone draw price when no book is attached", () => {
    const m = mapEspnEvent(espnEvent(undefined, null), "ita.1", "football");
    expect(m!.oddsHome).toBeNull();
    expect(m!.oddsDraw).toBeNull();
    expect(m!.oddsAway).toBeNull();
  });

  it("never invents a side from a draw-only payload", () => {
    const m = mapEspnEvent(espnEvent([{ drawOdds: { moneyLine: 320 } }], null), "ita.1", "football");
    expect(m!.oddsDraw).toBe(4.2);
    expect(m!.oddsHome).toBeNull();
    expect(m!.oddsAway).toBeNull();
  });
});

describe("venue mapping", () => {
  it("reads the ground off the ESPN venue object", () => {
    const m = mapEspnEvent(espnEvent(undefined, { id: "5934", fullName: "Giuseppe Sinigaglia" }), "ita.1", "football");
    expect(m!.venue).toBe("Giuseppe Sinigaglia");
  });

  it("falls back to the city, and to null, without inventing a ground", () => {
    const city = mapEspnEvent(espnEvent(undefined, { address: { city: "Como" } }), "ita.1", "football");
    expect(city!.venue).toBe("Como");
    expect(mapEspnEvent(espnEvent(undefined, undefined), "ita.1", "football")!.venue).toBeNull();
    expect(mapEspnEvent(espnEvent(undefined, ""), "ita.1", "football")!.venue).toBeNull();
  });

  it("does not treat an open-football round as a venue", () => {
    const fixture = mapOpenFootballMatch(
      { date: "2026-12-05", time: "15:00", team1: "Arsenal", team2: "Chelsea", round: "Matchday 15" },
      "en.1",
      "2026-27",
      new Date("2026-09-14T00:00:00Z")
    );
    expect(fixture).not.toBeNull();
    expect(fixture!.venue).toBeNull();
  });
});
