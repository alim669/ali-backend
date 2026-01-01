#!/bin/bash
# ==============================================
# Ali App - Database Backup Script
# Runs daily via cron
# ==============================================

# Configuration
BACKUP_DIR="/var/www/backups"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
RETENTION_DAYS=7

# Database connection (Neon.tech)
DATABASE_URL="postgresql://neondb_owner:npg_Q8RoUudsZCH4@ep-round-math-a1nfcq45-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"

# Create backup directory if not exists
mkdir -p $BACKUP_DIR

# Backup filename
BACKUP_FILE="$BACKUP_DIR/ali_backup_$DATE.sql.gz"

echo "$(date): Starting database backup..."

# Perform backup using pg_dump
PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\([^@]*\)@.*/\1/p') \
pg_dump -h ep-round-math-a1nfcq45-pooler.ap-southeast-1.aws.neon.tech \
        -U neondb_owner \
        -d neondb \
        --no-password \
        | gzip > $BACKUP_FILE

if [ $? -eq 0 ]; then
    echo "$(date): Backup created successfully: $BACKUP_FILE"
    
    # Get file size
    SIZE=$(ls -lh $BACKUP_FILE | awk '{print $5}')
    echo "$(date): Backup size: $SIZE"
    
    # Delete old backups (older than RETENTION_DAYS)
    find $BACKUP_DIR -name "ali_backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete
    echo "$(date): Cleaned up backups older than $RETENTION_DAYS days"
else
    echo "$(date): ERROR - Backup failed!"
    exit 1
fi

echo "$(date): Backup completed successfully"
