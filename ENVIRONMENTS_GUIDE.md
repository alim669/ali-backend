# 🔧 دليل إعداد البيئات - Ali Backend

## 📋 نظرة عامة

لديك 3 بيئات متاحة:

| البيئة | الاستخدام | قاعدة البيانات | السرعة |
|--------|-----------|----------------|--------|
| **Local** | التطوير اليومي | Docker محلي | ⚡ < 5ms |
| **Neon** | الاختبار مع بيانات حقيقية | Neon Cloud (سنغافورة) | 🐢 ~300ms |
| **Production** | الإنتاج | السيرفر الألماني | ⚡ < 5ms |

---

## 🚀 البدء السريع

### للتطوير المحلي (الأسرع):

```powershell
# 1. شغّل Docker Desktop أولاً

# 2. شغّل البيئة المحلية
cd backend
.\start-local.ps1

# 3. شغّل الـ Backend
npm run start:dev
```

### للتبديل بين البيئات:

```powershell
# التبديل للبيئة المحلية
.\switch-env.ps1 local

# التبديل لـ Neon Cloud
.\switch-env.ps1 neon

# عرض الحالة الحالية
.\switch-env.ps1 status
```

---

## 📁 ملفات البيئات

| الملف | الوصف |
|-------|-------|
| `.env` | الملف النشط (لا تعدله مباشرة) |
| `.env.local` | إعدادات التطوير المحلي |
| `.env.neon` | إعدادات Neon Cloud |
| `.env.production.server` | إعدادات الإنتاج (للسيرفر فقط) |

---

## 🐳 Docker - التطوير المحلي

### الأوامر الأساسية:

```powershell
# تشغيل الخدمات
docker-compose -f docker-compose.local.yml up -d

# إيقاف الخدمات
docker-compose -f docker-compose.local.yml down

# عرض الحالة
docker-compose -f docker-compose.local.yml ps

# مشاهدة الـ logs
docker-compose -f docker-compose.local.yml logs -f postgres
```

### الخدمات المتاحة:

| الخدمة | العنوان | الوصف |
|--------|---------|-------|
| PostgreSQL | `localhost:5432` | قاعدة البيانات |
| Redis | `localhost:6379` | الذاكرة المؤقتة |
| PgAdmin | `http://localhost:5050` | إدارة قاعدة البيانات |
| Redis Commander | `http://localhost:8081` | إدارة Redis |

### بيانات الدخول لـ PgAdmin:
- **Email:** `admin@ali.local`
- **Password:** `admin123`

### إعداد اتصال PostgreSQL في PgAdmin:
- **Host:** `postgres` (اسم الحاوية)
- **Port:** `5432`
- **Username:** `ali_user`
- **Password:** `ali_password_123`
- **Database:** `ali_db`

---

## 🌐 النشر على السيرفر الألماني

### المتطلبات:
- وصول SSH للسيرفر `167.235.64.220`
- Docker مثبت على السيرفر

### خطوات النشر:

```bash
# 1. الاتصال بالسيرفر
ssh root@167.235.64.220

# 2. الذهاب لمجلد المشروع
cd /var/www/ali/backend

# 3. سحب التحديثات
git pull origin main

# 4. تشغيل سكربت النشر
chmod +x deploy-server.sh
./deploy-server.sh
```

### أو يدوياً:

```bash
# إيقاف الخدمات القديمة
docker-compose -f docker-compose.prod.yml down

# بناء وتشغيل الخدمات الجديدة
docker-compose -f docker-compose.prod.yml up -d --build

# تطبيق الـ migrations
docker-compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

---

## 🔐 الأمان

### ⚠️ مهم جداً:

1. **لا تشارك ملفات `.env`** - أضفها لـ `.gitignore`
2. **غيّر المفاتيح السرية** في الإنتاج
3. **استخدم HTTPS** في الإنتاج

### توليد مفاتيح آمنة:

```powershell
# في PowerShell
[Convert]::ToBase64String((1..64 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

```bash
# في Linux
openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 64
```

---

## 🔄 Prisma - قاعدة البيانات

### أوامر مفيدة:

```powershell
# توليد Prisma Client
npx prisma generate

# تطبيق الـ migrations
npx prisma migrate deploy

# إنشاء migration جديد
npx prisma migrate dev --name your_migration_name

# فتح Prisma Studio
npx prisma studio

# مزامنة الـ schema بدون migration
npx prisma db push
```

---

## 🧪 اختبار الاتصال

```powershell
# اختبار صحة قاعدة البيانات
npx ts-node prisma/db-health-check.ts

# اختبار الأداء
npx ts-node prisma/db-benchmark.ts

# تحليل زمن الاستجابة
npx ts-node prisma/db-latency-analysis.ts
```

---

## ❓ حل المشاكل

### Docker لا يعمل:
```powershell
# تأكد أن Docker Desktop يعمل
# أعد تشغيل Docker Desktop
```

### قاعدة البيانات لا تتصل:
```powershell
# تحقق من الحاويات
docker ps

# تحقق من logs
docker logs ali_postgres_local
```

### Prisma errors:
```powershell
# أعد توليد Client
npx prisma generate

# امسح node_modules/.prisma
Remove-Item -Recurse -Force node_modules/.prisma
npx prisma generate
```

---

## 📞 المساعدة

إذا واجهت مشاكل:
1. تحقق من `.\switch-env.ps1 status`
2. تحقق من logs الـ Docker
3. تأكد أن الـ ports غير مستخدمة (5432, 6379, 3000)
