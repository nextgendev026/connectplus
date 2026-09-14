import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest";
import { getSportsHub, LIVE_STATUSES, type NormalizedMatch } from "@/lib/sports";
import { BASELINE_MODEL } from "@/lib/sports-intelligence";
import { runThrottled } from "@/lib/throttled-job";
import { createLogger } from "@/lib/logger";

const log = createLogger("sports-live-api");

/** How often the board may opportunistically top up picks and alerts. */
const SELF_HEAL_INTEL_MS = 5 * 60_000;
const SELF_HEAL_NOTIFY_MS = 60_000;
/** …and how often it may re-run the picks for fixtures about to kick off. */
const SELF_HEAL_KICKOFF_MS = 10 * 60_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ApiPrediction {
  id: string;
  market: string;
  selection: string;
  confidence: number;
  homeWinPct: number | null;
  drawPct: number | null;
  awayWinPct: number | null;
  expectedHomeGoals: number | null;
  expectedAwayGoals: number | null;
  valueEdge: number | null;
  rationale: string;
  status: string;
}

/**
 * GET /api/sports/live?sport=football&date=YYYY-MM-DD
 *
 * The livescore feed. Returns the normalised snapshot (grouped by competition)
 * with each fixture's database id and every market's prediction attached, so
 * the client can render scores and open the in-app betting analysis without a
 * second round trip.
 *
 * HARD RULE: this route never generates picks. An analyser pass used to run
 * inline whenever a fixture had none, which turned a cold board into a 110s
 * request (the scoreboard must never wait on model training). Missing picks are
 * handed to Inngest as a background event and the board answers immediately; the
 * `sports-intel` / `sports-live` jobs are what keep picks warm.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sport = searchParams.get("sport") || "football";
  const dateParam = searchParams.get("date");
  const parsed = dateParam ? new Date(dateParam) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const fresh = searchParams.get("fresh") === "1";

  try {
    const hub = await getSportsHub({ sport, date, fresh });

    const annotated = await annotate(hub.matches);
    const missing = annotated.filter(
      (m) => m.predictions.length === 0 && (LIVE_STATUSES.includes(m.status) || m.status === "SCHEDULED")
    ).length;
    if (missing > 0) {
      // Best-effort hand-off: fire-and-forget so a slow model pass can never
      // delay the scoreboard.
      void inngest
        .send({ name: "sports-intel", data: { reason: "missing-picks", missing, sport: hub.sport } })
        .catch(() => null);

      // …and a scheduler-independent safety net. Inngest is the intended owner,
      // but it is a single point of failure with no way to notice its own
      // absence: if the queue is unsynced or paused, the model simply stops and
      // the board keeps serving picks that predate the current fixtures. This
      // runs AFTER the response is flushed, so the visitor never waits, and the
      // heartbeat throttle collapses a thousand concurrent viewers into one
      // attempt per interval.
      after(async () => {
        const intel = await runThrottled("sports-intel", SELF_HEAL_INTEL_MS, async () => {
          const { runSportsIntelligence } = await import("@/lib/sports-intelligence");
          return runSportsIntelligence({ limit: 12, teach: false });
        });
        if (intel.ran) log.info("opportunistic pick top-up", { missing, sport: hub.sport });
      });
    }

    // A fixture about to start gets re-read at the moment it matters: team news
    // has landed and the price has moved since this morning's pick. Riding the
    // busiest page means a matchday refreshes itself even if Inngest is quiet;
    // the throttle keeps it to one run per interval however many readers arrive.
    after(async () => {
      const kickoff = await runThrottled("sports-kickoff-refresh", SELF_HEAL_KICKOFF_MS, async () => {
        const { refreshApproachingKickoff } = await import("@/lib/sports-intelligence");
        return refreshApproachingKickoff({ limit: 12 });
      });
      if (kickoff.ran) log.info("opportunistic kick-off refresh");
    });

    // Favourite alerts ride the same surface: the bell only rings when a job
    // runs, so the busiest page in the app guarantees one attempt a minute.
    after(async () => {
      const notify = await runThrottled("sports-notify", SELF_HEAL_NOTIFY_MS, async () => {
        const { notifySportsFavourites } = await import("@/lib/sports-notifications");
        return notifySportsFavourites();
      });
      if (notify.ran) log.info("opportunistic favourite alert sweep");
    });

    return NextResponse.json(
      {
        generatedAt: hub.generatedAt,
        provider: hub.provider,
        providerLabel: hub.providerLabel,
        demo: hub.demo,
        date: hub.date,
        sport: hub.sport,
        liveCount: annotated.filter((m) => LIVE_STATUSES.includes(m.status)).length,
        sources: hub.sources,
        stale: hub.stale,
        picksPending: missing,
        competitions: hub.competitions,
        matches: annotated,
      },
      { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load live scores", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

async function annotate(
  matches: NormalizedMatch[]
): Promise<(NormalizedMatch & { id: string | null; prediction: ApiPrediction | null; predictions: ApiPrediction[] })[]> {
  if (matches.length === 0) return [];
  const rows = await prisma.sportsMatch
    .findMany({
      where: { OR: matches.map((m) => ({ provider: m.provider, externalId: m.externalId })) },
      include: { predictions: { orderBy: { createdAt: "desc" } } },
    })
    .catch(() => []);

  const byKey = new Map(rows.map((r) => [`${r.provider}:${r.externalId}`, r]));

  return matches.map((m) => {
    const row = byKey.get(`${m.provider}:${m.externalId}`);
    // The market baseline is an internal benchmark — never shown in the public
    // analysis. Readers see the model's own picks.
    const all: ApiPrediction[] = (row?.predictions ?? [])
      .filter((p) => p.model !== BASELINE_MODEL)
      .map((p) => ({
      id: p.id,
      market: p.market,
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
      }));
    // The headline pick is the match-result call; fall back to the most
    // confident market when a fixture somehow has no 1X2 row.
    const primary =
      all.find((p) => p.market === "1X2") ??
      [...all].sort((a, b) => b.confidence - a.confidence)[0] ??
      null;

    return { ...m, id: row?.id ?? null, prediction: primary, predictions: all };
  });
}
