# =============================================================================
# إعداد cron للنسخ الاحتياطي التلقائي
# =============================================================================
# قم بتنفيذ هذا الملف مرة واحدة لإعداد النسخ الاحتياطي التلقائي
# =============================================================================

# 1. نسخ ملفات السكربت
echo "📁 إنشاء المجلدات..."
mkdir -p /root/ali-app/backups
mkdir -p /root/ali-app/backend/scripts

# 2. نسخ السكربتات
echo "📄 نسخ السكربتات..."
cp backup.sh /root/ali-app/backend/scripts/
cp safe-deploy.sh /root/ali-app/backend/scripts/
cp prisma-safe.sh /root/ali-app/backend/scripts/

# 3. جعل السكربتات قابلة للتنفيذ
chmod +x /root/ali-app/backend/scripts/*.sh

# 4. إعداد cron للنسخ الاحتياطي كل ساعة
echo "⏰ إعداد cron job..."
(crontab -l 2>/dev/null; echo "0 * * * * /root/ali-app/backend/scripts/backup.sh backup >> /root/ali-app/backups/cron.log 2>&1") | crontab -

# 5. إنشاء alias للأوامر الآمنة
echo "🔧 إعداد aliases..."
cat >> ~/.bashrc << 'EOF'

# =============================================================================
# Ali App - أوامر آمنة
# =============================================================================
alias prisma-safe='/root/ali-app/backend/scripts/prisma-safe.sh'
alias deploy-safe='/root/ali-app/backend/scripts/safe-deploy.sh'
alias backup-now='/root/ali-app/backend/scripts/backup.sh backup'
alias backup-list='/root/ali-app/backend/scripts/backup.sh list'
alias backup-restore='/root/ali-app/backend/scripts/backup.sh restore'

# تحذير عند استخدام prisma مباشرة
prisma() {
    echo "⚠️  تحذير: استخدم 'prisma-safe' بدلاً من 'prisma' للأمان!"
    echo "   مثال: prisma-safe migrate deploy"
    echo ""
    read -p "هل تريد المتابعة على مسؤوليتك؟ (y/N): " CONFIRM
    if [ "$CONFIRM" == "y" ] || [ "$CONFIRM" == "Y" ]; then
        npx prisma "$@"
    fi
}
EOF

# 6. تطبيق التغييرات
source ~/.bashrc

echo ""
echo "✅ تم الإعداد بنجاح!"
echo ""
echo "الأوامر المتاحة الآن:"
echo "  prisma-safe      - أوامر Prisma الآمنة"
echo "  deploy-safe      - نشر آمن للتحديثات"
echo "  backup-now       - إنشاء نسخة احتياطية الآن"
echo "  backup-list      - عرض النسخ الاحتياطية"
echo "  backup-restore   - استعادة نسخة احتياطية"
echo ""
echo "النسخ الاحتياطي التلقائي: كل ساعة"
echo "مجلد النسخ: /root/ali-app/backups/"
