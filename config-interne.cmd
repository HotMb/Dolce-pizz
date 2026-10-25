@echo off
rem Adresse du PC qui heberge le serveur interne.
rem Sur le PC serveur, le script detecte automatiquement 5173, 5174, etc.
rem Sur une tablette distante, remplacez la valeur par l'adresse affichee par lancer-interne.cmd.
if not defined DOLCE_POS_SERVER set "DOLCE_POS_SERVER=http://localhost:5173"
if /I "%DOLCE_POS_SERVER%"=="http://localhost:5173" (
  for /f "delims=" %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; foreach($p in 5173..5180){ try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 ('http://127.0.0.1:'+ $p +'/interne') | Out-Null; $p; break } catch {} }"') do set "DOLCE_POS_SERVER=http://localhost:%%P"
)
