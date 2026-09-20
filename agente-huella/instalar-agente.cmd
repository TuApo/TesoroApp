@echo off
setlocal
title Instalar agente de huella - TuApo

rem ---------------------------------------------------------------------------
rem  Deja el agente arrancando solo con la sesion del usuario.
rem
rem  Se usa la carpeta Inicio y NO una tarea programada ni un servicio:
rem   - una tarea en la raiz del programador pide permisos de administrador;
rem   - un servicio corre en la sesion 0 y el ejecutable del SDK, que es una
rem     app WinForms, no podria pintar su ventana.
rem  La carpeta Inicio no necesita ningun privilegio y corre en la sesion de
rem  quien contrata, que es justo donde tiene que estar el lector.
rem ---------------------------------------------------------------------------

set "ORIGEN=%~dp0"
set "INICIO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LANZADOR=%INICIO%\TuApo - Agente de huella.cmd"

if not exist "%ORIGEN%huellero-agente.ps1" (
  echo [ERROR] No se encuentra huellero-agente.ps1 en esta carpeta.
  pause & exit /b 1
)
if not exist "%ORIGEN%UareUSampleCSharp_CaptureOnly.exe" (
  echo [ERROR] Falta UareUSampleCSharp_CaptureOnly.exe en esta carpeta.
  echo         Sin el, el agente no puede hablar con el lector.
  pause & exit /b 1
)

echo.
echo   Instalando el agente de huella de TuApo
echo   ---------------------------------------
echo   Carpeta: %ORIGEN%
echo.

> "%LANZADOR%" echo @echo off
>>"%LANZADOR%" echo start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%ORIGEN%huellero-agente.ps1"

if not exist "%LANZADOR%" (
  echo [ERROR] No se pudo escribir en la carpeta Inicio.
  pause & exit /b 1
)
echo   [OK] Arrancara solo al iniciar sesion.

echo.
rem ---------------------------------------------------------------------------
rem  Matar primero cualquier agente anterior.
rem
rem  Sin esto, la copia nueva encuentra el puerto 52181 ocupado por la vieja, se
rem  cierra sin hacer nada -y con la ventana minimizada nadie lo ve-, y el equipo
rem  sigue sirviendo la version ANTIGUA. Se instala "correctamente" y no cambia
rem  nada: el peor modo de fallo posible.
rem ---------------------------------------------------------------------------
echo   Cerrando cualquier agente anterior...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*huellero-agente.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" 2>nul
ping -n 3 127.0.0.1 >nul

echo   Arrancando el agente ahora...
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%ORIGEN%huellero-agente.ps1"

rem Un momento para que abra el puerto antes de comprobarlo.
ping -n 4 127.0.0.1 >nul

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%ORIGEN%huellero-agente.ps1" -Probar

echo.
echo   Listo. Abre https://tesoro.tuapo.co y entra a Contratacion ^> Cedula ^& Huella.
echo   La primera vez Chrome preguntara si autorizas el acceso a la red local: di que si.
echo.
pause
