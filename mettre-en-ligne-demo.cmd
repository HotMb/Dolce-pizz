@echo off
rem Publishes the prototype to your Cloudflare account with Node 24 (installed by nvm).
rem Add --reconnexion to sign in to Cloudflare again (other account, or after verifying the e-mail).
set "PATH=%APPDATA%\nvm\v24.5.0;%PATH%"
cd /d "%~dp0"
node scripts\deploy-demo.mjs %*
pause
