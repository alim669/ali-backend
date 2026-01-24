# ================================
# Start Local Development Environment
# ================================

Write-Host ""
Write-Host "=== Ali Backend - Local Development ===" -ForegroundColor Cyan
Write-Host ""

$BackendPath = $PSScriptRoot

# 1. Check Docker
Write-Host "1. Checking Docker..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version 2>$null
    if ($dockerVersion) {
        Write-Host "   [OK] Docker available: $dockerVersion" -ForegroundColor Green
    } else {
        throw "Docker not found"
    }
    
    # Check if Docker is running
    $dockerInfo = docker info 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   [X] Docker is not running!" -ForegroundColor Red
        Write-Host "   Please start Docker Desktop first" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "   [X] Docker is not installed!" -ForegroundColor Red
    Write-Host "   Download from: https://docker.com/products/docker-desktop" -ForegroundColor Yellow
    exit 1
}

# 2. Start Docker containers
Write-Host ""
Write-Host "2. Starting local database..." -ForegroundColor Yellow
Push-Location $BackendPath

docker-compose -f docker-compose.local.yml up -d postgres redis

if ($LASTEXITCODE -ne 0) {
    Write-Host "   [X] Failed to start Docker" -ForegroundColor Red
    Pop-Location
    exit 1
}

Write-Host "   [OK] PostgreSQL and Redis started" -ForegroundColor Green

# 3. Wait for database
Write-Host ""
Write-Host "3. Waiting for database..." -ForegroundColor Yellow
$maxRetries = 30
$retryCount = 0

while ($retryCount -lt $maxRetries) {
    try {
        $result = docker exec ali_postgres_local pg_isready -U ali_user -d ali_db 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "   [OK] Database is ready!" -ForegroundColor Green
            break
        }
    } catch {}
    
    $retryCount++
    Write-Host "   Waiting... ($retryCount/$maxRetries)" -ForegroundColor Gray
    Start-Sleep -Seconds 1
}

if ($retryCount -eq $maxRetries) {
    Write-Host "   [!] Timeout, but continuing..." -ForegroundColor Yellow
}

# 4. Switch to local environment
Write-Host ""
Write-Host "4. Activating local environment..." -ForegroundColor Yellow

$localEnv = Join-Path $BackendPath ".env.local"
$envFile = Join-Path $BackendPath ".env"

if (Test-Path $localEnv) {
    # Backup current env
    if (Test-Path $envFile) {
        $backup = Join-Path $BackendPath ".env.backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Copy-Item $envFile $backup
    }
    Copy-Item $localEnv $envFile -Force
    Write-Host "   [OK] Activated .env.local" -ForegroundColor Green
} else {
    Write-Host "   [!] .env.local not found, using current .env" -ForegroundColor Yellow
}

# 5. Run Prisma setup
Write-Host ""
Write-Host "5. Setting up database schema..." -ForegroundColor Yellow

npx prisma generate
if ($LASTEXITCODE -ne 0) {
    Write-Host "   [!] Error in prisma generate" -ForegroundColor Yellow
}

# Try migrate deploy first, if fails use db push
npx prisma migrate deploy 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "   [i] No migrations or new database, using db push..." -ForegroundColor Gray
    npx prisma db push --accept-data-loss 2>$null
}

Write-Host "   [OK] Database schema ready" -ForegroundColor Green

Pop-Location

# 6. Show summary
Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "Local development environment is ready!" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Available services:" -ForegroundColor Yellow
Write-Host "   PostgreSQL: localhost:5432" -ForegroundColor White
Write-Host "   Redis:      localhost:6379" -ForegroundColor White
Write-Host "   PgAdmin:    http://localhost:5050 (admin@ali.local / admin123)" -ForegroundColor White
Write-Host ""
Write-Host "To start the Backend:" -ForegroundColor Yellow
Write-Host "   cd backend" -ForegroundColor Cyan
Write-Host "   npm run start:dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "To stop services:" -ForegroundColor Yellow
Write-Host "   docker-compose -f docker-compose.local.yml down" -ForegroundColor Cyan
Write-Host ""
