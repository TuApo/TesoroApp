import { Injectable, inject, signal } from '@angular/core';

import { TemporadaService } from '../../core/services/temporada.service';

export type Sonido =
  | 'tap' | 'agregar' | 'quitar' | 'error' | 'abrir' | 'cerrar' | 'navegar'
  | 'monedas' | 'festejo' | 'canje' | 'cofre' | 'nivel' | 'boo'
  | 'enviar' | 'mensaje' | 'pedido'
  | 'tic' | 'giro' | 'cuenta' | 'ya' | 'atrapar' | 'bomba' | 'voltear' | 'acierto' | 'fin';

const CLAVE = 'economiapp.sonido';

/**
 * Sonidos de EconomiAPP, sintetizados en el navegador con Web Audio: no hay archivos que
 * bajar y suenan igual en el celular y en el computador. Cada acción tiene el suyo (tocar,
 * agregar al carrito, quitar, error, monedas al ganar puntos, fanfarria al festejar, campanas
 * al canjear) y en Halloween algunos cambian a una versión más «tenebrosa».
 *
 * <p>Volumen bajo y un botón para silenciar (queda guardado por persona). El contexto de audio
 * se crea con el primer toque: los navegadores no dejan sonar nada antes de un gesto.
 */
@Injectable({ providedIn: 'root' })
export class SonidosService {
  private temporada = inject(TemporadaService);
  private ctx: AudioContext | null = null;
  private maestro: GainNode | null = null;
  private ruido: AudioBuffer | null = null;
  private ultimoTap = 0;

  readonly activo = signal(this.leer());
  /** Sube con cada sonido: la cabecera lo usa para animar el ícono de audio. */
  readonly pulso = signal(0);

  private leer(): boolean {
    try { return localStorage.getItem(CLAVE) !== 'off'; } catch { return true; }
  }

  alternar(): void {
    const si = !this.activo();
    this.activo.set(si);
    try { localStorage.setItem(CLAVE, si ? 'on' : 'off'); } catch { /* opcional */ }
    if (si) this.tocar('abrir');
  }

  private audio(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx() as AudioContext;
      this.maestro = this.ctx.createGain();
      this.maestro.gain.value = 0.32;
      // Un compresor suave evita picos cuando suenan varias cosas a la vez.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 4;
      this.maestro.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  tocar(s: Sonido): void {
    if (!this.activo()) return;
    const ctx = this.audio();
    if (!ctx || !this.maestro) return;
    const t = ctx.currentTime + 0.005;
    const halloween = this.temporada.clave() === 'halloween';
    // El tic de la ruleta suena decenas de veces por segundo: no hace latir el logo.
    if (s !== 'tic') this.pulso.update(n => n + 1);
    switch (s) {
      case 'tap': {
        const ahora = performance.now();
        if (ahora - this.ultimoTap < 70) return; // ráfagas de clics: uno solo
        this.ultimoTap = ahora;
        this.tono(t, 1100, 0.035, 'sine', 0.18, 700);
        break;
      }
      case 'agregar':
        this.tono(t, 520, 0.09, 'triangle', 0.5, 980);
        this.tono(t + 0.07, 1040, 0.12, 'sine', 0.35);
        break;
      case 'quitar':
        this.tono(t, 620, 0.12, 'triangle', 0.4, 300);
        break;
      case 'error':
        this.tono(t, 220, 0.14, 'square', 0.18, 180);
        this.tono(t + 0.16, 170, 0.2, 'square', 0.16, 140);
        break;
      case 'abrir':
        this.soplo(t, 0.18, 600, 2400, 0.22);
        break;
      case 'cerrar':
        this.soplo(t, 0.16, 2200, 500, 0.18);
        break;
      case 'navegar':
        this.soplo(t, 0.12, 900, 1800, 0.08);
        break;
      case 'monedas': {
        const notas = halloween ? [659, 784, 932, 1175] : [988, 1319, 1568, 1976];
        notas.forEach((f, i) => { this.tono(t + i * 0.06, f, 0.16, 'square', 0.12); this.tono(t + i * 0.06, f * 2, 0.08, 'sine', 0.08); });
        break;
      }
      case 'festejo': {
        // Acorde que sube (mayor; en Halloween, menor con un «theremin» encima).
        const acorde = halloween ? [262, 311, 392, 466] : [262, 330, 392, 523];
        acorde.forEach((f, i) => this.tono(t + i * 0.09, f, 0.5, 'sawtooth', 0.09, undefined, 1800));
        acorde.forEach(f => this.tono(t + 0.4, f * 2, 0.6, 'triangle', 0.12));
        if (halloween) this.theremin(t + 0.15, 0.9);
        else this.brillos(t + 0.35, 6);
        break;
      }
      case 'canje':
        [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tono(t + i * 0.07, f, 0.45, 'sine', 0.22));
        this.brillos(t + 0.3, 8);
        break;
      case 'cofre':
        this.soplo(t, 0.25, 300, 1200, 0.2);
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tono(t + 0.2 + i * 0.05, f, 0.3, 'triangle', 0.18));
        break;
      case 'nivel':
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tono(t + i * 0.1, f, 0.3, 'square', 0.12));
        this.brillos(t + 0.5, 10);
        break;
      case 'boo':
        this.theremin(t, 1.1);
        break;
      case 'enviar':
        this.soplo(t, 0.2, 500, 3000, 0.16);
        this.tono(t + 0.05, 660, 0.08, 'sine', 0.14, 990);
        break;
      case 'mensaje':
        this.tono(t, halloween ? 587 : 880, 0.1, 'sine', 0.22);
        this.tono(t + 0.09, halloween ? 698 : 1175, 0.16, 'sine', 0.2);
        break;
      case 'tic':
        this.tono(t, halloween ? 1400 : 1900, 0.025, 'square', 0.07);
        break;
      case 'giro':
        this.soplo(t, 0.6, 300, 2600, 0.2);
        break;
      case 'cuenta':
        this.tono(t, 660, 0.12, 'sine', 0.3);
        break;
      case 'ya':
        this.tono(t, 990, 0.28, 'triangle', 0.35);
        this.tono(t, 1320, 0.2, 'sine', 0.15);
        break;
      case 'atrapar':
        this.tono(t, halloween ? 520 : 700, 0.07, 'triangle', 0.28, halloween ? 880 : 1250);
        break;
      case 'bomba':
        this.soplo(t, 0.35, 900, 120, 0.4);
        this.tono(t, 140, 0.35, 'sawtooth', 0.18, 50, 600);
        break;
      case 'voltear':
        this.soplo(t, 0.08, 1200, 2800, 0.1);
        break;
      case 'acierto':
        this.tono(t, 784, 0.1, 'sine', 0.25);
        this.tono(t + 0.08, 1175, 0.16, 'sine', 0.22);
        break;
      case 'fin':
        [523, 440, 349].forEach((f, i) => this.tono(t + i * 0.14, f, 0.22, 'triangle', 0.2));
        break;
      case 'pedido': {
        // Caja registradora: «clin» agudo, monedas y un acorde que confirma.
        this.tono(t, 2637, 0.25, 'triangle', 0.16);
        this.tono(t + 0.02, 3520, 0.2, 'sine', 0.1);
        [523, 659, 784, 1047].forEach((f, i) => this.tono(t + 0.18 + i * 0.07, f, 0.35, 'triangle', 0.16));
        this.brillos(t + 0.45, 6);
        break;
      }
    }
  }

  // ── piezas de síntesis ──

  /** Un tono con envolvente corta; `hasta` hace un barrido de frecuencia, `corte` un filtro. */
  private tono(t: number, f: number, dur: number, forma: OscillatorType, vol: number, hasta?: number, corte?: number): void {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = forma;
    o.frequency.setValueAtTime(f, t);
    if (hasta) o.frequency.exponentialRampToValueAtTime(Math.max(40, hasta), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let salida: AudioNode = o.connect(g);
    if (corte) { const fil = ctx.createBiquadFilter(); fil.type = 'lowpass'; fil.frequency.value = corte; salida = g.connect(fil); }
    salida.connect(this.maestro!);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Ruido filtrado que barre: el «fiu» de abrir o cerrar una hoja. */
  private soplo(t: number, dur: number, desde: number, hasta: number, vol: number): void {
    const ctx = this.ctx!;
    if (!this.ruido) {
      this.ruido = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
      const d = this.ruido.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource(), fil = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.ruido;
    fil.type = 'bandpass'; fil.Q.value = 1.4;
    fil.frequency.setValueAtTime(desde, t); fil.frequency.exponentialRampToValueAtTime(hasta, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fil).connect(g).connect(this.maestro!);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /** Destellos agudos al azar (premio, nivel). */
  private brillos(t: number, n: number): void {
    for (let i = 0; i < n; i++) this.tono(t + i * 0.045 + Math.random() * 0.03, 2000 + Math.random() * 2600, 0.12, 'sine', 0.07);
  }

  /** Un «theremin» con vibrato: el toque tenebroso de Halloween. */
  private theremin(t: number, dur: number): void {
    const ctx = this.ctx!, o = ctx.createOscillator(), lfo = ctx.createOscillator(), prof = ctx.createGain(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(880, t + dur * 0.45);
    o.frequency.exponentialRampToValueAtTime(330, t + dur);
    lfo.frequency.value = 6.5; prof.gain.value = 18;
    lfo.connect(prof).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.maestro!);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }
}
