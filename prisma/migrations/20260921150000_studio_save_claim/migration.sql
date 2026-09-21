-- Idempotency ledger for draft creation.
--
-- Additive: creates one empty table and two indexes. Nothing reads it until the
-- posts route passes an idempotency key, and a request without a key behaves
-- exactly as before — so this migration can be deployed ahead of the client.
--
-- Rollback:
--   DROP TABLE IF EXISTS "StudioSaveClaim";
--   No other table is touched and no data is lost: the table only ever holds
--   short-lived claims, and the drafts it prevented from duplicating live in
--   "Post" untouched.

CREATE TABLE IF NOT EXISTS "StudioSaveClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioSaveClaim_pkey" PRIMARY KEY ("id")
);

-- The primary key is the idempotency key, which is what makes the claim
-- atomic: two concurrent requests carrying the same key cannot both insert, so
-- the loser reads the winner's row instead of creating a second draft. There is
-- deliberately no unique constraint on (userId, postId) — a claim is about one
-- save *attempt*, and the same document is legitimately claimed by many later
-- revisions.
CREATE INDEX IF NOT EXISTS "StudioSaveClaim_userId_idx" ON "StudioSaveClaim" ("userId");
CREATE INDEX IF NOT EXISTS "StudioSaveClaim_expiresAt_idx" ON "StudioSaveClaim" ("expiresAt");

-- A claim is short-lived bookkeeping, not a record. A window longer than the
-- time a writer could plausibly retry a save would keep stale claims alive and
-- start returning old drafts for new work; the sweep below is the backstop for
-- the expiry the application also enforces in code.
COMMENT ON COLUMN "StudioSaveClaim"."expiresAt" IS
  'Claim window. Past this the row is treated as absent and swept by the retention pass.';
