@echo off
setlocal EnableExtensions
rem Lance un seul serveur interne. Les autres postes ouvrent une URL vers ce serveur.
set "PATH=%APPDATA%\nvm\v24.5.0;%PATH%"
cd /d "%~dp0"
echo Node utilise :
node -v
call node scripts\migrate-local.mjs
if errorlevel 1 (pause & exit /b 1)

rem Si un serveur interne existe déjà, on le réutilise au lieu d'en lancer un second.
for /f "delims=" %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; foreach($p in 5173..5180){ try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 ('http://127.0.0.1:'+ $p +'/interne') | Out-Null; $p; break } catch {} }"') do set "DOLCE_POS_EXISTING_PORT=%%P"
if defined DOLCE_POS_EXISTING_PORT (
  echo Serveur interne deja actif sur http://localhost:%DOLCE_POS_EXISTING_PORT%/interne
  echo Pour les tablettes : http://ADRESSE-IP-DE-CE-PC:%DOLCE_POS_EXISTING_PORT%/interne
  exit /b 0
)

rem Choisit le premier port libre si 5173 est deja occupe par une autre application.
for /f "delims=" %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; foreach($p in 5173..5180){ $client=New-Object Net.Sockets.TcpClient; $busy=$false; try { $client.Connect('127.0.0.1',$p); $busy=$true } catch {} finally { $client.Dispose() }; if(-not $busy){ $p; break } }"') do set "DOLCE_POS_PORT=%%P"
if not defined DOLCE_POS_PORT (
  echo Aucun port libre entre 5173 et 5180.
  pause
  exit /b 1
)
set "DOLCE_POS_SERVER=http://localhost:%DOLCE_POS_PORT%"
echo Systeme interne disponible sur %DOLCE_POS_SERVER%/interne
echo Pour les tablettes : http://ADRESSE-IP-DE-CE-PC:%DOLCE_POS_PORT%/interne
call npm run dev:interne
pause
