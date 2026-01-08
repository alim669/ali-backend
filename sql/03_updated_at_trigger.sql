-- ============================================================
-- 03_UPDATED_AT_TRIGGER.sql - Auto-Update Timestamp Trigger
-- ============================================================
-- PURPOSE: Automatically set updatedAt/updated_at on UPDATE
-- RISK/LOCK: LOW - Function and trigger creation are fast DDL
-- VERIFY: UPDATE a row and check that updatedAt changed
-- IDEMPOTENT: Yes - Uses CREATE OR REPLACE and DROP IF EXISTS
-- ============================================================

-- ============================================================
-- SECTION 1: CREATE GENERIC TRIGGER FUNCTIONS
-- ============================================================

-- Function for camelCase (updatedAt)
CREATE OR REPLACE FUNCTION update_updated_at_camel()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function for snake_case (updated_at)
CREATE OR REPLACE FUNCTION update_updated_at_snake()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SECTION 2: DETECT AND CREATE TRIGGERS FOR ALL TABLES
-- ============================================================

DO $$
DECLARE
    r RECORD;
    v_trigger_name TEXT;
    v_function_name TEXT;
    v_column_name TEXT;
BEGIN
    -- Loop through all tables with updatedAt or updated_at column
    FOR r IN 
        SELECT DISTINCT 
            c.table_name,
            c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t 
            ON c.table_name = t.table_name 
            AND c.table_schema = t.table_schema
        WHERE c.table_schema = 'public'
          AND c.column_name IN ('updatedAt', 'updated_at')
          AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_name
    LOOP
        v_trigger_name := 'trg_' || LOWER(r.table_name) || '_updated_at';
        
        -- Determine which function to use
        IF r.column_name = 'updatedAt' THEN
            v_function_name := 'update_updated_at_camel';
        ELSE
            v_function_name := 'update_updated_at_snake';
        END IF;
        
        -- Drop existing trigger if exists
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', v_trigger_name, r.table_name);
        
        -- Create new trigger
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION %I()',
            v_trigger_name,
            r.table_name,
            v_function_name
        );
        
        RAISE NOTICE 'Created trigger % on table % (column: %)', v_trigger_name, r.table_name, r.column_name;
    END LOOP;
    
    RAISE NOTICE 'Trigger creation complete.';
END $$;

-- ============================================================
-- SECTION 3: VERIFICATION
-- ============================================================

SELECT '=== CREATED TRIGGERS ===' AS section;

SELECT 
    trigger_name,
    event_object_table AS table_name,
    action_timing,
    event_manipulation,
    action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE 'trg_%_updated_at'
ORDER BY event_object_table;

-- ============================================================
-- SECTION 4: TEST (Optional - Uncomment to test)
-- ============================================================

/*
-- Test on User table (if exists)
DO $$
DECLARE
    v_user_id UUID;
    v_old_updated TIMESTAMP;
    v_new_updated TIMESTAMP;
BEGIN
    -- Get a user
    SELECT id, "updatedAt" INTO v_user_id, v_old_updated
    FROM "User"
    LIMIT 1;
    
    IF v_user_id IS NOT NULL THEN
        -- Wait a bit
        PERFORM pg_sleep(0.1);
        
        -- Update user
        UPDATE "User" SET bio = COALESCE(bio, '') || '' WHERE id = v_user_id;
        
        -- Check new timestamp
        SELECT "updatedAt" INTO v_new_updated FROM "User" WHERE id = v_user_id;
        
        IF v_new_updated > v_old_updated THEN
            RAISE NOTICE 'SUCCESS: updatedAt changed from % to %', v_old_updated, v_new_updated;
        ELSE
            RAISE WARNING 'FAIL: updatedAt did not change';
        END IF;
    ELSE
        RAISE NOTICE 'No users to test with';
    END IF;
END $$;
*/

-- ============================================================
-- ROLLBACK COMMANDS
-- ============================================================
/*
-- Drop all updatedAt triggers
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT trigger_name, event_object_table
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
          AND trigger_name LIKE 'trg_%_updated_at'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', r.trigger_name, r.event_object_table);
        RAISE NOTICE 'Dropped trigger %', r.trigger_name;
    END LOOP;
END $$;

-- Drop functions
DROP FUNCTION IF EXISTS update_updated_at_camel();
DROP FUNCTION IF EXISTS update_updated_at_snake();
*/
