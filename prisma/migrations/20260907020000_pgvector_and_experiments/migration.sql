-- Phase 0: enable pgvector (Supabase ships the extension; safe no-op elsewhere).
CREATE EXTENSION IF NOT EXISTS vector;

-- Mirror of PostEmbedding.vector as a real pgvector column for indexed cosine search.
ALTER TABLE "PostEmbedding" ADD COLUMN "pgVec" vector(384);

-- Approximate nearest-neighbour index (cosine). ivfflat requires the extension above.
CREATE INDEX "PostEmbedding_pgVec_idx" ON "PostEmbedding" USING ivfflat ("pgVec" vector_cosine_ops) WITH (lists = 100);

-- Phase 3: A/B experiment variant attached to each learning-loop event.
ALTER TABLE "ModelFeedback" ADD COLUMN "variant" TEXT;
CREATE INDEX "ModelFeedback_variant_idx" ON "ModelFeedback"("variant");