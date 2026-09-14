import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backfillOdds, resolveEspnEventId, type NormalizedMatch } from "@/lib/sports";

/**
 * The odds backfill and the ESPN event resolver.
 *
 * ESPN is the only keyless source we have that publishes a price *and* the only
 * one that publishes a deep match read — the timeline, the 28 team statistics,
 * the lineups and the play-by-play commentary. It publishes both only for the
 * leagues it was asked about, and addresses a fixture by its own event id, so
 * without help:
 *
 *   • a fixture from TheSportsDB or the OpenFootball archive arrived unpriced,
 *     and `sports-intelligence` fell back to its priors with the rationale "No
 *     published odds to price an edge against"; and
 *   • its match centre rendered a blank panel claiming deep data was "only
 *     available for fixtures served by ESPN's public feed", which was never true.
 *
 * Both now resolve the competition against ESPN's own live league registry and
 * fetch what is missing. What these tests pin is the part that is expensive to
 * get wrong: a price is never invented, an ambiguous competition is left alone
 * rather than guessed at, a kick-off that lands on a different UTC day still
 * finds its fixture, and the id handed back is one the deep view can actually
 * resolve.
 *
 * NOTE ON DAYS. The worker caches a league-day scoreboard for 45 seconds, which
 * is production behaviour worth keeping — so every case below uses its own
 * calendar day. Sharing one would let an earlier case's response satisfy a later
 * one, and the assertions would stop meaning anything.
 */

/** The registry ESPN's dropdown returns, trimmed to what these cases exercise. */
const REGISTRY = {
  leagues: [
    { slug: "mex.copa", name: "Copa MX" },
    { slug: "gre.1", name: "Greek Super League" },
    { slug: "gre.2", name: "Greek Super League 2" },
    { slug: "nir.1", name: "Northern Ireland League" },
    { slug: "ire.prem", name: "Ireland Premiership" },
  ],
};

/** One ESPN event, in the shape `mapEspnEvent` reads. */
function espnEvent(id: string, date: string, home: string, away: string, homeOdds: number) {
  return {
    id,
    date,
    competitions: [
      {
        competitors: [
          { homeAway: "home", score: "0", team: { displayName: home } },
          { homeAway: "away", score: "0", team: { displayName: away } },
        ],
        status: { displayClock: "0'", type: { state: "pre", description: "Scheduled", completed: false } },
        odds: [
          {
            drawOdds: { moneyLine: 310 },
            moneyline: {
              home: { close: { odds: homeOdds } },
              away: { close: { odds: 240 } },
            },
          },
        ],
      },
    ],
  };
}

function match(
  overrides: Partial<NormalizedMatch> & Pick<NormalizedMatch, "homeTeam" | "awayTeam">
): NormalizedMatch {
  return {
    externalId: `x:${overrides.homeTeam}:${overrides.awayTeam}`,
    provider: "sportsdb",
    sport: "football",
    competition: "Copa MX",
    country: null,
    homeScore: null,
    awayScore: null,
    status: "SCHEDULED",
    minute: null,
    kickoff: "2026-09-14T18:00:00.000Z",
    venue: null,
    oddsHome: null,
    oddsDraw: null,
    oddsAway: null,
    ...overrides,
  } as NormalizedMatch;
}

const scoreboards: Record<string, unknown[]> = {};
const requested: string[] = [];

beforeEach(() => {
  requested.length = 0;
  for (const key of Object.keys(scoreboards)) delete scoreboards[key];
  vi.stubGlobal("fetch", async (url: string) => {
    const href = String(url);
    requested.push(href);
    if (href.includes("/leagues/dropdown")) {
      return new Response(JSON.stringify(REGISTRY), { status: 200 });
    }
    const slug = href.match(/sports\/soccer\/([^/]+)\/scoreboard/)?.[1];
    if (slug && slug in scoreboards) {
      return new Response(JSON.stringify({ events: scoreboards[slug] }), { status: 200 });
    }
    return new Response(JSON.stringify({ events: [] }), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("odds backfill", () => {
  it("prices a fixture from a league the fixed registry never asks for", async () => {
    // `mex.copa` is not in ESPN_SOCCER_LEAGUES: it enters the picture only
    // because a fixture from another source is in that competition.
    scoreboards["mex.copa"] = [espnEvent("1", "2026-09-14T18:00:00Z", "Club America", "Tigres", -140)];

    const result = await backfillOdds(
      [match({ homeTeam: "Club America", awayTeam: "Tigres", competition: "Copa MX" })],
      { date: new Date("2026-09-14T12:00:00.000Z"), sport: "football" }
    );

    expect(result.priced).toBe(1);
    expect(result.leagues).toEqual(["mex.copa"]);
    expect(result.matches[0]?.oddsHome).toBeCloseTo(1.71, 2);
    expect(result.matches[0]?.oddsDraw).toBeCloseTo(4.1, 2);
    expect(result.matches[0]?.oddsAway).toBeCloseTo(3.4, 2);
  });

  it("leaves a competition no keyless source prices unpriced rather than inventing a number", async () => {
    // Nothing in the registry looks like this league, so nothing is fetched and
    // the price stays null — which is what makes the model say "no published
    // odds" instead of confidently pricing an edge against a made-up line.
    const result = await backfillOdds(
      [match({ homeTeam: "Yangon United", awayTeam: "Shan United", competition: "Myanmar National League" })],
      { date: new Date("2026-09-15T12:00:00.000Z"), sport: "football" }
    );

    expect(result.priced).toBe(0);
    expect(result.matches[0]?.oddsHome).toBeNull();
    expect(requested.some((u) => /sports\/soccer\/[^/]+\/scoreboard/.test(u))).toBe(false);
  });

  it("refuses to guess when a competition name fits two leagues equally", async () => {
    // "Northern Ireland League" and "Ireland Premiership" are an equally good fit
    // for "Northern Ireland Premiership". Fetching the wrong one costs a request;
    // attaching its prices to the wrong fixture would corrupt a pick.
    scoreboards["nir.1"] = [espnEvent("1", "2026-09-16T18:00:00Z", "Linfield", "Glentoran", -140)];
    scoreboards["ire.prem"] = [espnEvent("2", "2026-09-16T18:00:00Z", "Linfield", "Glentoran", -140)];

    const result = await backfillOdds(
      [
        match({
          homeTeam: "Linfield",
          awayTeam: "Glentoran",
          competition: "Northern Ireland Premiership",
          kickoff: "2026-09-16T18:00:00.000Z",
        }),
      ],
      { date: new Date("2026-09-16T12:00:00.000Z"), sport: "football" }
    );

    expect(result.priced).toBe(0);
    expect(requested.some((u) => u.includes("nir.1") || u.includes("ire.prem"))).toBe(false);
  });

  it("still finds the price when the two providers disagree about the UTC day", async () => {
    // A 21:30 kick-off in Montevideo is the next day in UTC. The fixture key
    // carries the day, so a key-only lookup misses it and the price is dropped
    // for exactly the late kick-offs a reader is watching.
    scoreboards["mex.copa"] = [espnEvent("1", "2026-09-21T01:30:00Z", "Club America", "Tigres", -140)];

    const result = await backfillOdds(
      [
        match({
          homeTeam: "Club America",
          awayTeam: "Tigres",
          competition: "Copa MX",
          kickoff: "2026-09-20T21:30:00.000Z",
        }),
      ],
      { date: new Date("2026-09-20T12:00:00.000Z"), sport: "football" }
    );

    expect(result.priced).toBe(1);
    expect(result.matches[0]?.oddsHome).toBeCloseTo(1.71, 2);
  });

  it("does not touch a fixture that already carries a full price", async () => {
    scoreboards["mex.copa"] = [espnEvent("1", "2026-09-17T18:00:00Z", "Club America", "Tigres", -140)];
    const priced = match({
      homeTeam: "Club America",
      awayTeam: "Tigres",
      competition: "Copa MX",
      kickoff: "2026-09-17T18:00:00.000Z",
      oddsHome: 2.1,
      oddsDraw: 3.3,
      oddsAway: 3.8,
    });

    const result = await backfillOdds([priced], {
      date: new Date("2026-09-17T12:00:00.000Z"),
      sport: "football",
    });

    expect(result.priced).toBe(0);
    expect(result.matches[0]?.oddsHome).toBe(2.1);
    expect(requested.some((u) => /scoreboard/.test(u))).toBe(false);
  });

  it("fills only the missing leg, keeping the price the fixture already had", async () => {
    scoreboards["mex.copa"] = [espnEvent("1", "2026-09-18T18:00:00Z", "Club America", "Tigres", -140)];
    const partial = match({
      homeTeam: "Club America",
      awayTeam: "Tigres",
      competition: "Copa MX",
      kickoff: "2026-09-18T18:00:00.000Z",
      oddsHome: 1.5,
      oddsDraw: null,
      oddsAway: null,
    });

    const result = await backfillOdds([partial], {
      date: new Date("2026-09-18T12:00:00.000Z"),
      sport: "football",
    });

    expect(result.matches[0]?.oddsHome).toBe(1.5);
    expect(result.matches[0]?.oddsDraw).toBeCloseTo(4.1, 2);
    expect(result.matches[0]?.oddsAway).toBeCloseTo(3.4, 2);
  });
});

/**
 * Finding a fixture on ESPN's feed by name.
 *
 * This is what makes the match centre's timeline, live stats, lineups, momentum
 * and shot map reachable for a fixture that arrived from another provider.
 */
describe("resolving a fixture to an ESPN event", () => {
  it("finds the event for a fixture that came from another source", async () => {
    scoreboards["mex.copa"] = [espnEvent("9001", "2026-10-01T18:00:00Z", "Club America", "Tigres", -140)];

    const externalId = await resolveEspnEventId({
      externalId: "sportsdb:12345",
      homeTeam: "Club America",
      awayTeam: "Tigres",
      competition: "Copa MX",
      kickoff: "2026-10-01T18:00:00.000Z",
      sport: "football",
    });

    // The id has to be one `parseEspnId` can resolve back to a league slug, or
    // the deep view is found and then thrown away — indistinguishable from not
    // finding it at all.
    expect(externalId).toBe("espn:mex.copa:9001");
  });

  it("returns an ESPN id unchanged rather than looking it up again", async () => {
    const externalId = await resolveEspnEventId({
      externalId: "espn:eng.1:401879285",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      competition: "Premier League",
      sport: "football",
    });

    expect(externalId).toBe("espn:eng.1:401879285");
    expect(requested.some((u) => /scoreboard/.test(u))).toBe(false);
  });

  it("answers null for a fixture that is genuinely not on the feed", async () => {
    // A lower-league game the archive carries and ESPN does not. Null is the
    // honest answer: guessing would attach another match's timeline to this one.
    scoreboards["mex.copa"] = [espnEvent("1", "2026-10-05T18:00:00Z", "Other", "Teams", -140)];

    const externalId = await resolveEspnEventId({
      externalId: "openfootball:abc",
      homeTeam: "Club America",
      awayTeam: "Tigres",
      competition: "Copa MX",
      kickoff: "2026-10-05T18:00:00.000Z",
      sport: "football",
    });

    expect(externalId).toBeNull();
  });

  it("gives up rather than choosing when the same pair appears twice in a day", async () => {
    scoreboards["mex.copa"] = [
      espnEvent("1", "2026-10-09T18:00:00Z", "Club America", "Tigres", -140),
      espnEvent("2", "2026-10-09T20:00:00Z", "Club America", "Tigres", -120),
    ];

    const externalId = await resolveEspnEventId({
      externalId: "sportsdb:1",
      homeTeam: "Club America",
      awayTeam: "Tigres",
      competition: "Copa MX",
      kickoff: "2026-10-09T18:00:00.000Z",
      sport: "football",
    });

    expect(externalId).toBeNull();
  });

  it("leaves a competition it cannot place on the feed alone", async () => {
    const externalId = await resolveEspnEventId({
      externalId: "openfootball:abc",
      homeTeam: "Yangon United",
      awayTeam: "Shan United",
      competition: "Myanmar National League",
      kickoff: "2026-10-13T18:00:00.000Z",
      sport: "football",
    });

    expect(externalId).toBeNull();
    expect(requested.some((u) => /scoreboard/.test(u))).toBe(false);
  });
});
