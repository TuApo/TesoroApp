/**
 * WebRTC contra MediaMTX con los protocolos estándar WHEP (ver) y WHIP (publicar).
 *
 * <p>POR QUÉ `fetch` Y NO HttpClient: el interceptor de la app le pondría el JWT del usuario a
 * cualquier URL de api.tuapo.co, y aquí la credencial es el TOKEN DE VIDEO (5 min, una ruta) que
 * entrega ms-seguridad. Además hace falta leer la cabecera `Location` del 201 para cerrar la
 * sesión con DELETE, y el cuerpo es SDP en texto plano.
 *
 * <p>Sin "trickle ICE": se espera a juntar los candidatos (máx. 2,5 s) y se manda la oferta
 * completa. Es un viaje menos de ida y vuelta y MediaMTX lo acepta igual.
 *
 * <p>Sin dependencias de Angular: lo usan el visor del centro, el botón PTT y las páginas
 * públicas (parlante en modo quiosco).
 */

export interface SesionWebrtc {
  readonly pc: RTCPeerConnection;
  /** Lo que llega (WHEP). En WHIP es el stream que se publica. */
  readonly stream: MediaStream;
  /** Cierra la conexión y avisa al servidor (DELETE a la Location) sin esperar respuesta. */
  cerrar(): void;
}

export interface OpcionesWebrtc {
  /** Avisos de conexión: 'connected', 'failed', 'disconnected', 'closed'. */
  alEstado?: (estado: RTCPeerConnectionState) => void;
  /** Tope para establecer la conexión completa (incluida la negociación). */
  timeoutMs?: number;
  /** Recibir audio en WHEP (por defecto sí). */
  audio?: boolean;
  /** Recibir video en WHEP (por defecto sí). */
  video?: boolean;
}

export function soportaWebrtc(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection === 'function';
}

function cabeceraAuth(token: string | null | undefined): Record<string, string> {
  if (!token) return {};
  return { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };
}

/** Espera a que termine de juntar candidatos ICE (o hasta `ms`). */
function esperarIce(pc: RTCPeerConnection, ms = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(fin, ms);
    function fin() {
      clearTimeout(t);
      pc.removeEventListener('icegatheringstatechange', revisar);
      resolve();
    }
    function revisar() { if (pc.iceGatheringState === 'complete') fin(); }
    pc.addEventListener('icegatheringstatechange', revisar);
  });
}

/** Servidores ICE que MediaMTX anuncia en la cabecera `Link` (STUN/TURN). */
function iceDeLink(link: string | null): RTCIceServer[] {
  if (!link) return [];
  const servidores: RTCIceServer[] = [];
  for (const parte of link.split(',')) {
    const m = /<([^>]+)>;\s*rel="ice-server"(.*)/i.exec(parte.trim());
    if (!m) continue;
    const s: RTCIceServer = { urls: m[1] };
    const u = /username="([^"]*)"/i.exec(m[2]);
    const c = /credential="([^"]*)"/i.exec(m[2]);
    if (u) s.username = u[1];
    if (c) s.credential = c[1];
    servidores.push(s);
  }
  return servidores;
}

/** Pregunta (OPTIONS) por los servidores ICE; si falla se sigue sin ellos. */
async function pedirIce(url: string, token: string | null | undefined): Promise<RTCIceServer[]> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const r = await fetch(url, { method: 'OPTIONS', headers: cabeceraAuth(token), signal: ctl.signal });
    return iceDeLink(r.headers.get('Link'));
  } catch { return []; }
  finally { clearTimeout(t); }
}

function conTope<T>(p: Promise<T>, ms: number, mensaje: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(mensaje)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Espera a que la conexión quede 'connected' (o falle). */
function esperarConexion(pc: RTCPeerConnection): Promise<void> {
  if (pc.connectionState === 'connected') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const revisar = () => {
      if (pc.connectionState === 'connected') { pc.removeEventListener('connectionstatechange', revisar); resolve(); }
      else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        pc.removeEventListener('connectionstatechange', revisar);
        reject(new Error('La conexión de video falló'));
      }
    };
    pc.addEventListener('connectionstatechange', revisar);
  });
}

async function negociar(
  pc: RTCPeerConnection, url: string, token: string | null | undefined,
): Promise<string | null> {
  const oferta = await pc.createOffer();
  await pc.setLocalDescription(oferta);
  await esperarIce(pc);
  const sdp = pc.localDescription?.sdp ?? oferta.sdp ?? '';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp', ...cabeceraAuth(token) },
    body: sdp,
  });
  if (r.status !== 201 && r.status !== 200) {
    const txt = await r.text().catch(() => '');
    const motivo = r.status === 401 || r.status === 403 ? 'sin permiso para este video (token vencido o inválido)'
      : r.status === 404 ? 'el video no está disponible ahora' : `respuesta ${r.status}`;
    throw new Error(`No se pudo abrir el video: ${motivo}${txt ? ` (${txt.slice(0, 120)})` : ''}`);
  }
  const loc = r.headers.get('Location');
  const respuesta = await r.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: respuesta });
  return loc ? new URL(loc, url).toString() : null;
}

function cierre(pc: RTCPeerConnection, ubicacion: () => string | null, token: string | null | undefined, extra?: () => void) {
  let cerrado = false;
  return () => {
    if (cerrado) return;
    cerrado = true;
    try { extra?.(); } catch { /* nada */ }
    try { pc.close(); } catch { /* ya cerrado */ }
    const loc = ubicacion();
    if (loc) fetch(loc, { method: 'DELETE', headers: cabeceraAuth(token), keepalive: true }).catch(() => { /* el servidor la vence solo */ });
  };
}

/**
 * Ver un video por WHEP (recvonly). Resuelve cuando la conexión queda establecida;
 * rechaza si no se logra en `timeoutMs` (por defecto 6 s) para que el visor caiga a capturas.
 */
export async function reproducirWhep(url: string, token: string | null | undefined, op: OpcionesWebrtc = {}): Promise<SesionWebrtc> {
  if (!soportaWebrtc()) throw new Error('Este navegador no soporta WebRTC');
  const ice = await pedirIce(url, token);
  const pc = new RTCPeerConnection({ iceServers: ice });
  const stream = new MediaStream();
  let loc: string | null = null;
  const cerrar = cierre(pc, () => loc, token);
  if (op.video !== false) pc.addTransceiver('video', { direction: 'recvonly' });
  if (op.audio !== false) pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.ontrack = (ev) => { if (!stream.getTracks().includes(ev.track)) stream.addTrack(ev.track); };
  pc.onconnectionstatechange = () => op.alEstado?.(pc.connectionState);
  try {
    await conTope((async () => {
      loc = await negociar(pc, url, token);
      await esperarConexion(pc);
    })(), op.timeoutMs ?? 6000, 'El video tardó demasiado en conectar');
  } catch (e) {
    cerrar();
    throw e;
  }
  return { pc, stream, cerrar };
}

/**
 * Publicar audio (o video) por WHIP (sendonly): el PTT del operador y el micrófono del parlante.
 * Al cerrar, detiene las pistas del stream si `detenerPistas` (por defecto sí).
 */
export async function publicarWhip(
  url: string, token: string | null | undefined, stream: MediaStream, op: OpcionesWebrtc & { detenerPistas?: boolean } = {},
): Promise<SesionWebrtc> {
  if (!soportaWebrtc()) throw new Error('Este navegador no soporta WebRTC');
  const ice = await pedirIce(url, token);
  const pc = new RTCPeerConnection({ iceServers: ice });
  let loc: string | null = null;
  const cerrar = cierre(pc, () => loc, token, () => {
    if (op.detenerPistas !== false) stream.getTracks().forEach((t) => t.stop());
  });
  for (const t of stream.getTracks()) pc.addTransceiver(t, { direction: 'sendonly', streams: [stream] });
  pc.onconnectionstatechange = () => op.alEstado?.(pc.connectionState);
  try {
    await conTope((async () => {
      loc = await negociar(pc, url, token);
      await esperarConexion(pc);
    })(), op.timeoutMs ?? 8000, 'No se pudo conectar el micrófono a tiempo');
  } catch (e) {
    cerrar();
    throw e;
  }
  return { pc, stream, cerrar };
}

/** Micrófono con eco y ruido controlados (mensajes de voz por parlante). */
export function pedirMicrofono(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('Este navegador no deja usar el micrófono (hace falta HTTPS).'));
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
}

/** Frase legible para un error de getUserMedia. */
export function mensajeMicrofono(e: unknown): string {
  const n = (e as { name?: string })?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'El navegador no dio permiso para el micrófono. Actívelo en el candado de la barra de direcciones.';
  if (n === 'NotFoundError') return 'No se encontró un micrófono en este equipo.';
  if (n === 'NotReadableError') return 'Otro programa está usando el micrófono.';
  return (e as Error)?.message || 'No se pudo usar el micrófono.';
}
