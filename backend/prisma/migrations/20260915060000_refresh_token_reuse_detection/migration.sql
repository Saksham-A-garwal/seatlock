-- Existing rows have no familyId to backfill from (nothing tracked chains
-- before this migration) and are almost all already-expired dev sessions;
-- clearing the table just forces a fresh login, same call made for the
-- Payment table during the Razorpay migration.
TRUNCATE TABLE "RefreshToken";

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "familyId" TEXT NOT NULL,
ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
