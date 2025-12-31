#!/bin/bash

# ========================================
# Ali Backend - VPS Initial Setup Script
# Run this on a fresh Ubuntu 22.04 VPS
# ========================================

set -e

echo "🚀 Ali Backend - VPS Setup Script"
echo "=================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}❌ Please run as root (use sudo)${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Updating system packages...${NC}"
apt update && apt upgrade -y

echo -e "${YELLOW}📦 Installing essential packages...${NC}"
apt install -y curl wget git build-essential ufw fail2ban

# Install Node.js 20
echo -e "${YELLOW}📦 Installing Node.js 20...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
echo -e "${GREEN}✅ Node.js $(node -v) installed${NC}"

# Install PostgreSQL
echo -e "${YELLOW}📦 Installing PostgreSQL...${NC}"
apt install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql
echo -e "${GREEN}✅ PostgreSQL installed${NC}"

# Install Redis
echo -e "${YELLOW}📦 Installing Redis...${NC}"
apt install -y redis-server
systemctl enable redis-server
systemctl start redis-server
echo -e "${GREEN}✅ Redis installed${NC}"

# Install Nginx
echo -e "${YELLOW}📦 Installing Nginx...${NC}"
apt install -y nginx
systemctl enable nginx
echo -e "${GREEN}✅ Nginx installed${NC}"

# Install PM2
echo -e "${YELLOW}📦 Installing PM2...${NC}"
npm install -g pm2
echo -e "${GREEN}✅ PM2 installed${NC}"

# Install Certbot
echo -e "${YELLOW}📦 Installing Certbot...${NC}"
apt install -y certbot python3-certbot-nginx
echo -e "${GREEN}✅ Certbot installed${NC}"

# Configure Firewall
echo -e "${YELLOW}🔥 Configuring Firewall...${NC}"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
echo -e "${GREEN}✅ Firewall configured${NC}"

# Configure fail2ban
echo -e "${YELLOW}🛡️ Configuring fail2ban...${NC}"
systemctl enable fail2ban
systemctl start fail2ban
echo -e "${GREEN}✅ fail2ban configured${NC}"

# Create app user
echo -e "${YELLOW}👤 Creating application user...${NC}"
if id "ali" &>/dev/null; then
    echo "User 'ali' already exists"
else
    adduser --disabled-password --gecos "" ali
    usermod -aG sudo ali
    echo -e "${GREEN}✅ User 'ali' created${NC}"
fi

# Create directories
echo -e "${YELLOW}📁 Creating directories...${NC}"
mkdir -p /home/ali/ali-backend
mkdir -p /home/ali/backups
chown -R ali:ali /home/ali

# Setup PostgreSQL database
echo -e "${YELLOW}🗄️ Setting up PostgreSQL database...${NC}"
echo ""
echo -e "${BLUE}Enter a strong password for the database user:${NC}"
read -s DB_PASSWORD
echo ""

sudo -u postgres psql <<EOF
CREATE DATABASE ali_db;
CREATE USER ali_user WITH ENCRYPTED PASSWORD '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE ali_db TO ali_user;
ALTER DATABASE ali_db OWNER TO ali_user;
\c ali_db
GRANT ALL ON SCHEMA public TO ali_user;
EOF
echo -e "${GREEN}✅ Database created${NC}"

# Create .env template
echo -e "${YELLOW}📝 Creating .env template...${NC}"
cat > /home/ali/ali-backend/.env.template <<EOF
# ================================
# Ali Backend - Production Environment
# ================================

# Server
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL="postgresql://ali_user:YOUR_DB_PASSWORD@localhost:5432/ali_db?schema=public"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_ENABLED=true

# JWT (Generate with: openssl rand -base64 64)
JWT_SECRET=CHANGE_ME_USE_OPENSSL_RAND
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=CHANGE_ME_USE_OPENSSL_RAND
JWT_REFRESH_EXPIRES_IN=7d

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Rate Limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=100

# CORS
CORS_ORIGINS=https://yourapp.com

# Logging
LOG_LEVEL=info
EOF
chown ali:ali /home/ali/ali-backend/.env.template
echo -e "${GREEN}✅ .env template created at /home/ali/ali-backend/.env.template${NC}"

# Print summary
echo ""
echo "=========================================="
echo -e "${GREEN}🎉 VPS Setup Complete!${NC}"
echo "=========================================="
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Switch to ali user: su - ali"
echo "2. Clone your repository or upload code"
echo "3. Copy .env.template to .env and fill in values"
echo "4. Run: npm install && npm run build"
echo "5. Run: npx prisma migrate deploy"
echo "6. Run: pm2 start ecosystem.config.js"
echo "7. Configure Nginx with your domain"
echo "8. Get SSL: sudo certbot --nginx -d api.yourdomain.com"
echo ""
echo -e "${YELLOW}Database credentials:${NC}"
echo "  User: ali_user"
echo "  Database: ali_db"
echo "  Password: (the one you entered)"
echo ""
echo -e "${YELLOW}Important files:${NC}"
echo "  .env template: /home/ali/ali-backend/.env.template"
echo "  Nginx config: /etc/nginx/sites-available/"
echo "  Logs: /var/log/nginx/"
echo ""
