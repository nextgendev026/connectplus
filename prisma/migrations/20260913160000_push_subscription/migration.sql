-- Push endpoints get their own table.
--
-- Previously every device's subscription lived in one PlatformSetting JSON
-- array, so subscribing was a read-modify-write over the whole set: concurrent
-- registrations dropped one another, the blob grew unbounded, and an endpoint
-- that had been revoked by the browser could not be identified, let alone
-- pruned. One row per endpoint makes subscribe, rotate and prune single-row
-- operations, and the unique index on `endpoint` makes re-registration
-- idempotent.
--
-- Additive only: no existing column, row or index is touched, so this is safe
-- to apply to a live database.

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
CREATE INDEX "PushSubscription_failures_idx" ON "PushSubscription"("failures");

ALTER TABLE "PushSubscription"
    ADD CONSTRAINT "PushSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
