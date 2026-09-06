-- AlterTable
ALTER TABLE "NeuralMemory" ALTER COLUMN "content" SET DATA TYPE TEXT,
ALTER COLUMN "tags" SET DATA TYPE TEXT;

-- CreateIndex (analytics: path + time range scans in reports/anomalies)
CREATE INDEX "PageView_path_createdAt_idx" ON "PageView"("path", "createdAt");

-- CreateIndex (GIN full-text index so knowledge/Brain recall uses to_tsvector
-- on the bold text column instead of a sequential scan over content)
CREATE INDEX "NeuralMemory_content_fts_idx" ON "NeuralMemory" USING GIN (to_tsvector('simple', "content"));