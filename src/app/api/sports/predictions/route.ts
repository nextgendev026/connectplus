import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withDbRetry } from "@/lib/db-retry";
import { createLogger } from "@/lib/logger";
import {
  BASELINE_MODEL,
  MARKET_LABELS,
  MARKETS,
  PICK_MAX_AGE_MINUTES,
  PICK_MINUTE_CUTOFF,
  pickIsActionable,
} from "@/lib/sports-intelligence";
import { canonicalCompetition, fixtureIdentity } from "@/lib/sports";

/** Provider precedence — a keyed live feed outranks a keyless fallback. */
const PROVIDER_RANK: Record<string, number> = { sportsdb: 0, espn: 1, openligadb: 2, demo: 9 };

const log = createLogger("sports-predictions");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sports/predictions?limit=20&market=1X2&sort=edge
 *
 * The betting-tips feed: pending picks from the published model (the market
 * baseline is never surfaced here), optionally filtered to one market and
 * ordered by confidence or value edge. The record travels with the picks so the
 * tips are always shown next to the results that justify them.
 *
 * NOTHING PAST THE STAKE WINDOW. Confidence ordering used to put a call on a
 * match already at 88' at the very top of the board — unfollowable, and the
 * fastest way to lose a reader's trust in every other number on the page. A
 * fixture is dropped once it passes `PICK_MINUTE_CUTOFF`, and a stale status
 * string is caught by `PICK_MAX_AGE_MINUTES`. The rule that governs the feed is
 * returned with it, so the board can say why the list is short instead of
 * looking broken on a quiet evening.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 20) || 20, 1), 100);
  const matchId = searchParams.get("matchId") ?? undefined;
  // A reader-triggered refresh (the board's own poll, or the Updated button)
  // must not be answered from an intermediary's copy of the previous poll.
  const busted = searchParams.has("bust");
  const marketParam = searchParams.get("market") ?? "";
  const market = (MARKETS as readonly string[]).includes(marketParam) ? marketParam : undefined;
  const sort = searchParams.get("sort") === "edge" ? "edge" : "confidence";

  try {
    // A transient pool timeout here used to fall through to `.catch(() => [])`
    // and render "no picks yet" — a confident lie. Retry first, and if it still
    // fails say so with `degraded` instead of pretending the model is empty.
    let degraded = false;
    const [picks, settled, won] = await Promise.all([
      withDbRetry(() =>
        prisma.sportsPrediction
          .findMany({            where: {
              status: "PENDING",
              model: { not: BASELINE_MODEL },
              ...(market ? { market } : {}),
              ...(matchId ? { matchId } : {}),
              match: {
                AND: [
                  { status: { in: ["SCHEDULED", "LIVE", "HT"] } },
                  // Not already past the point where a pick is usable. Expressed
                  // in SQL as well as in `pickIsActionable` below so the
                  // over-fetch budget is spent on fixtures that can survive the
                  // filter, rather than being eaten by nearly-over matches.
                  {
                    OR: [
                      { kickoff: null },
                      { kickoff: { gte: new Date(Date.now() - PICK_MAX_AGE_MINUTES * 60_000) } },
                    ],
                  },
                  {
                    OR: [
                      { status: "SCHEDULED" },
                      { minute: null },
                      { minute: { lt: PICK_MINUTE_CUTOFF } },
                    ],
                  },
                ],
              },
            },
          orderBy:
            sort === "edge"
              ? [{ valueEdge: { sort: "desc", nulls: "last" } }, { confidence: "desc" }]
              : [{ confidence: "desc" }, { createdAt: "desc" }],
          // Over-fetch: the same fixture is stored once per provider, so the
          // dedupe below needs headroom to still return a full page. Without it
          // a limit of 20 could collapse to 12 cards.
          take: Math.min(limit * 3, 300),
            include: {
              match: {
                select: {
                  id: true,
                  provider: true,
                  competition: true,
                  country: true,
                  homeTeam: true,
                  awayTeam: true,
                  status: true,
                  minute: true,
                  kickoff: true,
                  homeScore: true,
                  awayScore: true,
                  oddsHome: true,
                  oddsDraw: true,
                  oddsAway: true,
                },
              },
            },
          })
      ).catch((error) => {
        degraded = true;
        log.warn("tips query failed after retry", { error: error instanceof Error ? error.message : String(error) });
        return [];
      }),
      withDbRetry(() => prisma.sportsPrediction.count({ where: { status: { in: ["WON", "LOST"] }, model: { not: BASELINE_MODEL } } }))
        .then((n) => ({ n, failed: false }))
        .catch(() => ({ n: 0, failed: true })),
      withDbRetry(() => prisma.sportsPrediction.count({ where: { status: "WON", model: { not: BASELINE_MODEL } } }))
        .then((n) => ({ n, failed: false }))
        .catch(() => ({ n: 0, failed: true })),
    ]);
    degraded = degraded || settled.failed || won.failed;
    const settledCount = settled.n;
    const wonCount = won.n;

    // The newest model write behind what we are about to return. The board shows
    // it, so a reader can tell "no new tips" apart from "this page is stale" —
    // which is exactly the confusion that made the old board look frozen.
    const newestPick = picks.reduce<Date | null>((acc, p) => {
      const t = new Date(p.updatedAt ?? p.createdAt);
      return !acc || t > acc ? t : acc;
    }, null);

    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        updatedAt: newestPick ? newestPick.toISOString() : null,
        market: market ?? null,
        sort,
        degraded,
        // The rule the feed just applied, so the board can explain a short list.
        stakeWindow: { minuteCutoff: PICK_MINUTE_CUTOFF, maxAgeMinutes: PICK_MAX_AGE_MINUTES },
        record: {
          settled: settledCount,
          won: wonCount,
          accuracy: settledCount > 0 ? Math.round((wonCount / settledCount) * 1000) / 10 : null,
        },
        picks: dedupePicks(
          picks.filter((p) => pickIsActionable(p.match)),
          limit
        ).map((p) => ({
          ...p,
          marketLabel: MARKET_LABELS[p.market] ?? p.market,
          match: {
            ...p.match,
            competition: canonicalCompetition(p.match.competition, p.match.country),
          },
        })),
      },
      {
        headers: {
          // A busted request is a deliberate refresh: no shared cache may answer
          // it. Normal reads keep the short CDN window, which is what lets the
          // Cloudflare tier collapse every viewer's poll into one origin fetch.
          "Cache-Control": busted
            ? "no-store"
            : "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load predictions", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

interface PickLike {
  market: string;
  confidence: number;
  valueEdge?: number | null;
  match: { provider: string; competition: string; country: string | null; homeTeam: string; awayTeam: string; kickoff: Date | null };
}

/**
 * One card per fixture, and one card per market on it.
 *
 * Each provider stores its own row for the same match, so a fixture covered by
 * two feeds produced two identical tips under two spellings of the same league
 * — the duplication readers actually see. The winner is the better-ranked
 * provider, and ties fall back to the more confident call so the strongest
 * available evidence survives.
 */
function dedupePicks<T extends PickLike>(picks: T[], limit: number): T[] {
  const best = new Map<string, T>();

  for (const pick of picks) {
    const key = `${fixtureIdentity(pick.match)}|${pick.market}`;
    const current = best.get(key);
    if (!current) {
      best.set(key, pick);
      continue;
    }
    const rank = PROVIDER_RANK[pick.match.provider] ?? 5;
    const currentRank = PROVIDER_RANK[current.match.provider] ?? 5;
    if (
      rank < currentRank ||
      (rank === currentRank && (pick.valueEdge ?? 0) > (current.valueEdge ?? 0))
    ) {
      best.set(key, pick);
    }
  }

  // Preserve the query's ordering: it is what the caller asked to sort by.
  const winners = new Set(best.values());
  return picks.filter((p) => winners.has(p)).slice(0, limit);
}
