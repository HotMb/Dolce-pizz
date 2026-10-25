@echo off
setlocal
if exist "%~dp0config-interne.cmd" call "%~dp0config-interne.cmd"
if "%DOLCE_POS_SERVER%"=="" set "DOLCE_POS_SERVER=http://localhost:5173"
rem Le mode appareil permet au poste POS d'utiliser son jeton enrôlé
rem sans redemander une connexion SMS à chaque redémarrage.
set "URL=%DOLCE_POS_SERVER%/equipe/commande?device=1&channel=pos&organizationId=dolce-pizza&locationId=ronchin"
call "%~dp0scripts\open-internal-screen.cmd" "%URL%" "POS" "%DOLCE_POS_SERVER%/interne"
endlocal
