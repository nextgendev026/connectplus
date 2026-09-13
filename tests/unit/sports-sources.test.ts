import { describe, expect, it } from "vitest";
import {
  coalesceMatches,
  competitionRelevance,
  parseMatchMinute,
  sortByRelevance,
  type NormalizedMatch,
  type SportsProvider,
} from "../../src/lib/sports";

/**
 * Multi-source livescore contract.
 *
 * The hub fans out to every configured feed and merges the results. Two things
 * must never regress: a second source fills gaps rather than duplicating a
 * fixture, and the board leads with competitions this audience actually follows
 * (a wide-open aggregator returns hundreds of fixtures from leagues nobody here
 * can bet on, and those must not crowd out the first screen).
 */

function match(overrides: Partial<NormalizedMatch> = {}): NormalizedMatch {
  return {
    externalId: "e1",
    provider: "espn",
    sport: "football",
    competition: "Premier League",
    country: "England",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
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

function provider(id: string, priority: number): SportsProvider {
  return {
    id,
    label: id,
    configured: true,
    priority,
    keyless: true,
    supportsDate: true,
    async fetchMatches() {
      return [];
    },
  };
}

describe("parseMatchMinute", () => {
  it("reads MM:SS clocks as elapsed minutes, not concatenated digits", () => {
    // The regression: "4:54" used to render as the 454th minute.
    expect(parseMatchMinute("4:54")).toBe(4);
    expect(parseMatchMinute("45:00")).toBe(45);
    expect(parseMatchMinute("67:31")).toBe(67);
    expect(parseMatchMinute("120:00")).toBe(120);
  });

  it("folds stoppage time into the minute", () => {
    expect(parseMatchMinute("45+2")).toBe(47);
    expect(parseMatchMinute("45'+2'")).toBe(47);
    expect(parseMatchMinute("90+5'")).toBe(95);
  });

  it("passes a plain minute through", () => {
    expect(parseMatchMinute("45'")).toBe(45);
    expect(parseMatchMinute("12")).toBe(12);
  });

  it("rejects non-clocks instead of inventing a minute", () => {
    expect(parseMatchMinute("HT")).toBeNull();
    expect(parseMatchMinute("FT")).toBeNull();
    expect(parseMatchMinute("")).toBeNull();
    expect(parseMatchMinute(null)).toBeNull();
    expect(parseMatchMinute(undefined)).toBeNull();
    expect(parseMatchMinute("0")).toBeNull();
    // Beyond extra time is a mis-parse, never a real match minute.
    expect(parseMatchMinute("454'")).toBeNull();
  });
});

describe("coalesceMatches", () => {
  it("collapses the same fixture from two sources into one row", () => {
    const { matches } = coalesceMatches([
      { provider: provider("espn", 3), matches: [match()] },
      {
        provider: provider("sportsdb", 2),
        matches: [match({ externalId: "e9", provider: "sportsdb", kickoff: "2026-09-13T15:00:00.000Z" })],
      },
    ]);
    expect(matches).toHaveLength(1);
  });

  it("keeps the winner's identity but borrows the fields it could not supply", () => {
    const { matches, contributed } = coalesceMatches([
      {
        provider: provider("sportsdb", 2),
        matches: [match({ provider: "sportsdb", externalId: "s1", status: "LIVE", minute: 63, homeScore: 1, awayScore: 0 })],
      },
      {
        provider: provider("espn", 3),
        matches: [match({ provider: "espn", externalId: "x1", oddsHome: 1.8, venue: "Emirates" })],
      },
    ]);

    const merged = matches[0]!;
    expect(merged.provider).toBe("sportsdb");
    expect(merged.externalId).toBe("s1");
    expect(merged.status).toBe("LIVE");
    expect(merged.minute).toBe(63);
    expect(merged.oddsHome).toBe(1.8);
    expect(merged.venue).toBe("Emirates");
    expect(contributed.get("sportsdb")).toBe(1);
    expect(contributed.get("espn")).toBe(1);
  });

  it("lets a lower-priority source describe the same fixture in a different provider slot", () => {
    const { matches } = coalesceMatches([
      { provider: provider("espn", 3), matches: [match({ provider: "espn" })] },
      {
        provider: provider("sportsdb", 2),
        matches: [match({ provider: "sportsdb", externalId: "s2", status: "LIVE", minute: 12 })],
      },
    ]);
    // sportsdb outranks espn, so its LIVE state must win even though espn was
    // listed first.
    expect(matches[0]!.provider).toBe("sportsdb");
    expect(matches[0]!.status).toBe("LIVE");
  });

  it("unifies one fixture even when the sources name the league differently", () => {
    // Providers disagree on league labels ("Premier League" vs "English Premier
    // League"), so identity is teams + day — otherwise the same match would show
    // up twice with two different scorelines.
    const { matches } = coalesceMatches([
      { provider: provider("espn", 3), matches: [match({ externalId: "a", competition: "Premier League" })] },
      {
        provider: provider("sportsdb", 2),
        matches: [
          match({
            provider: "sportsdb",
            externalId: "b",
            competition: "English Premier League",
            status: "LIVE",
            minute: 20,
          }),
        ],
      },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.competition).toBe("English Premier League");
  });

  it("keeps genuinely different fixtures apart", () => {
    const { matches } = coalesceMatches([
      {
        provider: provider("espn", 3),
        matches: [
          match({ externalId: "a" }),
          match({ externalId: "b", homeTeam: "Liverpool", awayTeam: "Everton" }),
        ],
      },
    ]);
    expect(matches).toHaveLength(2);
  });

  it("ignores a club suffix so 'Arsenal FC' and 'Arsenal' are the same tie", () => {
    const { matches } = coalesceMatches([
      { provider: provider("espn", 3), matches: [match({ externalId: "a" })] },
      {
        provider: provider("sportsdb", 2),
        matches: [match({ provider: "sportsdb", externalId: "b", homeTeam: "Arsenal FC", awayTeam: "Chelsea FC" })],
      },
    ]);
    expect(matches).toHaveLength(1);
  });
});

describe("competition relevance", () => {
  it("ranks the regional leagues this audience follows above everything else", () => {
    expect(competitionRelevance("FKF Premier League", "Kenya")).toBe(0);
    expect(competitionRelevance("Uganda Premier League", "Uganda")).toBe(0);
    expect(competitionRelevance("FKF Premier League", "Kenya")).toBeLessThan(
      competitionRelevance("Premier League", "England")
    );
  });

  it("ranks the big leagues above the long tail", () => {
    expect(competitionRelevance("Premier League", "England")).toBe(1);
    expect(competitionRelevance("UEFA Champions League", "Europe")).toBe(1);
    expect(competitionRelevance("Spanish Tercera Federación Group 12", "Spain")).toBe(3);
  });

  it("does not mistake a namesake league for a big one", () => {
    // A substring match used to rank these beside the real Premier League and
    // Serie A, pushing actual fixtures off the first screen.
    expect(competitionRelevance("Cambodian Premier League", "Cambodia")).toBe(2);
    expect(competitionRelevance("Italian Serie A Womens Cup", "Italy")).toBe(3);
    expect(competitionRelevance("Premier League", "England")).toBeLessThan(
      competitionRelevance("Cambodian Premier League", "Cambodia")
    );
  });

  it("accepts a country-qualified top flight", () => {
    expect(competitionRelevance("German Bundesliga", "Germany")).toBe(1);
    expect(competitionRelevance("Spanish LaLiga", "Spain")).toBe(1);
  });

  it("sorts live fixtures first, then relevance", () => {
    const ordered = sortByRelevance([
      match({ externalId: "obscure", competition: "Vietnam V.League 2", country: "Vietnam", status: "SCHEDULED" }),
      match({ externalId: "kpl", competition: "FKF Premier League", country: "Kenya", status: "SCHEDULED" }),
      match({ externalId: "live-obscure", competition: "Latvian Higher League", country: "Latvia", status: "LIVE" }),
    ]);
    expect(ordered.map((m) => m.externalId)).toEqual(["live-obscure", "kpl", "obscure"]);
  });
});
