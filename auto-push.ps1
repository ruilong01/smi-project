# ============================================================
#  auto-push.ps1  —  Watch project folder & auto-push to GitHub
#  Resource-friendly: read-only check first, writes only on change
# ============================================================

$ProjectPath = "C:\Users\65831\Documents\Codex\2026-07-02\you-are-helping-me-build-a"
$Branch      = "master"
$CommitMsg   = "auto: sync changes"
$PollSeconds = 10  # check every 10 seconds (read-only, very cheap)

Set-Location $ProjectPath

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  GitHub Auto-Push Watcher" -ForegroundColor Cyan
Write-Host "  Watching: $ProjectPath" -ForegroundColor Cyan
Write-Host "  Branch  : $Branch" -ForegroundColor Cyan
Write-Host "  Polling : every $PollSeconds seconds (read-only)" -ForegroundColor Cyan
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

    # Step 1: READ-ONLY check — does NOT write to disk at all
    # git status compares working tree vs HEAD in memory only
    $status = git status --short 2>&1

    if ($status) {
        # Step 2: Only NOW do we write (stage + commit + push)
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        $message   = "$CommitMsg [$timestamp]"

        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Changes detected:" -ForegroundColor Yellow
        $status | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }

        git add -A 2>&1 | Out-Null
        git commit -m $message 2>&1 | Out-Null

        $pushOutput = git push origin $Branch 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Pushed to GitHub!" -ForegroundColor Green
        } else {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Push failed:" -ForegroundColor Red
            Write-Host ($pushOutput | Out-String) -ForegroundColor Red
        }
        Write-Host ""
    }

    Start-Sleep -Seconds $PollSeconds
}
