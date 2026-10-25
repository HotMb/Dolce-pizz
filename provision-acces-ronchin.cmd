@echo off
setlocal
set "PATH=%APPDATA%\nvm\v24.5.0;%PATH%"
cd /d "%~dp0"
echo Provisionnement des acces des postes Dolce Pizz' - Ronchin
node -v
call npm run access:provision:ronchin
if errorlevel 1 (
  echo.
  echo Le provisionnement a echoue. Aucun jeton partiel ne doit etre utilise.
  pause
  exit /b 1
)
echo.
echo Copiez les jetons affiches dans les navigateurs des postes correspondants.
pause
