@echo off
cd /d "%~dp0"
start "" npm run dev
timeout /t 4 /nobreak >nul
start "" http://localhost:5173
