# ==================================================
# Ali Backend - Deployment Script with Firebase FCM
# سكريبت نشر محدث مع دعم Firebase
# ==================================================

Write-Host "🚀 Ali Backend - Production Deployment" -ForegroundColor Cyan
Write-Host "======================================`n" -ForegroundColor Cyan

# Check required files
$requiredFiles = @(".env.production", "firebase-service-account.json")
$missingFiles = @()

foreach ($file in $requiredFiles) {
    if (-not (Test-Path $file)) {
        $missingFiles += $file
    }
}

if ($missingFiles.Count -gt 0) {
    Write-Host "❌ Missing required files:" -ForegroundColor Red
    foreach ($file in $missingFiles) {
        Write-Host "   - $file" -ForegroundColor Yellow
    }
    
    if ($missingFiles -contains "firebase-service-account.json") {
        Write-Host "`n💡 Firebase Service Account file is required for push notifications." -ForegroundColor Yellow
        Write-Host "   Download it from: Firebase Console > Project Settings > Service Accounts" -ForegroundColor Gray
    }
    exit 1
}

Write-Host "✅ All required files found" -ForegroundColor Green

# Git pull latest changes
Write-Host "`n📥 Pulling latest changes..." -ForegroundColor Yellow
git pull origin main

# Stop existing containers
Write-Host "`n🛑 Stopping existing containers..." -ForegroundColor Yellow
docker-compose -f docker-compose.prod.yml --env-file .env.production down

# Build and start containers
Write-Host "`n🏗️ Building and starting containers..." -ForegroundColor Yellow
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Wait for backend to be ready
Write-Host "`n⏳ Waiting for backend to be ready..." -ForegroundColor Yellow
$attempts = 0
$maxAttempts = 60

while ($attempts -lt $maxAttempts) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/health" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ Backend is ready" -ForegroundColor Green
            break
        }
    } catch {
        # Ignore errors while waiting
    }
    $attempts++
    Write-Host "   Waiting... ($attempts/$maxAttempts)" -ForegroundColor Gray
    Start-Sleep -Seconds 2
}

if ($attempts -eq $maxAttempts) {
    Write-Host "❌ Backend failed to start. Check logs:" -ForegroundColor Red
    Write-Host "   docker-compose -f docker-compose.prod.yml logs backend" -ForegroundColor Yellow
    exit 1
}

# Run migrations
Write-Host "`n📊 Running database migrations..." -ForegroundColor Yellow
docker-compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy

# Test Firebase connection
Write-Host "`n🔥 Testing Firebase FCM connection..." -ForegroundColor Yellow
docker-compose -f docker-compose.prod.yml exec backend node -e "
const fs = require('fs');
try {
    const sa = JSON.parse(fs.readFileSync('/app/firebase-service-account.json'));
    console.log('✅ Firebase Project:', sa.project_id);
} catch(e) {
    console.log('⚠️ Firebase file not accessible:', e.message);
}
"

# Show status
Write-Host "`n📊 Container Status:" -ForegroundColor Yellow
docker-compose -f docker-compose.prod.yml ps

Write-Host "`n✅ Deployment complete!" -ForegroundColor Green
Write-Host "`n📋 Summary:" -ForegroundColor Cyan
Write-Host "   🌐 API: https://your-domain.com/api" -ForegroundColor White
Write-Host "   📚 Docs: https://your-domain.com/api/docs" -ForegroundColor White
Write-Host "   🔔 FCM: Enabled (Firebase HTTP v1)" -ForegroundColor White
Write-Host ""
