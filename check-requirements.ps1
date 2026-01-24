# ================================
# Ali Backend - Pre-flight Check Script
# ================================

$ErrorActionPreference = "Continue"

function Write-Status {
    param([string]$Message, [string]$Status, [string]$Color = "White")
    $statusIcon = switch ($Status) {
        "ok" { "[OK]" }
        "warn" { "[!]" }
        "error" { "[X]" }
        "info" { "[i]" }
        default { "-" }
    }
    Write-Host "   $statusIcon $Message" -ForegroundColor $Color
}

Write-Host ""
Write-Host "=== Checking Requirements ===" -ForegroundColor Cyan
Write-Host ""

$allGood = $true

# 1. Check Node.js
Write-Host "1. Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    if ($nodeVersion) {
        Write-Status "Node.js: $nodeVersion" "ok" "Green"
    } else {
        throw "Not found"
    }
} catch {
    Write-Status "Node.js not installed!" "error" "Red"
    Write-Status "Download from: https://nodejs.org" "info" "Yellow"
    $allGood = $false
}

# 2. Check npm
Write-Host ""
Write-Host "2. Checking npm..." -ForegroundColor Yellow
try {
    $npmVersion = npm --version 2>$null
    if ($npmVersion) {
        Write-Status "npm: v$npmVersion" "ok" "Green"
    } else {
        throw "Not found"
    }
} catch {
    Write-Status "npm not available!" "error" "Red"
    $allGood = $false
}

# 3. Check Docker
Write-Host ""
Write-Host "3. Checking Docker..." -ForegroundColor Yellow
$dockerAvailable = $false
try {
    $dockerVersion = docker --version 2>$null
    if ($dockerVersion) {
        Write-Status "Docker installed" "ok" "Green"
        $dockerAvailable = $true
        
        # Check if Docker is running
        $dockerInfo = docker info 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Status "Docker is running" "ok" "Green"
        } else {
            Write-Status "Docker installed but not running - Start Docker Desktop" "warn" "Yellow"
        }
    } else {
        throw "Not found"
    }
} catch {
    Write-Status "Docker not installed" "warn" "Yellow"
    Write-Status "For local dev, download from: https://docker.com/products/docker-desktop" "info" "Gray"
    Write-Status "You can continue with Neon Cloud without Docker" "info" "Gray"
}

# 4. Check current directory
Write-Host ""
Write-Host "4. Checking project files..." -ForegroundColor Yellow
$backendPath = $PSScriptRoot
$packageJson = Join-Path $backendPath "package.json"
$prismaSchema = Join-Path $backendPath "prisma\schema.prisma"

if (Test-Path $packageJson) {
    Write-Status "package.json exists" "ok" "Green"
} else {
    Write-Status "package.json not found - make sure you are in backend folder" "error" "Red"
    $allGood = $false
}

if (Test-Path $prismaSchema) {
    Write-Status "prisma/schema.prisma exists" "ok" "Green"
} else {
    Write-Status "prisma/schema.prisma not found" "error" "Red"
    $allGood = $false
}

# 5. Check node_modules
Write-Host ""
Write-Host "5. Checking packages (node_modules)..." -ForegroundColor Yellow
$nodeModules = Join-Path $backendPath "node_modules"
if (Test-Path $nodeModules) {
    Write-Status "node_modules exists" "ok" "Green"
} else {
    Write-Status "node_modules not found - packages will be installed" "warn" "Yellow"
}

# 6. Check environment files
Write-Host ""
Write-Host "6. Checking environment files..." -ForegroundColor Yellow

$envFile = Join-Path $backendPath ".env"
$envLocal = Join-Path $backendPath ".env.local"
$envNeon = Join-Path $backendPath ".env.neon"
$envProd = Join-Path $backendPath ".env.production.server"

if (Test-Path $envFile) {
    Write-Status ".env exists (main config)" "ok" "Green"
} else {
    Write-Status ".env not found!" "error" "Red"
    $allGood = $false
}

if (Test-Path $envLocal) {
    Write-Status ".env.local exists (local dev)" "ok" "Green"
} else {
    Write-Status ".env.local not found (optional)" "info" "Gray"
}

if (Test-Path $envNeon) {
    Write-Status ".env.neon exists (Neon Cloud)" "ok" "Green"
} else {
    Write-Status ".env.neon not found (optional)" "info" "Gray"
}

if (Test-Path $envProd) {
    Write-Status ".env.production.server exists (production)" "ok" "Green"
} else {
    Write-Status ".env.production.server not found (optional)" "info" "Gray"
}

# 7. Check ports availability
Write-Host ""
Write-Host "7. Checking ports..." -ForegroundColor Yellow

$portsToCheck = @(3000, 5432, 6379, 5050)
$portNames = @{3000="Backend API"; 5432="PostgreSQL"; 6379="Redis"; 5050="PgAdmin"}

foreach ($port in $portsToCheck) {
    $connection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    $portName = $portNames[$port]
    if ($connection) {
        Write-Status "Port $port ($portName) is in use" "warn" "Yellow"
    } else {
        Write-Status "Port $port ($portName) is available" "ok" "Green"
    }
}

# 8. Summary
Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan

if ($allGood) {
    Write-Host "Everything is ready! You can start." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    if ($dockerAvailable) {
        Write-Host "   .\start-local.ps1    # Start local development (with Docker)" -ForegroundColor Cyan
    }
    Write-Host "   npm run start:dev    # Use current environment (Neon)" -ForegroundColor Cyan
} else {
    Write-Host "There are some issues that need fixing" -ForegroundColor Yellow
    Write-Host "   Check the errors above and fix them" -ForegroundColor White
}

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""
