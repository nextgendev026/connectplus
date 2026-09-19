import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateBody } from "@/lib/api-validation";
import { SportsFollowSchema } from "@/lib/schemas/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET    /api/sports/follows            — the signed-in reader's followed teams
 * POST   /api/sports/follows            — follow a team { team, sport?, competition? }
 * DELETE /api/sports/follows?team=…     — unfollow one, or ?all=1 to clear
 *
 * Follows are per-account and drive the "my teams" filter on the hub. Anonymous
 * readers simply get an empty list and no follow buttons.
 */
async function currentUserId(): Promise<string | null> {
  try {
    const session = await auth();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function listFollowing(userId: string): Promise<string[]> {
  const rows = await prisma.sportsTeamFollow
    .findMany({ where: { userId }, select: { team: true }, orderBy: { createdAt: "asc" } })
    .catch(() => [] as { team: string }[]);
  return rows.map((r) => r.team);
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ following: [] });
  return NextResponse.json({ following: await listFollowing(userId) });
}

export async function POST(request: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await validateBody(request, SportsFollowSchema);
  if (body instanceof NextResponse) return body;
  const { team, sport, competition } = body;

  await prisma.sportsTeamFollow
    .upsert({
      where: { userId_team: { userId, team } },
      create: {
        userId,
        team,
        sport: sport ?? "football",
        competition: competition ?? null,
      },
      update: {},
    })
    .catch(() => null);

  return NextResponse.json({ following: await listFollowing(userId) });
}

export async function DELETE(request: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const team = searchParams.get("team");
  const all = searchParams.get("all") === "1";

  if (all) {
    await prisma.sportsTeamFollow.deleteMany({ where: { userId } }).catch(() => null);
  } else if (team) {
    await prisma.sportsTeamFollow.deleteMany({ where: { userId, team } }).catch(() => null);
  } else {
    return NextResponse.json({ error: "Provide team or all=1" }, { status: 400 });
  }

  return NextResponse.json({ following: await listFollowing(userId) });
}
