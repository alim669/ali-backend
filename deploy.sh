#!/bin/bash

# ============================================
# Deploy Script for Ali Backend
# تحديث السيرفر مع إضافة numericId
# ============================================

echo "🚀 بدء التحديث..."

# التأكد من المسار الصحيح
cd /root/ali/backend || { echo "❌ مجلد غير موجود"; exit 1; }

echo "📥 سحب آخر التحديثات..."
git pull origin main

echo "📦 تثبيت التبعيات..."
npm install

echo "🔧 توليد Prisma Client..."
npx prisma generate

echo "🗄️ تطبيق الـ migrations..."
npx prisma migrate deploy

echo "🔢 تعيين بداية numericId إلى 100 مليون..."
npx ts-node prisma/set-numeric-id-start.ts

echo "🏗️ بناء المشروع..."
npm run build

echo "🔄 إعادة تشغيل الخدمة..."
pm2 restart ali-backend

echo "✅ تم التحديث بنجاح!"
echo ""
echo "📊 حالة الخدمة:"
pm2 status ali-backend

echo ""
echo "📝 آخر السجلات:"
pm2 logs ali-backend --lines 10 --nostream
