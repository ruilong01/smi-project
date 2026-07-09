@echo off
setlocal

cd /d "%~dp0\.."

set "REMOTE_URL=https://github.com/ruilong01/smi-project.git"
set "TARGET_BRANCH=main"
set "COMMIT_MSG=%~1"

if "%COMMIT_MSG%"=="" (
  set "COMMIT_MSG=Update maritime intelligence project"
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo This folder is not a Git repository.
  exit /b 1
)

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin "%REMOTE_URL%"
) else (
  git remote set-url origin "%REMOTE_URL%"
)

git add -A
git diff --cached --quiet
if not errorlevel 1 (
  echo No changes to commit.
  exit /b 0
)

cmd /c npm test -- --run
if errorlevel 1 exit /b 1

cmd /c npm run build
if errorlevel 1 exit /b 1

git commit -m "%COMMIT_MSG%"
if errorlevel 1 exit /b 1

git push -u origin HEAD:%TARGET_BRANCH%
if errorlevel 1 exit /b 1

echo Pushed to %REMOTE_URL% on branch %TARGET_BRANCH%.
