-- Feed health + conditional-GET validators.
--
-- The poll pipeline used to fail silently: a feed that 404'd or timed out just
-- kept its old `lastPolled`, so the admin console showed nothing wrong while
-- no articles arrived. These columns record the outcome of every attempt, and
-- the HTTP validators let us send If-None-Match / If-Modified-Since so an
-- unchanged feed costs one tiny 304 instead of re-downloading the whole XML.

ALTER TABLE "RssFeed" ADD COLUMN IF NOT EXISTS "lastStatus" TEXT;
ALTER TABLE "RssFeed" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "RssFeed" ADD COLUMN IF NOT EXISTS "lastItemCount" INTEGER;
ALTER TABLE "RssFeed" ADD COLUMN IF NOT EXISTS "lastNewArticles" INTEGER;
ALTER TABLE "RssFeed" ADD COLUMN IF NOT EXISTS "lastDurationMs" INTEGER;
ALTER TABLE "RssFeed" ADD COLUMN IF NOT EXISTS "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RssFeed" ADD COLUMN IF NOT EXISTS "httpEtag" TEXT;
ALTER TABLE "RssFeed" ADD COLUMN IF NOT EXISTS "httpLastModified" TEXT;
