# ============================================================
#  auto-push.ps1  —  Watch project folder & auto-push to GitHub
#  Usage: Right-click > "Run with PowerShell"  OR  .\auto-push.ps1
# ============================================================

$ProjectPath = $PSScriptRoot        # folder where this script lives
$Branch      = "master"             # matched to your actual GitHub branch
$CommitMsg   = "auto: sync changes" # default commit message prefix
$DebounceMs  = 3000                 # wait 3s after last change before pushing

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  GitHub Auto-Push Watcher" -ForegroundColor Cyan
Write-Host "  Watching: $ProjectPath" -ForegroundColor Cyan
Write-Host "  Branch  : $Branch" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Verify git is initialised ---
if (-not (Test-Path "$ProjectPath\.git")) {
    Write-Host "[ERROR] No git repo found in $ProjectPath" -ForegroundColor Red
    Write-Host "        Please run setup-git.ps1 first!" -ForegroundColor Yellow
    pause
    exit 1
}

# --- Set up FileSystemWatcher ---
$watcher                  = New-Object System.IO.FileSystemWatcher
$watcher.Path             = $ProjectPath
$watcher.IncludeSubdirectories = $true
$watcher.NotifyFilter     = [System.IO.NotifyFilters]::LastWrite `
                          -bor [System.IO.NotifyFilters]::FileName `
                          -bor [System.IO.NotifyFilters]::DirectoryName
$watcher.Filter           = "*.*"
$watcher.EnableRaisingEvents = $true

# Debounce timer — prevents multiple pushes for rapid saves
$script:timer = $null
$script:lastFile = ""

function Push-ToGitHub {
    Write-Host ""
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Changes detected — pushing to GitHub..." -ForegroundColor Yellow

    Set-Location $ProjectPath

    # Stage all changes
    git add -A 2>&1 | Out-Null

    # Check if there's anything to commit
    $status = git status --porcelain
    if (-not $status) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Nothing new to commit." -ForegroundColor Gray
        return
    }

    # Build commit message with timestamp
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $message   = "$CommitMsg [$timestamp]"

    git commit -m $message 2>&1 | Out-Null

    # Push
    $pushResult = git push origin $Branch 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ✅ Pushed successfully!" -ForegroundColor Green
    } else {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ❌ Push failed:" -ForegroundColor Red
        Write-Host $pushResult -ForegroundColor Red
    }
}

# Event handler with debounce
$action = {
    $path = $Event.SourceEventArgs.FullPath

    # Skip git internals and node_modules
    if ($path -match "\\.git\\" -or $path -match "\\node_modules\\") { return }

    $script:lastFile = $path

    # Reset debounce timer
    if ($script:timer) { $script:timer.Stop() }
    $script:timer = New-Object System.Timers.Timer
    $script:timer.Interval  = $using:DebounceMs
    $script:timer.AutoReset = $false
    $script:timer.Add_Elapsed({ Push-ToGitHub })
    $script:timer.Start()
}

# Register all change events
Register-ObjectEvent $watcher "Changed" -Action $action | Out-Null
Register-ObjectEvent $watcher "Created" -Action $action | Out-Null
Register-ObjectEvent $watcher "Deleted" -Action $action | Out-Null
Register-ObjectEvent $watcher "Renamed" -Action $action | Out-Null

Write-Host "✅ Watcher is running. Save any file to trigger an auto-push." -ForegroundColor Green
Write-Host "   Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

# Keep the script alive
try {
    while ($true) { Start-Sleep -Seconds 1 }
} finally {
    $watcher.EnableRaisingEvents = $false
    $watcher.Dispose()
    Write-Host "`nWatcher stopped." -ForegroundColor Gray
}
