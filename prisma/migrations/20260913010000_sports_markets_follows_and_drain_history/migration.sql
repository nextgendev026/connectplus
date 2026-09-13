-- Reader team follows + durable RSS drain history.
--
-- SportPrediction needs no schema change for multi-market picks: the market /
-- selection columns already exist and a fixture may now carry several rows
-- (1X2, over/under, BTTS, correct score). This migration only adds the two
-- supporting tables plus the index the accuracy queries rely on.

CREATE TABLE IF NOT EXISTS "SportsTeamFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "sport" TEXT NOT NULL DEFAULT 'football',
    "competition" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SportsTeamFollow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SportsTeamFollow_userId_team_key" ON "SportsTeamFollow"("userId", "team");
CREATE INDEX IF NOT EXISTS "SportsTeamFollow_userId_idx" ON "SportsTeamFollow"("userId");
CREATE INDEX IF NOT EXISTS "SportsTeamFollow_team_idx" ON "SportsTeamFollow"("team");

CREATE INDEX IF NOT EXISTS "SportsPrediction_market_status_idx" ON "SportsPrediction"("market", "status");

CREATE TABLE IF NOT EXISTS "RssDrainRun" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "newArticles" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "RssDrainRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RssDrainRun_startedAt_idx" ON "RssDrainRun"("startedAt");

CREATE TABLE IF NOT EXISTS "RssDrainFeed" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "feedId" TEXT,
    "feedName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "newArticles" INTEGER NOT NULL DEFAULT 0,
    "items" INTEGER,
    "durationMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RssDrainFeed_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RssDrainFeed_runId_idx" ON "RssDrainFeed"("runId");
CREATE INDEX IF NOT EXISTS "RssDrainFeed_feedId_createdAt_idx" ON "RssDrainFeed"("feedId", "createdAt");

ALTER TABLE "RssDrainFeed"
    ADD CONSTRAINT "RssDrainFeed_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "RssDrainRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
