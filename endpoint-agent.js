'use strict';
/**
 * Agente de monitoreo de endpoints corporativos (proceso principal de Electron).
 *
 * Qué hace, de forma TRANSPARENTE (equipo propiedad de la empresa, Ley 1581): ícono visible en la
 * bandeja, un panel "¿Qué recoge este equipo?" que refleja la política vigente, y captura de
 * pantalla SOLO si la política la permite y con aviso. Reporta a ms-assets por el gateway:
 * latido (encendido/apagado), inventario, procesos, uso/eventos (si la política los habilita) y
 * recoge comandos por long-poll (el equipo nunca abre puertos entrantes).
 *
 * Sin dependencias nativas nuevas: usa os/crypto/child_process y las APIs de Electron. El token de
 * la máquina se cifra con safeStorage cuando está disponible.
 *
 * Captura de texto/portapapeles/documentos SOLO si la política cap_texto está activa (apagada por
 * defecto) y con aviso visible; el servidor enmascara credenciales antes de guardar. NO hace:
 * keylogging oculto, captura silenciosa, robo de credenciales ni anti-desinstalación.
 */
const { app, Tray, Menu, nativeImage, Notification, powerMonitor, safeStorage, desktopCapturer, screen, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');

const API_BASE = (process.env.ASSETS_AGENT_API || 'https://api.tuapo.co').replace(/\/+$/, '');
const RUTA = '/api/v1/assets/agente';
const VERSION = tryRequireVersion();

const MS_LATIDO = 60 * 1000;          // latido cada minuto
const MS_INVENTARIO = 6 * 60 * 60 * 1000; // inventario cada 6 h
const MS_PROCESOS = 30 * 60 * 1000;   // foto de procesos cada 30 min (el servidor la descarta si la política lo pide)
const MS_MUESTREO = 15 * 1000;        // muestreo de ventana activa cada 15 s (capa de uso)
const MS_FLUSH_USO = 2 * 60 * 1000;   // enviar los tramos de uso cada 2 min
const MS_TEXTO = 4 * 1000;            // sondeo del portapapeles cada 4 s (capa cap_texto)
const MS_FLUSH_FRAG = 2 * 60 * 1000;  // enviar los fragmentos cada 2 min

const RE_DOC = /[\w .()\-]+\.(docx?|xlsx?|pptx?|pdf|csv|txt|odt|ods)/i; // título que delata un documento

let segmento = null;                  // tramo de uso en curso {app, titulo, ini, ultimo}
let bufferUso = [];                   // tramos cerrados pendientes de enviar
let bufferFrag = [];                  // fragmentos (portapapeles/documento) pendientes de enviar
let ultimoClip = '';                  // último texto del portapapeles visto (para no repetir)
let ultimoDoc = '';                   // último documento reportado (para no repetir)

let tray = null;
let estado = { enrolado: false, endpointId: null, capas: null, ultimoError: null };
let token = null;
let timers = [];
let logger = { info() {}, warn() {}, error() {} };
let assertSender = () => {};
let abrirVentana = null;              // la pone app.js: muestra (o recrea) la ventana principal

function initEndpointAgent(opts = {}) {
  if (opts.logger) logger = opts.logger;
  if (typeof opts.assertSender === 'function') assertSender = opts.assertSender;
  if (typeof opts.abrirVentana === 'function') abrirVentana = opts.abrirVentana;
  try {
    cargarToken();
    autostart(true);
    construirBandeja();
    registrarEnergia();
    // Enrolamiento diferido: por env, por fichero que deja el instalador, o por IPC desde la app.
    const pin = process.env.ASSETS_AGENT_PIN || leerPinArchivo();
    if (!estado.enrolado && pin) enrolar(pin).catch(e => logger.warn('enrol fallo: ' + e.message));
    registrarIpc(opts.ipcMain);
    if (estado.enrolado) arrancarCiclos();
    logger.info('endpoint-agent iniciado (enrolado=' + estado.enrolado + ', api=' + API_BASE + ')');
  } catch (e) {
    logger.error('endpoint-agent no pudo iniciar: ' + (e && e.message));
  }
  return { isActive: () => estado.enrolado, stop };
}

function isActive() { return estado.enrolado; }

// ── Identidad de la máquina ───────────────────────────────────────────────

function machineUid() {
  const macs = [];
  const ifs = os.networkInterfaces();
  for (const nombre of Object.keys(ifs)) {
    for (const i of ifs[nombre] || []) {
      if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') macs.push(i.mac);
    }
  }
  macs.sort();
  const base = [os.hostname(), os.platform(), os.arch(), (os.cpus()[0] || {}).model, macs.join(',')].join('|');
  return crypto.createHash('sha256').update(base).digest('hex').slice(0, 40);
}

function infoMaquina() {
  const cpus = os.cpus() || [];
  // ms-assets usa DTOs record → Jackson sirve/espera camelCase (no cuaja snake_case). Igual que el
  // front de activos. Por eso todas las claves de payload van en camelCase.
  return {
    machineUid: machineUid(),
    hostname: os.hostname(),
    so: ({ win32: 'WINDOWS', darwin: 'MACOS', linux: 'LINUX' })[os.platform()] || os.platform(),
    soVersion: os.release(),
    arquitectura: os.arch(),
    cpu: (cpus[0] || {}).model || null,
    ramMb: Math.round(os.totalmem() / (1024 * 1024)),
    discoMb: null,
    agenteVersion: VERSION,
  };
}

// ── Enrolamiento y token ──────────────────────────────────────────────────

function rutaEstado() { return path.join(app.getPath('userData'), 'endpoint-agent.json'); }
function leerPinArchivo() {
  try {
    const p = path.join(app.getPath('userData'), 'endpoint-enrol.pin');
    if (fs.existsSync(p)) { const v = fs.readFileSync(p, 'utf8').trim(); return v || null; }
  } catch { /* noop */ }
  return null;
}

function cargarToken() {
  try {
    const raw = fs.readFileSync(rutaEstado(), 'utf8');
    const j = JSON.parse(raw);
    estado.endpointId = j.endpointId || null;
    if (j.token) {
      token = j.cifrado && safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(j.token, 'base64'))
        : j.token;
      estado.enrolado = !!token;
    }
  } catch { /* primera vez */ }
}

function guardarToken() {
  const cifrar = safeStorage.isEncryptionAvailable();
  const j = {
    endpointId: estado.endpointId,
    cifrado: cifrar,
    token: cifrar ? safeStorage.encryptString(token).toString('base64') : token,
  };
  try {
    fs.writeFileSync(rutaEstado(), JSON.stringify(j), { mode: 0o600 });
    try { fs.chmodSync(rutaEstado(), 0o600); } catch { /* win */ }
  } catch (e) { logger.warn('no se pudo guardar el token: ' + e.message); }
}

async function enrolar(pin) {
  const body = Object.assign({ pin: String(pin).trim().toUpperCase() }, infoMaquina());
  const r = await pedir('POST', RUTA + '/enrolar', body, false);
  token = r.agenteToken;
  estado.endpointId = r.endpointId;
  estado.enrolado = !!token;
  estado.capas = r.politica ? aCapas(r.politica) : null;
  guardarToken();
  // Borrar el pin de instalación si existía.
  try { fs.rmSync(path.join(app.getPath('userData'), 'endpoint-enrol.pin'), { force: true }); } catch { /* noop */ }
  actualizarBandeja();
  arrancarCiclos();
  notificar('Monitoreo TI activado', 'Este equipo quedó registrado para soporte y seguridad.');
  logger.info('enrolado endpoint ' + estado.endpointId);
  return r;
}

// ── Ciclos de reporte ─────────────────────────────────────────────────────

function arrancarCiclos() {
  stopTimers();
  latido();
  refrescarCapas();
  enviarInventario();
  timers.push(setInterval(latido, MS_LATIDO));
  timers.push(setInterval(enviarInventario, MS_INVENTARIO));
  timers.push(setInterval(enviarProcesos, MS_PROCESOS));
  timers.push(setInterval(muestrearUso, MS_MUESTREO));
  timers.push(setInterval(flushUso, MS_FLUSH_USO));
  timers.push(setInterval(muestrearTexto, MS_TEXTO));
  timers.push(setInterval(flushFragmentos, MS_FLUSH_FRAG));
}

async function latido() {
  if (!estado.enrolado) return;
  const carga = cargaCpu();
  try {
    const r = await pedir('POST', RUTA + '/latido', {
      cpuPct: carga, ramPct: Math.round((1 - os.freemem() / os.totalmem()) * 100),
      usuarioActivo: (os.userInfo().username || null), ipLan: ipLan(),
    });
    estado.ultimoError = null;
    if (r && r.politica) estado.capas = aCapas(r.politica);
    if (r && r.comandosPendientes > 0) await recogerComandos();
  } catch (e) {
    estado.ultimoError = e.message;
    if (/401|revocado|inválido|invalido/i.test(e.message)) { estado.enrolado = false; stopTimers(); actualizarBandeja(); }
  }
}

async function refrescarCapas() {
  try { estado.capas = aCapas(await pedir('GET', RUTA + '/capas')); actualizarBandeja(); } catch { /* noop */ }
}

async function enviarInventario() {
  if (!estado.enrolado) return;
  if (estado.capas && !estado.capas.inventario) return;
  const info = infoMaquina();
  await pedir('POST', RUTA + '/inventario', {
    hardware: { cpu: info.cpu, nucleos: (os.cpus() || []).length, ramMb: info.ramMb, hostname: info.hostname, so: info.so, soVersion: info.soVersion, arquitectura: info.arquitectura },
    software: [],
  }).catch(e => logger.warn('inventario: ' + e.message));
}

async function enviarProcesos() {
  if (!estado.enrolado) return;
  if (estado.capas && !estado.capas.procesos) return;
  try {
    const procesos = await listarProcesos();
    await pedir('POST', RUTA + '/procesos', { total: procesos.length, procesos });
  } catch (e) { logger.warn('procesos: ' + e.message); }
}

// ── Muestreo de la ventana activa → tramos de uso (capa "uso", para el mapa de proceso) ──

/** Devuelve {app, titulo} de la ventana en primer plano, best-effort por SO. */
function ventanaActiva() {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const mac = process.platform === 'darwin';
    let cmd, args;
    if (win) {
      cmd = 'powershell';
      args = ['-NoProfile', '-Command', PS_VENTANA];
    } else if (mac) {
      cmd = 'osascript';
      args = ['-e', 'tell application "System Events" to set n to name of first application process whose frontmost is true', '-e', 'return n'];
    } else {
      cmd = 'bash';
      args = ['-c', 'xdotool getactivewindow getwindowname 2>/dev/null; echo "|PID|"; ps -o comm= -p $(xdotool getactivewindow getwindowpid 2>/dev/null) 2>/dev/null'];
    }
    execFile(cmd, args, { timeout: 4000, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const s = stdout.trim();
      if (win) { const i = s.indexOf('|'); resolve({ app: (i >= 0 ? s.slice(0, i) : s).trim(), titulo: i >= 0 ? s.slice(i + 1).trim() : '' }); }
      else if (mac) resolve({ app: s, titulo: '' });
      else { const p = s.split('|PID|'); resolve({ app: (p[1] || '').trim(), titulo: (p[0] || '').trim() }); }
    });
  });
}

const PS_VENTANA = [
  '$sig = @"',
  '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);',
  '[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int p);',
  '"@',
  'Add-Type -Namespace W -Name U -MemberDefinition $sig',
  '$h=[W.U]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder 512',
  '[void][W.U]::GetWindowText($h,$sb,512); $p=0; [void][W.U]::GetWindowThreadProcessId($h,[ref]$p)',
  '$proc=(Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName',
  "Write-Output ($proc + '|' + $sb.ToString())",
].join('\n');

async function muestrearUso() {
  if (!estado.enrolado || (estado.capas && !estado.capas.uso)) return;
  const v = await ventanaActiva();
  if (!v || !v.app) return;
  const ahora = Date.now();
  if (segmento && segmento.app === v.app && segmento.titulo === v.titulo) {
    segmento.ultimo = ahora;
  } else {
    cerrarSegmento(ahora);
    segmento = { app: v.app, titulo: v.titulo, ini: ahora, ultimo: ahora };
  }
}

/** Cierra el tramo en curso y lo mete al buffer (con su duración en segundos). */
function cerrarSegmento(ahora = Date.now()) {
  if (!segmento) return;
  const seg = Math.round((Math.max(segmento.ultimo, segmento.ini) - segmento.ini) / 1000) + MS_MUESTREO / 1000;
  bufferUso.push({
    tsIni: isoLocal(new Date(segmento.ini)),
    tsFin: isoLocal(new Date(ahora)),
    app: segmento.app,
    tituloVentana: segmento.titulo || null,
    segundos: seg,
  });
  segmento = null;
  if (bufferUso.length > 200) bufferUso = bufferUso.slice(-200);
}

async function flushUso() {
  if (!estado.enrolado || (estado.capas && !estado.capas.uso)) { bufferUso = []; segmento = null; return; }
  cerrarSegmento();
  if (!bufferUso.length) return;
  const lote = bufferUso.splice(0, bufferUso.length);
  try { await pedir('POST', RUTA + '/uso', { items: lote }); }
  catch (e) { logger.warn('uso: ' + e.message); }
}

// ── Captura de texto/portapapeles/documentos → fragmentos (capa cap_texto, con aviso) ──

/** Sondea el portapapeles y el documento en primer plano; SOLO si la política cap_texto está activa.
 *  No es un keylogger: registra lo que se copia/pega y qué documento se trabaja, con su procedencia.
 *  El servidor enmascara credenciales antes de guardar. */
async function muestrearTexto() {
  if (!estado.enrolado || !estado.capas || !estado.capas.texto) return;
  // 1) Portapapeles (copia/pega). readText es síncrono y barato.
  let clip = '';
  try { clip = (clipboard.readText() || '').trim(); } catch { clip = ''; }
  if (clip && clip !== ultimoClip && clip.length >= 3 && clip.length <= 20000) {
    ultimoClip = clip;
    const v = await ventanaActiva();
    empujarFragmento('CLIP', clip, v);
  }
  // 2) Documento abierto: se deduce del título ya muestreado (sin coste extra de PowerShell).
  if (segmento && segmento.titulo && RE_DOC.test(segmento.titulo)) {
    const m = segmento.titulo.match(RE_DOC);
    const doc = (m ? m[0] : segmento.titulo).trim();
    if (doc && doc !== ultimoDoc) {
      ultimoDoc = doc;
      empujarFragmento('DOC', doc, { app: segmento.app, titulo: segmento.titulo });
    }
  }
}

function empujarFragmento(origen, contenido, v) {
  bufferFrag.push({
    ts: isoLocal(new Date()),
    origen,
    app: (v && v.app) || (segmento && segmento.app) || null,
    tituloVentana: (v && v.titulo) || null,
    contenido,
  });
  if (bufferFrag.length > 100) bufferFrag = bufferFrag.slice(-100);
}

async function flushFragmentos() {
  if (!estado.enrolado || !estado.capas || !estado.capas.texto) { bufferFrag = []; return; }
  if (!bufferFrag.length) return;
  const lote = bufferFrag.splice(0, bufferFrag.length);
  try { await pedir('POST', RUTA + '/fragmentos', { items: lote }); }
  catch (e) { logger.warn('fragmentos: ' + e.message); }
}

async function recogerComandos() {
  let cmds = [];
  try { cmds = await pedir('GET', RUTA + '/comandos'); } catch (e) { return; }
  for (const c of cmds || []) {
    let res = { estado: 'OK', resultado: {} };
    try { res.resultado = await ejecutar(c); }
    catch (e) { res = { estado: 'ERROR', resultado: { error: String(e && e.message) } }; }
    await pedir('POST', RUTA + '/comandos/' + c.id + '/resultado', res).catch(() => {});
  }
}

async function ejecutar(c) {
  switch (c.tipo) {
    case 'INVENTARIO': await enviarInventario(); return { ok: true };
    case 'PROCESOS': await enviarProcesos(); return { ok: true };
    case 'MENSAJE': notificar('Soporte TI', (c.params && c.params.texto) || 'Mensaje de soporte'); return { ok: true };
    case 'MATAR_PROCESO': {
      const pid = c.params && (c.params.pid || c.params.PID);
      if (!pid) throw new Error('falta pid');
      process.kill(Number(pid)); return { ok: true, pid };
    }
    case 'CAPTURA': {
      if (estado.capas && !estado.capas.captura) return { ok: false, motivo: 'política no permite captura' };
      const png = await capturarPantalla();
      notificar('Captura de pantalla', 'Soporte TI tomó una captura de este equipo.');
      const r = await subirCaptura(png, (c.params && c.params.motivo) || 'Comando de soporte');
      return { ok: !!(r && r.guardada), docRef: r && r.docRef };
    }
    case 'SOPORTE': {
      notificar('Soporte remoto', 'Soporte TI solicitó asistencia en este equipo.');
      return { ok: true, aviso: 'mostrado' };
    }
    default: return { ok: false, motivo: 'tipo no soportado: ' + c.tipo };
  }
}

// ── Recolectores dependientes del SO ────────────────────────────────────────

function listarProcesos() {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const cmd = win ? 'tasklist' : 'ps';
    const args = win ? ['/fo', 'csv', '/nh'] : ['-eo', 'comm,pid,pmem'];
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const out = [];
      for (const linea of stdout.split(/\r?\n/)) {
        if (!linea.trim()) continue;
        if (win) {
          const m = linea.match(/^"([^"]*)","([^"]*)"/);
          if (m) out.push({ name: m[1], pid: Number(m[2]) || null });
        } else {
          const p = linea.trim().split(/\s+/);
          if (p.length >= 2 && p[1] !== 'PID') out.push({ name: p[0], pid: Number(p[1]) || null, mem: Number(p[2]) || null });
        }
      }
      resolve(out.slice(0, 500));
    });
  });
}

async function capturarPantalla() {
  const tam = screen.getPrimaryDisplay().size;
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: tam.width, height: tam.height } });
  const s = sources[0];
  if (!s) throw new Error('sin pantalla');
  return s.thumbnail.toPNG();
}

// ── Energía / eventos del SO (capa con aviso legal) ──────────────────────────

function registrarEnergia() {
  const evento = (tipo) => () => {
    if (!estado.enrolado || (estado.capas && !estado.capas.eventos)) return;
    pedir('POST', RUTA + '/eventos', { items: [{ ts: isoLocal(new Date()), tipo, detalle: { usuario: os.userInfo().username } }] }).catch(() => {});
  };
  try {
    powerMonitor.on('lock-screen', evento('LOCK'));
    powerMonitor.on('unlock-screen', evento('UNLOCK'));
    powerMonitor.on('suspend', evento('SUSPEND'));
    powerMonitor.on('resume', evento('RESUME'));
    powerMonitor.on('shutdown', evento('SHUTDOWN'));
  } catch { /* powerMonitor solo tras ready */ }
}

// ── Bandeja (presencia visible) ──────────────────────────────────────────────

function construirBandeja() {
  try {
    const img = iconoBandeja();
    tray = new Tray(img);
    // En Windows el clic izquierdo no abre el menú: que abra la app, como en el resto de programas de la bandeja.
    tray.on('click', () => { if (abrirVentana) abrirVentana(); });
    actualizarBandeja();
  } catch (e) { logger.warn('no se pudo crear la bandeja: ' + e.message); }
}

function actualizarBandeja() {
  if (!tray) return;
  const c = estado.capas || {};
  const capasTxt = ['inventario', 'procesos', 'uso', 'eventos', 'captura', 'texto'].filter(k => c[k]).join(', ') || 'ninguna';
  const menu = Menu.buildFromTemplate([
    { label: estado.enrolado ? 'Monitoreo TI: activo' : 'Monitoreo TI: sin activar', enabled: false },
    { label: 'Equipo: ' + os.hostname(), enabled: false },
    { type: 'separator' },
    { label: 'Qué se recoge: ' + capasTxt, enabled: false },
    { label: 'Ver aviso de privacidad', click: mostrarAviso },
    { type: 'separator' },
    { label: 'Sincronizar ahora', enabled: estado.enrolado, click: () => { latido(); enviarInventario(); } },
    { type: 'separator' },
    { label: 'Abrir Gestión Tesorería', enabled: !!abrirVentana, click: () => { if (abrirVentana) abrirVentana(); } },
    { label: 'Salir de Gestión Tesorería', click: salir },
  ]);
  tray.setToolTip('Soporte TI · ' + (estado.enrolado ? 'activo' : 'sin activar'));
  tray.setContextMenu(menu);
}

// Con el agente enrolado, cerrar la ventana deja la app en la bandeja y esta es la única salida
// limpia. Se pide confirmación porque el monitoreo se pausa hasta que la app vuelva a abrirse (a mano
// o al iniciar sesión en Windows). app.quit() explícito: window-all-closed no cierra con el agente activo.
async function salir() {
  if (estado.enrolado) {
    let r = { response: 1 };
    try {
      r = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Salir', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        title: 'Gestión Tesorería',
        message: '¿Salir de Gestión Tesorería?',
        detail: 'El monitoreo TI de este equipo se pausará hasta que vuelvas a abrir la aplicación o inicies sesión de nuevo en Windows.',
      });
    } catch (e) { logger.warn('dialogo de salida: ' + e.message); r = { response: 0 }; }
    if (r.response !== 0) return;
  }
  app.quit();
}

function mostrarAviso() {
  const c = estado.capas || {};
  const txt = (c.consentimientoTxt || 'Equipo corporativo monitoreado para soporte y seguridad.') +
    '\n\nCapas activas: ' + (['inventario', 'procesos', 'uso', 'eventos', 'captura', 'texto'].filter(k => c[k]).join(', ') || 'ninguna');
  notificar('Aviso de privacidad', txt);
}

function iconoBandeja() {
  const ico = path.join(__dirname, 'public', 'logo.ico');
  if (fs.existsSync(ico)) { const i = nativeImage.createFromPath(ico); if (!i.isEmpty()) return i; }
  // Respaldo: un punto azul 16x16.
  return nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVR42mNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCgDd6wQJ3m2m0wAAAABJRU5ErkJggg==');
}

function notificar(titulo, cuerpo) {
  try { if (Notification.isSupported()) new Notification({ title: titulo, body: cuerpo }).show(); }
  catch { /* noop */ }
}

// ── IPC para que la app (Angular) dispare el enrolamiento ────────────────────

function registrarIpc(ipcMain) {
  if (!ipcMain) return;
  ipcMain.handle('endpoint:status', (e) => {
    assertSender(e);
    return { enrolado: estado.enrolado, endpointId: estado.endpointId, capas: estado.capas, api: API_BASE };
  });
  ipcMain.handle('endpoint:enrol', async (e, pin) => {
    assertSender(e);
    const r = await enrolar(pin);
    return { enrolado: true, endpointId: r.endpointId };
  });
}

// ── Autostart ────────────────────────────────────────────────────────────────

function autostart(activar) {
  try { app.setLoginItemSettings({ openAtLogin: !!activar, args: ['--oculto'] }); } catch { /* linux sin soporte */ }
}

// ── HTTP (dependency-free) ───────────────────────────────────────────────────

function pedir(metodo, ruta, cuerpo, conToken = true) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(API_BASE + ruta); } catch (e) { return reject(e); }
    const datos = cuerpo != null ? Buffer.from(JSON.stringify(cuerpo)) : null;
    const headers = { 'Accept': 'application/json' };
    if (datos) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = datos.length; }
    if (conToken && token) headers['X-Agente-Token'] = token;
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request(url, { method: metodo, headers, timeout: 120000 }, (res) => {
      const trozos = [];
      res.on('data', d => trozos.push(d));
      res.on('end', () => {
        const texto = Buffer.concat(trozos).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(texto ? JSON.parse(texto) : {}); } catch { resolve({}); }
        } else {
          reject(new Error('HTTP ' + res.statusCode + ' ' + texto.slice(0, 160)));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (datos) req.write(datos);
    req.end();
  });
}

function subirCaptura(png, motivo) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + RUTA + '/captura');
    const frontera = '----tuapo' + crypto.randomBytes(8).toString('hex');
    const pre = Buffer.from(
      `--${frontera}\r\nContent-Disposition: form-data; name="archivo"; filename="captura.png"\r\nContent-Type: image/png\r\n\r\n`);
    const med = Buffer.from(`\r\n--${frontera}\r\nContent-Disposition: form-data; name="motivo"\r\n\r\n${motivo || ''}\r\n--${frontera}--\r\n`);
    const cuerpo = Buffer.concat([pre, png, med]);
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request(url, {
      method: 'POST', timeout: 120000,
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + frontera, 'Content-Length': cuerpo.length, 'X-Agente-Token': token || '' },
    }, (res) => {
      const t = [];
      res.on('data', d => t.push(d));
      res.on('end', () => {
        const txt = Buffer.concat(t).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) { try { resolve(JSON.parse(txt)); } catch { resolve({}); } }
        else reject(new Error('HTTP ' + res.statusCode));
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(cuerpo);
    req.end();
  });
}

// ── Utilidades ───────────────────────────────────────────────────────────────

// Tolerante a las dos formas: PoliticaOut (cap_*) que llega en el latido, y CapasAgente (claves
// desnudas) que devuelve /capas. Así refrescarCapas no pone todo en falso por leer la clave que no es.
function aCapas(p) {
  const v = (a, b) => !!(p[a] !== undefined ? p[a] : p[b]);
  return {
    inventario: v('capInventario', 'inventario'), procesos: v('capProcesos', 'procesos'),
    uso: v('capUso', 'uso'), eventos: v('capEventos', 'eventos'), captura: v('capCaptura', 'captura'),
    texto: v('capTexto', 'texto'),
    consentimientoTxt: p.consentimientoTxt || p.consentimiento_txt || null,
  };
}

let _cargaPrev = null;
function cargaCpu() {
  const cpus = os.cpus() || [];
  let idle = 0, total = 0;
  for (const c of cpus) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; }
  if (_cargaPrev) {
    const di = idle - _cargaPrev.idle, dt = total - _cargaPrev.total;
    _cargaPrev = { idle, total };
    return dt > 0 ? Math.round((1 - di / dt) * 100) : 0;
  }
  _cargaPrev = { idle, total };
  return Math.round((os.loadavg()[0] / (cpus.length || 1)) * 100);
}

function ipLan() {
  const ifs = os.networkInterfaces();
  for (const n of Object.keys(ifs)) for (const i of ifs[n] || []) if (!i.internal && i.family === 'IPv4') return i.address;
  return null;
}

/** Fecha-hora LOCAL sin zona (YYYY-MM-DDThh:mm:ss): el backend la lee como LocalDateTime y la hora
 *  local es justo la que alimenta las "horas pico". `toISOString()` (UTC con 'Z') rompía el parseo. */
function isoLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function stopTimers() { timers.forEach(clearInterval); timers = []; }
function stop() { stopTimers(); if (tray) { tray.destroy(); tray = null; } }

function tryRequireVersion() {
  try { return require(path.resolve(__dirname, 'package.json')).version; } catch { return null; }
}

module.exports = { initEndpointAgent, isActive, stop };
