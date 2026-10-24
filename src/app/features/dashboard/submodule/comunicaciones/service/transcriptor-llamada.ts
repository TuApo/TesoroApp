import { signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  CapturaCanal, ClienteStt, EstadoCanal, GuardadoPorLotes, UMBRAL_DESPERTAR, nuevoClienteId,
} from '../../turnos/service/transcripcion-en-vivo';
import { LineaTranscripcionIn } from '../../turnos/service/turnos.service';
import { ComunicacionesApiService } from './comunicaciones-api.service';

/** Una frase propia recién confirmada (antes de que el servidor la devuelva con su id). */
export interface FraseLocal { cliente_id: string; texto: string; inicio_ms: number; fin_ms: number }

/**
 * Transcripción EN VIVO del micrófono propio durante una llamada. Cada persona transcribe
 * solo lo suyo (así el hablante se sabe sin adivinar) con el STT en tiempo real de
 * ElevenLabs; el token de un solo uso lo da ms-comunicaciones.
 *
 * Reutiliza las piezas probadas de la Atención remota de Turnos: el cliente WebSocket con
 * reconexión y "sueño" en silencio ({@link ClienteStt}), la captura PCM con AudioWorklet
 * ({@link CapturaCanal}) y el guardado por lotes idempotente ({@link GuardadoPorLotes}).
 */
export class TranscriptorLlamada {
  readonly parcial = signal('');
  readonly estado = signal<EstadoCanal>('apagado');
  readonly detalle = signal<string | null>(null);

  private ctx: AudioContext | null = null;
  private cliente: ClienteStt | null = null;
  private captura: CapturaCanal | null = null;
  private inicioFrase: number | null = null;
  private readonly guardado: GuardadoPorLotes;

  constructor(
    private readonly api: ComunicacionesApiService,
    private readonly llamadaId: string,
    /** Milisegundos de la llamada (reloj del servidor): la línea de tiempo de todos. */
    private readonly ahoraMs: () => number,
    private readonly alFrase: (f: FraseLocal) => void,
  ) {
    this.guardado = new GuardadoPorLotes({
      // El lote es el de Turnos (lleva "hablante"); aquí el hablante es quien envía.
      enviar: lote => firstValueFrom(this.api.guardarLineasVivo(this.llamadaId,
        lote.map(l => ({ cliente_id: l.cliente_id, texto: l.texto, inicio_ms: l.inicio_ms, fin_ms: l.fin_ms })))),
      alError: m => { if (m) this.detalle.set(m); },
      esperaMs: 1500,
    });
  }

  /** Empieza a transcribir esta pista de micrófono. */
  async iniciar(pista: MediaStreamTrack): Promise<void> {
    if (typeof window === 'undefined') return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) { this.estado.set('error'); this.detalle.set('Este navegador no permite procesar audio'); return; }
    this.ctx ??= new Ctor();
    if (this.ctx.state !== 'running') {
      await Promise.race([this.ctx.resume().catch(() => undefined), new Promise(r => setTimeout(r, 1500))]);
    }
    this.cliente ??= new ClienteStt({
      hablante: 'ASESOR',
      pedirToken: () => firstValueFrom(this.api.tokenEnVivo(this.llamadaId)),
      alParcial: t => this.alParcial(t),
      alConfirmada: t => this.alConfirmada(t),
      alEstado: (e, d) => { this.estado.set(e); this.detalle.set(d); },
    });
    await this.conectarCaptura(pista);
    if (this.cliente.estado === 'apagado' || this.cliente.estado === 'pausado') await this.cliente.conectar();
  }

  /** Cambió el micrófono: la transcripción sigue con el nuevo sin cortar la sesión. */
  async cambiarPista(pista: MediaStreamTrack): Promise<void> {
    if (!this.cliente || !this.ctx) return;
    await this.conectarCaptura(pista);
  }

  /** Cierra la frase en curso, apaga todo y manda lo pendiente (sigue intentando un rato). */
  detener(): Promise<void> {
    this.cliente?.cerrar('apagado');
    this.cliente = null;
    this.captura?.detener();
    this.captura = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) { try { void ctx.close(); } catch { /* ya cerrado */ } }
    this.parcial.set('');
    return this.guardado.terminar(60_000);
  }

  private async conectarCaptura(pista: MediaStreamTrack): Promise<void> {
    this.captura?.detener();
    const cliente = this.cliente!;
    const captura = new CapturaCanal(this.ctx!, new MediaStream([pista]), b => cliente.enviarAudio(b), n => {
      if (n >= UMBRAL_DESPERTAR) cliente.despertar();
    });
    this.captura = captura;
    try {
      await captura.iniciar();
    } catch {
      if (this.captura === captura) { this.estado.set('error'); this.detalle.set('El navegador no dejó leer el micrófono para transcribir'); }
    }
  }

  private alParcial(texto: string): void {
    const t = texto.trim();
    if (!t) { this.parcial.set(''); return; }
    if (this.inicioFrase === null) this.inicioFrase = Math.max(0, this.ahoraMs() - 600);
    this.parcial.set(t);
  }

  private alConfirmada(texto: string): void {
    const fin = this.ahoraMs();
    // Sin parcial previa se estima el inicio por el largo de la frase (~350 ms por palabra).
    const inicio = this.inicioFrase ?? Math.max(0, fin - Math.min(15_000, texto.split(/\s+/).length * 350));
    this.inicioFrase = null;
    this.parcial.set('');
    const f: FraseLocal = { cliente_id: nuevoClienteId(), texto, inicio_ms: Math.round(inicio), fin_ms: Math.round(fin) };
    this.alFrase(f);
    const lote: LineaTranscripcionIn = { cliente_id: f.cliente_id, hablante: 'ASESOR', texto, inicio_ms: f.inicio_ms, fin_ms: f.fin_ms };
    this.guardado.agregar(lote);
  }
}
