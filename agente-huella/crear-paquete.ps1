<#
  GENERA EL PAQUETE AUTOCONTENIDO
  ===============================

  Se ejecuta UNA VEZ, en el equipo donde el huellero YA funciona. Recoge de esa
  maquina las dos piezas que no pueden viajar en el repositorio —las librerias
  del SDK y el driver— y produce un ZIP que, en cualquier otro computador, es
  descomprimir, doble clic y capturar.

  POR QUE NO ESTAN ESAS PIEZAS EN EL REPOSITORIO
  ----------------------------------------------
  Son binarios licenciados de DigitalPersona / HID. No estan en el servidor y
  no se pueden descargar desde alli. Pero en un equipo que ya captura estan las
  dos, instaladas y funcionando: este script las toma de ahi.

  EL DRIVER SE EXPORTA, NO SE BUSCA
  ---------------------------------
  `pnputil /export-driver` saca el paquete de driver TAL COMO Windows lo tiene
  instalado y funcionando en este equipo. Es mejor que rastrear un instalador
  original: se lleva exactamente la version que ya sabemos que sirve.
  Ese paso necesita permisos de administrador; el resto no.

  USO
      powershell -NoProfile -ExecutionPolicy Bypass -File crear-paquete.ps1
#>

[CmdletBinding()]
param(
  [string] $Instalado = 'C:\TuApo\agente-huella',
  [string] $Salida    = "$env:USERPROFILE\Desktop\agente-huella-completo.zip"
)

$ErrorActionPreference = 'Continue'
function Titulo($t) { Write-Host "`n$t" -ForegroundColor Cyan; Write-Host ('-' * $t.Length) -ForegroundColor DarkGray }
function Ok($t)     { Write-Host "  [OK]    $t" -ForegroundColor Green }
function Info($t)   { Write-Host "  [ ]     $t" -ForegroundColor Gray }
function Aviso($t)  { Write-Host "  [AVISO] $t" -ForegroundColor Yellow }
function Malo($t)   { Write-Host "  [ERROR] $t" -ForegroundColor Red }

Write-Host ''
Write-Host '  Generar paquete autocontenido del agente de huella' -ForegroundColor White
Write-Host '  ==================================================' -ForegroundColor DarkGray

if (-not (Test-Path $Instalado)) { Malo "no existe $Instalado"; exit 1 }

$tmp = Join-Path $env:TEMP ("paquete-huella-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
$dst = Join-Path $tmp 'agente-huella'
New-Item -ItemType Directory -Path $dst -Force | Out-Null

# ── 1 · Scripts ─────────────────────────────────────────────────────────────
Titulo '1. Scripts del agente'
# `shim-nativo.dll` viaja YA COMPILADO si existe.
#
# Sin el, el equipo destino tiene que compilar C# en la primera captura, y eso
# depende de que el compilador del .NET Framework este presente y de que ningun
# antivirus se interponga. Llevandolo hecho, en el otro PC no se compila nada.
$scripts = @('huellero-agente.ps1','capturador-nativo.ps1','capturador.ps1','shim-nativo.cs',
             'shim-nativo.dll','setup.ps1','INSTALAR.cmd','DESINSTALAR.cmd',
             'VER-LOG.cmd','ESTADO.cmd','LEEME.md','INSTALACION.md',
             'UareUSampleCSharp_CaptureOnly.exe')
$faltan = @()
foreach ($f in $scripts) {
  $ruta = Join-Path $Instalado $f
  if (Test-Path $ruta) { Copy-Item $ruta $dst -Force } else { $faltan += $f }
}
$faltan = $faltan | Where-Object { $_ -ne 'shim-nativo.dll' }
if ($faltan.Count -gt 0) { Aviso ("no estaban: " + ($faltan -join ', ')) }
Ok "$((Get-ChildItem $dst -File).Count) archivo(s)"

# ── 2 · Librerias del SDK ───────────────────────────────────────────────────
Titulo '2. Librerias del SDK'
$runtime = Join-Path $dst 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$necesarias = @('dpfpdd.dll','dpfj.dll','dpfpdd_4k.dll','dpfpdd_ptapi.dll','tfm.dll')
$raices = @($Instalado, "${env:ProgramFiles(x86)}\DigitalPersona", "$env:ProgramFiles\DigitalPersona",
            "$env:USERPROFILE\Downloads") | Where-Object { Test-Path $_ }
$sinDll = @()
foreach ($d in $necesarias) {
  $h = $null
  foreach ($r in $raices) {
    $h = Get-ChildItem $r -Filter $d -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($h) { break }
  }
  if ($h) { Copy-Item $h.FullName $runtime -Force; Info "$d  <- $($h.DirectoryName)" }
  else { $sinDll += $d }
}
if ($sinDll.Count -eq 0) { Ok 'las cinco presentes' } else { Malo ("faltan: " + ($sinDll -join ', ')) }

# ── 3 · Driver ──────────────────────────────────────────────────────────────
Titulo '3. Driver del lector'
$carpetaDriver = Join-Path $dst 'driver'
New-Item -ItemType Directory -Path $carpetaDriver -Force | Out-Null

$esAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
  Aviso 'sin permisos de administrador: no se puede exportar el driver.'
  Aviso 'Vuelve a ejecutar este script como administrador para incluirlo.'
} else {
  try {
    # Que .inf de terceros corresponde al lector. Se filtra por proveedor para
    # no exportar medio catalogo de drivers del equipo.
    $oem = pnputil /enum-drivers 2>$null | Out-String
    $bloques = $oem -split "(?m)^Published Name:|(?m)^Nombre publicado:"
    $elegido = $null
    foreach ($b in $bloques) {
      if ($b -match 'DigitalPersona|U\.are\.U|Crossmatch') {
        if ($b -match '^\s*(oem\d+\.inf)') { $elegido = $matches[1]; break }
      }
    }
    if (-not $elegido) {
      Aviso 'no se encontro un driver de DigitalPersona instalado en este equipo.'
    } else {
      Info "exportando $elegido"
      pnputil /export-driver $elegido "`"$carpetaDriver`"" 2>&1 | Out-Null
      $n = (Get-ChildItem $carpetaDriver -Recurse -File -ErrorAction SilentlyContinue).Count
      if ($n -gt 0) { Ok "driver exportado ($n archivo(s))" } else { Aviso 'la exportacion no produjo archivos' }
    }
  } catch { Aviso ('no se pudo exportar el driver: ' + $_.Exception.Message) }
}

# ── 4 · Comprimir ───────────────────────────────────────────────────────────
Titulo '4. Empaquetando'
if (Test-Path $Salida) { Remove-Item $Salida -Force }
Compress-Archive -Path $dst -DestinationPath $Salida -Force
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

$mb = [math]::Round((Get-Item $Salida).Length / 1MB, 1)
Write-Host ''
Write-Host '  RESULTADO' -ForegroundColor White
Write-Host '  =========' -ForegroundColor DarkGray
Ok "$Salida  ($mb MB)"
if ($sinDll.Count -gt 0) {
  Malo 'INCOMPLETO: faltan librerias. En un equipo sin SDK no funcionara.'
} elseif (-not $esAdmin) {
  Aviso 'Sin driver: solo servira en equipos que ya lo tengan instalado.'
} else {
  Ok 'AUTOCONTENIDO: en otro equipo basta descomprimir y ejecutar INSTALAR.cmd'
}
Write-Host ''
