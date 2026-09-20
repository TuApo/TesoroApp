@echo off
title Agente de huella - registro
if not exist "%~dp0agente.log" (
  echo   No hay registro todavia. El agente no ha arrancado nunca desde aqui.
  echo.
  pause
  exit /b
)
echo   Registro del agente. Ctrl+C para salir.
echo   ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Path '%~dp0agente.log' -Tail 40 -Wait"
