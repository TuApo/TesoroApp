import { Injectable, computed, inject, signal } from '@angular/core';

import { ConexionSse, conectarSse, tokenActual } from '../../turnos/service/sse.util';
import {
  CambioAforo, CambioCamara, CambioDispositivo, CambioParlante, ESTADOS_ACTIVOS, Evento, Incidente, NOMBRE_SEVERIDAD,
  Severidad,
} from '../models/seguridad.models';
import { SeguridadService } from './seguridad.service';

export type EstadoCanal = 'conectando' | 'conectado' | 'reconectando' | 'cerrado';

const PESO: Record<Severidad, number> = { CRITICA: 5, ALTA: 4, MEDIA: 3, BAJA: 2, INFO: 1 };

/** Orden del panel: severidad, luego sin reconocer primero, luego el más viejo arriba. */
export function ordenarIncidentes(a: Incidente, b: Incidente): number {
  const s = PESO[b.severidad] - PESO[a.severidad];
  if (s) return s;
  const ra = a.estado === 'ABIERTO' || a.estado === 'NOTIFICANDO' ? 0 : 1;
  const rb = b.estado === 'ABIERTO' || b.estado === 'NOTIFICANDO' ? 0 : 1;
  if (ra !== rb) return ra - rb;
  return (a.creado_en || '').localeCompare(b.creado_en || '');
}

/**
 * El canal en vivo del módulo Seguridad: UNA conexión SSE (`/api/v1/seguridad/stream`)
 * compartida por todas las pestañas, expuesta como señales. La abre el shell al entrar y la
 * cierra al salir.
 *
 * <p>Avisos: mientras el Centro de monitoreo está abierto (`activarAvisos(true)`), cada
 * incidente CRÍTICO o ALTO nuevo suena (sirena corta con WebAudio, sin archivos) y, si el
 * navegador dio permiso, sale una notificación del sistema. "Una alarma no termina hasta que
 * una persona la reconoce": el sonido se repite cada 20 s mientras haya críticos/altos sin
 * reconocer, salvo que el operador lo silencie.
 */
@Injectable({ providedIn: 'root' })
export class SeguridadVivoService {
  private readonly api = inject(SeguridadService);
  private conexion: ConexionSse | null = null;
  private usuarios = 0;

  readonly canal = signal<EstadoCanal>('cerrado');
  readonly sinPermiso = signal(false);
  readonly ultimoLatido = signal<number>(0);

  /** Incidentes activos (no cerrados) por id. */
  private readonly incidentesMapa = signal<Map<string, Incidente>>(new Map());
  readonly incidentes = computed(() => [...this.incidentesMapa().values()].sort(ordenarIncidentes));
  readonly sinReconocer = computed(() => this.incidentes().filter((i) => i.estado === 'ABIERTO' || i.estado === 'NOTIFICANDO'));
  readonly criticosSinReconocer = computed(() => this.sinReconocer().filter((i) => i.severidad === 'CRITICA' || i.severidad === 'ALTA'));

  /** Últimos eventos (más nuevos primero, máx. 200). */
  readonly eventos = signal<Evento[]>([]);
  /** Último estado conocido por id (llega por SSE; las pantallas lo superponen a lo leído por HTTP). */
  readonly dispositivos = signal<Map<string, CambioDispositivo>>(new Map());
  readonly camaras = signal<Map<string, CambioCamara>>(new Map());
  readonly parlantes = signal<Map<string, CambioParlante>>(new Map());
  /** Aforo por clave `sede|zona|camara`. */
  readonly aforo = signal<Map<string, CambioAforo>>(new Map());
  /** Cambia con cada incidente recibido: las pantallas lo miran para recargar un detalle abierto. */
  readonly versionIncidentes = signal(0);

  // ── Avisos ───────────────────────────────────────────────────────────────
  readonly avisosActivos = signal(false);
  readonly silenciado = signal(false);
  readonly permisoNotificacion = signal<NotificationPermission | 'no-soportado'>(
    typeof Notification === 'undefined' ? 'no-soportado' : Notification.permission,
  );
  private yaAvisados = new Set<string>();
  private ctxAudio: AudioContext | null = null;
  private repetidor: ReturnType<typeof setInterval> | null = null;

  abrir(): void {
    this.usuarios++;
    if (this.conexion) return;
    const token = tokenActual();
    if (!token) return;
    this.cargarIncidentes();
    this.api.tablero().subscribe({
      next: (t) => this.mezclarEventos(t.ultimos_eventos ?? []),
      error: (e) => { if (e?.status === 403) this.sinPermiso.set(true); },
    });
    this.conexion = conectarSse(this.api.urlStream(), {
      token,
      onEstado: (e) => {
        this.canal.set(e);
        // Al reconectar se relee la lista: lo que pasó durante el corte no llegó por el canal.
        if (e === 'conectado') this.cargarIncidentes();
      },
      onEvento: (nombre, datos) => this.recibir(nombre, datos),
    });
  }

  cerrar(): void {
    this.usuarios = Math.max(0, this.usuarios - 1);
    if (this.usuarios > 0) return;
    this.conexion?.cerrar();
    this.conexion = null;
    this.canal.set('cerrado');
    this.activarAvisos(false);
  }

  /** Lee los incidentes activos por HTTP (al abrir y al reconectar). */
  cargarIncidentes(): void {
    this.api.incidentes({ estado: ESTADOS_ACTIVOS.join(','), limit: 200 }).subscribe({
      next: (p) => {
        const m = new Map<string, Incidente>();
        for (const i of p.results ?? []) if (ESTADOS_ACTIVOS.includes(i.estado)) m.set(i.id, i);
        // Lo ya visto no vuelve a sonar al recargar.
        for (const id of m.keys()) this.yaAvisados.add(id);
        this.incidentesMapa.set(m);
        this.sinPermiso.set(false);
      },
      error: (e) => { if (e?.status === 403) this.sinPermiso.set(true); },
    });
  }

  /** Actualiza un incidente tras una acción propia (sin esperar al SSE). */
  ponerIncidente(i: Incidente): void { this.aplicarIncidente(i, false); }

  private recibir(nombre: string, datos: unknown): void {
    if (!datos || typeof datos !== 'object') {
      if (nombre === 'latido' || nombre === 'conectado') this.ultimoLatido.set(Date.now());
      return;
    }
    switch (nombre) {
      case 'conectado':
      case 'latido':
        this.ultimoLatido.set(Date.now());
        break;
      case 'incidente':
        this.aplicarIncidente(datos as Incidente, true);
        break;
      case 'evento':
        this.mezclarEventos([datos as Evento]);
        break;
      case 'dispositivo': {
        const d = datos as CambioDispositivo;
        this.dispositivos.update((m) => new Map(m).set(d.id, d));
        break;
      }
      case 'camara': {
        const c = datos as CambioCamara;
        this.camaras.update((m) => new Map(m).set(c.id, c));
        break;
      }
      case 'parlante': {
        const p = datos as CambioParlante;
        this.parlantes.update((m) => new Map(m).set(p.id, p));
        break;
      }
      case 'aforo': {
        const a = datos as CambioAforo;
        this.aforo.update((m) => new Map(m).set(`${a.sede_id}|${a.zona_id ?? ''}|${a.camara_id ?? ''}`, a));
        break;
      }
    }
  }

  private aplicarIncidente(i: Incidente, desdeCanal: boolean): void {
    if (!i?.id) return;
    this.incidentesMapa.update((m) => {
      const n = new Map(m);
      if (ESTADOS_ACTIVOS.includes(i.estado)) n.set(i.id, i); else n.delete(i.id);
      return n;
    });
    this.versionIncidentes.update((v) => v + 1);
    if (desdeCanal && !this.yaAvisados.has(i.id) && (i.estado === 'ABIERTO' || i.estado === 'NOTIFICANDO')) {
      this.yaAvisados.add(i.id);
      if (i.severidad === 'CRITICA' || i.severidad === 'ALTA') this.avisar(i);
    }
  }

  private mezclarEventos(nuevos: Evento[]): void {
    if (!nuevos.length) return;
    this.eventos.update((l) => {
      const ids = new Set(nuevos.map((e) => e.id));
      return [...nuevos, ...l.filter((e) => !ids.has(e.id))]
        .sort((a, b) => (b.ocurrido_en || '').localeCompare(a.ocurrido_en || ''))
        .slice(0, 200);
    });
  }

  // ── Avisos sonoros y del navegador ──────────────────────────────────────
  /** La pantalla de monitoreo los prende al abrirse y los apaga al salir. */
  activarAvisos(si: boolean): void {
    this.avisosActivos.set(si);
    if (this.repetidor) { clearInterval(this.repetidor); this.repetidor = null; }
    if (si) {
      this.repetidor = setInterval(() => {
        if (!this.silenciado() && this.criticosSinReconocer().length) this.sonar(true);
      }, 20_000);
    }
  }

  /** Debe llamarse desde un clic (los navegadores solo piden permiso con gesto del usuario). */
  async pedirPermisoNotificaciones(): Promise<void> {
    this.desbloquearAudio();
    if (typeof Notification === 'undefined') { this.permisoNotificacion.set('no-soportado'); return; }
    try { this.permisoNotificacion.set(await Notification.requestPermission()); } catch { /* sin soporte */ }
  }

  /** Crea/reanuda el contexto de audio (hace falta un gesto del usuario una vez). */
  desbloquearAudio(): void {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctxAudio ??= new Ctor();
      if (this.ctxAudio.state === 'suspended') this.ctxAudio.resume().catch(() => {});
    } catch { /* sin audio */ }
  }

  private avisar(i: Incidente): void {
    if (!this.avisosActivos()) return;
    if (!this.silenciado()) this.sonar(i.severidad === 'CRITICA');
    if (this.permisoNotificacion() === 'granted' && typeof Notification !== 'undefined') {
      try {
        const n = new Notification(`${NOMBRE_SEVERIDAD[i.severidad]}: ${i.titulo}`, {
          body: `${i.sede_nombre ?? ''} · Requiere que alguien lo reconozca.`,
          tag: `sg-incidente-${i.id}`,
          requireInteraction: i.severidad === 'CRITICA',
        });
        n.onclick = () => {
          window.focus();
          location.hash = `#/dashboard/seguridad/monitoreo?incidente=${encodeURIComponent(i.id)}`;
          n.close();
        };
      } catch { /* algunos navegadores solo permiten notificaciones desde el service worker */ }
    }
  }

  /** Sirena corta: dos tonos alternos (crítico) o tres pitidos (alto). */
  sonar(critico: boolean): void {
    this.desbloquearAudio();
    const ctx = this.ctxAudio;
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.02;
    const g = ctx.createGain();
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, t0);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.connect(g);
    if (critico) {
      for (let k = 0; k < 6; k++) {
        const t = t0 + k * 0.32;
        o.frequency.setValueAtTime(k % 2 ? 660 : 990, t);
        g.gain.setValueAtTime(0.12, t);
        g.gain.setValueAtTime(0.0001, t + 0.28);
      }
      o.start(t0);
      o.stop(t0 + 6 * 0.32);
    } else {
      for (let k = 0; k < 3; k++) {
        const t = t0 + k * 0.25;
        o.frequency.setValueAtTime(880, t);
        g.gain.setValueAtTime(0.1, t);
        g.gain.setValueAtTime(0.0001, t + 0.15);
      }
      o.start(t0);
      o.stop(t0 + 0.8);
    }
  }
}
