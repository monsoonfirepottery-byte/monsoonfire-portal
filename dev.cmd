@echo off
title Monsoon Fire – Dev Launcher

set "PS_SCRIPT=D:\startdev.ps1"

if not exist "%PS_SCRIPT%" (
  echo ERROR: %PS_SCRIPT% not found.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"

pause
