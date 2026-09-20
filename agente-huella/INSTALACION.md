# Huella digital desde la web — instalación por puesto

Procedimiento para dejar un computador capturando huellas desde
`https://tesoro.tuapo.co`, sin la aplicación de escritorio.

Verificado el 2026-09-06 contra un equipo real (Windows 11, U.are.U 4500).

---

## Antes de empezar

| Requisito | Comprobación |
|---|---|
| Windows 10 u 11 | — |
| Lector **U.are.U 4500** conectado por USB | Windows lo lista como `U.are.U® 4500 Fingerprint Reader` |
| Chrome o Edge | Cualquier versión actual |
| La carpeta `agente-huella` | El ZIP que entrega el equipo de desarrollo |

**No hace falta** ser administrador, ni instalar drivers aparte, ni tocar la
configuración de Chrome.

---

## Parte A · El software del lector (lo que más falla)

> **Driver y SDK no son lo mismo.** El driver hace que Windows *reconozca* el
> aparato; el SDK son las librerías que un programa necesita para *usarlo*. Un
> equipo puede detectar el lector perfectamente y aun así no poder capturar.
> Si te saltas esta parte, la captura falla con
> `FileNotFoundException: 'DPUruNet, Version=1.0.0.1'`.

Elige **una** de las dos vías.

### A1 · Copiar las librerías de un PC que ya funciona · recomendada

Más rápida y garantiza la misma versión que el resto de la flota.

**En un computador donde la huella YA funcione**, abre PowerShell y ejecuta:

```powershell
Get-ChildItem C:\ -Filter DPUruNet.dll -Recurse -ErrorAction SilentlyContinue |
  Select-Object -First 5 FullName
```

De la carpeta que devuelva, copia a una memoria USB o a una carpeta compartida:

- `DPUruNet.dll`
- todos los `dpfpdd*.dll`
- todos los `dpfj*.dll`

**En el computador nuevo**, pega esos archivos **dentro de la carpeta
`agente-huella`**, junto a `UareUSampleCSharp_CaptureOnly.exe`.

> El programa de captura es de **32 bits**: si el PC de origen tiene versiones
> de 32 y 64, copia las de 32 (`Program Files (x86)`).

### A2 · Instalar el U.are.U SDK for Windows

La vía limpia. El instalador lo distribuye **HID Global** (antes DigitalPersona
/ Crossmatch) y requiere cuenta de desarrollador; es el mismo que se usó en los
puestos de oficina, así que lo más probable es que ya lo tenga quien montó esos
equipos.

Instálalo con las opciones por defecto y reinicia si lo pide.

### Motores de captura (v15)

El agente elige uno al arrancar, en este orden:

| Orden | Motor | Requiere | Estado |
|---|---|---|---|
| 1 | **nativo `dpfpdd`** | `capturador-nativo.ps1` + `dpfpdd.dll` | El bueno |
| 2 | `DPUruNet` gestionado | `capturador.ps1` + `DPUruNet.dll` | Falla con `DP_FAILURE` en este hardware |
| 3 | ejecutable de ejemplo | `UareUSampleCSharp_CaptureOnly.exe` | Última red |

Lo dice al arrancar: `Motor de captura: NATIVO dpfpdd`.

**Marcha atrás inmediata:** renombrar `capturador-nativo.ps1` y reiniciar el
agente. Cae solo al motor anterior.

### Comprobar la Parte A

```powershell
powershell -ExecutionPolicy Bypass -File huellero-agente.ps1 -Probar
```

Tiene que decir `Librerias del SDK presentes.` Si dice que faltan, rastrea todo
el disco por si están en una carpeta suelta:

```powershell
powershell -ExecutionPolicy Bypass -File huellero-agente.ps1 -BuscarSdk
```

---

## Se instala UNA VEZ por equipo

`INSTALAR.cmd` es idempotente. Si el agente ya está puesto **y respondiendo**,
lo comprueba y sale sin tocar nada:

```
  [OK]    ya instalado el 2026-09-07 00:40 y funcionando (motor dpfpdd).
  No hay nada que hacer. Abre https://tesoro.tuapo.co y captura.
```

Si está instalado pero apagado, solo lo arranca. Si el paquete es más nuevo,
actualiza sin preguntar. Para rehacerlo todo a la fuerza:

```
INSTALAR.cmd /forzar
```

La marca vive en `instalado.json`, dentro de la carpeta de instalación.

Tres garantías de que no se duplica:

- **Marca de instalación** — el instalador no repite trabajo ya hecho.
- **Lanzador con comprobación** — al iniciar sesión solo arranca el agente si
  el puerto 52181 está libre.
- **Instancia única** — el agente toma un mutex con nombre; un segundo se
  cierra explicando por qué en vez de morir con un error de socket.

## Parte B · Instalar el agente

1. Copia la carpeta `agente-huella` a **`C:\TuApo\agente-huella`**.

   > No la dejes en `Descargas`: esa carpeta se limpia sola y el agente
   > desaparecería sin avisar.

2. Doble clic en **`instalar-agente.cmd`**.

Eso deja un lanzador en la carpeta *Inicio* del usuario —para que arranque solo
con la sesión— y levanta el agente en ese momento.

El agente busca por su cuenta las librerías del SDK en el equipo y se las copia
al lado si las encuentra, así que en muchos equipos la Parte A se resuelve sola.

---

## Parte C · Verificación

Los tres pasos, en orden. Si uno falla, no sigas: el problema está ahí.

### 1 · La ventana del agente

Al arrancar tiene que mostrar:

```
Agente de huella escuchando en http://127.0.0.1:52181
Lector: U.are.U® 4500 Fingerprint Reader
Librerias del SDK listas junto al ejecutable.
```

### 2 · El agente responde al navegador

Abre en ese mismo equipo:

```
http://127.0.0.1:52181/ping
```

Tiene que devolver:

```json
{ "ok": true, "dispositivo": "U.are.U® 4500 Fingerprint Reader" }
```

### 3 · La aplicación lo ve

Entra a `https://tesoro.tuapo.co` → **Contratación** → un candidato →
pestaña **Cédula & Huella**.

Bajo los botones debe leerse **«Lector por agente local»**. Si dice «Sin lector
detectado», pulsa *Reintentar detección*.

En la ventana del agente aparecerá:

```
GET /ping  <- https://tesoro.tuapo.co
  -> ok=true  U.are.U® 4500 Fingerprint Reader
```

El `<- https://tesoro.tuapo.co` es la clave: significa que la petición viene de
la página. Si pone `(sin origen)`, esa petición la hizo otra cosa.

### 4 · Captura de prueba

Pulsa **Capturar Huella**. La página muestra *«Pon el dedo en el lector»*, se
abre la ventana del programa de captura, apoyas el índice derecho y la imagen
aparece en la tarjeta y se guarda en gestión documental.

---

## Parte D · Uso diario

El agente arranca solo al iniciar sesión, minimizado. **Su ventana debe quedar
abierta**: si se cierra, la web deja de encontrar el lector.

Para quitarlo de un equipo: `desinstalar-agente.cmd`.

---

## Problemas frecuentes

| Lo que se ve | Qué pasa | Qué hacer |
|---|---|---|
| `FileNotFoundException: 'DPUruNet…'` | Faltan las librerías del SDK | Parte A |
| `{"ok":false,"error":"sin-lector"}` | El lector no está conectado | Revisar el cable USB |
| «Sin lector detectado — Failed to fetch» | La página no alcanza al agente | ¿Está abierta la ventana del agente? ¿Responde `/ping` en el navegador? |
| «El navegador bloqueó la conexión» | Falta autorizar el acceso a red local | Aceptar el aviso de Chrome |
| El agente no arranca | Política de ejecución de PowerShell | Lanzarlo con `-ExecutionPolicy Bypass` (el instalador ya lo hace) |
| `(el navegador cerro una conexion sobrante; normal)` | Nada. Es una conexión de más | Ignorar |

---

## Para replicar en varios equipos

Una vez resuelta la Parte A en el primero, arma **un solo paquete** con la
carpeta `agente-huella` **incluyendo ya las DLL del SDK** dentro. A partir de
ahí, cada equipo nuevo es:

1. Copiar la carpeta a `C:\TuApo\agente-huella`.
2. Doble clic en `instalar-agente.cmd`.
3. Verificar con la Parte C.

Dos minutos por puesto, sin administrador y sin instalar nada más.

> Manda esas DLL al equipo de desarrollo para que viajen dentro del ZIP
> oficial. Mientras no estén ahí, cada puesto nuevo repite la Parte A — que es
> exactamente el problema que arrastró la aplicación de escritorio: empaquetaba
> el ejecutable pero no sus dependencias.
