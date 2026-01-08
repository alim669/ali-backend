-- ============================================================
-- 05_SECURITY_PERMISSIONS.sql - Database Security & Roles
-- ============================================================
-- PURPOSE: Set up proper database roles with least privilege access
-- RISK/LOCK: LOW - DDL operations on roles
-- VERIFY: SELECT rolname FROM pg_roles WHERE rolname LIKE 'app_%';
-- IDEMPOTENT: Yes - Checks if roles exist before creating
-- ============================================================
-- ⚠️ NEON.TECH CONSIDERATIONS:
--    - Neon provides a default owner role (neondb_owner)
--    - Connection pooling is built-in (pgBouncer)
--    - Creating additional roles is optional but recommended
--    - Test role changes in a branch first!
-- ============================================================

-- ============================================================
-- SECTION 1: REVOKE EXCESSIVE PUBLIC PRIVILEGES
-- ============================================================

-- Revoke default public access to public schema
-- This prevents any connected user from creating objects
DO $$
BEGIN
    EXECUTE 'REVOKE CREATE ON SCHEMA public FROM PUBLIC';
    RAISE NOTICE 'Revoked CREATE on schema public from PUBLIC';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not revoke CREATE from PUBLIC: %', SQLERRM;
END $$;

-- Keep USAGE for now (needed for queries)
-- REVOKE USAGE ON SCHEMA public FROM PUBLIC; -- Uncomment if you want strict isolation

-- ============================================================
-- SECTION 2: CREATE APPLICATION ROLE (app_user)
-- ============================================================
-- This role should be used by the NestJS application
-- It has SELECT, INSERT, UPDATE, DELETE but NOT:
-- - DROP, TRUNCATE, ALTER (schema changes)
-- - SUPERUSER privileges

DO $$
BEGIN
    -- Check if role exists
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        -- Create the role with login capability
        CREATE ROLE app_user WITH 
            LOGIN 
            PASSWORD 'CHANGE_THIS_SECURE_PASSWORD_123!' 
            NOSUPERUSER 
            NOCREATEDB 
            NOCREATEROLE
            CONNECTION LIMIT 50;
        RAISE NOTICE 'Created role: app_user';
    ELSE
        RAISE NOTICE 'Role app_user already exists';
    END IF;
END $$;

-- Grant connect to database
DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
    RAISE NOTICE 'Granted CONNECT to app_user';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not grant CONNECT: %', SQLERRM;
END $$;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO app_user;

-- Grant table permissions (CRUD only, no DDL)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- Grant sequence usage (for auto-increment)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Grant execute on functions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;

-- Set default privileges for FUTURE tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO app_user;

RAISE NOTICE 'Granted permissions to app_user';

-- ============================================================
-- SECTION 3: CREATE READ-ONLY ROLE (app_readonly)
-- ============================================================
-- For analytics, reporting, monitoring tools

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
        CREATE ROLE app_readonly WITH 
            LOGIN 
            PASSWORD 'CHANGE_THIS_READONLY_PASSWORD_456!' 
            NOSUPERUSER 
            NOCREATEDB 
            NOCREATEROLE
            CONNECTION LIMIT 20;
        RAISE NOTICE 'Created role: app_readonly';
    ELSE
        RAISE NOTICE 'Role app_readonly already exists';
    END IF;
END $$;

-- Grant connect
DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_readonly', current_database());
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not grant CONNECT to app_readonly: %', SQLERRM;
END $$;

-- Grant read-only access
GRANT USAGE ON SCHEMA public TO app_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

-- Future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO app_readonly;

RAISE NOTICE 'Granted permissions to app_readonly';

-- ============================================================
-- SECTION 4: CREATE MIGRATION ROLE (app_admin)
-- ============================================================
-- For Prisma migrations and maintenance tasks

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
        CREATE ROLE app_admin WITH 
            LOGIN 
            PASSWORD 'CHANGE_THIS_ADMIN_PASSWORD_789!' 
            NOSUPERUSER 
            NOCREATEDB 
            NOCREATEROLE
            CONNECTION LIMIT 5;
        RAISE NOTICE 'Created role: app_admin';
    ELSE
        RAISE NOTICE 'Role app_admin already exists';
    END IF;
END $$;

-- Grant connect
DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_admin', current_database());
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not grant CONNECT to app_admin: %', SQLERRM;
END $$;

-- Grant full schema access for migrations
GRANT ALL ON SCHEMA public TO app_admin;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_admin;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO app_admin;

-- Future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON FUNCTIONS TO app_admin;

RAISE NOTICE 'Granted permissions to app_admin';

-- ============================================================
-- SECTION 5: NEON-SPECIFIC GUIDANCE
-- ============================================================

/*
NEON.TECH ROLE SETUP:

1. Your default owner is: neondb_owner
   - This role has full access
   - Use for Prisma migrations and emergencies only

2. For production application:
   - Create app_user role (as above)
   - Update DATABASE_URL in .env to use app_user
   
3. Connection string format:
   DATABASE_URL="postgresql://app_user:PASSWORD@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require&connection_limit=5"

4. IMPORTANT: Use the -pooler endpoint for application connections
   - pooler endpoint: ep-xxx-pooler.region.aws.neon.tech (has built-in pgBouncer)
   - direct endpoint: ep-xxx.region.aws.neon.tech (for migrations)

5. Changing passwords:
   ALTER ROLE app_user WITH PASSWORD 'new_password';

6. Testing in Neon Branch:
   - Create a branch for testing security changes
   - Apply scripts to branch first
   - Merge when confident
*/

-- ============================================================
-- SECTION 6: ROW LEVEL SECURITY (RLS) - Optional Advanced
-- ============================================================
-- Uncomment if you need data isolation at database level

/*
-- Enable RLS on Wallet (users can only access their own)
ALTER TABLE "Wallet" ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own wallet
CREATE POLICY wallet_isolation ON "Wallet"
    FOR ALL
    USING ("userId"::text = current_setting('app.current_user_id', true));

-- To use RLS, set the user ID before queries:
-- SET app.current_user_id = 'user-uuid-here';

-- Enable RLS on Notification
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_isolation ON "Notification"
    FOR ALL
    USING ("userId"::text = current_setting('app.current_user_id', true));

-- IMPORTANT: RLS is bypassed for table owners and superusers
-- Force RLS even for owner:
-- ALTER TABLE "Wallet" FORCE ROW LEVEL SECURITY;
*/

-- ============================================================
-- SECTION 7: VERIFICATION
-- ============================================================

SELECT '=== ROLES ===' AS section;

SELECT 
    rolname,
    rolcanlogin,
    rolsuper,
    rolcreatedb,
    rolcreaterole,
    rolconnlimit
FROM pg_roles
WHERE rolname IN ('app_user', 'app_readonly', 'app_admin', 'neondb_owner')
ORDER BY rolname;

SELECT '=== ROLE PERMISSIONS ON TABLES ===' AS section;

SELECT 
    grantee,
    table_name,
    STRING_AGG(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('app_user', 'app_readonly', 'app_admin')
GROUP BY grantee, table_name
ORDER BY grantee, table_name
LIMIT 20;

-- ============================================================
-- SECTION 8: ROLLBACK COMMANDS
-- ============================================================

/*
-- Revoke all permissions
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_user;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_user;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM app_user;
REVOKE USAGE ON SCHEMA public FROM app_user;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_readonly;
REVOKE USAGE ON SCHEMA public FROM app_readonly;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_admin;
REVOKE ALL ON SCHEMA public FROM app_admin;

-- Drop roles (must disconnect first)
DROP ROLE IF EXISTS app_user;
DROP ROLE IF EXISTS app_readonly;
DROP ROLE IF EXISTS app_admin;

-- Restore public access (not recommended)
GRANT CREATE ON SCHEMA public TO PUBLIC;
*/
