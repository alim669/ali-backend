#!/bin/bash
# ==============================================
# Ali App - Restore Database Script
# ==============================================

if [ -z "$1" ]; then
    echo "Usage: ./restore-db.sh <backup_file.sql.gz>"
    echo ""
    echo "Available backups:"
    ls -lh /var/www/backups/*.sql.gz 2>/dev/null || echo "No backups found"
    exit 1
fi

BACKUP_FILE=$1

if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "WARNING: This will restore the database from: $BACKUP_FILE"
echo "All current data will be REPLACED!"
read -p "Are you sure? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Restore cancelled"
    exit 0
fi

echo "$(date): Starting database restore..."

# Restore using psql
gunzip -c $BACKUP_FILE | PGPASSWORD=npg_Q8RoUudsZCH4 psql \
    -h ep-round-math-a1nfcq45-pooler.ap-southeast-1.aws.neon.tech \
    -U neondb_owner \
    -d neondb \
    --no-password

if [ $? -eq 0 ]; then
    echo "$(date): Database restored successfully!"
else
    echo "$(date): ERROR - Restore failed!"
    exit 1
fi
