#!/bin/bash
# ==============================================
# Ali App - Server Health Monitor
# Checks server status and sends alerts
# ==============================================

LOG_FILE="/var/log/server-monitor.log"
ALERT_FILE="/tmp/alert_sent"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> $LOG_FILE
}

# Check if service is running
check_service() {
    local service=$1
    if systemctl is-active --quiet $service 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

# Check PM2 process
check_pm2() {
    if pm2 list 2>/dev/null | grep -q "online"; then
        return 0
    else
        return 1
    fi
}

# Check disk space (alert if > 80%)
check_disk() {
    local usage=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
    if [ "$usage" -gt 80 ]; then
        return 1
    fi
    return 0
}

# Check memory (alert if > 90%)
check_memory() {
    local usage=$(free | grep Mem | awk '{print int($3/$2 * 100)}')
    if [ "$usage" -gt 90 ]; then
        return 1
    fi
    return 0
}

# Check API is responding
check_api() {
    local response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health 2>/dev/null)
    if [ "$response" = "200" ]; then
        return 0
    else
        return 1
    fi
}

# Main monitoring
ERRORS=""

# Check Nginx
if ! check_service nginx; then
    ERRORS="$ERRORS\n❌ Nginx is DOWN"
    log "ERROR: Nginx is not running"
    systemctl restart nginx
    log "Attempted to restart Nginx"
fi

# Check PostgreSQL (skip - using Neon.tech)
# Check Redis
if ! check_service redis-server; then
    ERRORS="$ERRORS\n❌ Redis is DOWN"
    log "ERROR: Redis is not running"
    systemctl restart redis-server
    log "Attempted to restart Redis"
fi

# Check PM2/Backend
if ! check_pm2; then
    ERRORS="$ERRORS\n❌ Backend is DOWN"
    log "ERROR: Backend is not running"
    cd /var/www/ali-backend && pm2 restart ali-backend
    log "Attempted to restart Backend"
fi

# Check Disk
if ! check_disk; then
    DISK_USAGE=$(df / | tail -1 | awk '{print $5}')
    ERRORS="$ERRORS\n⚠️ Disk usage is high: $DISK_USAGE"
    log "WARNING: Disk usage is $DISK_USAGE"
fi

# Check Memory
if ! check_memory; then
    MEM_USAGE=$(free | grep Mem | awk '{print int($3/$2 * 100)}')
    ERRORS="$ERRORS\n⚠️ Memory usage is high: ${MEM_USAGE}%"
    log "WARNING: Memory usage is ${MEM_USAGE}%"
fi

# Summary
if [ -z "$ERRORS" ]; then
    log "OK: All systems operational"
    rm -f $ALERT_FILE
else
    log "ALERT: Issues detected - $ERRORS"
    echo -e "🚨 Server Alert 🚨\n$ERRORS\n\nTime: $(date)" > /tmp/current_alert.txt
fi
