-- ============================================
-- Fix: Add numericId to existing rooms
-- تطبيق على قاعدة بيانات الإنتاج
-- ============================================

-- 1. أولاً: إضافة العمود إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Room' AND column_name = 'numericId'
    ) THEN
        -- إضافة العمود
        ALTER TABLE "Room" ADD COLUMN "numericId" INTEGER;
        
        -- إنشاء الـ sequence
        CREATE SEQUENCE IF NOT EXISTS "Room_numericId_seq" START WITH 100200300 INCREMENT BY 1;
        
        -- ربط العمود بالـ sequence
        ALTER TABLE "Room" ALTER COLUMN "numericId" SET DEFAULT nextval('"Room_numericId_seq"');
        
        RAISE NOTICE 'تم إضافة عمود numericId';
    ELSE
        RAISE NOTICE 'عمود numericId موجود مسبقاً';
    END IF;
END $$;

-- 2. تحديث الغرف الموجودة التي ليس لها numericId
UPDATE "Room" 
SET "numericId" = nextval('"Room_numericId_seq"')
WHERE "numericId" IS NULL;

-- 3. جعل العمود NOT NULL وإضافة UNIQUE constraint
DO $$
BEGIN
    -- جعله NOT NULL
    ALTER TABLE "Room" ALTER COLUMN "numericId" SET NOT NULL;
    
    -- إضافة UNIQUE constraint إذا لم يكن موجوداً
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'Room_numericId_key'
    ) THEN
        ALTER TABLE "Room" ADD CONSTRAINT "Room_numericId_key" UNIQUE ("numericId");
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ملاحظة: %', SQLERRM;
END $$;

-- 4. عرض النتيجة
SELECT id, "numericId", name, "createdAt" 
FROM "Room" 
ORDER BY "numericId";
