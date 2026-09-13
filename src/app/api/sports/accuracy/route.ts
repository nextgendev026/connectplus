import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  breakdownBy,
  calibrationBuckets,
  compareStrategies,
  dailySeries,
  summarize,
  type GradedPick,
} from "@/lib/sports-accuracy";
import { BASELINE_MODEL, MARKET_LABELS, PRIMARY_MODEL } from "@/lib/sports-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sports/accuracy?days=30 — admin only.
 *
 * The model record: headline accuracy, calibration buckets (stated confidence vs
 * observed hit rate), per-market and per-competition breakdowns, a daily time
 * series, and the market-baseline comparison. Everything is computed from
 * settled picks only, so the numbers cannot be inflated by pending picks.
 *
 * This moved behind the admin console: the public tip board publishes the
 * headline record, but the audit view (and the fact that the model is graded
 * against the closing line) is staff tooling.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user?.id || (role !== "ADMIN" && role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(Number(searchParams.get("days") ?? 30) || 30, 7), 180);

  try {
    const rows = await prisma.sportsPrediction
      .findMany({
        where: { status: { in: ["WON", "LOST"] } },
        select: {
          market: true,
          model: true,
          confidence: true,
          status: true,
          settledAt: true,
          match: { select: { competition: true } },
        },
        orderBy: { settledAt: "desc" },
        take: 5000,
      })
      .catch(() => []);

    // GradedPick plus the model that produced the pick, so the model and the
    // market baseline can be summarised side by side.
    type GradedRow = GradedPick & { model: string };
    const graded: GradedRow[] = rows
      .filter((r) => r.settledAt != null)
      .map((r) => ({
        market: r.market,
        model: r.model,
        confidence: r.confidence,
        won: r.status === "WON",
        settledAt: r.settledAt as Date,
        competition: r.match?.competition ?? "Unknown",
      }));

    // The published record is the model's own picks; the baseline is graded
    // separately so the comparison is apples-to-apples.
    const picks: GradedPick[] = graded.filter((p) => p.model !== BASELINE_MODEL);
    const baselinePicks: GradedPick[] = graded.filter((p) => p.model === BASELINE_MODEL);

    const pending = await prisma.sportsPrediction
      .count({ where: { status: "PENDING", model: PRIMARY_MODEL } })
      .catch(() => 0);

    const byMarket = breakdownBy(picks, (p) => MARKET_LABELS[p.market] ?? p.market);

    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        days,
        overall: summarize(picks),
        pending,
        strategy: compareStrategies(picks, baselinePicks),
        byStrategy: breakdownBy(graded, (p) => p.model),
        marketAccuracy: Object.fromEntries(
          breakdownBy(picks, (p) => p.market).map((r) => [r.key, { accuracy: r.accuracy, sample: r.settled }])
        ),
        calibration: calibrationBuckets(picks, 10),
        byMarket,
        byCompetition: breakdownBy(picks, (p) => p.competition).slice(0, 20),
        series: dailySeries(picks, days),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load accuracy", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
