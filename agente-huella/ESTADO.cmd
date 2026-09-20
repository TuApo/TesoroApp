@echo off
title Estado del agente de huella
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=@(Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" ^| Where-Object { $_.CommandLine -like '*huellero-agente*' }); if ($p.Count -eq 0) { Write-Host '  El agente NO esta corriendo.' -ForegroundColor Red } else { Write-Host ('  Agente corriendo (PID ' + $p[0].ProcessId + ')') -ForegroundColor Green }; try { $r = Invoke-RestMethod 'http://127.0.0.1:52181/ping' -TimeoutSec 3; Write-Host ('  Responde: motor=' + $r.motor + '  lector=' + $r.dispositivo) -ForegroundColor Green } catch { Write-Host '  No responde en 127.0.0.1:52181' -ForegroundColor Red }"
echo.
pause
