-- Match reminders + notification idempotency for favourite fixtures.
--
-- The livescore hub lets a reader favourite a fixture or follow a team; a
-- 2-minute job turns those choices into in-app notifications. Both tables are
-- plain userId-keyed rows (like SportsTeamFollow/SportsActivity) so they need no
-- cascade relationship to User.

CREATE TABLE IF NOT EXISTS "SportsMatchReminder" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "matchKey"    TEXT NOT NULL,
  "provider"    TEXT NOT NULL,
  "externalId"  TEXT NOT NULL,
  "homeTeam"    TEXT NOT NULL,
  "awayTeam"    TEXT NOT NULL,
  "competition" TEXT NOT NULL,
  "kickoff"     TIMESTAMP(3),
  "events"      TEXT NOT NULL DEFAULT 'KICKOFF,LIVE,FINAL,PICK_SETTLED',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SportsMatchReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SportsMatchReminder_userId_matchKey_key"
  ON "SportsMatchReminder"("userId", "matchKey");
CREATE INDEX IF NOT EXISTS "SportsMatchReminder_matchKey_idx" ON "SportsMatchReminder"("matchKey");
CREATE INDEX IF NOT EXISTS "SportsMatchReminder_userId_idx" ON "SportsMatchReminder"("userId");

CREATE TABLE IF NOT EXISTS "SportsNotificationLog" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "matchId"   TEXT NOT NULL,
  "event"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SportsNotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SportsNotificationLog_userId_matchId_event_key"
  ON "SportsNotificationLog"("userId", "matchId", "event");
CREATE INDEX IF NOT EXISTS "SportsNotificationLog_createdAt_idx" ON "SportsNotificationLog"("createdAt");
CREATE INDEX IF NOT EXISTS "SportsNotificationLog_userId_idx" ON "SportsNotificationLog"("userId");
