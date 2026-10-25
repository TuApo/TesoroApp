import { signal } from '@angular/core';

/**
 * Voz del chat de IA: grabar notas de voz y reproducir las respuestas. Sale del chat de MatIA
 * (EconomiAPP) y suma un medidor de nivel, que es lo que mueve la boca del robot mientras habla.
 * La usan el chat estándar y MatIA (que la importa directo, sin el resto del chat).
 */

const CANDIDATOS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
export const MAX_SEGUNDOS_NOTA = 180;

export class GrabadoraVoz {
  readonly grabando = signal(false);
  readonly segundos = signal(0);
  /** Nivel del micrófono (0..1) para la onda mientras graba. */
  readonly nivel = signal(0);

  private grabadora: MediaRecorder | null = null;
  private trozos: Blob[] = [];
  private reloj: ReturnType<typeof setInterval> | null = null;
  private cancelada = false;
  private ctx: AudioContext | null = null;
  private cuadro = 0;

  /** @param maxSegundos tope de la nota (MatIA usa 120). */
  constructor(private readonly maxSegundos = MAX_SEGUNDOS_NOTA) {}

  static soportada(): boolean {
    return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }

  /**
   * Empieza a grabar. Devuelve {fin}: la promesa del audio al detener (null si se canceló).
   * Va dentro de un objeto porque `await` aplanaría una promesa de promesa.
   */
  async iniciar(): Promise<{ fin: Promise<Blob | null> }> {
    const flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const tipo = CANDIDATOS.find(t => MediaRecorder.isTypeSupported?.(t)) ?? '';
    let g: MediaRecorder;
    try {
      g = new MediaRecorder(flujo, tipo ? { mimeType: tipo } : undefined);
    } catch (e) {
      flujo.getTracks().forEach(t => t.stop()); // sin esto el micrófono queda encendido
      throw e;
    }
    this.grabadora = g;
    this.trozos = [];
    this.cancelada = false;
    this.medir(flujo);
    const fin = new Promise<Blob | null>(resolver => {
      g.ondataavailable = e => { if (e.data.size) this.trozos.push(e.data); };
      g.onstop = () => {
        flujo.getTracks().forEach(t => t.stop());
        this.soltarMedidor();
        resolver(this.cancelada ? null : new Blob(this.trozos, { type: g.mimeType || tipo || 'audio/webm' }));
        this.grabadora = null;
      };
    });
    g.start(250);
    this.grabando.set(true);
    this.segundos.set(0);
    this.reloj = setInterval(() => {
      this.segundos.update(s => s + 1);
      if (this.segundos() >= this.maxSegundos) this.detener(false);
    }, 1000);
    return { fin };
  }

  detener(cancelar: boolean): void {
    if (this.reloj) { clearInterval(this.reloj); this.reloj = null; }
    this.cancelada = cancelar;
    if (this.grabadora && this.grabadora.state !== 'inactive') this.grabadora.stop();
    this.grabando.set(false);
  }

  private medir(flujo: MediaStream): void {
    try {
      this.ctx = new AudioContext();
      const analizador = this.ctx.createAnalyser();
      analizador.fftSize = 256;
      this.ctx.createMediaStreamSource(flujo).connect(analizador);
      const datos = new Uint8Array(analizador.frequencyBinCount);
      const paso = () => {
        analizador.getByteTimeDomainData(datos);
        let max = 0;
        for (const v of datos) max = Math.max(max, Math.abs(v - 128));
        this.nivel.set(Math.min(1, max / 64));
        this.cuadro = requestAnimationFrame(paso);
      };
      paso();
    } catch { /* sin medidor: la grabación sigue */ }
  }

  private soltarMedidor(): void {
    cancelAnimationFrame(this.cuadro);
    this.nivel.set(0);
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

/** Reproduce la voz de las respuestas y expone el nivel para animar al robot. */
export class ReproductorVoz {
  /** id del mensaje que suena (o null). */
  readonly sonando = signal<number | null>(null);
  readonly nivel = signal(0);

  private audio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private cuadro = 0;
  private sintesis = false;

  async reproducir(id: number, url: string): Promise<void> {
    this.callar();
    const a = new Audio(url);
    this.audio = a;
    a.onended = () => this.terminar();
    a.onerror = () => this.terminar();
    this.sonando.set(id);
    try {
      const ctx = new AudioContext();
      // Sin un toque reciente (lectura automática tras esperar la respuesta) el contexto puede nacer
      // suspendido, sobre todo en iPhone; pasar el audio por él lo dejaría mudo sin error.
      if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
      if (this.audio !== a) { ctx.close().catch(() => undefined); return; } // la callaron mientras tanto
      if (ctx.state !== 'running') { ctx.close().catch(() => undefined); throw new Error('contexto suspendido'); }
      this.ctx = ctx;
      const analizador = this.ctx.createAnalyser();
      analizador.fftSize = 512;
      const fuente = this.ctx.createMediaElementSource(a);
      fuente.connect(analizador);
      analizador.connect(this.ctx.destination);
      const datos = new Uint8Array(analizador.frequencyBinCount);
      const paso = () => {
        analizador.getByteTimeDomainData(datos);
        let suma = 0;
        for (const v of datos) suma += (v - 128) * (v - 128);
        this.nivel.set(Math.min(1, Math.sqrt(suma / datos.length) / 28));
        this.cuadro = requestAnimationFrame(paso);
      };
      paso();
    } catch { /* sin medidor: suena igual */ }
    await a.play();
  }

  /** Respaldo sin servidor: la voz del propio navegador (sin medidor real: la boca se mueve a ritmo fijo). */
  leerConNavegador(id: number, texto: string): boolean {
    const sy = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!sy) return false;
    this.callar();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-CO';
    const v = sy.getVoices().find(x => x.lang?.toLowerCase().startsWith('es-co')) ?? sy.getVoices().find(x => x.lang?.toLowerCase().startsWith('es'));
    if (v) u.voice = v;
    u.onend = () => this.terminar();
    u.onerror = () => this.terminar();
    this.sintesis = true;
    this.sonando.set(id);
    let t = 0;
    const paso = () => { t += 0.18; this.nivel.set(0.35 + 0.3 * Math.abs(Math.sin(t * 3))); this.cuadro = requestAnimationFrame(paso); };
    paso();
    sy.speak(u);
    return true;
  }

  callar(): void {
    if (this.audio) { this.audio.pause(); this.audio = null; }
    if (this.sintesis) { try { window.speechSynthesis?.cancel(); } catch { /* nada */ } this.sintesis = false; }
    this.terminar();
  }

  private terminar(): void {
    cancelAnimationFrame(this.cuadro);
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.nivel.set(0);
    this.sonando.set(null);
  }
}

/** Lo que se lee en voz alta: sin tablas, gráficas ni marcas de formato. */
export function textoParaVoz(t: string): string {
  return (t || '')
    .replace(/\[\[[a-z0-9._-]{1,40}\]\]\s*/g, '')
    .replace(/```echarts[\s\S]*?```/g, ' (Le dejé una gráfica en el chat.) ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, '§T§')
    .replace(/(§T§\s*)+/g, '(Le dejé una tabla en el chat.)\n')
    .replace(/^#+\s*/gm, '').replace(/\*\*?|__|`/g, '').replace(/^\s*[-•*]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\n{2,}/g, '\n').trim();
}
