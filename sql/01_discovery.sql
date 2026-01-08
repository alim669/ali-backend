-- ============================================================
-- 01_DISCOVERY.sql - Complete Database Discovery & Analysis
-- ============================================================
-- PURPOSE: Analyze existing schema, detect column naming conventions,
--          find missing indexes, orphan records, and constraint gaps.
-- RISK/LOCK: NONE - All queries are READ-ONLY
-- VERIFY: Review output for anomalies, missing indexes, orphan data
-- IDEMPOTENT: Yes - Safe to run unlimited times
-- ============================================================

-- ============================================================
-- SECTION 1: DATABASE OVERVIEW
-- ============================================================

SELECT '=== DATABASE INFO ===' AS section;

SELECT 
    current_database() AS database_name,
    current_user AS connected_user,
    version() AS postgres_version,
    pg_size_pretty(pg_database_size(current_database())) AS total_size,
    (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()) AS active_connections;

-- ============================================================
-- SECTION 2: ALL TABLES WITH SIZES AND ROW ESTIMATES
-- ============================================================

SELECT '=== TABLES OVERVIEW ===' AS section;

SELECT 
    c.relname AS table_name,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
    pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
    pg_size_pretty(pg_indexes_size(c.oid)) AS indexes_size,
    s.n_live_tup AS estimated_rows,
    s.n_dead_tup AS dead_tuples,
    CASE WHEN s.n_live_tup > 0 
         THEN ROUND(s.n_dead_tup::numeric / s.n_live_tup * 100, 2) 
         ELSE 0 END AS dead_pct,
    s.last_vacuum,
    s.last_autovacuum,
    s.last_analyze
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC;

-- ============================================================
-- SECTION 3: ALL COLUMNS (Detect naming convention)
-- ============================================================

SELECT '=== COLUMNS BY TABLE ===' AS section;

SELECT 
    table_name,
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- ============================================================
-- SECTION 4: DETECT NAMING CONVENTION (camelCase vs snake_case)
-- ============================================================

SELECT '=== NAMING CONVENTION DETECTION ===' AS section;

SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'createdAt') 
        THEN 'camelCase'
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'created_at') 
        THEN 'snake_case'
        ELSE 'unknown'
    END AS detected_naming_convention;

-- Tables with updatedAt/updated_at (for trigger application)
SELECT 
    table_name,
    column_name AS timestamp_column,
    CASE 
        WHEN column_name = 'updatedAt' THEN 'camelCase'
        WHEN column_name = 'updated_at' THEN 'snake_case'
    END AS convention
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('updatedAt', 'updated_at')
ORDER BY table_name;

-- ============================================================
-- SECTION 5: ALL INDEXES
-- ============================================================

SELECT '=== EXISTING INDEXES ===' AS section;

SELECT 
    pg_indexes.schemaname,
    pg_indexes.tablename,
    pg_indexes.indexname,
    pg_indexes.indexdef,
    pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
    i.idx_scan AS times_used,
    i.idx_tup_read AS tuples_read
FROM pg_indexes
JOIN pg_stat_user_indexes i ON i.indexrelname = pg_indexes.indexname AND i.schemaname = pg_indexes.schemaname
WHERE pg_indexes.schemaname = 'public'
ORDER BY pg_indexes.tablename, pg_indexes.indexname;

-- ============================================================
-- SECTION 6: UNUSED INDEXES (Candidates for removal)
-- ============================================================

SELECT '=== UNUSED INDEXES ===' AS section;

SELECT 
    schemaname,
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan AS times_used,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan = 0
  AND indexrelname NOT LIKE '%_pkey'
ORDER BY pg_relation_size(indexrelid) DESC;

-- ============================================================
-- SECTION 7: MISSING INDEXES (High seq scan tables)
-- ============================================================

SELECT '=== TABLES NEEDING INDEXES (High Seq Scans) ===' AS section;

SELECT 
    schemaname,
    relname AS table_name,
    seq_scan,
    seq_tup_read,
    idx_scan,
    CASE WHEN seq_scan + idx_scan > 0 
         THEN ROUND(idx_scan::numeric / (seq_scan + idx_scan) * 100, 2) 
         ELSE 100 END AS index_usage_pct,
    n_live_tup AS row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND n_live_tup > 1000
  AND seq_scan > idx_scan
ORDER BY seq_scan DESC;

-- ============================================================
-- SECTION 8: ALL CONSTRAINTS
-- ============================================================

SELECT '=== PRIMARY KEYS ===' AS section;

SELECT 
    tc.table_name,
    tc.constraint_name,
    kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'PRIMARY KEY'
ORDER BY tc.table_name;

SELECT '=== UNIQUE CONSTRAINTS ===' AS section;

SELECT 
    tc.table_name,
    tc.constraint_name,
    STRING_AGG(kcu.column_name, ', ') AS columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'UNIQUE'
GROUP BY tc.table_name, tc.constraint_name
ORDER BY tc.table_name;

SELECT '=== CHECK CONSTRAINTS ===' AS section;

SELECT 
    tc.table_name,
    tc.constraint_name,
    cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc 
    ON tc.constraint_name = cc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'CHECK'
ORDER BY tc.table_name;

-- ============================================================
-- SECTION 9: FOREIGN KEYS
-- ============================================================

SELECT '=== FOREIGN KEYS ===' AS section;

SELECT 
    tc.table_name AS source_table,
    kcu.column_name AS source_column,
    ccu.table_name AS target_table,
    ccu.column_name AS target_column,
    tc.constraint_name,
    rc.update_rule,
    rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu 
    ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc 
    ON tc.constraint_name = rc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name, kcu.column_name;

-- ============================================================
-- SECTION 10: EXISTING TRIGGERS
-- ============================================================

SELECT '=== TRIGGERS ===' AS section;

SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_timing,
    action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- ============================================================
-- SECTION 11: ENUM TYPES
-- ============================================================

SELECT '=== ENUM TYPES ===' AS section;

SELECT 
    t.typname AS enum_name,
    STRING_AGG(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS values
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE n.nspname = 'public'
GROUP BY t.typname
ORDER BY t.typname;

-- ============================================================
-- SECTION 12: ORPHAN RECORD DETECTION (Safe checks)
-- ============================================================

SELECT '=== ORPHAN RECORDS CHECK ===' AS section;

-- Dynamic orphan check using DO block
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Messages without Room
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Message')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Room') THEN
        EXECUTE 'SELECT COUNT(*) FROM "Message" m WHERE NOT EXISTS (SELECT 1 FROM "Room" r WHERE r.id = m."roomId")' INTO v_count;
        IF v_count > 0 THEN
            RAISE NOTICE 'ORPHAN: % Messages without Room', v_count;
        END IF;
    END IF;

    -- RoomMembers without Room
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'RoomMember')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Room') THEN
        EXECUTE 'SELECT COUNT(*) FROM "RoomMember" rm WHERE NOT EXISTS (SELECT 1 FROM "Room" r WHERE r.id = rm."roomId")' INTO v_count;
        IF v_count > 0 THEN
            RAISE NOTICE 'ORPHAN: % RoomMembers without Room', v_count;
        END IF;
    END IF;

    -- RoomMembers without User
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'RoomMember')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'User') THEN
        EXECUTE 'SELECT COUNT(*) FROM "RoomMember" rm WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = rm."userId")' INTO v_count;
        IF v_count > 0 THEN
            RAISE NOTICE 'ORPHAN: % RoomMembers without User', v_count;
        END IF;
    END IF;

    -- GiftSend without Sender
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'GiftSend')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'User') THEN
        EXECUTE 'SELECT COUNT(*) FROM "GiftSend" gs WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = gs."senderId")' INTO v_count;
        IF v_count > 0 THEN
            RAISE NOTICE 'ORPHAN: % GiftSend without Sender', v_count;
        END IF;
    END IF;

    -- GiftSend without Receiver
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'GiftSend')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'User') THEN
        EXECUTE 'SELECT COUNT(*) FROM "GiftSend" gs WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = gs."receiverId")' INTO v_count;
        IF v_count > 0 THEN
            RAISE NOTICE 'ORPHAN: % GiftSend without Receiver', v_count;
        END IF;
    END IF;

    -- Wallets without User
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Wallet')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'User') THEN
        EXECUTE 'SELECT COUNT(*) FROM "Wallet" w WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = w."userId")' INTO v_count;
        IF v_count > 0 THEN
            RAISE NOTICE 'ORPHAN: % Wallets without User', v_count;
        END IF;
    END IF;

    -- WalletTransactions without Wallet
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'WalletTransaction')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Wallet') THEN
        EXECUTE 'SELECT COUNT(*) FROM "WalletTransaction" wt WHERE NOT EXISTS (SELECT 1 FROM "Wallet" w WHERE w.id = wt."walletId")' INTO v_count;
        IF v_count > 0 THEN
            RAISE NOTICE 'ORPHAN: % WalletTransactions without Wallet', v_count;
        END IF;
    END IF;

    -- Follows without valid users
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Follow')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'User') THEN
        EXECUTE 'SELECT COUNT(*) FROM "Follow" f WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = f."followerId")' INTO v_count;
        IF v_count > 0 THEN
            RAISE NOTICE 'ORPHAN: % Follows without Follower', v_count;
        END IF;
        EXECUTE 'SELECT COUNT(*) FROM "Follow" f WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = f."followingId")' INTO v_count;
        IF v_count > 0 THEN
            RAISE NOTICE 'ORPHAN: % Follows without Following user', v_count;
        END IF;
    END IF;

    RAISE NOTICE 'Orphan check complete.';
END $$;

-- ============================================================
-- SECTION 13: DATA INTEGRITY CHECKS
-- ============================================================

SELECT '=== DATA INTEGRITY CHECKS ===' AS section;

DO $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Negative balances
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Wallet' AND column_name = 'balance') THEN
        EXECUTE 'SELECT COUNT(*) FROM "Wallet" WHERE balance < 0' INTO v_count;
        IF v_count > 0 THEN
            RAISE WARNING 'INTEGRITY: % Wallets with negative balance', v_count;
        END IF;
    END IF;

    -- Negative diamonds
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Wallet' AND column_name = 'diamonds') THEN
        EXECUTE 'SELECT COUNT(*) FROM "Wallet" WHERE diamonds < 0' INTO v_count;
        IF v_count > 0 THEN
            RAISE WARNING 'INTEGRITY: % Wallets with negative diamonds', v_count;
        END IF;
    END IF;

    -- Self-follows
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Follow') THEN
        EXECUTE 'SELECT COUNT(*) FROM "Follow" WHERE "followerId" = "followingId"' INTO v_count;
        IF v_count > 0 THEN
            RAISE WARNING 'INTEGRITY: % Self-follows detected', v_count;
        END IF;
    END IF;

    -- Self-gifts
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'GiftSend') THEN
        EXECUTE 'SELECT COUNT(*) FROM "GiftSend" WHERE "senderId" = "receiverId"' INTO v_count;
        IF v_count > 0 THEN
            RAISE WARNING 'INTEGRITY: % Self-gifts detected', v_count;
        END IF;
    END IF;

    -- Rooms over capacity
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Room' AND column_name = 'currentMembers') THEN
        EXECUTE 'SELECT COUNT(*) FROM "Room" WHERE "currentMembers" > "maxMembers"' INTO v_count;
        IF v_count > 0 THEN
            RAISE WARNING 'INTEGRITY: % Rooms over capacity', v_count;
        END IF;
    END IF;

    RAISE NOTICE 'Integrity check complete.';
END $$;

-- ============================================================
-- SECTION 14: COLUMN EXISTENCE CHECK FOR INDEX OPTIMIZATION
-- ============================================================

SELECT '=== COLUMNS FOR INDEX OPTIMIZATION ===' AS section;

SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'Message' AND column_name IN ('roomId', 'room_id', 'senderId', 'sender_id', 'createdAt', 'created_at', 'isDeleted', 'is_deleted'))
    OR (table_name = 'GiftSend' AND column_name IN ('roomId', 'room_id', 'senderId', 'sender_id', 'receiverId', 'receiver_id', 'createdAt', 'created_at'))
    OR (table_name = 'WalletTransaction' AND column_name IN ('walletId', 'wallet_id', 'createdAt', 'created_at', 'type'))
    OR (table_name = 'RoomMember' AND column_name IN ('roomId', 'room_id', 'userId', 'user_id', 'isBanned', 'is_banned', 'leftAt', 'left_at'))
    OR (table_name = 'Follow' AND column_name IN ('followerId', 'follower_id', 'followingId', 'following_id', 'createdAt', 'created_at'))
    OR (table_name = 'Notification' AND column_name IN ('userId', 'user_id', 'isRead', 'is_read', 'createdAt', 'created_at'))
  )
ORDER BY table_name, column_name;

-- ============================================================
-- END OF DISCOVERY
-- ============================================================

SELECT '=== DISCOVERY COMPLETE ===' AS section;
