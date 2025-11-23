@echo off
cd /d "%~dp0"
echo Installing dependencies...
call npm install --legacy-peer-deps
echo Starting frontend server on http://localhost:5173
call npx --yes vite
pause
