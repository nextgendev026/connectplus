import { describe, expect, it } from "vitest";
import {
  canonicalCompetition,
  fixtureIdentity,
  fixtureKey,
  teamSlug,
  type NormalizedMatch,
} from "../../src/lib/sports";

/**
 * Fixture identity and competition naming.
 *
 * These two functions are the only reason the same match — and the same league
 * under two providers' spellings — stops appearing twice. Duplicate cards were
 * a visible, reported defect, and they came from exactly the cases asserted
 * here: club suffixes, accents, and country-qualified league names.
 */

function match(overrides: Partial<NormalizedMatch>): NormalizedMatch {
  return {
    externalId: "1",
    provider: "sportsdb",
    sport: "football",
    competition: "Premier League",
    country: "England",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    status: "SCHEDULED",
    kickoff: "2026-09-13T14:00:00.000Z",
    ...overrides,
  } as NormalizedMatch;
}

describe("teamSlug", () => {
  it("strips club suffixes so two providers agree", () => {
    expect(teamSlug("Chelsea FC")).toBe(teamSlug("Chelsea"));
    expect(teamSlug("Sheffield United")).toBe(teamSlug("Sheffield Utd"));
    expect(teamSlug("Wolverhampton Wanderers")).toBe(teamSlug("Wolverhampton Wanderers"));
  });

  it("folds accents, because a provider will send Málaga and another Malaga", () => {
    expect(teamSlug("Málaga")).toBe(teamSlug("Malaga"));
    expect(teamSlug("Atlético Madrid")).toBe(teamSlug("Atletico Madrid"));
  });

  it("ignores punctuation and spacing", () => {
    expect(teamSlug("Brighton & Hove Albion")).toBe(teamSlug("brighton hove albion"));
  });
});

describe("fixtureKey and fixtureIdentity", () => {
  it("agree for the same fixture expressed with different suffixes", () => {
    const a = match({ homeTeam: "Sheffield United", awayTeam: "Wolverhampton Wanderers" });
    const b = match({ homeTeam: "Sheffield Utd", awayTeam: "Wolverhampton Wanderers" });
    expect(fixtureKey(a)).toBe(fixtureKey(b));
  });

  it("separate fixtures on different days", () => {
    const today = match({});
    const tomorrow = match({ kickoff: "2026-09-14T14:00:00.000Z" });
    expect(fixtureKey(today)).not.toBe(fixtureKey(tomorrow));
  });

  it("keys a stored row the same way as a live fixture", () => {
    const live = match({ kickoff: "2026-09-13T14:00:00.000Z" });
    const stored = fixtureIdentity({
      homeTeam: "Arsenal",
      awayTeam: "Chelsea FC",
      kickoff: new Date("2026-09-13T14:00:00.000Z"),
    });
    expect(stored).toBe(fixtureKey(live));
  });

  it("survives a null kickoff without throwing", () => {
    expect(fixtureIdentity({ homeTeam: "A", awayTeam: "B", kickoff: null })).toBe("a|b|");
  });
});

describe("canonicalCompetition", () => {
  it("folds the same league across providers onto one label", () => {
    expect(canonicalCompetition("LaLiga", "Spain")).toBe("LaLiga");
    expect(canonicalCompetition("Spanish La Liga", "Spain")).toBe("LaLiga");
    expect(canonicalCompetition("La Liga Santander", "Spain")).toBe("LaLiga");
    expect(canonicalCompetition("Primera Division", "Spain")).toBe("LaLiga");
  });

  it("folds the big five the way both adapters spell them", () => {
    expect(canonicalCompetition("German Bundesliga", "Germany")).toBe("Bundesliga");
    expect(canonicalCompetition("Bundesliga", "Germany")).toBe("Bundesliga");
    expect(canonicalCompetition("Italian Serie A", "Italy")).toBe("Serie A");
    expect(canonicalCompetition("English Premier League", "England")).toBe("Premier League");
    expect(canonicalCompetition("EPL", "England")).toBe("Premier League");
  });

  it("folds European competitions", () => {
    expect(canonicalCompetition("UEFA Champions League", "Europe")).toBe("UEFA Champions League");
    expect(canonicalCompetition("Champions League", "Europe")).toBe("UEFA Champions League");
  });

  it("keeps distinct lower divisions distinct", () => {
    const a = canonicalCompetition("Spanish Segunda Federación Group 1", "Spain");
    const b = canonicalCompetition("Spanish Segunda Federación Group 5", "Spain");
    expect(a).not.toBe(b);
    // …but drops the redundant country prefix so the label reads cleanly.
    expect(a.startsWith("Segunda")).toBe(true);
  });

  it("never invents a league from an empty name", () => {
    expect(canonicalCompetition("", "Kenya")).toBe("Kenya league");
    expect(canonicalCompetition("", null)).toBe("Unknown competition");
  });
});
