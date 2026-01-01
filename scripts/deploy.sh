#!/bin/bash
# ===========================================
# Ali Backend - Production Deployment Script
# نص نشر احترافي للـ Backend
# ===========================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
APP_NAME="ali-backend"
APP_DIR="${HOME}/ali-backend"
BACKUP_DIR="/var/backups/ali-backend"
LOG_FILE="/var/log/ali-deploy.log"
HEALTH_URL="http://localhost:3000/api/v1/health"

# Functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a $LOG_FILE 2>/dev/null || echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a $LOG_FILE 2>/dev/null || echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a $LOG_FILE 2>/dev/null || echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check if running as correct user
if [ "$EUID" -eq 0 ]; then 
    error "Please don't run as root. Use a regular user with sudo."
fi

# Pre-deployment checks
pre_deploy_checks() {
    log "🔍 Running pre-deployment checks..."
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed"
    fi
    
    NODE_VERSION=$(node -v)
    log "Node.js version: $NODE_VERSION"
    
    # Check if PM2 is installed
    if ! command -v pm2 &> /dev/null; then
        log "Installing PM2..."
        npm install -g pm2
    fi
    
    # Check disk space (at least 500MB free)
    FREE_SPACE=$(df -m $APP_DIR 2>/dev/null | awk 'NR==2 {print $4}' || echo "10000")
    if [ "$FREE_SPACE" -lt 500 ]; then
        warn "Low disk space: ${FREE_SPACE}MB available"
    fi
    
    log "✅ Pre-deployment checks passed"
}

# Backup current deployment
backup_deployment() {
    log "📦 Creating backup..."
    
    mkdir -p $BACKUP_DIR 2>/dev/null || true
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.tar.gz"
    
    if [ -d "$APP_DIR/dist" ]; then
        tar -czf $BACKUP_FILE -C $APP_DIR dist package.json package-lock.json 2>/dev/null || true
        log "✅ Backup created: $BACKUP_FILE"
        
        # Keep only last 5 backups
        ls -t $BACKUP_DIR/backup_*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm 2>/dev/null || true
    else
        log "No existing deployment to backup"
    fi
}

# Navigate to project directory
cd $APP_DIR || { error "Project directory not found: $APP_DIR"; }

# Run pre-deployment checks
pre_deploy_checks

# Create backup
backup_deployment

log "📥 Pulling latest changes..."
git pull origin main

log "📦 Installing dependencies..."
npm ci --production=false

log "🔧 Generating Prisma client..."
npx prisma generate

log "🏗️ Building application..."
npm run build

log "📊 Running database migrations..."
npx prisma migrate deploy

log "🔄 Restarting application..."
if pm2 list | grep -q $APP_NAME; then
    pm2 reload $APP_NAME --update-env
else
    pm2 start ecosystem.config.json --env production
fi

pm2 save

log "⏳ Waiting for application to start..."
sleep 5

# Health check with retries
log "🏥 Running health check..."
MAX_RETRIES=10
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    HEALTH=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL 2>/dev/null || echo "000")
    
    if [ "$HEALTH" = "200" ]; then
        log "✅ Health check passed!"
        break
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    log "Waiting for application... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

if [ "$HEALTH" != "200" ]; then
    warn "Health check returned HTTP $HEALTH"
    log "Checking application logs..."
    pm2 logs $APP_NAME --lines 20 --nostream
fi

# Display status
echo ""
log "📊 Application Status:"
pm2 status $APP_NAME

echo ""
log "🎉 Deployment completed successfully!"
echo ""
