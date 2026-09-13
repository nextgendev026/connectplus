import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { LIVE_STATUSES } from "@/lib/sports";
import { BASELINE_MODEL } from "@/lib/sports-intelligence";

/**
 * Sports notification pipeline.
 *
 * A reader's choices — following a team, or starring one fixture — are turned
 * into notifications the moment something happens: kick-off is imminent, the
 * match goes live, it finishes, or the model's pick on it settles.
 *
 * Two properties matter more than anything else here:
 *
 *   1. IDEMPOTENT. A 2-minute job must never send the same kick-off alert twice,
 *      so every send is guarded by a (user, match, event) unique row and only the
 *      rows that actually inserted become notifications.
 *   2. CHEAP. Fan-out is a handful of set-based queries plus two createMany
 *      calls, however many readers and fixtures are involved — never a loop of
 *      per-user inserts.
 */

const log = createLogger("sports-notify");

export const SPORTS_EVENTS = ["KICKOFF", "LIVE", "FINAL", "PICK_SETTLED"] as const;
export type SportsEvent = (typeof SPORTS_EVENTS)[number];

export interface SportsNotifyResult {
  /** Target pairs considered before dedupe. */
  considered: number;
  /** Notifications actually written. */
  sent: number;
  byEvent: Record<string, number>;
  reminders: number;
  followers: number;
}

interface Target {
  userId: string;
  matchId: string;
  event: SportsEvent;
  title: string;
  message: string;
}

/** Kick-off alerts only fire inside this window, and only once per match. */
const KICKOFF_WINDOW_MINUTES = 25;
/** A settled pick is only interesting while it is fresh. */
const SETTLE_WINDOW_MINUTES = 90;
/** How far ahead reminders and follows are expanded. */
const LOOKAHEAD_HOURS = 48;

function minutesUntil(iso: string | Date | null, now: Date): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.round((at - now.getTime()) / 60_000);
}

function scoreLine(homeScore: number | null, awayScore: number | null): string {
  return `${homeScore ?? 0}-${awayScore ?? 0}`;
}

/**
 * Build every notification the current state of the world justifies, then write
 * the ones that have not been sent before.
 */
export async function notifySportsFavourites(
  opts: { now?: Date; limit?: number } = {}
): Promise<SportsNotifyResult> {
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(opts.limit ?? 400, 1), 2000);
  const result: SportsNotifyResult = {
    considered: 0,
    sent: 0,
    byEvent: {},
    reminders: 0,
    followers: 0,
  };

  const windowStart = new Date(now.getTime() - LOOKAHEAD_HOURS / 2 * 3_600_000);
  const windowEnd = new Date(now.getTime() + LOOKAHEAD_HOURS * 3_600_000);

  const [reminders, follows] = await Promise.all([
    prisma.sportsMatchReminder
      .findMany({ take: 2000 })
      .catch(() => [] as { userId: string; matchKey: string; provider: string; externalId: string; events: string }[]),
    prisma.sportsTeamFollow
      .findMany({ take: 5000 })
      .catch(() => [] as { userId: string; team: string }[]),
  ]);
  result.reminders = reminders.length;
  result.followers = new Set(follows.map((f) => f.userId)).size;
  if (reminders.length === 0 && follows.length === 0) return result;

  const teams: string[] = [...new Set(follows.map((f) => f.team))];
  const reminderKeys: string[] = reminders.map((r) => r.matchKey);

  // One query per targeting mode, both bounded — not one query per user.
  const matches = await prisma.sportsMatch
    .findMany({
      where: {
        OR: [
          ...(teams.length > 0
            ? [{ homeTeam: { in: teams } }, { awayTeam: { in: teams } }]
            : []),
          ...(reminderKeys.length > 0
            ? [{ externalId: { in: reminders.map((r) => r.externalId) as string[] } }]
            : []),
        ],
        kickoff: { gte: windowStart, lte: windowEnd },
      },
      select: {
        id: true,
        provider: true,
        externalId: true,
        competition: true,
        homeTeam: true,
        awayTeam: true,
        homeScore: true,
        awayScore: true,
        status: true,
        minute: true,
        kickoff: true,
      },
      orderBy: { kickoff: "asc" },
      take: 400,
    })
    .catch(() => []);
  if (matches.length === 0) return result;

  const followedTeamsByUser = new Map<string, Set<string>>();
  for (const f of follows) {
    const set = followedTeamsByUser.get(f.userId) ?? new Set<string>();
    set.add(f.team);
    followedTeamsByUser.set(f.userId, set);
  }

  // Settled picks on those fixtures, so a reader who asked about a match also
  // hears how the model's call on it went.
  const settledPicks = await prisma.sportsPrediction
    .findMany({
      where: {
        matchId: { in: matches.map((m) => m.id) },
        model: { not: BASELINE_MODEL },
        status: { in: ["WON", "LOST"] },
        settledAt: { gte: new Date(now.getTime() - SETTLE_WINDOW_MINUTES * 60_000) },
      },
      select: { id: true, matchId: true, market: true, selection: true, status: true, confidence: true },
      take: 400,
    })
    .catch(() => []);
  const picksByMatch = new Map<string, typeof settledPicks>();
  for (const pick of settledPicks) {
    const list = picksByMatch.get(pick.matchId) ?? [];
    list.push(pick);
    picksByMatch.set(pick.matchId, list);
  }

  const targets: Target[] = [];

  /** Everyone who asked to hear about this fixture: reminders + team followers. */
  function audienceFor(match: (typeof matches)[number]): { userId: string; events: Set<string> }[] {
    const out = new Map<string, Set<string>>();
    for (const reminder of reminders) {
      if (reminder.provider === match.provider && reminder.externalId === match.externalId) {
        out.set(
          reminder.userId,
          new Set(
            (reminder.events ?? "")
              .split(",")
              .map((e: string) => e.trim())
              .filter(Boolean)
          )
        );
      }
    }
    for (const [userId, teamSet] of followedTeamsByUser) {
      if (teamSet.has(match.homeTeam) || teamSet.has(match.awayTeam)) {
        out.set(userId, out.get(userId) ?? new Set(SPORTS_EVENTS));
      }
    }
    return [...out.entries()].map(([userId, events]) => ({ userId, events }));
  }

  for (const match of matches) {
    const audience = audienceFor(match);
    if (audience.length === 0) continue;

    const isLive = LIVE_STATUSES.includes(match.status as "LIVE" | "HT");
    const isFinal = match.status === "FT";
    const until = minutesUntil(match.kickoff, now);
    const label = `${match.homeTeam} vs ${match.awayTeam}`;

    const events: { event: SportsEvent; title: string; message: string }[] = [];

    if (match.status === "SCHEDULED" && until != null && until >= 0 && until <= KICKOFF_WINDOW_MINUTES) {
      events.push({
        event: "KICKOFF",
        title: "Kick-off soon",
        message: `${label} starts ${until <= 0 ? "now" : `in ${until} min`} · ${match.competition}`,
      });
    }

    if (isLive) {
      events.push({
        event: "LIVE",
        title: match.status === "HT" ? "Half time" : "Goal or kick-off — it's live",
        message: `${match.homeTeam} ${scoreLine(match.homeScore, match.awayScore)} ${match.awayTeam}${
          match.status === "HT" ? " (HT)" : match.minute ? ` (${match.minute}')` : ""
        } · ${match.competition}`,
      });
    }

    if (isFinal) {
      events.push({
        event: "FINAL",
        title: "Full time",
        message: `${match.homeTeam} ${scoreLine(match.homeScore, match.awayScore)} ${match.awayTeam} · ${match.competition}`,
      });
    }

    for (const pick of picksByMatch.get(match.id) ?? []) {
      events.push({
        event: "PICK_SETTLED",
        title: pick.status === "WON" ? "Your match pick landed ✅" : "Your match pick missed",
        message: `${pick.selection} (${pick.market}) ${pick.status === "WON" ? "won" : "lost"} — ${label} · ${Math.round(
          pick.confidence * 100
        )}% call`,
      });
    }

    for (const { userId, events: allowed } of audience) {
      for (const item of events) {
        if (allowed.size > 0 && !allowed.has(item.event)) continue;
        targets.push({ userId, matchId: match.id, ...item });
      }
    }
  }

  result.considered = targets.length;
  if (targets.length === 0) return result;

  // Ask once which (user, match, event) triples already exist, so the writes
  // below only carry genuinely new rows.
  const existing = await prisma.sportsNotificationLog
    .findMany({
      where: {
        userId: { in: [...new Set(targets.map((t) => t.userId))] },
        matchId: { in: [...new Set(targets.map((t) => t.matchId))] },
      },
      select: { userId: true, matchId: true, event: true },
    })
    .catch(() => []);
  const seen = new Set(existing.map((row) => `${row.userId}|${row.matchId}|${row.event}`));

  const fresh = targets.filter((t) => !seen.has(`${t.userId}|${t.matchId}|${t.event}`)).slice(0, limit);
  if (fresh.length === 0) return result;

  await prisma.sportsNotificationLog
    .createMany({
      data: fresh.map((t) => ({ userId: t.userId, matchId: t.matchId, event: t.event })),
      skipDuplicates: true,
    })
    .catch(() => null);

  const created = await prisma.notification
    .createMany({
      data: fresh.map((t) => ({
        userId: t.userId,
        type: `SPORTS_${t.event}`,
        title: t.title,
        message: t.message,
      })),
    })
    .catch(() => ({ count: 0 }));

  result.sent = created.count;
  for (const item of fresh) result.byEvent[item.event] = (result.byEvent[item.event] ?? 0) + 1;

  // The in-app row is only half an alert: a goal matters when the phone is in a
  // pocket, so fan the same events out to registered devices. Aggregated per
  // reader — a busy afternoon that touches three followed teams must not stack
  // three banners — and tagged by fixture so a re-notified match replaces its
  // own previous banner instead of appending.
  const byUser = new Map<string, typeof fresh>();
  for (const item of fresh) {
    const list = byUser.get(item.userId) ?? [];
    list.push(item);
    byUser.set(item.userId, list);
  }

  if (byUser.size > 0) {
    const { sendPushToUsers } = await import("@/lib/push");
    // One send call per reader keeps the payload honest about which match it is
    // about when there is only one, and summarises when there are several.
    await Promise.all(
      [...byUser.entries()].map(([userId, items]) => {
        const first = items[0]!;
        const title = items.length === 1 ? first.title : `${items.length} match updates`;
        const body =
          items.length === 1
            ? first.message
            : items
                .slice(0, 3)
                .map((i) => i.message)
                .join("\n");
        return sendPushToUsers([userId], {
          title,
          body,
          url: "/sports",
          tag: `cp-sports-${first.matchId}`,
          important: first.event === "KICKOFF" || first.event === "FINAL",
        });
      })
    ).catch(() => null);
  }

  log.info("sports notifications", {
    considered: result.considered,
    sent: result.sent,
    byEvent: result.byEvent,
    pushed: byUser.size,
  });
  return result;
}
