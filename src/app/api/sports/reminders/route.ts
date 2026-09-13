import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SPORTS_EVENTS } from "@/lib/sports-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET    /api/sports/reminders              — the reader's favourited fixtures
 * POST   /api/sports/reminders              — favourite a fixture (notify me)
 * DELETE /api/sports/reminders?matchKey=…   — unfavourite one, or ?all=1
 *
 * A reminder is a per-fixture notification subscription, which is what the bell
 * on each row toggles. Stronger than a passing interest in a team and much
 * lighter than following a club forever — readers usually want the derby, not
 * the season.
 */
async function currentUserId(): Promise<string | null> {
  try {
    const session = await auth();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function listReminders(userId: string) {
  return prisma.sportsMatchReminder
    .findMany({
      where: { userId },
      select: { matchKey: true, homeTeam: true, awayTeam: true, competition: true, kickoff: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    })
    .catch(() => []);
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ reminders: [] });
  return NextResponse.json({ reminders: await listReminders(userId) });
}

export async function POST(request: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    matchKey?: string;
    provider?: string;
    externalId?: string;
    homeTeam?: string;
    awayTeam?: string;
    competition?: string;
    kickoff?: string | null;
    events?: string[];
  };

  const provider = (body.provider ?? "").trim();
  const externalId = (body.externalId ?? "").trim();
  if (!provider || !externalId) {
    return NextResponse.json({ error: "provider and externalId are required" }, { status: 400 });
  }
  const matchKey = (body.matchKey ?? `${provider}:${externalId}`).slice(0, 160);
  const requested = Array.isArray(body.events)
    ? body.events.filter((e): e is string => (SPORTS_EVENTS as readonly string[]).includes(e))
    : [...SPORTS_EVENTS];
  const events = requested.length > 0 ? requested.join(",") : SPORTS_EVENTS.join(",");

  const kickoff = body.kickoff ? new Date(body.kickoff) : null;

  await prisma.sportsMatchReminder
    .upsert({
      where: { userId_matchKey: { userId, matchKey } },
      create: {
        userId,
        matchKey,
        provider: provider.slice(0, 60),
        externalId: externalId.slice(0, 120),
        homeTeam: (body.homeTeam ?? "Home").slice(0, 120),
        awayTeam: (body.awayTeam ?? "Away").slice(0, 120),
        competition: (body.competition ?? "Unknown").slice(0, 160),
        kickoff: kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff : null,
        events,
      },
      update: { events, kickoff: kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff : null },
    })
    .catch(() => null);

  return NextResponse.json({ reminders: await listReminders(userId), matchKey, events: events.split(",") });
}

export async function DELETE(request: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const matchKey = searchParams.get("matchKey");
  const all = searchParams.get("all") === "1";

  if (all) {
    await prisma.sportsMatchReminder.deleteMany({ where: { userId } }).catch(() => null);
  } else if (matchKey) {
    await prisma.sportsMatchReminder.deleteMany({ where: { userId, matchKey } }).catch(() => null);
  } else {
    return NextResponse.json({ error: "Provide matchKey or all=1" }, { status: 400 });
  }

  return NextResponse.json({ reminders: await listReminders(userId) });
}
