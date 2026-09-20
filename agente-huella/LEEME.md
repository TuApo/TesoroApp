# Agente de huella — versión web

Pone el lector **U.are.U** del computador al alcance de
**https://tesoro.tuapo.co** abierto en el navegador. Sin la aplicación de
escritorio.

## Por qué hace falta

Ningún navegador puede hablar con el lector por sí solo:

- **WebAuthn** (la huella de Windows Hello) nunca devuelve la imagen — por
  diseño del sistema operativo. Sirve para identificarse, no para estampar la
  huella en un documento de contratación.
- **WebUSB / WebHID** no pueden reclamar el dispositivo: el driver de
  DigitalPersona ya lo tiene tomado, y el protocolo del lector es cerrado.

La única vía real es un puente en el propio equipo. Eso es este agente: escucha
en `127.0.0.1:52181` y la página web le pide la huella por HTTP.

## Instalación (una vez por computador)

1. Copia esta carpeta al equipo, por ejemplo en `C:\TuApo\agente-huella`.
2. Doble clic en **`instalar-agente.cmd`**.
3. Abre `https://tesoro.tuapo.co` → Contratación → **Cédula & Huella**.
4. La primera vez Chrome pregunta si autorizas el acceso a la red local: **sí**.

No pide contraseña de administrador, no instala drivers y no toca el registro.
Sólo deja un lanzador en la carpeta *Inicio* del usuario.

### ⚠️ Requisito previo: el software del lector

`UareUSampleCSharp_CaptureOnly.exe` es el programa de captura del **U.are.U SDK
for Windows**, y necesita la librería `DPUruNet.dll` más los binarios nativos
del SDK. **No viajan en este paquete.**

En los equipos donde la huella ya funciona el SDK está instalado y no hay que
hacer nada. En un equipo nuevo, si falta, la captura falla así:

```
System.IO.FileNotFoundException: No se puede cargar el archivo o ensamblado
'DPUruNet, Version=1.0.0.1, …'
```

Dos formas de resolverlo:

1. **Instalar el U.are.U SDK / runtime de DigitalPersona** en el equipo. Es la
   opción limpia.
2. **Copiar `DPUruNet.dll` y sus DLL nativas** desde un equipo que sí lo tenga,
   dejándolas **en esta misma carpeta**, junto al `.exe`.

El agente avisa al arrancar si no encuentra `DPUruNet.dll` a su lado.

## Uso diario

El agente arranca solo al iniciar sesión, minimizado. Cuando alguien pulsa
*Capturar Huella* en la web:

1. El agente lanza el ejecutable del SDK; se abre su ventana.
2. La persona pone el índice derecho.
3. La imagen vuelve al navegador y se guarda en gestión documental.

Si el agente no está corriendo, la pantalla lo dice y ofrece adjuntar la imagen.

## Comprobar que está bien

```
powershell -ExecutionPolicy Bypass -File huellero-agente.ps1 -Probar
```

Revisa el ejecutable, el lector conectado y el puerto, y responde en claro.

## Desinstalar

Doble clic en `desinstalar-agente.cmd`.

## Detalles de diseño (para quien lo mantenga)

- **Loopback a propósito.** Escuchar en la IP de la red expondría el lector de
  un equipo a toda la oficina.
- **Lista blanca de orígenes.** Sólo `tesoro.tuapo.co` (y localhost para
  desarrollo) pueden pedir una huella. Cualquier otra web abierta en el equipo
  recibe 403.
- **`TcpListener`, no `HttpListener`.** El segundo se apoya en `http.sys`, que
  exige `netsh http add urlacl` y por tanto administrador en cada equipo.
- **Sesión de usuario, no servicio de Windows.** El ejecutable del SDK es una
  app WinForms: en la sesión 0 de un servicio no podría pintar su ventana.
- **`Access-Control-Allow-Private-Network`.** Chrome descarta el preflight de
  una página pública hacia loopback si no ve esa cabecera.
- **Contenido mixto: no aplica.** Una página `https` puede llamar a
  `http://127.0.0.1` porque loopback cuenta como origen confiable.

## Probar el camino web sin lector

`dev/agente-mock.py` habla el mismo contrato y devuelve siempre una imagen de
prueba. No viaja en el paquete que se instala en las oficinas.

```
python3 dev/agente-mock.py
```

## Contrato

```
GET  /ping      → 200 { "ok": true, "dispositivo": "U.are.U 4500" }
                  200 { "ok": false, "error": "sin-lector" }
POST /capturar  → 200 { "imagenBase64": "…", "dispositivo": "…", "calidad": 82 }
                  404 { "error": "sin-lector" }
                  500 { "error": "<motivo legible>" }
```

Lo consume `EstrategiaAgenteLocal` en
`src/app/features/dashboard/submodule/hiring/service/huella/estrategias.ts`.
Cambiar el contrato obliga a tocar ese archivo.
