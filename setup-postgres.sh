#!/bin/bash
# ===========================================
# PostgreSQL & Redis Setup Script for VPS
# Server: 167.235.64.220 (Hetzner)
# ===========================================

set -e

echo "🚀 Starting PostgreSQL & Redis Setup..."
echo "========================================"

# Update system
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install PostgreSQL 16
echo "🐘 Installing PostgreSQL 16..."
apt install -y postgresql-16 postgresql-contrib-16

# Start PostgreSQL
echo "▶️ Starting PostgreSQL service..."
systemctl enable postgresql
systemctl start postgresql

# Wait for PostgreSQL to be ready
sleep 3

# Create database and user
echo "👤 Creating database user and database..."
sudo -u postgres psql << EOF
CREATE USER ali_user WITH PASSWORD 'AliSecure2026DB';
CREATE DATABASE ali_db OWNER ali_user;
GRANT ALL PRIVILEGES ON DATABASE ali_db TO ali_user;
ALTER USER ali_user CREATEDB;
\c ali_db
GRANT ALL ON SCHEMA public TO ali_user;
EOF

# Install Redis
echo "📦 Installing Redis..."
apt install -y redis-server

# Configure Redis
echo "⚙️ Configuring Redis..."
sed -i 's/supervised no/supervised systemd/' /etc/redis/redis.conf

# Start Redis
echo "▶️ Starting Redis service..."
systemctl enable redis-server
systemctl start redis-server

# Verify installations
echo ""
echo "========================================"
echo "✅ Installation Complete!"
echo "========================================"
echo ""

# Check PostgreSQL
echo "🐘 PostgreSQL Status:"
systemctl status postgresql --no-pager | head -5
echo ""
psql --version

# Check Redis  
echo ""
echo "📦 Redis Status:"
systemctl status redis-server --no-pager | head -5
echo ""
redis-cli ping

echo ""
echo "========================================"
echo "📋 Connection Details:"
echo "========================================"
echo ""
echo "DATABASE_URL=\"postgresql://ali_user:AliSecure2026DB@localhost:5432/ali_db?schema=public\""
echo ""
echo "REDIS_HOST=localhost"
echo "REDIS_PORT=6379"
echo "REDIS_ENABLED=true"
echo ""
echo "========================================"
echo "🎉 Setup Complete! Update your .env file with the above values."
echo "========================================"
