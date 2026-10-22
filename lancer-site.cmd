@echo off
rem Starts the Dolce Pizz' site locally with Node 24 (installed by nvm) without changing the system Node.
set "PATH=%APPDATA%\nvm\v24.5.0;%PATH%"
cd /d "%~dp0"
echo Node utilise :
node -v
call node scripts\migrate-local.mjs
if errorlevel 1 (pause & exit /b 1)
echo Site disponible sur http://localhost:5173 (Ctrl+C pour arreter)
call npm run dev
pause
