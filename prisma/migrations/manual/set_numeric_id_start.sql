-- تعيين قيمة بداية الـ numericId إلى 100 مليون
-- يجب تشغيل هذا الملف بعد تطبيق الـ migration

-- الحصول على اسم الـ sequence
-- عادة يكون: User_numericId_seq

-- تعيين القيمة البداية إلى 100 مليون
ALTER SEQUENCE "User_numericId_seq" RESTART WITH 100000000;

-- التحقق من القيمة الحالية
-- SELECT currval('"User_numericId_seq"');

-- ملاحظة: PostgreSQL autoincrement لا يُعيد استخدام الأرقام المحذوفة
-- كل مستخدم جديد سيحصل على رقم جديد تصاعدياً
