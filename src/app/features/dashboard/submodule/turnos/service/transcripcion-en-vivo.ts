import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Hablante, LineaTranscripcion, LineaTranscripcionIn, TokenTranscripcion, TranscripcionTurno, TurnosService } from './turnos.service';
import { Bloqueador, Remuestreador, aMono, nivelVoz } from './audio-pcm';

/**
 * Transcripción en vivo de la atención remota.
 *
 * <p>QUIÉN HABLA se resuelve por CANAL, sin adivinar: el navegador del asesor tiene dos audios
 * separados en la videollamada — su micrófono (`local`) y lo que llega de la persona
 * (`remoto`). Cada uno va por su propio WebSocket al STT en tiempo real de ElevenLabs, así
 * que cada frase ya llega con su hablante.
 *
 * <p>Piezas, de abajo arriba (las tres primeras sin Angular, se prueban con dobles):
 *  - {@link ClienteStt}: un WebSocket por canal. Parciales que se reemplazan, frases
 *    confirmadas, errores legibles y reconexión con token nuevo y espera creciente, sin
 *    duplicar ni perder la frase que iba a medias.
 *  - {@link GuardadoPorLotes}: cada frase confirmada se guarda en ms-turnos en lotes, con
 *    reintentos; el `cliente_id` hace que repetir un lote no duplique.
 *  - {@link CapturaCanal}: AudioWorklet (o ScriptProcessor si la página no deja cargar el
 *    worklet) → 16 kHz mono PCM16 → bloques de 100 ms.
 *  - {@link TranscripcionEnVivo}: lo que usa la pantalla (señales).
 */

// ── Tipos ────────────────────────────────────────────────────────────────────

export type EstadoCanal = 'apagado' | 'conectando' | 'transcribiendo' | 'reconectando' | 'pausado' | 'error';
export type EstadoTranscripcion = 'apagada' | 'conectando' | 'transcribiendo' | 'pausada' | 'error';
export interface Parcial { texto: string; inicio_ms: number; }
/** Una frase en pantalla: confirmada (con `cliente_id` si nació aquí, con `id` si vino del servidor). */
export interface LineaEnVivo {
  cliente_id: string | null; id: number | null; hablante: Hablante; texto: string;
  inicio_ms: number; fin_ms: number | null; guardada: boolean;
}
export interface EstadoDeCanal { estado: EstadoCanal; detalle: string | null; }

export const HABLANTES: readonly Hablante[] = ['ASESOR', 'PERSONA'];
export const URL_STT_DEFECTO = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

/** Lo mínimo de un WebSocket que usa el cliente (para poder probarlo con uno falso). */
export interface SocketStt {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  send(datos: string): void;
  close(code?: number, reason?: string): void;
}

export type MensajeStt =
  | { tipo: 'sesion' }
  | { tipo: 'parcial'; texto: string }
  | { tipo: 'confirmada'; texto: string; conMarcas: boolean }
  | { tipo: 'error'; codigo: string; mensaje: string; fatal: boolean; reconectar: boolean }
  | { tipo: 'otro' };

/** Error al pedir el token o al conectar que NO se arregla reintentando. */
export class ErrorSttFatal extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = 'ErrorSttFatal'; }
}

// ── Funciones puras ──────────────────────────────────────────────────────────

/** URL del WebSocket a partir de lo que devuelve el backend (completa lo que falte, respeta lo que traiga). */
export function armarUrlStt(t: TokenTranscripcion): string {
  const u = new URL(t.url || URL_STT_DEFECTO);
  const poner = (k: string, v: string | number | null | undefined) => {
    if (v !== null && v !== undefined && v !== '' && !u.searchParams.has(k)) u.searchParams.set(k, String(v));
  };
  poner('model_id', t.modelo || 'scribe_v2_realtime');
  poner('token', t.token);
  poner('language_code', t.idioma || 'es');
  poner('audio_format', `pcm_${t.sample_rate || 16000}`);
  poner('commit_strategy', 'vad');
  return u.toString();
}

/** Espera antes del intento `n` (1, 2, 4, 8 s… hasta 15 s). */
export function esperaReconexion(intento: number): number {
  return Math.min(15_000, 1_000 * Math.pow(2, Math.max(0, intento - 1)));
}

/**
 * Una sesión que duró al menos esto se considera sana: solo entonces se reinicia la cuenta de
 * reintentos. Si se reiniciara con cada `session_started`, un servicio que acepta y corta
 * enseguida haría reconectar cada segundo gastando un token por vez (el tope es por turno).
 */
export const SESION_ESTABLE_MS = 20_000;
/** Nivel de voz (0-1, escala de nivelVoz ≈ -41 dBFS) que despierta un canal dormido por silencio. */
export const UMBRAL_DESPERTAR = 0.4;
const DETALLE_SILENCIO = 'En silencio: se reconecta sola cuando alguien hable.';

const ERRORES_STT: Record<string, { mensaje: string; fatal: boolean; reconectar: boolean }> = {
  auth_error: { mensaje: 'El servicio de transcripción rechazó el acceso (token vencido o inválido); se pide uno nuevo.', fatal: false, reconectar: true },
  quota_exceeded: { mensaje: 'Se agotó el saldo de transcripción de la cuenta de ElevenLabs.', fatal: true, reconectar: false },
  unaccepted_terms: { mensaje: 'La cuenta de ElevenLabs no ha aceptado los términos de la transcripción en tiempo real.', fatal: true, reconectar: false },
  rate_limited: { mensaje: 'Demasiadas transcripciones a la vez en la cuenta; se reintenta en unos segundos.', fatal: false, reconectar: true },
  resource_exhausted: { mensaje: 'El servicio de transcripción está saturado; se reintenta en unos segundos.', fatal: false, reconectar: true },
  queue_overflow: { mensaje: 'El servicio de transcripción no alcanzó a procesar el audio; se reconecta.', fatal: false, reconectar: true },
  session_time_limit_exceeded: { mensaje: 'La sesión de transcripción llegó a su límite de tiempo; se abre otra.', fatal: false, reconectar: true },
  insufficient_audio_activity: { mensaje: 'Sin voz por un buen rato: la transcripción se reanuda sola cuando alguien hable.', fatal: false, reconectar: true },
  input_error: { mensaje: 'El audio enviado no tiene el formato que espera el servicio de transcripción.', fatal: true, reconectar: false },
  chunk_size_exceeded: { mensaje: 'Un bloque de audio superó el tamaño permitido.', fatal: false, reconectar: true },
  transcriber_error: { mensaje: 'El servicio de transcripción tuvo un error interno; se reconecta.', fatal: false, reconectar: true },
};

/** Traduce un mensaje del WebSocket del STT a algo que la pantalla entiende. */
export function interpretarMensajeStt(crudo: unknown): MensajeStt {
  let m: Record<string, unknown>;
  try {
    m = (typeof crudo === 'string' ? JSON.parse(crudo) : crudo) as Record<string, unknown>;
  } catch {
    return { tipo: 'otro' };
  }
  if (!m || typeof m !== 'object') return { tipo: 'otro' };
  const tipo = String(m['message_type'] ?? m['type'] ?? '');
  const texto = typeof m['text'] === 'string' ? (m['text'] as string) : '';
  switch (tipo) {
    case 'session_started': return { tipo: 'sesion' };
    case 'partial_transcript': return { tipo: 'parcial', texto };
    case 'committed_transcript': return { tipo: 'confirmada', texto, conMarcas: false };
    case 'committed_transcript_with_timestamps': return { tipo: 'confirmada', texto, conMarcas: true };
    case 'commit_throttled': return { tipo: 'otro' };
  }
  if (tipo && (tipo in ERRORES_STT || /error|exceeded|limit|denied|invalid/i.test(tipo))) {
    const conocido = ERRORES_STT[tipo];
    const detalle = String(m['error'] ?? m['message'] ?? m['detail'] ?? '').trim();
    const base = conocido?.mensaje ?? 'El servicio de transcripción devolvió un error';
    return {
      tipo: 'error', codigo: tipo,
      mensaje: !conocido && detalle ? `${base}: ${detalle.slice(0, 160)}` : base,
      fatal: conocido?.fatal ?? false, reconectar: conocido?.reconectar ?? true,
    };
  }
  return { tipo: 'otro' };
}

/** Mensaje legible (y si vale la pena reintentar) cuando falla pedir el token al backend. */
export function errorDeToken(e: unknown): { mensaje: string; fatal: boolean } {
  const http = e as HttpErrorResponse | null;
  const status = http?.status ?? 0;
  const cuerpo = (http?.error ?? null) as { error?: string; message?: string } | null;
  const delServidor = (cuerpo && typeof cuerpo === 'object' ? (cuerpo.error || cuerpo.message) : null) || null;
  if (status === 503) return { mensaje: delServidor || 'La transcripción en vivo no está configurada', fatal: true };
  if (status === 429) return { mensaje: delServidor || 'Se alcanzó el límite de conexiones de transcripción para este turno', fatal: true };
  if (status === 403) return { mensaje: delServidor || 'Solo quien atiende el turno remoto puede transcribirlo', fatal: true };
  if (status === 404 || status === 409) return { mensaje: delServidor || 'El turno ya no está abierto para transcribir', fatal: true };
  if (status === 0) return { mensaje: 'Sin conexión con el servidor para pedir el acceso a la transcripción', fatal: false };
  return { mensaje: delServidor || 'No se pudo pedir el acceso a la transcripción', fatal: false };
}

/** Identificador de frase para el guardado idempotente (uuid v4). */
export function nuevoClienteId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) {
    try { return c.randomUUID(); } catch { /* contexto no seguro */ }
  }
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function normalizarParaComparar(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Clave que identifica una frase aunque venga una vez del front y otra del servidor. */
export function claveLinea(l: { cliente_id?: string | null; hablante: Hablante; inicio_ms: number; texto: string }): string {
  return l.cliente_id ? `c:${l.cliente_id}` : `t:${l.hablante}|${Math.round(l.inicio_ms / 1000)}|${normalizarParaComparar(l.texto)}`;
}

/** Junta lo guardado en el servidor con lo que hay en memoria, sin duplicar, en orden de tiempo. */
export function unirLineas(locales: LineaEnVivo[], delServidor: LineaTranscripcion[]): LineaEnVivo[] {
  const porClave = new Map<string, LineaEnVivo>();
  const textoTiempo = new Set<string>();
  const tt = (l: { hablante: Hablante; inicio_ms: number; texto: string }) => `${l.hablante}|${Math.round(l.inicio_ms / 1000)}|${normalizarParaComparar(l.texto)}`;
  for (const s of delServidor ?? []) {
    const l: LineaEnVivo = { cliente_id: s.cliente_id ?? null, id: s.id ?? null, hablante: s.hablante, texto: s.texto, inicio_ms: s.inicio_ms, fin_ms: s.fin_ms ?? null, guardada: true };
    porClave.set(claveLinea(l), l);
    textoTiempo.add(tt(l));
  }
  for (const l of locales) {
    const k = claveLinea(l);
    const ya = porClave.get(k);
    if (ya) { porClave.set(k, { ...ya, cliente_id: ya.cliente_id ?? l.cliente_id, guardada: true }); continue; }
    if (textoTiempo.has(tt(l))) continue; // el servidor no devolvió el cliente_id, pero es la misma frase
    porClave.set(k, l);
  }
  return [...porClave.values()].sort((a, b) => a.inicio_ms - b.inicio_ms || (a.fin_ms ?? 0) - (b.fin_ms ?? 0));
}

// ── Cliente WebSocket (un canal) ─────────────────────────────────────────────

export interface OpcionesClienteStt {
  hablante: Hablante;
  pedirToken: () => Promise<TokenTranscripcion>;
  crearSocket?: (url: string) => SocketStt;
  alParcial: (texto: string) => void;
  alConfirmada: (texto: string) => void;
  alEstado: (estado: EstadoCanal, detalle: string | null) => void;
  /** Intentos seguidos sin llegar a abrir sesión antes de rendirse. */
  maxIntentos?: number;
}

/**
 * Un WebSocket al STT para UN canal. Envía bloques de audio, avisa parciales y frases, y se
 * reconecta solo (token nuevo, espera creciente) si el socket se cae sin que nadie lo cierre.
 *
 * <p>Sin duplicar: una frase se avisa como confirmada una sola vez. Si el socket muere con una
 * frase a medias, esa parcial se da por confirmada (el servidor ya no la va a cerrar) y la
 * sesión nueva empieza limpia.
 */
export class ClienteStt {
  private socket: SocketStt | null = null;
  private intentos = 0;
  private cerradoAProposito = true;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private parcial = '';
  private ultimaConfirmada = { texto: '', en: 0 };
  /** Audio que llega mientras se conecta: hasta 3 s, para no perder las primeras palabras. */
  private cola: string[] = [];
  private estadoActual: EstadoCanal = 'apagado';
  private quitarEscuchaCsp: (() => void) | null = null;
  /** Cuándo empezó la sesión en curso (0 = sin sesión). */
  private sesionDesde = 0;
  /**
   * El servicio cerró por silencio (`insufficient_audio_activity`): no se reconecta hasta que
   * alguien hable (despertar()), así un rato largo sin voz no quema tokens en bucle.
   */
  private dormido = false;

  constructor(private readonly op: OpcionesClienteStt) {}

  get estado(): EstadoCanal { return this.estadoActual; }
  get abierto(): boolean { return !!this.socket && this.socket.readyState === 1; }
  get dormida(): boolean { return this.dormido; }

  async conectar(): Promise<void> {
    this.cerradoAProposito = false;
    this.dormido = false;
    if (this.temporizador) { clearTimeout(this.temporizador); this.temporizador = null; }
    this.poner(this.intentos > 0 ? 'reconectando' : 'conectando', null);
    let token: TokenTranscripcion;
    try {
      token = await this.op.pedirToken();
    } catch (e) {
      if (this.cerradoAProposito) return;
      const err = e instanceof ErrorSttFatal ? { mensaje: e.message, fatal: true } : errorDeToken(e);
      if (err.fatal) { this.poner('error', err.mensaje); return; }
      this.programarReintento(err.mensaje);
      return;
    }
    if (this.cerradoAProposito) return;
    const url = armarUrlStt(token);
    let s: SocketStt;
    try {
      s = (this.op.crearSocket ?? ((u: string) => new WebSocket(u) as unknown as SocketStt))(url);
    } catch (e) {
      // Algunos navegadores lanzan aquí si la política de seguridad de la página no deja conectar.
      this.poner('error', mensajeBloqueo(e));
      return;
    }
    this.socket = s;
    this.escucharCsp();
    let abrio = false;
    s.onopen = () => {
      abrio = true;
      this.dejarDeEscucharCsp();
      this.poner('transcribiendo', null);
      // El audio acumulado mientras se conectaba sale primero.
      for (const b of this.cola.splice(0)) this.mandar(b, false);
    };
    s.onmessage = ev => this.alMensaje(ev.data);
    s.onerror = () => { /* llega siempre antes de onclose, que es el que decide */ };
    s.onclose = ev => {
      if (this.socket !== s) return;
      this.socket = null;
      // La escucha de la CSP sigue viva si no llegó a abrir: el aviso del bloqueo puede
      // llegar después del cierre y es el que da el motivo real (y cancela el reintento).
      if (abrio) this.dejarDeEscucharCsp();
      if (this.parcial.trim()) this.confirmar_(this.parcial);
      this.parcial = '';
      this.op.alParcial('');
      const estable = abrio && this.sesionDesde > 0 && Date.now() - this.sesionDesde >= SESION_ESTABLE_MS;
      this.sesionDesde = 0;
      if (this.cerradoAProposito || this.estadoActual === 'error') return;
      if (this.dormido) { this.poner('transcribiendo', DETALLE_SILENCIO); return; }
      if (estable) this.intentos = 0;
      const motivo = ev?.code === 1008 || ev?.code === 4001 ? 'El servicio de transcripción cerró la sesión (acceso vencido); se abre otra.'
        : abrio ? 'Se perdió la conexión con el servicio de transcripción; se reconecta.'
        : 'No se pudo conectar con el servicio de transcripción; se reintenta.';
      this.programarReintento(motivo);
    };
  }

  /** Un bloque de 100 ms en base64. Si aún no hay sesión, espera en cola (máx. 3 s). */
  enviarAudio(base64: string): void {
    if (this.cerradoAProposito || this.estadoActual === 'error') return;
    if (this.abierto && this.estadoActual === 'transcribiendo') { this.mandar(base64, false); return; }
    this.cola.push(base64);
    if (this.cola.length > 30) this.cola.splice(0, this.cola.length - 30);
  }

  /** Pide cerrar la frase en curso (al pausar o colgar). */
  confirmarFrase(): void {
    if (this.abierto) this.mandar('', true);
  }

  /** Cierre intencional: no reconecta. La frase a medias se da por confirmada. */
  cerrar(estadoFinal: EstadoCanal = 'apagado'): void {
    this.cerradoAProposito = true;
    this.dormido = false;
    this.sesionDesde = 0;
    if (this.temporizador) { clearTimeout(this.temporizador); this.temporizador = null; }
    this.cola = [];
    this.dejarDeEscucharCsp();
    const s = this.socket;
    this.socket = null;
    if (this.parcial.trim()) this.confirmar_(this.parcial);
    this.parcial = '';
    this.op.alParcial('');
    if (s) {
      try { if (s.readyState === 1) s.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: 16000 })); } catch { /* ya cerrado */ }
      try { s.close(1000, 'fin'); } catch { /* ya cerrado */ }
    }
    this.intentos = 0;
    this.poner(estadoFinal, null);
  }

  /**
   * Hay voz en el canal: si estaba dormido por silencio, reconecta (con token nuevo). El audio
   * de los últimos 3 s espera en cola, así que las palabras que lo despertaron no se pierden.
   */
  despertar(): void {
    if (!this.dormido || this.cerradoAProposito) return;
    this.dormido = false;
    void this.conectar();
  }

  private alMensaje(datos: unknown): void {
    const m = interpretarMensajeStt(datos);
    switch (m.tipo) {
      case 'sesion':
        this.sesionDesde = Date.now();
        this.poner('transcribiendo', null);
        for (const b of this.cola.splice(0)) this.mandar(b, false);
        return;
      case 'parcial':
        if (this.estadoActual !== 'transcribiendo') this.poner('transcribiendo', null);
        this.parcial = m.texto;
        this.op.alParcial(m.texto);
        return;
      case 'confirmada': {
        const t = m.texto.trim();
        this.parcial = '';
        this.op.alParcial('');
        if (!t) return;
        // La versión con marcas de tiempo repite la misma frase: se ignora si ya llegó.
        if (m.conMarcas && normalizarParaComparar(t) === normalizarParaComparar(this.ultimaConfirmada.texto) && Date.now() - this.ultimaConfirmada.en < 10_000) return;
        this.confirmar_(t);
        return;
      }
      case 'error':
        if (m.fatal) {
          this.poner('error', m.mensaje);
          this.cerradoAProposito = true;
          try { this.socket?.close(1000, 'error'); } catch { /* ya cerrado */ }
          return;
        }
        if (m.codigo === 'insufficient_audio_activity') {
          // Silencio largo: se duerme y reconecta cuando vuelva la voz, no en bucle.
          this.dormido = true;
          try { this.socket?.close(4000, m.codigo); } catch { /* ya cerrado */ }
          if (!this.socket) this.poner('transcribiendo', DETALLE_SILENCIO);
          return;
        }
        // No fatal: el socket suele cerrarse enseguida y onclose reconecta; si no, se fuerza.
        this.poner('reconectando', m.mensaje);
        if (m.reconectar) { try { this.socket?.close(4000, m.codigo); } catch { /* ya cerrado */ } }
        return;
    }
  }

  private confirmar_(texto: string): void {
    const t = texto.trim();
    if (!t) return;
    this.ultimaConfirmada = { texto: t, en: Date.now() };
    this.op.alConfirmada(t);
  }

  private mandar(base64: string, commit: boolean): void {
    try {
      this.socket?.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: base64, commit, sample_rate: 16000 }));
    } catch { /* se cerró entre medias: onclose reconecta */ }
  }

  private programarReintento(motivo: string): void {
    this.intentos++;
    const max = this.op.maxIntentos ?? 6;
    if (this.intentos > max) {
      this.poner('error', `${motivo.replace(/;.*$/, '')}. Se intentó ${max} veces.`);
      this.cerradoAProposito = true;
      return;
    }
    this.poner('reconectando', motivo);
    this.temporizador = setTimeout(() => { this.temporizador = null; void this.conectar(); }, esperaReconexion(this.intentos));
  }

  private poner(e: EstadoCanal, detalle: string | null): void {
    this.estadoActual = e;
    this.op.alEstado(e, detalle);
  }

  /** La CSP de la página puede bloquear el WebSocket sin lanzar: el navegador solo lo avisa por este evento. */
  private escucharCsp(): void {
    if (typeof document === 'undefined' || this.quitarEscuchaCsp) return;
    const f = (ev: Event) => {
      const uri = String((ev as SecurityPolicyViolationEvent).blockedURI || '');
      if (!/elevenlabs|wss:/i.test(uri)) return;
      this.cerradoAProposito = true;
      if (this.temporizador) { clearTimeout(this.temporizador); this.temporizador = null; }
      this.dejarDeEscucharCsp();
      this.poner('error', 'El navegador bloqueó la conexión con el servicio de transcripción (política de seguridad de la página: falta permitir wss://api.elevenlabs.io).');
    };
    document.addEventListener('securitypolicyviolation', f);
    this.quitarEscuchaCsp = () => document.removeEventListener('securitypolicyviolation', f);
  }

  private dejarDeEscucharCsp(): void {
    this.quitarEscuchaCsp?.();
    this.quitarEscuchaCsp = null;
  }
}

function mensajeBloqueo(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return /security|content security|csp/i.test(msg)
    ? 'El navegador bloqueó la conexión con el servicio de transcripción (política de seguridad de la página).'
    : 'No se pudo abrir la conexión con el servicio de transcripción.';
}

// ── Guardado por lotes ───────────────────────────────────────────────────────

export interface OpcionesGuardado {
  enviar: (lote: LineaTranscripcionIn[]) => Promise<unknown>;
  alGuardar?: (clientesIds: string[]) => void;
  alError?: (mensaje: string | null) => void;
  /** El servidor rechazó el lote para siempre (4xx): no se reintenta; las frases quedan solo en pantalla. */
  alDescartar?: (clientesIds: string[], mensaje: string) => void;
  /** Espera antes de mandar un lote que no se ha llenado. */
  esperaMs?: number;
  tamano?: number;
}

/**
 * ¿El servidor dijo que NO a este lote de forma definitiva? 400 (frase inválida), 403 (el
 * turno ya lo atiende otra persona o volvió a la cola), 404, 409 (turno cerrado hace rato o
 * tope de frases), 413/422. Reintentar eso es un bucle infinito que nunca va a entrar. 401,
 * 408, 429, 5xx y sin red sí se reintentan.
 */
export function esRechazoDefinitivo(e: unknown): boolean {
  const st = (e as { status?: number } | null)?.status ?? 0;
  return [400, 403, 404, 409, 410, 413, 422].includes(st);
}

function mensajeRechazo(e: unknown, n: number): string {
  const cuerpo = (e as { error?: { error?: string; message?: string } | null } | null)?.error;
  const motivo = cuerpo && typeof cuerpo === 'object' ? (cuerpo.error || cuerpo.message) : null;
  return `No se guardaron ${n} frase(s)${motivo ? ': ' + motivo : ''}. Quedan solo en esta pantalla.`;
}

/**
 * Cola de frases por guardar. Junta lo que llega en `esperaMs` (o hasta `tamano`) y lo manda;
 * si falla, lo devuelve al frente y reintenta con espera creciente. Como el backend es
 * idempotente por `cliente_id`, reenviar un lote que sí había entrado no duplica.
 */
export class GuardadoPorLotes {
  private cola: LineaTranscripcionIn[] = [];
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private enVuelo: Promise<void> | null = null;
  private fallos = 0;
  private detenido = false;
  private terminando: Promise<void> | null = null;

  constructor(private readonly op: OpcionesGuardado) {}

  get pendientes(): number { return this.cola.length; }

  agregar(linea: LineaTranscripcionIn): void {
    if (this.detenido) return;
    if (this.cola.some(l => l.cliente_id === linea.cliente_id)) return;
    this.cola.push({ ...linea, texto: linea.texto.slice(0, 2000) });
    if (this.cola.length >= this.tamano) this.programar(0);
    else if (!this.temporizador && !this.enVuelo) this.programar(this.op.esperaMs ?? 2500);
  }

  /** Manda ya todo lo pendiente; resuelve cuando la cola quedó vacía o el intento falló. */
  async vaciar(): Promise<void> {
    if (this.temporizador) { clearTimeout(this.temporizador); this.temporizador = null; }
    if (this.enVuelo) await this.enVuelo;
    while (this.cola.length) {
      const antes = this.cola.length;
      await this.mandarLote();
      if (this.cola.length >= antes) break; // falló: queda para el reintento
    }
  }

  detener(): void {
    this.detenido = true;
    if (this.temporizador) { clearTimeout(this.temporizador); this.temporizador = null; }
  }

  /**
   * Manda lo pendiente y se apaga. Al colgar no basta un intento: si justo falla la red, las
   * últimas frases se perderían. Reintenta con espera creciente hasta vaciar o hasta `plazoMs`
   * (por debajo de los 120 s de gracia que ms-turnos da tras cerrar el turno) y luego se detiene.
   */
  terminar(plazoMs = 90_000): Promise<void> {
    if (this.terminando) return this.terminando;
    const limite = Date.now() + plazoMs;
    this.terminando = (async () => {
      let intento = 0;
      while (this.cola.length && !this.detenido) {
        await this.vaciar();
        if (this.temporizador) { clearTimeout(this.temporizador); this.temporizador = null; }
        if (!this.cola.length) break;
        const espera = Math.min(15_000, 1_000 * Math.pow(2, intento++), limite - Date.now());
        if (espera <= 0) break;
        await new Promise(r => setTimeout(r, espera));
      }
      this.detener();
    })();
    return this.terminando;
  }

  private get tamano(): number { return Math.min(50, Math.max(1, this.op.tamano ?? 20)); }

  private programar(ms: number): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => { this.temporizador = null; void this.mandarLote(); }, ms);
  }

  private mandarLote(): Promise<void> {
    if (this.enVuelo) return this.enVuelo;
    if (!this.cola.length) return Promise.resolve();
    const lote = this.cola.splice(0, this.tamano);
    this.enVuelo = this.op.enviar(lote).then(
      () => {
        this.fallos = 0;
        this.op.alError?.(null);
        this.op.alGuardar?.(lote.map(l => l.cliente_id));
      },
      (e: unknown) => {
        if (esRechazoDefinitivo(e)) {
          this.fallos = 0;
          const msg = mensajeRechazo(e, lote.length);
          this.op.alError?.(msg);
          this.op.alDescartar?.(lote.map(l => l.cliente_id), msg);
          return;
        }
        // Al frente otra vez, sin duplicar lo que haya llegado mientras tanto.
        const ids = new Set(this.cola.map(l => l.cliente_id));
        this.cola.unshift(...lote.filter(l => !ids.has(l.cliente_id)));
        this.fallos++;
        this.op.alError?.(`No se pudieron guardar ${this.cola.length} frase(s); se reintenta.`);
      },
    ).finally(() => {
      this.enVuelo = null;
      if (this.detenido || !this.cola.length) return;
      if (this.fallos) this.programar(Math.min(30_000, 2_000 * Math.pow(2, this.fallos - 1)));
      else if (this.cola.length >= this.tamano) this.programar(0);
      else this.programar(this.op.esperaMs ?? 2500);
    });
    return this.enVuelo;
  }
}

// ── Captura de audio de un canal ─────────────────────────────────────────────

/**
 * El procesador del AudioWorklet es un archivo ESTÁTICO del propio origen
 * (`public/audio/captura-pcm-worklet.js`, copiado tal cual por el build): así lo cubre
 * `script-src 'self'` de la CSP. Antes se armaba como `blob:` y la CSP de producción lo
 * bloqueaba, con lo que siempre se caía al ScriptProcessor. El `?v=` rompe la caché de un
 * año que nginx pone a los .js: súbalo si cambia el archivo.
 */
export const URL_WORKLET_CAPTURA = 'audio/captura-pcm-worklet.js?v=1';
export const NOMBRE_WORKLET_CAPTURA = 'captura-pcm-tuapo';

const contextosConWorklet = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Dirección absoluta del worklet respecto a la app (web, Electron o APK). */
export function urlWorkletCaptura(ruta = URL_WORKLET_CAPTURA): string {
  try { return new URL(ruta, typeof document === 'undefined' ? undefined : document.baseURI).href; } catch { return ruta; }
}

/** Carga el worklet una vez por contexto. false = no se pudo (sin AudioWorklet, 404, CSP): se usa el ScriptProcessor. */
function cargarWorklet(ctx: AudioContext, url: string): Promise<boolean> {
  let p = contextosConWorklet.get(ctx);
  if (!p) {
    p = (async () => {
      if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
      try { await ctx.audioWorklet.addModule(url); return true; }
      catch { return false; }
    })();
    contextosConWorklet.set(ctx, p);
  }
  return p;
}

/**
 * Del MediaStream de un canal a bloques de 100 ms en PCM16 base64. Se conecta al destino a
 * través de una ganancia 0 (así el navegador lo procesa sin que se oiga dos veces: la voz de
 * la persona ya suena por el elemento `<video>`).
 */
export class CapturaCanal {
  private fuente: MediaStreamAudioSourceNode | null = null;
  private nodo: AudioWorkletNode | ScriptProcessorNode | null = null;
  private silencio: GainNode | null = null;
  private remuestreador: Remuestreador;
  private bloqueador = new Bloqueador();
  private ultimoNivel = 0;
  metodo: 'worklet' | 'script' | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly stream: MediaStream,
    private readonly alBloque: (base64: string) => void,
    private readonly alNivel: (nivel: number) => void,
    private readonly urlWorklet: string = urlWorkletCaptura(),
  ) {
    this.remuestreador = new Remuestreador(ctx.sampleRate);
  }

  async iniciar(): Promise<'worklet' | 'script'> {
    this.fuente = this.ctx.createMediaStreamSource(this.stream);
    this.silencio = this.ctx.createGain();
    this.silencio.gain.value = 0;
    this.silencio.connect(this.ctx.destination);
    const conWorklet = await cargarWorklet(this.ctx, this.urlWorklet);
    // Se detuvo mientras cargaba el worklet (colgó, pausó o cambió de turno): no se arma nada.
    if (!this.fuente || !this.silencio) throw new Error('Captura detenida');
    if (conWorklet) {
      const nodo = new AudioWorkletNode(this.ctx, NOMBRE_WORKLET_CAPTURA, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      nodo.port.onmessage = (ev: MessageEvent<Float32Array>) => this.procesar(ev.data);
      this.nodo = nodo;
      this.metodo = 'worklet';
    } else {
      // Respaldo: deprecado pero universal. Corre en el hilo principal (unas 12 veces por segundo).
      const nodo = this.ctx.createScriptProcessor(4096, 2, 1);
      nodo.onaudioprocess = ev => {
        const b = ev.inputBuffer;
        const canales: Float32Array[] = [];
        for (let c = 0; c < b.numberOfChannels; c++) canales.push(b.getChannelData(c));
        this.procesar(aMono(canales));
      };
      this.nodo = nodo;
      this.metodo = 'script';
    }
    this.fuente.connect(this.nodo);
    this.nodo.connect(this.silencio);
    return this.metodo;
  }

  detener(): void {
    try { this.fuente?.disconnect(); } catch { /* ya */ }
    try { this.nodo?.disconnect(); } catch { /* ya */ }
    try { this.silencio?.disconnect(); } catch { /* ya */ }
    if (this.nodo && 'onaudioprocess' in this.nodo) this.nodo.onaudioprocess = null;
    else if (this.nodo && 'port' in this.nodo) {
      this.nodo.port.onmessage = null;
      // Apaga el procesador: si el contexto sigue abierto (pausa), no queda uno vivo por cada reanudación.
      try { this.nodo.port.postMessage('fin'); } catch { /* ya cerrado */ }
    }
    this.fuente = null;
    this.nodo = null;
    this.silencio = null;
    this.bloqueador.reiniciar();
    this.remuestreador.reiniciar();
    this.alNivel(0);
  }

  private procesar(muestras: Float32Array): void {
    const ahora = Date.now();
    if (ahora - this.ultimoNivel > 80) { this.ultimoNivel = ahora; this.alNivel(nivelVoz(muestras)); }
    for (const b of this.bloqueador.agregar(this.remuestreador.procesar(muestras))) this.alBloque(b);
  }
}

// ── Servicio de la pantalla ──────────────────────────────────────────────────

interface Canal {
  cliente: ClienteStt | null;
  captura: CapturaCanal | null;
  inicioFrase: number | null;
}

/**
 * La transcripción de UNA atención remota. Se provee en la pantalla (no es global): nace y
 * muere con ella, y al destruirse libera micrófono, worklets, contexto de audio, sockets y
 * temporizadores.
 */
@Injectable()
export class TranscripcionEnVivo {
  private api = inject(TurnosService);

  readonly lineas = signal<LineaEnVivo[]>([]);
  readonly parciales = signal<Record<Hablante, Parcial | null>>({ ASESOR: null, PERSONA: null });
  readonly niveles = signal<Record<Hablante, number>>({ ASESOR: 0, PERSONA: 0 });
  readonly canales = signal<Record<Hablante, EstadoDeCanal>>({ ASESOR: { estado: 'apagado', detalle: null }, PERSONA: { estado: 'apagado', detalle: null } });
  readonly pausada = signal(false);
  readonly errorGuardado = signal<string | null>(null);
  readonly metodoCaptura = signal<'worklet' | 'script' | null>(null);
  /** El navegador dejó el audio en pausa (política de reproducción): hace falta un toque en la página. */
  readonly audioBloqueado = signal(false);
  /** Turno que se está transcribiendo (null = apagada). */
  readonly turnoId = signal<string | null>(null);

  /** Estado de conjunto: el peor de los dos canales manda. */
  readonly estado = computed<EstadoTranscripcion>(() => {
    if (!this.turnoId()) return 'apagada';
    if (this.pausada()) return 'pausada';
    const c = this.canales();
    const estados = HABLANTES.map(h => c[h].estado).filter(e => e !== 'apagado');
    if (!estados.length) return 'conectando';
    if (estados.every(e => e === 'error')) return 'error';
    if (estados.some(e => e === 'conectando' || e === 'reconectando')) return 'conectando';
    if (estados.some(e => e === 'transcribiendo')) return 'transcribiendo';
    return estados.includes('error') ? 'error' : 'conectando';
  });
  /** El motivo más útil para mostrar (error o reconexión). */
  readonly motivo = computed<string | null>(() => {
    const c = this.canales();
    const e = HABLANTES.find(h => c[h].estado === 'error');
    if (e) return c[e].detalle;
    const r = HABLANTES.find(h => c[h].estado === 'reconectando' && c[h].detalle);
    return r ? c[r].detalle : null;
  });

  private canal: Record<Hablante, Canal> = { ASESOR: { cliente: null, captura: null, inicioFrase: null }, PERSONA: { cliente: null, captura: null, inicioFrase: null } };
  private ctx: AudioContext | null = null;
  private guardado: GuardadoPorLotes | null = null;
  private t0 = 0;
  private streams: Record<Hablante, MediaStream | null> = { ASESOR: null, PERSONA: null };
  private esperaPista: Record<Hablante, ReturnType<typeof setTimeout> | null> = { ASESOR: null, PERSONA: null };
  private guardadoDe: string | null = null;
  /** Para probar sin audio real. */
  crearSocket: ((url: string) => SocketStt) | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.detener());
  }

  /** Milisegundos desde el inicio de la transcripción de este turno (la línea de tiempo de la conversación). */
  ahoraMs(): number { return Math.max(0, Date.now() - this.t0); }

  /** Lo ya guardado del turno (p. ej. tras recargar la página). Devuelve el análisis para los temas. */
  async cargar(turnoId: string): Promise<TranscripcionTurno | null> {
    try {
      const r = await firstValueFrom(this.api.transcripcionDeTurno(turnoId));
      if (!r) return null;
      this.lineas.update(l => unirLineas(l, r.lineas ?? []));
      // Con frases guardadas la línea de tiempo sigue después de ellas; sin frases, el cero
      // es cuando arranque la transcripción (la llamada), no cuando se tomó el turno.
      if (r.lineas?.length) this.fijarT0(turnoId);
      return r;
    } catch {
      return null;
    }
  }

  /**
   * Arranca los dos canales. `local` es el micrófono del asesor; `remoto` el audio que llega
   * de la persona. Si el remoto aún no trae pista de audio, se espera un poco.
   */
  async iniciar(turnoId: string, local: MediaStream | null, remoto: MediaStream | null): Promise<void> {
    if (this.turnoId() === turnoId && !this.pausada()) return;
    this.detenerCanales();
    this.turnoId.set(turnoId);
    this.pausada.set(false);
    this.fijarT0(turnoId);
    this.streams = { ASESOR: local, PERSONA: remoto };
    if (this.guardado && this.guardadoDe !== turnoId) {
      void this.guardado.terminar();
      this.guardado = null;
    }
    this.guardadoDe = turnoId;
    this.guardado ??= new GuardadoPorLotes({
      enviar: lote => firstValueFrom(this.api.guardarLineasTranscripcion(turnoId, lote)),
      alGuardar: ids => this.lineas.update(ls => ls.map(l => (l.cliente_id && ids.includes(l.cliente_id) ? { ...l, guardada: true } : l))),
      alError: m => this.errorGuardado.set(m),
    });
    await this.abrirCanales();
  }

  pausar(): void {
    if (!this.turnoId() || this.pausada()) return;
    this.pausada.set(true);
    for (const h of HABLANTES) {
      this.canal[h].cliente?.cerrar('pausado');
      this.canal[h].cliente = null;
      this.canal[h].captura?.detener();
      this.canal[h].captura = null;
    }
    void this.guardado?.vaciar();
  }

  async reanudar(): Promise<void> {
    if (!this.turnoId() || !this.pausada()) return;
    this.pausada.set(false);
    await this.abrirCanales();
  }

  /** Reintenta los canales en error (botón "Reintentar"). */
  async reintentar(): Promise<void> {
    if (!this.turnoId()) return;
    this.pausada.set(false);
    this.detenerCanales();
    await this.abrirCanales();
  }

  /** Apaga todo y guarda lo pendiente. Idempotente. */
  detener(): Promise<void> {
    this.detenerCanales();
    this.turnoId.set(null);
    this.pausada.set(false);
    const g = this.guardado;
    this.guardado = null;
    // Lo pendiente se sigue intentando un rato aunque la pantalla ya no exista (idempotente por cliente_id).
    return g ? g.terminar() : Promise.resolve();
  }

  /** Olvida lo del turno anterior (al cambiar de turno). */
  reiniciar(): void {
    void this.detener();
    this.lineas.set([]);
    this.parciales.set({ ASESOR: null, PERSONA: null });
    this.errorGuardado.set(null);
    this.t0 = 0;
  }

  /** Un toque del asesor destraba el audio si el navegador lo había dejado en pausa. */
  async activarAudio(): Promise<void> {
    try { await this.ctx?.resume(); } catch { /* sigue bloqueado */ }
    this.audioBloqueado.set(!!this.ctx && this.ctx.state === 'suspended');
  }

  /** Espera a que lo confirmado quede guardado (antes de pedir temas). */
  async vaciarGuardado(): Promise<void> { await this.guardado?.vaciar(); }

  private async abrirCanales(): Promise<void> {
    const turno = this.turnoId();
    if (!turno) return;
    if (typeof window === 'undefined') return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!this.ctx && Ctor) {
      try { this.ctx = new Ctor(); } catch { this.ctx = null; }
    }
    // Sin un gesto reciente el navegador puede dejar el contexto suspendido y resume() no
    // resuelve nunca: se espera un momento y, si sigue así, se pide un toque (ver activarAudio).
    if (this.ctx && this.ctx.state !== 'running') {
      await Promise.race([this.ctx.resume().catch(() => undefined), new Promise(r => setTimeout(r, 1500))]);
    }
    this.audioBloqueado.set(!!this.ctx && this.ctx.state === 'suspended');
    for (const h of HABLANTES) void this.abrirCanal(h, 0);
  }

  private async abrirCanal(h: Hablante, intento: number): Promise<void> {
    const turno = this.turnoId();
    const stream = this.streams[h];
    if (!turno || this.pausada()) return;
    if (!stream || !stream.getAudioTracks().length) {
      // La pista de la persona llega con la conexión; se espera hasta 20 s antes de avisar.
      this.ponerCanal(h, intento < 20 ? 'conectando' : 'error', intento < 20 ? null : (h === 'PERSONA' ? 'La llamada no trae audio de la persona' : 'No hay micrófono en esta llamada'));
      if (intento < 20) this.esperaPista[h] = setTimeout(() => { this.esperaPista[h] = null; void this.abrirCanal(h, intento + 1); }, 1000);
      return;
    }
    const cliente = new ClienteStt({
      hablante: h,
      pedirToken: () => firstValueFrom(this.api.tokenTranscripcion(turno)),
      crearSocket: this.crearSocket,
      alParcial: texto => this.alParcial(h, texto),
      alConfirmada: texto => this.alConfirmada(h, texto),
      alEstado: (e, d) => this.ponerCanal(h, e, d),
    });
    this.canal[h].cliente = cliente;
    // Cargar el worklet toma un momento: si mientras tanto se colgó, se pausó o se cambió de
    // turno, esta apertura ya no manda (ni abre socket, ni pisa el estado del canal nuevo).
    const vigente = () => this.canal[h].cliente === cliente && this.turnoId() === turno && !this.pausada();
    if (this.ctx) {
      const captura = new CapturaCanal(this.ctx, stream, b => cliente.enviarAudio(b), n => {
        this.niveles.update(v => ({ ...v, [h]: n }));
        if (n >= UMBRAL_DESPERTAR) cliente.despertar();
      });
      this.canal[h].captura = captura;
      try {
        const metodo = await captura.iniciar();
        if (!vigente()) { captura.detener(); return; }
        this.metodoCaptura.set(metodo);
      } catch {
        if (vigente()) this.ponerCanal(h, 'error', 'El navegador no dejó leer el audio de este canal');
        return;
      }
    } else {
      this.ponerCanal(h, 'error', 'Este navegador no permite procesar audio (WebAudio)');
      return;
    }
    if (!vigente()) return;
    await cliente.conectar();
  }

  private detenerCanales(): void {
    for (const h of HABLANTES) {
      const espera = this.esperaPista[h];
      if (espera) { clearTimeout(espera); this.esperaPista[h] = null; }
      this.canal[h].cliente?.cerrar('apagado');
      this.canal[h].cliente = null;
      this.canal[h].captura?.detener();
      this.canal[h].captura = null;
      this.canal[h].inicioFrase = null;
    }
    this.canales.set({ ASESOR: { estado: 'apagado', detalle: null }, PERSONA: { estado: 'apagado', detalle: null } });
    this.niveles.set({ ASESOR: 0, PERSONA: 0 });
    this.audioBloqueado.set(false);
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) { try { void ctx.close(); } catch { /* ya cerrado */ } }
  }

  private alParcial(h: Hablante, texto: string): void {
    const t = texto.trim();
    if (!t) {
      this.parciales.update(p => (p[h] ? { ...p, [h]: null } : p));
      return;
    }
    const c = this.canal[h];
    if (c.inicioFrase === null) c.inicioFrase = Math.max(0, this.ahoraMs() - 600);
    const inicio = c.inicioFrase;
    this.parciales.update(p => ({ ...p, [h]: { texto: t, inicio_ms: inicio } }));
  }

  private alConfirmada(h: Hablante, texto: string): void {
    const c = this.canal[h];
    const fin = this.ahoraMs();
    // Sin parcial previa se estima el inicio por el largo de la frase (~350 ms por palabra).
    const inicio = c.inicioFrase ?? Math.max(0, fin - Math.min(15_000, texto.split(/\s+/).length * 350));
    c.inicioFrase = null;
    const linea: LineaEnVivo = { cliente_id: nuevoClienteId(), id: null, hablante: h, texto, inicio_ms: inicio, fin_ms: fin, guardada: false };
    this.lineas.update(l => [...l, linea].sort((a, b) => a.inicio_ms - b.inicio_ms || (a.fin_ms ?? 0) - (b.fin_ms ?? 0)));
    this.parciales.update(p => ({ ...p, [h]: null }));
    this.guardado?.agregar({ cliente_id: linea.cliente_id!, hablante: h, texto, inicio_ms: inicio, fin_ms: fin });
  }

  private ponerCanal(h: Hablante, estado: EstadoCanal, detalle: string | null): void {
    this.canales.update(c => ({ ...c, [h]: { estado, detalle } }));
  }

  /**
   * Una sola línea de tiempo por turno: si se cuelga y se vuelve a llamar (o se recarga la
   * página), las frases nuevas siguen después de las guardadas en vez de volver a 00:00.
   */
  private fijarT0(turnoId: string): void {
    if (this.t0) return;
    const clave = 'tuapo.turnos.transcripcion.t0.' + turnoId;
    let guardado = 0;
    try { guardado = Number(sessionStorage.getItem(clave) || 0); } catch { /* sin storage */ }
    const ultimo = this.lineas().reduce((m, l) => Math.max(m, l.fin_ms ?? l.inicio_ms), 0);
    this.t0 = guardado && Date.now() - guardado >= ultimo ? guardado : Date.now() - (ultimo ? ultimo + 1500 : 0);
    try { sessionStorage.setItem(clave, String(this.t0)); } catch { /* sin storage */ }
  }
}
