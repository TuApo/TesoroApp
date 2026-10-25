; ============================================================
; Cierre de "Gestion Tesoreria" antes de instalar, actualizar o desinstalar.
;
; Con el agente de monitoreo enrolado (endpoint-agent.js) la app sigue viva en la
; bandeja aunque se cierre la ventana, y el chequeo por defecto de electron-builder
; (_CHECK_APP_RUNNING) terminaba en "No se puede cerrar Gestion Tesoreria. Por favor
; cierra la aplicacion manualmente y haz clic en reintentar".
;
; Esta macro lo reemplaza (electron-builder la inserta en CHECK_APP_RUNNING, tanto en
; el instalador como en el desinstalador): mata el arbol de procesos del usuario
; actual con taskkill /F /T y comprueba; si la app sobrevive (abierta como
; administrador) pide UAC solo para cerrarla. Se llama a taskkill.exe directamente
; (sin cmd.exe) y con nsExec, asi que no aparece ninguna consola.
;
; OJO: ese mismo aviso tambien sale con la app CERRADA cuando el desinstalador de la
; version anterior falla 5 veces (uninstallOldVersion) o cuando no se pueden copiar
; los ficheros nuevos. La causa real en 10.0.1 eran rutas de mas de 260 caracteres
; (ver _tesoreriaLimpiarInstalacionVieja, que corre aqui antes de desinstalar).
; ============================================================

!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif

; Mata por nombre de imagen los procesos de la sesion de Windows actual ($R9).
; Por sesion y no por usuario: en un servidor de terminales no toca a los demas, y
; si alguien abrio la app "como administrador" con OTRA cuenta (credenciales de TI),
; ese proceso es de otro usuario pero de esta misma sesion y bloquea esta instalacion.
!macro _tesoreriaTaskkill _IMAGEN
  ${if} $R9 == ""
    nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "${_IMAGEN}"`
  ${else}
    nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "${_IMAGEN}" /FI "SESSION eq $R9"`
  ${endIf}
  Pop $R8
!macroend

; Paquetes de Capacitor (solo moviles) que las versiones <= 10.0.1 instalaban en
; app.asar.unpacked: el build de Android compila los plugins DENTRO de node_modules
; (android/build/intermediates/...) y el de Electron los empaquetaba. Son rutas de hasta
; ~250 caracteres dentro de la carpeta; con el prefijo (%LOCALAPPDATA%\Programs\tesoreria,
; o %TEMP%\nsXXXX.tmp\old-install donde el desinstalador viejo mueve todo) pasan del
; limite de 260 de Windows, el desinstalador aborta y el instalador acababa en "No se
; puede cerrar Gestion Tesoreria... reintentar" con la app cerrada. Electron no los usa
; (desde 10.0.2 ya no se empaquetan): se borran con el prefijo \\?\ antes de desinstalar.
!macro _tesoreriaBorrarRutaLarga _DIR
  ${if} ${FileExists} "${_DIR}\*.*"
    nsExec::Exec `"$SYSDIR\cmd.exe" /c rd /s /q "\\?\${_DIR}"`
    Pop $R8
    ${if} ${FileExists} "${_DIR}\*.*"
      ; cmd.exe bloqueado por directiva: mismo borrado con PowerShell.
      nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Remove-Item -LiteralPath '\\?\${_DIR}' -Recurse -Force -ErrorAction SilentlyContinue"`
      Pop $R8
    ${endIf}
  ${endIf}
!macroend

; Se va app.asar.unpacked entero, no solo esos tres paquetes: las builds 12.x que llegan por
; el canal de GitHub (TuApo/ControlPrestamos) traen su propia mezcla de plugins y ahi viven
; todas las rutas profundas. Es seguro porque la app ya esta cerrada y la instalacion se
; reemplaza completa a continuacion (el desinstalador viejo la borraria igual).
!macro _tesoreriaLimpiarInstalacionVieja _RAIZ
  !insertmacro _tesoreriaBorrarRutaLarga "${_RAIZ}\resources\app.asar.unpacked"
!macroend

!macro customCheckAppRunning
  Push $R6
  Push $R7
  Push $R8
  Push $R9
  ; $R9 = id de la sesion de Windows de este instalador ("" si no se pudo leer: sin filtro).
  System::Call 'kernel32::GetCurrentProcessId() i .R8'
  System::Call 'kernel32::ProcessIdToSessionId(i R8, *i .R9) i .R7'
  ${if} $R7 <= 0
    StrCpy $R9 ""
  ${endIf}

  ; Actualizacion desde la propia app (quitAndInstall): la app ya va saliendo y cierra
  ; SQLite y los visores en before-quit. Se le dan hasta ~5 s para terminar sola.
  ${if} ${isUpdated}
    StrCpy $R7 0
    tesoreria_espera_salida:
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R8
      ${if} $R8 == 0
      ${andIf} $R7 < 10
        IntOp $R7 $R7 + 1
        Sleep 500
        Goto tesoreria_espera_salida
      ${endIf}
  ${endIf}

  ; La primera pasada de taskkill va siempre, aunque no se detecte nada: si la
  ; deteccion fallara, es mejor matar de mas que quedarse con ficheros bloqueados.
  ; Tambien el lector de huella (hijo de la app): si quedo esperando un dedo
  ; bloquea resources\csharp y la extraccion fallaria despues.
  StrCpy $R7 0
  tesoreria_matar:
    IntOp $R7 $R7 + 1
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R8
    ${if} $R8 == 0
      DetailPrint `Cerrando "${PRODUCT_NAME}"...`
    ${endIf}
    !insertmacro _tesoreriaTaskkill "${APP_EXECUTABLE_FILENAME}"
    !insertmacro _tesoreriaTaskkill "UareUSampleCSharp_CaptureOnly.exe"
    ; taskkill /F vuelve antes de que Windows libere los ficheros.
    Sleep 1000
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R8
    ${if} $R8 == 0
      ${if} $R7 < 3
        Goto tesoreria_matar
      ${endIf}
      ; Sigue viva tras taskkill /F: casi siempre porque se abrio "como administrador"
      ; y un instalador sin elevar (asInvoker) no puede matarla; el chequeo por defecto
      ; ya hacia taskkill /F y por eso se quedaba en "reintentar". Se pide permiso a
      ; Windows (UAC) solo para cerrarla; la instalacion sigue sin elevar.
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "${PRODUCT_NAME} sigue abierta y no se pudo cerrar (probablemente se abrió como administrador).$\n$\nPulsa Aceptar y confirma el aviso de Windows para cerrarla y continuar." /SD IDOK IDOK tesoreria_elevar
      Quit
      tesoreria_elevar:
      ; powershell.exe convierte \" en comillas: taskkill recibe /IM "Gestion Tesoreria.exe".
      StrCpy $R6 `/F /T /IM \"${APP_EXECUTABLE_FILENAME}\"`
      ${if} $R9 != ""
        StrCpy $R6 `$R6 /FI \"SESSION eq $R9\"`
      ${endIf}
      nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -Command "Start-Process -FilePath '$SYSDIR\taskkill.exe' -ArgumentList '$R6' -Verb RunAs -WindowStyle Hidden -Wait"`
      Pop $R8
      Sleep 1500
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R8
      ${if} $R8 == 0
        ; UAC rechazado, o es la app de otra sesion de Windows (FindProcess ve todos los
        ; usuarios; esa vive en su propio %LOCALAPPDATA% y no bloquea esta instalacion).
        DetailPrint `"${PRODUCT_NAME}" sigue en ejecucion; se continua.`
      ${endIf}
    ${endIf}

  ; Con la app ya cerrada: quitar las rutas largas de la instalacion existente (en
  ; $INSTDIR y, si el registro apunta a otra carpeta, tambien ahi).
  !insertmacro _tesoreriaLimpiarInstalacionVieja "$INSTDIR"
  ReadRegStr $R6 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $R6 != ""
  ${andIf} $R6 != $INSTDIR
    !insertmacro _tesoreriaLimpiarInstalacionVieja "$R6"
  ${endIf}

  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
!macroend
