-- CreateTable
CREATE TABLE "PostEmbedding" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "vector" TEXT NOT NULL,
    "dim" INTEGER NOT NULL DEFAULT 384,
    "model" TEXT NOT NULL DEFAULT 'hash-minilm',
    "titleVec" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vector" TEXT NOT NULL,
    "tagVector" TEXT NOT NULL,
    "categoryCount" TEXT NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "postId" TEXT,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostEmbedding_postId_key" ON "PostEmbedding"("postId");

-- CreateIndex
CREATE INDEX "PostEmbedding_postId_idx" ON "PostEmbedding"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "UserPreference_userId_idx" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "ModelFeedback_userId_idx" ON "ModelFeedback"("userId");

-- CreateIndex
CREATE INDEX "ModelFeedback_postId_idx" ON "ModelFeedback"("postId");

-- CreateIndex
CREATE INDEX "ModelFeedback_type_idx" ON "ModelFeedback"("type");

-- CreateIndex
CREATE INDEX "ModelFeedback_createdAt_idx" ON "ModelFeedback"("createdAt");

-- AddForeignKey
ALTER TABLE "PostEmbedding" ADD CONSTRAINT "PostEmbedding_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelFeedback" ADD CONSTRAINT "ModelFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelFeedback" ADD CONSTRAINT "ModelFeedback_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
