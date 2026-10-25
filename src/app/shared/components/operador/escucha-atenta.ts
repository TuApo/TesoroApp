import { signal } from '@angular/core';

/** Reconocedor de voz del navegador (Chrome/Edge: webkitSpeechRecognition). */
interface ReconocedorAtento {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface OpcionesEscucha {
  /** Clase del reconocedor del navegador; null = solo detector de voz por nivel (APK). */
  Clase: (new () => ReconocedorAtento) | null;
  /** Lo que el asistente está diciendo AHORA (para no confundir su eco con la persona). */
  dicho: () => string;
  /** Nivel (0..1) de la voz del asistente: la persona solo «gana» en los valles. */
  nivelAsistente: () => number;
  /** La persona empezó a hablar: hay que callar al asistente ya. */
  alInterrumpir: () => void;
  /** Texto provisional de lo que dice la persona tras interrumpir. */
  alParcial: (t: string) => void;
  /** Lo que dijo la persona (con reconocedor) o '' si solo hubo voz detectada (sin reconocedor). */
  alTerminar: (t: string) => void;
}

/** Palabras sin tildes ni signos, para comparar lo oído con lo que dice el asistente. */
export function palabras(t: string): string[] {
  return (t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
}

/**
 * ¿Lo oído es la persona y no el eco del asistente? Al menos 2 palabras, y menos del 60 % de
 * ellas aparecen en lo que el asistente está diciendo (el eco repite sus propias palabras).
 */
export function esInterrupcion(oido: string, dicho: string): boolean {
  const o = palabras(oido);
  if (o.length < 2) return false;
  const d = new Set(palabras(dicho));
  if (!d.size) return true;
  const comunes = o.filter(w => d.has(w)).length;
  return comunes / o.length < 0.6;
}

/** Nivel del micrófono por encima del cual hay voz (RMS normalizado 0..1) y cuánto debe durar. */
const UMBRAL_VOZ = 0.09;
const UMBRAL_VOZ_CON_RECONOCEDOR = 0.16;
const DURACION_VOZ_MS = 250;
const DURACION_VOZ_CON_RECONOCEDOR_MS = 380;
/** Tras interrumpir: silencio que da por terminada la frase de la persona. */
const SILENCIO_FIN_MS = 1100;

/**
 * Escucha a la persona MIENTRAS el asistente habla (sensación de conversación full-duplex): si
 * la persona lo interrumpe, se calla al asistente y lo que diga pasa a ser el siguiente mensaje.
 *
 * El micrófono se abre con cancelación de eco, supresión de ruido y control de ganancia: así el
 * reconocedor oye a la persona y casi nada del parlante. Para no dispararse con lo que quede del
 * eco hay dos señales:
 *   1. el reconocedor (si existe) entrega ≥ 2 palabras que NO son las que el asistente está diciendo;
 *   2. el nivel del micrófono pasa un umbral de forma sostenida mientras la voz del asistente está
 *      en un valle (con reconocedor el umbral es más alto: solo cubre a quien habla muy fuerte).
 * Sin reconocedor (WebView del APK) solo vale la segunda, y lo que diga la persona lo graba quien
 * llama con la nota de voz de siempre.
 */
export class EscuchaAtenta {
  /** Escuchando mientras el asistente habla (para el indicador de la cápsula). */
  readonly activa = signal(false);
  /** La persona interrumpió y ahora se le está escuchando a ella. */
  readonly interrumpida = signal(false);
  readonly nivel = signal(0);

  private o: OpcionesEscucha | null = null;
  private rec: ReconocedorAtento | null = null;
  private flujo: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private cuadro = 0;
  private sobreDesde = 0;
  /** Índice del primer resultado que es de la persona (lo anterior pudo ser eco). */
  private inicio = -1;
  private texto = '';
  private relojSilencio: ReturnType<typeof setTimeout> | null = null;
  private terminado = false;

  get disponible(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  async iniciar(o: OpcionesEscucha): Promise<void> {
    if (this.activa() || !this.disponible) return;
    this.detener();
    this.o = o;
    this.terminado = false;
    this.interrumpida.set(false);
    this.inicio = -1;
    this.texto = '';
    this.activa.set(true);
    try {
      this.flujo = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!this.activa()) { this.soltarMicrofono(); return; } // la detuvieron mientras pedía permiso
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        this.ctx = new Ctx();
        if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => undefined);
        const an = this.ctx.createAnalyser();
        an.fftSize = 512;
        this.ctx.createMediaStreamSource(this.flujo).connect(an);
        const datos = new Uint8Array(an.fftSize);
        const leer = () => {
          an.getByteTimeDomainData(datos);
          let suma = 0;
          for (const v of datos) suma += (v - 128) * (v - 128);
          const rms = Math.min(1, Math.sqrt(suma / datos.length) / 64);
          this.nivel.set(rms);
          this.vigilarNivel(rms);
          this.cuadro = requestAnimationFrame(leer);
        };
        leer();
      }
    } catch {
      // Sin micrófono aparte: con reconocedor igual se puede intentar; sin él no hay interrupción.
      this.soltarMicrofono();
      if (!o.Clase) { this.detener(); return; }
    }
    if (o.Clase) this.arrancarReconocedor(o.Clase);
  }

  /** Lo para todo sin entregar nada (se cerró la ventana, se apagó manos libres…). */
  detener(): void {
    this.terminado = true;
    if (this.relojSilencio) { clearTimeout(this.relojSilencio); this.relojSilencio = null; }
    const r = this.rec;
    this.rec = null;
    if (r) { r.onend = null; r.onresult = null; r.onerror = null; try { r.abort(); } catch { /* nada */ } }
    this.soltarMicrofono();
    this.activa.set(false);
    this.interrumpida.set(false);
    this.o = null;
  }

  private soltarMicrofono(): void {
    if (this.cuadro) cancelAnimationFrame(this.cuadro);
    this.cuadro = 0;
    this.flujo?.getTracks().forEach(t => t.stop());
    this.flujo = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.nivel.set(0);
    this.sobreDesde = 0;
  }

  private vigilarNivel(rms: number): void {
    const o = this.o;
    if (!o || this.interrumpida()) return;
    const conRec = !!this.rec;
    const umbral = conRec ? UMBRAL_VOZ_CON_RECONOCEDOR : UMBRAL_VOZ;
    const duracion = conRec ? DURACION_VOZ_CON_RECONOCEDOR_MS : DURACION_VOZ_MS;
    // La persona solo cuenta en los valles de la voz del asistente (el eco sigue sus picos).
    const valle = o.nivelAsistente() < 0.35;
    if (rms > umbral && valle) {
      if (!this.sobreDesde) this.sobreDesde = performance.now();
      else if (performance.now() - this.sobreDesde > duracion) this.interrumpir(-1);
    } else if (rms < umbral * 0.6) {
      this.sobreDesde = 0;
    }
  }

  private arrancarReconocedor(Clase: new () => ReconocedorAtento): void {
    const rec = new Clase();
    rec.lang = 'es-CO';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onresult = e => {
      const o = this.o;
      if (!o) return;
      if (!this.interrumpida()) {
        // ¿Alguno de los resultados nuevos es la persona?
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (esInterrupcion(e.results[i][0].transcript, o.dicho())) { this.interrumpir(i); break; }
        }
        if (!this.interrumpida()) return;
      }
      if (this.inicio < 0) this.inicio = e.resultIndex;
      let t = '';
      for (let i = Math.max(this.inicio, 0); i < e.results.length; i++) t += e.results[i][0].transcript + ' ';
      this.texto = t.replace(/\s+/g, ' ').trim();
      o.alParcial(this.texto);
      // Una pausa larga después de hablar cierra la frase.
      if (this.relojSilencio) clearTimeout(this.relojSilencio);
      this.relojSilencio = setTimeout(() => this.terminar(), SILENCIO_FIN_MS);
    };
    rec.onerror = () => { /* onend decide */ };
    rec.onend = () => {
      if (this.terminado) return;
      if (this.interrumpida()) { this.terminar(); return; }
      // Chrome corta el reconocimiento continuo de vez en cuando: si el asistente sigue hablando, se reanuda.
      if (this.activa()) { try { rec.start(); } catch { this.rec = null; } }
    };
    try {
      rec.start();
      this.rec = rec;
    } catch {
      this.rec = null;
    }
  }

  private interrumpir(indice: number): void {
    const o = this.o;
    if (!o || this.interrumpida()) return;
    this.interrumpida.set(true);
    this.inicio = indice;
    o.alInterrumpir();
    o.alParcial('');
    if (!this.rec) {
      // Sin reconocedor: solo se avisa; quien llama graba la nota de voz con su micrófono.
      this.terminar();
      return;
    }
    // Si la persona no dice nada entendible, se cierra igual a los pocos segundos.
    if (this.relojSilencio) clearTimeout(this.relojSilencio);
    this.relojSilencio = setTimeout(() => this.terminar(), 4000);
  }

  private terminar(): void {
    if (this.terminado) return;
    const o = this.o;
    const t = this.texto;
    this.detener();
    o?.alTerminar(t);
  }
}
