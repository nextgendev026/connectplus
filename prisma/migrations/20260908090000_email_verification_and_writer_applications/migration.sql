-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailToken" TEXT,
ADD COLUMN     "emailTokenExpires" TIMESTAMP(3),
ADD COLUMN     "emailVerified" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WriterApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "motivation" TEXT NOT NULL,
    "portfolio" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WriterApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WriterApplication_userId_key" ON "WriterApplication"("userId");

-- CreateIndex
CREATE INDEX "WriterApplication_status_idx" ON "WriterApplication"("status");

-- CreateIndex
CREATE INDEX "WriterApplication_createdAt_idx" ON "WriterApplication"("createdAt");

-- AddForeignKey
ALTER TABLE "WriterApplication" ADD CONSTRAINT "WriterApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
