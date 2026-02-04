# Ali Backend - Production Ready

Backend قوي وقابل للتوسع لتطبيق Ali.

## 🏗️ المعمارية

```
Flutter App → Nginx (SSL) → NestJS Backend → PostgreSQL + Redis
                                    ↓
                              WebSocket (Socket.IO)
```

## 📋 المتطلبات

- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 16+ (عبر Docker)
- Redis 7+ (عبر Docker)

## 🚀 التشغيل المحلي (Development)

### الخطوة 1: استنساخ المشروع وتثبيت الحزم

```powershell
cd backend
npm install
```

### الخطوة 2: إعداد ملف البيئة

```powershell
Copy-Item .env.example .env
```

عدّل `.env` حسب احتياجاتك:

```env
# Server
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL="postgresql://ali_user:ali_password_123@localhost:5432/ali_db?schema=public"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT (غيّر هذه في Production!)
JWT_SECRET=your-super-secret-jwt-key-change-in-production-min-32-chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-in-production-min-32-chars
JWT_REFRESH_EXPIRES_IN=7d

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
```

### الخطوة 3: تشغيل PostgreSQL و Redis

```powershell
docker-compose -f docker-compose.dev.yml up -d
```

### الخطوة 4: إعداد قاعدة البيانات

```powershell
# توليد Prisma Client
npm run prisma:generate

# تشغيل Migrations
npm run prisma:migrate

# (اختياري) ملء البيانات الأولية
npm run prisma:seed
```

### الخطوة 5: تشغيل السيرفر

```powershell
# Development mode (مع hot reload)
npm run start:dev
```

السيرفر سيعمل على: `http://localhost:3000`
Swagger docs: `http://localhost:3000/api/docs`

## 🔧 أوامر مفيدة

```powershell
# عرض قاعدة البيانات (Prisma Studio)
npm run prisma:studio

# إعادة تعيين قاعدة البيانات
npm run db:reset

# بناء المشروع
npm run build

# تشغيل الاختبارات
npm test

# فحص الكود
npm run lint
```

## 🌐 API Endpoints

### Auth (المصادقة)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| POST | `/api/v1/auth/register` | تسجيل مستخدم جديد |
| POST | `/api/v1/auth/login` | تسجيل دخول بالإيميل |
| POST | `/api/v1/auth/google` | تسجيل دخول بـ Google |
| POST | `/api/v1/auth/refresh` | تجديد Access Token |
| POST | `/api/v1/auth/logout` | تسجيل خروج |
| GET | `/api/v1/auth/me` | بيانات المستخدم الحالي |

### Users (المستخدمين)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/api/v1/users/profile` | الملف الشخصي |
| PUT | `/api/v1/users/profile` | تحديث الملف الشخصي |
| GET | `/api/v1/users/:id` | بيانات مستخدم |
| GET | `/api/v1/users` | قائمة المستخدمين (Admin) |

### Rooms (الغرف)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| POST | `/api/v1/rooms` | إنشاء غرفة |
| GET | `/api/v1/rooms` | قائمة الغرف |
| GET | `/api/v1/rooms/:id` | تفاصيل غرفة |
| POST | `/api/v1/rooms/:id/join` | الانضمام لغرفة |
| POST | `/api/v1/rooms/:id/leave` | مغادرة غرفة |

### Messages (الرسائل)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/api/v1/rooms/:roomId/messages` | رسائل غرفة |
| POST | `/api/v1/rooms/:roomId/messages` | إرسال رسالة |
| DELETE | `/api/v1/rooms/:roomId/messages/:id` | حذف رسالة |

### Gifts (الهدايا)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/api/v1/gifts` | قائمة الهدايا |
| POST | `/api/v1/gifts/send` | إرسال هدية |
| GET | `/api/v1/gifts/sent` | الهدايا المرسلة |
| GET | `/api/v1/gifts/received` | الهدايا المستلمة |

### Wallet (المحفظة)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/api/v1/wallet` | رصيد المحفظة |
| GET | `/api/v1/wallet/transactions` | سجل المعاملات |
| POST | `/api/v1/wallet/deposit` | إيداع |
| POST | `/api/v1/wallet/withdraw` | سحب |

## 🔌 WebSocket Events

### الاتصال

```javascript
const socket = io('wss://api.yourdomain.com', {
  auth: { token: 'your-jwt-token' }
});
```

### Events

| Event | Direction | الوصف |
|-------|-----------|-------|
| `connected` | Server → Client | تأكيد الاتصال |
| `join_room` | Client → Server | الانضمام لغرفة |
| `leave_room` | Client → Server | مغادرة غرفة |
| `send_message` | Client → Server | إرسال رسالة |
| `new_message` | Server → Client | رسالة جديدة |
| `user_joined` | Server → Client | مستخدم انضم |
| `user_left` | Server → Client | مستخدم غادر |
| `typing_start` | Client → Server | بدء الكتابة |
| `user_typing` | Server → Client | مستخدم يكتب |
| `gift_sent` | Server → Client | تم إرسال هدية |
| `heartbeat` | Client ↔ Server | نبض القلب |

---

## 🚀 النشر على VPS (Production)

### المتطلبات
- VPS مع 2 vCPU و 4GB RAM كحد أدنى
- Ubuntu 22.04 LTS
- Docker & Docker Compose
- اسم نطاق (Domain)

### الخطوة 1: إعداد السيرفر

```bash
# تحديث النظام
sudo apt update && sudo apt upgrade -y

# تثبيت Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# تثبيت Docker Compose
sudo apt install docker-compose-plugin -y
```

### الخطوة 2: نسخ المشروع

```bash
git clone your-repo backend
cd backend
```

### الخطوة 3: إعداد ملف Production

```bash
cp .env.example .env.production
```

عدّل `.env.production`:

```env
NODE_ENV=production
DATABASE_URL="postgresql://ali_user:STRONG_PASSWORD@postgres:5432/ali_db"
JWT_SECRET=GENERATE_STRONG_32_CHAR_SECRET
JWT_REFRESH_SECRET=GENERATE_ANOTHER_STRONG_SECRET
GOOGLE_CLIENT_ID=your-production-google-client-id
```

### الخطوة 4: إعداد SSL

```bash
# أول مرة - الحصول على شهادة
docker-compose run --rm certbot certonly --webroot \
  --webroot-path=/var/www/certbot \
  --email your@email.com \
  --agree-tos \
  --no-eff-email \
  -d api.yourdomain.com
```

### الخطوة 5: التشغيل

```bash
# بناء وتشغيل كل الخدمات
docker-compose --env-file .env.production up -d --build

# تشغيل Migrations
docker-compose exec backend npx prisma migrate deploy

# (أول مرة) ملء البيانات الأولية
docker-compose exec backend npm run prisma:seed
```

### الخطوة 6: التحقق

```bash
# التحقق من الحالة
docker-compose ps

# عرض اللوجات
docker-compose logs -f backend

# اختبار الـ API
curl https://api.yourdomain.com/api/v1/admin/system/health
```

---

## 📈 خطة التوسع

### المرحلة 1: سيرفر واحد (الحالي)
- 2 vCPU, 4GB RAM
- يدعم ~1000-5000 مستخدم متزامن
- التكلفة: $20-40/شهر

### المرحلة 2: توسع أفقي
```yaml
# docker-compose.scale.yml
services:
  backend:
    deploy:
      replicas: 3
```

### المرحلة 3: فصل الخدمات
```
┌─────────────┐     ┌─────────────┐
│  Backend 1  │     │  Backend 2  │
└──────┬──────┘     └──────┬──────┘
       │                   │
       └─────────┬─────────┘
                 ▼
         ┌───────────────┐
         │    Redis      │
         │  (Managed)    │
         └───────────────┘
                 ▼
         ┌───────────────┐
         │  PostgreSQL   │
         │  (Managed)    │
         └───────────────┘
```

### توصيات للتوسع:
1. **PostgreSQL Managed**: DigitalOcean/AWS RDS (~$15/شهر)
2. **Redis Managed**: Upstash/Redis Cloud (مجاني للبداية)
3. **Load Balancer**: Nginx أو Cloud LB
4. **CDN**: Cloudflare (مجاني)

---

## 🔒 الأمان

- ✅ كلمات المرور مشفرة بـ Argon2id
- ✅ JWT مع Refresh Tokens
- ✅ Rate Limiting على Auth endpoints
- ✅ Input Validation على كل الـ DTOs
- ✅ SQL Injection protected (Prisma ORM)
- ✅ CORS محدد
- ✅ Helmet headers
- ✅ HTTPS فقط في Production

---

## 📝 الترخيص

Private - All Rights Reserved
