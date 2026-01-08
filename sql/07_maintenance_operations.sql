-- ============================================================
-- 07_MAINTENANCE_OPERATIONS.sql - Database Maintenance
-- ============================================================
-- PURPOSE: Templates for VACUUM, ANALYZE, and monitoring
-- RISK/LOCK: VARIES - See individual commands
-- VERIFY: Check pg_stat_user_tables for last_vacuum/last_analyze
-- IDEMPOTENT: Yes - All operations are safe to run multiple times
-- ============================================================
-- ⚠️ NEON.TECH NOTES:
--    - Autovacuum is enabled by default
--    - Manual VACUUM is rarely needed but safe
--    - VACUUM FULL requires exclusive lock - avoid in production
-- ============================================================

-- ============================================================
-- SECTION 1: ANALYZE - Update Query Planner Statistics
-- ============================================================
-- RISK: NONE - Non-blocking, read-only operation
-- WHEN: After bulk inserts, deletes, or schema changes

-- Analyze all tables
ANALYZE;

-- Or analyze specific high-traffic tables
ANALYZE "Message";
ANALYZE "GiftSend";
ANALYZE "WalletTransaction";
ANALYZE "RoomMember";
ANALYZE "Notification";
ANALYZE "User";
ANALYZE "Room";
ANALYZE "Follow";

-- ============================================================
-- SECTION 2: VACUUM - Reclaim Dead Tuples
-- ============================================================
-- RISK: LOW - Non-blocking (without FULL)
-- WHEN: Weekly or after bulk deletes

-- Standard VACUUM with ANALYZE (recommended)
VACUUM (VERBOSE, ANALYZE) "Message";
VACUUM (VERBOSE, ANALYZE) "GiftSend";
VACUUM (VERBOSE, ANALYZE) "WalletTransaction";
VACUUM (VERBOSE, ANALYZE) "Notification";
VACUUM (VERBOSE, ANALYZE) "RefreshToken";
VACUUM (VERBOSE, ANALYZE) "Follow";

-- ============================================================
-- SECTION 3: VACUUM FULL - Complete Table Rewrite
-- ============================================================
-- ⚠️ RISK: HIGH - Exclusive lock, table inaccessible!
-- ⚠️ WHEN: Only during maintenance windows with app offline
-- ⚠️ USE: Only for severely bloated tables (>50% dead tuples)

/*
-- UNCOMMENT ONLY FOR MAINTENANCE WINDOW
VACUUM FULL "Message";
VACUUM FULL "Notification";
VACUUM FULL "RefreshToken";
*/

-- ============================================================
-- SECTION 4: REINDEX - Rebuild Bloated Indexes
-- ============================================================
-- RISK: LOW with CONCURRENTLY (no table lock)
-- WHEN: When index scan performance degrades

-- Safe concurrent reindex (PostgreSQL 12+)
-- REINDEX INDEX CONCURRENTLY idx_message_room_created_desc;
-- REINDEX TABLE CONCURRENTLY "Message";

-- ============================================================
-- SECTION 5: TABLE BLOAT ANALYSIS
-- ============================================================

SELECT '=== TABLE BLOAT ANALYSIS ===' AS section;

SELECT
    schemaname,
    relname AS table_name,
    n_live_tup AS live_rows,
    n_dead_tup AS dead_rows,
    CASE 
        WHEN n_live_tup > 0 
        THEN ROUND(n_dead_tup::numeric / n_live_tup * 100, 2)
        ELSE 0 
    END AS dead_percent,
    pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) AS total_size,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze,
    vacuum_count,
    autovacuum_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC;

-- ============================================================
-- SECTION 6: INDEX BLOAT ANALYSIS
-- ============================================================

SELECT '=== INDEX BLOAT ANALYSIS ===' AS section;

-- Approximate index bloat (requires pgstattuple extension for exact)
SELECT
    schemaname,
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan AS times_used,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    CASE 
        WHEN idx_scan = 0 THEN 'UNUSED - Consider dropping'
        WHEN idx_scan < 100 THEN 'RARELY USED'
        ELSE 'ACTIVE'
    END AS status
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;

-- ============================================================
-- SECTION 7: AUTOVACUUM STATUS
-- ============================================================

SELECT '=== AUTOVACUUM CONFIGURATION ===' AS section;

-- Current autovacuum settings
SELECT 
    name, 
    setting, 
    unit,
    short_desc
FROM pg_settings
WHERE name LIKE 'autovacuum%'
   OR name IN ('vacuum_cost_delay', 'vacuum_cost_limit')
ORDER BY name;

-- ============================================================
-- SECTION 8: LONG-RUNNING AUTOVACUUM
-- ============================================================

SELECT '=== RUNNING AUTOVACUUM PROCESSES ===' AS section;

SELECT
    pid,
    datname,
    usename,
    state,
    query,
    NOW() - query_start AS duration
FROM pg_stat_activity
WHERE query LIKE 'autovacuum:%'
ORDER BY duration DESC;

-- ============================================================
-- SECTION 9: MAINTENANCE SCHEDULE RECOMMENDATIONS
-- ============================================================

/*
RECOMMENDED MAINTENANCE SCHEDULE:

DAILY (Off-peak hours):
┌────────────────────────────────────────────────────────────┐
│  ANALYZE;                                                  │
│  -- Or high-traffic tables only:                          │
│  ANALYZE "Message";                                        │
│  ANALYZE "Notification";                                   │
└────────────────────────────────────────────────────────────┘

WEEKLY (Low traffic period):
┌────────────────────────────────────────────────────────────┐
│  VACUUM (ANALYZE) "Message";                               │
│  VACUUM (ANALYZE) "Notification";                          │
│  VACUUM (ANALYZE) "RefreshToken";                          │
│  VACUUM (ANALYZE) "GiftSend";                             │
└────────────────────────────────────────────────────────────┘

MONTHLY (Review):
┌────────────────────────────────────────────────────────────┐
│  - Check unused indexes (Section 6)                        │
│  - Check table bloat (Section 5)                          │
│  - Review autovacuum stats                                │
│  - REINDEX CONCURRENTLY on bloated indexes                │
└────────────────────────────────────────────────────────────┘

QUARTERLY (Maintenance window if needed):
┌────────────────────────────────────────────────────────────┐
│  - VACUUM FULL on severely bloated tables (with downtime) │
│  - Full statistics review                                 │
│  - Index optimization review                              │
└────────────────────────────────────────────────────────────┘

NEON.TECH SPECIFIC:
- Autovacuum is managed by Neon
- Storage is auto-compacted
- Focus on ANALYZE and index maintenance
*/

-- ============================================================
-- SECTION 10: QUICK HEALTH CHECK QUERY
-- ============================================================

SELECT '=== QUICK HEALTH CHECK ===' AS section;

WITH table_stats AS (
    SELECT
        relname,
        n_live_tup,
        n_dead_tup,
        CASE 
            WHEN n_live_tup > 0 
            THEN ROUND(n_dead_tup::numeric / n_live_tup * 100, 2)
            ELSE 0 
        END AS dead_pct,
        last_autovacuum,
        last_autoanalyze
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
)
SELECT 
    relname AS table_name,
    n_live_tup AS rows,
    dead_pct || '%' AS bloat,
    CASE
        WHEN dead_pct > 20 THEN '🔴 VACUUM needed'
        WHEN dead_pct > 10 THEN '🟡 Monitor'
        ELSE '🟢 OK'
    END AS status,
    COALESCE(TO_CHAR(last_autovacuum, 'YYYY-MM-DD HH24:MI'), 'Never') AS last_vacuum,
    COALESCE(TO_CHAR(last_autoanalyze, 'YYYY-MM-DD HH24:MI'), 'Never') AS last_analyze
FROM table_stats
WHERE n_live_tup > 0
ORDER BY dead_pct DESC;
