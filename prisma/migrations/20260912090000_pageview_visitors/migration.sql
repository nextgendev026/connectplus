-- Visitor analytics: a salted visitor hash is what makes "unique visitors"
-- countable without ever persisting a raw identifier.
ALTER TABLE "PageView"
  ADD COLUMN IF NOT EXISTS "visitorHash" TEXT,
  ADD COLUMN IF NOT EXISTS "sessionKey" TEXT,
  ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE INDEX IF NOT EXISTS "PageView_visitorHash_createdAt_idx"
  ON "PageView" ("visitorHash", "createdAt");

CREATE INDEX IF NOT EXISTS "PageView_createdAt_idx"
  ON "PageView" ("createdAt");
