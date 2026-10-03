-- Reconciliation: 20260911180000_subscriptions_and_thirdparty_ads is recorded as
-- applied in _prisma_migrations, but on the live database these statements never
-- landed (partial application). Orphan checks came back clean, so the constraints
-- are safe to add. Everything here is idempotent so re-runs are no-ops.

-- Indexes -------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "UserSubscription_status_idx" ON "UserSubscription"("status");
CREATE INDEX IF NOT EXISTS "ThirdPartyAdSlot_slot_isActive_idx" ON "ThirdPartyAdSlot"("slot", "isActive");

-- Foreign keys --------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'UserSubscription_userId_fkey'
      AND conrelid = '"UserSubscription"'::regclass
  ) THEN
    ALTER TABLE "UserSubscription"
      ADD CONSTRAINT "UserSubscription_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'UserSubscription_planId_fkey'
      AND conrelid = '"UserSubscription"'::regclass
  ) THEN
    ALTER TABLE "UserSubscription"
      ADD CONSTRAINT "UserSubscription_planId_fkey"
      FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'SeoMetadata_postId_fkey'
      AND conrelid = '"SeoMetadata"'::regclass
  ) THEN
    ALTER TABLE "SeoMetadata"
      ADD CONSTRAINT "SeoMetadata_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "Post"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
