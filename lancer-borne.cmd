@echo off
setlocal
set "URL=http://localhost:5173/borne"
call "%~dp0scripts\open-internal-screen.cmd" "%URL%" "Borne client"
endlocal
