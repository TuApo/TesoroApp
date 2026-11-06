import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';

import { AlertaEvento, Plano } from '../models/salon.models';
import { SALON_TOKEN_JWT } from './salon-api.token';
import { SalonService } from './salon.service';

export type EstadoCanal = 'inactivo' | 'conectando' | 'conectado' | 'reconectando' | 'sondeo';

/** Tras estos intentos seguidos de SSE sin éxito se pasa a sondear `/plano` cada 15 s. */
const INTENTOS_ANTES_DE_SONDEAR = 2;
const SONDEO_MS = 15_000;

/**
 * Canal en vivo del plano (`GET /tiendas/{id}/stream`, SSE con eventos `plano` y `alerta`).
 *
 * <p>Copia adaptada de `turnos/service/sse.util.ts` (no se importa: el submódulo debe poder
 * mudarse a otra app). Va sobre `fetch` y no sobre `EventSource` porque este no admite
 * cabeceras y el JWT viaja en `Authorization`; meterlo en la URL lo dejaría en el historial
 * y en los logs de Caddy/gateway.
 *
 * <p>Reconexión exponencial hasta 30 s. Si el canal no levanta tras dos intentos seguidos
 * (gateway sin SSE, proxy que lo corta…), se cae a sondear `/plano` cada 15 s y se sigue
 * intentando el SSE por detrás; en cuanto conecta, el sondeo se apaga.
 *
 * <p>Varias pantallas pueden `usar()` el canal a la vez (plano + anfitrión en otra pestaña del
 * navegador no, pero sí dos componentes de la misma): se abre con la primera y se cierra
 * con la última.
 */
@Injectable({ providedIn: 'root' })
export class SalonStreamService implements OnDestroy {
  private api = inject(SalonService);
  private token = inject(SALON_TOKEN_JWT);

  readonly plano = signal<Plano | null>(null);
  readonly estado = signal<EstadoCanal>('inactivo');
  /** Momento (ms) en que llegó el último plano: los cronómetros avanzan desde aquí. */
  readonly recibidoEn = signal(Date.now());
  /** Reloj de 1 s para los cronómetros de las tarjetas. */
  readonly ahora = signal(Date.now());
  /** Eventos `alerta` tal cual llegan (para los toasts). */
  readonly alerta$ = new Subject<AlertaEvento>();

  private tiendaId: string | null = null;
  private usos = 0;
  private cerrado = true;
  private controlador: AbortController | null = null;
  private intento = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private sondeoId: ReturnType<typeof setInterval> | null = null;
  private relojId: ReturnType<typeof setInterval> | null = null;

  usar(tiendaId: string): void {
    if (this.tiendaId !== tiendaId) {
      this.detener();
      this.tiendaId = tiendaId;
      this.plano.set(null);
    }
    this.usos++;
    if (this.cerrado) this.arrancar();
  }

  soltar(): void {
    this.usos = Math.max(0, this.usos - 1);
    if (this.usos === 0) this.detener();
  }

  /** Pide el plano por HTTP una vez (tras una acción, para no esperar al siguiente evento). */
  refrescar(): void {
    if (!this.tiendaId) return;
    this.api.plano(this.tiendaId).subscribe({ next: p => this.recibirPlano(p), error: () => { /* el canal lo traerá */ } });
  }

  ngOnDestroy(): void { this.detener(); }

  // ── interno ──────────────────────────────────────────────────────────────
  private arrancar(): void {
    this.cerrado = false;
    this.intento = 0;
    this.relojId = setInterval(() => this.ahora.set(Date.now()), 1000);
    this.refrescar();
    this.abrir();
  }

  private detener(): void {
    this.cerrado = true;
    if (this.temporizador) { clearTimeout(this.temporizador); this.temporizador = null; }
    if (this.relojId) { clearInterval(this.relojId); this.relojId = null; }
    this.pararSondeo();
    try { this.controlador?.abort(); } catch { /* ya cerrado */ }
    this.controlador = null;
    this.estado.set('inactivo');
  }

  private recibirPlano(p: Plano): void {
    this.plano.set(p);
    this.recibidoEn.set(Date.now());
  }

  private programarReconexion(): void {
    if (this.cerrado) return;
    this.intento++;
    if (this.intento >= INTENTOS_ANTES_DE_SONDEAR) this.iniciarSondeo();
    const espera = Math.min(30_000, 1_000 * Math.pow(2, Math.min(this.intento, 5)));
    this.estado.set(this.sondeoId ? 'sondeo' : 'reconectando');
    this.temporizador = setTimeout(() => this.abrir(), espera);
  }

  private iniciarSondeo(): void {
    if (this.sondeoId) return;
    this.sondeoId = setInterval(() => this.refrescar(), SONDEO_MS);
  }
  private pararSondeo(): void {
    if (this.sondeoId) { clearInterval(this.sondeoId); this.sondeoId = null; }
  }

  private procesarBloque(bloque: string): void {
    let nombre = 'message';
    const datos: string[] = [];
    for (const linea of bloque.split(/\r?\n/)) {
      if (!linea || linea.startsWith(':')) continue; // comentario / latido
      const idx = linea.indexOf(':');
      const campo = idx < 0 ? linea : linea.slice(0, idx);
      const valor = idx < 0 ? '' : linea.slice(idx + 1).replace(/^ /, '');
      if (campo === 'event') nombre = valor;
      else if (campo === 'data') datos.push(valor);
    }
    if (!datos.length) return;
    let parseado: unknown;
    try { parseado = JSON.parse(datos.join('\n')); } catch { return; }
    if (nombre === 'plano') this.recibirPlano(parseado as Plano);
    else if (nombre === 'alerta') this.alerta$.next(parseado as AlertaEvento);
  }

  private async abrir(): Promise<void> {
    if (this.cerrado || !this.tiendaId) return;
    this.controlador = new AbortController();
    if (!this.sondeoId) this.estado.set(this.intento === 0 ? 'conectando' : 'reconectando');
    try {
      // El token se pide en cada (re)conexión: el canal vive más que el access token.
      const jwt = await this.token();
      const cabeceras: Record<string, string> = { Accept: 'text/event-stream' };
      if (jwt) cabeceras['Authorization'] = `Bearer ${jwt}`;
      const respuesta = await fetch(this.api.urlStream(this.tiendaId), {
        headers: cabeceras, signal: this.controlador.signal, cache: 'no-store',
      });
      if (!respuesta.ok || !respuesta.body) throw new Error(`SSE ${respuesta.status}`);
      this.intento = 0;
      this.pararSondeo();
      this.estado.set('conectado');
      const lector = respuesta.body.getReader();
      const decodificador = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        buffer += decodificador.decode(value, { stream: true });
        let corte: number;
        while ((corte = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const bloque = buffer.slice(0, corte);
          buffer = buffer.slice(corte).replace(/^\r?\n\r?\n/, '');
          this.procesarBloque(bloque);
        }
      }
      // El servidor cerró (timeout normal del emisor): se reabre enseguida.
      if (!this.cerrado) { this.intento = 0; this.programarReconexion(); }
    } catch {
      if (this.cerrado) return;
      this.programarReconexion();
    }
  }
}
