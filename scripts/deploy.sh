#!/bin/bash

# ========================================
# Ali Backend - Quick Deploy Script
# ========================================

set -e

echo "🚀 Starting deployment..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as correct user
if [ "$EUID" -eq 0 ]; then 
    echo -e "${RED}❌ Please don't run as root. Use a regular user with sudo.${NC}"
    exit 1
fi

# Navigate to project directory
cd ~/ali-backend || { echo -e "${RED}❌ Project directory not found${NC}"; exit 1; }

echo -e "${YELLOW}📥 Pulling latest changes...${NC}"
git pull origin main

echo -e "${YELLOW}📦 Installing dependencies...${NC}"
npm ci --production=false

echo -e "${YELLOW}🔧 Generating Prisma client...${NC}"
npx prisma generate

echo -e "${YELLOW}🏗️ Building application...${NC}"
npm run build

echo -e "${YELLOW}📊 Running database migrations...${NC}"
npx prisma migrate deploy

echo -e "${YELLOW}🔄 Restarting application...${NC}"
pm2 restart ali-backend --update-env

echo -e "${YELLOW}⏳ Waiting for application to start...${NC}"
sleep 3

# Health check
echo -e "${YELLOW}🏥 Running health check...${NC}"
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/admin/system/health || echo "000")

if [ "$HEALTH" = "200" ] || [ "$HEALTH" = "401" ]; then
    echo -e "${GREEN}✅ Deployment successful! Application is running.${NC}"
    pm2 status ali-backend
else
    echo -e "${RED}❌ Health check failed (HTTP $HEALTH). Check logs:${NC}"
    pm2 logs ali-backend --lines 20
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 Deployment completed!${NC}"
echo ""
