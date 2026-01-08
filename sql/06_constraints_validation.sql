-- ============================================================
-- 06_CONSTRAINTS_VALIDATION.sql - Data Integrity Constraints
-- ============================================================
-- PURPOSE: Add CHECK constraints, UNIQUE constraints, and validate FKs
-- RISK/LOCK: MEDIUM - Uses NOT VALID to avoid full table scan, then VALIDATE
-- VERIFY: Query information_schema.check_constraints
-- IDEMPOTENT: Yes - Checks if constraints exist before adding
-- ============================================================
-- STRATEGY:
--   1. Add constraint with NOT VALID (instant, no lock)
--   2. VALIDATE CONSTRAINT in separate statement (reads table, no lock)
--   3. If validation fails, find violating rows and fix
-- ============================================================

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION pg_temp.constraint_exists(p_table TEXT, p_constraint TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = p_table
          AND constraint_name = p_constraint
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.column_exists(p_table TEXT, p_column TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = p_table
          AND column_name = p_column
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.table_exists(p_table TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = p_table
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SECTION 1: WALLET CONSTRAINTS
-- ============================================================

-- Balance >= 0
DO $$
BEGIN
    IF pg_temp.table_exists('Wallet') AND pg_temp.column_exists('Wallet', 'balance') THEN
        IF NOT pg_temp.constraint_exists('Wallet', 'chk_wallet_balance_non_negative') THEN
            -- Check for violations first
            IF EXISTS (SELECT 1 FROM "Wallet" WHERE balance < 0) THEN
                RAISE WARNING 'VIOLATION: Wallets with negative balance exist. Fix data first.';
                RAISE NOTICE 'Query: SELECT id, "userId", balance FROM "Wallet" WHERE balance < 0;';
            ELSE
                ALTER TABLE "Wallet" ADD CONSTRAINT chk_wallet_balance_non_negative CHECK (balance >= 0) NOT VALID;
                ALTER TABLE "Wallet" VALIDATE CONSTRAINT chk_wallet_balance_non_negative;
                RAISE NOTICE 'Added and validated: chk_wallet_balance_non_negative';
            END IF;
        ELSE
            RAISE NOTICE 'SKIP: chk_wallet_balance_non_negative already exists';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: Wallet.balance column not found';
    END IF;
END $$;

-- Diamonds >= 0
DO $$
BEGIN
    IF pg_temp.table_exists('Wallet') AND pg_temp.column_exists('Wallet', 'diamonds') THEN
        IF NOT pg_temp.constraint_exists('Wallet', 'chk_wallet_diamonds_non_negative') THEN
            IF EXISTS (SELECT 1 FROM "Wallet" WHERE diamonds < 0) THEN
                RAISE WARNING 'VIOLATION: Wallets with negative diamonds exist. Fix data first.';
                RAISE NOTICE 'Query: SELECT id, "userId", diamonds FROM "Wallet" WHERE diamonds < 0;';
            ELSE
                ALTER TABLE "Wallet" ADD CONSTRAINT chk_wallet_diamonds_non_negative CHECK (diamonds >= 0) NOT VALID;
                ALTER TABLE "Wallet" VALIDATE CONSTRAINT chk_wallet_diamonds_non_negative;
                RAISE NOTICE 'Added and validated: chk_wallet_diamonds_non_negative';
            END IF;
        ELSE
            RAISE NOTICE 'SKIP: chk_wallet_diamonds_non_negative already exists';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: Wallet.diamonds column not found';
    END IF;
END $$;

-- ============================================================
-- SECTION 2: WALLET TRANSACTION CONSTRAINTS
-- ============================================================

-- Amount != 0
DO $$
BEGIN
    IF pg_temp.table_exists('WalletTransaction') AND pg_temp.column_exists('WalletTransaction', 'amount') THEN
        IF NOT pg_temp.constraint_exists('WalletTransaction', 'chk_wallet_tx_amount_nonzero') THEN
            IF EXISTS (SELECT 1 FROM "WalletTransaction" WHERE amount = 0) THEN
                RAISE WARNING 'VIOLATION: WalletTransactions with zero amount exist.';
                RAISE NOTICE 'Query: SELECT id, "walletId", amount FROM "WalletTransaction" WHERE amount = 0;';
            ELSE
                ALTER TABLE "WalletTransaction" ADD CONSTRAINT chk_wallet_tx_amount_nonzero CHECK (amount != 0) NOT VALID;
                ALTER TABLE "WalletTransaction" VALIDATE CONSTRAINT chk_wallet_tx_amount_nonzero;
                RAISE NOTICE 'Added and validated: chk_wallet_tx_amount_nonzero';
            END IF;
        ELSE
            RAISE NOTICE 'SKIP: chk_wallet_tx_amount_nonzero already exists';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: WalletTransaction.amount column not found';
    END IF;
END $$;

-- ============================================================
-- SECTION 3: GIFT CONSTRAINTS
-- ============================================================

-- Gift price > 0
DO $$
BEGIN
    IF pg_temp.table_exists('Gift') AND pg_temp.column_exists('Gift', 'price') THEN
        IF NOT pg_temp.constraint_exists('Gift', 'chk_gift_price_positive') THEN
            IF EXISTS (SELECT 1 FROM "Gift" WHERE price <= 0) THEN
                RAISE WARNING 'VIOLATION: Gifts with non-positive price exist.';
                RAISE NOTICE 'Query: SELECT id, name, price FROM "Gift" WHERE price <= 0;';
            ELSE
                ALTER TABLE "Gift" ADD CONSTRAINT chk_gift_price_positive CHECK (price > 0) NOT VALID;
                ALTER TABLE "Gift" VALIDATE CONSTRAINT chk_gift_price_positive;
                RAISE NOTICE 'Added and validated: chk_gift_price_positive';
            END IF;
        ELSE
            RAISE NOTICE 'SKIP: chk_gift_price_positive already exists';
        END IF;
    ELSE
        RAISE NOTICE 'SKIP: Gift.price column not found';
    END IF;
END $$;

-- ============================================================
-- SECTION 4: GIFT SEND CONSTRAINTS
-- ============================================================

-- Quantity >= 1
DO $$
BEGIN
    IF pg_temp.table_exists('GiftSend') AND pg_temp.column_exists('GiftSend', 'quantity') THEN
        IF NOT pg_temp.constraint_exists('GiftSend', 'chk_giftsend_quantity_positive') THEN
            IF EXISTS (SELECT 1 FROM "GiftSend" WHERE quantity < 1) THEN
                RAISE WARNING 'VIOLATION: GiftSends with quantity < 1 exist.';
            ELSE
                ALTER TABLE "GiftSend" ADD CONSTRAINT chk_giftsend_quantity_positive CHECK (quantity >= 1) NOT VALID;
                ALTER TABLE "GiftSend" VALIDATE CONSTRAINT chk_giftsend_quantity_positive;
                RAISE NOTICE 'Added and validated: chk_giftsend_quantity_positive';
            END IF;
        ELSE
            RAISE NOTICE 'SKIP: chk_giftsend_quantity_positive already exists';
        END IF;
    END IF;
END $$;

-- Total price > 0
DO $$
BEGIN
    IF pg_temp.table_exists('GiftSend') AND pg_temp.column_exists('GiftSend', 'totalPrice') THEN
        IF NOT pg_temp.constraint_exists('GiftSend', 'chk_giftsend_totalprice_positive') THEN
            IF EXISTS (SELECT 1 FROM "GiftSend" WHERE "totalPrice" <= 0) THEN
                RAISE WARNING 'VIOLATION: GiftSends with non-positive totalPrice exist.';
            ELSE
                ALTER TABLE "GiftSend" ADD CONSTRAINT chk_giftsend_totalprice_positive CHECK ("totalPrice" > 0) NOT VALID;
                ALTER TABLE "GiftSend" VALIDATE CONSTRAINT chk_giftsend_totalprice_positive;
                RAISE NOTICE 'Added and validated: chk_giftsend_totalprice_positive';
            END IF;
        ELSE
            RAISE NOTICE 'SKIP: chk_giftsend_totalprice_positive already exists';
        END IF;
    END IF;
END $$;

-- Cannot gift to yourself
DO $$
BEGIN
    IF pg_temp.table_exists('GiftSend') 
       AND pg_temp.column_exists('GiftSend', 'senderId') 
       AND pg_temp.column_exists('GiftSend', 'receiverId') THEN
        IF NOT pg_temp.constraint_exists('GiftSend', 'chk_giftsend_not_self') THEN
            IF EXISTS (SELECT 1 FROM "GiftSend" WHERE "senderId" = "receiverId") THEN
                RAISE WARNING 'VIOLATION: Self-gifts exist. These need to be reviewed.';
                RAISE NOTICE 'Query: SELECT id, "senderId", "receiverId" FROM "GiftSend" WHERE "senderId" = "receiverId";';
            ELSE
                ALTER TABLE "GiftSend" ADD CONSTRAINT chk_giftsend_not_self CHECK ("senderId" != "receiverId") NOT VALID;
                ALTER TABLE "GiftSend" VALIDATE CONSTRAINT chk_giftsend_not_self;
                RAISE NOTICE 'Added and validated: chk_giftsend_not_self';
            END IF;
        ELSE
            RAISE NOTICE 'SKIP: chk_giftsend_not_self already exists';
        END IF;
    END IF;
END $$;

-- ============================================================
-- SECTION 5: ROOM CONSTRAINTS
-- ============================================================

-- Max members > 0
DO $$
BEGIN
    IF pg_temp.table_exists('Room') AND pg_temp.column_exists('Room', 'maxMembers') THEN
        IF NOT pg_temp.constraint_exists('Room', 'chk_room_maxmembers_positive') THEN
            IF EXISTS (SELECT 1 FROM "Room" WHERE "maxMembers" <= 0) THEN
                RAISE WARNING 'VIOLATION: Rooms with non-positive maxMembers exist.';
            ELSE
                ALTER TABLE "Room" ADD CONSTRAINT chk_room_maxmembers_positive CHECK ("maxMembers" > 0) NOT VALID;
                ALTER TABLE "Room" VALIDATE CONSTRAINT chk_room_maxmembers_positive;
                RAISE NOTICE 'Added and validated: chk_room_maxmembers_positive';
            END IF;
        ELSE
            RAISE NOTICE 'SKIP: chk_room_maxmembers_positive already exists';
        END IF;
    END IF;
END $$;

-- Current members within bounds
DO $$
BEGIN
    IF pg_temp.table_exists('Room') 
       AND pg_temp.column_exists('Room', 'currentMembers') 
       AND pg_temp.column_exists('Room', 'maxMembers') THEN
        IF NOT pg_temp.constraint_exists('Room', 'chk_room_currentmembers_valid') THEN
            IF EXISTS (SELECT 1 FROM "Room" WHERE "currentMembers" < 0 OR "currentMembers" > "maxMembers") THEN
                RAISE WARNING 'VIOLATION: Rooms with invalid currentMembers exist.';
                RAISE NOTICE 'Query: SELECT id, name, "currentMembers", "maxMembers" FROM "Room" WHERE "currentMembers" < 0 OR "currentMembers" > "maxMembers";';
            ELSE
                ALTER TABLE "Room" ADD CONSTRAINT chk_room_currentmembers_valid CHECK ("currentMembers" >= 0 AND "currentMembers" <= "maxMembers") NOT VALID;
                ALTER TABLE "Room" VALIDATE CONSTRAINT chk_room_currentmembers_valid;
                RAISE NOTICE 'Added and validated: chk_room_currentmembers_valid';
            END IF;
        ELSE
            RAISE NOTICE 'SKIP: chk_room_currentmembers_valid already exists';
        END IF;
    END IF;
END $$;

-- ============================================================
-- SECTION 6: FOLLOW CONSTRAINTS
-- ============================================================

-- Cannot follow yourself
DO $$
BEGIN
    IF pg_temp.table_exists('Follow') 
       AND pg_temp.column_exists('Follow', 'followerId') 
       AND pg_temp.column_exists('Follow', 'followingId') THEN
        IF NOT pg_temp.constraint_exists('Follow', 'chk_follow_not_self') THEN
            IF EXISTS (SELECT 1 FROM "Follow" WHERE "followerId" = "followingId") THEN
                RAISE WARNING 'VIOLATION: Self-follows exist.';
                RAISE NOTICE 'Query: SELECT id, "followerId" FROM "Follow" WHERE "followerId" = "followingId";';
                RAISE NOTICE 'Fix: DELETE FROM "Follow" WHERE "followerId" = "followingId";';
            ELSE
                ALTER TABLE "Follow" ADD CONSTRAINT chk_follow_not_self CHECK ("followerId" != "followingId") NOT VALID;
                ALTER TABLE "Follow" VALIDATE CONSTRAINT chk_follow_not_self;
                RAISE NOTICE 'Added and validated: chk_follow_not_self';
            END IF;
        ELSE
            RAISE NOTICE 'SKIP: chk_follow_not_self already exists';
        END IF;
    END IF;
END $$;

-- ============================================================
-- SECTION 7: USER CONSTRAINTS (Email/Username validation)
-- ============================================================

-- Email format (basic regex)
DO $$
BEGIN
    IF pg_temp.table_exists('User') AND pg_temp.column_exists('User', 'email') THEN
        IF NOT pg_temp.constraint_exists('User', 'chk_user_email_format') THEN
            -- Check for invalid emails
            IF EXISTS (SELECT 1 FROM "User" WHERE email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') THEN
                RAISE WARNING 'VIOLATION: Users with invalid email format exist.';
                RAISE NOTICE 'Query: SELECT id, email FROM "User" WHERE email !~* ''^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'';';
            ELSE
                ALTER TABLE "User" ADD CONSTRAINT chk_user_email_format 
                    CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') NOT VALID;
                ALTER TABLE "User" VALIDATE CONSTRAINT chk_user_email_format;
                RAISE NOTICE 'Added and validated: chk_user_email_format';
            END IF;
        ELSE
            RAISE NOTICE 'SKIP: chk_user_email_format already exists';
        END IF;
    END IF;
END $$;

-- Username format (alphanumeric, underscore, 3-30 chars)
DO $$
BEGIN
    IF pg_temp.table_exists('User') AND pg_temp.column_exists('User', 'username') THEN
        IF NOT pg_temp.constraint_exists('User', 'chk_user_username_format') THEN
            IF EXISTS (SELECT 1 FROM "User" WHERE username !~* '^[a-zA-Z0-9_]{3,30}$') THEN
                RAISE WARNING 'VIOLATION: Users with invalid username format exist.';
                RAISE NOTICE 'Query: SELECT id, username FROM "User" WHERE username !~* ''^[a-zA-Z0-9_]{3,30}$'';';
            ELSE
                ALTER TABLE "User" ADD CONSTRAINT chk_user_username_format 
                    CHECK (username ~* '^[a-zA-Z0-9_]{3,30}$') NOT VALID;
                ALTER TABLE "User" VALIDATE CONSTRAINT chk_user_username_format;
                RAISE NOTICE 'Added and validated: chk_user_username_format';
            END IF;
        ELSE
            RAISE NOTICE 'SKIP: chk_user_username_format already exists';
        END IF;
    END IF;
END $$;

-- ============================================================
-- SECTION 8: VERIFICATION
-- ============================================================

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
  AND tc.constraint_name LIKE 'chk_%'
ORDER BY tc.table_name, tc.constraint_name;

-- ============================================================
-- SECTION 9: ROLLBACK COMMANDS
-- ============================================================

/*
-- Wallet
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS chk_wallet_balance_non_negative;
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS chk_wallet_diamonds_non_negative;

-- WalletTransaction
ALTER TABLE "WalletTransaction" DROP CONSTRAINT IF EXISTS chk_wallet_tx_amount_nonzero;

-- Gift
ALTER TABLE "Gift" DROP CONSTRAINT IF EXISTS chk_gift_price_positive;

-- GiftSend
ALTER TABLE "GiftSend" DROP CONSTRAINT IF EXISTS chk_giftsend_quantity_positive;
ALTER TABLE "GiftSend" DROP CONSTRAINT IF EXISTS chk_giftsend_totalprice_positive;
ALTER TABLE "GiftSend" DROP CONSTRAINT IF EXISTS chk_giftsend_not_self;

-- Room
ALTER TABLE "Room" DROP CONSTRAINT IF EXISTS chk_room_maxmembers_positive;
ALTER TABLE "Room" DROP CONSTRAINT IF EXISTS chk_room_currentmembers_valid;

-- Follow
ALTER TABLE "Follow" DROP CONSTRAINT IF EXISTS chk_follow_not_self;

-- User
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS chk_user_email_format;
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS chk_user_username_format;
*/
