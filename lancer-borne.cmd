@echo off
setlocal
if exist "%~dp0config-interne.cmd" call "%~dp0config-interne.cmd"
if "%DOLCE_POS_SERVER%"=="" set "DOLCE_POS_SERVER=http://localhost:5173"
set "URL=%DOLCE_POS_SERVER%/borne"
call "%~dp0scripts\open-internal-screen.cmd" "%URL%" "Borne client" "%DOLCE_POS_SERVER%/interne"
endlocal
