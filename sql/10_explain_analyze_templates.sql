-- ============================================================
-- 10_EXPLAIN_ANALYZE_TEMPLATES.sql - Query Performance Analysis
-- ============================================================
-- PURPOSE: Templates for analyzing query performance
-- RISK/LOCK: LOW - EXPLAIN doesn't modify data, ANALYZE executes query
-- VERIFY: Compare actual vs estimated rows, look for Seq Scans
-- IDEMPOTENT: Yes - Safe to run unlimited times
-- ============================================================
-- HOW TO USE:
--   1. Replace placeholders (e.g., ':room_id') with actual values
--   2. Run EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
--   3. Check for Seq Scan on large tables, high row estimates
--   4. If performance is bad, check indexes in 02_performance_indexes.sql
-- ============================================================

-- ============================================================
-- INTERPRETING EXPLAIN OUTPUT
-- ============================================================
/*
GOOD SIGNS:
  ✅ Index Scan / Index Only Scan
  ✅ Bitmap Index Scan + Bitmap Heap Scan
  ✅ Actual rows ≈ Estimated rows
  ✅ Low "Buffers: shared read" (data in cache)

WARNING SIGNS:
  ⚠️ Seq Scan on tables > 10K rows
  ⚠️ Actual rows >> Estimated rows (run ANALYZE)
  ⚠️ Sort with high memory/disk usage
  ⚠️ Nested Loop on large result sets

BAD SIGNS:
  ❌ Seq Scan with Filter removing most rows
  ❌ External Sort (spilling to disk)
  ❌ Hash Join with high memory
  ❌ Parallel workers not being used when expected
*/

-- ============================================================
-- TEMPLATE 1: GET LATEST MESSAGES BY ROOM
-- ============================================================
-- Use case: Load chat room messages (most recent 50)
-- Expected: Index Scan on idx_message_room_created_desc

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    m.id,
    m."roomId",
    m."senderId",
    m.type,
    m.content,
    m."createdAt",
    u."displayName" AS sender_name,
    u.avatar AS sender_avatar
FROM "Message" m
JOIN "User" u ON m."senderId" = u.id
WHERE m."roomId" = '00000000-0000-0000-0000-000000000000'  -- Replace with actual room ID
  AND m."isDeleted" = false
ORDER BY m."createdAt" DESC
LIMIT 50;

-- ============================================================
-- TEMPLATE 2: PAGINATE MESSAGES (Cursor-based)
-- ============================================================
-- Use case: Load more messages (scroll up)
-- Expected: Index Scan with good selectivity

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    m.id,
    m."roomId",
    m."senderId",
    m.content,
    m."createdAt"
FROM "Message" m
WHERE m."roomId" = '00000000-0000-0000-0000-000000000000'  -- Replace
  AND m."isDeleted" = false
  AND m."createdAt" < '2025-01-01 00:00:00'::timestamp  -- Cursor: last message timestamp
ORDER BY m."createdAt" DESC
LIMIT 50;

-- ============================================================
-- TEMPLATE 3: PAGINATE MESSAGES (Offset-based - NOT recommended)
-- ============================================================
-- Use case: Traditional pagination (slower for deep pages)
-- Expected: May show Seq Scan for large offsets

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    m.id,
    m."roomId",
    m."senderId",
    m.content,
    m."createdAt"
FROM "Message" m
WHERE m."roomId" = '00000000-0000-0000-0000-000000000000'  -- Replace
  AND m."isDeleted" = false
ORDER BY m."createdAt" DESC
LIMIT 50
OFFSET 0;  -- Try with 0, 100, 1000 to see performance degradation

-- ============================================================
-- TEMPLATE 4: GIFT FEED BY ROOM
-- ============================================================
-- Use case: Show gifts sent in a room
-- Expected: Index Scan on idx_giftsend_room_created_desc

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    gs.id,
    gs."senderId",
    gs."receiverId",
    gs."giftId",
    gs.quantity,
    gs."totalPrice",
    gs."createdAt",
    g.name AS gift_name,
    g."imageUrl" AS gift_image,
    sender."displayName" AS sender_name,
    receiver."displayName" AS receiver_name
FROM "GiftSend" gs
JOIN "Gift" g ON gs."giftId" = g.id
JOIN "User" sender ON gs."senderId" = sender.id
JOIN "User" receiver ON gs."receiverId" = receiver.id
WHERE gs."roomId" = '00000000-0000-0000-0000-000000000000'  -- Replace
ORDER BY gs."createdAt" DESC
LIMIT 20;

-- ============================================================
-- TEMPLATE 5: GIFT FEED BY USER (Received)
-- ============================================================
-- Use case: User's received gifts on profile
-- Expected: Index Scan on idx_giftsend_receiver_created_desc

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    gs.id,
    gs."senderId",
    gs."giftId",
    gs.quantity,
    gs."totalPrice",
    gs."createdAt",
    g.name AS gift_name,
    g."imageUrl",
    sender."displayName" AS sender_name,
    sender.avatar AS sender_avatar
FROM "GiftSend" gs
JOIN "Gift" g ON gs."giftId" = g.id
JOIN "User" sender ON gs."senderId" = sender.id
WHERE gs."receiverId" = '00000000-0000-0000-0000-000000000000'  -- Replace with user ID
ORDER BY gs."createdAt" DESC
LIMIT 20;

-- ============================================================
-- TEMPLATE 6: WALLET TRANSACTION HISTORY
-- ============================================================
-- Use case: User's wallet transaction list
-- Expected: Index Scan on idx_wallet_tx_wallet_created_desc

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    wt.id,
    wt.type,
    wt.status,
    wt.amount,
    wt."balanceBefore",
    wt."balanceAfter",
    wt.description,
    wt."createdAt"
FROM "WalletTransaction" wt
JOIN "Wallet" w ON wt."walletId" = w.id
WHERE w."userId" = '00000000-0000-0000-0000-000000000000'  -- Replace with user ID
ORDER BY wt."createdAt" DESC
LIMIT 50;

-- ============================================================
-- TEMPLATE 7: WALLET TRANSACTIONS BY TYPE
-- ============================================================
-- Use case: Filter by transaction type (DEPOSIT, GIFT_RECEIVED, etc.)
-- Expected: Index Scan on idx_wallet_tx_wallet_type_created

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    wt.id,
    wt.type,
    wt.amount,
    wt."balanceAfter",
    wt."createdAt"
FROM "WalletTransaction" wt
JOIN "Wallet" w ON wt."walletId" = w.id
WHERE w."userId" = '00000000-0000-0000-0000-000000000000'  -- Replace
  AND wt.type = 'GIFT_RECEIVED'  -- Replace with enum value
ORDER BY wt."createdAt" DESC
LIMIT 50;

-- ============================================================
-- TEMPLATE 8: FOLLOWER LIST
-- ============================================================
-- Use case: Show who follows a user
-- Expected: Index Scan on idx_follow_following_created

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    f.id,
    f."followerId",
    f."createdAt",
    u.id AS user_id,
    u."displayName",
    u.avatar,
    u.status
FROM "Follow" f
JOIN "User" u ON f."followerId" = u.id
WHERE f."followingId" = '00000000-0000-0000-0000-000000000000'  -- Replace with user ID
ORDER BY f."createdAt" DESC
LIMIT 50;

-- ============================================================
-- TEMPLATE 9: FOLLOWING LIST
-- ============================================================
-- Use case: Show who a user follows
-- Expected: Index Scan on idx_follow_follower_created

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    f.id,
    f."followingId",
    f."createdAt",
    u.id AS user_id,
    u."displayName",
    u.avatar,
    u.status
FROM "Follow" f
JOIN "User" u ON f."followingId" = u.id
WHERE f."followerId" = '00000000-0000-0000-0000-000000000000'  -- Replace with user ID
ORDER BY f."createdAt" DESC
LIMIT 50;

-- ============================================================
-- TEMPLATE 10: ROOM MEMBERS (Active)
-- ============================================================
-- Use case: List current room members
-- Expected: Index Scan on idx_roommember_room_active

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    rm.id,
    rm."userId",
    rm.role,
    rm."joinedAt",
    u."displayName",
    u.avatar,
    u.status
FROM "RoomMember" rm
JOIN "User" u ON rm."userId" = u.id
WHERE rm."roomId" = '00000000-0000-0000-0000-000000000000'  -- Replace
  AND rm."isBanned" = false
  AND rm."leftAt" IS NULL
ORDER BY rm.role DESC, rm."joinedAt" ASC
LIMIT 100;

-- ============================================================
-- TEMPLATE 11: UNREAD NOTIFICATIONS
-- ============================================================
-- Use case: Notification bell count/list
-- Expected: Index Scan on idx_notification_user_unread

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    id,
    type,
    title,
    body,
    data,
    "createdAt"
FROM "Notification"
WHERE "userId" = '00000000-0000-0000-0000-000000000000'  -- Replace
  AND "isRead" = false
ORDER BY "createdAt" DESC
LIMIT 20;

-- ============================================================
-- TEMPLATE 12: ROOM DISCOVERY (Public Rooms)
-- ============================================================
-- Use case: Explore/discover rooms
-- Expected: Index Scan on idx_room_public_active

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    r.id,
    r.name,
    r.description,
    r.avatar,
    r.type,
    r."currentMembers",
    r."maxMembers",
    o."displayName" AS owner_name,
    o.avatar AS owner_avatar
FROM "Room" r
JOIN "User" o ON r."ownerId" = o.id
WHERE r.type = 'PUBLIC'
  AND r.status = 'ACTIVE'
ORDER BY r."currentMembers" DESC
LIMIT 20;

-- ============================================================
-- TEMPLATE 13: USER PROFILE WITH AGGREGATES
-- ============================================================
-- Use case: Full user profile with counts
-- Expected: Mix of Index Scans and Index Only Scans

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    u.id,
    u."displayName",
    u.username,
    u.avatar,
    u.bio,
    u."createdAt",
    (SELECT COUNT(*) FROM "Follow" WHERE "followingId" = u.id) AS followers_count,
    (SELECT COUNT(*) FROM "Follow" WHERE "followerId" = u.id) AS following_count,
    (SELECT COALESCE(SUM("totalPrice"), 0) FROM "GiftSend" WHERE "receiverId" = u.id) AS total_gifts_received,
    (SELECT COUNT(*) FROM "GiftSend" WHERE "receiverId" = u.id) AS gifts_count
FROM "User" u
WHERE u.id = '00000000-0000-0000-0000-000000000000';  -- Replace

-- ============================================================
-- TEMPLATE 14: CHECK IS FOLLOWING
-- ============================================================
-- Use case: Button state (Follow/Unfollow)
-- Expected: Index Only Scan on unique constraint

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT EXISTS (
    SELECT 1 FROM "Follow"
    WHERE "followerId" = '00000000-0000-0000-0000-000000000000'  -- Current user
      AND "followingId" = '00000000-0000-0000-0000-000000000001'  -- Target user
) AS is_following;

-- ============================================================
-- TEMPLATE 15: MODERATION QUEUE (Pending Reports)
-- ============================================================
-- Use case: Admin moderation dashboard
-- Expected: Index Scan on idx_report_pending

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT 
    r.id,
    r.type,
    r.reason,
    r.details,
    r."createdAt",
    reporter."displayName" AS reporter_name,
    reported."displayName" AS reported_name
FROM "Report" r
JOIN "User" reporter ON r."reporterId" = reporter.id
LEFT JOIN "User" reported ON r."reportedUserId" = reported.id
WHERE r.status = 'PENDING'
ORDER BY r."createdAt" ASC
LIMIT 50;

-- ============================================================
-- PERFORMANCE OPTIMIZATION TIPS
-- ============================================================

/*
IF YOU SEE SEQ SCAN:
  1. Check if index exists: 
     SELECT indexname FROM pg_indexes WHERE tablename = 'TableName';
  
  2. Run ANALYZE to update statistics:
     ANALYZE "TableName";
  
  3. Check if PostgreSQL thinks Seq Scan is faster:
     - Small tables (<1000 rows) may prefer Seq Scan
     - High percentage of table being returned may prefer Seq Scan

IF ACTUAL ROWS >> ESTIMATED ROWS:
  1. Run ANALYZE on the table
  2. Check if statistics target is sufficient:
     ALTER TABLE "TableName" ALTER COLUMN column_name SET STATISTICS 1000;
     ANALYZE "TableName";

IF SORT IS SLOW:
  1. Add index with matching ORDER BY:
     CREATE INDEX idx_name ON "Table" (column DESC);
  2. Increase work_mem (temporary, be careful):
     SET work_mem = '256MB';

IF JOINS ARE SLOW:
  1. Ensure foreign key columns are indexed
  2. Consider denormalizing frequently joined data
  3. Use materialized views for complex aggregations
*/
