-- ============================================================
-- 04_AUDIT_LOGS_SAFE.sql - Audit Logging (TABLE + FUNCTION ONLY)
-- ============================================================
-- EXECUTED: 2026-01-04 (Production Launch Prep)
-- SCOPE: Create infrastructure ONLY, no behavior change
-- ============================================================

-- ============================================================
-- STEP 1: CREATE AUDIT LOG TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS "AuditLog" (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "actorUserId"   UUID,
    "actorIp"       VARCHAR(45),
    "actorUserAgent" TEXT,
    action          VARCHAR(100) NOT NULL,
    "entityType"    VARCHAR(100) NOT NULL,
    "entityId"      VARCHAR(255),
    "oldData"       JSONB,
    "newData"       JSONB,
    metadata        JSONB,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "AuditLog" IS 'Audit log for security and compliance - Application-level only';

-- ============================================================
-- STEP 2: INDEXES FOR AUDIT LOG
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_auditlog_actor_created') THEN
        CREATE INDEX idx_auditlog_actor_created ON "AuditLog" ("actorUserId", "createdAt" DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_auditlog_entity_created') THEN
        CREATE INDEX idx_auditlog_entity_created ON "AuditLog" ("entityType", "entityId", "createdAt" DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_auditlog_action_created') THEN
        CREATE INDEX idx_auditlog_action_created ON "AuditLog" (action, "createdAt" DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_auditlog_created') THEN
        CREATE INDEX idx_auditlog_created ON "AuditLog" ("createdAt" DESC);
    END IF;
END $$;

-- ============================================================
-- STEP 3: HELPER FUNCTION (For backend use)
-- ============================================================

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
        "actorUserId", "actorIp", "actorUserAgent",
        action, "entityType", "entityId",
        "oldData", "newData", metadata
    ) VALUES (
        p_actor_user_id, p_actor_ip, p_actor_user_agent,
        p_action, p_entity_type, p_entity_id,
        p_old_data, p_new_data, p_metadata
    ) RETURNING id INTO v_log_id;
    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ⛔ NO AUTOMATIC TRIGGERS - By design
-- ============================================================
-- Audit logging will be done from NestJS backend for full context
-- (User IP, User Agent, Request ID, etc.)

SELECT 'AuditLog table and function created successfully' AS status;
