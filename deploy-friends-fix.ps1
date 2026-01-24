# Deploy Friends Fix Script
# هذا السكريبت يرفع التحديثات للسيرفر

$serverIP = "167.235.64.220"
$serverUser = "root"
$remotePath = "/root/ali-backend"

Write-Host "📦 Deploying friends.service.ts fix..." -ForegroundColor Cyan

# Copy the updated file
scp "src/modules/friends/friends.service.ts" "${serverUser}@${serverIP}:${remotePath}/src/modules/friends/"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ File uploaded successfully" -ForegroundColor Green
    
    # Restart the backend
    Write-Host "🔄 Restarting backend..." -ForegroundColor Cyan
    ssh "${serverUser}@${serverIP}" "cd ${remotePath} && npm run build && pm2 restart ali-backend"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Backend restarted successfully!" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to restart backend" -ForegroundColor Red
    }
} else {
    Write-Host "❌ Failed to upload file" -ForegroundColor Red
}
