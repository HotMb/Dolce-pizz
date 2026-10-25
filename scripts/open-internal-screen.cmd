@echo off
setlocal
set "URL=%~1"
set "LABEL=%~2"
if "%URL%"=="" (
  echo URL d'ecran manquante.
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:5173/interne' ^| Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo Le serveur interne n'est pas lance. Ouverture du serveur dans une fenetre dediee...
  start "Dolce Pizz - serveur interne" cmd /k call "%~dp0..\lancer-interne.cmd"
  timeout /t 5 /nobreak >nul
)
echo Ouverture de l'ecran %LABEL%.
start "" "%URL%"
endlocal
