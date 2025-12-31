# Ali Backend - Production Deployment Script
# Run this script on your VPS to deploy

Write-Host "🚀 Ali Backend - Production Deployment" -ForegroundColor Cyan
Write-Host "======================================`n" -ForegroundColor Cyan

# Check if .env.production exists
if (-not (Test-Path ".env.production")) {
    Write-Host "❌ .env.production file not found!" -ForegroundColor Red
    Write-Host "Please create .env.production with your production settings" -ForegroundColor Yellow
    exit 1
}

# Stop existing containers
Write-Host "🛑 Stopping existing containers..." -ForegroundColor Yellow
docker-compose --env-file .env.production down

# Pull latest changes (if using git)
Write-Host "`n📥 Pulling latest changes..." -ForegroundColor Yellow
git pull origin main

# Build and start containers
Write-Host "`n🏗️ Building and starting containers..." -ForegroundColor Yellow
docker-compose --env-file .env.production up -d --build

# Wait for backend to be ready
Write-Host "`n⏳ Waiting for backend to be ready..." -ForegroundColor Yellow
$attempts = 0
$maxAttempts = 60
while ($attempts -lt $maxAttempts) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/admin/system/health" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ Backend is ready" -ForegroundColor Green
            break
        }
    } catch {
        # Ignore errors while waiting
    }
    $attempts++
    Start-Sleep -Seconds 2
}

if ($attempts -eq $maxAttempts) {
    Write-Host "❌ Backend failed to start. Check logs with: docker-compose logs backend" -ForegroundColor Red
    exit 1
}

# Run migrations
Write-Host "`n📊 Running database migrations..." -ForegroundColor Yellow
docker-compose exec backend npx prisma migrate deploy

# Show status
Write-Host "`n📊 Container Status:" -ForegroundColor Yellow
docker-compose ps

Write-Host "`n✅ Deployment complete!" -ForegroundColor Green
Write-Host "🌐 API: https://api.yourdomain.com" -ForegroundColor Cyan
Write-Host "📚 Docs: https://api.yourdomain.com/api/docs`n" -ForegroundColor Cyan
