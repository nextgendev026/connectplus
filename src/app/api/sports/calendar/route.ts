import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { getSportsCalendar } from "@/lib/sports-calendar";
import { canonicalCompetition } from "@/lib/sports";
import { BASELINE_MODEL, MARKET_LABELS } from "@/lib/sports-intelligence";

const log = createLogger("sports-calendar-api");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The longest window one request may ask for. */
const MAX_DAYS = 62;
/** Fixtures this route will look up predictions for. */
const ANNOTATE_MAX = 400;

function isoDay(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * GET /api/sports/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&sport=football
 *
 * A day, a week or a month of fixtures, grouped by day, with the model's picks
 * attached to the fixtures it has already analysed.
 *
 * Two consumers, one shape: the calendar view renders it directly, and the
 * prediction pass uses the same window to decide which fixtures are worth
 * analysing this week. Building it once means the page can never promise fixtures
 * the model was never shown.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sport = searchParams.get("sport") === "basketball" ? "basketball" : "football";
  const fresh = searchParams.get("fresh") === "1";

  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = isoDay(searchParams.get("from")) ?? todayUtc;
  const requestedTo = isoDay(searchParams.get("to"));
  const to = requestedTo ?? new Date(from.getTime() + 6 * 86_400_000);
  if (to < from) {
    return NextResponse.json({ error: "`to` must not be before `from`" }, { status: 400 });
  }
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > MAX_DAYS) {
    return NextResponse.json({ error: `A calendar window is capped at ${MAX_DAYS} days` }, { status: 400 });
  }

  try {
    const calendar = await getSportsCalendar({ from, to, sport, fresh });

    // Picks for the fixtures on screen. Bounded by the annotate cap because this
    // is a read path, and the calendar's job is to be fast even in August when a
    // month holds several hundred fixtures.
    const target = calendar.matches.slice(0, ANNOTATE_MAX);
    const rows =
      target.length === 0
        ? []
        : await prisma.sportsMatch
            .findMany({
              where: { OR: target.map((m) => ({ provider: m.provider, externalId: m.externalId })) },
              include: {
                predictions: {
                  where: { model: { not: BASELINE_MODEL }, status: "PENDING" },
                  orderBy: { createdAt: "desc" },
                },
              },
            })
            .catch((error) => {
              log.warn("calendar annotation failed", {
                error: error instanceof Error ? error.message : String(error),
              });
              return [];
            });

    const byKey = new Map(rows.map((r) => [`${r.provider}:${r.externalId}`, r]));

    const enriched = target.map((m) => {
      const row = byKey.get(`${m.provider}:${m.externalId}`);
      const predictions = (row?.predictions ?? []).map((p) => ({
        id: p.id,
        market: p.market,
        marketLabel: MARKET_LABELS[p.market] ?? p.market,
        selection: p.selection,
        confidence: p.confidence,
        valueEdge: p.valueEdge,
      }));
      const headline =
        predictions.find((p) => p.market === "1X2") ??
        [...predictions].sort((a, b) => b.confidence - a.confidence)[0] ??
        null;
      return {
        ...m,
        id: row?.id ?? null,
        competition: canonicalCompetition(m.competition, m.country),
        predictions,
        prediction: headline,
      };
    });

    // Grouped by day, because that is the only way a month is readable — a flat
    // list of 400 fixtures is a haystack, not a calendar.
    const dayBuckets = new Map<string, typeof enriched>();
    for (const match of enriched) {
      const key = match.kickoff ? match.kickoff.slice(0, 10) : "unscheduled";
      const bucket = dayBuckets.get(key) ?? [];
      bucket.push(match);
      dayBuckets.set(key, bucket);
    }

    const dayList = [...dayBuckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, matches]) => ({
        date,
        matches,
        live: matches.filter((m) => m.status === "LIVE" || m.status === "HT").length,
        analysed: matches.filter((m) => m.predictions.length > 0).length,
      }));

    return NextResponse.json(
      {
        generatedAt: calendar.generatedAt,
        from: calendar.from,
        to: calendar.to,
        sport: calendar.sport,
        days: dayList,
        total: enriched.length,
        analysed: enriched.filter((m) => m.predictions.length > 0).length,
        sources: calendar.sources,
      },
      {
        headers: {
          // Edge-cacheable: identical for every anonymous reader, and the worker
          // holds it for 15 minutes (see workers/edge-cache POLLABLE).
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load the fixture calendar", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
