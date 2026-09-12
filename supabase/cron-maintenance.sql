-- Supabase pg_cron maintenance jobs.
--
-- These run INSIDE Postgres on the Supabase free tier, so the work never
-- touches a Vercel function or burns Fast Origin Transfer. Install with:
--
--   npm run supabase:cron:install
--
-- Verify with:
--   SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
--
-- Idempotent: each job is unscheduled (ignoring errors) then re-created, so
-- re-running this file updates definitions instead of failing on duplicates.

-- 1. Stripe webhook idempotency ledger retention (90 days is plenty; the
--    dedupe window only needs to cover Stripe retries).
SELECT cron.unschedule('connectplus-prune-stripe-events') FROM cron.job WHERE jobname = 'connectplus-prune-stripe-events';
SELECT cron.schedule(
  'connectplus-prune-stripe-events',
  '40 2 * * *', -- 02:40 UTC daily
  $$DELETE FROM "StripeEvent" WHERE "handledAt" < now() - interval '90 days'$$
);

-- 2. Auto-disable feeds that keep failing. The standard poller leaves
--    consecutiveFailures in place so the admin console can show health; this
--    job turns a chronically broken source off after ~25 consecutive failures
--    (~2 days at the 2-hour poll cadence) so it stops burning egress.
SELECT cron.unschedule('connectplus-disable-dead-feeds') FROM cron.job WHERE jobname = 'connectplus-disable-dead-feeds';
SELECT cron.schedule(
  'connectplus-disable-dead-feeds',
  '5 * * * *', -- every hour at :05
  $$UPDATE "RssFeed"
    SET "isActive" = false,
        "lastError" = COALESCE(NULLIF("lastError", ''), '') || ' [auto-disabled: persistent failures]'
    WHERE "isActive" = true AND "consecutiveFailures" >= 25$$
);