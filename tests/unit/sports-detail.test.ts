import { describe, expect, it } from "vitest";
import {
  attributeTeam,
  averageRating,
  buildInsights,
  classifyCommentary,
  computeMomentum,
  computePlayerRating,
  estimateExpectedGoals,
  eventKind,
  parseEspnId,
  parseMinute,
  parseStatValue,
  statsHigherIsBetter,
  type MatchDetail,
} from "@/lib/sports-detail";

/**
 * The match-centre derivations.
 *
 * Every one of these produces a number or a sentence that a reader is asked to
 * trust on a football page, so they are pinned here: momentum must credit the
 * right team, a rating must never be invented for a player we know nothing about,
 * and the estimated xG must stay a statement about shots rather than a fake
 * provider metric.
 */

describe("provider vocabulary", () => {
  it("maps the provider's event labels onto our own", () => {
    expect(eventKind("Goal")).toBe("goal");
    expect(eventKind("Own Goal")).toBe("own-goal");
    expect(eventKind("Penalty - Scored")).toBe("penalty");
    expect(eventKind("Yellow Card")).toBe("yellow");
    expect(eventKind("Second Yellow card")).toBe("red");
    expect(eventKind("Red Card")).toBe("red");
    expect(eventKind("Substitution")).toBe("sub");
    expect(eventKind("End Regular Time")).toBe("fulltime");
    expect(eventKind(null)).toBe("other");
  });

  it("folds stoppage time into the minute it belongs to", () => {
    expect(parseMinute("45'+3'")).toBe(45);
    expect(parseMinute("90'+6'")).toBe(90);
    expect(parseMinute("62'")).toBe(62);
    // Falls back to the provider's seconds clock when the label is missing.
    expect(parseMinute(null, 3720)).toBe(62);
    expect(parseMinute(null, null)).toBeNull();
  });

  it("parses display strings and refuses the empty ones", () => {
    expect(parseStatValue("62.5%")).toBe(62.5);
    expect(parseStatValue("10")).toBe(10);
    expect(parseStatValue("-")).toBeNull();
    expect(parseStatValue(null)).toBeNull();
  });

  it("knows which statistics are better when they are lower", () => {
    expect(statsHigherIsBetter("possessionPct")).toBe(true);
    expect(statsHigherIsBetter("foulsCommitted")).toBe(false);
    expect(statsHigherIsBetter("redCards")).toBe(false);
  });

  it("addresses the summary endpoint from our external id", () => {
    expect(parseEspnId("espn:eng.1:401879285")).toEqual({ league: "eng.1", eventId: "401879285" });
    // Stored fixtures carry the DISPLAY name, and the summary endpoint wants the
    // slug — the whole deep read used to silently vanish on this mismatch.
    expect(parseEspnId("espn:Serie A:401874933")).toEqual({ league: "ita.1", eventId: "401874933" });
    expect(parseEspnId("espn:Primeira Liga:401885440")).toEqual({ league: "por.1", eventId: "401885440" });
    expect(parseEspnId("espn:uefa.champions:12345")).toEqual({ league: "uefa.champions", eventId: "12345" });
    expect(parseEspnId("sportsdb:12345")).toBeNull();
    // A name we cannot resolve must not be guessed into a wrong URL.
    expect(parseEspnId("espn:Some Other League:12345")).toBeNull();
  });
});

describe("attack momentum", () => {
  it("classifies only the actions that carry directional pressure", () => {
    expect(classifyCommentary("Goal! Brentford 1, Bournemouth 0.")).toBe("goal");
    expect(classifyCommentary("Attempt saved. Mbeumo (Brentford) left footed shot.")).toBe("saved");
    expect(classifyCommentary("Corner, Bournemouth. Conceded by Ajer.")).toBe("corner");
    expect(classifyCommentary("Lineups are announced and players are warming up.")).toBeNull();
    expect(classifyCommentary("End Delay.")).toBeNull();
  });

  it("credits a line to the side it names, and to nobody when ambiguous", () => {
    expect(attributeTeam("Corner, Bournemouth. Conceded by Ajer.", "Brentford", "Bournemouth")).toBe("away");
    expect(attributeTeam("Substitution, Brentford.", "Brentford", "Bournemouth")).toBe("home");
    // A sentence naming both sides cannot be attributed, and guessing would
    // poison the whole graph rather than one line of it.
    expect(attributeTeam("Brentford 1, Bournemouth 0.", "Brentford", "Bournemouth")).toBeNull();
  });

  it("turns a home-sided match into a positive series and normalises it", () => {
    const series = computeMomentum(
      [
        { minute: 10, text: "Goal! Wissa (Brentford) right footed shot." },
        { minute: 12, text: "Attempt saved. Wissa (Brentford) right footed shot." },
        { minute: 40, text: "Corner, Brentford. Conceded by Smith." },
      ],
      "Brentford",
      "Bournemouth"
    );
    expect(series).toHaveLength(18);
    expect(Math.max(...series.map((p) => p.value))).toBeCloseTo(1, 5);
    expect(series.every((p) => p.value >= 0)).toBe(true);
  });

  it("flips the sign for the away side and ignores unclassifiable noise", () => {
    const series = computeMomentum(
      [
        { minute: 20, text: "Attempt saved. Semenyo (Bournemouth) right footed shot." },
        { minute: 22, text: "Lineups are announced and players are warming up." },
      ],
      "Brentford",
      "Bournemouth"
    );
    expect(Math.min(...series.map((p) => p.value))).toBeCloseTo(-1, 5);
  });

  it("drops a line that names both sides rather than crediting the wrong one", () => {
    const series = computeMomentum(
      [{ minute: 30, text: "Goal! Brentford 1, Bournemouth 0. (Brentford)" }],
      "Brentford",
      "Bournemouth"
    );
    expect(series.every((p) => p.value === 0)).toBe(true);
  });

  it("returns a flat series when there is nothing to measure", () => {
    const series = computeMomentum([], "A", "B");
    expect(series.every((p) => p.value === 0)).toBe(true);
  });
});

describe("connectPlus Rating", () => {
  it("never invents a rating for a player with no stats", () => {
    expect(computePlayerRating({})).toEqual({ rating: null, basis: [] });
  });

  it("scores a keeper on saves and goals conceded, not on shots", () => {
    const keeper = computePlayerRating({ saves: 6, goalsConceded: 0, totalShots: 0 }, "Goalkeeper");
    expect(keeper.rating).not.toBeNull();
    expect(keeper.rating!).toBeGreaterThan(6);
    expect(keeper.basis.some((b) => b.includes("saves"))).toBe(true);
    // Shots taken must not move a keeper's number at all.
    const sameKeeper = computePlayerRating({ saves: 6, goalsConceded: 0, totalShots: 9 }, "Goalkeeper");
    expect(sameKeeper.rating).toBe(keeper.rating);
  });

  it("rewards goals, assists and clean conduct, and punishes cards", () => {
    const quiet = computePlayerRating({ appearances: 1 }, "Forward");
    const brace = computePlayerRating({ appearances: 1, totalGoals: 2, goalAssists: 1 }, "Forward");
    expect(brace.rating!).toBeGreaterThan(quiet.rating!);

    const sentOff = computePlayerRating({ appearances: 1, totalGoals: 2, redCards: 1 }, "Forward");
    expect(sentOff.rating!).toBeLessThan(brace.rating!);
  });

  it("clamps so one freak game cannot produce an absurd headline", () => {
    expect(computePlayerRating({ appearances: 1, totalGoals: 9, goalAssists: 9 }).rating).toBe(10);
    expect(computePlayerRating({ appearances: 1, ownGoals: 5, redCards: 2 }).rating).toBe(3);
  });

  it("names the two biggest movers as the reason", () => {
    const { basis } = computePlayerRating({ appearances: 1, totalGoals: 1, yellowCards: 1 });
    expect(basis.length).toBeLessThanOrEqual(2);
    expect(basis.some((b) => b.includes("goals"))).toBe(true);
  });

  it("averages only the players who actually have a rating", () => {
    expect(averageRating([{ rating: 7 }, { rating: null }, { rating: 8 }])).toBe(7.5);
    expect(averageRating([{ rating: null }])).toBeNull();
    expect(averageRating([])).toBeNull();
  });

  it("estimates expected goals from shot volume, and says nothing without shots", () => {
    // Six shots, three on target — a good chance haul.
    const decent = estimateExpectedGoals(12, 6);
    expect(decent).toBeGreaterThan(2);
    expect(estimateExpectedGoals(12, 2)!).toBeLessThan(decent!);
    expect(estimateExpectedGoals(0, 0)).toBeNull();
    expect(estimateExpectedGoals(null, null)).toBeNull();
  });
});

/* A complete, minimal detail payload so `buildInsights` can be driven directly. */
function detailWith(overrides: Partial<MatchDetail> = {}): MatchDetail {
  return {
    found: true,
    provider: "espn",
    externalId: "espn:eng.1:1",
    competition: "Premier League",
    homeTeam: "Brentford",
    awayTeam: "Bournemouth",
    status: "LIVE",
    source: "espn-summary",
    sourceUrl: null,
    events: [],
    stats: [],
    lineups: [],
    momentum: [],
    shots: [],
    commentary: [],
    insights: [],
    h2h: null,
    lastFive: [],
    info: { venue: null, attendance: null, oddsSummary: null },
    derived: [],
    coverage: {
      timeline: false,
      teamStats: false,
      lineups: false,
      perPlayerStats: false,
      momentum: false,
      shotMap: false,
      h2h: false,
      heatmaps: false,
      playerMarketValue: false,
      careerAnalytics: false,
    },
    ...overrides,
  };
}

describe("the written read", () => {
  it("writes nothing at all when nothing was measured", () => {
    expect(buildInsights(detailWith({ found: false }))).toEqual([]);
  });

  it("labels measured facts and our own arithmetic differently", () => {
    const insights = buildInsights(
      detailWith({
        stats: [
          { name: "possessionPct", label: "Possession", home: 58, away: 42, homeDisplay: "58", awayDisplay: "42", unit: "%", higherIsBetter: true },
          { name: "totalShots", label: "Shots", home: 14, away: 6, homeDisplay: "14", awayDisplay: "6", unit: "", higherIsBetter: true },
          { name: "shotsOnTarget", label: "Shots on target", home: 6, away: 2, homeDisplay: "6", awayDisplay: "2", unit: "", higherIsBetter: true },
        ],
      })
    );

    const possession = insights.find((i) => i.label === "Possession")!;
    expect(possession.basis).toBe("measured");
    expect(possession.text).toContain("58");

    const shots = insights.find((i) => i.label === "Shots")!;
    expect(shots.basis).toBe("measured");
    expect(shots.text).toContain("Brentford");

    const xg = insights.find((i) => i.label.startsWith("Expected goals"))!;
    expect(xg.basis).toBe("derived");
    // The sentence must own up to being an estimate, not a provider metric.
    expect(xg.text).toMatch(/estimated/i);
  });

  it("reads the last 15 minutes out of the momentum series", () => {
    const momentum = Array.from({ length: 18 }, (_, i) => ({ minute: (i + 1) * 5, value: i >= 15 ? -0.9 : 0 }));
    const insights = buildInsights(detailWith({ momentum }));
    const pressure = insights.find((i) => i.label === "Pressuring")!;
    expect(pressure.text).toContain("Bournemouth");
    expect(pressure.basis).toBe("derived");
  });

  it("credits the standout to the highest connectPlus Rating", () => {
    const insights = buildInsights(
      detailWith({
        lineups: [
          {
            side: "home",
            teamId: null,
            teamName: "Brentford",
            formation: "4-3-3",
            starters: [
              { id: "1", name: "A Keeper", shortName: "Keeper", jersey: "1", position: "Goalkeeper", starter: true, subbedIn: false, subbedOut: false, headshot: null, rating: 6.1, ratingBasis: [], stats: [] },
              { id: "2", name: "B Striker", shortName: "Striker", jersey: "9", position: "Forward", starter: true, subbedIn: false, subbedOut: false, headshot: null, rating: 8.7, ratingBasis: ["+1.10 goals"], stats: [] },
            ],
            bench: [],
            averageRating: 7.4,
          },
        ],
      })
    );
    const standout = insights.find((i) => i.label === "Standout")!;
    expect(standout.text).toContain("B Striker");
    expect(standout.text).toContain("8.7");
  });
});
