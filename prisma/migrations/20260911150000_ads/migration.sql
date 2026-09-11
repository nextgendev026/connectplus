-- Manually-injected ads managed from the admin console.
CREATE TABLE IF NOT EXISTS "Ad" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slot" TEXT NOT NULL DEFAULT 'feed-inline',
    "format" TEXT NOT NULL DEFAULT 'image',
    "imageUrl" TEXT,
    "html" TEXT,
    "targetUrl" TEXT,
    "sponsor" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Ad_slot_isActive_idx" ON "Ad"("slot", "isActive");
