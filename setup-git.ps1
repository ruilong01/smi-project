# ============================================================
#  setup-git.ps1  —  One-time setup: init git & connect to GitHub
#  Run this ONCE before using auto-push.ps1
# ============================================================

$ProjectPath = $PSScriptRoot
$RemoteURL   = "https://github.com/ruilong01/smi-project.git"
$Branch      = "main"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Git Setup Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $ProjectPath

# 1. Init git if not already done
if (-not (Test-Path "$ProjectPath\.git")) {
    Write-Host "[1/5] Initialising git repository..." -ForegroundColor Yellow
    git init
} else {
    Write-Host "[1/5] Git already initialised. Skipping." -ForegroundColor Gray
}

# 2. Set remote origin
$existingRemote = git remote get-url origin 2>$null
if ($existingRemote) {
    Write-Host "[2/5] Remote already set to: $existingRemote" -ForegroundColor Gray
    Write-Host "      Updating to: $RemoteURL" -ForegroundColor Yellow
    git remote set-url origin $RemoteURL
} else {
    Write-Host "[2/5] Adding remote origin: $RemoteURL" -ForegroundColor Yellow
    git remote add origin $RemoteURL
}

# 3. Stage all files
Write-Host "[3/5] Staging all files..." -ForegroundColor Yellow
git add -A

# 4. Initial commit
Write-Host "[4/5] Creating initial commit..." -ForegroundColor Yellow
git commit -m "Initial commit"

# 5. Push
Write-Host "[5/5] Pushing to GitHub ($Branch)..." -ForegroundColor Yellow
git branch -M $Branch
git push -u origin $Branch

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Setup complete! Your project is now on GitHub." -ForegroundColor Green
    Write-Host "   Now run auto-push.ps1 to enable automatic pushing." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ Push failed. Please check your GitHub credentials." -ForegroundColor Red
    Write-Host "   If asked for a password, use a Personal Access Token (PAT)." -ForegroundColor Yellow
    Write-Host "   Get one at: https://github.com/settings/tokens" -ForegroundColor Cyan
}

Write-Host ""
pause
