@echo off
cd /d "%~dp0"
node -e "if(require('sharp/package.json').version!==require('./package.json').dependencies.sharp)process.exit(1);require('sharp')" >nul 2>nul
if errorlevel 1 (
  call npm ci --omit=dev --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
node server.cjs
pause
