import { Injectable, computed, inject, signal } from '@angular/core';

import { ConexionSse, conectarSse, tokenActual } from '../../turnos/service/sse.util';
import { Evento, Snapshot } from '../models/infra.models';
import { InfraService } from './infra.service';

export type EstadoCanal = 'conectando' | 'conectado' | 'reconectando' | 'cerrado';

/**
 * El canal en vivo del módulo: UNA conexión SSE compartida por todas las pestañas.
 * La abre el shell al entrar al módulo y la cierra al salir; las pestañas solo leen
 * las señales. Cada 5 s llega la foto completa ("snapshot") y cada evento al instante.
 *
 * Además guarda una historia corta de la foto (últimos ~10 min) para las líneas de
 * pulso de la cabecera sin pedirle nada más al servidor.
 */
@Injectable({ providedIn: 'root' })
export class InfraVivoService {
  private readonly api = inject(InfraService);
  private conexion: ConexionSse | null = null;
  private usuarios = 0;

  readonly snapshot = signal<Snapshot | null>(null);
  readonly canal = signal<EstadoCanal>('cerrado');
  readonly sinPermiso = signal(false);
  /** Eventos llegados en vivo durante esta sesión (los más nuevos primero). */
  readonly eventosVivos = signal<Evento[]>([]);
  /** Historia corta para el pulso: ts + cpu/mem/req/s/red. */
  readonly pulso = signal<{ ts: number; cpu: number; mem: number; req: number; rx: number; tx: number }[]>([]);

  readonly eventos = computed(() => {
    const vivos = this.eventosVivos();
    const ids = new Set(vivos.map((e) => e.id));
    const delServidor = (this.snapshot()?.eventos ?? []).filter((e) => !ids.has(e.id));
    return [...vivos, ...delServidor].sort((a, b) => b.ts - a.ts).slice(0, 200);
  });

  /** Segundos desde la última foto (para avisar si el canal se quedó quieto). */
  readonly antiguedad = signal(0);
  private reloj: ReturnType<typeof setInterval> | null = null;

  /** El shell llama a esto al montarse; cada pestaña no necesita hacerlo. */
  abrir(): void {
    this.usuarios++;
    if (this.conexion) return;
    const token = tokenActual();
    if (!token) return;
    // Primera foto por HTTP: la pantalla no espera al SSE, y un 403 se distingue claro.
    this.api.snapshot().subscribe({
      next: (s) => this.recibir(s),
      error: (e) => { if (e?.status === 403) this.sinPermiso.set(true); },
    });
    this.conexion = conectarSse(this.api.urlStream(), {
      token,
      onEstado: (e) => this.canal.set(e),
      onEvento: (nombre, datos) => {
        if (nombre === 'snapshot' && datos && typeof datos === 'object') {
          this.recibir(datos as Snapshot);
        } else if (nombre === 'evento' && datos && typeof datos === 'object') {
          const ev = datos as Evento;
          this.eventosVivos.update((l) => [ev, ...l.filter((x) => x.id !== ev.id)].slice(0, 200));
        }
      },
    });
    this.reloj = setInterval(() => {
      const s = this.snapshot();
      this.antiguedad.set(s ? Math.max(0, Math.round((Date.now() - s.ts) / 1000)) : 0);
    }, 1000);
  }

  cerrar(): void {
    this.usuarios = Math.max(0, this.usuarios - 1);
    if (this.usuarios > 0) return;
    this.conexion?.cerrar();
    this.conexion = null;
    if (this.reloj) clearInterval(this.reloj);
    this.reloj = null;
    this.canal.set('cerrado');
  }

  private recibir(s: Snapshot): void {
    this.snapshot.set(s);
    this.sinPermiso.set(false);
    const k = s.kpis;
    this.pulso.update((l) => {
      const ultimo = l[l.length - 1];
      if (ultimo && ultimo.ts === s.ts) return l;
      const nuevo = [...l, {
        ts: s.ts, cpu: k.cpu_pct ?? 0, mem: k.mem_pct ?? 0, req: k.req_s ?? 0,
        rx: k.red_rx_bps ?? 0, tx: k.red_tx_bps ?? 0,
      }];
      return nuevo.slice(-120);
    });
  }
}
