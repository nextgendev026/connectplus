-- DailyMetric: rolled-up daily analytics so that high-volume event tables can
-- be pruned without destroying the history the console displays.
--
-- Additive and safe to deploy on its own: it creates one empty table and two
-- indexes. Nothing reads it until the retention pass runs, and nothing is
-- deleted by this migration.
--
-- Rollback:
--   DROP TABLE IF EXISTS "DailyMetric";
--   (No other table is touched, so nothing else needs reverting.)

CREATE TABLE IF NOT EXISTS "DailyMetric" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "dimension" TEXT NOT NULL DEFAULT '',
    "day" DATE NOT NULL,
    "value" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMetric_pkey" PRIMARY KEY ("id")
);

-- The uniqueness constraint is what makes the aggregate idempotent: a re-run of
-- the rollup for the same day updates the row the first run wrote instead of
-- adding a second one that would double every chart that reads it.
CREATE UNIQUE INDEX IF NOT EXISTS "DailyMetric_metric_dimension_day_key"
    ON "DailyMetric" ("metric", "dimension", "day");

CREATE INDEX IF NOT EXISTS "DailyMetric_metric_day_idx" ON "DailyMetric" ("metric", "day");
CREATE INDEX IF NOT EXISTS "DailyMetric_day_idx" ON "DailyMetric" ("day");

-- A value is a count or a sum of counts. A negative daily count is always a bug
-- in the writer, never legitimate data, and catching it at write time is far
-- cheaper than explaining a negative spike on a chart six months later.
ALTER TABLE "DailyMetric"
    ADD CONSTRAINT "DailyMetric_value_non_negative" CHECK ("value" >= 0);
