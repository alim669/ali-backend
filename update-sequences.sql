-- تحديث sequences للمستخدمين والغرف
-- هذا السكريبت يجب تشغيله على قاعدة البيانات

-- =============================================
-- 1. تحديث sequence للمستخدمين ليبدأ من 1114566536
-- =============================================

-- أولاً: الحصول على أعلى numericId موجود للمستخدمين
DO $$
DECLARE
    max_user_id BIGINT;
    new_start_value BIGINT := 1114566536;
BEGIN
    SELECT COALESCE(MAX("numericId"), 0) INTO max_user_id FROM "User";
    
    -- إذا كان أعلى ID أقل من القيمة الجديدة، نبدأ من القيمة الجديدة
    IF max_user_id < new_start_value THEN
        -- تحديث الـ sequence
        EXECUTE 'ALTER SEQUENCE "User_numericId_seq" RESTART WITH ' || new_start_value;
        RAISE NOTICE 'User sequence updated to start from %', new_start_value;
    ELSE
        -- إذا كان أعلى ID أكبر، نبدأ من ID + 1
        EXECUTE 'ALTER SEQUENCE "User_numericId_seq" RESTART WITH ' || (max_user_id + 1);
        RAISE NOTICE 'User sequence updated to start from % (existing max was higher)', max_user_id + 1;
    END IF;
END $$;

-- =============================================
-- 2. تحديث sequence للغرف ليبدأ من 111000
-- =============================================

DO $$
DECLARE
    max_room_id INT;
    new_start_value INT := 111000;
BEGIN
    SELECT COALESCE(MAX("numericId"), 0) INTO max_room_id FROM "Room";
    
    -- إذا كان أعلى ID أقل من القيمة الجديدة، نبدأ من القيمة الجديدة
    IF max_room_id < new_start_value THEN
        EXECUTE 'ALTER SEQUENCE "Room_numericId_seq" RESTART WITH ' || new_start_value;
        RAISE NOTICE 'Room sequence updated to start from %', new_start_value;
    ELSE
        EXECUTE 'ALTER SEQUENCE "Room_numericId_seq" RESTART WITH ' || (max_room_id + 1);
        RAISE NOTICE 'Room sequence updated to start from % (existing max was higher)', max_room_id + 1;
    END IF;
END $$;

-- =============================================
-- 3. التحقق من النتائج
-- =============================================

SELECT 'User' as table_name, 
       MIN("numericId") as min_id, 
       MAX("numericId") as max_id, 
       COUNT(*) as total_count
FROM "User"
UNION ALL
SELECT 'Room' as table_name, 
       MIN("numericId") as min_id, 
       MAX("numericId") as max_id, 
       COUNT(*) as total_count
FROM "Room";

-- عرض قيمة الـ sequence الحالية
SELECT 'User_numericId_seq' as sequence_name, last_value FROM "User_numericId_seq"
UNION ALL
SELECT 'Room_numericId_seq' as sequence_name, last_value FROM "Room_numericId_seq";
