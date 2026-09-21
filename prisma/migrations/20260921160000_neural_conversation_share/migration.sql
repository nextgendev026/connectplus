-- Shareable read-only transcripts, and a recency index for the chat history list.
--
-- Additive in the sense that matters: two nullable columns and two indexes. No
-- column is read until an operator explicitly shares a thread, so every existing
-- conversation keeps working and stays private. Adding this migration cannot make
-- anything newly readable.
--
-- The share token is a separate secret rather than a derivation of the
-- conversation id. The id is not a secret — it appears in console URLs and in
-- audit rows that reference a thread — so it must not also be the thing that
-- grants access to the transcript. Revoking a share sets the token back to null,
-- which kills the link rather than merely hiding it.
--
-- The index swap below replaces `NeuralConversation_userId_idx` with a composite
-- on (userId, updatedAt). The bare index could filter to one admin's threads but
-- not order them by recency, so listing them sorted in memory. The composite has
-- userId as its leading column, so it serves every query the old index did.
--
-- Rollback:
--   CREATE INDEX IF NOT EXISTS "NeuralConversation_userId_idx"
--     ON "NeuralConversation"("userId");
--   DROP INDEX IF EXISTS "NeuralConversation_userId_updatedAt_idx";
--   DROP INDEX IF EXISTS "NeuralConversation_shareToken_key";
--   ALTER TABLE "NeuralConversation" DROP COLUMN IF EXISTS "sharedAt";
--   ALTER TABLE "NeuralConversation" DROP COLUMN IF EXISTS "shareToken";
--
--   No conversation or message row is touched by either direction. The only loss
--   on rollback is that live share links stop resolving, which is the correct
--   direction for a capability to fail in.

ALTER TABLE "NeuralConversation" ADD COLUMN IF NOT EXISTS "shareToken" TEXT;
ALTER TABLE "NeuralConversation" ADD COLUMN IF NOT EXISTS "sharedAt" TIMESTAMP(3);

-- Unique so a token identifies exactly one thread, and so a collision is rejected
-- by the database rather than silently serving the wrong transcript. PostgreSQL
-- permits many NULLs in a unique index, which is what lets every unshared
-- conversation coexist as "private".
CREATE UNIQUE INDEX IF NOT EXISTS "NeuralConversation_shareToken_key"
  ON "NeuralConversation"("shareToken");

-- Built before the redundant index is dropped, so there is no window in which a
-- userId lookup has nothing to use.
CREATE INDEX IF NOT EXISTS "NeuralConversation_userId_updatedAt_idx"
  ON "NeuralConversation"("userId", "updatedAt");

DROP INDEX IF EXISTS "NeuralConversation_userId_idx";
