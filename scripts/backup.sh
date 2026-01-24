#!/bin/bash
# =============================================================================
# نظام النسخ الاحتياطي التلقائي - Automatic Backup System
# =============================================================================
# يعمل كل ساعة ويحتفظ بنسخ آخر 7 أيام
# =============================================================================

set -e

# ===================== الإعدادات =====================
BACKUP_DIR="/root/ali-app/backups"
LOG_FILE="/root/ali-app/backups/backup.log"
RETENTION_DAYS=7
MAX_BACKUPS=168  # 7 days * 24 hours

# تحميل متغيرات البيئة (مع التصدير للبيئة)
set -a
source /root/ali-app/backend/.env
set +a

# ===================== الوظائف =====================

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

detect_pg_dump() {
    local DUMP_CMD=""

    if command -v pg_dump >/dev/null 2>&1; then
        DUMP_CMD="pg_dump"
    fi

    # تفضيل pg_dump-17 إذا كان موجوداً
    if command -v pg_dump-17 >/dev/null 2>&1; then
        DUMP_CMD="pg_dump-17"
    fi

    # إذا غير موجود، حاول تثبيت client 17
    if [ -z "$DUMP_CMD" ]; then
        log "⚠️ pg_dump غير موجود. جاري محاولة التثبيت..."
        if command -v apt-get >/dev/null 2>&1; then
            apt-get update -y >/dev/null 2>&1 || true
            apt-get install -y postgresql-client-17 >/dev/null 2>&1 || true
            if command -v pg_dump-17 >/dev/null 2>&1; then
                DUMP_CMD="pg_dump-17"
            elif command -v pg_dump >/dev/null 2>&1; then
                DUMP_CMD="pg_dump"
            fi
        fi
    fi

    # بديل باستخدام Docker إذا كان مثبتاً
    if [ -z "$DUMP_CMD" ] && command -v docker >/dev/null 2>&1; then
        DUMP_CMD="docker"
    fi

    echo "$DUMP_CMD"
}

parse_db_url() {
    python3 - <<'PY'
import os, urllib.parse
url = os.environ.get("DATABASE_URL", "")
u = urllib.parse.urlparse(url)
print(u.hostname or "")
print(u.port or "")
print(u.username or "")
print(u.password or "")
print((u.path or "").lstrip("/"))
print(u.query or "")
PY
}

create_backup() {
    local TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    local BACKUP_FILE="$BACKUP_DIR/db_backup_$TIMESTAMP.sql"
    local BACKUP_FILE_GZ="$BACKUP_FILE.gz"
    
    log "🔄 بدء النسخ الاحتياطي..."
    
    # استخراج معلومات الاتصال من DATABASE_URL (بشكل آمن)
    mapfile -t DB_INFO < <(parse_db_url)
    DB_HOST="${DB_INFO[0]}"
    DB_PORT="${DB_INFO[1]}"
    DB_USER="${DB_INFO[2]}"
    DB_PASS="${DB_INFO[3]}"
    DB_NAME="${DB_INFO[4]}"
    DB_QUERY="${DB_INFO[5]}"

    if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
        log "❌ DATABASE_URL غير صالح أو ناقص."
        return 1
    fi

    # SSL Mode (افتراضي require)
    if echo "$DB_QUERY" | grep -q "sslmode="; then
        DB_SSLMODE=$(echo "$DB_QUERY" | sed -n 's/.*sslmode=\([^&]*\).*/\1/p')
    else
        DB_SSLMODE="require"
    fi

    local DUMP_CMD
    DUMP_CMD=$(detect_pg_dump)
    
    # إنشاء النسخة الاحتياطية
    if [ "$DUMP_CMD" = "docker" ]; then
        log "⚠️ استخدام Docker للنسخ الاحتياطي (postgres:17)"
        docker run --rm -e PGPASSWORD="$DB_PASS" postgres:17 \
            pg_dump -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" \
            --no-owner --no-acl --clean --if-exists > "$BACKUP_FILE" 2>> "$LOG_FILE"
    elif [ -n "$DUMP_CMD" ]; then
        PGPASSWORD="$DB_PASS" PGSSLMODE="$DB_SSLMODE" "$DUMP_CMD" \
            -h "$DB_HOST" \
            -p "${DB_PORT:-5432}" \
            -U "$DB_USER" \
            -d "$DB_NAME" \
            --no-owner \
            --no-acl \
            --clean \
            --if-exists \
            > "$BACKUP_FILE" 2>> "$LOG_FILE"
    else
        log "❌ لا يمكن العثور على pg_dump أو Docker."
        return 1
    fi
    
    if [ $? -eq 0 ]; then
        # ضغط الملف
        gzip "$BACKUP_FILE"
        
        local SIZE=$(du -h "$BACKUP_FILE_GZ" | cut -f1)
        log "✅ تم إنشاء النسخة الاحتياطية: $BACKUP_FILE_GZ ($SIZE)"
        
        # حذف النسخ القديمة
        cleanup_old_backups
        
        return 0
    else
        log "❌ فشل إنشاء النسخة الاحتياطية!"
        rm -f "$BACKUP_FILE"
        return 1
    fi
}

cleanup_old_backups() {
    log "🧹 حذف النسخ القديمة (أكثر من $RETENTION_DAYS أيام)..."
    
    # حذف الملفات الأقدم من RETENTION_DAYS
    find "$BACKUP_DIR" -name "db_backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete
    
    # التأكد من عدم تجاوز الحد الأقصى
    local COUNT=$(ls -1 "$BACKUP_DIR"/db_backup_*.sql.gz 2>/dev/null | wc -l)
    if [ "$COUNT" -gt "$MAX_BACKUPS" ]; then
        local DELETE_COUNT=$((COUNT - MAX_BACKUPS))
        ls -1t "$BACKUP_DIR"/db_backup_*.sql.gz | tail -n $DELETE_COUNT | xargs rm -f
        log "🗑️ تم حذف $DELETE_COUNT نسخ قديمة"
    fi
}

restore_backup() {
    local BACKUP_FILE="$1"
    
    if [ -z "$BACKUP_FILE" ]; then
        echo "❌ يرجى تحديد ملف النسخة الاحتياطية"
        echo "الاستخدام: $0 restore <backup_file.sql.gz>"
        exit 1
    fi
    
    if [ ! -f "$BACKUP_FILE" ]; then
        echo "❌ الملف غير موجود: $BACKUP_FILE"
        exit 1
    fi
    
    log "⚠️ تحذير: سيتم استعادة قاعدة البيانات من النسخة الاحتياطية"
    log "⚠️ هذا سيستبدل جميع البيانات الحالية!"
    read -p "هل أنت متأكد؟ (yes/no): " CONFIRM
    
    if [ "$CONFIRM" != "yes" ]; then
        echo "تم الإلغاء"
        exit 0
    fi
    
    log "🔄 جاري الاستعادة..."
    
    # فك الضغط واستعادة
    gunzip -c "$BACKUP_FILE" | PGPASSWORD="$DB_PASS" psql \
        -h "$DB_HOST" \
        -p "${DB_PORT:-5432}" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        2>> "$LOG_FILE"
    
    if [ $? -eq 0 ]; then
        log "✅ تم استعادة قاعدة البيانات بنجاح!"
    else
        log "❌ فشلت عملية الاستعادة!"
        exit 1
    fi
}

list_backups() {
    echo "📦 النسخ الاحتياطية المتوفرة:"
    echo "================================"
    ls -lh "$BACKUP_DIR"/db_backup_*.sql.gz 2>/dev/null | awk '{print $9, $5, $6, $7, $8}'
    echo "================================"
    local COUNT=$(ls -1 "$BACKUP_DIR"/db_backup_*.sql.gz 2>/dev/null | wc -l)
    echo "إجمالي: $COUNT نسخة"
}

# ===================== التنفيذ =====================

# إنشاء مجلد النسخ الاحتياطية
mkdir -p "$BACKUP_DIR"

case "${1:-backup}" in
    backup)
        create_backup
        ;;
    restore)
        restore_backup "$2"
        ;;
    list)
        list_backups
        ;;
    *)
        echo "الاستخدام: $0 {backup|restore <file>|list}"
        exit 1
        ;;
esac
