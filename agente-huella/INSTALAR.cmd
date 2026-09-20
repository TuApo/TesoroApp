@echo off
title Instalar agente de huella - TuApo
cd /d "%~dp0"
if /i "%~1"=="/forzar" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Forzar
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
)
echo.
pause
