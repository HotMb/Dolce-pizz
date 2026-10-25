@echo off
setlocal
set "URL=http://localhost:5173/equipe/caisse?organizationId=dolce-pizza&locationId=ronchin"
call "%~dp0scripts\open-internal-screen.cmd" "%URL%" "Caisse"
endlocal
