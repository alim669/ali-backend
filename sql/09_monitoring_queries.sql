-- ============================================================
-- 09_MONITORING_QUERIES.sql - Database Monitoring & Health
-- ============================================================
-- PURPOSE: Monitor database performance, connections, locks
-- RISK/LOCK: NONE - All queries are read-only
-- VERIFY: Run during peak hours for realistic metrics
-- IDEMPOTENT: Yes - Safe to run unlimited times
-- ============================================================

-- ============================================================
-- SECTION 1: DATABASE OVERVIEW
-- ============================================================

SELECT '=== DATABASE OVERVIEW ===' AS section;

SELECT 
    current_database() AS database_name,
    pg_size_pretty(pg_database_size(current_database())) AS total_size,
    (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
    (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS active_queries,
    (SELECT setting FROM pg_settings WHERE name = 'max_connections') AS max_connections;

-- ============================================================
-- SECTION 2: CONNECTION STATUS
-- ============================================================

SELECT '=== CONNECTION STATUS ===' AS section;

SELECT 
    state,
    COUNT(*) AS count,
    ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - state_change))), 2) AS avg_duration_sec
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state
ORDER BY count DESC;

-- Connection details
SELECT 
    pid,
    usename,
    application_name,
    client_addr,
    state,
    EXTRACT(EPOCH FROM (NOW() - state_change))::int AS duration_sec,
    LEFT(query, 60) AS query_preview
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid != pg_backend_pid()
ORDER BY state_change
LIMIT 20;

-- ============================================================
-- SECTION 3: ACTIVE/LONG-RUNNING QUERIES
-- ============================================================

SELECT '=== LONG-RUNNING QUERIES (>30s) ===' AS section;

SELECT 
    pid,
    usename,
    state,
    EXTRACT(EPOCH FROM (NOW() - query_start))::int AS duration_sec,
    wait_event_type,
    wait_event,
    LEFT(query, 100) AS query_preview
FROM pg_stat_activity
WHERE datname = current_database()
  AND state != 'idle'
  AND query_start < NOW() - INTERVAL '30 seconds'
ORDER BY query_start;

-- ============================================================
-- SECTION 4: LOCK MONITORING
-- ============================================================

SELECT '=== WAITING/BLOCKED QUERIES ===' AS section;

SELECT 
    blocked.pid AS blocked_pid,
    blocked.usename AS blocked_user,
    blocking.pid AS blocking_pid,
    blocking.usename AS blocking_user,
    blocked.query AS blocked_query,
    blocking.query AS blocking_query,
    EXTRACT(EPOCH FROM (NOW() - blocked.query_start))::int AS blocked_duration_sec
FROM pg_stat_activity blocked
JOIN pg_locks blocked_locks ON blocked.pid = blocked_locks.pid
JOIN pg_locks blocking_locks ON 
    blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_stat_activity blocking ON blocking_locks.pid = blocking.pid
WHERE NOT blocked_locks.granted
  AND blocked.datname = current_database();

-- Current locks summary
SELECT 
    locktype,
    mode,
    COUNT(*) AS count,
    SUM(CASE WHEN granted THEN 1 ELSE 0 END) AS granted,
    SUM(CASE WHEN NOT granted THEN 1 ELSE 0 END) AS waiting
FROM pg_locks
WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
GROUP BY locktype, mode
HAVING SUM(CASE WHEN NOT granted THEN 1 ELSE 0 END) > 0
ORDER BY waiting DESC;

-- ============================================================
-- SECTION 5: TABLE SIZES
-- ============================================================

SELECT '=== TABLE SIZES ===' AS section;

SELECT 
    relname AS table_name,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
    pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
    pg_size_pretty(pg_indexes_size(c.oid)) AS indexes_size,
    s.n_live_tup AS row_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC;

-- ============================================================
-- SECTION 6: INDEX SIZES & USAGE
-- ============================================================

SELECT '=== INDEX SIZES & USAGE ===' AS section;

SELECT 
    schemaname,
    relname AS table_name,
    indexrelname AS index_name,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size,
    idx_scan AS scans,
    idx_tup_read AS tuples_read,
    idx_tup_fetch AS tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;

-- ============================================================
-- SECTION 7: CACHE HIT RATIO
-- ============================================================

SELECT '=== CACHE HIT RATIO ===' AS section;

-- Database level
SELECT 
    'database' AS level,
    datname AS name,
    ROUND(
        100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 
        2
    ) AS cache_hit_ratio
FROM pg_stat_database
WHERE datname = current_database();

-- Table level (top 10 most accessed)
SELECT 
    'table' AS level,
    relname AS name,
    ROUND(
        100.0 * heap_blks_hit / NULLIF(heap_blks_hit + heap_blks_read, 0), 
        2
    ) AS cache_hit_ratio,
    heap_blks_hit + heap_blks_read AS total_blocks
FROM pg_statio_user_tables
WHERE heap_blks_hit + heap_blks_read > 0
ORDER BY heap_blks_hit + heap_blks_read DESC
LIMIT 10;

-- Index level
SELECT 
    'index' AS level,
    indexrelname AS name,
    ROUND(
        100.0 * idx_blks_hit / NULLIF(idx_blks_hit + idx_blks_read, 0), 
        2
    ) AS cache_hit_ratio
FROM pg_statio_user_indexes
WHERE idx_blks_hit + idx_blks_read > 0
ORDER BY idx_blks_hit + idx_blks_read DESC
LIMIT 10;

-- ============================================================
-- SECTION 8: SEQUENTIAL VS INDEX SCANS
-- ============================================================

SELECT '=== SEQUENTIAL VS INDEX SCANS ===' AS section;

SELECT 
    relname AS table_name,
    seq_scan,
    seq_tup_read,
    idx_scan,
    idx_tup_fetch,
    CASE 
        WHEN seq_scan + idx_scan = 0 THEN 'No scans'
        ELSE ROUND(100.0 * idx_scan / (seq_scan + idx_scan), 2) || '%'
    END AS index_usage
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY seq_scan DESC
LIMIT 15;

-- ============================================================
-- SECTION 9: TRANSACTION STATISTICS
-- ============================================================

SELECT '=== TRANSACTION STATISTICS ===' AS section;

SELECT 
    xact_commit AS commits,
    xact_rollback AS rollbacks,
    ROUND(
        100.0 * xact_rollback / NULLIF(xact_commit + xact_rollback, 0), 
        2
    ) AS rollback_percent,
    blks_read,
    blks_hit,
    tup_returned,
    tup_fetched,
    tup_inserted,
    tup_updated,
    tup_deleted
FROM pg_stat_database
WHERE datname = current_database();

-- ============================================================
-- SECTION 10: SLOW QUERY TRACKING (pg_stat_statements)
-- ============================================================

SELECT '=== SLOW QUERIES (if pg_stat_statements enabled) ===' AS section;

-- Check if pg_stat_statements is available
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
        RAISE NOTICE 'pg_stat_statements is enabled';
    ELSE
        RAISE NOTICE 'pg_stat_statements is NOT enabled. Enable for query performance tracking.';
    END IF;
END $$;

-- Top slow queries (only works if pg_stat_statements is enabled)
/*
SELECT 
    calls,
    ROUND(total_exec_time::numeric, 2) AS total_time_ms,
    ROUND(mean_exec_time::numeric, 2) AS avg_time_ms,
    ROUND(stddev_exec_time::numeric, 2) AS stddev_ms,
    rows,
    ROUND(100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0), 2) AS cache_hit_pct,
    LEFT(query, 80) AS query_preview
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY mean_exec_time DESC
LIMIT 20;
*/

-- ============================================================
-- SECTION 11: REPLICATION STATUS (if applicable)
-- ============================================================

SELECT '=== REPLICATION STATUS ===' AS section;

SELECT 
    client_addr,
    state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    sync_state
FROM pg_stat_replication;

-- ============================================================
-- SECTION 12: QUICK HEALTH DASHBOARD
-- ============================================================

SELECT '=== HEALTH DASHBOARD ===' AS section;

WITH metrics AS (
    SELECT
        (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
        (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS active,
        (SELECT COUNT(*) FROM pg_locks WHERE NOT granted) AS blocked,
        (SELECT ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) FROM pg_stat_database WHERE datname = current_database()) AS cache_hit,
        (SELECT pg_size_pretty(pg_database_size(current_database()))) AS db_size
)
SELECT 
    connections || '/' || max_connections AS "Connections",
    CASE 
        WHEN connections::float / max_connections > 0.8 THEN '🔴 HIGH'
        WHEN connections::float / max_connections > 0.5 THEN '🟡 MEDIUM'
        ELSE '🟢 OK'
    END AS "Conn Status",
    active AS "Active Queries",
    blocked AS "Blocked",
    CASE WHEN blocked > 0 THEN '🔴 LOCKS!' ELSE '🟢 OK' END AS "Lock Status",
    cache_hit || '%' AS "Cache Hit",
    CASE 
        WHEN cache_hit < 90 THEN '🔴 LOW'
        WHEN cache_hit < 95 THEN '🟡 FAIR'
        ELSE '🟢 GOOD'
    END AS "Cache Status",
    db_size AS "DB Size"
FROM metrics;

-- ============================================================
-- NEON.TECH MONITORING NOTES
-- ============================================================

/*
NEON DASHBOARD METRICS TO MONITOR:

1. COMPUTE:
   - CPU usage (should stay below 80% sustained)
   - Memory usage
   - Compute hours (for billing)

2. STORAGE:
   - Total storage used
   - Growth rate

3. CONNECTIONS:
   - Active connections vs limit
   - Connection errors

4. QUERIES:
   - Query latency (P50, P95, P99)
   - Query throughput

ALERTS TO SET UP:
   - Storage > 80% of limit
   - Connections > 80% of max
   - Slow queries > 5s
   - Rollback rate > 5%
   - Cache hit ratio < 90%

NEON-SPECIFIC:
   - Use branching for testing
   - Monitor cold start times
   - Check autoscaling behavior
*/
