-- Campaign targeting and frequency caps for in-house creatives.
--
-- Strictly additive and nullable, so it is safe to apply while the previous
-- deployment is still serving: existing rows keep their current behaviour
-- (target nothing, cap nothing) and no reader-facing query changes shape until
-- the new resolver ships.
--
-- Applied by hand rather than generated: `prisma migrate diff` against this
-- database also proposes dropping the raw-SQL pgvector index
-- `PostEmbedding_pgVec_idx` (Prisma cannot see it in the datamodel) and
-- re-stating several `updatedAt` defaults, none of which belong to this change.

ALTER TABLE "Ad" ADD COLUMN "categories" TEXT;
ALTER TABLE "Ad" ADD COLUMN "devices" TEXT;
ALTER TABLE "Ad" ADD COLUMN "frequencyCap" INTEGER;
