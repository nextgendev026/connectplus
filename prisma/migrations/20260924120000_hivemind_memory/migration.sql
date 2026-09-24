-- Hivemind memory: per-user profile + per-message embeddings for RAG over past turns.
-- Reuses the pgvector extension already enabled by 20260907020000_pgvector_and_experiments.

-- The general-purpose agent's memory of ONE user (rolling summary, language mix).
CREATE TABLE "UserProfile" (
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "languageMix" TEXT,
    "preferences" JSONB,
    "summary" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserProfile"
  ADD CONSTRAINT "UserProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ownership-safe per-user memory recall without joining through the conversation.
ALTER TABLE "NeuralMessage" ADD COLUMN "userId" TEXT;
CREATE INDEX "NeuralMessage_userId_idx" ON "NeuralMessage"("userId");

-- Embedding of the message content: JSON mirror (portable) + pgvector (indexed).
ALTER TABLE "NeuralMessage" ADD COLUMN "embeddingVec" TEXT;
ALTER TABLE "NeuralMessage" ADD COLUMN "embedding" vector(384);
CREATE INDEX "NeuralMessage_embedding_idx" ON "NeuralMessage" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- Composite index matching the task's requested (conversationId, createdAt).
CREATE INDEX "NeuralMessage_conversationId_createdAt_idx" ON "NeuralMessage"("conversationId", "createdAt");
