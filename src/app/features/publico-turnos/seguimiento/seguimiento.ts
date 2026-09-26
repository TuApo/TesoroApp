import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { Turno, TurnosService } from '../../dashboard/submodule/turnos/service/turnos.service';
import { conectarSse, ConexionSse } from '../../dashboard/submodule/turnos/service/sse.util';

/**
 * Seguir el turno desde el celular: cuántos hay delante y, cuando lo llamen, a dónde ir.
 * Se mantiene al día por SSE y, por si el canal se cae, vuelve a preguntar cada 30 s.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-seguimiento-turno',
  imports: [CommonModule, MatIconModule],
  templateUrl: './seguimiento.html',
  styleUrl: './seguimiento.css',
})
export class SeguimientoTurno implements OnInit {
  readonly turnoId = input.required<string>();
  private api = inject(TurnosService);
  private destroyRef = inject(DestroyRef);

  readonly turno = signal<Turno | null>(null);
  readonly error = signal<string | null>(null);
  readonly vibro = signal(false);
  private conexion: ConexionSse | null = null;

  readonly agendado = computed(() => this.turno()?.estado === 'AGENDADO');
  readonly esperando = computed(() => this.turno()?.estado === 'EN_ESPERA');
  readonly anunciando = signal(false);
  readonly llamado = computed(() => this.turno()?.estado === 'LLAMADO');
  readonly enAtencion = computed(() => this.turno()?.estado === 'EN_ATENCION');
  readonly terminado = computed(() => { const e = this.turno()?.estado; return !!e && !['EN_ESPERA', 'LLAMADO', 'EN_ATENCION'].includes(e); });

  ngOnInit(): void {
    this.cargar();
    const sondeo = setInterval(() => this.cargar(), 30_000);
    this.destroyRef.onDestroy(() => { clearInterval(sondeo); this.conexion?.cerrar(); });
  }

  private cargar(): void {
    this.api.publicoSeguimiento(this.turnoId()).subscribe({
      next: t => { this.turno.set(t); this.error.set(null); this.conectar(); },
      error: e => this.error.set(e?.status === 404 ? 'Este turno no existe.' : 'Sin conexión. Reintentando…'),
    });
  }

  private conectar(): void {
    if (this.conexion) return;
    this.conexion = conectarSse(this.api.urlEventosTurno(this.turnoId()), {
      token: null,
      onEvento: (nombre, datos) => {
        const t = datos as Turno;
        if (!nombre.startsWith('turno-')) return;
        if (t?.id === this.turnoId()) {
          // Los eventos de sala vienen recortados (sin documento): se conserva lo que ya se tenía.
          this.turno.update(v => (v ? { ...v, ...t, documento: v.documento, delante: t.estado === 'EN_ESPERA' ? v.delante : null } : t));
          if (nombre === 'turno-llamado') this.avisar();
        } else if (nombre === 'turno-llamado' || nombre === 'turno-cerrado' || nombre === 'turno-creado') {
          // Alguien delante avanzó: se recalcula la posición.
          this.api.publicoSeguimiento(this.turnoId()).subscribe({ next: v => this.turno.set(v), error: () => {} });
        }
      },
    });
  }

  private avisar(): void {
    try { navigator.vibrate?.([300, 120, 300]); } catch { /* sin vibración */ }
    this.vibro.set(true);
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.15; o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.4);
    } catch { /* sin audio */ }
  }

  /** "Ya llegué": la cita entra a la cola (solo dentro de su ventana; el servidor lo dice si no). */
  llegue(): void {
    this.anunciando.set(true);
    this.api.publicoLlegue(this.turnoId()).subscribe({
      next: t => { this.turno.set(t); this.anunciando.set(false); this.error.set(null); },
      error: e => { this.anunciando.set(false); this.error.set(e?.error?.message || 'No se pudo anunciar la llegada'); },
    });
  }

  fechaCita(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }

  cancelar(): void {
    if (!confirm('¿Cancelar su turno?')) return;
    this.api.publicoCancelar(this.turnoId()).subscribe({ next: t => this.turno.set(t), error: () => {} });
  }
}
