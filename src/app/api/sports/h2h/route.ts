import { NextRequest, NextResponse } from "next/server";
import { getFixtureContext } from "@/lib/sports-h2h";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sports/h2h?home=Arsenal&away=Chelsea&homeId=133604&awayId=133610&fresh=1
 *
 * Head-to-head meetings and each side's recent form for one fixture.
 *
 * Teams are addressed by name because that is the only join key shared across
 * every provider — a fixture merged from ESPN carries an ESPN id that
 * TheSportsDB cannot use, so the ids are an optimisation, not a requirement.
 * The lookup is cached on the team pair, so two fixtures involving the same
 * side cost one round trip.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const home = (searchParams.get("home") ?? "").trim();
  const away = (searchParams.get("away") ?? "").trim();

  if (!home || !away) {
    return NextResponse.json({ error: "Both home and away team names are required" }, { status: 400 });
  }

  try {
    const context = await getFixtureContext({
      homeTeam: home,
      awayTeam: away,
      homeTeamId: searchParams.get("homeId"),
      awayTeamId: searchParams.get("awayId"),
      fresh: searchParams.get("fresh") === "1",
    });

    return NextResponse.json(
      { ...context, homeTeam: home, awayTeam: away },
      // Matches the server-side cache window so the browser and the edge agree.
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load head-to-head",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
