-- ============================================================
-- 06_CONSTRAINTS_NOT_VALID.sql - Add Constraints WITHOUT Validation
-- ============================================================
-- EXECUTED: 2026-01-04 (Production Launch Prep)
-- SCOPE: Add CHECK constraints as NOT VALID only
-- ⚠️ VALIDATE will be run LATER after launch stabilizes
-- ============================================================

-- Helper functions
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
-- WALLET: balance >= 0
-- ============================================================
DO $$
BEGIN
    IF pg_temp.table_exists('Wallet') AND pg_temp.column_exists('Wallet', 'balance') THEN
        IF NOT pg_temp.constraint_exists('Wallet', 'chk_wallet_balance_non_negative') THEN
            ALTER TABLE "Wallet" ADD CONSTRAINT chk_wallet_balance_non_negative 
                CHECK (balance >= 0) NOT VALID;
            RAISE NOTICE 'ADDED (NOT VALID): chk_wallet_balance_non_negative';
        ELSE
            RAISE NOTICE 'SKIP: chk_wallet_balance_non_negative already exists';
        END IF;
    END IF;
END $$;

-- ============================================================
-- WALLET: diamonds >= 0
-- ============================================================
DO $$
BEGIN
    IF pg_temp.table_exists('Wallet') AND pg_temp.column_exists('Wallet', 'diamonds') THEN
        IF NOT pg_temp.constraint_exists('Wallet', 'chk_wallet_diamonds_non_negative') THEN
            ALTER TABLE "Wallet" ADD CONSTRAINT chk_wallet_diamonds_non_negative 
                CHECK (diamonds >= 0) NOT VALID;
            RAISE NOTICE 'ADDED (NOT VALID): chk_wallet_diamonds_non_negative';
        ELSE
            RAISE NOTICE 'SKIP: chk_wallet_diamonds_non_negative already exists';
        END IF;
    END IF;
END $$;

-- ============================================================
-- WALLET TRANSACTION: amount != 0
-- ============================================================
DO $$
BEGIN
    IF pg_temp.table_exists('WalletTransaction') AND pg_temp.column_exists('WalletTransaction', 'amount') THEN
        IF NOT pg_temp.constraint_exists('WalletTransaction', 'chk_wallet_tx_amount_nonzero') THEN
            ALTER TABLE "WalletTransaction" ADD CONSTRAINT chk_wallet_tx_amount_nonzero 
                CHECK (amount != 0) NOT VALID;
            RAISE NOTICE 'ADDED (NOT VALID): chk_wallet_tx_amount_nonzero';
        ELSE
            RAISE NOTICE 'SKIP: chk_wallet_tx_amount_nonzero already exists';
        END IF;
    END IF;
END $$;

-- ============================================================
-- GIFT: price > 0
-- ============================================================
DO $$
BEGIN
    IF pg_temp.table_exists('Gift') AND pg_temp.column_exists('Gift', 'price') THEN
        IF NOT pg_temp.constraint_exists('Gift', 'chk_gift_price_positive') THEN
            ALTER TABLE "Gift" ADD CONSTRAINT chk_gift_price_positive 
                CHECK (price > 0) NOT VALID;
            RAISE NOTICE 'ADDED (NOT VALID): chk_gift_price_positive';
        ELSE
            RAISE NOTICE 'SKIP: chk_gift_price_positive already exists';
        END IF;
    END IF;
END $$;

-- ============================================================
-- GIFT SEND: quantity >= 1
-- ============================================================
DO $$
BEGIN
    IF pg_temp.table_exists('GiftSend') AND pg_temp.column_exists('GiftSend', 'quantity') THEN
        IF NOT pg_temp.constraint_exists('GiftSend', 'chk_giftsend_quantity_positive') THEN
            ALTER TABLE "GiftSend" ADD CONSTRAINT chk_giftsend_quantity_positive 
                CHECK (quantity >= 1) NOT VALID;
            RAISE NOTICE 'ADDED (NOT VALID): chk_giftsend_quantity_positive';
        ELSE
            RAISE NOTICE 'SKIP: chk_giftsend_quantity_positive already exists';
        END IF;
    END IF;
END $$;

-- ============================================================
-- GIFT SEND: totalPrice > 0
-- ============================================================
DO $$
BEGIN
    IF pg_temp.table_exists('GiftSend') AND pg_temp.column_exists('GiftSend', 'totalPrice') THEN
        IF NOT pg_temp.constraint_exists('GiftSend', 'chk_giftsend_totalprice_positive') THEN
            ALTER TABLE "GiftSend" ADD CONSTRAINT chk_giftsend_totalprice_positive 
                CHECK ("totalPrice" > 0) NOT VALID;
            RAISE NOTICE 'ADDED (NOT VALID): chk_giftsend_totalprice_positive';
        ELSE
            RAISE NOTICE 'SKIP: chk_giftsend_totalprice_positive already exists';
        END IF;
    END IF;
END $$;

-- ============================================================
-- GIFT SEND: sender != receiver
-- ============================================================
DO $$
BEGIN
    IF pg_temp.table_exists('GiftSend') 
       AND pg_temp.column_exists('GiftSend', 'senderId') 
       AND pg_temp.column_exists('GiftSend', 'receiverId') THEN
        IF NOT pg_temp.constraint_exists('GiftSend', 'chk_giftsend_not_self') THEN
            ALTER TABLE "GiftSend" ADD CONSTRAINT chk_giftsend_not_self 
                CHECK ("senderId" != "receiverId") NOT VALID;
            RAISE NOTICE 'ADDED (NOT VALID): chk_giftsend_not_self';
        ELSE
            RAISE NOTICE 'SKIP: chk_giftsend_not_self already exists';
        END IF;
    END IF;
END $$;

-- ============================================================
-- FOLLOW: follower != following
-- ============================================================
DO $$
BEGIN
    IF pg_temp.table_exists('Follow') 
       AND pg_temp.column_exists('Follow', 'followerId') 
       AND pg_temp.column_exists('Follow', 'followingId') THEN
        IF NOT pg_temp.constraint_exists('Follow', 'chk_follow_not_self') THEN
            ALTER TABLE "Follow" ADD CONSTRAINT chk_follow_not_self 
                CHECK ("followerId" != "followingId") NOT VALID;
            RAISE NOTICE 'ADDED (NOT VALID): chk_follow_not_self';
        ELSE
            RAISE NOTICE 'SKIP: chk_follow_not_self already exists';
        END IF;
    END IF;
END $$;

-- ============================================================
-- ROOM: maxMembers >= 1
-- ============================================================
DO $$
BEGIN
    IF pg_temp.table_exists('Room') AND pg_temp.column_exists('Room', 'maxMembers') THEN
        IF NOT pg_temp.constraint_exists('Room', 'chk_room_maxmembers_positive') THEN
            ALTER TABLE "Room" ADD CONSTRAINT chk_room_maxmembers_positive 
                CHECK ("maxMembers" >= 1) NOT VALID;
            RAISE NOTICE 'ADDED (NOT VALID): chk_room_maxmembers_positive';
        ELSE
            RAISE NOTICE 'SKIP: chk_room_maxmembers_positive already exists';
        END IF;
    END IF;
END $$;

-- ============================================================
-- ⛔ NO VALIDATE CONSTRAINT - Will be done post-launch
-- ============================================================

SELECT 'Constraints added as NOT VALID - Ready for launch' AS status;
