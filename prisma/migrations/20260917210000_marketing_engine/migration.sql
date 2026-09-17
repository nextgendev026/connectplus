-- The self-marketing engine: campaigns the brain writes, and one row per attempt
-- to put one on a channel.
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'social',
    "channel" TEXT NOT NULL DEFAULT 'facebook',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "topics" TEXT,
    "rationale" TEXT,
    "signals" TEXT,
    "hashtags" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'hybrid',
    "score" INTEGER NOT NULL DEFAULT 0,
    "url" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketingCampaign_status_createdAt_idx" ON "MarketingCampaign"("status", "createdAt");
CREATE INDEX "MarketingCampaign_channel_status_idx" ON "MarketingCampaign"("channel", "status");

CREATE TABLE "MarketingShare" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "target" TEXT,
    "externalId" TEXT,
    "url" TEXT,
    "error" TEXT,
    "clickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingShare_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketingShare_campaignId_createdAt_idx" ON "MarketingShare"("campaignId", "createdAt");
CREATE INDEX "MarketingShare_channel_status_idx" ON "MarketingShare"("channel", "status");

ALTER TABLE "MarketingShare"
    ADD CONSTRAINT "MarketingShare_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
