import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { getMatchDetail } from "@/lib/sports-detail";
import { getSportsHub, LIVE_STATUSES } from "@/lib/sports";
import { runThrottled } from "@/lib/throttled-job";
import { BASELINE_MODEL, MARKET_LABELS, PICK_REFRESH_MIN_AGE_MINUTES } from "@/lib/sports-intelligence";
import { ESPN_SPORT_PATH } from "@/lib/sports-scope";

const log = createLogger("sports-match-api");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sports/match?provider=espn&externalId=espn:eng.1:401879285&fresh=1
 *
 * Everything the match centre needs for ONE fixture, in one round trip: the deep
 * provider detail (timeline, team stats, lineups, momentum, shot map, head to
 * head), the model's own picks on it, and the written read derived from the two.
 *
 * Server-side on purpose. The board polls every fixture on the page; it must not
 * pull thirty timelines at once, so this is fetched only when a reader opens a
 * match — and the detail module caches it per provider fixture with a TTL that
 * follows the match state (seconds live, minutes once finished).
 *
 * The model's picks are read from OUR database rather than normalised from the
 * provider, so the analysis a reader sees in the match centre is the same pick —
 * same numbers, same rationale — the tips board published. Two surfaces inventing
 * their own version of "our model's view" is how a sports desk loses the plot.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const provider = (searchParams.get("provider") ?? "").trim().slice(0, 60);
  const externalId = (searchParams.get("externalId") ?? "").trim().slice(0, 160);
  const fresh = searchParams.get("fresh") === "1";
  // Set when a reader explicitly asks for the analysis (opening a panel, tapping
  // Refresh), as opposed to the background poll.
  const regenerate = searchParams.get("regenerate") === "1";

  if (!provider || !externalId) {
    return NextResponse.json({ error: "provider and externalId are required" }, { status: 400 });
  }

  try {
    const row = await prisma.sportsMatch
      .findUnique({
        where: { provider_externalId: { provider, externalId } },
        include: {
          predictions: {
            where: { model: { not: BASELINE_MODEL } },
            orderBy: { createdAt: "desc" },
          },
        },
      })
      .catch((error) => {
        log.warn("match lookup failed", {
          provider,
          externalId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

    // The panel can be opened from a live feed row before the fixture has been
    // persisted, so the client passes the teams as a fallback: a missing row must
    // not cost the reader the whole analysis.
    const homeTeam = row?.homeTeam ?? (searchParams.get("home") ?? "Home").slice(0, 120);
    const awayTeam = row?.awayTeam ?? (searchParams.get("away") ?? "Away").slice(0, 120);

    // ESPN addresses football as `soccer`, and that is the only path this desk
    // has: a stored row from before the scope change cannot send the panel at a
    // sport we do not serve.
    const sport = ESPN_SPORT_PATH;

    const detail = await getMatchDetail({
      externalId,
      provider,
      homeTeam,
      awayTeam,
      competition: row?.competition ?? null,
      // Both of these are what let a fixture from a non-ESPN source be found on
      // ESPN's feed, which is what gives it live commentary and stats.
      competitionId: row?.competitionId ?? null,
      kickoff: row?.kickoff ?? null,
      status: row?.status ?? null,
      sport,
      fresh,
    });

    /*
     * Regenerate the picks for THIS fixture while the reader is looking at it.
     *
     * The model's own cadence is minutes, and a panel opened at 19:28 for a
     * 19:30 kick-off is precisely the moment its morning pick is least useful:
     * team news has landed and the price has moved. So an explicit analysis
     * request re-reads the fixture through the full pipeline — Poisson model,
     * learned priors, form, lineups, hive-mind consultation — and writes the
     * result before the panel's next poll picks it up.
     *
     * Three guards keep it from becoming a denial-of-service on our own model:
     * it only runs when someone actually asked, only when the existing pick is
     * old enough to be worth replacing, and at most once per fixture per window
     * (the throttle key is per fixture, so two readers on the same match share
     * one run and different matches never block each other).
     */
    const newestPick =
      (row?.predictions ?? []).reduce<Date | null>((acc, p) => (!acc || p.updatedAt > acc ? p.updatedAt : acc), null);
    const pickAgeMs = newestPick ? Date.now() - newestPick.getTime() : Number.POSITIVE_INFINITY;
    const regenerating =
      regenerate &&
      Boolean(row) &&
      pickAgeMs > PICK_REFRESH_MIN_AGE_MINUTES * 60_000 &&
      (row!.status === "SCHEDULED" || LIVE_STATUSES.includes(row!.status as "LIVE" | "HT"));

    if (regenerating) {
      // After the response is flushed: never make the reader wait on the model.
      after(async () => {
        const run = await runThrottled(
          `sports-regen:${provider}:${externalId}`,
          PICK_REFRESH_MIN_AGE_MINUTES * 60_000,
          async () => {
            const hub = await getSportsHub({ fresh: true });
            const fixture = hub.matches.find((m) => m.provider === provider && m.externalId === externalId);
            // Not in the live snapshot (an old date, or the feed dropped it) —
            // the pipeline can only rank fixtures it can see.
            if (!fixture) return { generated: 0, refreshed: 0 };
            const { runSportsIntelligence } = await import("@/lib/sports-intelligence");
            return runSportsIntelligence({ matches: [fixture], teach: false, limit: 3 });
          }
        );
        if (run.ran) log.info("analysis-triggered regeneration", { provider, externalId });
      });
    }

    const predictions = (row?.predictions ?? []).map((p) => ({
      id: p.id,
      market: p.market,
      marketLabel: MARKET_LABELS[p.market] ?? p.market,
      selection: p.selection,
      confidence: p.confidence,
      homeWinPct: p.homeWinPct,
      drawPct: p.drawPct,
      awayWinPct: p.awayWinPct,
      expectedHomeGoals: p.expectedHomeGoals,
      expectedAwayGoals: p.expectedAwayGoals,
      valueEdge: p.valueEdge,
      rationale: p.rationale,
      status: p.status,
      createdAt: p.createdAt,
    }));

    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        match: row
          ? {
              id: row.id,
              provider: row.provider,
              externalId: row.externalId,
              competition: row.competition,
              country: row.country,
              homeTeam: row.homeTeam,
              awayTeam: row.awayTeam,
              homeScore: row.homeScore,
              awayScore: row.awayScore,
              status: row.status,
              minute: row.minute,
              kickoff: row.kickoff,
              venue: row.venue,
              oddsHome: row.oddsHome,
              oddsDraw: row.oddsDraw,
              oddsAway: row.oddsAway,
            }
          : null,
        detail,
        predictions,
        // The panel shows a "refreshing picks" hint and re-reads once, so a
        // reader who just triggered a regeneration sees the new numbers rather
        // than the ones they were looking at when they tapped.
        regenerating,
        predictionsUpdatedAt: newestPick ? newestPick.toISOString() : null,
      },
      {
        headers: {
          // A regeneration request must never be answered from a cache: the
          // reader asked precisely because they suspect the copy on screen is
          // old, and handing them that same copy back is the one response that
          // makes the button look broken.
          "Cache-Control": regenerating
            ? "no-store"
            : detail.status === "LIVE" || detail.status === "HT"
              ? "public, s-maxage=10, stale-while-revalidate=20"
              : "public, s-maxage=120, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load match detail", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
