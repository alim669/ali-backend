-- تعيين بداية numericId للمستخدمين الجدد إلى 1682805400
-- يُشغّل مرة واحدة على قاعدة البيانات

-- 1. تعيين قيمة الـ sequence إلى 1682805400
ALTER SEQUENCE "User_numericId_seq" RESTART WITH 1682805400;

-- 2. التحقق من القيمة الجديدة
SELECT last_value, is_called FROM "User_numericId_seq";

-- ملاحظة: المستخدمون الحاليون سيحتفظون بـ numericId الخاص بهم
-- فقط المستخدمون الجدد سيبدأون من 1682805400
