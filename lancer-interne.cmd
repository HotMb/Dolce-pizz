@echo off
rem Lance uniquement le système interne de la pizzeria sur le réseau local.
set "PATH=%APPDATA%\nvm\v24.5.0;%PATH%"
cd /d "%~dp0"
echo Node utilise :
node -v
call node scripts\migrate-local.mjs
if errorlevel 1 (pause & exit /b 1)
echo Systeme interne disponible sur http://localhost:5173/interne
echo Pour les tablettes : http://ADRESSE-IP-DE-CE-PC:5173/interne
call npm run dev:interne
pause
