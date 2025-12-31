# Ali Backend - Quick Start Script
# Run this script in PowerShell to start development environment

Write-Host "🚀 Ali Backend - Quick Start" -ForegroundColor Cyan
Write-Host "============================`n" -ForegroundColor Cyan

# Check if Docker is running
Write-Host "📦 Checking Docker..." -ForegroundColor Yellow
$dockerStatus = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker is not running. Please start Docker Desktop first." -ForegroundColor Red
    exit 1
}
Write-Host "✅ Docker is running" -ForegroundColor Green

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "`n📥 Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to install dependencies" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Dependencies installed" -ForegroundColor Green
}

# Start Docker services
Write-Host "`n🐳 Starting PostgreSQL and Redis..." -ForegroundColor Yellow
docker-compose -f docker-compose.dev.yml up -d

# Wait for PostgreSQL to be ready
Write-Host "`n⏳ Waiting for PostgreSQL to be ready..." -ForegroundColor Yellow
$attempts = 0
$maxAttempts = 30
while ($attempts -lt $maxAttempts) {
    $result = docker exec ali_postgres_dev pg_isready -U ali_user -d ali_db 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ PostgreSQL is ready" -ForegroundColor Green
        break
    }
    $attempts++
    Start-Sleep -Seconds 1
}

if ($attempts -eq $maxAttempts) {
    Write-Host "❌ PostgreSQL failed to start" -ForegroundColor Red
    exit 1
}

# Generate Prisma client
Write-Host "`n🔧 Generating Prisma client..." -ForegroundColor Yellow
npm run prisma:generate

# Run migrations
Write-Host "`n📊 Running database migrations..." -ForegroundColor Yellow
npm run prisma:migrate

# Ask if user wants to seed
Write-Host "`n"
$seedChoice = Read-Host "Do you want to seed the database with sample data? (y/N)"
if ($seedChoice -eq "y" -or $seedChoice -eq "Y") {
    Write-Host "`n🌱 Seeding database..." -ForegroundColor Yellow
    npm run prisma:seed
}

# Start the server
Write-Host "`n🚀 Starting NestJS server..." -ForegroundColor Yellow
Write-Host "============================`n" -ForegroundColor Cyan
Write-Host "📡 Server will be available at: http://localhost:3000" -ForegroundColor Green
Write-Host "📚 Swagger docs: http://localhost:3000/api/docs" -ForegroundColor Green
Write-Host "🗄️ PgAdmin: http://localhost:5050 (admin@admin.com / admin)" -ForegroundColor Green
Write-Host "📊 Redis Commander: http://localhost:8081`n" -ForegroundColor Green

npm run start:dev
