#!/bin/bash
# =============================================================================
# سكربت النشر الآمن - Safe Deployment Script
# =============================================================================
# استخدم هذا السكربت دائماً للنشر بدلاً من الأوامر اليدوية
# =============================================================================

set -e

# الألوان
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# المسارات
BACKEND_DIR="/root/ali-app/backend"
SCRIPTS_DIR="$BACKEND_DIR/scripts"
BACKUP_DIR="/root/ali-app/backups"
LOG_FILE="/root/ali-app/deploy.log"

# ===================== الوظائف =====================

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

error_exit() {
    log "${RED}❌ خطأ: $1${NC}"
    log "${YELLOW}🔄 جاري محاولة الاستعادة...${NC}"
    
    # إعادة تشغيل الخدمة بالحالة السابقة
    pm2 restart ali-backend || true
    
    exit 1
}

# التحقق من المتطلبات
check_requirements() {
    log "${BLUE}🔍 التحقق من المتطلبات...${NC}"
    
    # التحقق من وجود المجلدات
    if [ ! -d "$BACKEND_DIR" ]; then
        error_exit "مجلد Backend غير موجود!"
    fi
    
    # التحقق من وجود .env
    if [ ! -f "$BACKEND_DIR/.env" ]; then
        error_exit "ملف .env غير موجود!"
    fi
    
    # التحقق من تشغيل PM2
    if ! pm2 status ali-backend > /dev/null 2>&1; then
        log "${YELLOW}⚠️ تحذير: PM2 غير مُشغّل${NC}"
    fi
    
    log "${GREEN}✅ المتطلبات متوفرة${NC}"
}

# إنشاء نسخة احتياطية إلزامية
create_mandatory_backup() {
    log "${BLUE}📦 إنشاء نسخة احتياطية إلزامية...${NC}"
    
    mkdir -p "$BACKUP_DIR"
    
    # تنفيذ النسخ الاحتياطي
    if [ -f "$SCRIPTS_DIR/backup.sh" ]; then
        bash "$SCRIPTS_DIR/backup.sh" backup
        if [ $? -eq 0 ]; then
            log "${GREEN}✅ تم إنشاء النسخة الاحتياطية${NC}"
        else
            error_exit "فشل إنشاء النسخة الاحتياطية!"
        fi
    else
        # نسخة احتياطية بسيطة
        source "$BACKEND_DIR/.env"
        local TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        local BACKUP_FILE="$BACKUP_DIR/deploy_backup_$TIMESTAMP.sql"
        
        # استخراج معلومات الاتصال
        DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\).*/\1/p')
        DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
        DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
        DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
        DB_PASS=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
        
        PGPASSWORD="$DB_PASS" pg_dump -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" > "$BACKUP_FILE" 2>/dev/null
        
        if [ $? -eq 0 ]; then
            gzip "$BACKUP_FILE"
            log "${GREEN}✅ تم إنشاء النسخة الاحتياطية: ${BACKUP_FILE}.gz${NC}"
        else
            error_exit "فشل إنشاء النسخة الاحتياطية!"
        fi
    fi
}

# سحب التحديثات
pull_updates() {
    log "${BLUE}📥 سحب التحديثات من Git...${NC}"
    
    cd "$BACKEND_DIR"
    
    # حفظ التغييرات المحلية إن وجدت
    git stash 2>/dev/null || true
    
    # سحب التحديثات
    git pull origin main
    
    if [ $? -eq 0 ]; then
        log "${GREEN}✅ تم سحب التحديثات${NC}"
    else
        log "${YELLOW}⚠️ تحذير: لا يوجد تحديثات أو فشل السحب${NC}"
    fi
}

# تثبيت التبعيات
install_dependencies() {
    log "${BLUE}📚 تثبيت التبعيات...${NC}"
    
    cd "$BACKEND_DIR"
    npm install --production
    
    if [ $? -eq 0 ]; then
        log "${GREEN}✅ تم تثبيت التبعيات${NC}"
    else
        error_exit "فشل تثبيت التبعيات!"
    fi
}

# تطبيق migrations بأمان
apply_migrations() {
    log "${BLUE}🗃️ تطبيق تغييرات قاعدة البيانات...${NC}"
    
    cd "$BACKEND_DIR"
    
    # استخدام migrate deploy فقط - آمن للإنتاج
    npx prisma migrate deploy
    
    if [ $? -eq 0 ]; then
        log "${GREEN}✅ تم تطبيق migrations${NC}"
    else
        log "${YELLOW}⚠️ لا توجد migrations جديدة أو تم تطبيقها مسبقاً${NC}"
    fi
}

# إنشاء Prisma Client
generate_prisma() {
    log "${BLUE}🔧 إنشاء Prisma Client...${NC}"
    
    cd "$BACKEND_DIR"
    npx prisma generate
    
    if [ $? -eq 0 ]; then
        log "${GREEN}✅ تم إنشاء Prisma Client${NC}"
    else
        error_exit "فشل إنشاء Prisma Client!"
    fi
}

# بناء المشروع
build_project() {
    log "${BLUE}🏗️ بناء المشروع...${NC}"
    
    cd "$BACKEND_DIR"
    npm run build
    
    if [ $? -eq 0 ]; then
        log "${GREEN}✅ تم بناء المشروع${NC}"
    else
        error_exit "فشل بناء المشروع!"
    fi
}

# إعادة تشغيل الخدمة
restart_service() {
    log "${BLUE}🔄 إعادة تشغيل الخدمة...${NC}"
    
    pm2 restart ali-backend
    
    # انتظار بدء الخدمة
    sleep 5
    
    # التحقق من حالة الخدمة
    if pm2 status ali-backend | grep -q "online"; then
        log "${GREEN}✅ الخدمة تعمل بنجاح${NC}"
    else
        error_exit "فشل تشغيل الخدمة!"
    fi
}

# التحقق من صحة النشر
verify_deployment() {
    log "${BLUE}🔍 التحقق من صحة النشر...${NC}"
    
    # اختبار الـ health endpoint
    local HEALTH=$(curl -s http://localhost:3000/api/v1/health 2>/dev/null)
    
    if echo "$HEALTH" | grep -q '"status":"ok"'; then
        log "${GREEN}✅ API يعمل بشكل صحيح${NC}"
    else
        log "${YELLOW}⚠️ تحذير: فشل اختبار Health${NC}"
    fi
}

# ===================== التنفيذ الرئيسي =====================

main() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║           🚀 بدء النشر الآمن - Safe Deployment                  ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    log "🚀 بدء عملية النشر..."
    
    # الخطوات
    check_requirements
    create_mandatory_backup
    pull_updates
    install_dependencies
    apply_migrations
    generate_prisma
    build_project
    restart_service
    verify_deployment
    
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           ✅ تم النشر بنجاح!                                    ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    log "✅ اكتمل النشر بنجاح!"
}

# تنفيذ
main "$@"
