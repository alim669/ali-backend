-- ============================================================
-- 08_CLEANUP_JOBS.sql - Data Retention & Cleanup
-- ============================================================
-- PURPOSE: Find and optionally clean old/expired data
-- RISK/LOCK: VARIES - All DELETEs are commented by default
-- VERIFY: Run SELECT queries first to see what would be deleted
-- IDEMPOTENT: Yes - Safe to run multiple times
-- ============================================================
-- ⚠️ NON-DESTRUCTIVE BY DEFAULT:
--    - All DELETE statements are commented out
--    - Run SELECT queries first to review data
--    - Uncomment DELETEs only after reviewing
-- ============================================================

-- ============================================================
-- SECTION 1: EXPIRED REFRESH TOKENS
-- ============================================================
-- Retention: Delete expired tokens older than 7 days

SELECT '=== EXPIRED REFRESH TOKENS ===' AS section;

-- DRY RUN: See what would be deleted
SELECT 
    COUNT(*) AS tokens_to_delete,
    MIN("expiresAt") AS oldest_expiry,
    MAX("expiresAt") AS newest_expiry
FROM "RefreshToken"
WHERE "expiresAt" < NOW() - INTERVAL '7 days'
   OR ("revokedAt" IS NOT NULL AND "revokedAt" < NOW() - INTERVAL '7 days');

-- SAMPLE: View sample of data to be deleted
SELECT id, "userId", "expiresAt", "revokedAt"
FROM "RefreshToken"
WHERE "expiresAt" < NOW() - INTERVAL '7 days'
   OR ("revokedAt" IS NOT NULL AND "revokedAt" < NOW() - INTERVAL '7 days')
LIMIT 10;

/*
-- ACTUAL DELETE (uncomment to execute)
DELETE FROM "RefreshToken"
WHERE "expiresAt" < NOW() - INTERVAL '7 days'
   OR ("revokedAt" IS NOT NULL AND "revokedAt" < NOW() - INTERVAL '7 days');
*/

-- ============================================================
-- SECTION 2: OLD READ NOTIFICATIONS
-- ============================================================
-- Retention: 30 days for read, 90 days for unread

SELECT '=== OLD NOTIFICATIONS ===' AS section;

-- DRY RUN: Read notifications older than 30 days
SELECT 
    COUNT(*) AS read_notifications_to_delete,
    MIN("createdAt") AS oldest,
    MAX("createdAt") AS newest
FROM "Notification"
WHERE "isRead" = true 
  AND "createdAt" < NOW() - INTERVAL '30 days';

-- DRY RUN: Unread notifications older than 90 days
SELECT 
    COUNT(*) AS unread_notifications_to_delete,
    MIN("createdAt") AS oldest
FROM "Notification"
WHERE "isRead" = false 
  AND "createdAt" < NOW() - INTERVAL '90 days';

/*
-- ACTUAL DELETE (uncomment to execute)
DELETE FROM "Notification"
WHERE "isRead" = true 
  AND "createdAt" < NOW() - INTERVAL '30 days';

DELETE FROM "Notification"
WHERE "isRead" = false 
  AND "createdAt" < NOW() - INTERVAL '90 days';
*/

-- ============================================================
-- SECTION 3: SOFT-DELETED MESSAGES
-- ============================================================
-- Retention: Hard delete messages that were soft-deleted 30+ days ago

SELECT '=== SOFT-DELETED MESSAGES ===' AS section;

-- DRY RUN
SELECT 
    COUNT(*) AS deleted_messages_to_remove,
    MIN("deletedAt") AS oldest_deletion,
    MAX("deletedAt") AS newest_deletion
FROM "Message"
WHERE "isDeleted" = true 
  AND "deletedAt" < NOW() - INTERVAL '30 days';

/*
-- ACTUAL DELETE (uncomment to execute)
DELETE FROM "Message"
WHERE "isDeleted" = true 
  AND "deletedAt" < NOW() - INTERVAL '30 days';
*/

-- ============================================================
-- SECTION 4: RESOLVED/DISMISSED REPORTS
-- ============================================================
-- Retention: 90 days after resolution

SELECT '=== OLD RESOLVED REPORTS ===' AS section;

-- DRY RUN
SELECT 
    status,
    COUNT(*) AS count,
    MIN("resolvedAt") AS oldest,
    MAX("resolvedAt") AS newest
FROM "Report"
WHERE status IN ('RESOLVED', 'DISMISSED')
  AND "resolvedAt" < NOW() - INTERVAL '90 days'
GROUP BY status;

/*
-- ACTUAL DELETE (uncomment to execute)
DELETE FROM "Report"
WHERE status IN ('RESOLVED', 'DISMISSED')
  AND "resolvedAt" < NOW() - INTERVAL '90 days';
*/

-- ============================================================
-- SECTION 5: OLD AUDIT LOGS (if exists)
-- ============================================================
-- Retention: 180 days (adjust based on compliance needs)

SELECT '=== OLD AUDIT LOGS ===' AS section;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'AuditLog') THEN
        RAISE NOTICE 'AuditLog table exists - checking old entries...';
    ELSE
        RAISE NOTICE 'AuditLog table does not exist - skipping';
    END IF;
END $$;

-- DRY RUN (only if table exists)
SELECT 
    COUNT(*) AS logs_to_delete,
    MIN("createdAt") AS oldest,
    MAX("createdAt") AS newest
FROM "AuditLog"
WHERE "createdAt" < NOW() - INTERVAL '180 days';

/*
-- ACTUAL DELETE (uncomment to execute)
DELETE FROM "AuditLog"
WHERE "createdAt" < NOW() - INTERVAL '180 days';
*/

-- ============================================================
-- SECTION 6: INACTIVE ROOM MEMBERS (Left the room)
-- ============================================================
-- Retention: 90 days after leaving

SELECT '=== INACTIVE ROOM MEMBERS ===' AS section;

-- DRY RUN
SELECT 
    COUNT(*) AS members_to_remove,
    MIN("leftAt") AS oldest_departure,
    MAX("leftAt") AS newest_departure
FROM "RoomMember"
WHERE "leftAt" IS NOT NULL 
  AND "leftAt" < NOW() - INTERVAL '90 days';

/*
-- ACTUAL DELETE (uncomment to execute)
DELETE FROM "RoomMember"
WHERE "leftAt" IS NOT NULL 
  AND "leftAt" < NOW() - INTERVAL '90 days';
*/

-- ============================================================
-- SECTION 7: OLD ADMIN ACTIONS
-- ============================================================
-- Retention: 365 days (1 year for compliance)

SELECT '=== OLD ADMIN ACTIONS ===' AS section;

-- DRY RUN
SELECT 
    action,
    COUNT(*) AS count,
    MIN("createdAt") AS oldest
FROM "AdminAction"
WHERE "createdAt" < NOW() - INTERVAL '365 days'
GROUP BY action
ORDER BY count DESC;

/*
-- ACTUAL DELETE (uncomment to execute)
DELETE FROM "AdminAction"
WHERE "createdAt" < NOW() - INTERVAL '365 days';
*/

-- ============================================================
-- SECTION 8: BATCH DELETE FUNCTION
-- ============================================================
-- Use for large deletes to avoid long locks

CREATE OR REPLACE FUNCTION batch_delete_old_data(
    p_table_name TEXT,
    p_condition TEXT,
    p_batch_size INT DEFAULT 1000,
    p_max_iterations INT DEFAULT 100
) RETURNS TABLE(total_deleted INT, iterations INT) AS $$
DECLARE
    v_deleted INT := 0;
    v_batch_deleted INT;
    v_iteration INT := 0;
BEGIN
    LOOP
        EXECUTE format(
            'WITH to_delete AS (
                SELECT ctid FROM %I WHERE %s LIMIT %s
            )
            DELETE FROM %I WHERE ctid IN (SELECT ctid FROM to_delete)',
            p_table_name, p_condition, p_batch_size, p_table_name
        );
        
        GET DIAGNOSTICS v_batch_deleted = ROW_COUNT;
        v_deleted := v_deleted + v_batch_deleted;
        v_iteration := v_iteration + 1;
        
        -- Exit if no more rows or max iterations reached
        EXIT WHEN v_batch_deleted = 0 OR v_iteration >= p_max_iterations;
        
        -- Small pause between batches
        PERFORM pg_sleep(0.05);
    END LOOP;
    
    total_deleted := v_deleted;
    iterations := v_iteration;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

/*
-- USAGE EXAMPLES:

-- Delete expired refresh tokens in batches
SELECT * FROM batch_delete_old_data(
    'RefreshToken',
    '"expiresAt" < NOW() - INTERVAL ''7 days''',
    500
);

-- Delete old read notifications in batches
SELECT * FROM batch_delete_old_data(
    'Notification',
    '"isRead" = true AND "createdAt" < NOW() - INTERVAL ''30 days''',
    1000
);
*/

-- ============================================================
-- SECTION 9: CLEANUP SUMMARY
-- ============================================================

SELECT '=== CLEANUP SUMMARY ===' AS section;

SELECT 
    'RefreshToken' AS table_name,
    (SELECT COUNT(*) FROM "RefreshToken" WHERE "expiresAt" < NOW() - INTERVAL '7 days') AS candidates,
    '7 days after expiry' AS retention
UNION ALL
SELECT 
    'Notification (read)',
    (SELECT COUNT(*) FROM "Notification" WHERE "isRead" = true AND "createdAt" < NOW() - INTERVAL '30 days'),
    '30 days'
UNION ALL
SELECT 
    'Notification (unread)',
    (SELECT COUNT(*) FROM "Notification" WHERE "isRead" = false AND "createdAt" < NOW() - INTERVAL '90 days'),
    '90 days'
UNION ALL
SELECT 
    'Message (deleted)',
    (SELECT COUNT(*) FROM "Message" WHERE "isDeleted" = true AND "deletedAt" < NOW() - INTERVAL '30 days'),
    '30 days after deletion'
UNION ALL
SELECT 
    'Report (resolved)',
    (SELECT COUNT(*) FROM "Report" WHERE status IN ('RESOLVED', 'DISMISSED') AND "resolvedAt" < NOW() - INTERVAL '90 days'),
    '90 days after resolution'
UNION ALL
SELECT 
    'RoomMember (left)',
    (SELECT COUNT(*) FROM "RoomMember" WHERE "leftAt" IS NOT NULL AND "leftAt" < NOW() - INTERVAL '90 days'),
    '90 days after leaving';

-- ============================================================
-- SECTION 10: RETENTION POLICY RECOMMENDATIONS
-- ============================================================

/*
RECOMMENDED RETENTION POLICY:

┌─────────────────────────┬────────────────┬─────────────────────────────────┐
│ Data Type               │ Retention      │ Notes                           │
├─────────────────────────┼────────────────┼─────────────────────────────────┤
│ RefreshToken (expired)  │ 7 days         │ No value after expiry           │
│ Notification (read)     │ 30 days        │ User already saw it             │
│ Notification (unread)   │ 90 days        │ If not read, probably not needed│
│ Message (soft-deleted)  │ 30 days        │ Recovery window                 │
│ Message (active)        │ Forever        │ Chat history is valuable        │
│ Report (resolved)       │ 90 days        │ Moderation history              │
│ AdminAction             │ 1 year         │ Compliance/audit trail          │
│ AuditLog                │ 6 months       │ Security monitoring             │
│ RoomMember (left)       │ 90 days        │ Can rejoin room later           │
│ GiftSend                │ Forever        │ Financial records               │
│ WalletTransaction       │ Forever        │ Financial records (compliance)  │
│ User                    │ Forever        │ GDPR: implement delete request  │
└─────────────────────────┴────────────────┴─────────────────────────────────┘

CLEANUP SCHEDULE:
- Daily: RefreshToken cleanup
- Weekly: Notification, Message cleanup
- Monthly: Report, RoomMember, AdminAction, AuditLog cleanup

POST-CLEANUP:
- Run VACUUM ANALYZE on affected tables
- Check for any orphan records
*/
