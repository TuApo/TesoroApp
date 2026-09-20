<#
  CAPTURADOR DE HUELLA POR ETAPAS — habla con DPUruNet directamente
  =================================================================

  Sustituye a `UareUSampleCSharp_CaptureOnly.exe`, del que NO existe codigo
  fuente en el repositorio: solo el binario y su PDB. Sin fuente no se puede
  saber en que llamada del SDK ocurre `DP_FAILURE`, que es justo lo que hay que
  averiguar. Aqui cada llamada al SDK es una etapa numerada con su ResultCode.

  MISMO CONTRATO DE SALIDA QUE EL .EXE, a proposito: imprime en la salida
  estandar una unica linea

      DATA: <base64 de un PNG>

  El agente (`huellero-agente.ps1`) ya sabe leer eso, asi que no hay que tocar
  el contrato HTTP ni el frontend. Las etapas van a la salida de ERROR, no a la
  estandar, para no ensuciar el DATA:.

  POR QUE POWERSHELL Y NO UN .EXE PROPIO
  --------------------------------------
  DPUruNet es un ensamblado .NET Framework y PowerShell 5.1 corre sobre .NET
  Framework: `Add-Type -Path` lo carga y se le puede llamar directamente. Cero
  cadena de compilacion, cero Visual Studio, y la arquitectura del proceso se
  elige con solo lanzar un interprete u otro.

  NADA DE DATOS BIOMETRICOS EN EL LOG. Las etapas registran codigos, tamanos y
  descripciones del lector. La imagen viaja por la salida estandar y nunca se
  escribe en el registro de etapas.

  USO
      .\capturador.ps1                 # captura; DATA: por salida estandar
      .\capturador.ps1 -Diagnostico    # ademas explica cada etapa por pantalla
#>

[CmdletBinding()]
param(
  [string] $Dll,
  [int]    $TimeoutMs = 30000,
  [switch] $Diagnostico
)

# Reflexion sobre tipos de terceros: el modo estricto aborta en cuanto se
# consulta una propiedad que ese ensamblado no tiene, que es exactamente lo que
# hace falta poder hacer aqui.
Set-StrictMode -Off
$ErrorActionPreference = 'Stop'

$script:Etapa = 0
function Paso([string]$texto) {
  $script:Etapa++
  $linea = "[{0,2}] {1}" -f $script:Etapa, $texto
  [Console]::Error.WriteLine($linea)
  if ($Diagnostico) { Write-Host $linea -ForegroundColor Cyan }
}
function Detalle([string]$texto) {
  [Console]::Error.WriteLine("     $texto")
  if ($Diagnostico) { Write-Host "     $texto" -ForegroundColor DarkGray }
}
function Morir([string]$etapa, $excepcion) {
  $tipo = if ($excepcion -is [System.Management.Automation.ErrorRecord]) { $excepcion.Exception.GetType().FullName } else { $excepcion.GetType().FullName }
  $msg  = if ($excepcion -is [System.Management.Automation.ErrorRecord]) { $excepcion.Exception.Message } else { $excepcion.Message }
  [Console]::Error.WriteLine("FALLO EN: $etapa")
  [Console]::Error.WriteLine("TIPO: $tipo")
  [Console]::Error.WriteLine("MENSAJE: $msg")
  if ($excepcion.Exception -and $excepcion.Exception.InnerException) {
    [Console]::Error.WriteLine("INNER: " + $excepcion.Exception.InnerException.Message)
  }
  exit 1
}

# ── [1] Cargar el ensamblado ────────────────────────────────────────────────
Paso 'Cargando DPUruNet'
if (-not $Dll) { $Dll = Join-Path $PSScriptRoot 'DPUruNet.dll' }
if (-not (Test-Path -LiteralPath $Dll)) {
  [Console]::Error.WriteLine("FALLO EN: [1] carga")
  [Console]::Error.WriteLine("MENSAJE: no se encuentra DPUruNet.dll en $Dll")
  exit 1
}
try {
  Add-Type -Path $Dll
  $asm = [System.Reflection.Assembly]::LoadFrom($Dll)
  Detalle $asm.FullName
  Detalle ("proceso de 64 bits: " + [Environment]::Is64BitProcess)
} catch { Morir '[1] carga del ensamblado' $_ }

# ── Utilidades de reflexion ─────────────────────────────────────────────────
# El nombre de los tipos cambia entre versiones del SDK (en esta, por ejemplo,
# NO existe `DPUruNet.Readers`). Se localizan por forma, no por nombre a mano.

function Enum-Valor($patronTipo, [string[]]$preferidos) {
  $tipo = $asm.GetExportedTypes() | Where-Object { $_.IsEnum -and $_.FullName -match $patronTipo } | Select-Object -First 1
  if (-not $tipo) { return $null }
  $nombres = [Enum]::GetNames($tipo)
  foreach ($p in $preferidos) {
    $hit = $nombres | Where-Object { $_ -match $p } | Select-Object -First 1
    if ($hit) { return @{ tipo = $tipo; nombre = $hit; valor = [Enum]::Parse($tipo, $hit) } }
  }
  return @{ tipo = $tipo; nombre = $nombres[0]; valor = [Enum]::Parse($tipo, $nombres[0]) }
}

function Propiedad($obj, [string[]]$candidatas) {
  if ($null -eq $obj) { return $null }
  foreach ($c in $candidatas) {
    $p = $obj.GetType().GetProperty($c)
    if ($p) { return $p.GetValue($obj, $null) }
    $f = $obj.GetType().GetField($c)
    if ($f) { return $f.GetValue($obj) }
  }
  return $null
}

function Volcar($obj, [string]$titulo) {
  if ($null -eq $obj) { Detalle "$titulo = null"; return }
  Detalle "$titulo es $($obj.GetType().FullName); miembros:"
  $obj.GetType().GetProperties() | ForEach-Object { Detalle "   .$($_.Name) : $($_.PropertyType.Name)" }
  $obj.GetType().GetFields() | ForEach-Object { Detalle "   .$($_.Name) : $($_.FieldType.Name)" }
}

# ── [2] Localizar la enumeracion de lectores ────────────────────────────────
Paso 'Localizando el punto de entrada para enumerar lectores'
$metodoEnum = $null
foreach ($t in $asm.GetExportedTypes()) {
  foreach ($m in $t.GetMethods('Public,Static,DeclaredOnly')) {
    if ($m.Name -match '^GetReaders$' -and $m.GetParameters().Count -eq 0) {
      $metodoEnum = $m; break
    }
  }
  if ($metodoEnum) { break }
}
if (-not $metodoEnum) {
  [Console]::Error.WriteLine('FALLO EN: [2] no se encontro ningun GetReaders() estatico. Metodos estaticos disponibles:')
  foreach ($t in $asm.GetExportedTypes()) {
    foreach ($m in $t.GetMethods('Public,Static,DeclaredOnly')) {
      [Console]::Error.WriteLine("   $($t.FullName) :: $($m.ToString())")
    }
  }
  exit 1
}
Detalle ("$($metodoEnum.DeclaringType.FullName)::$($metodoEnum.Name)()")

# ── [3] Enumerar ────────────────────────────────────────────────────────────
Paso 'Enumerando lectores'
try {
  $lectores = $metodoEnum.Invoke($null, @())
} catch { Morir '[3] GetReaders()' $_ }

$cuantos = Propiedad $lectores @('Count','Length')
Detalle "lectores encontrados: $cuantos"
if (-not $cuantos -or $cuantos -eq 0) {
  [Console]::Error.WriteLine('FALLO EN: [3] el SDK carga pero no ve ningun lector.')
  [Console]::Error.WriteLine('MENSAJE: revisa el cable USB y que ningun otro proceso tenga tomado el dispositivo.')
  exit 1
}

# ── [4] Elegir lector ───────────────────────────────────────────────────────
Paso 'Seleccionando lector'
$lector = $lectores[0]
$desc = Propiedad $lector @('Description')
if ($desc) {
  Detalle ("nombre: " + (Propiedad $desc @('Name','ProductName','Id')))
  Detalle ("serie:  " + (Propiedad $desc @('SerialNumber','Serial')))
} else {
  Volcar $lector 'lector'
}

# ── [5] Abrir ───────────────────────────────────────────────────────────────
Paso 'Reader.Open()'
$prioridad = Enum-Valor 'CapturePriority' @('COOPERATIVE','EXCLUSIVE')
if (-not $prioridad) { Morir '[5] Open()' ([Exception]::new('no se encontro el enum CapturePriority')) }
Detalle ("prioridad: " + $prioridad.nombre)
try {
  $rc = $lector.Open($prioridad.valor)
} catch { Morir '[5] Reader.Open()' $_ }
Detalle ("ResultCode: $rc")
if ("$rc" -notmatch 'SUCCESS|OK') {
  [Console]::Error.WriteLine("FALLO EN: [5] Reader.Open() devolvio $rc")
  [Console]::Error.WriteLine('MENSAJE: el lector existe pero no se pudo abrir. Suele ser otro proceso reteniendolo (otra instancia, o el servicio biometrico de Windows) o runtimes mezclados.')
  exit 1
}

# ── [6] Estado ──────────────────────────────────────────────────────────────
Paso 'Reader.GetStatus()'
try {
  $rcEstado = $lector.GetStatus()
  Detalle ("ResultCode: $rcEstado")
  $estado = Propiedad $lector @('Status')
  if ($estado) { Detalle ("estado: " + (Propiedad $estado @('Status','ReaderStatusCode'))) }
} catch { Detalle ("GetStatus fallo (no es bloqueante): " + $_.Exception.Message) }

# ── [7] Capturar ────────────────────────────────────────────────────────────
Paso "Capture() — coloca el dedo (timeout ${TimeoutMs} ms)"
$formato   = Enum-Valor 'Fid|Format'            @('ANSI','ISO')
$procesado = Enum-Valor 'CaptureProcessing'     @('DEFAULT','NONE','DP_IMG_PROC_DEFAULT')
if (-not $formato)   { Morir '[7] Capture()' ([Exception]::new('no se encontro el enum de formato Fid')) }
if (-not $procesado) { Morir '[7] Capture()' ([Exception]::new('no se encontro el enum CaptureProcessing')) }
Detalle ("formato: " + $formato.nombre + " · procesado: " + $procesado.nombre)

# Cuarto parametro = resolucion en dpi. El 4500 es de 500.
$resolucion = 500
try {
  $caps = Propiedad $lector @('Capabilities')
  $res  = Propiedad $caps @('Resolutions')
  if ($res -and $res.Count -gt 0) { $resolucion = $res[0]; Detalle "resolucion del lector: $resolucion" }
} catch { }

try {
  $resultado = $lector.Capture($formato.valor, $procesado.valor, $TimeoutMs, $resolucion)
} catch { Morir '[7] Reader.Capture()' $_ }

# ── [8] Resultado ───────────────────────────────────────────────────────────
Paso 'Evaluando el resultado de la captura'
$rcCap = Propiedad $resultado @('ResultCode')
Detalle ("ResultCode: $rcCap")
if ($rcCap -and "$rcCap" -notmatch 'SUCCESS|OK') {
  [Console]::Error.WriteLine("FALLO EN: [8] la captura devolvio $rcCap")
  exit 1
}

# ── [9] Extraer la imagen ───────────────────────────────────────────────────
Paso 'Extrayendo la imagen'
$fid = Propiedad $resultado @('Data','Fid','Image')
if (-not $fid) { Volcar $resultado 'CaptureResult'; Morir '[9] extraccion' ([Exception]::new('el resultado no expone la imagen donde se esperaba')) }
$vistas = Propiedad $fid @('Views','View')
if (-not $vistas -or $vistas.Count -eq 0) { Volcar $fid 'Fid'; Morir '[9] extraccion' ([Exception]::new('el Fid no trae vistas')) }
$vista  = $vistas[0]
$bytes  = Propiedad $vista @('Bytes','Data','RawImage')
$ancho  = Propiedad $vista @('Width')
$alto   = Propiedad $vista @('Height')
if (-not $bytes -or -not $ancho -or -not $alto) { Volcar $vista 'View'; Morir '[9] extraccion' ([Exception]::new('la vista no expone bytes/ancho/alto')) }
Detalle "imagen cruda: ${ancho}x${alto}, $($bytes.Length) bytes en escala de grises"

# ── [10] A PNG ──────────────────────────────────────────────────────────────
Paso 'Convirtiendo a PNG'
try {
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap($ancho, $alto, [System.Drawing.Imaging.PixelFormat]::Format8bppIndexed)
  $pal = $bmp.Palette
  for ($i = 0; $i -lt 256; $i++) { $pal.Entries[$i] = [System.Drawing.Color]::FromArgb($i, $i, $i) }
  $bmp.Palette = $pal

  $rect = New-Object System.Drawing.Rectangle(0, 0, $ancho, $alto)
  $lock = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $bmp.PixelFormat)
  # Fila a fila: el stride del bitmap no tiene por que coincidir con el ancho.
  for ($y = 0; $y -lt $alto; $y++) {
    $destino = [IntPtr]($lock.Scan0.ToInt64() + ($y * $lock.Stride))
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, $y * $ancho, $destino, $ancho)
  }
  $bmp.UnlockBits($lock)

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $png = $ms.ToArray()
  $ms.Dispose(); $bmp.Dispose()
  Detalle "PNG: $($png.Length) bytes"
} catch { Morir '[10] conversion a PNG' $_ }

# ── [11] Salida ─────────────────────────────────────────────────────────────
Paso 'Emitiendo DATA:'
try { $lector.Close() } catch { }
# La unica linea de la salida estandar. El base64 NUNCA va al log de etapas.
Write-Output ("DATA: " + [Convert]::ToBase64String($png))
exit 0
