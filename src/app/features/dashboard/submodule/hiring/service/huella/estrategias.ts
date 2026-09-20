import {
  CapturaHuella, EstrategiaHuella, HuellaError, MotivoNoDisponible, OrigenHuella,
} from './huella.model';

/** Un data URL de PNG a partir del base64 crudo que devuelven los puentes. */
function aDataUrl(base64: string, mime = 'image/png'): string {
  const limpio = base64.trim().replace(/^data:[^;]+;base64,/, '');
  return `data:${mime};base64,${limpio}`;
}

const NO: (m: MotivoNoDisponible) => { disponible: false; motivo: MotivoNoDisponible } =
  (m) => ({ disponible: false, motivo: m });
const SI = { disponible: true as const };

// ───────────────────────────────────────────────────────────────────────────
// 1. Electron — lo que ya funciona en las oficinas
// ───────────────────────────────────────────────────────────────────────────

interface RespuestaElectron { success: boolean; data?: string; error?: string }

/**
 * Pide la huella al proceso principal, que ejecuta el binario del SDK U.are.U y
 * devuelve el PNG en base64.
 *
 * El handler de `fingerprint:get` rechaza con un OBJETO PLANO (`{ error }`), no
 * con un Error: si se deja caer en un catch normal, el motivo real —lector
 * desconectado, ejecutable ausente— se pierde y la oficina ve "Desconocido".
 * Aquí se desempaqueta a mano.
 */
export class EstrategiaElectron implements EstrategiaHuella {
  readonly origen: OrigenHuella = 'electron';
  readonly nombre = 'Lector de este equipo';
  readonly descripcion = 'Lector USB conectado al computador, por la aplicación de escritorio.';
  readonly requiereGesto = false;

  private get puente() {
    const w = typeof window !== 'undefined' ? (window as any) : null;
    return w?.electron?.fingerprint?.get as (() => Promise<RespuestaElectron>) | undefined;
  }

  async comprobar() {
    return this.puente ? SI : NO('plataforma');
  }

  async capturar(): Promise<CapturaHuella> {
    const get = this.puente;
    if (!get) throw new HuellaError('La aplicación de escritorio no expone el lector.', this.origen);

    let res: RespuestaElectron;
    try {
      res = await get();
    } catch (e: any) {
      // El reject del proceso principal llega como { error: '...' }.
      const detalle = e?.error ?? e?.message ?? 'No se pudo hablar con el lector.';
      throw new HuellaError(String(detalle), this.origen);
    }

    if (!res?.success || !res.data) {
      throw new HuellaError(res?.error || 'El lector no devolvió ninguna imagen.', this.origen);
    }
    return { dataUrl: aDataUrl(res.data), mime: 'image/png', origen: this.origen };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 2. Agente local — el mismo lector, desde cualquier navegador del equipo
// ───────────────────────────────────────────────────────────────────────────

/**
 * CONTRATO QUE DEBE CUMPLIR EL AGENTE (dos endpoints, nada más):
 *
 *   GET  /ping      → 200 { "ok": true, "dispositivo": "U.are.U 4500" }
 *   POST /capturar  → 200 { "imagenBase64": "...", "calidad": 78 }
 *                     404 { "error": "sin-lector" }  si no hay lector conectado
 *
 * Sirve tanto para envolver el `UareUSampleCSharp_CaptureOnly.exe` que ya
 * existe como para poner delante el Lite Client de DigitalPersona.
 *
 * DOS TRAMPAS DEL NAVEGADOR, las dos contempladas abajo:
 *
 *  · Chrome está activando el permiso de acceso a red local: una página pública
 *    que llama a `localhost` pasa a pedir permiso en lugar de conectarse en
 *    silencio. Por eso las peticiones van marcadas con `targetAddressSpace`, y
 *    un rechazo se traduce a `sin-permiso` y no a "no hay agente".
 *  · El sondeo lleva timeout propio: sin él, un agente colgado deja la pantalla
 *    de contratación esperando sin decir nada.
 *
 * Y una tercera que no se puede resolver desde aquí: el agente TIENE que
 * responder CORS. La página se sirve desde https://tesoro.tuapo.co y el agente
 * desde 127.0.0.1, que son orígenes distintos, así que ambos endpoints deben
 * mandar `Access-Control-Allow-Origin: https://tesoro.tuapo.co` y contestar el
 * preflight OPTIONS de /capturar. Sin eso el navegador bloquea la respuesta y
 * el sondeo lo ve igual que un agente apagado.
 */
export class EstrategiaAgenteLocal implements EstrategiaHuella {
  readonly origen: OrigenHuella = 'agente-local';
  readonly nombre = 'Lector por agente local';
  readonly descripcion = 'Lector USB del computador, a través del agente instalado en él.';
  readonly requiereGesto = false;

  /** Recordado entre llamadas: evita re-sondear en cada pintado del selector. */
  private dispositivo?: string;

  /**
   * Último fallo, en texto, para que la pantalla pueda enseñarlo. Sin esto la
   * persona ve "Sin lector detectado" para tres causas muy distintas —agente
   * apagado, navegador bloqueando la red local, lector desconectado— y no hay
   * forma de saber cuál sin abrir las herramientas del navegador.
   */
  detalleFallo?: string;

  constructor(
    private readonly base: string,
    // 4 s, no 1,5: la primera consulta de dispositivos del agente carga su
    // módulo y tarda segundos. Con el margen corto, un agente perfectamente
    // sano se veía como "no hay agente" y la pantalla mandaba a adjuntar.
    private readonly msSondeo = 4000,
    private readonly msCaptura = 30000,
  ) {}

  /**
   * DECLARAR EL ESPACIO DE DIRECCIONES EQUIVOCADO ROMPE LA PETICIÓN
   *
   * Chrome cambió el vocabulario a mitad de camino. En la especificación vieja
   * (Private Network Access) `127.0.0.1` pertenecía al espacio **`local`**. En
   * la nueva (Local Network Access) `local` pasó a significar la RED local
   * —las direcciones privadas de la oficina— y el loopback se llama
   * **`loopback`**.
   *
   * Eso no es un detalle de nombres: si la página declara un espacio que no
   * coincide con el del destino, el navegador **rechaza la petición sin
   * llegar a enviarla**. Desde la pantalla se ve exactamente igual que si el
   * agente no existiera —"Sin lector detectado"—, y en la ventana del agente
   * no aparece absolutamente nada, porque nunca salió del navegador. Fue justo
   * lo que pasó: el agente respondía a `curl` y al diagnóstico, y a la página
   * no le llegaba nada.
   *
   * Por eso ya no se declara nada en el primer intento —que es lo que funciona
   * en la mayoría de versiones— y solo si ese falla se reintenta con el opt-in
   * moderno. Un navegador que no conozca la opción la ignora, así que el
   * reintento nunca empeora las cosas.
   */
  private async pedir(ruta: string, init: RequestInit, ms: number): Promise<Response> {
    const variantes: RequestInit[] = [
      {},
      { targetAddressSpace: 'loopback' } as RequestInit,
    ];

    let ultimo: unknown;
    for (const variante of variantes) {
      const corte = new AbortController();
      const reloj = setTimeout(() => corte.abort(), ms);
      try {
        return await fetch(`${this.base}${ruta}`, {
          ...init,
          ...variante,
          signal: corte.signal,
        });
      } catch (e) {
        ultimo = e;
        // Si fue el reloj, reintentar con otra variante no ayuda: el agente
        // está colgado, no bloqueado.
        if (corte.signal.aborted) break;
      } finally {
        clearTimeout(reloj);
      }
    }

    const e = ultimo as any;
    this.detalleFallo = `${e?.name ?? 'Error'}: ${e?.message ?? String(ultimo)}`;
    console.warn('[huella] el agente local no respondió:', ultimo);
    throw ultimo;
  }

  /** Un fallo de red aquí puede ser "no hay agente" o "me negaste el permiso". */
  private motivoDeFallo(e: any): MotivoNoDisponible {
    const t = String(e?.name ?? '') + String(e?.message ?? '');
    return /NotAllowed|permission|Permission/.test(t) ? 'sin-permiso' : 'sin-agente';
  }

  /**
   * `TypeError: Failed to fetch` NO distingue entre las dos únicas causas que
   * quedan, y son opuestas:
   *
   *   a) el navegador ni siquiera dejó salir la petición (bloqueo de acceso a
   *      la red local) — hay que autorizar en Chrome, el agente está bien;
   *   b) la petición salió y volvió, pero el navegador descartó la respuesta
   *      por las cabeceras CORS — hay que arreglar el agente.
   *
   * Se separan con un tiro en `mode: 'no-cors'`: esa petición NO pasa por la
   * comprobación de CORS, así que si sale, el camino de red está abierto y el
   * problema son las cabeceras. Si tampoco sale, es el navegador cortando.
   *
   * La respuesta es opaca —no se puede leer nada de ella— y eso está bien:
   * aquí no interesa el contenido, solo si el paquete llegó a viajar.
   */
  private async porQueFallo(): Promise<MotivoNoDisponible> {
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), 2500);
    try {
      await fetch(`${this.base}/ping`, { mode: 'no-cors', signal: corte.signal });
      this.detalleFallo = 'El agente responde, pero el navegador descartó la respuesta '
        + '(cabeceras CORS). Es un fallo del agente, no del equipo.';
      return 'sin-agente';
    } catch {
      // Cuidado con afirmar de más: que un tiro sin CORS tampoco salga puede
      // ser el navegador bloqueando, pero también un agente ocupado que no
      // contesta a tiempo. Decir solo lo primero manda a tocar permisos de
      // Chrome cuando el problema estaba en el agente. Se nombran las dos.
      this.detalleFallo = 'No hubo respuesta de 127.0.0.1:52181. O el navegador bloqueó '
        + 'el acceso a la red local, o el agente no contestó a tiempo. '
        + 'Comprueba la ventana del agente.';
      return 'sin-permiso';
    } finally {
      clearTimeout(reloj);
    }
  }

  async comprobar() {
    try {
      const r = await this.pedir('/ping', { method: 'GET' }, this.msSondeo);
      this.detalleFallo = undefined;
      if (!r.ok) { this.detalleFallo = `El agente respondió ${r.status}.`; return NO('sin-agente'); }
      const cuerpo = await r.json().catch(() => null);
      if (!cuerpo?.ok) return NO('sin-lector');
      this.dispositivo = cuerpo.dispositivo;
      return SI;
    } catch (e) {
      const directo = this.motivoDeFallo(e);
      if (directo === 'sin-permiso') return NO(directo);
      // "Failed to fetch" no dice nada por sí solo: hay que preguntar mejor.
      return NO(await this.porQueFallo());
    }
  }

  async capturar(): Promise<CapturaHuella> {
    let r: Response;
    try {
      r = await this.pedir('/capturar', { method: 'POST' }, this.msCaptura);
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw new HuellaError('El lector no respondió a tiempo. Revisa que esté conectado.', this.origen);
      }
      const motivo = this.motivoDeFallo(e);
      throw new HuellaError(
        motivo === 'sin-permiso'
          ? 'El navegador bloqueó la conexión con el agente. Autoriza el acceso a la red local y reintenta.'
          : 'No se pudo hablar con el agente del lector. Comprueba que esté en ejecución.',
        this.origen,
      );
    }

    const cuerpo = await r.json().catch(() => null);
    if (!r.ok || !cuerpo?.imagenBase64) {
      const err = cuerpo?.error === 'sin-lector'
        ? 'El agente no encuentra ningún lector conectado.'
        : (cuerpo?.error || 'El agente no devolvió ninguna imagen.');
      throw new HuellaError(String(err), this.origen);
    }

    return {
      dataUrl: aDataUrl(cuerpo.imagenBase64),
      mime: 'image/png',
      origen: this.origen,
      dispositivo: cuerpo.dispositivo ?? this.dispositivo,
      calidad: typeof cuerpo.calidad === 'number' ? cuerpo.calidad : undefined,
      ancho: typeof cuerpo.width === 'number' ? cuerpo.width : undefined,
      alto: typeof cuerpo.height === 'number' ? cuerpo.height : undefined,
      dpi: typeof cuerpo.dpi === 'number' ? cuerpo.dpi : undefined,
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Nativo Android — lector por OTG dentro del APK
// ───────────────────────────────────────────────────────────────────────────

/**
 * CONTRATO DEL PLUGIN CAPACITOR (`HuellaLector`), aún por construir:
 *
 *   disponible() → { disponible: boolean, dispositivo?: string }
 *   capturar()   → { imagenBase64: string, calidad?: number }
 *
 * Mientras el plugin no esté registrado en el APK, `comprobar()` devuelve
 * `sin-plugin` y el servicio pasa a la siguiente estrategia. Nada se rompe por
 * que aún no exista.
 *
 * OJO AL HARDWARE: el U.are.U 4500 que hay hoy en las oficinas NO está cubierto
 * por el SDK Android del fabricante (sí lo están la 5160 y la 5100). Esta
 * estrategia queda lista, pero para móvil hace falta un lector compatible.
 */
export class EstrategiaNativaAndroid implements EstrategiaHuella {
  readonly origen: OrigenHuella = 'nativo-android';
  readonly nombre = 'Lector conectado al celular';
  readonly descripcion = 'Lector USB por cable OTG, leído por la aplicación Android.';
  readonly requiereGesto = false;

  private get plugin() {
    const cap = typeof window !== 'undefined' ? (window as any).Capacitor : null;
    if (!cap?.isNativePlatform?.()) return null;
    if (cap.isPluginAvailable && !cap.isPluginAvailable('HuellaLector')) return null;
    return cap.Plugins?.HuellaLector ?? null;
  }

  async comprobar() {
    const p = this.plugin;
    if (!p?.capturar) return NO('sin-plugin');
    try {
      const r = await p.disponible?.();
      // Un plugin sin `disponible()` se asume presente: que falle al capturar.
      return r && r.disponible === false ? NO('sin-lector') : SI;
    } catch {
      return NO('sin-lector');
    }
  }

  async capturar(): Promise<CapturaHuella> {
    const p = this.plugin;
    if (!p?.capturar) {
      throw new HuellaError('Esta versión de la aplicación no trae soporte para el lector.', this.origen);
    }
    let r: any;
    try {
      r = await p.capturar();
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (/cancel/i.test(msg)) throw new HuellaError('Captura cancelada.', this.origen, true);
      if (/permission|permiso/i.test(msg)) {
        throw new HuellaError('Falta el permiso para usar el lector USB.', this.origen);
      }
      throw new HuellaError(msg || 'El lector no respondió.', this.origen);
    }
    if (!r?.imagenBase64) throw new HuellaError('El lector no devolvió ninguna imagen.', this.origen);
    return {
      dataUrl: aDataUrl(r.imagenBase64),
      mime: 'image/png',
      origen: this.origen,
      dispositivo: r.dispositivo,
      calidad: typeof r.calidad === 'number' ? r.calidad : undefined,
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 4. Archivo — la salida de emergencia que funciona en todas partes
// ───────────────────────────────────────────────────────────────────────────

/**
 * La persona adjunta la imagen de la huella (escaneada o fotografiada). No
 * necesita lector, navegador concreto ni nada instalado, y el servidor ya la
 * acepta igual que cualquier otra: el endpoint de biometría recibe un PNG y no
 * pregunta de dónde salió.
 *
 * Es DELIBERADAMENTE la última opción y se marca en la trazabilidad como
 * `archivo`, para que se pueda auditar cuándo se usó la excepción.
 */
export class EstrategiaArchivo implements EstrategiaHuella {
  readonly origen: OrigenHuella = 'archivo';
  readonly nombre = 'Adjuntar imagen';
  readonly descripcion = 'Subir una imagen de la huella cuando no hay lector disponible.';
  readonly requiereGesto = true;

  /** 8 MB: una foto de celular cabe de sobra y un PDF disfrazado no. */
  private static readonly MAX_BYTES = 8 * 1024 * 1024;

  async comprobar() {
    return typeof document !== 'undefined' ? SI : NO('plataforma');
  }

  async capturar(): Promise<CapturaHuella> {
    const archivo = await this.pedirArchivo();
    if (!archivo) throw new HuellaError('Captura cancelada.', this.origen, true);

    if (!archivo.type.startsWith('image/')) {
      throw new HuellaError('El archivo debe ser una imagen (PNG o JPG).', this.origen);
    }
    if (archivo.size > EstrategiaArchivo.MAX_BYTES) {
      throw new HuellaError('La imagen pesa más de 8 MB. Usa una más liviana.', this.origen);
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const lector = new FileReader();
      lector.onerror = () => reject(new HuellaError('No se pudo leer la imagen.', this.origen));
      lector.onload = () => resolve(String(lector.result));
      lector.readAsDataURL(archivo);
    });

    return { dataUrl, mime: archivo.type, origen: this.origen };
  }

  /**
   * `null` si la persona cerró el diálogo. `oncancel` no existe en todos los
   * navegadores, así que también se vigila el regreso del foco a la ventana:
   * sin ese respaldo la promesa se quedaría pendiente para siempre y el botón
   * de capturar nunca volvería a habilitarse.
   */
  private pedirArchivo(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg';
      input.style.display = 'none';
      document.body.appendChild(input);

      let resuelto = false;
      const terminar = (f: File | null) => {
        if (resuelto) return;
        resuelto = true;
        window.removeEventListener('focus', alVolver);
        input.remove();
        resolve(f);
      };
      const alVolver = () => setTimeout(() => terminar(input.files?.[0] ?? null), 400);

      input.addEventListener('change', () => terminar(input.files?.[0] ?? null));
      input.addEventListener('cancel', () => terminar(null));
      window.addEventListener('focus', alVolver, { once: true });
      input.click();
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 5. Cámara — RETIRADA DE LA INTERFAZ (2026-09-06)
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ NO ESTÁ REGISTRADA en `HuellaCapturaService`, a petición expresa del
 * usuario: no quiere ver la opción de tomar la huella con la cámara. No es un
 * olvido — no la vuelvas a añadir al arreglo de estrategias sin preguntar.
 * Al no estar importada, el empaquetado la descarta y no pesa en el bundle.
 *
 * POR QUÉ EXISTE, POR SI VUELVE A HACER FALTA
 *
 * En un celular no hay lector USB que valga: el 4500 de las oficinas no está
 * cubierto por el SDK Android del fabricante, WebUSB no puede reclamar el
 * dispositivo (y el borde manda `usb=()` en Permissions-Policy), y la huella
 * del propio teléfono —WebAuthn— NUNCA devuelve una imagen: entrega una firma
 * criptográfica, por diseño del sistema operativo. Para estampar el índice
 * derecho en un documento hace falta una imagen, y en un celular la única
 * fuente de imágenes sin instalar nada es la cámara.
 *
 * QUÉ HACE
 *
 * Abre un visor a pantalla completa con una guía donde poner el dedo, recorta
 * exactamente esa guía y realza el resultado hasta dejar las crestas en negro
 * sobre blanco —que es como se lee una huella entintada en un papel—. La
 * persona ve el resultado ANTES de aceptarlo, porque una foto de un dedo mal
 * enfocada no se distingue de una buena hasta que se mira.
 *
 * Si `getUserMedia` no está o lo deniegan, se cae al selector nativo con
 * `capture`, que abre la aplicación de cámara del teléfono. Ese camino funciona
 * incluso en Safari de iOS, donde el visor propio es más frágil.
 *
 * HONESTIDAD SOBRE LO QUE ESTO ES
 *
 * Una foto NO es una captura biométrica: no la valida ningún lector, no tiene
 * calidad medible y no sirve para cotejar contra AFIS. Sirve para documentar,
 * que es justo lo que hace la plataforma con ella —estamparla en la entrega de
 * documentos—. Por eso queda marcada como origen `camara` en la trazabilidad,
 * distinta de la huella de un lector, y auditable.
 */
export class EstrategiaCamara implements EstrategiaHuella {
  readonly origen: OrigenHuella = 'camara';
  readonly nombre = 'Cámara del dispositivo';
  readonly descripcion = 'Fotografiar la huella con la cámara. No necesita lector ni instalar nada.';
  readonly requiereGesto = true;

  /** Fracción del cuadro que ocupa la guía. Un dedo, no una mano. */
  private static readonly GUIA_ANCHO = 0.46;
  private static readonly GUIA_ALTO  = 0.58;
  /** Lado mayor de la imagen final. Suficiente para imprimir, ligero para subir. */
  private static readonly LADO_MAX = 900;

  async comprobar() {
    if (typeof document === 'undefined') return NO('plataforma');
    // Aunque no haya getUserMedia queda el input con `capture`, que abre la
    // cámara del teléfono igual. Solo se descarta si no hay ni eso.
    return SI;
  }

  async capturar(): Promise<CapturaHuella> {
    const puedeVisor = typeof navigator !== 'undefined'
      && !!navigator.mediaDevices?.getUserMedia
      && (window.isSecureContext ?? true);

    if (puedeVisor) {
      try {
        return await this.conVisor();
      } catch (e) {
        // Si la persona canceló, se respeta: no se le abre otra cosa detrás.
        if (e instanceof HuellaError) throw e;
        // Permiso denegado o cámara ocupada: el selector nativo es otro camino
        // y muchas veces sí funciona.
      }
    }
    return this.conSelectorNativo();
  }

  // ── Visor propio ─────────────────────────────────────────────────────────

  private async conVisor(): Promise<CapturaHuella> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },   // trasera: la buena del teléfono
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
    } catch (e: any) {
      const n = String(e?.name ?? '');
      if (/NotAllowed|Security/.test(n)) throw new Error('permiso-camara');
      if (/NotFound|Overconstrained/.test(n)) throw new HuellaError('Este dispositivo no tiene cámara.', this.origen);
      throw new Error('camara-no-disponible');
    }

    const capa = this.construirVisor();
    document.body.appendChild(capa.raiz);
    capa.video.srcObject = stream;

    const pista = stream.getVideoTracks()[0];
    this.prepararLinterna(capa, pista);

    try {
      await capa.video.play().catch(() => { });

      // Bucle: disparar → previsualizar → repetir o aceptar.
      while (true) {
        const disparo = await capa.esperarDisparo();
        if (!disparo) throw new HuellaError('Captura cancelada.', this.origen, true);

        const recorte = this.recortarGuia(capa.video);
        const original = this.aDataUrl(recorte);
        const realzada = this.aDataUrl(this.realzar(recorte));

        const decision = await capa.previsualizar(realzada, original);
        if (decision === 'cancelar') throw new HuellaError('Captura cancelada.', this.origen, true);
        if (decision === 'repetir') continue;

        return { dataUrl: decision, mime: 'image/png', origen: this.origen, dispositivo: 'Cámara' };
      }
    } finally {
      try { pista.stop(); } catch { }
      stream.getTracks().forEach((t) => { try { t.stop(); } catch { } });
      capa.raiz.remove();
    }
  }

  /** Linterna: en un dedo a 10 cm cambia por completo el contraste de las crestas. */
  private prepararLinterna(capa: Visor, pista: MediaStreamTrack): void {
    const caps: any = pista.getCapabilities ? pista.getCapabilities() : null;
    if (!caps?.torch) { capa.btnLuz.style.display = 'none'; return; }
    let encendida = false;
    capa.btnLuz.onclick = async () => {
      encendida = !encendida;
      try {
        await pista.applyConstraints({ advanced: [{ torch: encendida } as any] });
        capa.btnLuz.textContent = encendida ? 'Luz: encendida' : 'Luz: apagada';
      } catch {
        capa.btnLuz.style.display = 'none';   // el dispositivo mintió
      }
    };
  }

  // ── Selector nativo (respaldo, y el camino de iOS) ────────────────────────

  private conSelectorNativo(): Promise<CapturaHuella> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      // Le pide al teléfono la cámara trasera directamente, sin pasar por la
      // galería. En escritorio el atributo se ignora y abre el selector normal.
      input.setAttribute('capture', 'environment');
      input.style.display = 'none';
      document.body.appendChild(input);

      let resuelto = false;
      const terminar = async (f: File | null) => {
        if (resuelto) return;
        resuelto = true;
        window.removeEventListener('focus', alVolver);
        input.remove();
        if (!f) return reject(new HuellaError('Captura cancelada.', this.origen, true));
        try {
          const lector = new FileReader();
          const dataUrl = await new Promise<string>((res, rej) => {
            lector.onerror = () => rej(new Error('lectura'));
            lector.onload = () => res(String(lector.result));
            lector.readAsDataURL(f);
          });
          resolve({ dataUrl, mime: f.type || 'image/jpeg', origen: this.origen, dispositivo: 'Cámara' });
        } catch {
          reject(new HuellaError('No se pudo leer la foto.', this.origen));
        }
      };
      const alVolver = () => setTimeout(() => terminar(input.files?.[0] ?? null), 400);

      input.addEventListener('change', () => terminar(input.files?.[0] ?? null));
      input.addEventListener('cancel', () => terminar(null));
      window.addEventListener('focus', alVolver, { once: true });
      input.click();
    });
  }

  // ── Imagen ───────────────────────────────────────────────────────────────

  /**
   * Recorta del fotograma EXACTAMENTE la guía que vio la persona. El visor pinta
   * el vídeo con `object-fit: contain` justo para que lo encuadrado y lo
   * recortado sean lo mismo: con `cover` el navegador corta por su cuenta y la
   * huella acaba desplazada respecto a la guía.
   */
  private recortarGuia(video: HTMLVideoElement): HTMLCanvasElement {
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const gw = vw * EstrategiaCamara.GUIA_ANCHO;
    const gh = vh * EstrategiaCamara.GUIA_ALTO;
    const gx = (vw - gw) / 2;
    const gy = (vh - gh) / 2;

    const escala = Math.min(1, EstrategiaCamara.LADO_MAX / Math.max(gw, gh));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(gw * escala);
    lienzo.height = Math.round(gh * escala);
    lienzo.getContext('2d')!.drawImage(video, gx, gy, gw, gh, 0, 0, lienzo.width, lienzo.height);
    return lienzo;
  }

  /**
   * Deja las crestas en negro sobre blanco.
   *
   * Umbral ADAPTATIVO, no global: la luz sobre un dedo nunca es uniforme —la
   * yema hace sombra por un lado y la linterna quema por el otro—, y un umbral
   * único convierte media huella en una mancha negra y la otra media en papel
   * en blanco. Aquí cada píxel se compara con la media de su vecindario, que se
   * calcula en una pasada con una imagen integral.
   */
  private realzar(fuente: HTMLCanvasElement): HTMLCanvasElement {
    const ctx = fuente.getContext('2d')!;
    const { width: w, height: h } = fuente;
    const img = ctx.getImageData(0, 0, w, h);
    const px = img.data;

    // 1. Gris (luminancia perceptual).
    const gris = new Float64Array(w * h);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      gris[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }

    // 2. Imagen integral: suma acumulada para medias de ventana en O(1).
    const integral = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let fila = 0;
      for (let x = 0; x < w; x++) {
        fila += gris[y * w + x];
        integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + fila;
      }
    }

    // 3. Umbral local. Ventana ~1/8 del ancho: mas grande difumina las crestas,
    //    mas pequena convierte el ruido del sensor en crestas falsas.
    const radio = Math.max(4, Math.round(w / 16));
    const C = 6;
    const salida = document.createElement('canvas');
    salida.width = w; salida.height = h;
    const destino = salida.getContext('2d')!.createImageData(w, h);

    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - radio), y1 = Math.min(h - 1, y + radio);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - radio), x1 = Math.min(w - 1, x + radio);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const suma =
            integral[(y1 + 1) * (w + 1) + (x1 + 1)]
          - integral[y0 * (w + 1) + (x1 + 1)]
          - integral[(y1 + 1) * (w + 1) + x0]
          + integral[y0 * (w + 1) + x0];
        const media = suma / area;
        const v = gris[y * w + x] < media - C ? 0 : 255;
        const k = (y * w + x) * 4;
        destino.data[k] = destino.data[k + 1] = destino.data[k + 2] = v;
        destino.data[k + 3] = 255;
      }
    }
    salida.getContext('2d')!.putImageData(destino, 0, 0);
    return salida;
  }

  private aDataUrl(lienzo: HTMLCanvasElement): string {
    return lienzo.toDataURL('image/png');
  }

  // ── Visor en DOM plano ───────────────────────────────────────────────────
  //
  // Sin componente de Angular a propósito: una estrategia es una clase suelta
  // que no conoce el árbol de componentes, igual que `EstrategiaArchivo` crea
  // su propio <input>. Meter aquí un MatDialog obligaría a inyectar el diálogo
  // en todas las estrategias solo por esta.

  private construirVisor(): Visor {
    const css = (el: HTMLElement, e: Partial<CSSStyleDeclaration>) => Object.assign(el.style, e);
    const raiz = document.createElement('div');
    css(raiz, {
      position: 'fixed', inset: '0', zIndex: '10000', background: '#000',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    });

    const marco = document.createElement('div');
    css(marco, { position: 'relative', flex: '1', width: '100%', overflow: 'hidden' });

    const video = document.createElement('video');
    video.playsInline = true; video.muted = true; video.autoplay = true;
    css(video, { width: '100%', height: '100%', objectFit: 'contain', background: '#000' });

    // La guía: mismas fracciones que usa el recorte.
    const guia = document.createElement('div');
    css(guia, {
      position: 'absolute',
      left: `${(1 - EstrategiaCamara.GUIA_ANCHO) * 50}%`,
      top: `${(1 - EstrategiaCamara.GUIA_ALTO) * 50}%`,
      width: `${EstrategiaCamara.GUIA_ANCHO * 100}%`,
      height: `${EstrategiaCamara.GUIA_ALTO * 100}%`,
      border: '2px dashed rgba(255,255,255,.9)', borderRadius: '44% 44% 40% 40%',
      boxShadow: '0 0 0 9999px rgba(0,0,0,.45)', pointerEvents: 'none',
    });

    const ayuda = document.createElement('p');
    ayuda.textContent = 'Llena la guía con la yema del índice derecho. Busca buena luz y mantén el pulso.';
    css(ayuda, {
      position: 'absolute', left: '0', right: '0', bottom: '12px', margin: '0',
      textAlign: 'center', color: '#fff', fontSize: '13px', padding: '0 18px',
      textShadow: '0 1px 3px rgba(0,0,0,.8)', pointerEvents: 'none',
    });

    marco.append(video, guia, ayuda);

    const barra = document.createElement('div');
    css(barra, {
      display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'center',
      padding: '14px', width: '100%', background: '#0b1220', flexWrap: 'wrap',
    });

    const boton = (texto: string, principal = false) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = texto;
      css(b, {
        padding: '11px 20px', borderRadius: '999px', border: 'none', cursor: 'pointer',
        fontSize: '15px', fontWeight: '600',
        background: principal ? '#7bc043' : 'rgba(255,255,255,.14)',
        color: principal ? '#0b1220' : '#fff',
      });
      return b;
    };

    const btnCancelar = boton('Cancelar');
    const btnLuz = boton('Luz: apagada');
    const btnDisparo = boton('Capturar huella', true);
    barra.append(btnCancelar, btnLuz, btnDisparo);
    raiz.append(marco, barra);

    const visor: Visor = {
      raiz, video, btnLuz,

      esperarDisparo: () => new Promise<boolean>((resolve) => {
        btnDisparo.onclick = () => resolve(true);
        btnCancelar.onclick = () => resolve(false);
      }),

      /** Devuelve el dataUrl elegido, 'repetir' o 'cancelar'. */
      previsualizar: (realzada: string, original: string) => new Promise((resolve) => {
        let usandoRealce = true;
        const capa = document.createElement('div');
        css(capa, {
          position: 'absolute', inset: '0', background: '#0b1220',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px',
        });

        const img = document.createElement('img');
        img.src = realzada;
        css(img, { maxWidth: '86%', maxHeight: '62%', objectFit: 'contain', background: '#fff', borderRadius: '10px' });

        const nota = document.createElement('p');
        nota.textContent = 'Las crestas deben verse separadas. Si sale una mancha, repite con más luz.';
        css(nota, { color: '#cbd5e1', fontSize: '13px', margin: '0', textAlign: 'center', padding: '0 20px' });

        const fila = document.createElement('div');
        css(fila, { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' });

        const btnRealce = boton('Ver sin realzar');
        const btnRepetir = boton('Repetir');
        const btnUsar = boton('Usar esta', true);
        fila.append(btnRepetir, btnRealce, btnUsar);
        capa.append(img, nota, fila);
        marco.appendChild(capa);

        const cerrar = (r: string) => { capa.remove(); resolve(r); };
        btnRealce.onclick = () => {
          usandoRealce = !usandoRealce;
          img.src = usandoRealce ? realzada : original;
          btnRealce.textContent = usandoRealce ? 'Ver sin realzar' : 'Ver realzada';
        };
        btnRepetir.onclick = () => cerrar('repetir');
        btnUsar.onclick = () => cerrar(usandoRealce ? realzada : original);
        btnCancelar.onclick = () => cerrar('cancelar');
      }),
    };
    return visor;
  }
}

interface Visor {
  raiz: HTMLElement;
  video: HTMLVideoElement;
  btnLuz: HTMLButtonElement;
  esperarDisparo(): Promise<boolean>;
  previsualizar(realzada: string, original: string): Promise<string>;
}
