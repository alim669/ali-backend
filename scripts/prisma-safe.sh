#!/bin/bash
# =============================================================================
# سكربت Prisma الآمن - يمنع الأوامر الخطرة
# =============================================================================
# استخدم هذا بدلاً من npx prisma مباشرة
# =============================================================================

set -e

# الألوان
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# الأوامر المحظورة في بيئة الإنتاج
DANGEROUS_COMMANDS=(
    "migrate reset"
    "db push --force-reset"
    "db push --accept-data-loss"
    "--force-reset"
    "migrate dev"  # هذا للتطوير فقط
)

# التحقق من بيئة الإنتاج
is_production() {
    if [ "$NODE_ENV" == "production" ] || [ -f "/root/ali-app/backend/.env" ]; then
        return 0
    fi
    return 1
}

# التحقق من الأوامر الخطرة
check_dangerous_command() {
    local FULL_COMMAND="$*"
    
    for dangerous in "${DANGEROUS_COMMANDS[@]}"; do
        if [[ "$FULL_COMMAND" == *"$dangerous"* ]]; then
            echo -e "${RED}╔════════════════════════════════════════════════════════════════╗${NC}"
            echo -e "${RED}║  ⛔ تحذير: أمر خطير - قد يحذف جميع البيانات!                    ║${NC}"
            echo -e "${RED}╠════════════════════════════════════════════════════════════════╣${NC}"
            echo -e "${RED}║  الأمر: prisma $FULL_COMMAND${NC}"
            echo -e "${RED}║                                                                ║${NC}"
            echo -e "${RED}║  هذا الأمر محظور في بيئة الإنتاج!                              ║${NC}"
            echo -e "${RED}╚════════════════════════════════════════════════════════════════╝${NC}"
            echo ""
            echo -e "${YELLOW}الأوامر الآمنة البديلة:${NC}"
            echo -e "  ${GREEN}./prisma-safe.sh migrate deploy${NC}  - تطبيق migrations بأمان"
            echo -e "  ${GREEN}./prisma-safe.sh generate${NC}        - إنشاء Prisma Client"
            echo -e "  ${GREEN}./prisma-safe.sh db pull${NC}         - سحب schema من قاعدة البيانات"
            echo ""
            exit 1
        fi
    done
}

# التحقق من وجود نسخة احتياطية حديثة
check_recent_backup() {
    local BACKUP_DIR="/root/ali-app/backups"
    local LAST_BACKUP=$(ls -1t "$BACKUP_DIR"/db_backup_*.sql.gz 2>/dev/null | head -1)
    
    if [ -z "$LAST_BACKUP" ]; then
        echo -e "${YELLOW}⚠️ تحذير: لا توجد نسخ احتياطية!${NC}"
        echo -e "${YELLOW}يُنصح بإنشاء نسخة احتياطية أولاً:${NC}"
        echo -e "  ${GREEN}./backup.sh backup${NC}"
        echo ""
        read -p "هل تريد المتابعة بدون نسخة احتياطية؟ (y/N): " CONFIRM
        if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
            echo "تم الإلغاء"
            exit 0
        fi
    else
        local BACKUP_AGE=$(( ($(date +%s) - $(stat -c %Y "$LAST_BACKUP")) / 3600 ))
        if [ "$BACKUP_AGE" -gt 24 ]; then
            echo -e "${YELLOW}⚠️ آخر نسخة احتياطية قبل $BACKUP_AGE ساعة${NC}"
        else
            echo -e "${GREEN}✅ آخر نسخة احتياطية قبل $BACKUP_AGE ساعة${NC}"
        fi
    fi
}

# الأوامر الآمنة المسموحة
safe_commands() {
    case "$1" in
        "migrate")
            case "$2" in
                "deploy")
                    echo -e "${GREEN}✅ تطبيق migrations...${NC}"
                    check_recent_backup
                    npx prisma migrate deploy
                    ;;
                "status")
                    npx prisma migrate status
                    ;;
                *)
                    echo -e "${RED}❌ أمر migrate غير مسموح. استخدم: deploy أو status${NC}"
                    exit 1
                    ;;
            esac
            ;;
        "generate")
            echo -e "${GREEN}✅ إنشاء Prisma Client...${NC}"
            npx prisma generate
            ;;
        "db")
            case "$2" in
                "pull")
                    echo -e "${GREEN}✅ سحب schema من قاعدة البيانات...${NC}"
                    npx prisma db pull
                    ;;
                "seed")
                    echo -e "${GREEN}✅ تشغيل seed...${NC}"
                    check_recent_backup
                    npx prisma db seed
                    ;;
                *)
                    echo -e "${RED}❌ أمر db غير مسموح: $2${NC}"
                    exit 1
                    ;;
            esac
            ;;
        "studio")
            echo -e "${GREEN}✅ فتح Prisma Studio...${NC}"
            npx prisma studio
            ;;
        "validate")
            npx prisma validate
            ;;
        "format")
            npx prisma format
            ;;
        "help"|"--help"|"-h"|"")
            echo "==================================="
            echo "  Prisma Safe Commands (الإنتاج)"
            echo "==================================="
            echo ""
            echo "الأوامر المسموحة:"
            echo "  migrate deploy  - تطبيق migrations"
            echo "  migrate status  - حالة migrations"
            echo "  generate        - إنشاء Prisma Client"
            echo "  db pull         - سحب schema"
            echo "  db seed         - تشغيل seed"
            echo "  studio          - فتح Prisma Studio"
            echo "  validate        - التحقق من schema"
            echo "  format          - تنسيق schema"
            echo ""
            echo "الأوامر المحظورة:"
            echo "  ❌ migrate reset"
            echo "  ❌ migrate dev"
            echo "  ❌ db push --force-reset"
            echo "  ❌ db push --accept-data-loss"
            echo ""
            ;;
        *)
            # التحقق من الأوامر الخطرة
            check_dangerous_command "$@"
            # إذا لم يكن خطيراً، نفذه
            npx prisma "$@"
            ;;
    esac
}

# التنفيذ
if is_production; then
    safe_commands "$@"
else
    # في بيئة التطوير - تنفيذ مباشر مع تحذير
    echo -e "${YELLOW}[DEV MODE]${NC} تنفيذ: prisma $@"
    npx prisma "$@"
fi
