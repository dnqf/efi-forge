@echo off
title EFI Forge
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :missing_node

if not exist node_modules goto :install
goto :build_check

:install
echo Installing first-run dependencies...
call npm install
if errorlevel 1 goto :failed

:build_check
if exist dist\index.html goto :start
echo Building EFI Forge...
call npm run build
if errorlevel 1 goto :failed

:start
node scripts\serve.mjs
if errorlevel 1 goto :failed
exit /b 0

:missing_node
echo Node.js was not found. Install Node.js 22 or newer and try again.
pause
exit /b 1

:failed
echo.
echo EFI Forge failed to start. Keep this window open and copy the error above.
pause
exit /b 1
