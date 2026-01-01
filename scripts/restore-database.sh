#!/bin/bash
# ===========================================
# Ali Backend - Database Restore Script
# استعادة قاعدة البيانات من نسخة احتياطية
# ===========================================

set -e

BACKUP_DIR="/var/backups/ali-database"

# Load environment
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Check for backup file argument
if [ -z "$1" ]; then
    echo "Usage: $0 <backup_file.sql.gz>"
    echo ""
    echo "Available backups:"
    ls -lh $BACKUP_DIR/ali_backup_*.sql.gz 2>/dev/null || echo "No backups found"
    exit 1
fi

BACKUP_FILE=$1

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "⚠️  WARNING: This will restore the database from backup!"
echo "📦 Backup file: $BACKUP_FILE"
echo ""
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "❌ Restore cancelled"
    exit 1
fi

# Parse DATABASE_URL
DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
DB_PASS=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:\/]*\).*/\1/p')
DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

DB_PORT=${DB_PORT:-5432}

echo "🔄 Restoring database..."

# Decompress and restore
gunzip -c $BACKUP_FILE | PGPASSWORD=$DB_PASS psql \
    -h $DB_HOST \
    -p $DB_PORT \
    -U $DB_USER \
    -d $DB_NAME \
    --quiet

echo "✅ Database restored successfully!"
echo ""
echo "🔄 Run 'npx prisma migrate deploy' to ensure migrations are up to date"
