@echo off
setlocal
title Desinstalar agente de huella - TuApo

set "LANZADOR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TuApo - Agente de huella.cmd"

echo.
echo   Quitando el agente de huella
echo   ----------------------------

if exist "%LANZADOR%" (
  del /q "%LANZADOR%"
  echo   [OK] Ya no arranca con la sesion.
) else (
  echo   [--] No estaba instalado en la carpeta Inicio.
)

rem Se cierra la ventana de PowerShell que tenga el script cargado, no todas:
rem el usuario puede tener otras cosas abiertas.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*huellero-agente.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" 2>nul
echo   [OK] Agente detenido.
echo.
pause
