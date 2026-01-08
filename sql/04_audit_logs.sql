-- ============================================================
-- 04_AUDIT_LOGS.sql - Audit Logging System
-- ============================================================
-- PURPOSE: Track all important changes for security and compliance
-- RISK/LOCK: LOW - Creates new table, no impact on existing tables
-- VERIFY: SELECT * FROM "AuditLog" LIMIT 10;
-- IDEMPOTENT: Yes - Uses IF NOT EXISTS
-- ============================================================

-- ============================================================
-- SECTION 1: CREATE AUDIT LOG TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS "AuditLog" (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "actorUserId"   UUID,                                   -- Who performed the action (NULL for system)
    "actorIp"       VARCHAR(45),                            -- IPv4/IPv6 address
    "actorUserAgent" TEXT,                                  -- Browser/client info
    action          VARCHAR(100) NOT NULL,                  -- CREATE, UPDATE, DELETE, LOGIN, etc.
    "entityType"    VARCHAR(100) NOT NULL,                  -- Table/entity name
    "entityId"      VARCHAR(255),                           -- Primary key of affected row
    "oldData"       JSONB,                                  -- Previous state (UPDATE/DELETE)
    "newData"       JSONB,                                  -- New state (CREATE/UPDATE)
    metadata        JSONB,                                  -- Additional context
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add comment for documentation
COMMENT ON TABLE "AuditLog" IS 'Tracks all important changes for security and compliance auditing';

-- ============================================================
-- SECTION 2: INDEXES FOR AUDIT LOG
-- ============================================================

-- Index: By actor (who did what)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_auditlog_actor_created') THEN
        CREATE INDEX idx_auditlog_actor_created ON "AuditLog" ("actorUserId", "createdAt" DESC);
        RAISE NOTICE 'Created idx_auditlog_actor_created';
    END IF;
END $$;

-- Index: By entity (what happened to X)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_auditlog_entity_created') THEN
        CREATE INDEX idx_auditlog_entity_created ON "AuditLog" ("entityType", "entityId", "createdAt" DESC);
        RAISE NOTICE 'Created idx_auditlog_entity_created';
    END IF;
END $$;

-- Index: By action type
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_auditlog_action_created') THEN
        CREATE INDEX idx_auditlog_action_created ON "AuditLog" (action, "createdAt" DESC);
        RAISE NOTICE 'Created idx_auditlog_action_created';
    END IF;
END $$;

-- Index: Time-based queries
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_auditlog_created') THEN
        CREATE INDEX idx_auditlog_created ON "AuditLog" ("createdAt" DESC);
        RAISE NOTICE 'Created idx_auditlog_created';
    END IF;
END $$;

-- ============================================================
-- SECTION 3: HELPER FUNCTION FOR APPLICATION-LEVEL LOGGING
-- ============================================================
-- RECOMMENDED: Use this from your NestJS backend for full control

CREATE OR REPLACE FUNCTION audit_log(
    p_actor_user_id UUID,
    p_action VARCHAR(100),
    p_entity_type VARCHAR(100),
    p_entity_id VARCHAR(255) DEFAULT NULL,
    p_old_data JSONB DEFAULT NULL,
    p_new_data JSONB DEFAULT NULL,
    p_metadata JSONB DEFAULT NULL,
    p_actor_ip VARCHAR(45) DEFAULT NULL,
    p_actor_user_agent TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO "AuditLog" (
        "actorUserId",
        "actorIp",
        "actorUserAgent",
        action,
        "entityType",
        "entityId",
        "oldData",
        "newData",
        metadata
    ) VALUES (
        p_actor_user_id,
        p_actor_ip,
        p_actor_user_agent,
        p_action,
        p_entity_type,
        p_entity_id,
        p_old_data,
        p_new_data,
        p_metadata
    ) RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION audit_log IS 'Helper function to insert audit log entries from application code';

-- ============================================================
-- SECTION 4: USAGE EXAMPLES
-- ============================================================

/*
-- Example: Log a user login
SELECT audit_log(
    'user-uuid-here'::uuid,
    'LOGIN',
    'User',
    'user-uuid-here',
    NULL,
    NULL,
    '{"method": "password"}'::jsonb,
    '192.168.1.1',
    'Mozilla/5.0...'
);

-- Example: Log a wallet update
SELECT audit_log(
    'admin-uuid-here'::uuid,
    'UPDATE',
    'Wallet',
    'wallet-uuid-here',
    '{"balance": 100}'::jsonb,
    '{"balance": 200}'::jsonb,
    '{"reason": "Admin adjustment"}'::jsonb,
    '10.0.0.1',
    'Admin Panel'
);

-- Example: Log a gift send
SELECT audit_log(
    'sender-uuid-here'::uuid,
    'CREATE',
    'GiftSend',
    'giftsend-uuid-here',
    NULL,
    '{"giftId": "...", "receiverId": "...", "amount": 50}'::jsonb,
    NULL,
    '192.168.1.1',
    'Mobile App'
);
*/

-- ============================================================
-- SECTION 5: OPTIONAL AUTOMATIC TRIGGERS (COMMENTED OUT)
-- ============================================================
-- ⚠️ WARNING: Automatic triggers add overhead to EVERY write operation.
-- ⚠️ They also cannot capture HTTP context (IP, User Agent).
-- ⚠️ Consider using application-level logging for most cases.
-- ⚠️ Use triggers ONLY for critical financial tables if needed.

/*
-- Generic audit trigger function (no user context)
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
    v_old_data JSONB;
    v_new_data JSONB;
    v_action TEXT;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        v_old_data := to_jsonb(OLD);
        v_new_data := NULL;
        v_action := 'DELETE';
        INSERT INTO "AuditLog" ("entityType", "entityId", action, "oldData")
        VALUES (TG_TABLE_NAME, OLD.id::text, v_action, v_old_data);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        v_old_data := to_jsonb(OLD);
        v_new_data := to_jsonb(NEW);
        v_action := 'UPDATE';
        -- Only log if data actually changed
        IF v_old_data IS DISTINCT FROM v_new_data THEN
            INSERT INTO "AuditLog" ("entityType", "entityId", action, "oldData", "newData")
            VALUES (TG_TABLE_NAME, NEW.id::text, v_action, v_old_data, v_new_data);
        END IF;
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        v_old_data := NULL;
        v_new_data := to_jsonb(NEW);
        v_action := 'CREATE';
        INSERT INTO "AuditLog" ("entityType", "entityId", action, "newData")
        VALUES (TG_TABLE_NAME, NEW.id::text, v_action, v_new_data);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply to Wallet table (critical financial data)
DROP TRIGGER IF EXISTS trg_audit_wallet ON "Wallet";
CREATE TRIGGER trg_audit_wallet
    AFTER INSERT OR UPDATE OR DELETE ON "Wallet"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- Apply to WalletTransaction table (critical financial data)
DROP TRIGGER IF EXISTS trg_audit_wallet_transaction ON "WalletTransaction";
CREATE TRIGGER trg_audit_wallet_transaction
    AFTER INSERT OR UPDATE OR DELETE ON "WalletTransaction"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- Apply to User table (security-sensitive)
DROP TRIGGER IF EXISTS trg_audit_user ON "User";
CREATE TRIGGER trg_audit_user
    AFTER INSERT OR UPDATE OR DELETE ON "User"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
*/

-- ============================================================
-- SECTION 6: TRADEOFFS EXPLANATION
-- ============================================================

/*
APPLICATION-LEVEL LOGGING (RECOMMENDED):
✅ Full control over what gets logged
✅ Access to HTTP context (IP, User Agent, JWT claims)
✅ No database overhead for non-audited operations
✅ Can be async (queue to background job)
✅ Can filter sensitive fields before logging
❌ Requires code in every service
❌ Developer discipline required

TRIGGER-BASED LOGGING:
✅ Automatic - never miss a change
✅ Works for direct DB modifications
✅ No code changes needed
❌ No access to application context
❌ Adds latency to every write
❌ Can cause issues with bulk operations
❌ Logs everything including system updates

HYBRID APPROACH (BEST):
- Use application-level for user actions (has context)
- Use triggers for critical financial tables (Wallet, WalletTransaction)
- Review audit logs regularly
*/

-- ============================================================
-- SECTION 7: VERIFICATION
-- ============================================================

SELECT '=== AUDIT LOG TABLE ===' AS section;

SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'AuditLog'
ORDER BY ordinal_position;

SELECT '=== AUDIT LOG INDEXES ===' AS section;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'AuditLog';

-- ============================================================
-- SECTION 8: ROLLBACK COMMANDS
-- ============================================================

/*
-- Remove triggers (if enabled)
DROP TRIGGER IF EXISTS trg_audit_wallet ON "Wallet";
DROP TRIGGER IF EXISTS trg_audit_wallet_transaction ON "WalletTransaction";
DROP TRIGGER IF EXISTS trg_audit_user ON "User";
DROP FUNCTION IF EXISTS audit_trigger_func();

-- Remove audit function
DROP FUNCTION IF EXISTS audit_log(UUID, VARCHAR, VARCHAR, VARCHAR, JSONB, JSONB, JSONB, VARCHAR, TEXT);

-- Remove table (CAUTION: loses all audit data!)
DROP TABLE IF EXISTS "AuditLog" CASCADE;
*/
