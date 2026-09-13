import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withDbRetry } from "@/lib/db-retry";
import { createLogger } from "@/lib/logger";
import { BASELINE_MODEL, MARKET_LABELS, MARKETS } from "@/lib/sports-intelligence";

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
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 20) || 20, 1), 100);
  const matchId = searchParams.get("matchId") ?? undefined;
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
          .findMany({
          where: {
            status: "PENDING",
            model: { not: BASELINE_MODEL },
            ...(market ? { market } : {}),
            ...(matchId ? { matchId } : {}),
            match: { status: { in: ["SCHEDULED", "LIVE", "HT"] } },
          },
          orderBy:
            sort === "edge"
              ? [{ valueEdge: { sort: "desc", nulls: "last" } }, { confidence: "desc" }]
              : [{ confidence: "desc" }, { createdAt: "desc" }],
          take: limit,
            include: {
              match: {
                select: {
                  id: true,
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

    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        market: market ?? null,
        sort,
        degraded,
        record: {
          settled: settledCount,
          won: wonCount,
          accuracy: settledCount > 0 ? Math.round((wonCount / settledCount) * 1000) / 10 : null,
        },
        picks: picks.map((p) => ({ ...p, marketLabel: MARKET_LABELS[p.market] ?? p.market })),
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load predictions", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
