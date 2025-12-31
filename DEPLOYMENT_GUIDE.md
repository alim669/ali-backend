# 🚀 دليل نشر Ali Backend على VPS

## المتطلبات الأساسية

### 1. VPS Server
- **الحد الأدنى**: 1 vCPU, 1GB RAM, 20GB SSD
- **الموصى به للإنتاج**: 2 vCPU, 4GB RAM, 40GB SSD
- **نظام التشغيل**: Ubuntu 22.04 LTS

### 2. مزودي VPS الموصى بهم
| المزود | السعر الشهري | الميزات |
|--------|-------------|---------|
| DigitalOcean | $6-12 | سهل الاستخدام، datacenter قريب |
| Hetzner | $4-8 | سعر ممتاز، أوروبا |
| Linode | $5-10 | موثوق |
| Vultr | $5-10 | datacenters كثيرة |
| Contabo | $5-7 | رخيص جداً |

---

## الخطوة 1: إعداد الـ VPS

### 1.1 الاتصال بالـ VPS
```bash
ssh root@YOUR_VPS_IP
```

### 1.2 تحديث النظام
```bash
apt update && apt upgrade -y
```

### 1.3 إنشاء مستخدم جديد (للأمان)
```bash
adduser ali
usermod -aG sudo ali
su - ali
```

---

## الخطوة 2: تثبيت البرامج المطلوبة

### 2.1 تثبيت Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v  # يجب أن يظهر v20.x.x
```

### 2.2 تثبيت PostgreSQL
```bash
sudo apt install -y postgresql postgresql-contrib

# إنشاء قاعدة بيانات ومستخدم
sudo -u postgres psql

# داخل PostgreSQL:
CREATE DATABASE ali_db;
CREATE USER ali_user WITH ENCRYPTED PASSWORD 'YOUR_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE ali_db TO ali_user;
ALTER DATABASE ali_db OWNER TO ali_user;
\q
```

### 2.3 تثبيت Redis (اختياري لكن موصى به)
```bash
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

### 2.4 تثبيت Nginx
```bash
sudo apt install -y nginx
sudo systemctl enable nginx
```

### 2.5 تثبيت PM2 (مدير العمليات)
```bash
sudo npm install -g pm2
```

### 2.6 تثبيت Certbot (SSL)
```bash
sudo apt install -y certbot python3-certbot-nginx
```

---

## الخطوة 3: رفع الكود

### 3.1 باستخدام Git
```bash
cd ~
git clone https://github.com/YOUR_USERNAME/ali-backend.git
cd ali-backend
```

### 3.2 أو باستخدام SCP (من جهازك)
```bash
# من جهازك المحلي
scp -r ./backend ali@YOUR_VPS_IP:~/ali-backend
```

---

## الخطوة 4: إعداد التطبيق

### 4.1 تثبيت Dependencies
```bash
cd ~/ali-backend
npm install
```

### 4.2 إنشاء ملف البيئة
```bash
nano .env
```

```env
# ================================
# Ali Backend - Production Environment
# ================================

# Server
NODE_ENV=production
PORT=3000

# Database (PostgreSQL Local)
DATABASE_URL="postgresql://ali_user:YOUR_STRONG_PASSWORD@localhost:5432/ali_db?schema=public"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_ENABLED=true

# JWT (استخدم مفاتيح قوية وعشوائية!)
# يمكنك توليدها بـ: openssl rand -base64 64
JWT_SECRET=YOUR_VERY_LONG_RANDOM_SECRET_AT_LEAST_64_CHARACTERS_LONG_HERE
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=ANOTHER_VERY_LONG_RANDOM_SECRET_AT_LEAST_64_CHARACTERS_LONG_HERE
JWT_REFRESH_EXPIRES_IN=7d

# Google OAuth (من Google Cloud Console)
GOOGLE_CLIENT_ID=your-production-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Rate Limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=100

# CORS (أضف domain التطبيق)
CORS_ORIGINS=https://yourapp.com,https://www.yourapp.com

# File Upload
MAX_FILE_SIZE=10485760
UPLOAD_DEST=./uploads

# Logging
LOG_LEVEL=info
```

### 4.3 تشغيل Migrations
```bash
npx prisma generate
npx prisma migrate deploy
```

### 4.4 Seed البيانات الأولية (اختياري)
```bash
npm run prisma:seed
```

### 4.5 بناء التطبيق
```bash
npm run build
```

---

## الخطوة 5: تشغيل التطبيق بـ PM2

### 5.1 إنشاء ecosystem file
```bash
nano ecosystem.config.js
```

```javascript
module.exports = {
  apps: [
    {
      name: 'ali-backend',
      script: 'dist/main.js',
      instances: 'max', // استخدام كل الـ CPUs
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      // Restart policy
      max_memory_restart: '500M',
      restart_delay: 1000,
      autorestart: true,
      watch: false,
    },
  ],
};
```

### 5.2 إنشاء مجلد logs
```bash
mkdir -p logs
```

### 5.3 تشغيل التطبيق
```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup  # لتشغيل التطبيق تلقائياً عند إعادة تشغيل السيرفر
```

### 5.4 أوامر PM2 المفيدة
```bash
pm2 status          # حالة التطبيقات
pm2 logs ali-backend  # عرض logs
pm2 restart ali-backend  # إعادة تشغيل
pm2 stop ali-backend     # إيقاف
pm2 delete ali-backend   # حذف
pm2 monit            # مراقبة حية
```

---

## الخطوة 6: إعداد Nginx كـ Reverse Proxy

### 6.1 إنشاء ملف الإعداد
```bash
sudo nano /etc/nginx/sites-available/ali-backend
```

```nginx
# API Backend
server {
    listen 80;
    server_name api.yourapp.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy to Node.js
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Health check
    location /health {
        proxy_pass http://127.0.0.1:3000/api/v1/admin/system/health;
        access_log off;
    }
}
```

### 6.2 تفعيل الموقع
```bash
sudo ln -s /etc/nginx/sites-available/ali-backend /etc/nginx/sites-enabled/
sudo nginx -t  # اختبار الإعدادات
sudo systemctl reload nginx
```

---

## الخطوة 7: إعداد SSL مع Let's Encrypt

### 7.1 الحصول على شهادة SSL
```bash
sudo certbot --nginx -d api.yourapp.com
```

### 7.2 التجديد التلقائي
```bash
sudo certbot renew --dry-run  # اختبار
```

Certbot يضيف تلقائياً cronjob للتجديد.

---

## الخطوة 8: إعداد Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## الخطوة 9: تحديث Flutter App

### 9.1 تغيير API URL
في ملف `lib/core/api/api_config.dart`:

```dart
class ApiConfig {
  /// Production URL
  static const String productionUrl = 'https://api.yourapp.com';
  
  /// Base URL
  static String get baseUrl {
    // للإنتاج
    if (kReleaseMode) {
      return productionUrl;
    }
    // للتطوير
    return 'http://localhost:3000';
  }
}
```

---

## الخطوة 10: المراقبة والصيانة

### 10.1 مراقبة Logs
```bash
# PM2 logs
pm2 logs ali-backend --lines 100

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-*-main.log
```

### 10.2 النسخ الاحتياطي
```bash
# نسخ قاعدة البيانات
pg_dump -U ali_user -d ali_db > backup_$(date +%Y%m%d).sql

# Cron job للنسخ اليومي
crontab -e
# أضف:
0 3 * * * pg_dump -U ali_user -d ali_db > ~/backups/backup_$(date +\%Y\%m\%d).sql
```

### 10.3 التحديث
```bash
cd ~/ali-backend
git pull origin main
npm install
npm run build
npx prisma migrate deploy
pm2 restart ali-backend
```

---

## ⚠️ نصائح أمنية مهمة

1. **لا تستخدم root** - استخدم مستخدم عادي مع sudo
2. **غير SSH port** - من 22 إلى رقم آخر
3. **استخدم SSH keys** - بدلاً من كلمات المرور
4. **حدّث النظام بانتظام** - `apt update && apt upgrade`
5. **راقب الـ logs** - للكشف عن المحاولات المشبوهة
6. **استخدم fail2ban** - لحظر المحاولات الفاشلة

```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
```

---

## 🔧 استكشاف الأخطاء

### التطبيق لا يعمل
```bash
pm2 logs ali-backend --err --lines 50
```

### مشكلة في قاعدة البيانات
```bash
sudo -u postgres psql -c "SELECT 1"
```

### مشكلة في Redis
```bash
redis-cli ping  # يجب أن يرد PONG
```

### مشكلة في Nginx
```bash
sudo nginx -t
sudo systemctl status nginx
```

---

## 📊 المراقبة المتقدمة (اختياري)

### Grafana + Prometheus
للمراقبة المتقدمة، يمكنك استخدام:
- **Prometheus** لجمع الـ metrics
- **Grafana** لعرضها بشكل مرئي

### Sentry
لتتبع الأخطاء في الإنتاج:
```bash
npm install @sentry/node
```

---

## ✅ قائمة التحقق قبل الإطلاق

- [ ] SSL مفعّل (HTTPS)
- [ ] Environment variables آمنة
- [ ] Database backups مجدولة
- [ ] Firewall مفعّل
- [ ] PM2 يعمل في cluster mode
- [ ] Nginx معدّ بشكل صحيح
- [ ] Logs تعمل
- [ ] Health check endpoint يعمل
- [ ] Rate limiting مفعّل
- [ ] CORS معدّ للـ domains الصحيحة

---

## 🎉 تهانينا!

تطبيقك الآن يعمل على VPS بشكل احترافي وجاهز للإنتاج!

للدعم: [GitHub Issues](https://github.com/your-repo/issues)
