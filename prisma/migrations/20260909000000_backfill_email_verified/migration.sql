-- Backfill: all accounts are recognised as verified. Sign-up emails on this
-- deployment are not live inboxes, so a verification wall would permanently
-- lock users (including the seeded SUPER_ADMIN) out of publishing.
UPDATE "User"
SET "emailVerified" = NOW()
WHERE "emailVerified" IS NULL;