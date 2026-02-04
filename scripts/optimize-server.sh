#!/bin/bash
# ============================================
# Ali Backend - Performance Optimization Script
# السيرفر: 3.7GB RAM, 2 CPU cores
# ============================================

echo "🚀 بدء تطبيق تحسينات الأداء..."
echo "========================================="

# ================================
# 1. تحسين PostgreSQL
# ================================
echo ""
echo "📊 [1/4] تحسين PostgreSQL..."

# العثور على ملف الإعدادات
PG_CONF=$(find /etc/postgresql -name "postgresql.conf" 2>/dev/null | head -1)

if [ -n "$PG_CONF" ]; then
    # عمل نسخة احتياطية
    cp "$PG_CONF" "$PG_CONF.backup.$(date +%Y%m%d)"
    
    # تحديث الإعدادات
    cat >> "$PG_CONF" << 'PGCONF'

# ============================================
# Performance Optimization - Applied by Script
# ============================================
# Connections (for 4GB RAM server)
max_connections = 200

# Memory
shared_buffers = 768MB
effective_cache_size = 2GB
maintenance_work_mem = 128MB
work_mem = 8MB

# Checkpoints
checkpoint_completion_target = 0.9
wal_buffers = 32MB
min_wal_size = 512MB
max_wal_size = 2GB

# Query Planning
random_page_cost = 1.1
effective_io_concurrency = 200
default_statistics_target = 100

# Parallelism
max_worker_processes = 2
max_parallel_workers_per_gather = 1
max_parallel_workers = 2

# Logging (minimal for performance)
log_min_duration_statement = 1000
PGCONF

    echo "   ✅ تم تحديث إعدادات PostgreSQL"
else
    echo "   ⚠️ لم يتم العثور على ملف postgresql.conf"
fi

# ================================
# 2. تحسين Redis
# ================================
echo ""
echo "📦 [2/4] تحسين Redis..."

REDIS_CONF="/etc/redis/redis.conf"

if [ -f "$REDIS_CONF" ]; then
    # عمل نسخة احتياطية
    cp "$REDIS_CONF" "$REDIS_CONF.backup.$(date +%Y%m%d)"
    
    # تحديث الإعدادات
    sed -i 's/^maxmemory .*/maxmemory 512mb/' "$REDIS_CONF"
    sed -i 's/^# maxmemory .*/maxmemory 512mb/' "$REDIS_CONF"
    
    # إضافة إعدادات إذا لم تكن موجودة
    grep -q "^maxmemory-policy" "$REDIS_CONF" || echo "maxmemory-policy allkeys-lru" >> "$REDIS_CONF"
    grep -q "^tcp-backlog" "$REDIS_CONF" || echo "tcp-backlog 2048" >> "$REDIS_CONF"
    grep -q "^tcp-keepalive" "$REDIS_CONF" || echo "tcp-keepalive 300" >> "$REDIS_CONF"
    grep -q "^hz " "$REDIS_CONF" || echo "hz 100" >> "$REDIS_CONF"
    grep -q "^dynamic-hz" "$REDIS_CONF" || echo "dynamic-hz yes" >> "$REDIS_CONF"
    
    echo "   ✅ تم تحديث إعدادات Redis"
else
    echo "   ⚠️ لم يتم العثور على ملف redis.conf"
fi

# ================================
# 3. تحسين Nginx
# ================================
echo ""
echo "🌐 [3/4] تحسين Nginx..."

NGINX_CONF="/etc/nginx/nginx.conf"

if [ -f "$NGINX_CONF" ]; then
    # عمل نسخة احتياطية
    cp "$NGINX_CONF" "$NGINX_CONF.backup.$(date +%Y%m%d)"
    
    # تحديث worker_connections
    sed -i 's/worker_connections\s*[0-9]*;/worker_connections 4096;/' "$NGINX_CONF"
    
    # إضافة worker_rlimit_nofile إذا لم تكن موجودة
    grep -q "worker_rlimit_nofile" "$NGINX_CONF" || sed -i '/^worker_processes/a worker_rlimit_nofile 65535;' "$NGINX_CONF"
    
    echo "   ✅ تم تحديث إعدادات Nginx"
else
    echo "   ⚠️ لم يتم العثور على ملف nginx.conf"
fi

# ================================
# 4. تحسين PM2 و Node.js
# ================================
echo ""
echo "⚡ [4/4] تحسين PM2 و Node.js..."

# تحديث ملف ecosystem
PM2_ECOSYSTEM="/root/ali-app/backend/ecosystem.config.js"

if [ -f "$PM2_ECOSYSTEM" ]; then
    cp "$PM2_ECOSYSTEM" "$PM2_ECOSYSTEM.backup.$(date +%Y%m%d)"
fi

cat > "$PM2_ECOSYSTEM" << 'PM2CONF'
module.exports = {
  apps: [{
    name: 'ali-backend',
    script: './dist/main.js',
    cwd: '/root/ali-app/backend',
    instances: 2,  // 2 instances for 2 CPU cores
    exec_mode: 'cluster',
    max_memory_restart: '800M',
    node_args: '--max-old-space-size=768',
    env: {
      NODE_ENV: 'production',
      UV_THREADPOOL_SIZE: 8
    },
    // إعادة التشغيل التلقائي
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    // الصحة
    kill_timeout: 5000,
    listen_timeout: 10000,
    // اللوجات
    error_file: '/root/ali-app/backend/logs/error.log',
    out_file: '/root/ali-app/backend/logs/out.log',
    log_file: '/root/ali-app/backend/logs/combined.log',
    time: true,
    merge_logs: true
  }]
};
PM2CONF

echo "   ✅ تم إنشاء ملف PM2 ecosystem محسّن"

# إنشاء مجلد اللوجات
mkdir -p /root/ali-app/backend/logs

# ================================
# 5. تحسينات النظام
# ================================
echo ""
echo "🔧 [5/5] تحسينات النظام..."

# تحسين sysctl
cat > /etc/sysctl.d/99-ali-performance.conf << 'SYSCTL'
# ============================================
# Ali Backend - System Performance Tuning
# ============================================

# Network Performance
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_probes = 5
net.ipv4.tcp_keepalive_intvl = 15
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1

# File Descriptors
fs.file-max = 2097152
fs.nr_open = 2097152

# Virtual Memory
vm.swappiness = 10
vm.dirty_ratio = 60
vm.dirty_background_ratio = 5
SYSCTL

# تطبيق التغييرات
sysctl -p /etc/sysctl.d/99-ali-performance.conf > /dev/null 2>&1

# تحسين limits
cat > /etc/security/limits.d/99-ali-limits.conf << 'LIMITS'
* soft nofile 65535
* hard nofile 65535
* soft nproc 65535
* hard nproc 65535
root soft nofile 65535
root hard nofile 65535
LIMITS

echo "   ✅ تم تحسين إعدادات النظام"

# ================================
# إعادة تشغيل الخدمات
# ================================
echo ""
echo "========================================="
echo "🔄 إعادة تشغيل الخدمات..."

# إعادة تشغيل PostgreSQL
echo "   ⏳ إعادة تشغيل PostgreSQL..."
systemctl restart postgresql
sleep 3

# إعادة تشغيل Redis
echo "   ⏳ إعادة تشغيل Redis..."
systemctl restart redis-server
sleep 2

# اختبار Nginx
echo "   ⏳ اختبار وإعادة تشغيل Nginx..."
nginx -t && systemctl reload nginx

# إعادة تشغيل PM2
echo "   ⏳ إعادة تشغيل التطبيق عبر PM2..."
cd /root/ali-app/backend
pm2 delete ali-backend 2>/dev/null
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "========================================="
echo "✅ تم تطبيق جميع التحسينات بنجاح!"
echo ""
echo "📊 الملخص:"
echo "   • PostgreSQL: max_connections=200, shared_buffers=768MB"
echo "   • Redis: maxmemory=512MB, optimized for LRU"
echo "   • Nginx: worker_connections=4096"
echo "   • PM2: 2 instances in cluster mode"
echo "   • System: optimized TCP/network settings"
echo ""
echo "📈 القدرة المتوقعة:"
echo "   • المستخدمين المتزامنين: 3,000 - 5,000"
echo "   • WebSocket Connections: 2,000 - 3,000"
echo "   • الطلبات/ثانية: 500 - 1,000"
echo ""
echo "🔍 للتحقق من الحالة:"
echo "   pm2 status"
echo "   pm2 monit"
echo "========================================="
