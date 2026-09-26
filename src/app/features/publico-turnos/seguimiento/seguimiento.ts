import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { IceConfig, SenalVideo, Turno, TurnosService } from '../../dashboard/submodule/turnos/service/turnos.service';
import { conectarSse, ConexionSse } from '../../dashboard/submodule/turnos/service/sse.util';
import { Videollamada } from '../../dashboard/submodule/turnos/service/videollamada';

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
  /** Atención remota: el asesor atiende por videollamada desde otra oficina. */
  readonly remoto = computed(() => !!this.turno()?.remoto && (this.turno()?.estado === 'LLAMADO' || this.turno()?.estado === 'EN_ATENCION'));
  readonly llamada = signal<Videollamada | null>(null);
  readonly uniendo = signal(false);
  private ofertaPendiente: RTCSessionDescriptionInit | null = null;
  private senales: ConexionSse | null = null;
  readonly llamado = computed(() => this.turno()?.estado === 'LLAMADO');
  readonly enAtencion = computed(() => this.turno()?.estado === 'EN_ATENCION');
  readonly terminado = computed(() => { const e = this.turno()?.estado; return !!e && !['EN_ESPERA', 'LLAMADO', 'EN_ATENCION'].includes(e); });

  ngOnInit(): void {
    this.cargar();
    const sondeo = setInterval(() => this.cargar(), 30_000);
    this.destroyRef.onDestroy(() => { clearInterval(sondeo); this.conexion?.cerrar(); this.senales?.cerrar(); this.llamada()?.colgar(); });
  }

  private cargar(): void {
    this.api.publicoSeguimiento(this.turnoId()).subscribe({
      next: t => { this.turno.set(t); this.error.set(null); this.conectar(); if (t.remoto) this.conectarSenales(); },
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

  /** Canal propio del turno: por aquí llega la oferta WebRTC del asesor. */
  private conectarSenales(): void {
    if (this.senales) return;
    this.senales = conectarSse(this.api.urlSenalesTurno(this.turnoId()), {
      token: null,
      onEvento: (nombre, datos) => {
        if (nombre !== 'video-senal') return;
        const s = datos as SenalVideo;
        if (s.de !== 'agente') return;
        const l = this.llamada();
        if (s.tipo === 'offer') {
          this.ofertaPendiente = s.datos as RTCSessionDescriptionInit;
          if (l && l.estado() !== 'terminada' && l.estado() !== 'error') void l.contestar(this.ofertaPendiente);
          else if (this.uniendo()) void this.contestarPendiente();
          this.avisar();
        } else if (l) {
          void l.recibir(s);
        }
      },
    });
  }

  /** "Unirme a la videollamada": pide cámara y contesta la oferta del asesor (o la espera). */
  async unirse(): Promise<void> {
    if (this.llamada()) return;
    this.uniendo.set(true);
    this.error.set(null);
    this.conectarSenales();
    await this.contestarPendiente();
  }

  private async contestarPendiente(): Promise<void> {
    if (!this.ofertaPendiente || this.llamada()) return;
    let ice: IceConfig;
    try { ice = await new Promise<IceConfig>((res, rej) => this.api.publicoIce(this.turnoId()).subscribe({ next: res, error: rej })); }
    catch { ice = { ice_servers: [{ urls: ['stun:stun.l.google.com:19302'] }], tiene_turn: false }; }
    const l = new Videollamada(ice.ice_servers, s => this.api.publicoSenal(this.turnoId(), s).subscribe({ error: () => {} }));
    this.llamada.set(l);
    await l.contestar(this.ofertaPendiente);
    this.ofertaPendiente = null;
  }

  colgarLlamada(): void {
    this.llamada()?.colgar();
    this.llamada.set(null);
    this.uniendo.set(false);
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
