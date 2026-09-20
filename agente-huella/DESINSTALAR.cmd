@echo off
title Desinstalar agente de huella - TuApo
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" ^| Where-Object { $_.CommandLine -like '*huellero-agente*' } ^| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }; Get-ChildItem \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\" -Include '*uella*' -Recurse -EA SilentlyContinue ^| Remove-Item -Force; Write-Host '  Agente detenido y quitado del arranque.' -ForegroundColor Green"
echo.
pause
