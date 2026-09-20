@echo off
title Crear paquete completo - TuApo
echo.
echo   Se pedira permiso de administrador para exportar el driver.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File','%~dp0crear-paquete.ps1'"
