-- ============================================================
-- 02_PERFORMANCE_INDEXES.sql - Safe Performance Indexes
-- ============================================================
-- PURPOSE: Create performance indexes for real-time queries
--          Messages, Gifts, Wallet, RoomMembers, Follows
-- RISK/LOCK: LOW - Uses CONCURRENTLY (no table lock)
-- VERIFY: Run 01_discovery.sql again to see new indexes
-- IDEMPOTENT: Yes - Checks if index exists before creating
-- ============================================================
-- ⚠️ IMPORTANT: Do NOT run this inside a transaction block!
--    CREATE INDEX CONCURRENTLY cannot run inside BEGIN/COMMIT.
-- ============================================================

-- ============================================================
-- HELPER: Check if index exists (reusable)
-- ============================================================

CREATE OR REPLACE FUNCTION pg_temp.index_exists(p_index_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' AND indexname = p_index_name
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.column_exists(p_table TEXT, p_column TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = p_table 
          AND column_name = p_column
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SECTION 1: MESSAGE INDEXES
-- ============================================================

-- Index: Messages by room + created_at DESC (for chat history)
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_message_room_created_desc') THEN
        IF pg_temp.column_exists('Message', 'roomId') AND pg_temp.column_exists('Message', 'createdAt') THEN
            RAISE NOTICE 'Creating idx_message_room_created_desc...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_message_room_created_desc ON "Message" ("roomId", "createdAt" DESC)';
        ELSIF pg_temp.column_exists('Message', 'room_id') AND pg_temp.column_exists('Message', 'created_at') THEN
            RAISE NOTICE 'Creating idx_message_room_created_desc (snake_case)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_message_room_created_desc ON "Message" (room_id, created_at DESC)';
        ELSE
            RAISE NOTICE 'SKIP: Message table missing roomId/createdAt columns';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_message_room_created_desc already exists';
    END IF;
END $$;

-- Index: Messages by sender + created_at DESC (for user message history)
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_message_sender_created_desc') THEN
        IF pg_temp.column_exists('Message', 'senderId') AND pg_temp.column_exists('Message', 'createdAt') THEN
            RAISE NOTICE 'Creating idx_message_sender_created_desc...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_message_sender_created_desc ON "Message" ("senderId", "createdAt" DESC)';
        ELSIF pg_temp.column_exists('Message', 'sender_id') AND pg_temp.column_exists('Message', 'created_at') THEN
            RAISE NOTICE 'Creating idx_message_sender_created_desc (snake_case)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_message_sender_created_desc ON "Message" (sender_id, created_at DESC)';
        ELSE
            RAISE NOTICE 'SKIP: Message table missing senderId/createdAt columns';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_message_sender_created_desc already exists';
    END IF;
END $$;

-- Partial Index: Active (non-deleted) messages only
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_message_room_active') THEN
        IF pg_temp.column_exists('Message', 'roomId') AND pg_temp.column_exists('Message', 'isDeleted') THEN
            RAISE NOTICE 'Creating idx_message_room_active (partial)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_message_room_active ON "Message" ("roomId", "createdAt" DESC) WHERE "isDeleted" = false';
        ELSIF pg_temp.column_exists('Message', 'room_id') AND pg_temp.column_exists('Message', 'is_deleted') THEN
            RAISE NOTICE 'Creating idx_message_room_active (snake_case, partial)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_message_room_active ON "Message" (room_id, created_at DESC) WHERE is_deleted = false';
        ELSE
            RAISE NOTICE 'SKIP: Message table missing isDeleted column for partial index';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_message_room_active already exists';
    END IF;
END $$;

-- ============================================================
-- SECTION 2: GIFT SEND INDEXES
-- ============================================================

-- Index: Gifts by room + created_at DESC
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_giftsend_room_created_desc') THEN
        IF pg_temp.column_exists('GiftSend', 'roomId') AND pg_temp.column_exists('GiftSend', 'createdAt') THEN
            RAISE NOTICE 'Creating idx_giftsend_room_created_desc...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_giftsend_room_created_desc ON "GiftSend" ("roomId", "createdAt" DESC)';
        ELSIF pg_temp.column_exists('GiftSend', 'room_id') AND pg_temp.column_exists('GiftSend', 'created_at') THEN
            RAISE NOTICE 'Creating idx_giftsend_room_created_desc (snake_case)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_giftsend_room_created_desc ON "GiftSend" (room_id, created_at DESC)';
        ELSE
            RAISE NOTICE 'SKIP: GiftSend table missing roomId/createdAt columns';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_giftsend_room_created_desc already exists';
    END IF;
END $$;

-- Index: Gifts by receiver + created_at DESC (for user's received gifts)
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_giftsend_receiver_created_desc') THEN
        IF pg_temp.column_exists('GiftSend', 'receiverId') AND pg_temp.column_exists('GiftSend', 'createdAt') THEN
            RAISE NOTICE 'Creating idx_giftsend_receiver_created_desc...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_giftsend_receiver_created_desc ON "GiftSend" ("receiverId", "createdAt" DESC)';
        ELSIF pg_temp.column_exists('GiftSend', 'receiver_id') AND pg_temp.column_exists('GiftSend', 'created_at') THEN
            RAISE NOTICE 'Creating idx_giftsend_receiver_created_desc (snake_case)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_giftsend_receiver_created_desc ON "GiftSend" (receiver_id, created_at DESC)';
        ELSE
            RAISE NOTICE 'SKIP: GiftSend table missing receiverId/createdAt columns';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_giftsend_receiver_created_desc already exists';
    END IF;
END $$;

-- Index: Gifts by sender + created_at DESC (for user's sent gifts)
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_giftsend_sender_created_desc') THEN
        IF pg_temp.column_exists('GiftSend', 'senderId') AND pg_temp.column_exists('GiftSend', 'createdAt') THEN
            RAISE NOTICE 'Creating idx_giftsend_sender_created_desc...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_giftsend_sender_created_desc ON "GiftSend" ("senderId", "createdAt" DESC)';
        ELSIF pg_temp.column_exists('GiftSend', 'sender_id') AND pg_temp.column_exists('GiftSend', 'created_at') THEN
            RAISE NOTICE 'Creating idx_giftsend_sender_created_desc (snake_case)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_giftsend_sender_created_desc ON "GiftSend" (sender_id, created_at DESC)';
        ELSE
            RAISE NOTICE 'SKIP: GiftSend table missing senderId/createdAt columns';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_giftsend_sender_created_desc already exists';
    END IF;
END $$;

-- ============================================================
-- SECTION 3: WALLET TRANSACTION INDEXES
-- ============================================================

-- Index: Transactions by wallet + created_at DESC
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_wallet_tx_wallet_created_desc') THEN
        IF pg_temp.column_exists('WalletTransaction', 'walletId') AND pg_temp.column_exists('WalletTransaction', 'createdAt') THEN
            RAISE NOTICE 'Creating idx_wallet_tx_wallet_created_desc...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_wallet_tx_wallet_created_desc ON "WalletTransaction" ("walletId", "createdAt" DESC)';
        ELSIF pg_temp.column_exists('WalletTransaction', 'wallet_id') AND pg_temp.column_exists('WalletTransaction', 'created_at') THEN
            RAISE NOTICE 'Creating idx_wallet_tx_wallet_created_desc (snake_case)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_wallet_tx_wallet_created_desc ON "WalletTransaction" (wallet_id, created_at DESC)';
        ELSE
            RAISE NOTICE 'SKIP: WalletTransaction table missing walletId/createdAt columns';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_wallet_tx_wallet_created_desc already exists';
    END IF;
END $$;

-- Index: Transactions by wallet + type + created_at DESC (for filtering)
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_wallet_tx_wallet_type_created') THEN
        IF pg_temp.column_exists('WalletTransaction', 'walletId') AND pg_temp.column_exists('WalletTransaction', 'type') THEN
            RAISE NOTICE 'Creating idx_wallet_tx_wallet_type_created...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_wallet_tx_wallet_type_created ON "WalletTransaction" ("walletId", "type", "createdAt" DESC)';
        ELSIF pg_temp.column_exists('WalletTransaction', 'wallet_id') AND pg_temp.column_exists('WalletTransaction', 'type') THEN
            RAISE NOTICE 'Creating idx_wallet_tx_wallet_type_created (snake_case)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_wallet_tx_wallet_type_created ON "WalletTransaction" (wallet_id, type, created_at DESC)';
        ELSE
            RAISE NOTICE 'SKIP: WalletTransaction table missing required columns';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_wallet_tx_wallet_type_created already exists';
    END IF;
END $$;

-- ============================================================
-- SECTION 4: ROOM MEMBER INDEXES
-- ============================================================

-- Partial Index: Active room members (not banned, not left)
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_roommember_room_active') THEN
        IF pg_temp.column_exists('RoomMember', 'roomId') AND pg_temp.column_exists('RoomMember', 'isBanned') AND pg_temp.column_exists('RoomMember', 'leftAt') THEN
            RAISE NOTICE 'Creating idx_roommember_room_active (partial)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_roommember_room_active ON "RoomMember" ("roomId", "role") WHERE "isBanned" = false AND "leftAt" IS NULL';
        ELSIF pg_temp.column_exists('RoomMember', 'room_id') AND pg_temp.column_exists('RoomMember', 'is_banned') AND pg_temp.column_exists('RoomMember', 'left_at') THEN
            RAISE NOTICE 'Creating idx_roommember_room_active (snake_case, partial)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_roommember_room_active ON "RoomMember" (room_id, role) WHERE is_banned = false AND left_at IS NULL';
        ELSE
            RAISE NOTICE 'SKIP: RoomMember table missing required columns for partial index';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_roommember_room_active already exists';
    END IF;
END $$;

-- ============================================================
-- SECTION 5: FOLLOW INDEXES
-- ============================================================

-- Index: Followers of a user + created_at DESC
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_follow_following_created') THEN
        IF pg_temp.column_exists('Follow', 'followingId') AND pg_temp.column_exists('Follow', 'createdAt') THEN
            RAISE NOTICE 'Creating idx_follow_following_created...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_follow_following_created ON "Follow" ("followingId", "createdAt" DESC)';
        ELSIF pg_temp.column_exists('Follow', 'following_id') AND pg_temp.column_exists('Follow', 'created_at') THEN
            RAISE NOTICE 'Creating idx_follow_following_created (snake_case)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_follow_following_created ON "Follow" (following_id, created_at DESC)';
        ELSE
            RAISE NOTICE 'SKIP: Follow table missing followingId/createdAt columns';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_follow_following_created already exists';
    END IF;
END $$;

-- Index: Users followed by a user + created_at DESC
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_follow_follower_created') THEN
        IF pg_temp.column_exists('Follow', 'followerId') AND pg_temp.column_exists('Follow', 'createdAt') THEN
            RAISE NOTICE 'Creating idx_follow_follower_created...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_follow_follower_created ON "Follow" ("followerId", "createdAt" DESC)';
        ELSIF pg_temp.column_exists('Follow', 'follower_id') AND pg_temp.column_exists('Follow', 'created_at') THEN
            RAISE NOTICE 'Creating idx_follow_follower_created (snake_case)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_follow_follower_created ON "Follow" (follower_id, created_at DESC)';
        ELSE
            RAISE NOTICE 'SKIP: Follow table missing followerId/createdAt columns';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_follow_follower_created already exists';
    END IF;
END $$;

-- ============================================================
-- SECTION 6: NOTIFICATION INDEXES
-- ============================================================

-- Partial Index: Unread notifications by user
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_notification_user_unread') THEN
        IF pg_temp.column_exists('Notification', 'userId') AND pg_temp.column_exists('Notification', 'isRead') THEN
            RAISE NOTICE 'Creating idx_notification_user_unread (partial)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_notification_user_unread ON "Notification" ("userId", "createdAt" DESC) WHERE "isRead" = false';
        ELSIF pg_temp.column_exists('Notification', 'user_id') AND pg_temp.column_exists('Notification', 'is_read') THEN
            RAISE NOTICE 'Creating idx_notification_user_unread (snake_case, partial)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_notification_user_unread ON "Notification" (user_id, created_at DESC) WHERE is_read = false';
        ELSE
            RAISE NOTICE 'SKIP: Notification table missing userId/isRead columns';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_notification_user_unread already exists';
    END IF;
END $$;

-- ============================================================
-- SECTION 7: ROOM INDEXES
-- ============================================================

-- Partial Index: Active public rooms ordered by member count
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_room_public_active') THEN
        IF pg_temp.column_exists('Room', 'type') AND pg_temp.column_exists('Room', 'status') AND pg_temp.column_exists('Room', 'currentMembers') THEN
            RAISE NOTICE 'Creating idx_room_public_active (partial)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_room_public_active ON "Room" ("type", "currentMembers" DESC) WHERE "status" = ''ACTIVE''';
        ELSIF pg_temp.column_exists('Room', 'type') AND pg_temp.column_exists('Room', 'status') AND pg_temp.column_exists('Room', 'current_members') THEN
            RAISE NOTICE 'Creating idx_room_public_active (snake_case, partial)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_room_public_active ON "Room" (type, current_members DESC) WHERE status = ''ACTIVE''';
        ELSE
            RAISE NOTICE 'SKIP: Room table missing required columns';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_room_public_active already exists';
    END IF;
END $$;

-- ============================================================
-- SECTION 8: REPORT INDEXES
-- ============================================================

-- Partial Index: Pending reports for moderation queue
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_report_pending') THEN
        IF pg_temp.column_exists('Report', 'status') AND pg_temp.column_exists('Report', 'createdAt') THEN
            RAISE NOTICE 'Creating idx_report_pending (partial)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_report_pending ON "Report" ("createdAt" ASC) WHERE "status" = ''PENDING''';
        ELSIF pg_temp.column_exists('Report', 'status') AND pg_temp.column_exists('Report', 'created_at') THEN
            RAISE NOTICE 'Creating idx_report_pending (snake_case, partial)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_report_pending ON "Report" (created_at ASC) WHERE status = ''PENDING''';
        ELSE
            RAISE NOTICE 'SKIP: Report table missing required columns';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_report_pending already exists';
    END IF;
END $$;

-- ============================================================
-- SECTION 9: REFRESH TOKEN INDEXES
-- ============================================================

-- Partial Index: Active (not revoked) tokens by expiry
DO $$
BEGIN
    IF NOT pg_temp.index_exists('idx_refreshtoken_expires_active') THEN
        IF pg_temp.column_exists('RefreshToken', 'expiresAt') AND pg_temp.column_exists('RefreshToken', 'revokedAt') THEN
            RAISE NOTICE 'Creating idx_refreshtoken_expires_active (partial)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_refreshtoken_expires_active ON "RefreshToken" ("expiresAt") WHERE "revokedAt" IS NULL';
        ELSIF pg_temp.column_exists('RefreshToken', 'expires_at') AND pg_temp.column_exists('RefreshToken', 'revoked_at') THEN
            RAISE NOTICE 'Creating idx_refreshtoken_expires_active (snake_case, partial)...';
            EXECUTE 'CREATE INDEX CONCURRENTLY idx_refreshtoken_expires_active ON "RefreshToken" (expires_at) WHERE revoked_at IS NULL';
        ELSE
            RAISE NOTICE 'SKIP: RefreshToken table missing required columns';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: idx_refreshtoken_expires_active already exists';
    END IF;
END $$;

-- ============================================================
-- VERIFICATION
-- ============================================================

SELECT '=== NEW INDEXES CREATED ===' AS section;

SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- ============================================================
-- ROLLBACK COMMANDS (if needed)
-- ============================================================
/*
DROP INDEX CONCURRENTLY IF EXISTS idx_message_room_created_desc;
DROP INDEX CONCURRENTLY IF EXISTS idx_message_sender_created_desc;
DROP INDEX CONCURRENTLY IF EXISTS idx_message_room_active;
DROP INDEX CONCURRENTLY IF EXISTS idx_giftsend_room_created_desc;
DROP INDEX CONCURRENTLY IF EXISTS idx_giftsend_receiver_created_desc;
DROP INDEX CONCURRENTLY IF EXISTS idx_giftsend_sender_created_desc;
DROP INDEX CONCURRENTLY IF EXISTS idx_wallet_tx_wallet_created_desc;
DROP INDEX CONCURRENTLY IF EXISTS idx_wallet_tx_wallet_type_created;
DROP INDEX CONCURRENTLY IF EXISTS idx_roommember_room_active;
DROP INDEX CONCURRENTLY IF EXISTS idx_follow_following_created;
DROP INDEX CONCURRENTLY IF EXISTS idx_follow_follower_created;
DROP INDEX CONCURRENTLY IF EXISTS idx_notification_user_unread;
DROP INDEX CONCURRENTLY IF EXISTS idx_room_public_active;
DROP INDEX CONCURRENTLY IF EXISTS idx_report_pending;
DROP INDEX CONCURRENTLY IF EXISTS idx_refreshtoken_expires_active;
*/
