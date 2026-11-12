@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.21.1 or newer from https://nodejs.org/ then run again.
  pause
  exit /b 1
)
if not exist node_modules call npm ci
if errorlevel 1 goto failed
if not exist node_modules\electron\dist\electron.exe node node_modules\electron\install.js
if errorlevel 1 goto failed
if not exist dist\client\index.html call npm run build
if errorlevel 1 goto failed
call npm run desktop
if errorlevel 1 goto failed
exit /b 0
:failed
echo Startup failed. Read the error above; data was not removed.
pause
exit /b 1
