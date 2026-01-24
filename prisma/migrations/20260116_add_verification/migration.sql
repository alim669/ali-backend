-- Migration: Add Verification Table
-- هذه migration آمنة - لا تحذف أي بيانات

-- إنشاء جدول التوثيق
CREATE TABLE IF NOT EXISTS "Verification" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL UNIQUE,
    "type" TEXT NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Verification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- إنشاء index للبحث السريع
CREATE INDEX IF NOT EXISTS "Verification_userId_idx" ON "Verification"("userId");
CREATE INDEX IF NOT EXISTS "Verification_type_idx" ON "Verification"("type");
