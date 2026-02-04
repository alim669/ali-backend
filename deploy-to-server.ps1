# ==================================================
# Ali Backend - Complete Server Deployment Script
# سكريبت نشر كامل للسيرفر الألماني
# ==================================================
# Server: 167.235.64.220
# ==================================================

param(
    [string]$ServerIP = "167.235.64.220",
    [string]$ServerUser = "root",
    [string]$RemotePath = "/opt/ali-backend"
)

Write-Host "🚀 Ali Backend - Server Deployment" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host "Server: $ServerUser@$ServerIP" -ForegroundColor Gray
Write-Host "Path: $RemotePath`n" -ForegroundColor Gray

# ================================
# Step 1: Check local files
# ================================
Write-Host "📋 Step 1: Checking local files..." -ForegroundColor Yellow

$requiredFiles = @(
    "firebase-service-account.json",
    ".env.production.server",
    "docker-compose.prod.yml",
    "Dockerfile"
)

$allFilesExist = $true
foreach ($file in $requiredFiles) {
    if (Test-Path $file) {
        Write-Host "   ✅ $file" -ForegroundColor Green
    } else {
        Write-Host "   ❌ $file - MISSING!" -ForegroundColor Red
        $allFilesExist = $false
    }
}

if (-not $allFilesExist) {
    Write-Host "`n❌ Missing required files. Cannot proceed." -ForegroundColor Red
    exit 1
}

# ================================
# Step 2: Create deployment package
# ================================
Write-Host "`n📦 Step 2: Creating deployment package..." -ForegroundColor Yellow

$deployDir = "deploy_temp"
if (Test-Path $deployDir) {
    Remove-Item $deployDir -Recurse -Force
}
New-Item -ItemType Directory -Path $deployDir | Out-Null

# Files to deploy
$filesToDeploy = @(
    "src",
    "prisma",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "nest-cli.json",
    "Dockerfile",
    "docker-compose.prod.yml",
    "firebase-service-account.json",
    ".env.production.server"
)

foreach ($file in $filesToDeploy) {
    if (Test-Path $file) {
        Copy-Item $file -Destination $deployDir -Recurse -Force
        Write-Host "   📄 $file" -ForegroundColor Gray
    }
}

# Rename .env file
Rename-Item "$deployDir\.env.production.server" ".env.production" -ErrorAction SilentlyContinue

Write-Host "   ✅ Package created" -ForegroundColor Green

# ================================
# Step 3: Upload to server
# ================================
Write-Host "`n📤 Step 3: Uploading to server..." -ForegroundColor Yellow

# Create remote directory
Write-Host "   Creating remote directory..." -ForegroundColor Gray
ssh "$ServerUser@$ServerIP" "mkdir -p $RemotePath"

# Upload files using rsync (faster) or scp
Write-Host "   Uploading files..." -ForegroundColor Gray
scp -r "$deployDir\*" "$ServerUser@$ServerIP`:$RemotePath/"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Upload failed!" -ForegroundColor Red
    Remove-Item $deployDir -Recurse -Force
    exit 1
}

Write-Host "   ✅ Files uploaded" -ForegroundColor Green

# Cleanup local temp
Remove-Item $deployDir -Recurse -Force

# ================================
# Step 4: Deploy on server
# ================================
Write-Host "`n🚀 Step 4: Deploying on server..." -ForegroundColor Yellow

$deployScript = @"
cd $RemotePath

echo '🛑 Stopping existing containers...'
docker-compose -f docker-compose.prod.yml down 2>/dev/null || true

echo '🏗️ Building containers...'
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d --build

echo '⏳ Waiting for backend...'
sleep 10

echo '📊 Running migrations...'
docker-compose -f docker-compose.prod.yml exec -T backend npx prisma migrate deploy

echo '🔥 Testing Firebase...'
docker-compose -f docker-compose.prod.yml exec -T backend node -e "
const fs = require('fs');
try {
    const sa = JSON.parse(fs.readFileSync('/app/firebase-service-account.json'));
    console.log('✅ Firebase Project:', sa.project_id);
} catch(e) {
    console.log('⚠️ Firebase:', e.message);
}
"

echo '📊 Container status:'
docker-compose -f docker-compose.prod.yml ps

echo '✅ Deployment complete!'
"@

ssh "$ServerUser@$ServerIP" $deployScript

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n⚠️ Some deployment steps may have failed. Check server logs." -ForegroundColor Yellow
} else {
    Write-Host "`n✅ Deployment successful!" -ForegroundColor Green
}

# ================================
# Summary
# ================================
Write-Host "`n📋 Deployment Summary" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan
Write-Host "   Server: $ServerIP" -ForegroundColor White
Write-Host "   API: http://$ServerIP`:3000/api/v1" -ForegroundColor White
Write-Host "   Health: http://$ServerIP`:3000/api/v1/health" -ForegroundColor White
Write-Host "   Docs: http://$ServerIP`:3000/api/docs" -ForegroundColor White
Write-Host "`n💡 To check logs:" -ForegroundColor Gray
Write-Host "   ssh $ServerUser@$ServerIP `"cd $RemotePath && docker-compose -f docker-compose.prod.yml logs -f backend`"" -ForegroundColor Gray
Write-Host ""
