@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "URL=%~1"
set "LABEL=%~2"
set "HEALTH_URL=%~3"
if "%URL%"=="" (
  echo URL d'ecran manquante.
  exit /b 2
)
if "%HEALTH_URL%"=="" set "HEALTH_URL=http://localhost:5173/interne"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%HEALTH_URL%' ^| Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  rem Sur le PC serveur, accepte automatiquement 5174 si 5173 est deja occupe.
  set "FALLBACK_HEALTH=%HEALTH_URL:5173=5174%"
  set "FALLBACK_URL=%URL:5173=5174%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '!FALLBACK_HEALTH!' ^| Out-Null; exit 0 } catch { exit 1 }"
  if not errorlevel 1 (
    echo Serveur interne detecte sur !FALLBACK_HEALTH!.
    set "HEALTH_URL=!FALLBACK_HEALTH!"
    set "URL=!FALLBACK_URL!"
  ) else (
    if /I "%HEALTH_URL%"=="http://localhost:5173/interne" (
      echo Le serveur interne n'est pas lance. Ouverture du serveur dans une fenetre dediee...
      start "Dolce Pizz - serveur interne" cmd /k call "%~dp0..\lancer-interne.cmd"
      timeout /t 5 /nobreak >nul
    ) else (
      echo Le serveur central n'est pas joignable : %HEALTH_URL%
      echo Verifiez le Wi-Fi prive et l'adresse dans config-interne.cmd.
      exit /b 3
    )
  )
)
echo Ouverture de l'ecran %LABEL%.
start "" "%URL%"
endlocal
