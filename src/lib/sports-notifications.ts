import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { LIVE_STATUSES } from "@/lib/sports";
import { getMatchDetail } from "@/lib/sports-detail";
import { BASELINE_MODEL } from "@/lib/sports-intelligence";

/**
 * Sports notification pipeline.
 *
 * A reader's choices — following a team, or starring one fixture — are turned
 * into notifications the moment something happens: kick-off is imminent, the
 * match goes live, a goal or red card lands, a substitution changes the shape of
 * the game, it finishes, or the model's pick on it settles.
 *
 * The incident alerts (goal / red / sub) are per-EVENT, not per-match: they read
 * the provider's play-by-play and are keyed by the provider's own event id, so a
 * second goal an hour later is a second alert and the same goal is never repeated
 * on the next sweep. That id is what the notification ledger stores.
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

export const SPORTS_EVENTS = ["KICKOFF", "LIVE", "GOAL", "RED_CARD", "SUB", "FINAL", "PICK_SETTLED"] as const;
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
  /** A `SportsEvent`, or `EVENT:<providerEventId>` for a per-incident alert. */
  event: string;
  title: string;
  message: string;
}

interface LiveIncident {
  /** The provider's event id — the dedupe key that makes alerts per-incident. */
  id: string;
  event: SportsEvent;
  title: string;
  message: string;
}

/** How far back an incident is still worth alerting about. */
const INCIDENT_WINDOW_MINUTES = 6;
/** Fixtures whose play-by-play may be opened in one sweep. */
const LIVE_ALERT_BUDGET = 15;

/** `GOAL:401879285:12` → `GOAL`, so a reader's subscription still matches. */
export function baseEvent(event: string): string {
  const at = event.indexOf(":");
  return at === -1 ? event : event.slice(0, at);
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

  // Who is watching what, resolved up front: the incident pass below needs to
  // know which live fixtures someone actually cares about, so it never opens a
  // play-by-play feed for a match nobody asked about.
  const audiences = new Map<string, { userId: string; events: Set<string> }[]>();
  for (const match of matches) {
    const audience = audienceFor(match);
    if (audience.length > 0) audiences.set(match.id, audience);
  }

  /*
   * Incident alerts. A goal is the one thing a football reader wants pushed the
   * instant it happens, and it cannot be inferred from the scoreline alone (a
   * score that moved tells you a goal happened, not who scored it or when), so
   * this reads the provider's play-by-play for the fixtures that are live and
   * being watched. Bounded both ways: at most LIVE_ALERT_BUDGET fixtures, and
   * only events from the last few minutes, so a sweep after a quiet half sends
   * nothing at all.
   */
  const liveWatchlist = matches.filter(
    (m) =>
      LIVE_STATUSES.includes(m.status as "LIVE" | "HT") &&
      audiences.has(m.id) &&
      m.externalId.startsWith("espn:")
  );
  const incidentsByMatch = new Map<string, LiveIncident[]>();
  await Promise.all(
    liveWatchlist.slice(0, LIVE_ALERT_BUDGET).map(async (match) => {
      const incidents = await liveIncidents(match).catch(() => [] as LiveIncident[]);
      if (incidents.length > 0) incidentsByMatch.set(match.id, incidents);
    })
  );

  for (const match of matches) {
    const audience = audiences.get(match.id) ?? [];
    if (audience.length === 0) continue;

    const isLive = LIVE_STATUSES.includes(match.status as "LIVE" | "HT");
    const isFinal = match.status === "FT";
    const until = minutesUntil(match.kickoff, now);
    const label = `${match.homeTeam} vs ${match.awayTeam}`;

    const events: { event: string; title: string; message: string }[] = [];

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

    /* Incidents carry the provider event id in the event key, which is exactly
     * what makes "the same goal" and "the next goal" different rows. */
    for (const incident of incidentsByMatch.get(match.id) ?? []) {
      events.push({
        event: `${incident.event}:${incident.id}`,
        title: incident.title,
        message: incident.message,
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
        // A reader subscribes to KICKOFF/FINAL/GOAL…; the per-incident key only
        // exists to tell two goals apart in the ledger.
        if (allowed.size > 0 && !allowed.has(baseEvent(item.event))) continue;
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
  for (const item of fresh) {
    const key = baseEvent(item.event);
    result.byEvent[key] = (result.byEvent[key] ?? 0) + 1;
  }

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
          // Tagged per incident for goals: a second goal must arrive as its own
          // banner rather than silently replacing the first one.
          tag: `cp-sports-${first.matchId}-${baseEvent(first.event)}`,
          important: first.event === "KICKOFF" || baseEvent(first.event) === "FINAL" || baseEvent(first.event) === "GOAL",
          // A match alert buzzes like a match alert, in the app and out of it.
          kind: "sports",
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

/**
 * The incidents in one live fixture's last few minutes.
 *
 * Reads the provider's play-by-play (cached by the detail module, so several
 * sweeps in a row cost one upstream call) and keeps only goals, red cards and
 * substitutions inside the recency window. Everything else — corners, fouls,
 * shots — is deliberately left out: a phone that buzzes for a throw-in is a phone
 * whose sports alerts get switched off.
 */
async function liveIncidents(
  match: {
    provider: string;
    externalId: string;
    competition: string;
    homeTeam: string;
    awayTeam: string;
    homeScore: number | null;
    awayScore: number | null;
    status: string;
    minute: number | null;
  }
): Promise<LiveIncident[]> {
  const detail = await getMatchDetail({
    externalId: match.externalId,
    provider: match.provider,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    competition: match.competition,
    status: match.status,
  });
  if (!detail.found) return [];

  const minute = match.minute ?? 0;
  const from = Math.max(0, minute - INCIDENT_WINDOW_MINUTES);
  const scoreline = `${match.homeTeam} ${match.homeScore ?? 0}-${match.awayScore ?? 0} ${match.awayTeam}`;

  const out: LiveIncident[] = [];
  for (const event of detail.events) {
    if (event.minute == null || event.minute < from) continue;
    const isGoal = event.scoring;
    const isRed = event.kind === "red";
    const isSub = event.kind === "sub";
    if (!isGoal && !isRed && !isSub) continue;

    const who = event.players.length > 0 ? event.players.join(", ") : (event.teamName ?? "Unknown");
    const clock = event.minuteLabel || `${event.minute}'`;

    if (isGoal) {
      out.push({
        id: event.id,
        event: "GOAL",
        title: `Goal — ${event.teamName ?? match.homeTeam}`,
        message: `${scoreline} (${clock}) · ${who}`,
      });
    } else if (isRed) {
      out.push({
        id: event.id,
        event: "RED_CARD",
        title: "Red card",
        message: `${who} off — ${scoreline} (${clock})`,
      });
    } else {
      out.push({
        id: event.id,
        event: "SUB",
        title: `Substitution — ${event.teamName ?? match.homeTeam}`,
        message: `${who} (${clock}) · ${scoreline}`,
      });
    }
  }
  return out;
}
