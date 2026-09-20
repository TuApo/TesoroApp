<#
  INSTALADOR DEL AGENTE DE HUELLA — un solo paso
  ==============================================

  Se lanza desde INSTALAR.cmd. Hace TODO lo que hasta ahora habia que hacer a
  mano, y cada cosa esta aqui porque su ausencia ya nos costo una sesion:

    1. Instala SIEMPRE en C:\TuApo\agente-huella, se descomprima donde se
       descomprima. El agente elige motor mirando los archivos que tiene al
       lado; con dos carpetas a medias, cae en silencio al motor peor.
    2. Desbloquea los archivos (Windows marca lo que viene de un ZIP
       descargado y PowerShell se niega a ejecutarlo).
    3. Pone BOM a los .ps1: sin el, PowerShell 5.1 los lee como ANSI, y un
       guion largo dentro de una cadena llego a hacer que Windows ejecutara
       TIMEOUT.EXE en mitad de una captura.
    4. Busca las DLL del lector por todo el equipo y las trae. Son binarios
       licenciados del fabricante: no pueden viajar en el ZIP.
    5. Mata cualquier agente anterior, de cualquier carpeta. Si el puerto
       52181 sigue ocupado, la copia nueva se cierra sin decir nada y el
       equipo sigue sirviendo la vieja.
    6. Rehace el lanzador de Inicio apuntando al destino correcto.
    7. Aparta a un lado los restos de otras versiones, para que quede una
       unica verdad en la carpeta.
    8. Verifica de verdad: enumera y abre el lector, y comprueba que /ping
       responde con el motor nativo. No basta con que exista un archivo.
#>

# 'Continue' y no 'Stop': un tropiezo en cualquier comprobacion no puede
# impedir que el agente acabe arrancando. Los fallos se reportan, no abortan.
param(
  # Reinstala aunque ya este puesto. Sin esto, ejecutar el instalador dos veces
  # no repite el trabajo: comprueba y sale.
  [switch] $Forzar
)

$ErrorActionPreference = 'Continue'
$origen  = $PSScriptRoot
$destino = 'C:\TuApo\agente-huella'
$inicio  = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"

function Titulo($t) { Write-Host "`n$t" -ForegroundColor Cyan; Write-Host ('-' * $t.Length) -ForegroundColor DarkGray }
function Ok($t)     { Write-Host "  [OK]    $t" -ForegroundColor Green }
function Info($t)   { Write-Host "  [ ]     $t" -ForegroundColor Gray }
function Aviso($t)  { Write-Host "  [AVISO] $t" -ForegroundColor Yellow }
function Malo($t)   { Write-Host "  [ERROR] $t" -ForegroundColor Red }

Write-Host ''
Write-Host '  Agente de huella TuApo - instalacion' -ForegroundColor White
Write-Host '  ====================================' -ForegroundColor DarkGray

# ── Instalado ya? ───────────────────────────────────────────────────────────
#
# INSTALAR UNA VEZ POR EQUIPO. Un instalador que rehace todo cada vez que
# alguien lo pulsa acaba reinstalando drivers, reescribiendo lanzadores y
# reiniciando el agente en mitad de una captura. Aqui se comprueba primero si
# ya esta puesto Y funcionando; si lo esta, se informa y se sale.
#
# La marca lleva la version: un paquete mas nuevo SI actualiza, sin preguntar.
$VERSION_PAQUETE = '25'
$marca = Join-Path $destino 'instalado.json'

function Agente-Responde {
  try { $r = Invoke-RestMethod 'http://127.0.0.1:52181/ping' -TimeoutSec 2; return $r } catch { return $null }
}

if (-not $Forzar -and (Test-Path $marca)) {
  $previo = $null
  try { $previo = Get-Content $marca -Raw | ConvertFrom-Json } catch { }
  $mismaVersion = $previo -and ("$($previo.version)" -eq $VERSION_PAQUETE)
  $ping = Agente-Responde

  if ($mismaVersion -and $ping -and $ping.motor -eq 'dpfpdd') {
    Write-Host ''
    Ok "Este equipo YA ESTABA instalado y funcionando."
    Info "instalado el $($previo.fecha) · version $($previo.version) · motor $($ping.motor)"
    Info "Lector: $($ping.dispositivo)"
    Write-Host ''
    Write-Host '  No se cambio nada: ya estaba todo puesto.' -ForegroundColor Green
    Write-Host '  Abre https://tesoro.tuapo.co y captura.' -ForegroundColor Green
    Write-Host '  Si quieres reinstalar de todas formas: INSTALAR.cmd /forzar' -ForegroundColor DarkGray
    Write-Host ''
    exit 0
  }

  if ($mismaVersion -and -not $ping) {
    # Instalado pero apagado: se arranca y ya. Ni driver ni copias ni nada.
    Write-Host ''
    Info "Este equipo ya tenia la version $VERSION_PAQUETE, pero el agente estaba parado."
    Info 'Se arranca sin reinstalar nada.'
    Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"$destino\huellero-agente.ps1"
    for ($i = 0; $i -lt 12; $i++) { Start-Sleep -Milliseconds 700; if (Agente-Responde) { break } }
    $ping = Agente-Responde
    if ($ping) { Ok "agente activo (motor $($ping.motor))"; Write-Host '' ; exit 0 }
    Aviso 'no arranco; se reinstala completo.'
  }
}

# ── 0 · Driver del lector ───────────────────────────────────────────────────
#
# Es el UNICO paso que necesita permisos de administrador, asi que se hace
# primero y solo cuando de verdad hace falta: pedir UAC en un equipo que ya
# tiene el lector reconocido seria molestar por nada.
#
# La elevacion va en un proceso APARTE, no relanzando este script como
# administrador: si todo el instalador corriera elevado, el arranque automatico
# y la carpeta Inicio se escribirian para el usuario Administrador y no para
# quien de verdad usa el equipo.
function Lector-Reconocido {
  try {
    $d = Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object {
      ([string]$_.InstanceId) -like '*VID_05BA*' -or ([string]$_.FriendlyName) -like '*U.are.U*'
    } | Select-Object -First 1
    if (-not $d) { return @{ hay = $false; ok = $false; nombre = $null } }
    return @{ hay = $true; ok = ($d.Status -eq 'OK'); nombre = [string]$d.FriendlyName }
  } catch { return @{ hay = $false; ok = $false; nombre = $null } }
}

if ((Test-Path $marca) -and -not $Forzar) {
  $prev = $null
  try { $prev = Get-Content $marca -Raw | ConvertFrom-Json } catch { }
  if ($prev -and "$($prev.version)" -ne $VERSION_PAQUETE) {
    Write-Host ''
    Info "Actualizando de la version $($prev.version) a la $VERSION_PAQUETE."
  }
}

Titulo '0. Driver del lector'
$est = Lector-Reconocido
if ($est.hay -and $est.ok) {
  Ok "reconocido por Windows: $($est.nombre)"
} else {
  if (-not $est.hay) { Info 'Windows no ve ningun lector U.are.U conectado.' }
  else { Aviso "el lector aparece con estado '$($est.nombre)' pero no operativo." }

  $carpetaDriver = Join-Path $origen 'driver'
  $infs = @()
  $paquetes = @()
  if (Test-Path $carpetaDriver) {
    $infs     = @(Get-ChildItem $carpetaDriver -Filter '*.inf' -Recurse -File -ErrorAction SilentlyContinue)
    $paquetes = @(Get-ChildItem $carpetaDriver -Include '*.msi','*.exe' -Recurse -File -ErrorAction SilentlyContinue)
  }

  if ($infs.Count -eq 0 -and $paquetes.Count -eq 0) {
    Aviso 'no hay driver en la carpeta driver\ del paquete.'
    Aviso 'Si el lector no funciona, instala el driver DigitalPersona a mano.'
  } else {
    Info 'instalando el driver (Windows pedira permiso de administrador)...'
    try {
      if ($infs.Count -gt 0) {
        # pnputil es la via limpia para un paquete con .inf: sin instalador
        # propietario, sin modificadores silenciosos que cambian por version.
        $args = @('/add-driver', "`"$($infs[0].FullName)`"", '/install')
        $pr = Start-Process -FilePath 'pnputil.exe' -ArgumentList $args -Verb RunAs -Wait -PassThru
        if ($pr.ExitCode -eq 0) { Ok 'driver instalado' } else { Aviso "pnputil devolvio $($pr.ExitCode)" }
      } else {
        $paq = $paquetes[0]
        if ($paq.Extension -eq '.msi') {
          $pr = Start-Process 'msiexec.exe' -ArgumentList @('/i', "`"$($paq.FullName)`"", '/qn', '/norestart') -Verb RunAs -Wait -PassThru
        } else {
          $pr = Start-Process $paq.FullName -Verb RunAs -Wait -PassThru
        }
        if ($pr.ExitCode -eq 0) { Ok "driver instalado ($($paq.Name))" } else { Aviso "el instalador devolvio $($pr.ExitCode)" }
      }
      Start-Sleep -Seconds 3
      $est = Lector-Reconocido
      if ($est.ok) { Ok "ahora si: $($est.nombre)" }
      else { Aviso 'Windows aun no lo reconoce. Desconecta y vuelve a conectar el lector.' }
    } catch {
      Malo ('no se pudo instalar el driver: ' + $_.Exception.Message)
      Malo 'Instalalo a mano y vuelve a ejecutar este instalador.'
    }
  }
}

# ── 1 · Cerrar lo que este corriendo ────────────────────────────────────────
Titulo '1. Cerrando agentes anteriores'
$vivos = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
           Where-Object { $_.CommandLine -like '*huellero-agente*' -or $_.CommandLine -like '*capturador-nativo*' })
foreach ($p in $vivos) {
  Info "cerrando PID $($p.ProcessId)"
  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { }
}
if ($vivos.Count -eq 0) { Info 'no habia ninguno' } else { Ok "$($vivos.Count) cerrado(s)" }
Start-Sleep -Seconds 2

# ── 2 · Copiar al destino unico ─────────────────────────────────────────────
Titulo "2. Instalando en $destino"
if (-not (Test-Path $destino)) { New-Item -ItemType Directory -Path $destino -Force | Out-Null }
if ((Resolve-Path $origen).Path -ne (Resolve-Path $destino).Path) {
  Get-ChildItem $origen -File | Copy-Item -Destination $destino -Force
  Ok 'archivos copiados'
} else {
  Info 'ya se ejecuta desde el destino'
}

# ── 3 · Desbloquear (marca de internet) ─────────────────────────────────────
Titulo '3. Desbloqueando archivos'
Get-ChildItem $destino -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
Ok 'hecho'

# ── 4 · BOM en los scripts ──────────────────────────────────────────────────
Titulo '4. Comprobando codificacion'
$conBom = New-Object System.Text.UTF8Encoding $true
$puestos = 0
foreach ($f in Get-ChildItem $destino -File | Where-Object { $_.Extension -in '.ps1', '.cs' }) {
  $b = [IO.File]::ReadAllBytes($f.FullName)
  if ($b.Length -lt 3 -or $b[0] -ne 239 -or $b[1] -ne 187 -or $b[2] -ne 191) {
    [IO.File]::WriteAllBytes($f.FullName, ([byte[]](239,187,191) + $b))
    Info "BOM anadido a $($f.Name)"; $puestos++
  }
}
if ($puestos -eq 0) { Ok 'todos los scripts ya tenian BOM' } else { Ok "$puestos corregido(s)" }

# ── 5 · Librerias del lector ────────────────────────────────────────────────
Titulo '5. Librerias del lector'
$necesarias = @('dpfpdd.dll','dpfj.dll','dpfpdd_4k.dll','dpfpdd_ptapi.dll','tfm.dll')
$faltan = $necesarias | Where-Object { -not (Test-Path (Join-Path $destino $_)) }

if ($faltan.Count -gt 0) {
  Info "faltan: $($faltan -join ', ')"
  # Primero donde suelen estar; el rastreo completo solo si hace falta.
  # `runtime\` del propio paquete PRIMERO: si el ZIP las trae, el equipo es
  # irrelevante y la instalacion no depende de lo que hubiera antes.
  $donde = @(
    (Join-Path $origen 'runtime'),
    "${env:ProgramFiles(x86)}\DigitalPersona",
    "$env:ProgramFiles\DigitalPersona",
    "$env:USERPROFILE\Downloads"
  ) | Where-Object { Test-Path $_ }

  foreach ($d in $faltan) {
    $hallada = $null
    foreach ($raiz in $donde) {
      $hallada = Get-ChildItem $raiz -Filter $d -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($hallada) { break }
    }
    if ($hallada) {
      Copy-Item $hallada.FullName $destino -Force
      Info "traida: $d  <- $($hallada.DirectoryName)"
    } else {
      Aviso "no se encontro $d en este equipo"
    }
  }
}
$sigueFaltando = $necesarias | Where-Object { -not (Test-Path (Join-Path $destino $_)) }
if ($sigueFaltando.Count -eq 0) { Ok 'todas presentes' }
else {
  Malo "faltan: $($sigueFaltando -join ', ')"
  Malo 'Instala el U.are.U SDK de DigitalPersona, o copia esas DLL a la carpeta.'
}

# ── 6 · Apartar restos de otras versiones ───────────────────────────────────
Titulo '6. Limpiando restos de versiones anteriores'
$restos = @('instalar-agente.ps1','preparar-runtime.ps1','iniciar-agente.cmd',
            'diagnosticar-agente.cmd','VERSION.txt','INSTALADO.txt') +
          (Get-ChildItem $destino -Filter 'CAMBIOS-v*.md' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) +
          (Get-ChildItem $destino -Filter '*.bak*' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
$viejo = Join-Path $destino '_viejo'
$movidos = 0
foreach ($r in ($restos | Select-Object -Unique)) {
  $ruta = Join-Path $destino $r
  if (Test-Path $ruta) {
    if (-not (Test-Path $viejo)) { New-Item -ItemType Directory -Path $viejo -Force | Out-Null }
    Move-Item $ruta (Join-Path $viejo $r) -Force -ErrorAction SilentlyContinue
    $movidos++
  }
}
if ($movidos -eq 0) { Ok 'nada que limpiar' } else { Ok "$movidos archivo(s) movidos a _viejo (no se borra nada)" }

# ── 7 · Arranque automatico ─────────────────────────────────────────────────
Titulo '7. Arranque con la sesion'
Get-ChildItem $inicio -Filter '*uella*' -ErrorAction SilentlyContinue | ForEach-Object {
  Info "quitando lanzador anterior: $($_.Name)"; Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
}
$lanzador = Join-Path $inicio 'TuApo - Agente de huella.vbs'

# .VBS Y NO .CMD, A PROPOSITO.
#
# El agente vivia DENTRO de una ventana de PowerShell: cerrarla —o cerrar la
# terminal desde la que se lanzo— lo mataba, y la web se quedaba sin lector sin
# que nadie entendiera por que. Un .cmd con `start /min` sigue dejando una
# ventana minimizada, que alguien acaba cerrando.
#
# WScript.Shell.Run con modo 0 arranca el proceso SIN NINGUNA ventana: no hay
# nada que cerrar. Los mensajes van a `agente.log` y `VER-LOG.cmd` los muestra.
#
# No hace falta comprobar el puerto aqui: el agente toma un mutex y una segunda
# copia se cierra sola.
@"
' Arranca el agente de huella de TuApo sin ventana.
' Generado por el instalador; no editar a mano.
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""$destino\huellero-agente.ps1""", 0, False
"@ | Set-Content -Path $lanzador -Encoding ASCII

Ok "lanzador escrito -> $destino"

# ── 8 · Verificar el lector de verdad ───────────────────────────────────────
Titulo '8. Precompilando el puente al SDK'
# Sin esto, la primera captura de cada sesion paga 4-5 s de compilador de C#.
try {
  $cs = Join-Path $destino 'shim-nativo.cs'
  $dl = Join-Path $destino 'shim-nativo.dll'
  if (Test-Path $cs) {
    Add-Type -Path $cs -OutputAssembly $dl -ErrorAction Stop
    Ok 'shim-nativo.dll generado (capturas mas rapidas)'
  }
} catch { Aviso 'no se pudo precompilar; se compilara en cada captura' }

Titulo '9. Probando el lector (no pide dedo)'
$nativo = Join-Path $destino 'capturador-nativo.ps1'
$lectorOk = $false

# ESTA PRUEBA NO PUEDE TUMBAR LA INSTALACION.
#
# El capturador escribe sus etapas por la salida de ERROR a proposito (la
# estandar esta reservada al DATA:). Recogerlas con `& ... 2>&1` hace que
# PowerShell las convierta en NativeCommandError y, con ErrorActionPreference
# en Stop, el instalador se abortaba justo aqui: el paso 9 -arrancar el
# agente- no llegaba a ejecutarse nunca. Se redirige a fichero, que no genera
# ningun error, y ademas todo el paso va dentro de try/catch: si el lector
# falla, la instalacion sigue y el agente arranca igual.
try {
  if ((Test-Path $nativo) -and (Test-Path (Join-Path $destino 'dpfpdd.dll'))) {
    $fOut = [IO.Path]::GetTempFileName()
    $fErr = [IO.Path]::GetTempFileName()
    $pr = Start-Process -FilePath 'powershell' -WindowStyle Hidden -Wait -PassThru `
            -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$nativo`"",'-SoloDiagnostico' `
            -RedirectStandardOutput $fOut -RedirectStandardError $fErr
    $etapas = @(Get-Content $fErr -ErrorAction SilentlyContinue)
    foreach ($l in $etapas) { if ("$l".Trim()) { Write-Host "    $l" -ForegroundColor DarkGray } }
    Remove-Item $fOut, $fErr -Force -ErrorAction SilentlyContinue
    $lectorOk = ($pr.ExitCode -eq 0)
    if ($lectorOk) { Ok 'el lector se enumera y se abre' }
    else { Malo 'el lector no respondio (ver etapas arriba). La instalacion sigue.' }
  } else {
    Malo 'no estan capturador-nativo.ps1 y dpfpdd.dll: no se puede probar'
  }
} catch {
  Malo ('no se pudo probar el lector: ' + $_.Exception.Message)
  Malo 'La instalacion continua igualmente.'
}

# ── 9 · Arrancar y comprobar el servicio ────────────────────────────────────
Titulo '10. Arrancando el agente'
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"$destino\huellero-agente.ps1"
$ping = $null
for ($i = 0; $i -lt 12; $i++) {
  Start-Sleep -Milliseconds 700
  try { $ping = Invoke-RestMethod 'http://127.0.0.1:52181/ping' -TimeoutSec 2; break } catch { }
}

Write-Host ''
Write-Host '  RESULTADO' -ForegroundColor White
Write-Host '  =========' -ForegroundColor DarkGray
if (-not $ping) {
  Malo 'el agente no responde en 127.0.0.1:52181'
} elseif ($ping.motor -eq 'dpfpdd') {
  # Marca de instalado: es lo que permite que la proxima ejecucion no repita.
  @{ version = $VERSION_PAQUETE; fecha = (Get-Date).ToString('yyyy-MM-dd HH:mm')
     usuario = $env:USERNAME; equipo = $env:COMPUTERNAME; motor = $ping.motor
  } | ConvertTo-Json | Set-Content -Path $marca -Encoding UTF8

  Ok "agente activo · motor NATIVO dpfpdd · $($ping.dispositivo)"
  Write-Host ''
  Write-Host '  Ya puedes capturar desde https://tesoro.tuapo.co' -ForegroundColor Green
  Write-Host '  Contratacion > candidato > Cedula & Huella > Capturar Huella' -ForegroundColor Green
  Write-Host '  El agente corre en segundo plano: no hay ventana que dejar abierta,' -ForegroundColor DarkGray
  Write-Host '  y arranca solo al iniciar sesion. Para ver que hace: VER-LOG.cmd' -ForegroundColor DarkGray
} else {
  Malo "agente activo pero con motor '$($ping.motor)' en vez de 'dpfpdd'"
  Malo 'faltan las librerias del lector en la carpeta (ver paso 5).'
}
Write-Host ''
