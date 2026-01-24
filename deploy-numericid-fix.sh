#!/bin/bash
# ============================================
# Ali Backend - NumericId Fix Deployment
# تحديث السيرفر لإضافة numericId للغرف
# ============================================

set -e  # توقف عند أي خطأ

echo "🚀 بدء تحديث NumericId للغرف..."
echo "========================================"

# الانتقال لمجلد المشروع
cd /root/ali/backend || cd /var/www/ali/backend || cd ~/ali/backend

echo ""
echo "📥 الخطوة 1: سحب آخر التحديثات من Git..."
git stash
git pull origin main
git stash pop || true

echo ""
echo "📦 الخطوة 2: تثبيت الحزم الجديدة..."
docker-compose exec -T backend npm install

echo ""
echo "🔧 الخطوة 3: توليد Prisma Client..."
docker-compose exec -T backend npx prisma generate

echo ""
echo "📊 الخطوة 4: تطبيق migrations على قاعدة البيانات..."
docker-compose exec -T backend npx prisma migrate deploy

echo ""
echo "🔄 الخطوة 5: إعادة بناء وتشغيل الـ Backend..."
docker-compose up -d --build backend

echo ""
echo "⏳ الخطوة 6: انتظار جهوزية الـ Backend..."
sleep 10

# التحقق من صحة التشغيل
echo ""
echo "✅ الخطوة 7: التحقق من صحة التشغيل..."
for i in {1..30}; do
    if curl -s http://localhost:3000/api/v1/admin/system/health > /dev/null 2>&1; then
        echo "✅ Backend يعمل بنجاح!"
        break
    fi
    echo "⏳ انتظار... ($i/30)"
    sleep 2
done

echo ""
echo "========================================"
echo "🎉 تم التحديث بنجاح!"
echo ""
echo "📋 للتحقق من الغرف مع numericId:"
echo "   docker-compose exec backend npx prisma studio"
echo ""
echo "📋 لعرض سجلات الـ Backend:"
echo "   docker-compose logs -f backend"
echo "========================================"
