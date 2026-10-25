@echo off
setlocal
set "URL=http://localhost:5173/production?station=oven&organizationId=dolce-pizza&locationId=ronchin"
call "%~dp0scripts\open-internal-screen.cmd" "%URL%" "Four"
endlocal
