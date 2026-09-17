import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isFootballScope, footballScope, SPORTS_SCOPE, ESPN_SPORT_PATH } from "@/lib/sports-scope";
import {
  apiSportsDayPath,
  apiSportsStatus,
  mapApiSportsFixture,
  type ApiFixtureRow,
} from "@/lib/sports-apisports";

/**
 * The desk used to cover two sports, and every "which sport?" branch in the
 * chain was a place the two could disagree: a board that fetched basketball,
 * a league registry keyed by sport, an edge snapshot per sport, a model whose
 * markets only describe goals. Basketball is gone, and these tests are what
 * keeps it gone — the type system cannot see a `sport` string, and the failure
 * mode is silent (an empty board, or worse, NBA fixtures under a football pick).
 */

describe("sports scope", () => {
  it("is football", () => {
    expect(SPORTS_SCOPE).toBe("football");
    expect(ESPN_SPORT_PATH).toBe("soccer");
  });

  it("treats a missing sport as football, because that is the default", () => {
    expect(isFootballScope(undefined)).toBe(true);
    expect(isFootballScope(null)).toBe(true);
    expect(isFootballScope("")).toBe(true);
    expect(isFootballScope("  ")).toBe(true);
  });

  it("accepts both spellings of the same sport", () => {
    // ESPN addresses it as `soccer`, football-data as `football`. Treating those
    // as different sports is how a fixture ends up with no odds attached.
    expect(isFootballScope("football")).toBe(true);
    expect(isFootballScope("FOOTBALL")).toBe(true);
    expect(isFootballScope(" soccer ")).toBe(true);
  });

  it("knows what is not football", () => {
    for (const other of ["basketball", "tennis", "netball", "rugby", "nba"]) {
      expect(isFootballScope(other), other).toBe(false);
    }
  });

  it("coerces rather than rejects, so a stale link still lands on a board", () => {
    expect(footballScope("basketball")).toBe("football");
    expect(footballScope(undefined)).toBe("football");
  });
});

describe("api-sports is a football adapter", () => {
  it("builds the football day path, and no path at all for anything else", () => {
    const date = new Date("2026-09-16T12:00:00Z");
    expect(apiSportsDayPath(date, "football")?.path).toContain("fixtures?date=2026-09-16");
    expect(apiSportsDayPath(date, "soccer")?.path).toContain("fixtures?date=2026-09-16");
    // Null, not football's path: a request for another sport should come back
    // empty rather than come back mislabelled.
    expect(apiSportsDayPath(date, "basketball")).toBeNull();
    expect(apiSportsDayPath(date, "tennis")).toBeNull();
  });

  it("keeps the football status codes and drops the basketball ones", () => {
    expect(apiSportsStatus("1H", 23)).toBe("LIVE");
    expect(apiSportsStatus("HT", 45)).toBe("HT");
    expect(apiSportsStatus("FT", 90)).toBe("FT");
    expect(apiSportsStatus("PST", null)).toBe("POSTPONED");
    // `Q2` was basketball's. It now falls through to the minute-based guess, and
    // with no clock given that guess is SCHEDULED — the point is that it is no
    // longer a recognised live code.
    expect(apiSportsStatus("Q2", null)).toBe("SCHEDULED");
  });

  it("maps the football shape, venue and all", () => {
    const row: ApiFixtureRow = {
      fixture: {
        id: 1234,
        date: "2026-09-16T13:00:00Z",
        venue: { name: "Kasarani" },
        status: { short: "2H", elapsed: 67, extra: 2 },
      },
      league: { id: 276, name: "FKF Premier League", country: "Kenya" },
      teams: {
        home: { id: 1, name: "Gor Mahia", logo: "https://crest/1.png" },
        away: { id: 2, name: "AFC Leopards" },
      },
      goals: { home: 2, away: 1 },
    };

    const match = mapApiSportsFixture(row, "football");
    expect(match).not.toBeNull();
    expect(match?.externalId).toBe("apisports:1234");
    expect(match?.competition).toBe("FKF Premier League");
    expect(match?.country).toBe("Kenya");
    expect(match?.venue).toBe("Kasarani");
    expect(match?.status).toBe("LIVE");
    expect(match?.minute).toBe(69);
    expect(match?.homeScore).toBe(2);
  });

  it("refuses the basketball envelope instead of half-mapping it", () => {
    // The basketball product's shape: id, date and scores at the top level, no
    // nested `fixture`. It has to be a null — a mapper that guessed would hand
    // the board a fixture with no venue, no minute and a score it invented.
    const row = {
      id: 9876,
      date: "2026-09-16T13:00:00Z",
      status: { short: "Q3", timer: "5:20" },
      league: { id: 12, name: "NBA" },
      country: { name: "USA" },
      teams: { home: { name: "Lakers" }, away: { name: "Celtics" } },
      scores: { home: { total: 78 }, away: { total: 81 } },
    } as unknown as ApiFixtureRow;

    expect(mapApiSportsFixture(row, "football")).toBeNull();
  });

  it("leaves a scheduled fixture's score null rather than 0-0", () => {
    const match = mapApiSportsFixture(
      {
        fixture: { id: 5, status: { short: "NS" } },
        league: { name: "Serie A" },
        teams: { home: { name: "Inter" }, away: { name: "Milan" } },
        goals: { home: null, away: null },
      },
      "football"
    );
    expect(match?.status).toBe("SCHEDULED");
    expect(match?.homeScore).toBeNull();
    expect(match?.minute).toBeNull();
  });
});

describe("nothing can ask the desk for a second sport", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  const SOURCES = [
    "src/lib/sports.ts",
    "src/lib/sports-apisports.ts",
    "src/lib/sports-calendar.ts",
    "src/lib/sports-intelligence.ts",
    "src/lib/sports-forecast.ts",
    "src/app/api/sports/live/route.ts",
    "src/app/api/sports/calendar/route.ts",
    "src/app/api/sports/match/route.ts",
    "src/components/sports/ScoresBoard.tsx",
    "src/components/sports/SportsHub.tsx",
    "src/components/sports/MatchCentre.tsx",
    "src/components/sports/LiveTicker.tsx",
    "workers/edge-cache/src/index.mjs",
  ];

  it("never compares a sport against basketball", () => {
    // Comments are allowed to mention it — the history is worth keeping. Code is
    // not: every one of these was a branch that could serve the wrong fixtures.
    const offenders = SOURCES.filter((rel) => /sport\s*[!=]==?\s*["']basketball["']/.test(read(rel)));
    expect(offenders).toEqual([]);
  });

  it("keeps the retired league map deleted rather than orphaned", () => {
    expect(read("src/lib/sports.ts")).not.toContain("ESPN_BASKETBALL_LEAGUES");
  });

  it("has no sport selector left on the board or the hub", () => {
    const board = read("src/components/sports/ScoresBoard.tsx");
    // The toggle rendered a `SPORTS.map` of two buttons over a `setSport` state.
    // (`setSportsAlertsMuted` is the alert toggle and stays — hence the exact
    // call shape rather than a substring.)
    expect(board).not.toMatch(/setSport\(/);
    expect(board).not.toMatch(/\[sport, setSport\]/);
    expect(board).not.toMatch(/const SPORTS = \[/);
    expect(read("src/components/sports/SportsHub.tsx")).not.toMatch(/basketball/i);
  });

  it("keeps one livescore snapshot in the worker", () => {
    const worker = read("workers/edge-cache/src/index.mjs");
    expect(worker).toContain('id: "livescore-football"');
    expect(worker).not.toContain("livescore-basketball");
    // The canonical alias writes the sport as a literal, so a stale `?sport=`
    // cannot create a second cache entry for an identical payload.
    expect(worker).toContain("sport=football");
    expect(worker).toMatch(/snapshotById\("livescore-football"\)/);
  });

  it("keeps the model gate pointing at the desk's own scope", () => {
    const forecast = read("src/lib/sports-forecast.ts");
    expect(forecast).toContain('import { SPORTS_SCOPE, type SportsScope } from "@/lib/sports-scope"');
    expect(forecast).toContain("MODELED_SPORT: SportsScope = SPORTS_SCOPE");
  });
});
