-- Sports livescore hub: normalised fixtures, model predictions, admin-injected
-- betting partner referrals, and the activity ledger the console charts.
--
-- Fixtures from every provider are mapped onto ONE shape (SportsMatch), which is
-- also what the sports intelligence layer folds into neural memory. Predictions
-- are graded in place after full time so accuracy is a real, queryable number.

CREATE TABLE IF NOT EXISTS "SportsMatch" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'demo',
    "sport" TEXT NOT NULL DEFAULT 'football',
    "competition" TEXT NOT NULL,
    "competitionId" TEXT,
    "country" TEXT,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "minute" INTEGER,
    "kickoff" TIMESTAMP(3),
    "venue" TEXT,
    "homeForm" TEXT,
    "awayForm" TEXT,
    "oddsHome" DOUBLE PRECISION,
    "oddsDraw" DOUBLE PRECISION,
    "oddsAway" DOUBLE PRECISION,
    "providerUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SportsMatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SportsMatch_provider_externalId_key" ON "SportsMatch"("provider", "externalId");
CREATE INDEX IF NOT EXISTS "SportsMatch_status_kickoff_idx" ON "SportsMatch"("status", "kickoff");
CREATE INDEX IF NOT EXISTS "SportsMatch_competition_kickoff_idx" ON "SportsMatch"("competition", "kickoff");
CREATE INDEX IF NOT EXISTS "SportsMatch_sport_kickoff_idx" ON "SportsMatch"("sport", "kickoff");

CREATE TABLE IF NOT EXISTS "SportsPrediction" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT '1X2',
    "selection" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "homeWinPct" DOUBLE PRECISION,
    "drawPct" DOUBLE PRECISION,
    "awayWinPct" DOUBLE PRECISION,
    "expectedHomeGoals" DOUBLE PRECISION,
    "expectedAwayGoals" DOUBLE PRECISION,
    "valueEdge" DOUBLE PRECISION,
    "rationale" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'hive-hybrid',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SportsPrediction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SportsPrediction_matchId_idx" ON "SportsPrediction"("matchId");
CREATE INDEX IF NOT EXISTS "SportsPrediction_status_idx" ON "SportsPrediction"("status");
CREATE INDEX IF NOT EXISTS "SportsPrediction_createdAt_idx" ON "SportsPrediction"("createdAt");

CREATE TABLE IF NOT EXISTS "BettingReferral" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "region" TEXT,
    "urlTemplate" TEXT NOT NULL,
    "referralCode" TEXT,
    "bonus" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "placement" TEXT NOT NULL DEFAULT 'sports-sidebar',
    "ctaText" TEXT NOT NULL DEFAULT 'Join & claim',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BettingReferral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BettingReferral_slug_key" ON "BettingReferral"("slug");
CREATE INDEX IF NOT EXISTS "BettingReferral_placement_isActive_idx" ON "BettingReferral"("placement", "isActive");

CREATE TABLE IF NOT EXISTS "SportsActivity" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "matchId" TEXT,
    "predictionId" TEXT,
    "referralId" TEXT,
    "userId" TEXT,
    "visitorHash" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SportsActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SportsActivity_type_createdAt_idx" ON "SportsActivity"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "SportsActivity_referralId_idx" ON "SportsActivity"("referralId");
CREATE INDEX IF NOT EXISTS "SportsActivity_matchId_idx" ON "SportsActivity"("matchId");

ALTER TABLE "SportsPrediction"
    ADD CONSTRAINT "SportsPrediction_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "SportsMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Feed health: the per-poll intake verdicts (reason -> count), flagged count and
-- category histogram, so the console can show WHAT was filtered instead of only
-- how many items arrived.
ALTER TABLE "RssFeed" ADD COLUMN IF NOT EXISTS "lastFiltered" TEXT;
ALTER TABLE "RssFeed" ADD COLUMN IF NOT EXISTS "lastFlagged" INTEGER;
ALTER TABLE "RssFeed" ADD COLUMN IF NOT EXISTS "lastCategories" TEXT;
