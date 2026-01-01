#!/bin/bash
# ===========================================
# Ali Backend - Production Database Backup
# نسخ احتياطي لقاعدة البيانات
# ===========================================

set -e

# Configuration
BACKUP_DIR="/var/backups/ali-database"
RETENTION_DAYS=30
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/ali_backup_${DATE}.sql"

# Load environment
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Create backup directory
mkdir -p $BACKUP_DIR

echo "🔄 Starting database backup..."
echo "📅 Date: $(date)"

# Parse DATABASE_URL for pg_dump
# Format: postgresql://user:password@host:port/database?options
if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL not set!"
    exit 1
fi

# Extract connection details
DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
DB_PASS=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:\/]*\).*/\1/p')
DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

# Default port
DB_PORT=${DB_PORT:-5432}

echo "📦 Backing up database: $DB_NAME"
echo "🖥️ Host: $DB_HOST"

# Create backup with pg_dump
PGPASSWORD=$DB_PASS pg_dump \
    -h $DB_HOST \
    -p $DB_PORT \
    -U $DB_USER \
    -d $DB_NAME \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    -f $BACKUP_FILE

# Compress the backup
gzip $BACKUP_FILE
BACKUP_FILE="${BACKUP_FILE}.gz"

# Get file size
BACKUP_SIZE=$(ls -lh $BACKUP_FILE | awk '{print $5}')

echo "✅ Backup created: $BACKUP_FILE"
echo "📊 Size: $BACKUP_SIZE"

# Remove old backups
echo "🧹 Cleaning old backups (older than $RETENTION_DAYS days)..."
find $BACKUP_DIR -name "ali_backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete

# Count remaining backups
BACKUP_COUNT=$(ls -1 $BACKUP_DIR/ali_backup_*.sql.gz 2>/dev/null | wc -l)
echo "📁 Total backups: $BACKUP_COUNT"

# Optional: Upload to S3/Cloud Storage
# if [ ! -z "$AWS_S3_BUCKET" ]; then
#     echo "☁️ Uploading to S3..."
#     aws s3 cp $BACKUP_FILE s3://$AWS_S3_BUCKET/backups/
# fi

echo ""
echo "✅ Backup completed successfully!"
echo "================================================"
