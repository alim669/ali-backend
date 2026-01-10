-- Add VIP fields to User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isVIP" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "vipExpiresAt" TIMESTAMP(3);

-- CreateEnum for PrivateMessageType
DO $$ BEGIN
    CREATE TYPE "PrivateMessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'GIFT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum for PrivateMessageStatus
DO $$ BEGIN
    CREATE TYPE "PrivateMessageStatus" AS ENUM ('SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum for Platform
DO $$ BEGIN
    CREATE TYPE "Platform" AS ENUM ('ANDROID', 'IOS', 'WEB');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable PrivateMessage
CREATE TABLE IF NOT EXISTS "PrivateMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "type" "PrivateMessageType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "status" "PrivateMessageStatus" NOT NULL DEFAULT 'SENT',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable UserBlock
CREATE TABLE IF NOT EXISTS "UserBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable DeviceToken
CREATE TABLE IF NOT EXISTS "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'ANDROID',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for PrivateMessage
CREATE INDEX IF NOT EXISTS "PrivateMessage_senderId_idx" ON "PrivateMessage"("senderId");
CREATE INDEX IF NOT EXISTS "PrivateMessage_receiverId_idx" ON "PrivateMessage"("receiverId");
CREATE INDEX IF NOT EXISTS "PrivateMessage_senderId_receiverId_idx" ON "PrivateMessage"("senderId", "receiverId");
CREATE INDEX IF NOT EXISTS "PrivateMessage_receiverId_status_idx" ON "PrivateMessage"("receiverId", "status");
CREATE INDEX IF NOT EXISTS "PrivateMessage_createdAt_idx" ON "PrivateMessage"("createdAt");

-- CreateIndex for UserBlock
CREATE UNIQUE INDEX IF NOT EXISTS "UserBlock_blockerId_blockedId_key" ON "UserBlock"("blockerId", "blockedId");
CREATE INDEX IF NOT EXISTS "UserBlock_blockerId_idx" ON "UserBlock"("blockerId");
CREATE INDEX IF NOT EXISTS "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

-- CreateIndex for DeviceToken
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceToken_token_key" ON "DeviceToken"("token");
CREATE INDEX IF NOT EXISTS "DeviceToken_userId_idx" ON "DeviceToken"("userId");
CREATE INDEX IF NOT EXISTS "DeviceToken_token_idx" ON "DeviceToken"("token");
CREATE INDEX IF NOT EXISTS "DeviceToken_userId_isActive_idx" ON "DeviceToken"("userId", "isActive");

-- AddForeignKey for PrivateMessage
DO $$ BEGIN
    ALTER TABLE "PrivateMessage" ADD CONSTRAINT "PrivateMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "PrivateMessage" ADD CONSTRAINT "PrivateMessage_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey for UserBlock
DO $$ BEGIN
    ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey for DeviceToken
DO $$ BEGIN
    ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- Additional Performance Indexes (Schema Update 2)
-- ============================================================

-- Index for VIP expiration check on User
CREATE INDEX IF NOT EXISTS "User_isVIP_vipExpiresAt_idx" ON "User"("isVIP", "vipExpiresAt");

-- Index for auto-unban on RoomMember
CREATE INDEX IF NOT EXISTS "RoomMember_isBanned_bannedUntil_idx" ON "RoomMember"("isBanned", "bannedUntil");
CREATE INDEX IF NOT EXISTS "RoomMember_isMuted_mutedUntil_idx" ON "RoomMember"("isMuted", "mutedUntil");

-- Index for soft-deleted messages
CREATE INDEX IF NOT EXISTS "Message_isDeleted_idx" ON "Message"("isDeleted");

-- Index for notification type filtering
CREATE INDEX IF NOT EXISTS "Notification_type_idx" ON "Notification"("type");

-- Index for AgentRequest expiry
CREATE INDEX IF NOT EXISTS "AgentRequest_expiresAt_idx" ON "AgentRequest"("expiresAt");

-- Index for Agent createdAt
CREATE INDEX IF NOT EXISTS "Agent_createdAt_idx" ON "Agent"("createdAt");

-- ============================================================
-- Add Foreign Keys for Agent and AgentRequest (if not exists)
-- ============================================================

-- AgentRequest -> User relationship
DO $$ BEGIN
    ALTER TABLE "AgentRequest" ADD CONSTRAINT "AgentRequest_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Agent -> User relationship
DO $$ BEGIN
    ALTER TABLE "Agent" ADD CONSTRAINT "Agent_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
