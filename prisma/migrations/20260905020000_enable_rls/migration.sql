-- Enable Row Level Security on all tables in the public schema.
-- The application connects to Postgres as the `postgres` role (superuser),
-- which is exempt from RLS, so app behavior is unchanged. Unauthenticated
-- and anon-key access to table data is denied by default (no policies yet).
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;