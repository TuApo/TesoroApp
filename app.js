const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const log = require('electron-log');
const { initDatabase, closeDatabase } = require('./electron-db');
const { initEndpointAgent, isActive: endpointActivo, stop: detenerEndpointAgent } = require('./endpoint-agent');
const {
  isSafeExternalUrl,
  openExternalIfSafe,
  assertAllowedIpcSender,
} = require('./electron-security');

// autoUpdater se inicializa perezosamente: require('electron-updater')
// construye NsisUpdater al primer acceso y necesita que `app` ya esté vivo.
let _autoUpdater = null;
function getAutoUpdater() {
  if (!_autoUpdater) _autoUpdater = require('electron-updater').autoUpdater;
  return _autoUpdater;
}

const isDev = process.env.NODE_ENV === 'development';

// Suppress CSP/security warnings only while developing (evita ruido en DevTools).
if (isDev) {
  process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
}

// ─── Single instance lock (best practice Electron) ───────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}

let mainWindow = null;
// true desde before-quit: a partir de ahí cerrar la ventana la destruye en vez de esconderla.
let saliendo = false;

// Utilidad: enviar al renderer solo si la ventana sigue viva.
function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// Helpers de seguridad (URL externas + IPC sender) viven en
// ./electron-security.js para reutilizarlos desde electron-db.js.

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    icon: path.join(__dirname, 'public', 'logo.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  // Sin barra de menú nativa (evita atajos como ver código fuente).
  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:4400');
    mainWindow.webContents.openDevTools({ mode: 'right' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/tesoreria/browser/index.html'), { hash: '/' });
  }

  // ─── Hardening de navegación ───────────────────────────────────────────
  // Bloquear navegaciones fuera del origen local; las externas https abren en
  // el navegador del SO. http: y otros protocolos se silencian (sin abrir).
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const current = mainWindow.webContents.getURL();
    try {
      const currentOrigin = new URL(current).origin;
      const targetOrigin = new URL(targetUrl).origin;
      if (currentOrigin !== targetOrigin) {
        event.preventDefault();
        openExternalIfSafe(targetUrl);
      }
    } catch {
      event.preventDefault();
    }
  });

  // Todo window.open se deniega: las URLs https se delegan al navegador del
  // sistema; para blob:/data: (PDFs en memoria) el renderer debe usar
  // window.electron.pdf.openInWindow() en vez de window.open().
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });

  // Bloquear creación de webviews y forzar config segura si alguno aparece.
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    event.preventDefault();
  });

  // Ctrl+R / F5 en producción: loadFile no maneja el refresh nativo correctamente,
  // así que lo reemplazamos conservando la ruta hash actual.
  // F12 / Ctrl+Shift+I: abre DevTools embebidos en la misma ventana.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const key = (input.key || '').toLowerCase();
    const isHardReload =
      (input.control && input.shift && key === 'r') ||
      (input.control && key === 'f5');
    const isSoftReload =
      (input.control && key === 'r') ||
      key === 'f5';

    if (isHardReload || isSoftReload) {
      event.preventDefault();
      const wc = mainWindow.webContents;
      const doReload = () => {
        if (isDev) {
          if (isHardReload) wc.reloadIgnoringCache();
          else wc.reload();
        } else {
          const currentUrl = wc.getURL();
          const hashIndex = currentUrl.indexOf('#');
          const currentHash = hashIndex !== -1 ? currentUrl.substring(hashIndex + 1) : '/';
          mainWindow.loadFile(
            path.join(__dirname, 'dist/tesoreria/browser/index.html'),
            { hash: currentHash }
          );
        }
      };
      if (isHardReload) {
        wc.session.clearCache().catch(() => { /* noop */ }).finally(doReload);
      } else {
        doReload();
      }
      return;
    }

    const isToggleDevTools =
      input.key === 'F12' ||
      (input.control && input.shift && key === 'i');
    if (isToggleDevTools) {
      event.preventDefault();
      const wc = mainWindow.webContents;
      if (wc.isDevToolsOpened()) {
        wc.closeDevTools();
      } else {
        wc.openDevTools({ mode: 'right' });
      }
    }
  });

  // Con el agente activo, cerrar la ventana la esconde en la bandeja en vez de destruirla: Angular
  // sigue vivo y su ciclo de sincronización (offline-sync.service) sube la cola y descarga registros
  // aunque nadie la tenga abierta. Al salir de verdad (bandeja → Salir, actualización, apagado de
  // Windows) `saliendo` ya está en true y cierra normal.
  mainWindow.on('close', (event) => {
    let agente = false;
    try { agente = endpointActivo(); } catch { /* noop */ }
    if (!saliendo && agente) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  // Windows cerrando sesión o apagándose: no retener la ventana o el apagado se queda esperando.
  mainWindow.on('session-end', () => { saliendo = true; });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (!isDev) {
    // checkForUpdates (sin notify) para no disparar el toast nativo de Windows
    // cuando no hay release disponible. Los errores ya se silencian arriba.
    let resolved = false;
    const markResolved = () => { resolved = true; };
    // Si autoUpdater responde con cualquier evento, ya no hace falta el fallback.
    const au = getAutoUpdater();
    au.once('update-available', markResolved);
    au.once('update-not-available', markResolved);
    au.once('error', markResolved);

    getAutoUpdater().checkForUpdates().catch((err) => {
      console.error('[autoUpdater] checkForUpdates failed:', err && err.message ? err.message : err);
    });

    // Safety net: si el server de updates está caído o muy lento, el renderer
    // se quedaría bloqueado eternamente con "Verificando actualizaciones".
    // Tras 12s sin respuesta, mentimos diciendo "no hay update" para destrabar.
    setTimeout(() => {
      if (!resolved) {
        console.warn('[autoUpdater] timeout esperando respuesta, asumiendo sin update');
        sendToRenderer('update-not-available');
      }
    }, 12000);
  }
}

// ─── IPC ──────────────────────────────────────────────────────────────────
// Todos los ipcMain.handle validan event.senderFrame.url contra
// `isAllowedIpcSender` para rechazar invocaciones desde frames no autorizados
// (p.ej. iframe externo cargado dentro del renderer). En producción Electron
// el sender es siempre file://, en dev http://localhost:4200|4400|...
ipcMain.handle('version:get', (event) => {
  assertAllowedIpcSender(event);
  return require(path.resolve(__dirname, 'package.json')).version;
});

ipcMain.handle('env:get', (event) => {
  assertAllowedIpcSender(event);
  return process.env.NODE_ENV || 'production';
});

ipcMain.on('restart-app', () => {
  liberarRecursos();
  // Silencioso y relanzando la app al terminar: sin ventana del instalador ni avisos que esperen al usuario.
  getAutoUpdater().quitAndInstall(true, true);
});

// Capturas de huella en curso. Si la app se cerraba a mitad de una, el ejecutable del lector quedaba
// huérfano con resources\csharp en uso y el instalador no podía reemplazar la carpeta.
const procesosHuella = new Set();
function terminarProcesosHuella() {
  for (const p of procesosHuella) {
    try { p.kill(); } catch { /* ya terminó */ }
  }
  procesosHuella.clear();
}

ipcMain.handle('fingerprint:get', async (event) => {
  assertAllowedIpcSender(event);
  return new Promise((resolve, reject) => {
    const csharpAppPath = isDev
      ? path.join(__dirname, 'csharp', 'UareUSampleCSharp_CaptureOnly.exe')
      : path.join(process.resourcesPath, 'csharp', 'UareUSampleCSharp_CaptureOnly.exe');

    // Sin este check, el renderer queda colgado esperando la promesa si el
    // binario no fue empaquetado (p.ej. faltan DLLs del SDK U.are.U).
    if (!fs.existsSync(csharpAppPath)) {
      reject({ error: 'Lector de huella no instalado o ejecutable faltante.' });
      return;
    }

    const hijo = execFile(csharpAppPath, (error, stdout, stderr) => {
      procesosHuella.delete(hijo);
      if (error) {
        reject({ error: stderr || error.message });
        return;
      }
      const match = stdout.match(/DATA:\s*(.+)/);
      if (match) {
        resolve({ success: true, data: match[1].trim() });
      } else {
        reject({ error: 'No se recibió una imagen en Base64.' });
      }
    });
    procesosHuella.add(hijo);
  });
});

// ─── autoUpdater ──────────────────────────────────────────────────────────
// Se registran listeners sólo cuando app está listo (evita cargar electron-updater
// antes de tiempo, lo que rompería con Electron 34 + electron-updater 6).
function registerAutoUpdaterListeners() {
  const au = getAutoUpdater();
  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;
  // Solo warnings/errores del updater a disco. Archivo:
  //   %APPDATA%\Gestion Tesoreria\logs\main.log
  // Útil cuando un cliente reporte "no actualizó"; no hay spam en happy path.
  log.transports.file.level = 'warn';
  log.transports.console.level = false;
  au.logger = log;
  au.on('update-available', (info) => sendToRenderer('update-available', info));
  au.on('update-not-available', () => sendToRenderer('update-not-available'));
  au.on('download-progress', (progressObj) => sendToRenderer('update-progress', progressObj));
  au.on('update-downloaded', () => {
    sendToRenderer('update-downloaded');
    setTimeout(() => {
      liberarRecursos();
      // Silencioso + relanzar: el instalador no muestra ventanas que esperen al usuario
      // (en /S sus avisos toman la opción por defecto y siguen).
      try { au.quitAndInstall(true, true); } catch (e) { console.error('quitAndInstall:', e); }
    }, 3000);
  });
  au.on('error', (error) => {
    const msg = error ? (error.message || String(error)) : 'unknown';
    console.error('[autoUpdater]', msg);
    // Informa al renderer para que cierre el modal "Descargando" (que tiene
    // allowEscapeKey:false y dejaría al usuario trabado si no se avisa).
    sendToRenderer('update-error', msg);
  });
}

// ─── PDF editor externo ───────────────────────────────────────────────────
let currentEditingFile = null;
let fileWatcher = null;
let pdfDebounceTimer = null;

function cleanupPdfContext() {
  if (pdfDebounceTimer) {
    clearTimeout(pdfDebounceTimer);
    pdfDebounceTimer = null;
  }
  if (fileWatcher) {
    if (typeof fileWatcher.close === 'function') fileWatcher.close();
    else clearInterval(fileWatcher);
    fileWatcher = null;
  }
  if (currentEditingFile && fs.existsSync(currentEditingFile)) {
    try { fs.unlinkSync(currentEditingFile); } catch { /* noop */ }
  }
  currentEditingFile = null;
}

ipcMain.handle('pdf:edit-external', async (event, fileUrl) => {
  assertAllowedIpcSender(event);
  try {
    if (typeof fileUrl !== 'string' || !/^https?:\/\//i.test(fileUrl)) {
      return { success: false, error: 'URL inválida' };
    }
    cleanupPdfContext();

    const tmpDir = path.join(os.tmpdir(), 'tesoreria-pdf-edit');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, `edit_${Date.now()}.pdf`);

    await new Promise((resolve, reject) => {
      const client = fileUrl.startsWith('https') ? https : http;
      const req = client.get(fileUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectClient = response.headers.location.startsWith('https') ? https : http;
          redirectClient.get(response.headers.location, (res2) => {
            const fileStream = fs.createWriteStream(tmpFile);
            res2.pipe(fileStream);
            fileStream.on('finish', () => { fileStream.close(); resolve(); });
            fileStream.on('error', reject);
          }).on('error', reject);
          return;
        }
        const fileStream = fs.createWriteStream(tmpFile);
        response.pipe(fileStream);
        fileStream.on('finish', () => { fileStream.close(); resolve(); });
        fileStream.on('error', reject);
      });
      req.on('error', reject);
    });

    currentEditingFile = tmpFile;

    const initialSize = fs.statSync(tmpFile).size;
    const openErr = await shell.openPath(tmpFile);
    if (openErr) return { success: false, error: openErr };

    let lastSize = initialSize;
    fileWatcher = fs.watch(tmpFile, (eventType) => {
      if (eventType !== 'change') return;
      if (pdfDebounceTimer) clearTimeout(pdfDebounceTimer);
      pdfDebounceTimer = setTimeout(() => {
        try {
          if (!fs.existsSync(tmpFile)) return;
          const stats = fs.statSync(tmpFile);
          if (stats.size !== lastSize || stats.size > 0) {
            lastSize = stats.size;
            const modifiedBytes = fs.readFileSync(tmpFile);
            sendToRenderer('pdf:file-changed', {
              filePath: tmpFile,
              bytes: modifiedBytes.toString('base64'),
            });
          }
        } catch { /* archivo puede estar bloqueado por Acrobat */ }
      }, 800);
    });

    return { success: true, filePath: tmpFile };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('pdf:read-file', async (event) => {
  assertAllowedIpcSender(event);
  if (currentEditingFile && fs.existsSync(currentEditingFile)) {
    try {
      const bytes = fs.readFileSync(currentEditingFile);
      return { success: true, bytes: bytes.toString('base64') };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'No file being edited' };
});

ipcMain.handle('pdf:finish-edit', async (event) => {
  assertAllowedIpcSender(event);
  cleanupPdfContext();
  return { success: true };
});

// ─── Ventanas hijas: visor de PDF embebido ────────────────────────────────
// Reemplaza el patrón `window.open(blobURL)` en Angular. El renderer manda
// el PDF (base64), aquí se materializa en disco y se carga en una BrowserWindow
// con el visor nativo de Chromium. Al cerrar la ventana se borra el temporal.
const viewerTmpDir = path.join(os.tmpdir(), 'tesoreria-pdf-view');
const viewerWindows = new Set();

function sanitizeTitle(raw) {
  if (typeof raw !== 'string' || !raw.length) return 'Documento PDF';
  return raw.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 120);
}

ipcMain.handle('pdf:open-in-window', async (event, payload) => {
  assertAllowedIpcSender(event);
  try {
    const { base64, title, width, height } = payload || {};
    if (typeof base64 !== 'string' || !base64.length) {
      return { success: false, error: 'base64 vacío' };
    }
    const cleaned = base64.replace(/^data:application\/pdf;base64,/, '');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(cleaned)) {
      return { success: false, error: 'base64 inválido' };
    }
    // Cap de tamaño: ~67MB de base64 ≈ 50MB binario. Antes no había cap,
    // un renderer comprometido podía OOMear el main con un string multi-GB.
    if (cleaned.length > 67_000_000) {
      return { success: false, error: 'PDF demasiado grande para visor (>50MB)' };
    }

    if (!fs.existsSync(viewerTmpDir)) fs.mkdirSync(viewerTmpDir, { recursive: true });
    const tmpFile = path.join(viewerTmpDir, `view_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`);
    const buf = Buffer.from(cleaned, 'base64');
    // Validar magic bytes %PDF- antes de escribir/abrir.
    if (buf.length < 5 || !buf.slice(0, 5).equals(Buffer.from('%PDF-'))) {
      return { success: false, error: 'No parece un PDF válido' };
    }
    fs.writeFileSync(tmpFile, buf);

    const viewerWindow = new BrowserWindow({
      width: Number.isFinite(width) ? Math.min(Math.max(width, 400), 2400) : 1000,
      height: Number.isFinite(height) ? Math.min(Math.max(height, 300), 1600) : 800,
      title: sanitizeTitle(title),
      parent: mainWindow || undefined,
      icon: path.join(__dirname, 'public', 'logo.ico'),
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        plugins: true,
      },
    });
    viewerWindow.setMenu(null);

    viewerWindows.add(viewerWindow);
    viewerWindow.once('ready-to-show', () => viewerWindow.show());
    viewerWindow.on('closed', () => {
      viewerWindows.delete(viewerWindow);
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch { /* noop */ }
    });

    await viewerWindow.loadFile(tmpFile);
    return { success: true };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
});

// ─── Uploads offline (FormData persistido a disco) ────────────────────────
// El renderer no puede escribir directamente al filesystem. Estos handlers
// permiten guardar cada File del FormData como archivo binario antes de
// encolar la request en SQLite. Al hacer replay, el sync service los lee
// con offline:read-upload y reconstruye el FormData.
const offlineUploadsDir = () => path.resolve(app.getPath('userData'), 'offline-uploads');

// Caps de tamaño. El renderer ya valida 25MB por archivo (ver
// offline.interceptor.ts), pero defensa en profundidad: el main aplica
// 50MB por archivo y 1GB total. Un renderer comprometido no puede llenar el
// disco; el límite total evita OOM si el directorio crece sin control.
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

function isInsideUploadsDir(target) {
  const dir = offlineUploadsDir();
  const resolved = path.resolve(target);
  return resolved.startsWith(dir + path.sep);
}

function dirTotalBytes(dir) {
  let total = 0;
  try {
    if (!fs.existsSync(dir)) return 0;
    for (const entry of fs.readdirSync(dir)) {
      try {
        const st = fs.statSync(path.join(dir, entry));
        if (st.isFile()) total += st.size;
      } catch { /* noop */ }
    }
  } catch { /* noop */ }
  return total;
}

ipcMain.handle('offline:save-upload', async (event, payload) => {
  assertAllowedIpcSender(event);
  try {
    const { base64, fileName, mimeType } = payload || {};
    if (typeof base64 !== 'string' || !base64.length) {
      return { success: false, error: 'base64 vacío' };
    }
    const cleaned = base64.replace(/^data:[^;]+;base64,/, '');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(cleaned)) {
      return { success: false, error: 'base64 inválido' };
    }

    // Cap defensivo de tamaño antes de decodificar para no asignar memoria
    // gigante por error o por renderer comprometido.
    // base64 inflate ~ 1.33×, así que limitamos string a ~67MB → 50MB binario.
    if (cleaned.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 16) {
      return { success: false, error: `Archivo excede ${(MAX_FILE_BYTES/1024/1024).toFixed(0)}MB` };
    }

    const dir = offlineUploadsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const decoded = Buffer.from(cleaned, 'base64');
    if (decoded.length > MAX_FILE_BYTES) {
      return { success: false, error: `Archivo excede ${(MAX_FILE_BYTES/1024/1024).toFixed(0)}MB` };
    }

    // Tope total del directorio. Si excede, rechazar para no llenar el disco.
    // Soft-limit: hay TOCTOU entre statSync y writeFileSync, pero en el peor
    // caso solo nos pasamos del límite por unos cuantos MB.
    const currentTotal = dirTotalBytes(dir);
    if (currentTotal + decoded.length > MAX_TOTAL_BYTES) {
      return {
        success: false,
        error: `Espacio offline excedido. Sincroniza la cola pendiente o descarta envíos fallidos.`,
      };
    }

    // Solo conservamos la extensión del filename del usuario (el resto se
    // descarta para evitar path traversal o caracteres extraños).
    const rawExt = path.extname(typeof fileName === 'string' ? fileName : '');
    const ext = /^\.[A-Za-z0-9]{1,8}$/.test(rawExt) ? rawExt : '.bin';
    const safeId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const targetPath = path.join(dir, `${safeId}${ext}`);

    fs.writeFileSync(targetPath, decoded);
    return {
      success: true,
      storedPath: targetPath,
      size: decoded.length,
      mimeType: typeof mimeType === 'string' ? mimeType : null,
    };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('offline:read-upload', async (event, storedPath) => {
  assertAllowedIpcSender(event);
  try {
    if (typeof storedPath !== 'string' || !storedPath.length) {
      return { success: false, error: 'Path vacío' };
    }
    if (!isInsideUploadsDir(storedPath)) {
      return { success: false, error: 'Path fuera del directorio permitido' };
    }
    if (!fs.existsSync(storedPath)) {
      return { success: false, error: 'Archivo no encontrado' };
    }
    // Defensa: rechazar si el path resuelto es un symlink (no debería existir
    // dentro de offline-uploads/ pero un proceso del mismo usuario podría
    // haber plantado uno apuntando a System32 antes del read).
    const st = fs.lstatSync(storedPath);
    if (!st.isFile() || st.isSymbolicLink()) {
      return { success: false, error: 'Tipo de archivo no permitido' };
    }
    const bytes = fs.readFileSync(storedPath);
    return { success: true, base64: bytes.toString('base64') };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('offline:delete-upload', async (event, storedPath) => {
  assertAllowedIpcSender(event);
  try {
    if (typeof storedPath !== 'string') return { success: true };
    if (!isInsideUploadsDir(storedPath)) {
      return { success: false, error: 'Path fuera del directorio permitido' };
    }
    if (fs.existsSync(storedPath)) {
      const st = fs.lstatSync(storedPath);
      if (!st.isFile() || st.isSymbolicLink()) {
        return { success: false, error: 'Tipo de archivo no permitido' };
      }
      fs.unlinkSync(storedPath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('shell:open-external', async (event, url) => {
  assertAllowedIpcSender(event);
  if (!isSafeExternalUrl(url)) {
    return { success: false, error: 'URL inválida (solo https permitido)' };
  }
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
});

function cleanupViewerWindows() {
  for (const w of viewerWindows) {
    try { if (!w.isDestroyed()) w.close(); } catch { /* noop */ }
  }
  viewerWindows.clear();
  try {
    if (fs.existsSync(viewerTmpDir)) {
      for (const f of fs.readdirSync(viewerTmpDir)) {
        try { fs.unlinkSync(path.join(viewerTmpDir, f)); } catch { /* noop */ }
      }
    }
  } catch { /* noop */ }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────
// Trae la ventana al frente, o la recrea si se cerró y la app quedó viva en la bandeja (agente activo).
function mostrarVentana() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Abrir el acceso directo con la app en la bandeja cae aquí: sin recrear la ventana no pasaba nada.
app.on('second-instance', () => {
  mostrarVentana();
});

// Al arrancar limpiamos los directorios temporales de PDFs. Si la app se cerró
// limpio, estos dirs ya están vacíos; si se mató por OOM/crash/apagón, sus
// contenidos son basura de la sesión anterior y se pueden borrar sin riesgo.
function cleanupStaleTempDirs() {
  const tempDirs = [
    path.join(os.tmpdir(), 'tesoreria-pdf-edit'),
    path.join(os.tmpdir(), 'tesoreria-pdf-view'),
  ];
  for (const dir of tempDirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        try { fs.unlinkSync(path.join(dir, entry)); } catch { /* noop */ }
      }
    } catch { /* noop */ }
  }
}

app.whenReady().then(() => {
  cleanupStaleTempDirs();
  initDatabase();
  if (!isDev) registerAutoUpdaterListeners();
  // Agente de monitoreo de endpoints: vive en la bandeja aunque se cierre la ventana. No debe tumbar
  // la app si falla (su init ya atrapa todo), pero lo envolvemos por si acaso.
  try { initEndpointAgent({ app, ipcMain, logger: log, assertSender: assertAllowedIpcSender, abrirVentana: mostrarVentana }); } catch (e) { log.warn('endpoint-agent: ' + e.message); }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  cleanupPdfContext();
  cleanupViewerWindows();
  // Con el agente activo, la app sigue viva en la bandeja (monitoreo/soporte); si no, cierra como siempre.
  let agente = false;
  try { agente = endpointActivo(); } catch { /* noop */ }
  if (process.platform !== 'darwin' && !agente) app.quit();
});

// Suelta todo lo que puede dejar ficheros de la instalación en uso: se llama al salir y antes de que
// NSIS reemplace la app en una actualización. Si Acrobat tiene el PDF temporal abierto, el watcher lo
// mantiene bloqueado; un lector de huella a medias bloquea resources\csharp.
function liberarRecursos() {
  try { cleanupPdfContext(); } catch (e) { console.error('cleanupPdfContext:', e); }
  try { cleanupViewerWindows(); } catch (e) { console.error('cleanupViewerWindows:', e); }
  try { terminarProcesosHuella(); } catch (e) { console.error('terminarProcesosHuella:', e); }
  try { closeDatabase(); } catch (e) { console.error('closeDatabase:', e); }
}

app.on('before-quit', () => {
  saliendo = true;
  liberarRecursos();
});

// Sin app.exit(): app.quit() ya termina el proceso al cerrar las ventanas, y exit() se saltaría
// before-quit/will-quit, que es justo donde se libera todo esto.
app.on('will-quit', () => {
  try { detenerEndpointAgent(); } catch (e) { log.warn('endpoint-agent stop: ' + e.message); }
});

// Endurece TODOS los webContents creados (incluye ventanas hijas del visor).
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });
});
