<#
  CAPTURADOR NATIVO — habla directamente con dpfpdd.dll
  =====================================================

  Sustituye al motor gestionado (`capturador.ps1` sobre DPUruNet), que en este
  hardware muere en `GetReaders()` con DP_FAILURE. La capa nativa por debajo ya
  esta demostrada en este mismo equipo: init, query_devices, open y capture
  devolvieron 0x00000000 y produjeron una imagen de 357x392 a 500 dpi.

  MISMO CONTRATO DE SALIDA que los otros motores, a proposito:

      salida estandar : una unica linea  DATA: <base64 de un PNG>
      salida de error : etapas legibles + lineas de maquina para el agente

  Asi el agente, el frontend y el backend no se enteran del cambio de motor.

  LINEAS DE MAQUINA (salida de error, las lee el agente):
      META: {"width":357,"height":392,"dpi":500,"quality":0,"dispositivo":"..."}
      CODE: <TAXONOMIA>      STAGE: <funcion>      MSG: <texto para la persona>

  DATOS BIOMETRICOS: el base64 sale UNICAMENTE por la salida estandar y no se
  escribe en ninguna traza. Las etapas registran codigos y dimensiones.

  USO
      .\capturador-nativo.ps1                 # captura
      .\capturador-nativo.ps1 -Diagnostico    # ademas explica por pantalla
      .\capturador-nativo.ps1 -SoloDiagnostico  # etapas 1-5, SIN pedir dedo
#>

[CmdletBinding()]
param(
  [string] $Shim,
  [int]    $TimeoutMs = 25000,
  [switch] $Diagnostico,
  # Enumera y abre para comprobar que todo responde, pero NO captura. Es lo que
  # usa el instalador: verificar de verdad sin obligar a nadie a poner el dedo.
  [switch] $SoloDiagnostico
)

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'

$script:Etapa = 0
function Paso([string]$t) {
  $script:Etapa++
  $l = "[{0,2}] {1}" -f $script:Etapa, $t
  # Solo a stderr: al ejecutarse con -File, stderr ya se ve en la consola, y
  # escribir ademas con Write-Host duplicaba cada linea del diagnostico.
  [Console]::Error.WriteLine($l)
}
function Detalle([string]$t) {
  [Console]::Error.WriteLine("     $t")
}
function Hex($n) { '0x{0:X8}' -f ([uint32]$n) }

# Salida de fallo en el formato que el agente sabe leer. El hex del SDK va al
# detalle tecnico; `MSG` es lo unico pensado para una persona.
function Fallar([string]$code, [string]$stage, [string]$mensaje, $hex) {
  if ($null -ne $hex) { [Console]::Error.WriteLine("     codigo nativo: $(Hex $hex)") }
  [Console]::Error.WriteLine("CODE: $code")
  [Console]::Error.WriteLine("STAGE: $stage")
  [Console]::Error.WriteLine("MSG: $mensaje")
  if ($Diagnostico) { Write-Host "FALLO $code en $stage : $mensaje" -ForegroundColor Red }
  exit 1
}

# ── Shim ────────────────────────────────────────────────────────────────────
if (-not $Shim) { $Shim = Join-Path $PSScriptRoot 'shim-nativo.cs' }
if (-not (Test-Path -LiteralPath $Shim)) {
  Fallar 'INIT_ERROR' 'shim' "No se encuentra shim-nativo.cs junto al capturador ($Shim)." $null
}
# DE 6 SEGUNDOS A MENOS DE 2.
#
# `Add-Type -Path shim-nativo.cs` invoca al compilador de C# EN CADA CAPTURA.
# Medido en el equipo de pruebas: entre pedir la captura y encender el sensor
# pasaban ~6 s, y casi todo era compilar. La persona apoyaba el dedo antes de
# tiempo, lo retiraba al ver que no pasaba nada, y la captura expiraba.
#
# La solucion es compilar UNA vez a un .dll y cargarlo despues, que es
# instantaneo. Se recompila solo si el .cs es mas nuevo que el .dll, asi que
# editar el shim sigue surtiendo efecto sin pasos manuales.
$dllShim = [IO.Path]::ChangeExtension($Shim, '.dll')
try {
  # Si el .dll viene en el paquete y el .cs no se ha tocado despues, NO se
  # compila nada: el equipo destino no necesita compilador de C#.
  $hayQueCompilar = -not (Test-Path -LiteralPath $dllShim) -or
    ((Get-Item $Shim).LastWriteTimeUtc -gt (Get-Item $dllShim).LastWriteTimeUtc)

  if ($hayQueCompilar) {
    Detalle 'compilando el shim (solo esta vez)...'
    Add-Type -Path $Shim -OutputAssembly $dllShim -ErrorAction Stop
  }
  Add-Type -Path $dllShim -ErrorAction Stop
} catch {
  # Si no se puede escribir el .dll (carpeta de solo lectura, antivirus), se
  # compila en memoria como siempre: mas lento, pero funciona.
  try {
    Add-Type -Path $Shim -ErrorAction Stop
    Detalle 'shim compilado en memoria (sin cache)'
  } catch {
    Fallar 'INIT_ERROR' 'shim' ("No se pudo compilar el shim nativo: " + $_.Exception.Message) $null
  }
}

# dpfpdd.dll tiene que resolverse desde la carpeta del capturador. Sin esto el
# cargador de Windows solo mira PATH y el directorio del proceso, que al
# lanzarse desde el agente no es el mismo.
$carpeta = Split-Path -Parent $Shim
[Environment]::CurrentDirectory = $carpeta
$env:PATH = "$carpeta;$env:PATH"

$dev      = [IntPtr]::Zero
$iniciado = $false

try {
  # ── [1] init ──────────────────────────────────────────────────────────────
  Paso 'dpfpdd_init()'
  $rc = [Dpfpdd]::dpfpdd_init()
  Detalle (Hex $rc)
  if ($rc -ne [Dpfpdd]::SUCCESS) {
    Fallar 'INIT_ERROR' 'dpfpdd_init' 'No se pudo inicializar el software del lector.' $rc
  }
  $iniciado = $true
  Detalle ("proceso de 64 bits: " + [Environment]::Is64BitProcess)

  # ── [2] cuantos lectores ──────────────────────────────────────────────────
  Paso 'dpfpdd_query_devices() — conteo'
  [uint32]$cuantos = 0
  $rc = [Dpfpdd]::dpfpdd_query_devices([ref]$cuantos, [IntPtr]::Zero)
  Detalle ("$(Hex $rc) · lectores: $cuantos")
  # La primera pasada devuelve "hace falta mas sitio", que aqui NO es un error.
  if ($cuantos -eq 0) {
    Fallar 'NO_READER' 'dpfpdd_query_devices' 'No se detecta ningun lector conectado.' $rc
  }

  # ── [3] enumeracion completa ──────────────────────────────────────────────
  Paso 'dpfpdd_query_devices() — completo'
  $tam  = [Runtime.InteropServices.Marshal]::SizeOf([Type][Dpfpdd+DEV_INFO])
  $mem  = [Runtime.InteropServices.Marshal]::AllocHGlobal($tam * [int]$cuantos)
  $info = $null
  try {
    # Cada elemento declara su propio tamano: es la comprobacion que hace el
    # SDK para detectar un layout incompatible y fallar limpio.
    for ($i = 0; $i -lt [int]$cuantos; $i++) {
      $p = [IntPtr]($mem.ToInt64() + ($i * $tam))
      [Runtime.InteropServices.Marshal]::WriteInt32($p, 0, $tam)
    }
    $rc = [Dpfpdd]::dpfpdd_query_devices([ref]$cuantos, $mem)
    Detalle (Hex $rc)
    if ($rc -ne [Dpfpdd]::SUCCESS) {
      Fallar 'ENUMERATION_ERROR' 'dpfpdd_query_devices' 'No se pudo enumerar el lector.' $rc
    }

    # ── [4] elegir lector ───────────────────────────────────────────────────
    Paso 'Seleccionando lector'
    $elegido = $null
    for ($i = 0; $i -lt [int]$cuantos; $i++) {
      $p = [IntPtr]($mem.ToInt64() + ($i * $tam))
      $d = [Runtime.InteropServices.Marshal]::PtrToStructure($p, [Type][Dpfpdd+DEV_INFO])
      Detalle ("[$i] " + $d.descr.product_name + " · " + $d.descr.vendor_name)
      # VID_05BA/PID_000A = U.are.U 4500. Si no encaja el nombre, vale el primero:
      # el agente ya filtro antes por dispositivo presente.
      if (-not $elegido -or $d.name -match '05ba.*000a' -or $d.descr.product_name -match 'U\.are\.U') {
        if (-not $elegido -or $d.descr.product_name -match 'U\.are\.U') { $elegido = $d }
      }
    }
    $info = $elegido
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($mem)
  }
  if (-not $info) { Fallar 'NO_READER' 'seleccion' 'No se pudo seleccionar ningun lector.' $null }
  $dispositivo = if ($info.descr.product_name) { $info.descr.product_name.Trim() } else { 'U.are.U 4500' }
  Detalle ("elegido: $dispositivo")

  # ── [5] abrir ─────────────────────────────────────────────────────────────
  Paso 'dpfpdd_open()'
  $rc = [Dpfpdd]::dpfpdd_open($info.name, [ref]$dev)
  Detalle (Hex $rc)
  if ($rc -ne [Dpfpdd]::SUCCESS) {
    $dev = [IntPtr]::Zero
    Fallar 'OPEN_ERROR' 'dpfpdd_open' 'No fue posible abrir el lector. Puede estar en uso por otro programa.' $rc
  }
  Detalle ("handle: " + $dev.ToInt64())

  if ($SoloDiagnostico) {
    Paso 'Diagnostico completo — no se captura'
    [Console]::Error.WriteLine("META: " + (@{ dispositivo = $dispositivo; lectores = [int]$cuantos; abierto = $true } | ConvertTo-Json -Compress))
    if ($Diagnostico) { Write-Host "OK: lector listo ($dispositivo)" -ForegroundColor Green }
    exit 0
  }

  # ── [6] parametros ────────────────────────────────────────────────────────
  Paso 'Preparando CAPTURE_PARAM'
  $param = New-Object Dpfpdd+CAPTURE_PARAM
  $param.size       = [uint32][Runtime.InteropServices.Marshal]::SizeOf([Type][Dpfpdd+CAPTURE_PARAM])
  $param.image_fmt  = [Dpfpdd]::IMG_FMT_PIXEL_BUFFER
  $param.image_proc = [Dpfpdd]::IMG_PROC_DEFAULT
  $param.image_res  = 500
  Detalle 'formato: PIXEL_BUFFER · procesado: DEFAULT · 500 dpi'

  $res = New-Object Dpfpdd+CAPTURE_RESULT
  $res.size = [uint32][Runtime.InteropServices.Marshal]::SizeOf([Type][Dpfpdd+CAPTURE_RESULT])
  # IMAGE_INFO se arma aparte y se asigna completo: es un tipo por valor, y
  # `$res.info.size = X` escribiria sobre una copia que se descarta.
  $ii = New-Object Dpfpdd+IMAGE_INFO
  $ii.size = [uint32][Runtime.InteropServices.Marshal]::SizeOf([Type][Dpfpdd+IMAGE_INFO])
  $res.info = $ii

  # ── [7] capturar ──────────────────────────────────────────────────────────
  Paso ("dpfpdd_capture() - coloca el dedo. Espera maxima: " + $TimeoutMs + " ms")
  # Dos pasadas, y no un bufer fijo a ojo: la primera llamada con bufer nulo
  # devuelve el tamano EXACTO que hace falta. Verificado en hardware el
  # 2026-09-06: pidio 139944 bytes para una imagen de 357x392, ni uno mas.
  [uint32]$tamImg = 0
  $rc = [Dpfpdd]::dpfpdd_capture($dev, [ref]$param, [uint32]$TimeoutMs, [ref]$res, [ref]$tamImg, $null)
  if ($tamImg -eq 0) { $tamImg = 512 * 1024 }   # respaldo si el sondeo no dice nada
  Detalle ("bufer: $tamImg bytes")

  $buffer = New-Object byte[] ([int]$tamImg)
  $rc = [Dpfpdd]::dpfpdd_capture($dev, [ref]$param, [uint32]$TimeoutMs, [ref]$res, [ref]$tamImg, $buffer)
  Detalle (Hex $rc)
  if ($rc -ne [Dpfpdd]::SUCCESS) {
    # 0x0000000D en esta API es tiempo agotado esperando el dedo.
    if ((Hex $rc) -eq '0x0000000D' -or $rc -eq 13) {
      Fallar 'CAPTURE_TIMEOUT' 'dpfpdd_capture' 'Se agoto el tiempo de espera. No se coloco ningun dedo.' $rc
    }
    Fallar 'CAPTURE_ERROR' 'dpfpdd_capture' 'No fue posible capturar la huella.' $rc
  }

  # ── [8] validar ───────────────────────────────────────────────────────────
  Paso 'Validando el resultado'
  $w = [int]$res.info.width; $h = [int]$res.info.height
  $bpp = [int]$res.info.bpp; $dpi = [int]$res.info.res
  Detalle "success=$($res.success) quality=$($res.quality) score=$($res.score) ${w}x${h} ${dpi}dpi ${bpp}bpp ${tamImg} bytes"
  if ($res.success -eq 0) {
    # `quality` NO es un porcentaje: es el motivo por el que la captura no
    # salio. 0 es GOOD; el resto son causas concretas, casi todas culpa del
    # dedo y no del equipo, y cada una tiene su propio arreglo. Mapearlas todas
    # a "error de captura" convertia un simple "no pusiste el dedo" en un 500.
    $porQue = switch ([int]$res.quality) {
      1  { @('CAPTURE_TIMEOUT', 'Se agoto el tiempo de espera. No se coloco ningun dedo en el lector.') }
      2  { @('CAPTURE_CANCELED','La captura se cancelo.') }
      3  { @('CAPTURE_TIMEOUT', 'No se detecto ningun dedo en el lector.') }
      4  { @('CAPTURE_ERROR',   'El lector rechazo el dedo. Apoya la yema directamente sobre el cristal.') }
      5  { @('CAPTURE_ERROR',   'La huella salio demasiado clara. Apoya el dedo con algo mas de presion.') }
      6  { @('CAPTURE_ERROR',   'La huella salio demasiado oscura. Apoya el dedo con menos presion.') }
      7  { @('CAPTURE_ERROR',   'Imagen con demasiado ruido. Limpia el cristal del lector y el dedo.') }
      8  { @('CAPTURE_ERROR',   'Poco contraste. Si tienes el dedo muy seco, humedecelo ligeramente.') }
      9  { @('CAPTURE_ERROR',   'No se distinguen suficientes crestas. Centra bien la yema y repite.') }
      10 { @('CAPTURE_ERROR',   'El dedo no estaba centrado en el lector.') }
      default { @('CAPTURE_ERROR', "El lector no dio la captura por buena (motivo $($res.quality)). Repite.") }
    }
    Detalle ("quality=$($res.quality) -> " + $porQue[0])
    Fallar $porQue[0] 'capture_result' $porQue[1] $null
  }
  if ($w -le 0 -or $h -le 0 -or $bpp -ne 8) {
    Fallar 'INVALID_IMAGE' 'capture_result' 'La imagen recibida no tiene el formato esperado.' $null
  }
  if ([int]$tamImg -lt ($w * $h)) {
    Fallar 'INVALID_IMAGE' 'capture_result' "Faltan datos de imagen: $tamImg bytes para ${w}x${h}." $null
  }

  # ── [9] RAW 8bpp a PNG ────────────────────────────────────────────────────
  Paso 'Convirtiendo a PNG'
  try {
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format8bppIndexed)
    $pal = $bmp.Palette
    for ($i = 0; $i -lt 256; $i++) { $pal.Entries[$i] = [System.Drawing.Color]::FromArgb($i, $i, $i) }
    $bmp.Palette = $pal

    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $lock = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $bmp.PixelFormat)
    # Fila a fila: el stride del bitmap se alinea a 4 bytes y casi nunca vale $w.
    for ($y = 0; $y -lt $h; $y++) {
      $destino = [IntPtr]($lock.Scan0.ToInt64() + ($y * $lock.Stride))
      [Runtime.InteropServices.Marshal]::Copy($buffer, $y * $w, $destino, $w)
    }
    $bmp.UnlockBits($lock)

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = $ms.ToArray()
    $ms.Dispose(); $bmp.Dispose()
    Detalle "PNG: $($png.Length) bytes"
  } catch {
    Fallar 'PNG_ERROR' 'conversion' ('No se pudo construir el PNG: ' + $_.Exception.Message) $null
  }

  # ── [10] [11] base64 y salida ─────────────────────────────────────────────
  Paso 'Emitiendo DATA:'
  [Console]::Error.WriteLine("META: " + (@{
    width = $w; height = $h; dpi = $dpi; quality = [int]$res.quality
    score = [int]$res.score; dispositivo = $dispositivo; motor = 'dpfpdd'
  } | ConvertTo-Json -Compress))
  Write-Output ("DATA: " + [Convert]::ToBase64String($png))
  exit 0

} finally {
  # ── [12] [13] cerrar SIEMPRE ──────────────────────────────────────────────
  # Un handle sin cerrar deja el lector inservible hasta que muera el proceso,
  # y el siguiente intento fallaria con "en uso" sin motivo aparente.
  if ($dev -ne [IntPtr]::Zero) {
    try { $null = [Dpfpdd]::dpfpdd_close($dev); [Console]::Error.WriteLine('     dpfpdd_close() hecho') } catch { }
  }
  if ($iniciado) {
    try { $null = [Dpfpdd]::dpfpdd_exit(); [Console]::Error.WriteLine('     dpfpdd_exit() hecho') } catch { }
  }
}
