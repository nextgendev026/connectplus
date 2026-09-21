-- Memory provenance for NeuralMemory.
--
-- Additive and dormant: every column is nullable or carries a default, so this
-- deploys without touching a single existing row and nothing that reads the
-- table today changes behaviour. The defaults are chosen to be the *honest*
-- classification for pre-existing rows rather than a flattering one:
--
--   verificationStatus = 'unverified'  — a memory whose provenance was never
--                                        recorded has not been verified, and
--                                        saying otherwise would launder it.
--   scope              = 'platform'    — the widest audience, matching how these
--                                        rows were already being used.
--   sensitivity        = 'internal'    — neither public nor sensitive; the
--                                        conservative middle, because 'public'
--                                        would widen exposure and 'sensitive'
--                                        would silently hide existing memories.
--   sourceType         = 'internal'    — the ingest paths that existed before
--                                        this field were all internal ones.
--
-- Rollback:
--   DROP INDEX  IF EXISTS "NeuralMemory_verificationStatus_idx";
--   DROP INDEX  IF EXISTS "NeuralMemory_expiresAt_idx";
--   DROP INDEX  IF EXISTS "NeuralMemory_sourceHash_idx";
--   DROP INDEX  IF EXISTS "NeuralMemory_scope_sensitivity_idx";
--   DROP INDEX  IF EXISTS "NeuralMemory_contradictionGroup_idx";
--   ALTER TABLE "NeuralMemory"
--     DROP COLUMN IF EXISTS "sourceType",
--     DROP COLUMN IF EXISTS "sourceHash",
--     DROP COLUMN IF EXISTS "sourceReliability",
--     DROP COLUMN IF EXISTS "observedAt",
--     DROP COLUMN IF EXISTS "expiresAt",
--     DROP COLUMN IF EXISTS "verificationStatus",
--     DROP COLUMN IF EXISTS "evidenceReferences",
--     DROP COLUMN IF EXISTS "scope",
--     DROP COLUMN IF EXISTS "sensitivity",
--     DROP COLUMN IF EXISTS "supersedes",
--     DROP COLUMN IF EXISTS "contradictionGroup",
--     DROP COLUMN IF EXISTS "embeddingModel",
--     DROP COLUMN IF EXISTS "embeddingVersion";
--   No data is lost by the rollback beyond what these columns recorded, because
--   sourceUrl, content, confidence and metadata are untouched.

ALTER TABLE "NeuralMemory"
    ADD COLUMN IF NOT EXISTS "sourceType"         TEXT NOT NULL DEFAULT 'internal',
    ADD COLUMN IF NOT EXISTS "sourceHash"         TEXT,
    ADD COLUMN IF NOT EXISTS "sourceReliability"  DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "observedAt"         TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "expiresAt"          TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
    ADD COLUMN IF NOT EXISTS "evidenceReferences" TEXT,
    ADD COLUMN IF NOT EXISTS "scope"              TEXT NOT NULL DEFAULT 'platform',
    ADD COLUMN IF NOT EXISTS "sensitivity"        TEXT NOT NULL DEFAULT 'internal',
    ADD COLUMN IF NOT EXISTS "supersedes"         TEXT,
    ADD COLUMN IF NOT EXISTS "contradictionGroup" TEXT,
    ADD COLUMN IF NOT EXISTS "embeddingModel"     TEXT,
    ADD COLUMN IF NOT EXISTS "embeddingVersion"   TEXT;

-- Retention and the expiry sweep both scan by expiry, and the sweep must be able
-- to find expired rows without reading the table.
CREATE INDEX IF NOT EXISTS "NeuralMemory_expiresAt_idx" ON "NeuralMemory" ("expiresAt");

-- The contradiction check loads a group by key on every research ingest, so the
-- group key needs an index or that check becomes a scan of the whole hive.
CREATE INDEX IF NOT EXISTS "NeuralMemory_contradictionGroup_idx" ON "NeuralMemory" ("contradictionGroup");

-- Duplicate detection compares content hashes for the same origin.
CREATE INDEX IF NOT EXISTS "NeuralMemory_sourceHash_idx" ON "NeuralMemory" ("sourceHash");

-- Recall filters by verification state; without this it degrades to a full scan
-- on a table that is already the largest thing the minds hold.
CREATE INDEX IF NOT EXISTS "NeuralMemory_verificationStatus_idx" ON "NeuralMemory" ("verificationStatus");

-- Scope and sensitivity are always applied together as a visibility predicate.
CREATE INDEX IF NOT EXISTS "NeuralMemory_scope_sensitivity_idx" ON "NeuralMemory" ("scope", "sensitivity");

-- A state outside the vocabulary is always a writer bug, and the vocabulary is
-- what makes "may this be presented as current truth" answerable at all.
ALTER TABLE "NeuralMemory"
    ADD CONSTRAINT "NeuralMemory_verificationStatus_check"
    CHECK ("verificationStatus" IN ('unverified', 'observed', 'corroborated', 'operator_confirmed', 'rejected', 'expired'));

ALTER TABLE "NeuralMemory"
    ADD CONSTRAINT "NeuralMemory_sensitivity_check"
    CHECK ("sensitivity" IN ('public', 'internal', 'sensitive'));

-- A reliability is a probability. A value outside [0,1] would silently dominate
-- or erase a memory's standing in a weighted ranking.
ALTER TABLE "NeuralMemory"
    ADD CONSTRAINT "NeuralMemory_sourceReliability_check"
    CHECK ("sourceReliability" IS NULL OR ("sourceReliability" >= 0 AND "sourceReliability" <= 1));
