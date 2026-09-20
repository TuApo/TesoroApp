#Requires -Version 5.1
<#
  AGENTE LOCAL DEL HUELLERO — TuApo
  =================================

  Pone el lector U.are.U del computador al alcance de la version WEB de
  Tesoreria (https://tesoro.tuapo.co). Sin Electron, sin extensiones, sin
  drivers nuevos: solo este script, que ya trae Windows todo lo necesario
  para ejecutar.

  Habla el contrato que espera `EstrategiaAgenteLocal` del frontend:

      GET  /ping      -> 200 { "ok": true, "dispositivo": "U.are.U 4500" }
      POST /capturar  -> 200 { "imagenBase64": "...", "dispositivo": "..." }
                         404 { "error": "sin-lector" }

  POR QUE UN TcpListener Y NO System.Net.HttpListener
  ---------------------------------------------------
  HttpListener se apoya en http.sys, que exige una reserva de URL
  (`netsh http add urlacl`) y por tanto una consola de administrador en cada
  equipo. Un TcpListener sobre loopback no necesita ningun privilegio: el
  agente lo instala y lo arranca el mismo usuario de la oficina. El protocolo
  son dos rutas, asi que hablar HTTP/1.1 a mano sale mas barato que pedir
  permisos de administrador en veinte computadores.

  POR QUE 127.0.0.1 Y NO LA IP DE LA RED
  --------------------------------------
  A proposito: escuchar en la red expondria el lector de un equipo a toda la
  oficina. Loopback significa que solo el navegador de ESTE computador puede
  pedir una huella.

  TRES COSAS DEL NAVEGADOR QUE ESTE AGENTE TIENE QUE RESOLVER
  -----------------------------------------------------------
  1. Contenido mixto: NO es problema. Una pagina https puede llamar a
     http://127.0.0.1 porque loopback cuenta como origen confiable.
  2. CORS si lo es: sin `Access-Control-Allow-Origin` el navegador descarta
     la respuesta. Y el Origin se valida contra una lista blanca, porque si
     no, cualquier web abierta en el equipo podria pedir una huella.
  3. Private Network Access: Chrome manda `Access-Control-Request-Private-
     Network` en el preflight cuando una pagina publica llama a loopback, y
     descarta la respuesta si no le contestan `Access-Control-Allow-Private-
     Network: true`.

  USO
  ---
      .\huellero-agente.ps1              # arranca el agente
      .\huellero-agente.ps1 -Probar      # diagnostico, no arranca nada
#>

[CmdletBinding()]
param(
  [int]    $Puerto = 52181,

  # El ejecutable de captura del SDK U.are.U. Por defecto, el que viaja al lado
  # de este script; si no esta, se busca donde lo deja la app de escritorio.
  [string] $Exe,

  # Quien puede pedir una huella a este equipo. Todo lo demas recibe 403.
  [string[]] $OrigenesPermitidos = @(
    'https://tesoro.tuapo.co',
    'http://localhost:4200',
    'http://127.0.0.1:4200'
  ),

  # Cuanto se espera a que la persona ponga el dedo antes de rendirse.
  #
  # 25 s A PROPOSITO, y no mas: el frontend aborta su fetch a los 30 s
  # (msCaptura en estrategias.ts). Con el agente en 60 s, el navegador se
  # rendia primero y el agente seguia capturando medio minuto mas con el lector
  # tomado, de modo que el intento siguiente se lo encontraba ocupado. El
  # agente tiene que rendirse SIEMPRE antes que quien le pregunta.
  [int] $SegundosCaptura = 25,

  # Solo diagnostica el equipo y sale.
  [switch] $Probar,

  # Rastrea TODOS los discos buscando las librerias del SDK. Tarda minutos: es
  # la red de seguridad para cuando no estan en las rutas habituales.
  [switch] $BuscarSdk
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# Se resuelve antes que nada: -BuscarSdk trabaja sobre la carpeta del script.
$AquiMismo = $PSScriptRoot

# ─────────────────────────────────────────────────────────────────────────────
# Utilidades
# ─────────────────────────────────────────────────────────────────────────────

# TODO LO QUE SE ESCRIBE VA TAMBIEN A UN ARCHIVO.
#
# El agente corre SIN VENTANA: si sus mensajes solo fueran a la consola, no
# habria forma de saber que paso. El archivo es lo que se mira cuando algo
# falla, y `VER-LOG.cmd` lo abre.
$script:Log = Join-Path $PSScriptRoot 'agente.log'
try {
  # Se recorta al arrancar si crece: es un diario de diagnostico, no un archivo
  # que deba durar para siempre en el disco de una oficina.
  if ((Test-Path $script:Log) -and ((Get-Item $script:Log).Length -gt 1MB)) {
    Set-Content -Path $script:Log -Value '' -Encoding UTF8
  }
} catch { }

function Escribir([string]$nivel, [string]$texto) {
  $marca = (Get-Date).ToString('HH:mm:ss')
  $color = switch ($nivel) { 'ERR' { 'Red' } 'AVISO' { 'Yellow' } 'OK' { 'Green' } default { 'Gray' } }
  Write-Host "[$marca] $texto" -ForegroundColor $color
  # Nunca se registran datos biometricos: el base64 no pasa por aqui.
  try { Add-Content -Path $script:Log -Value "[$marca] [$nivel] $texto" -Encoding UTF8 -ErrorAction SilentlyContinue } catch { }
}

function Resolver-Exe {
  if ($Exe -and (Test-Path -LiteralPath $Exe)) { return (Resolve-Path -LiteralPath $Exe).Path }

  $candidatos = @(
    (Join-Path $PSScriptRoot 'UareUSampleCSharp_CaptureOnly.exe'),
    (Join-Path $PSScriptRoot 'csharp\UareUSampleCSharp_CaptureOnly.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\tesoreria\resources\csharp\UareUSampleCSharp_CaptureOnly.exe'),
    'C:\Program Files\DigitalPersona\U.are.U SDK\Windows\Samples\UareUSampleCSharp_CaptureOnly.exe'
  )
  foreach ($c in $candidatos) { if (Test-Path -LiteralPath $c) { return (Resolve-Path -LiteralPath $c).Path } }
  return $null
}

<#
  Hay lector conectado? Se mira el arbol de dispositivos, no el SDK: preguntarle
  al SDK obliga a lanzar el ejecutable, que abre una ventana y pide un dedo. El
  sondeo tiene que ser silencioso porque el frontend lo hace al abrir la pestana.

  VID_05BA es DigitalPersona. Si la consulta falla por lo que sea, se responde
  que SI hay lector: un "sin lector" falso deja a la oficina sin poder intentarlo
  siquiera, que es peor que dejarles fallar en la captura con un mensaje claro.
#>
$script:Capturando      = $false
$script:CapturandoDesde = [datetime]::MinValue

$script:LectorCache   = $null
$script:LectorCacheTs = [datetime]::MinValue

function Buscar-Lector([switch]$Forzar) {
  # 10 s de caché: suficiente para que /ping sea instantáneo y para notar que
  # alguien acaba de conectar el lector sin recargar la página.
  if (-not $Forzar -and $script:LectorCache -and
      ((Get-Date) - $script:LectorCacheTs).TotalSeconds -lt 10) {
    return $script:LectorCache
  }
  $r = Consultar-Lector
  $script:LectorCache   = $r
  $script:LectorCacheTs = Get-Date
  return $r
}

function Consultar-Lector {
  try {
    # Cast a texto ANTES de comparar: con StrictMode, tocar una propiedad que
    # un dispositivo no tiene lanza y se lleva por delante toda la tuberia,
    # dejando $d vacio aunque el lector este ahi.
    $d = Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object {
      $id     = [string]$_.InstanceId
      $nombre = [string]$_.FriendlyName
      $id -like '*VID_05BA*' -or $nombre -like '*U.are.U*' -or $nombre -like '*DigitalPersona*' -or
      $nombre -like '*Fingerprint*' -or $nombre -like '*Huella*'
    } | Select-Object -First 1

    if ($d) { return @{ hay = $true; nombre = [string]$d.FriendlyName } }
    return @{ hay = $false; nombre = $null }
  } catch {
    return @{ hay = $true; nombre = $null }
  }
}


<#
  BUSCAR LAS LIBRERIAS DEL SDK Y TRAERLAS AL LADO DEL EJECUTABLE

  El programa de captura es el sample del U.are.U SDK y carga `DPUruNet.dll` mas
  sus binarios nativos. El cargador de .NET solo mira DOS sitios: la carpeta del
  propio ejecutable y el GAC. Si el SDK esta instalado en el equipo pero en otra
  ruta —lo normal— el ejecutable no lo encuentra aunque este ahi delante.

  Esto recorre las rutas donde suele quedar instalado y copia lo que haga falta
  al lado del .exe. Si no hay nada que copiar no pasa nada: se avisa y ya.

  OJO A LA ARQUITECTURA: el ejecutable es de 32 bits, asi que necesita las DLL
  nativas de 32 bits. Por eso `Program Files (x86)` se mira ANTES.
#>
function Traer-DllDelSdk([string]$destino) {
  $yaEsta = Join-Path $destino 'DPUruNet.dll'
  if (Test-Path -LiteralPath $yaEsta) { return $true }

  $raices = @(
    "${env:ProgramFiles(x86)}\DigitalPersona",
    "$env:ProgramFiles\DigitalPersona",
    "${env:ProgramFiles(x86)}\DigitalPersona\U.are.U SDK",
    "$env:ProgramFiles\DigitalPersona\U.are.U SDK",
    "$env:LOCALAPPDATA\Programs\tesoreria\resources",
    "$env:LOCALAPPDATA\Programs\tesoreria",
    "$env:WINDIR\Microsoft.NET\assembly"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  Escribir 'INFO' 'Buscando las librerias del SDK en el equipo...'
  $encontrada = $null
  foreach ($raiz in $raices) {
    $encontrada = Get-ChildItem -LiteralPath $raiz -Filter 'DPUruNet.dll' -Recurse -File -ErrorAction SilentlyContinue |
                  Select-Object -First 1
    if ($encontrada) { break }
  }

  if (-not $encontrada) {
    Escribir 'AVISO' 'No se encontro DPUruNet.dll en este equipo. Hay que instalar el U.are.U SDK'
    Escribir 'AVISO' 'de DigitalPersona, o copiar sus DLL a esta carpeta. Ver el LEEME.'
    return $false
  }

  # Se lleva la vecindad completa: DPUruNet arrastra nativas (dpfpdd, dpfj) que
  # tienen que viajar con ella o el fallo se repite una capa mas abajo.
  $origen = Split-Path -Parent $encontrada.FullName
  Escribir 'OK' "Librerias encontradas en: $origen"
  $copiadas = 0
  foreach ($patron in @('DPUruNet.dll', 'dpfpdd*.dll', 'dpfj*.dll', 'DPCore*.dll', 'DpCore*.dll', 'dpHost*.dll', 'dpDevice*.dll')) {
    Get-ChildItem -LiteralPath $origen -Filter $patron -File -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        Copy-Item -LiteralPath $_.FullName -Destination $destino -Force -ErrorAction Stop
        $copiadas++
      } catch {
        Escribir 'AVISO' "  no se pudo copiar $($_.Name): $($_.Exception.Message)"
      }
    }
  }
  Escribir 'OK' "$copiadas archivo(s) copiado(s) junto al ejecutable."
  return (Test-Path -LiteralPath $yaEsta)
}

# ─────────────────────────────────────────────────────────────────────────────
# Captura
# ─────────────────────────────────────────────────────────────────────────────

<#
  Ejecuta el binario del SDK y saca el PNG de su stdout (`DATA: <base64>`).

  CreateNoWindow = $false a proposito: el ejecutable es una app WinForms del
  sample de DigitalPersona y necesita sesion interactiva para pintar su ventana.
  Por eso este agente corre en la sesion del usuario y NO como servicio de
  Windows: un servicio vive en la sesion 0 y el ejecutable no pintaria nada,
  quedandose colgado hasta el timeout.
#>
<#
  QUE MOTOR DE CAPTURA SE USA

  Dos caminos con el MISMO contrato de salida (`DATA: <base64 PNG>`):

    1. `capturador.ps1` — habla con DPUruNet directamente y reporta cada llamada
       al SDK como una etapa numerada. Es el bueno: sin ventana, con timeout y
       con cancelacion, y cuando falla dice EN QUE llamada.
    2. `UareUSampleCSharp_CaptureOnly.exe` — el sample del SDK. No hay codigo
       fuente suyo en el repositorio, asi que cuando revienta solo se puede
       leer el volcado de .NET. Se conserva como respaldo para no dejar sin
       captura a un equipo donde el camino 1 no arranque.

  Se prefiere 1 cuando estan su script y DPUruNet.dll; si no, 2.
#>
function Elegir-Motor([string]$carpeta) {
  # 1. NATIVO: habla con dpfpdd.dll directamente. Es el bueno — el envoltorio
  #    gestionado (DPUruNet) muere en GetReaders() con DP_FAILURE en este
  #    hardware, mientras que la capa nativa devuelve 0x00000000 en init,
  #    query_devices, open y capture.
  $nativo = Join-Path $carpeta 'capturador-nativo.ps1'
  $dpfpdd = Join-Path $carpeta 'dpfpdd.dll'
  if ((Test-Path -LiteralPath $nativo) -and (Test-Path -LiteralPath $dpfpdd)) {
    return @{ tipo = 'native'; ruta = $nativo; etiqueta = 'dpfpdd' }
  }
  # 2. SDK gestionado. Se conserva como marcha atras.
  $sdk = Join-Path $carpeta 'capturador.ps1'
  $dll = Join-Path $carpeta 'DPUruNet.dll'
  if ((Test-Path -LiteralPath $sdk) -and (Test-Path -LiteralPath $dll)) {
    return @{ tipo = 'sdk'; ruta = $sdk; etiqueta = 'dpurunet' }
  }
  # 3. El ejecutable de ejemplo, ultima red.
  return @{ tipo = 'exe'; ruta = $null; etiqueta = 'exe' }
}

<#
  Lanza `capturador.ps1` en su propio proceso.

  En proceso aparte A PROPOSITO: una excepcion nativa dentro del SDK se lleva
  por delante el proceso entero, y eso no puede tumbar al agente y dejar a la
  oficina sin lector. Ademas permite matarlo por timeout sin dejar el lector
  tomado.
#>
function Capturar-ConScript([string]$script, [int]$segundos) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName  = (Get-Process -Id $PID).Path   # el MISMO PowerShell: misma arquitectura
  $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -TimeoutMs $($segundos * 1000)"
  $psi.WorkingDirectory       = Split-Path -Parent $script
  $psi.UseShellExecute        = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError  = $true
  $psi.CreateNoWindow         = $true

  $p = [System.Diagnostics.Process]::Start($psi)
  $tOut = $p.StandardOutput.ReadToEndAsync()
  $tErr = $p.StandardError.ReadToEndAsync()

  # Margen sobre el timeout interno: que se rinda el capturador (25 s), no
  # nosotros. Con 25 + 10 el proceso muere a los 35 s como tope duro.
  if (-not $p.WaitForExit(($segundos + 10) * 1000)) {
    try { $p.Kill() } catch { }
    throw "El capturador no respondio en $segundos segundos."
  }
  $salida = $tOut.Result
  $etapas = $tErr.Result

  # Las etapas van al log del agente TAL CUAL: son el diagnostico. La imagen
  # viaja por la salida estandar y no se registra en ninguna parte.
  foreach ($linea in ($etapas -split "`r?`n")) {
    if ($linea.Trim()) { Escribir 'INFO' ("  " + $linea) }
  }

  # Lineas de maquina del capturador. `META:` acompana a una captura buena;
  # `CODE:`/`STAGE:`/`MSG:` describen el fallo por etapas.
  $meta = $null
  $mMeta = [regex]::Match($etapas, 'META:\s*(\{.*?\})')
  if ($mMeta.Success) { try { $meta = $mMeta.Groups[1].Value | ConvertFrom-Json } catch { } }

  $m = [regex]::Match($salida, 'DATA:\s*(\S+)')
  if (-not $m.Success) {
    $code  = ([regex]::Match($etapas, 'CODE:\s*(\S+)')).Groups[1].Value
    $stage = ([regex]::Match($etapas, 'STAGE:\s*(\S+)')).Groups[1].Value
    $msg   = ([regex]::Match($etapas, 'MSG:\s*([^\r\n]+)')).Groups[1].Value

    if (-not $msg) {
      # Capturadores antiguos: solo dejan un volcado. Se traduce como antes.
      $msg = ($etapas -split "`r?`n" | Where-Object { $_ -match '^(FALLO EN|MENSAJE|TIPO):' }) -join ' '
      if (-not $msg) { $msg = 'el capturador no devolvio ninguna imagen.' }
      $msg = Traducir-Error $msg
    }
    # Excepcion con datos: el agente necesita `code` y `stage` para armar el
    # JSON, y un `throw` de texto plano los perderia.
    $err = New-Object System.Exception($msg)
    $err.Data['code']  = if ($code)  { $code }  else { 'CAPTURE_ERROR' }
    $err.Data['stage'] = if ($stage) { $stage } else { 'capture' }
    throw $err
  }
  return @{ base64 = $m.Groups[1].Value.Trim(); meta = $meta }
}

function Capturar-Huella([string]$exe, [int]$segundos) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName               = $exe
  $psi.WorkingDirectory       = Split-Path -Parent $exe
  $psi.UseShellExecute        = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError  = $true
  $psi.CreateNoWindow         = $false
  # El ejecutable escribe en la pagina de codigos OEM de la consola. Leerlo con
  # la de por defecto es lo que convertia "Excepcion" en "Excepci¾n" y dejaba
  # el mensaje de error medio ilegible en la pantalla de contratacion.
  try {
    $oem = [System.Text.Encoding]::GetEncoding([System.Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
    $psi.StandardOutputEncoding = $oem
    $psi.StandardErrorEncoding  = $oem
  } catch { }

  $p = [System.Diagnostics.Process]::Start($psi)

  # Lectura asincrona: con los pipes redirigidos, un stdout que se llena bloquea
  # al hijo y WaitForExit no vuelve nunca. Clasico interbloqueo de execFile.
  $tOut = $p.StandardOutput.ReadToEndAsync()
  $tErr = $p.StandardError.ReadToEndAsync()

  if (-not $p.WaitForExit($segundos * 1000)) {
    try { $p.Kill() } catch { }
    throw "El lector no respondio en $segundos segundos."
  }
  $salida = $tOut.Result
  $error_ = $tErr.Result

  $m = [regex]::Match($salida, 'DATA:\s*(\S+)')
  if (-not $m.Success) {
    $detalle = if ($error_ -and $error_.Trim()) { $error_.Trim() } else { 'el lector no devolvio ninguna imagen.' }
    throw (Traducir-Error $detalle)
  }
  return $m.Groups[1].Value.Trim()
}

<#
  Un volcado de .NET no le sirve a nadie en una oficina. Los fallos que sabemos
  reconocer se cuentan en una frase y con el arreglo dentro; del resto se
  descarta al menos el ruido (los consejos sobre el registro de Windows, que no
  tienen nada que ver con el problema).
#>
function Traducir-Error([string]$texto) {
  # OJO AL ORDEN Y A LO ESTRICTO DE CADA PATRON.
  #
  # La primera version de esta funcion hacia `match 'DPUruNet'` a secas. Como el
  # error de verdad —`DPUruNet.SDKException: DP_FAILURE`— tambien contiene esa
  # palabra, TODO fallo del SDK se reescribia como "falta la DLL", con la DLL
  # cargando perfectamente. Una traduccion que se traga el diagnostico real es
  # peor que no traducir: nos mando a reinstalar lo que ya estaba bien.
  #
  # Regla: solo se traduce lo que se reconoce SIN AMBIGUEDAD, y el texto tecnico
  # original nunca se pierde.

  # 1. La DLL no se puede cargar. Tiene que decirlo el cargador, no la palabra.
  if ($texto -match 'FileNotFoundException|BadImageFormatException|No se puede cargar el archivo o ensamblado|Could not load file or assembly') {
    if ($texto -match 'DPUruNet') {
      return 'Falta DPUruNet.dll (U.are.U SDK de DigitalPersona) o no se puede cargar. ' +
             'Copiala junto al capturador, o instala el SDK del lector.'
    }
    if ($texto -match 'dpfpdd|dpfj|dpfr') {
      return 'Faltan las librerias NATIVAS del lector (dpfpdd/dpfj). Copialas junto a DPUruNet.dll. ' +
             'Deben ser de 64 bits.'
    }
  }

  # 2. El SDK carga y responde, pero la llamada falla. Esto NO es una DLL ausente.
  if ($texto -match 'DP_FAILURE|SDKException') {
    $etapa = if ($texto -match 'FALLO EN:\s*(\[\d+\][^\r\n]*)') { $matches[1] } else { 'una llamada al SDK' }
    return "El SDK del lector respondio DP_FAILURE en $etapa. El lector responde pero la llamada " +
           'no se pudo completar: suele ser otro proceso reteniendo el lector, o librerias de ' +
           'versiones distintas mezcladas en la carpeta. Revisa la ventana del agente: trae la etapa exacta.'
  }

  if ($texto -match 'DP_DEVICE_BUSY|busy|en uso') {
    return 'El lector esta tomado por otro programa. Cierra cualquier otra aplicacion de huella y reintenta.'
  }
  if ($texto -match 'no ve ningun lector|no reader|ReaderNotFound|lectores encontrados: 0') {
    return 'No se detecta el lector. Revisa el cable USB.'
  }

  # 3. Lo que no se reconoce se devuelve tal cual, solo sin el ruido inutil.
  $limpio = ($texto -split 'AVS:')[0].Trim()
  if ($limpio.Length -gt 500) { $limpio = $limpio.Substring(0, 500) + '...' }
  return $limpio
}

# ─────────────────────────────────────────────────────────────────────────────
# HTTP a mano
# ─────────────────────────────────────────────────────────────────────────────

function Leer-Peticion($stream) {
  $stream.ReadTimeout = 3000
  $buf = New-Object byte[] 4096
  $sb  = New-Object System.Text.StringBuilder
  while ($true) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    [void]$sb.Append([System.Text.Encoding]::ASCII.GetString($buf, 0, $n))
    if ($sb.ToString().Contains("`r`n`r`n")) { break }
    if ($sb.Length -gt 16384) { break }   # cabeceras absurdas: se corta
  }
  $texto = $sb.ToString()
  if (-not $texto) { return $null }

  $lineas = $texto -split "`r`n"
  $partes = $lineas[0] -split ' '
  if ($partes.Count -lt 2) { return $null }

  $cab = @{}
  for ($i = 1; $i -lt $lineas.Count; $i++) {
    if (-not $lineas[$i]) { break }
    $j = $lineas[$i].IndexOf(':')
    if ($j -gt 0) {
      $cab[$lineas[$i].Substring(0, $j).Trim().ToLowerInvariant()] = $lineas[$i].Substring($j + 1).Trim()
    }
  }
  return @{ metodo = $partes[0].ToUpperInvariant(); ruta = ($partes[1] -split '\?')[0]; cabeceras = $cab }
}

function Cabeceras-Cors([hashtable]$peticion) {
  $h = @{}
  $origen = $null
  if ($peticion.cabeceras.ContainsKey('origin')) { $origen = $peticion.cabeceras['origin'] }
  if ($origen -and ($OrigenesPermitidos -contains $origen)) {
    $h['Access-Control-Allow-Origin'] = $origen
    $h['Vary'] = 'Origin'
  }
  $h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
  $h['Access-Control-Allow-Headers'] = 'Content-Type'
  $h['Access-Control-Max-Age']       = '600'
  # Chrome descarta la respuesta al preflight de una pagina publica hacia
  # loopback si no ve esta cabecera.
  if ($peticion.cabeceras.ContainsKey('access-control-request-private-network')) {
    $h['Access-Control-Allow-Private-Network'] = 'true'
  }
  return $h
}

function Responder($stream, [int]$codigo, [string]$razon, [hashtable]$cabeceras, $objeto) {
  $json  = if ($null -eq $objeto) { '' } else { ($objeto | ConvertTo-Json -Compress -Depth 4) }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append("HTTP/1.1 $codigo $razon`r`n")
  [void]$sb.Append("Content-Type: application/json; charset=utf-8`r`n")
  [void]$sb.Append("Content-Length: $($bytes.Length)`r`n")
  [void]$sb.Append("Cache-Control: no-store`r`n")
  foreach ($k in $cabeceras.Keys) { [void]$sb.Append("$k`: $($cabeceras[$k])`r`n") }
  [void]$sb.Append("Connection: close`r`n`r`n")

  $cabBytes = [System.Text.Encoding]::ASCII.GetBytes($sb.ToString())
  $stream.Write($cabBytes, 0, $cabBytes.Length)
  if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) }
  $stream.Flush()
}

# ─────────────────────────────────────────────────────────────────────────────
# Rastreo completo (-BuscarSdk)
# ─────────────────────────────────────────────────────────────────────────────

if ($BuscarSdk) {
  Write-Host ''
  Write-Host '  Rastreando los discos en busca de DPUruNet.dll' -ForegroundColor Cyan
  Write-Host '  (puede tardar varios minutos)' -ForegroundColor DarkGray
  Write-Host ''

  $discos = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
            Where-Object { $_.Root -match '^[A-Z]:\\' }

  $hallazgos = @()
  foreach ($d in $discos) {
    Escribir 'INFO' "Buscando en $($d.Root)..."
    $hallazgos += Get-ChildItem -LiteralPath $d.Root -Filter 'DPUruNet.dll' -Recurse -File -ErrorAction SilentlyContinue
  }

  if (-not $hallazgos) {
    Escribir 'ERR' 'DPUruNet.dll no existe en este equipo. Hay que traerla de otro PC o instalar el SDK.'
  } else {
    foreach ($h in $hallazgos) { Escribir 'OK' $h.FullName }
    $origen = Split-Path -Parent $hallazgos[0].FullName
    Escribir 'INFO' "Copiando desde $origen ..."
    foreach ($patron in @('DPUruNet.dll', 'dpfpdd*.dll', 'dpfj*.dll', 'DPCore*.dll', 'DpCore*.dll')) {
      Get-ChildItem -LiteralPath $origen -Filter $patron -File -ErrorAction SilentlyContinue |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $AquiMismo -Force -ErrorAction SilentlyContinue }
    }
    Escribir 'OK' 'Listo. Vuelve a lanzar instalar-agente.cmd.'
  }
  Write-Host ''
  return
}

# ─────────────────────────────────────────────────────────────────────────────
# Diagnostico (-Probar)
# ─────────────────────────────────────────────────────────────────────────────

if ($Probar) {
  Write-Host ''
  Write-Host '  Diagnostico del agente de huella' -ForegroundColor Cyan
  Write-Host '  --------------------------------'

  $exe = Resolver-Exe
  if ($exe) { Escribir 'OK' "Ejecutable de captura: $exe" }
  else      { Escribir 'ERR' 'NO se encontro UareUSampleCSharp_CaptureOnly.exe junto a este script.' }

  # Verificacion REAL, no `Test-Path`. Que exista un archivo no demuestra que
  # el lector se pueda enumerar ni abrir, que es lo unico que importa. Se llega
  # hasta dpfpdd_open y se cierra: NO se pide ningun dedo.
  $carpeta = if ($exe) { Split-Path -Parent $exe } else { $PSScriptRoot }
  $motor = Elegir-Motor $carpeta
  Escribir 'INFO' "Motor seleccionado: $($motor.etiqueta)"

  if ($motor.tipo -eq 'native') {
    Escribir 'INFO' 'Probando el motor nativo (init -> enumerar -> abrir -> cerrar)...'
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName  = (Get-Process -Id $PID).Path
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$($motor.ruta)`" -SoloDiagnostico"
    $psi.WorkingDirectory = $carpeta
    $psi.UseShellExecute = $false
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardOutput = $true
    $psi.CreateNoWindow = $true
    $pr = [System.Diagnostics.Process]::Start($psi)
    $err = $pr.StandardError.ReadToEnd()
    $pr.WaitForExit(30000) | Out-Null
    foreach ($linea in ($err -split "`r?`n")) { if ($linea.Trim()) { Escribir 'INFO' ("  " + $linea) } }
    if ($pr.ExitCode -eq 0) { Escribir 'OK'  'El lector se enumera y se abre correctamente.' }
    else                    { Escribir 'ERR' 'El motor nativo no pudo abrir el lector (ver etapas arriba).' }
  } elseif ($exe) {
    if (Traer-DllDelSdk $carpeta) { Escribir 'AVISO' 'Solo motor gestionado: es el que falla con DP_FAILURE.' }
    else { Escribir 'ERR' 'Faltan las librerias del lector.' }
  }

  $lector = Buscar-Lector
  if ($lector.hay) { Escribir 'OK' ("Lector detectado: " + $(if ($lector.nombre) { $lector.nombre } else { '(no se pudo leer el nombre)' })) }
  else             { Escribir 'AVISO' 'No se ve ningun lector DigitalPersona conectado.' }

  $enUso = @(Get-NetTCPConnection -State Listen -LocalPort $Puerto -ErrorAction SilentlyContinue)
  if ($enUso.Count -gt 0) {
    Escribir 'AVISO' "El puerto $Puerto ya esta escuchando (quiza el agente ya corre). Se prueba /ping."
    try {
      $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Puerto/ping" -TimeoutSec 5
      Escribir 'OK' ("Responde /ping -> ok=$($r.ok) dispositivo=$($r.dispositivo)")
    } catch {
      Escribir 'ERR' "El puerto esta ocupado por otra cosa: $($_.Exception.Message)"
    }
  } else {
    Escribir 'OK' "Puerto $Puerto libre."
  }

  Write-Host ''
  Write-Host "  Origenes permitidos: $($OrigenesPermitidos -join ', ')" -ForegroundColor DarkGray
  Write-Host ''
  return
}

# ─────────────────────────────────────────────────────────────────────────────
# Servidor
# ─────────────────────────────────────────────────────────────────────────────

$rutaExe = Resolver-Exe
if (-not $rutaExe) {
  Escribir 'ERR' 'No se encontro UareUSampleCSharp_CaptureOnly.exe. Debe estar junto a este script.'
  exit 1
}

# UNA SOLA INSTANCIA, y que se note.
#
# El puerto ya impide que corran dos, pero el segundo moria con un error de
# socket que no explicaba nada. Un mutex con nombre da el motivo exacto antes
# de tocar la red, y evita la carrera de dos procesos arrancando a la vez.
$creado = $false
$script:Unico = New-Object System.Threading.Mutex($true, 'Global\TuApoAgenteHuella', [ref]$creado)
if (-not $creado) {
  Escribir 'AVISO' 'Ya hay un agente de huella corriendo en este equipo.'
  Escribir 'AVISO' 'Esta ventana se cierra: no hacen falta dos.'
  Start-Sleep -Seconds 3
  exit 0
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Puerto)
try {
  $listener.Start()
} catch {
  Escribir 'ERR' "No se pudo escuchar en 127.0.0.1:$Puerto."
  Escribir 'ERR' 'YA HAY UN AGENTE CORRIENDO en este equipo, probablemente una version ANTIGUA.'
  Escribir 'ERR' 'Esta copia se cierra sin hacer nada, asi que los cambios NO se aplican.'
  Escribir 'ERR' 'Cierra la otra ventana (o ejecuta desinstalar-agente.cmd) y vuelve a instalar.'
  exit 1
}

Escribir 'OK' "Agente de huella v22 escuchando en http://127.0.0.1:$Puerto"
Escribir 'INFO' "Ejecutable: $rutaExe"

# Se consulta AHORA, no en el primer /ping: cargar el modulo de dispositivos
# tarda y el navegador no espera.
$inicial = Buscar-Lector -Forzar
if ($inicial.hay) {
  Escribir 'OK' ("Lector: " + $(if ($inicial.nombre) { $inicial.nombre } else { '(nombre no legible, se asume conectado)' }))
} else {
  Escribir 'AVISO' 'No veo ningun lector conectado. Revisa el cable USB.'
}
# Antes de esperar peticiones, asegurarse de que el ejecutable va a poder
# arrancar. Avisar de que falta una DLL no sirve de nada si podemos ir a
# buscarla: se intenta, y solo si no aparece se avisa.
if (Traer-DllDelSdk (Split-Path -Parent $rutaExe)) {
  Escribir 'OK' 'Librerias del SDK listas junto al ejecutable.'
} else {
  Escribir 'AVISO' 'La captura fallara hasta que esten las librerias del SDK.'
}

$script:Motor = Elegir-Motor (Split-Path -Parent $rutaExe)
# EN QUE CARPETA SE BUSCA, SIEMPRE.
#
# El agente elige motor mirando los archivos que tiene AL LADO. Si se arranca
# desde una carpeta y las DLL estan en otra, cae en silencio al motor peor y
# la pantalla acaba culpando a una DLL que si existe... en otro sitio. Paso una
# sesion entera por esto: se dice la carpeta y se dice que falta.
$carpetaMotor = Split-Path -Parent $rutaExe
Escribir 'INFO' "Carpeta de trabajo: $carpetaMotor"

switch ($script:Motor.tipo) {
  'native' { Escribir 'OK'    'Motor de captura: NATIVO dpfpdd (etapas numeradas).' }
  'sdk'    { Escribir 'AVISO' 'Motor de captura: DPUruNet gestionado. Es el que falla con DP_FAILURE.' }
  default  {
    Escribir 'ERR' 'Motor de captura: ejecutable de ejemplo. NO es el que quieres.'
    foreach ($falta in @('capturador-nativo.ps1', 'shim-nativo.cs', 'dpfpdd.dll')) {
      if (-not (Test-Path -LiteralPath (Join-Path $carpetaMotor $falta))) {
        Escribir 'ERR' "  falta en esta carpeta: $falta"
      }
    }
    # Si la DLL vive en otra carpeta, decirlo: es el error de bulto que se
    # comete al descomprimir el paquete donde no es.
    $otras = @('C:\TuApo\agente-huella', "$env:USERPROFILE\Downloads\agente-huella") |
             Where-Object { $_ -ne $carpetaMotor -and (Test-Path (Join-Path $_ 'dpfpdd.dll')) }
    foreach ($o in $otras) {
      Escribir 'ERR' "  OJO: dpfpdd.dll SI esta en $o . Arranca el agente DESDE ALLI."
    }
  }
}

Escribir 'INFO' "Origenes permitidos: $($OrigenesPermitidos -join ', ')"
Escribir 'INFO' 'Deja esta ventana abierta. Ctrl+C para detener.'

try {
  while ($true) {
    $cliente = $listener.AcceptTcpClient()
    # Que el cierre espere a vaciar el buffer de salida (ver el finally).
    try { $cliente.LingerState = New-Object System.Net.Sockets.LingerOption($true, 3) } catch { }
    $stream  = $null
    try {
      # ────────────────────────────────────────────────────────────────────
      # CONEXIONES QUE NO DICEN NADA
      #
      # Los navegadores abren sockets de mas: los precalientan para la
      # siguiente peticion y los dejan en silencio. Este agente atiende de uno
      # en uno, asi que quedarse esperando datos en un socket mudo bloquea al
      # SIGUIENTE, que es el bueno. Con 5 s de espera de lectura, una conexion
      # especulativa de Chrome dejaba a la pagina sin respuesta y la pantalla
      # decia "el navegador bloqueo la conexion" cuando el bloqueado era el
      # agente.
      #
      # Poll mira si hay algo que leer sin comprometerse a esperar: en loopback
      # una peticion de verdad manda sus cabeceras de inmediato. Lo que no
      # habla en 1 s, se suelta y a por el siguiente.
      # ────────────────────────────────────────────────────────────────────
      if (-not $cliente.Client.Poll(1000000, [System.Net.Sockets.SelectMode]::SelectRead)) {
        continue   # socket mudo: el finally lo cierra
      }
      $stream = $cliente.GetStream()
      $pet = Leer-Peticion $stream
      if (-not $pet) { continue }

      $cors = Cabeceras-Cors $pet
      $desde = if ($pet.cabeceras.ContainsKey('origin')) { $pet.cabeceras['origin'] } else { '(sin origen)' }
      Escribir 'INFO' "$($pet.metodo) $($pet.ruta)  <- $desde"

      # Preflight
      if ($pet.metodo -eq 'OPTIONS') {
        Responder $stream 204 'No Content' $cors $null
        continue
      }

      # Lista blanca de origenes: un navegador sin Origin (o una prueba con
      # curl) pasa; una web ajena abierta en este equipo, no.
      if ($pet.cabeceras.ContainsKey('origin') -and -not $cors.ContainsKey('Access-Control-Allow-Origin')) {
        Escribir 'AVISO' "Origen rechazado: $($pet.cabeceras['origin'])"
        Responder $stream 403 'Forbidden' $cors @{ error = 'origen-no-autorizado' }
        continue
      }

      switch ("$($pet.metodo) $($pet.ruta)") {

        'GET /ping' {
          # `ok`, `dispositivo` y `version` son lo que consume el frontend y no
          # cambian. `motor`, `sdk` y `reader` se anaden: hoy nadie los lee, y
          # manana explican de un vistazo que hay debajo.
          $l = Buscar-Lector
          if ($l.hay) {
            Escribir 'OK' "  -> ok=true  $($l.nombre)"
            Responder $stream 200 'OK' $cors @{
              ok = $true; dispositivo = $l.nombre; version = '3.0'
              motor = $script:Motor.etiqueta; sdk = $true; reader = $true }
          } else {
            Escribir 'AVISO' '  -> ok=false (no veo ningun lector conectado)'
            Responder $stream 200 'OK' $cors @{
              ok = $false; error = 'sin-lector'; version = '3.0'
              motor = $script:Motor.etiqueta; sdk = $true; reader = $false }
          }
          break
        }

        'POST /capturar' {
          $l = Buscar-Lector

          # ── Una captura a la vez ──────────────────────────────────────────
          # El lector no se puede abrir dos veces, y el bucle de aceptacion es
          # de un solo hilo: sin esta bandera la segunda peticion no falla, se
          # QUEDA ESPERANDO hasta que el navegador se rinde por su cuenta y sin
          # explicacion. Mejor un 409 inmediato y honesto.
          #
          # El vencimiento existe porque un capturador muerto no ejecuta su
          # finally: sin el, un fallo raro dejaria el agente marcado como
          # ocupado para siempre.
          $limite = $SegundosCaptura + 15
          if ($script:Capturando -and ((Get-Date) - $script:CapturandoDesde).TotalSeconds -lt $limite) {
            Escribir 'AVISO' '  -> 409 CAPTURE_BUSY (ya hay una captura en curso)'
            Responder $stream 409 'Conflict' $cors @{
              error = 'Ya hay una captura en curso.'; code = 'CAPTURE_BUSY'; stage = 'capture' }
            break
          }

          Escribir 'INFO' "Captura solicitada (motor: $($script:Motor.etiqueta)). Pon el dedo en el lector..."
          $script:Capturando = $true
          $script:CapturandoDesde = Get-Date
          try {
            $r = switch ($script:Motor.tipo) {
              'native' { Capturar-ConScript $script:Motor.ruta $SegundosCaptura }
              'sdk'    { Capturar-ConScript $script:Motor.ruta $SegundosCaptura }
              default  { @{ base64 = (Capturar-Huella $rutaExe $SegundosCaptura); meta = $null } }
            }

            $b64  = $r.base64
            $meta = $r.meta
            Escribir 'OK' "Huella capturada ($([math]::Round($b64.Length / 1KB)) KB en base64)."

            # `imagenBase64` y `dispositivo` son el contrato con el frontend y
            # no cambian. El resto son anadidos que el front ya sabe ignorar
            # —salvo `calidad`, que ya estaba previsto y hasta ahora nunca se
            # rellenaba.
            $cuerpo = @{ imagenBase64 = $b64; dispositivo = $l.nombre; motor = $script:Motor.etiqueta }
            if ($meta) {
              if ($meta.dispositivo) { $cuerpo.dispositivo = $meta.dispositivo }
              if ($meta.width)   { $cuerpo.width   = [int]$meta.width }
              if ($meta.height)  { $cuerpo.height  = [int]$meta.height }
              if ($meta.dpi)     { $cuerpo.dpi     = [int]$meta.dpi }
              if ($null -ne $meta.quality) { $cuerpo.calidad = [int]$meta.quality }
            }
            Responder $stream 200 'OK' $cors $cuerpo
          } catch {
            $code  = if ($_.Exception.Data['code'])  { [string]$_.Exception.Data['code'] }  else { 'CAPTURE_ERROR' }
            $stage = if ($_.Exception.Data['stage']) { [string]$_.Exception.Data['stage'] } else { 'capture' }
            $http  = switch ($code) {
              'NO_READER'       { @(404, 'Not Found') }
              'CAPTURE_TIMEOUT'  { @(408, 'Request Timeout') }
              'CAPTURE_CANCELED' { @(499, 'Client Closed Request') }
              default           { @(500, 'Internal Server Error') }
            }
            Escribir 'ERR' "Fallo la captura [$code / $stage]: $($_.Exception.Message)"
            Responder $stream $http[0] $http[1] $cors @{
              error = [string]$_.Exception.Message; code = $code; stage = $stage }
          } finally {
            $script:Capturando = $false
          }
          break
        }

        default {
          Responder $stream 404 'Not Found' $cors @{ error = 'ruta-desconocida' }
        }
      }
    } catch {
      # Una peticion mal formada no puede tumbar el agente: la oficina se
      # quedaria sin lector sin que nadie se entere.
      #
      # Los navegadores abren varias conexiones para la misma peticion y
      # cancelan las que pierden la carrera. Al contestar por una ya cerrada
      # falla la escritura, y eso es NORMAL: pintarlo en rojo como si algo se
      # hubiera roto solo asusta a quien mira la ventana.
      $msg = $_.Exception.Message
      if ($msg -match 'anulado|aborted|forcibly closed|forzosamente') {
        Escribir 'INFO' '  (el navegador cerro una conexion sobrante; normal)'
      } else {
        Escribir 'ERR' "Peticion descartada: $msg"
      }
    } finally {
      # Cierre ORDENADO, no a lo bruto. Un `Close()` seco sobre el TcpClient
      # puede mandar un RST y el navegador tira la respuesta que ya estaba
      # escrita: se ve como "Failed to fetch" con el agente contestando bien.
      # Un cliente de PowerShell lo tolera; Chrome no. De ahí el linger y el
      # shutdown del lado de envio antes de soltar el socket.
      if ($stream) {
        try { $stream.Flush() } catch { }
        try { $cliente.Client.Shutdown([System.Net.Sockets.SocketShutdown]::Send) } catch { }
        try { $stream.Close() } catch { }
      }
      if ($cliente) { try { $cliente.Close() } catch { } }
    }
  }
} finally {
  $listener.Stop()
  Escribir 'INFO' 'Agente detenido.'
}
