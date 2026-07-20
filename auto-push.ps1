# ============================================================
#  auto-push.ps1  —  Watch project folder & auto-push to GitHub
#  Uses git itself to detect changes (most reliable method)
# ============================================================

$ProjectPath = "C:\Users\65831\Documents\Codex\2026-07-02\you-are-helping-me-build-a"
$Branch      = "master"
$CommitMsg   = "auto: sync changes"
$PollSeconds = 5   # check for changes every 5 seconds

Set-Location $ProjectPath

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  GitHub Auto-Push Watcher" -ForegroundColor Cyan
Write-Host "  Watching: $ProjectPath" -ForegroundColor Cyan
Write-Host "  Branch  : $Branch" -ForegroundColor Cyan
Write-Host "  Polling : every $PollSeconds seconds" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verify git is set up
if (-not (Test-Path "$ProjectPath\.git")) {
    Write-Host "[ERROR] No git repo found. Run setup-git.ps1 first!" -ForegroundColor Red
    pause
    exit 1
}

Write-Host "Watcher is running. Press Ctrl+C to stop." -ForegroundColor Green
Write-Host ""

while ($true) {
    Set-Location $ProjectPath

    # Stage everything
    git add -A 2>&1 | Out-Null

    # Check if there's anything new to commit
    $status = git status --porcelain 2>&1
    if ($status) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        $message   = "$CommitMsg [$timestamp]"

        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Changes detected:" -ForegroundColor Yellow
        $status | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }

        # Commit
        git commit -m $message 2>&1 | Out-Null

        # Push
        $pushOutput = git push origin $Branch 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Pushed successfully to GitHub!" -ForegroundColor Green
        } else {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Push failed:" -ForegroundColor Red
            Write-Host ($pushOutput | Out-String) -ForegroundColor Red
        }
        Write-Host ""
    }

    Start-Sleep -Seconds $PollSeconds
}
