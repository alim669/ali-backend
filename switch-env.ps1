# ================================
# Ali Backend - Environment Switcher
# Usage:
#   .\switch-env.ps1 local    - For local development (Docker)
#   .\switch-env.ps1 neon     - For development with Neon Cloud
#   .\switch-env.ps1 prod     - For production (don't use locally)
#   .\switch-env.ps1 status   - Show current status
# ================================

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("local", "neon", "prod", "status")]
    [string]$Environment
)

$BackendPath = $PSScriptRoot
$EnvFile = Join-Path $BackendPath ".env"

function Show-Status {
    Write-Host ""
    Write-Host "=== Environment Status ===" -ForegroundColor Cyan
    
    # Check current .env
    if (Test-Path $EnvFile) {
        $content = Get-Content $EnvFile -Raw
        if ($content -match "DATABASE_URL.*localhost") {
            Write-Host "   [OK] Current: LOCAL (Docker)" -ForegroundColor Green
        } elseif ($content -match "DATABASE_URL.*neon\.tech") {
            Write-Host "   [OK] Current: NEON (Cloud)" -ForegroundColor Yellow
        } elseif ($content -match "NODE_ENV=production") {
            Write-Host "   [OK] Current: PRODUCTION" -ForegroundColor Magenta
        } else {
            Write-Host "   [?] Current: Unknown" -ForegroundColor Red
        }
    } else {
        Write-Host "   [X] No .env file found" -ForegroundColor Red
    }
    
    # Check Docker status
    Write-Host ""
    Write-Host "Docker Status:" -ForegroundColor Cyan
    try {
        $containers = docker ps --format "{{.Names}}" 2>$null | Where-Object { $_ -match "ali_" }
        if ($containers) {
            foreach ($container in $containers) {
                Write-Host "   [OK] $container is running" -ForegroundColor Green
            }
        } else {
            Write-Host "   [-] No Ali containers running" -ForegroundColor Gray
        }
    } catch {
        Write-Host "   [!] Docker not available" -ForegroundColor Yellow
    }
    
    Write-Host ""
}

function Switch-ToLocal {
    Write-Host ""
    Write-Host "Switching to LOCAL environment..." -ForegroundColor Cyan
    
    $LocalEnv = Join-Path $BackendPath ".env.local"
    
    if (-not (Test-Path $LocalEnv)) {
        Write-Host "   [X] .env.local file not found!" -ForegroundColor Red
        return
    }
    
    # Backup current .env
    if (Test-Path $EnvFile) {
        $backup = Join-Path $BackendPath ".env.backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Copy-Item $EnvFile $backup
        Write-Host "   [OK] Backup saved: $backup" -ForegroundColor Gray
    }
    
    # Copy local env
    Copy-Item $LocalEnv $EnvFile -Force
    Write-Host "   [OK] Switched to LOCAL environment" -ForegroundColor Green
    
    # Start Docker containers
    Write-Host ""
    Write-Host "Starting Docker containers..." -ForegroundColor Cyan
    $dockerCompose = Join-Path $BackendPath "docker-compose.local.yml"
    
    if (Test-Path $dockerCompose) {
        try {
            Push-Location $BackendPath
            docker-compose -f docker-compose.local.yml up -d
            Pop-Location
            Write-Host "   [OK] Containers started" -ForegroundColor Green
            
            # Wait for PostgreSQL
            Write-Host ""
            Write-Host "Waiting for database..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
            
            # Run migrations
            Write-Host ""
            Write-Host "Applying migrations..." -ForegroundColor Cyan
            Push-Location $BackendPath
            npx prisma generate 2>$null
            npx prisma db push --accept-data-loss 2>$null
            Pop-Location
            Write-Host "   [OK] Migrations applied" -ForegroundColor Green
            
        } catch {
            Write-Host "   [!] Docker error: $_" -ForegroundColor Red
        }
    } else {
        Write-Host "   [!] docker-compose.local.yml not found" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "LOCAL environment ready!" -ForegroundColor Green
    Write-Host "   PostgreSQL: localhost:5432" -ForegroundColor Cyan
    Write-Host "   Redis: localhost:6379" -ForegroundColor Cyan
    Write-Host "   PgAdmin: http://localhost:5050" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "   Run Backend: npm run start:dev" -ForegroundColor Yellow
}

function Switch-ToNeon {
    Write-Host ""
    Write-Host "Switching to NEON Cloud..." -ForegroundColor Cyan
    
    $NeonEnv = Join-Path $BackendPath ".env.neon"
    
    if (-not (Test-Path $NeonEnv)) {
        Write-Host "   [X] .env.neon file not found!" -ForegroundColor Red
        return
    }
    
    # Backup current .env
    if (Test-Path $EnvFile) {
        $backup = Join-Path $BackendPath ".env.backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Copy-Item $EnvFile $backup
        Write-Host "   [OK] Backup saved" -ForegroundColor Gray
    }
    
    # Copy neon env
    Copy-Item $NeonEnv $EnvFile -Force
    Write-Host "   [OK] Switched to NEON Cloud" -ForegroundColor Green
    
    # Generate Prisma client
    Write-Host ""
    Write-Host "Updating Prisma client..." -ForegroundColor Cyan
    Push-Location $BackendPath
    npx prisma generate
    Pop-Location
    
    Write-Host ""
    Write-Host "NEON Cloud ready!" -ForegroundColor Green
    Write-Host "   Database: Neon (Singapore)" -ForegroundColor Cyan
    Write-Host "   Note: Queries may be slower due to distance" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   Run Backend: npm run start:dev" -ForegroundColor Yellow
}

function Switch-ToProd {
    Write-Host ""
    Write-Host "WARNING: This is for PRODUCTION only!" -ForegroundColor Red
    Write-Host "   Do not use this locally" -ForegroundColor Yellow
    Write-Host "   Use this file on the German server only" -ForegroundColor Yellow
    
    $confirm = Read-Host "Are you sure? (yes/no)"
    if ($confirm -ne "yes") {
        Write-Host "   [X] Cancelled" -ForegroundColor Red
        return
    }
    
    $ProdEnv = Join-Path $BackendPath ".env.production.server"
    
    if (-not (Test-Path $ProdEnv)) {
        Write-Host "   [X] .env.production.server not found!" -ForegroundColor Red
        return
    }
    
    # Backup current .env
    if (Test-Path $EnvFile) {
        $backup = Join-Path $BackendPath ".env.backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Copy-Item $EnvFile $backup
    }
    
    Copy-Item $ProdEnv $EnvFile -Force
    Write-Host "   [OK] Switched to PRODUCTION environment" -ForegroundColor Magenta
}

# Main execution
switch ($Environment) {
    "local" { Switch-ToLocal }
    "neon" { Switch-ToNeon }
    "prod" { Switch-ToProd }
    "status" { Show-Status }
}

Write-Host ""
