# Database Optimization Runbook

## Ali Backend - Neon.tech PostgreSQL

---

## 📋 Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Backup Procedures](#2-backup-procedures)
3. [Script Execution Order](#3-script-execution-order)
4. [Neon.tech Specific Notes](#4-neontech-specific-notes)
5. [Verification Checklist](#5-verification-checklist)
6. [Rollback Strategy](#6-rollback-strategy)
7. [Troubleshooting](#7-troubleshooting)
8. [Maintenance Schedule](#8-maintenance-schedule)

---

## 1. Prerequisites

### Required Access
- [ ] Neon.tech console access
- [ ] Database connection string
- [ ] PostgreSQL client (psql, DBeaver, or similar)

### Connection String Format
```
postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

### Recommended Tools
- **psql** - Command line (best for scripts)
- **DBeaver** - GUI with EXPLAIN visualization
- **Prisma Studio** - Quick data browsing

### Before Starting
- [ ] Notify team of maintenance
- [ ] Check current traffic/load
- [ ] Verify backup is recent
- [ ] Test scripts in Neon branch first

---

## 2. Backup Procedures

### Option A: Neon Branch (Recommended - Instant)

1. Go to [Neon Console](https://console.neon.tech)
2. Select your project
3. Click **Branches** → **Create Branch**
4. Name it: `backup-YYYYMMDD-HHMM`
5. This creates an instant copy of your database

### Option B: pg_dump (Full backup)

```powershell
# Windows PowerShell
$env:PGPASSWORD = "your-password"
pg_dump -h ep-round-math-a1nfcq45-pooler.ap-southeast-1.aws.neon.tech `
        -U neondb_owner `
        -d neondb `
        -F c -b -v `
        -f "ali_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"
```

```bash
# Linux/Mac
export PGPASSWORD="your-password"
pg_dump -h ep-round-math-a1nfcq45-pooler.ap-southeast-1.aws.neon.tech \
        -U neondb_owner \
        -d neondb \
        -F c -b -v \
        -f "ali_backup_$(date +%Y%m%d_%H%M%S).dump"
```

### Option C: Schema Only

```powershell
pg_dump $env:DATABASE_URL --schema-only -f "ali_schema_$(Get-Date -Format 'yyyyMMdd').sql"
```

### Restore from pg_dump

```bash
pg_restore -h HOST -U USER -d DATABASE -v backup_file.dump
```

---

## 3. Script Execution Order

### Execution Summary

| Order | Script | Risk | Lock | Time Est. | Online? |
|-------|--------|------|------|-----------|---------|
| 1 | `01_discovery.sql` | None | None | 1-2 min | ✅ Yes |
| 2 | `02_performance_indexes.sql` | Low | None* | 5-15 min | ✅ Yes |
| 3 | `03_updated_at_trigger.sql` | Low | Brief | <1 min | ✅ Yes |
| 4 | `04_audit_logs.sql` | Low | None | <1 min | ✅ Yes |
| 5 | `05_security_permissions.sql` | Low | None | <1 min | ✅ Yes |
| 6 | `06_constraints_validation.sql` | Medium | Brief | 2-5 min | ✅ Yes |
| 7 | `07_maintenance_operations.sql` | Low | Varies | 5-30 min | ⚠️ Maybe |
| 8 | `08_cleanup_jobs.sql` | Medium | Low | Varies | ✅ Yes |
| 9 | `09_monitoring_queries.sql` | None | None | <1 min | ✅ Yes |
| 10 | `10_explain_analyze_templates.sql` | None | None | N/A | ✅ Yes |

*CONCURRENTLY indexes don't lock tables

### Step-by-Step Execution

#### Step 1: Discovery (Required First)

```sql
-- Connect to database
\c neondb

-- Run discovery
\i sql/01_discovery.sql

-- Review output carefully:
-- - Check for orphan records
-- - Note existing indexes
-- - Identify naming convention (camelCase/snake_case)
```

**What to look for:**
- Tables with high dead tuple percentage (>10%)
- Unused indexes (candidates for removal)
- Missing indexes on frequently queried columns
- Orphan records requiring cleanup

#### Step 2: Performance Indexes

⚠️ **Do NOT run in a transaction!** CREATE INDEX CONCURRENTLY fails inside transactions.

```sql
-- Run without transaction wrapper
\i sql/02_performance_indexes.sql

-- Verify indexes created
SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%';
```

#### Step 3: Updated At Triggers

```sql
\i sql/03_updated_at_trigger.sql

-- Verify triggers
SELECT trigger_name, event_object_table FROM information_schema.triggers 
WHERE trigger_schema = 'public' AND trigger_name LIKE 'trg_%';
```

#### Step 4: Audit Logs

```sql
\i sql/04_audit_logs.sql

-- Verify table exists
\d "AuditLog"
```

#### Step 5: Security Permissions

```sql
\i sql/05_security_permissions.sql

-- Verify roles
SELECT rolname FROM pg_roles WHERE rolname LIKE 'app_%';
```

⚠️ **After running:** Update connection strings in `.env` to use `app_user` role instead of owner.

#### Step 6: Constraints

```sql
\i sql/06_constraints_validation.sql

-- If any constraints fail, check violation queries in the output
-- Fix data before re-running validation
```

#### Step 7: Maintenance (Optional)

```sql
-- Run during low traffic
\i sql/07_maintenance_operations.sql
```

#### Step 8: Cleanup (Review First)

```sql
-- First, run DRY RUN queries to see what would be deleted
\i sql/08_cleanup_jobs.sql

-- Review counts
-- Then manually uncomment and run DELETE statements if satisfied
```

---

## 4. Neon.tech Specific Notes

### Connection Endpoints

| Type | Use For | Endpoint Format |
|------|---------|-----------------|
| Pooler | Application | `ep-xxx-pooler.region.aws.neon.tech` |
| Direct | Migrations | `ep-xxx.region.aws.neon.tech` |

### Pooler Configuration

```env
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/db?sslmode=require&connection_limit=5&pool_timeout=30"
```

### Branching Strategy

1. **Production**: Main branch, protected
2. **Staging**: Branch from production weekly
3. **Development**: Branch per feature/test

### Before Major Changes

```bash
# Create a safety branch
neon branches create --name safety-backup-$(date +%Y%m%d)
```

### Autoscaling Considerations

- Neon auto-scales compute
- Cold starts may occur after idle
- Connection pooling handles reconnection

### Limits to Monitor

| Resource | Free Tier | Pro Tier |
|----------|-----------|----------|
| Storage | 512 MB | 50 GB |
| Compute Hours | 100/month | 300/month |
| Branches | 10 | Unlimited |
| Connections | 100 | 500 |

---

## 5. Verification Checklist

### After Running All Scripts

#### Indexes Created
```sql
SELECT 
    tablename, 
    indexname, 
    indexdef 
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND indexname LIKE 'idx_%'
ORDER BY tablename;
```

Expected: 10-15 new indexes for Message, GiftSend, WalletTransaction, etc.

#### Triggers Active
```sql
SELECT 
    trigger_name, 
    event_object_table 
FROM information_schema.triggers 
WHERE trigger_schema = 'public'
ORDER BY event_object_table;
```

Expected: One `trg_xxx_updated_at` per table with `updatedAt` column

#### Constraints Added
```sql
SELECT 
    table_name, 
    constraint_name 
FROM information_schema.table_constraints 
WHERE constraint_type = 'CHECK' 
  AND constraint_name LIKE 'chk_%';
```

Expected: Constraints on Wallet, GiftSend, Room, Follow, User

#### Roles Created
```sql
SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname LIKE 'app_%';
```

Expected: app_user, app_readonly, app_admin

#### Audit Log Table
```sql
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'AuditLog' ORDER BY ordinal_position;
```

### Performance Verification

Run EXPLAIN ANALYZE on critical queries:

```sql
-- Should use idx_message_room_created_desc
EXPLAIN ANALYZE
SELECT * FROM "Message" 
WHERE "roomId" = (SELECT id FROM "Room" LIMIT 1)
ORDER BY "createdAt" DESC LIMIT 50;
```

Expected output includes: `Index Scan using idx_message_room_created_desc`

---

## 6. Rollback Strategy

### Rollback Indexes

```sql
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
```

### Rollback Triggers

```sql
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT trigger_name, event_object_table FROM information_schema.triggers
             WHERE trigger_schema = 'public' AND trigger_name LIKE 'trg_%_updated_at'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', r.trigger_name, r.event_object_table);
    END LOOP;
END $$;

DROP FUNCTION IF EXISTS update_updated_at_camel();
DROP FUNCTION IF EXISTS update_updated_at_snake();
```

### Rollback Constraints

```sql
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS chk_wallet_balance_non_negative;
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS chk_wallet_diamonds_non_negative;
ALTER TABLE "WalletTransaction" DROP CONSTRAINT IF EXISTS chk_wallet_tx_amount_nonzero;
ALTER TABLE "Gift" DROP CONSTRAINT IF EXISTS chk_gift_price_positive;
ALTER TABLE "GiftSend" DROP CONSTRAINT IF EXISTS chk_giftsend_quantity_positive;
ALTER TABLE "GiftSend" DROP CONSTRAINT IF EXISTS chk_giftsend_totalprice_positive;
ALTER TABLE "GiftSend" DROP CONSTRAINT IF EXISTS chk_giftsend_not_self;
ALTER TABLE "Room" DROP CONSTRAINT IF EXISTS chk_room_maxmembers_positive;
ALTER TABLE "Room" DROP CONSTRAINT IF EXISTS chk_room_currentmembers_valid;
ALTER TABLE "Follow" DROP CONSTRAINT IF EXISTS chk_follow_not_self;
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS chk_user_email_format;
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS chk_user_username_format;
```

### Rollback Roles

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_user, app_readonly, app_admin;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_user, app_readonly, app_admin;
REVOKE USAGE ON SCHEMA public FROM app_user, app_readonly, app_admin;
DROP ROLE IF EXISTS app_user;
DROP ROLE IF EXISTS app_readonly;
DROP ROLE IF EXISTS app_admin;
```

### Rollback Audit Log

```sql
DROP FUNCTION IF EXISTS audit_log(UUID, VARCHAR, VARCHAR, VARCHAR, JSONB, JSONB, JSONB, VARCHAR, TEXT);
DROP TABLE IF EXISTS "AuditLog" CASCADE;
```

### Full Rollback (Nuclear Option)

If everything goes wrong, restore from Neon branch:

1. Go to Neon Console
2. Delete current branch
3. Create new branch from backup branch
4. Update connection string if needed

---

## 7. Troubleshooting

### Index Creation Fails

```sql
-- Check for invalid indexes
SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE NOT indisvalid;

-- Drop and recreate
DROP INDEX CONCURRENTLY IF EXISTS index_name;
-- Then re-run creation
```

### Constraint Validation Fails

```sql
-- Find violating rows (example for wallet balance)
SELECT id, "userId", balance FROM "Wallet" WHERE balance < 0;

-- Fix data
UPDATE "Wallet" SET balance = 0 WHERE balance < 0;

-- Retry validation
ALTER TABLE "Wallet" VALIDATE CONSTRAINT chk_wallet_balance_non_negative;
```

### Connection Issues

```sql
-- Check active connections
SELECT COUNT(*), state FROM pg_stat_activity GROUP BY state;

-- Kill idle connections (careful!)
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE state = 'idle' 
  AND query_start < NOW() - INTERVAL '10 minutes'
  AND usename != 'neondb_owner';
```

### Slow Queries After Changes

```sql
-- Refresh statistics
ANALYZE;

-- Check query plan
EXPLAIN (ANALYZE, BUFFERS) SELECT ... your query ...;

-- Verify index is being used
SELECT indexname, idx_scan FROM pg_stat_user_indexes 
WHERE indexname = 'your_index_name';
```

---

## 8. Maintenance Schedule

### Daily (Automated if possible)

```sql
-- Cleanup expired tokens
DELETE FROM "RefreshToken" WHERE "expiresAt" < NOW() - INTERVAL '7 days';
```

### Weekly

```sql
-- Update statistics
ANALYZE;

-- Cleanup read notifications
DELETE FROM "Notification" WHERE "isRead" = true AND "createdAt" < NOW() - INTERVAL '30 days';
```

### Monthly

```sql
-- Full vacuum on high-traffic tables
VACUUM (ANALYZE) "Message";
VACUUM (ANALYZE) "Notification";
VACUUM (ANALYZE) "GiftSend";

-- Check for unused indexes
SELECT indexrelname, idx_scan FROM pg_stat_user_indexes 
WHERE idx_scan = 0 AND indexrelname NOT LIKE '%_pkey';

-- Check table bloat
SELECT relname, n_dead_tup, n_live_tup 
FROM pg_stat_user_tables 
WHERE n_dead_tup > n_live_tup * 0.1;
```

### Quarterly

- Review and optimize slow queries
- Check for index bloat
- Review storage growth
- Update retention policies if needed

---

## 📞 Support Resources

- **Neon Documentation**: https://neon.tech/docs
- **PostgreSQL Docs**: https://www.postgresql.org/docs/16/
- **Prisma Docs**: https://www.prisma.io/docs

---

*Last Updated: January 4, 2026*
*Version: 1.0*
