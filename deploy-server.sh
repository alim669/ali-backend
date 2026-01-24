#!/bin/bash
# ================================
# Ali Backend - Server Deployment Script
# سكربت النشر على السيرفر الألماني
# ================================
# 📌 شغّل هذا على السيرفر 167.235.64.220
# 📌 تأكد من تحديث المفاتيح السرية أولاً!

set -e

echo ""
echo "🚀 === Ali Backend - Server Deployment ==="
echo ""

# Configuration
APP_DIR="/var/www/ali"
BACKEND_DIR="$APP_DIR/backend"
UPLOADS_DIR="$APP_DIR/uploads"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# 1. Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}⚠️ يُفضل تشغيل هذا السكربت بـ sudo${NC}"
fi

# 2. Create directories
echo -e "${CYAN}1️⃣ إنشاء المجلدات...${NC}"
mkdir -p $APP_DIR
mkdir -p $BACKEND_DIR
mkdir -p $UPLOADS_DIR
chmod 755 $UPLOADS_DIR
echo -e "${GREEN}   ✅ تم إنشاء المجلدات${NC}"

# 3. Install Docker if not present
echo -e "\n${CYAN}2️⃣ فحص Docker...${NC}"
if command -v docker &> /dev/null; then
    echo -e "${GREEN}   ✅ Docker مثبت$(NC}"
else
    echo -e "${YELLOW}   📥 تثبيت Docker...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable docker
    systemctl start docker
    rm get-docker.sh
    echo -e "${GREEN}   ✅ تم تثبيت Docker${NC}"
fi

# 4. Install Docker Compose if not present
if command -v docker-compose &> /dev/null; then
    echo -e "${GREEN}   ✅ Docker Compose مثبت${NC}"
else
    echo -e "${YELLOW}   📥 تثبيت Docker Compose...${NC}"
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}   ✅ تم تثبيت Docker Compose${NC}"
fi

# 5. Copy production environment
echo -e "\n${CYAN}3️⃣ إعداد ملف البيئة...${NC}"
if [ -f "$BACKEND_DIR/.env.production.server" ]; then
    cp "$BACKEND_DIR/.env.production.server" "$BACKEND_DIR/.env"
    echo -e "${GREEN}   ✅ تم نسخ ملف البيئة${NC}"
else
    echo -e "${RED}   ❌ ملف .env.production.server غير موجود!${NC}"
    echo -e "${YELLOW}   📝 قم بإنشائه أولاً${NC}"
    exit 1
fi

# 6. Generate secure secrets (if using default)
echo -e "\n${CYAN}4️⃣ فحص المفاتيح السرية...${NC}"
if grep -q "CHANGE_THIS" "$BACKEND_DIR/.env"; then
    echo -e "${YELLOW}   ⚠️ المفاتيح السرية تحتاج تحديث!${NC}"
    echo -e "${YELLOW}   📝 قم بتحديث JWT_SECRET و JWT_REFRESH_SECRET في ملف .env${NC}"
    
    # Generate random secrets
    NEW_JWT_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 64)
    NEW_REFRESH_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 64)
    NEW_ENCRYPTION_KEY=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)
    
    echo -e "\n${CYAN}   🔐 مفاتيح مقترحة (انسخها إلى .env):${NC}"
    echo -e "   JWT_SECRET=$NEW_JWT_SECRET"
    echo -e "   JWT_REFRESH_SECRET=$NEW_REFRESH_SECRET"
    echo -e "   ENCRYPTION_KEY=$NEW_ENCRYPTION_KEY"
else
    echo -e "${GREEN}   ✅ المفاتيح السرية محدثة${NC}"
fi

# 7. Start services with Docker Compose
echo -e "\n${CYAN}5️⃣ تشغيل الخدمات...${NC}"
cd $BACKEND_DIR

# Stop existing containers
docker-compose -f docker-compose.prod.yml down 2>/dev/null || true

# Start new containers
docker-compose -f docker-compose.prod.yml up -d --build

echo -e "${GREEN}   ✅ تم تشغيل الخدمات${NC}"

# 8. Wait for database
echo -e "\n${CYAN}6️⃣ انتظار قاعدة البيانات...${NC}"
sleep 10

# 9. Run migrations
echo -e "\n${CYAN}7️⃣ تطبيق الـ migrations...${NC}"
docker-compose -f docker-compose.prod.yml exec -T backend npx prisma migrate deploy
echo -e "${GREEN}   ✅ تم تطبيق الـ migrations${NC}"

# 10. Show status
echo -e "\n${CYAN}8️⃣ حالة الخدمات...${NC}"
docker-compose -f docker-compose.prod.yml ps

# 11. Show logs command
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}🎉 تم النشر بنجاح!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}📊 أوامر مفيدة:${NC}"
echo -e "   ${CYAN}docker-compose -f docker-compose.prod.yml logs -f${NC}     # مشاهدة الـ logs"
echo -e "   ${CYAN}docker-compose -f docker-compose.prod.yml restart${NC}     # إعادة تشغيل"
echo -e "   ${CYAN}docker-compose -f docker-compose.prod.yml down${NC}        # إيقاف"
echo ""
echo -e "${YELLOW}🌐 الخدمات:${NC}"
echo -e "   API: http://167.235.64.220:3000"
echo -e "   Health: http://167.235.64.220:3000/health"
echo ""
