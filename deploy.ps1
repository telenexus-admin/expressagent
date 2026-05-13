# deploy.ps1 — Deploy expresnet-agent to DigitalOcean Ubuntu droplet
# Usage: .\deploy.ps1
#        .\deploy.ps1 -SshKeyPath "C:\Users\Administrator\.ssh\my_key"
param(
    [string]$SshKeyPath = "$env:USERPROFILE\.ssh\id_rsa"
)

$ErrorActionPreference = "Stop"

$SERVER_IP   = "139.59.36.247"
$SERVER_USER = "root"
$PROJECT_DIR = "C:\Users\Administrator\Downloads\expresnet agent"
$ARCHIVE     = "$env:TEMP\expresnet-agent.tar.gz"
$STAGE_DIR   = "$env:TEMP\expresnet-stage"

# Verify SSH private key exists
if (-not (Test-Path $SshKeyPath)) {
    Write-Host "ERROR: SSH private key not found at: $SshKeyPath" -ForegroundColor Red
    Write-Host "Specify the correct path with: .\deploy.ps1 -SshKeyPath C:\path\to\key" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "==> Staging project files (excluding node_modules and dist)..." -ForegroundColor Cyan

# Clean and recreate staging directory
if (Test-Path $STAGE_DIR) { Remove-Item -Recurse -Force $STAGE_DIR }
New-Item -ItemType Directory -Path $STAGE_DIR | Out-Null

# robocopy returns 0 (nothing copied) or 1 (files copied) on success; >7 is an error
robocopy "$PROJECT_DIR\backend"  "$STAGE_DIR\backend"  /E /XD "node_modules" ".git" /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -gt 7) { Write-Host "ERROR: Failed to stage backend (robocopy code $LASTEXITCODE)" -ForegroundColor Red; exit 1 }

robocopy "$PROJECT_DIR\frontend" "$STAGE_DIR\frontend" /E /XD "node_modules" "dist" ".git" /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -gt 7) { Write-Host "ERROR: Failed to stage frontend (robocopy code $LASTEXITCODE)" -ForegroundColor Red; exit 1 }

# Copy any root-level files
foreach ($f in @("docker-compose.yml", "README.md")) {
    $src = Join-Path $PROJECT_DIR $f
    if (Test-Path $src) { Copy-Item $src "$STAGE_DIR\" }
}

Write-Host "==> Creating tar archive..." -ForegroundColor Cyan
if (Test-Path $ARCHIVE) { Remove-Item $ARCHIVE }
Push-Location $STAGE_DIR
tar -czf $ARCHIVE .
Pop-Location
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: tar failed. Ensure tar.exe is available (Windows 10+ required)." -ForegroundColor Red; exit 1 }
Remove-Item -Recurse -Force $STAGE_DIR

$archiveSizeMB = [math]::Round((Get-Item $ARCHIVE).Length / 1MB, 1)
Write-Host "   Archive size: ${archiveSizeMB} MB" -ForegroundColor Gray

Write-Host "==> Uploading archive to ${SERVER_IP}..." -ForegroundColor Cyan
scp -i $SshKeyPath -o StrictHostKeyChecking=accept-new $ARCHIVE "${SERVER_USER}@${SERVER_IP}:/tmp/expresnet-agent.tar.gz"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: SCP upload failed." -ForegroundColor Red; exit 1 }

Write-Host "==> Uploading server setup script..." -ForegroundColor Cyan
scp -i $SshKeyPath "$PROJECT_DIR\server-setup.sh" "${SERVER_USER}@${SERVER_IP}:/tmp/server-setup.sh"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: SCP script upload failed." -ForegroundColor Red; exit 1 }

Write-Host "==> Running server setup on droplet (takes ~5 minutes)..." -ForegroundColor Cyan
Write-Host "    You will see live output from the remote server below." -ForegroundColor Gray
Write-Host ""
ssh -i $SshKeyPath "${SERVER_USER}@${SERVER_IP}" "sed -i 's/\r//' /tmp/server-setup.sh && chmod +x /tmp/server-setup.sh && bash /tmp/server-setup.sh"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Server setup script failed." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "All done! Open your browser and visit: http://$SERVER_IP" -ForegroundColor Green
