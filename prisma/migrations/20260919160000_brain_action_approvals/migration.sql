-- CreateTable
-- The brain's write requests, parked until a named admin approves them.
CREATE TABLE "BrainActionProposal" (
    "id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "risk" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'chat',
    "requestedBy" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decidedNote" TEXT,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrainActionProposal_status_createdAt_idx" ON "BrainActionProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BrainActionProposal_tool_idx" ON "BrainActionProposal"("tool");
