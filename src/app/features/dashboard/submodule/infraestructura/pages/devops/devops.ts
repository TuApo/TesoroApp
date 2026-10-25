import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import {
  Accion, DetalleEjecucion, Ejecucion, Integracion, Integridad, ResumenDevops, Trabajo,
} from '../../models/devops.models';
import { DevopsService } from '../../services/devops.service';
import { bytes, duracion, fecha, hace } from '../../utils/formato';

type Seccion = 'resumen' | 'publicar' | 'ejecuciones' | 'tiendas' | 'integridad' | 'integraciones' | 'servidor';
type Tono = 'ok' | 'warn' | 'danger' | 'info' | 'neutro';

/**
 * Infraestructura › DevOps. De dónde sale cada versión de la app y cómo va: compilaciones en
 * GitHub Actions, pistas de Google Play, lo publicado en el servidor, la verificación de
 * integridad del último .aab y el estado de cada integración. Desde «Publicar» se da la orden
 * (Android/iPhone van a GitHub; web/APK/escritorio al ejecutor del servidor con lista cerrada).
 */
@Component({
  selector: 'app-infra-devops',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './devops.html',
  styleUrls: ['../../styles/infra-comun.css', './devops.css'],
})
export class InfraDevops {
  private readonly api = inject(DevopsService);
  private readonly ruta = inject(ActivatedRoute);
  readonly f = { bytes, duracion, fecha, hace };

  readonly secciones: { clave: Seccion; texto: string; icono: string }[] = [
    { clave: 'resumen', texto: 'Resumen', icono: 'space_dashboard' },
    { clave: 'publicar', texto: 'Publicar', icono: 'rocket_launch' },
    { clave: 'ejecuciones', texto: 'Ejecuciones', icono: 'play_circle' },
    { clave: 'tiendas', texto: 'Tiendas', icono: 'storefront' },
    { clave: 'integridad', texto: 'Integridad', icono: 'verified_user' },
    { clave: 'integraciones', texto: 'Integraciones', icono: 'hub' },
    { clave: 'servidor', texto: 'Servidor', icono: 'dns' },
  ];

  readonly seccion = toSignal(this.ruta.paramMap.pipe(map((p) => (p.get('seccion') as Seccion) || 'resumen')), {
    initialValue: 'resumen' as Seccion,
  });

  readonly datos = signal<ResumenDevops | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  // Ejecuciones
  readonly filtroFlujo = signal<string | null>(null);
  readonly ejecuciones = signal<Ejecucion[]>([]);
  readonly detalle = signal<DetalleEjecucion | null>(null);
  readonly detalleId = signal<number | null>(null);

  // Integridad e integraciones
  readonly integridad = signal<Integridad | null>(null);
  readonly integraciones = signal<Integracion[]>([]);

  // Publicar
  readonly ramas = signal<string[]>([]);
  readonly elegida = signal<Accion | null>(null);
  readonly destino = signal<string>('');
  readonly estadoPlay = signal<'draft' | 'completed'>('draft');
  readonly rama = signal<string>('');
  readonly confirmando = signal(false);
  readonly enviando = signal(false);
  readonly mensaje = signal<{ tono: Tono; texto: string } | null>(null);

  // Servidor
  readonly trabajos = signal<Trabajo[]>([]);
  readonly trabajoAbierto = signal<Trabajo | null>(null);

  readonly integracionesPorGrupo = computed(() => {
    const grupos = new Map<string, Integracion[]>();
    for (const i of this.integraciones().length ? this.integraciones() : this.datos()?.integraciones ?? []) {
      grupos.set(i.grupo, [...(grupos.get(i.grupo) ?? []), i]);
    }
    return [...grupos.entries()].map(([grupo, items]) => ({ grupo, items }));
  });

  readonly cuentaIntegraciones = computed(() => {
    const l = this.datos()?.integraciones ?? [];
    return { ok: l.filter((i) => i.estado === 'OK').length, total: l.length, mal: l.filter((i) => i.estado !== 'OK').length };
  });

  readonly enCurso = computed(() =>
    (this.datos()?.ejecuciones ?? []).filter((e) => e.estado === 'in_progress' || e.estado === 'queued').length
    + (this.datos()?.trabajos ?? []).filter((t) => t.estado === 'EN_CURSO' || t.estado === 'PENDIENTE').length);

  private reloj: ReturnType<typeof setInterval> | null = null;
  private relojLog: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cargar();
    this.reloj = setInterval(() => this.cargar(true), 20_000);
    inject(DestroyRef).onDestroy(() => {
      if (this.reloj) clearInterval(this.reloj);
      if (this.relojLog) clearInterval(this.relojLog);
    });
    effect(() => {
      const s = this.seccion();
      untracked(() => this.alEntrar(s));
    });
  }

  cargar(silencioso = false) {
    if (!silencioso) this.cargando.set(true);
    this.api.resumen().subscribe({
      next: (d) => {
        this.datos.set(d);
        this.cargando.set(false);
        this.error.set(null);
        if (!this.rama()) this.rama.set(d.rama);
        if (this.seccion() === 'servidor') this.trabajos.set(d.trabajos);
      },
      error: (e) => {
        this.cargando.set(false);
        this.error.set(e?.status === 403 ? 'Su rol no puede ver DevOps.' : 'No se pudo leer el estado de DevOps (ms-infra).');
      },
    });
  }

  private alEntrar(s: Seccion) {
    if (s === 'ejecuciones') this.cargarEjecuciones();
    if (s === 'integridad' && !this.integridad()) this.api.integridad().subscribe((i) => this.integridad.set(i));
    if (s === 'integraciones') this.api.integraciones().subscribe((i) => this.integraciones.set(i));
    if (s === 'publicar' && !this.ramas().length) this.api.ramas().subscribe((r) => this.ramas.set(r));
    if (s === 'servidor') this.api.trabajos().subscribe((t) => this.trabajos.set(t));
  }

  // ── Ejecuciones ─────────────────────────────────────────────────────────
  cargarEjecuciones() {
    this.api.ejecuciones(this.filtroFlujo()).subscribe((e) => this.ejecuciones.set(e));
  }

  filtrar(flujo: string | null) {
    this.filtroFlujo.set(flujo);
    this.cargarEjecuciones();
  }

  abrirEjecucion(e: Ejecucion) {
    if (this.detalleId() === e.id) { this.detalleId.set(null); this.detalle.set(null); return; }
    this.detalleId.set(e.id);
    this.detalle.set(null);
    this.api.ejecucion(e.id).subscribe({ next: (d) => this.detalle.set(d), error: () => this.detalleId.set(null) });
  }

  cancelar(e: Ejecucion) {
    this.api.cancelar(e.id).subscribe({
      next: () => { this.mensaje.set({ tono: 'warn', texto: `Se pidió cancelar la ejecución #${e.numero}.` }); this.cargarEjecuciones(); },
      error: (err) => this.mensaje.set({ tono: 'danger', texto: err?.error?.message ?? 'No se pudo cancelar.' }),
    });
  }

  // ── Publicar ────────────────────────────────────────────────────────────
  elegir(a: Accion) {
    if (!a.disponible) return;
    this.elegida.set(a);
    this.destino.set(a.destinos[0] ?? '');
    this.estadoPlay.set('draft');
    this.confirmando.set(false);
    this.mensaje.set(null);
  }

  resumenOrden(): string {
    const a = this.elegida();
    if (!a) return '';
    if (a.tipo === 'android') {
      return this.destino() === 'interna'
        ? `Compilar Android desde «${this.rama()}» y subirlo a la prueba interna de Google Play (${this.estadoPlay() === 'draft' ? 'borrador' : 'publicado a testers'}).`
        : `Compilar Android desde «${this.rama()}» y dejar el .aab/.apk firmados como artefacto (no se sube a Play).`;
    }
    if (a.tipo === 'ios') {
      return this.destino() === 'testflight'
        ? `Compilar iPhone desde «${this.rama()}», firmarlo y subirlo a TestFlight.`
        : `Compilar iPhone desde «${this.rama()}» para simulador (sin firma, solo comprueba que compila).`;
    }
    return `${a.descripcion} Usa el código que hay ahora en el servidor.`;
  }

  enviar() {
    const a = this.elegida();
    if (!a) return;
    if (!this.confirmando()) { this.confirmando.set(true); return; }
    this.enviando.set(true);
    const github = a.tipo === 'android' || a.tipo === 'ios';
    this.api.ordenar({
      tipo: a.tipo,
      destino: github ? this.destino() : null,
      estado: a.tipo === 'android' ? this.estadoPlay() : null,
      rama: github ? this.rama() : null,
    }).subscribe({
      next: (r) => {
        this.enviando.set(false);
        this.confirmando.set(false);
        this.elegida.set(null);
        this.mensaje.set({ tono: 'ok', texto: r.mensaje });
        if (r.trabajo) this.verTrabajo(r.trabajo);
        setTimeout(() => this.cargar(true), 4000);
      },
      error: (err) => {
        this.enviando.set(false);
        this.confirmando.set(false);
        this.mensaje.set({ tono: 'danger', texto: err?.error?.message ?? err?.error?.detail ?? 'No se pudo dar la orden.' });
      },
    });
  }

  // ── Servidor ────────────────────────────────────────────────────────────
  verTrabajo(t: Trabajo) {
    if (this.relojLog) clearInterval(this.relojLog);
    this.trabajoAbierto.set(t);
    const leer = () => this.api.trabajo(t.id).subscribe((x) => {
      this.trabajoAbierto.set(x);
      if (!['PENDIENTE', 'EN_CURSO'].includes(x.estado) && this.relojLog) {
        clearInterval(this.relojLog);
        this.relojLog = null;
        this.cargar(true);
      }
    });
    leer();
    this.relojLog = setInterval(leer, 3000);
  }

  cerrarTrabajo() {
    if (this.relojLog) clearInterval(this.relojLog);
    this.relojLog = null;
    this.trabajoAbierto.set(null);
  }

  // ── Presentación ────────────────────────────────────────────────────────
  ts(iso: string | null | undefined): number | null {
    return iso ? Date.parse(iso) : null;
  }

  tonoEjecucion(e: Ejecucion): Tono {
    if (e.estado === 'in_progress' || e.estado === 'queued' || e.estado === 'waiting') return 'info';
    if (e.conclusion === 'success') return 'ok';
    if (e.conclusion === 'cancelled' || e.conclusion === 'skipped') return 'neutro';
    return 'danger';
  }

  textoEjecucion(e: Ejecucion): string {
    if (e.estado === 'queued' || e.estado === 'waiting') return 'En cola';
    if (e.estado === 'in_progress') return 'Compilando';
    return ({ success: 'Correcto', failure: 'Falló', cancelled: 'Cancelada', skipped: 'Omitida', timed_out: 'Tiempo agotado' } as Record<string, string>)[e.conclusion ?? ''] ?? (e.conclusion ?? '—');
  }

  iconoEjecucion(e: Ejecucion): string {
    const t = this.tonoEjecucion(e);
    return t === 'ok' ? 'check_circle' : t === 'info' ? 'autorenew' : t === 'neutro' ? 'block' : 'error';
  }

  tonoEstado(s: string | null | undefined): Tono {
    switch ((s ?? '').toUpperCase()) {
      case 'OK': case 'PUBLICADA': case 'EN_LINEA': case 'COMPILA': case 'COMPLETED': return 'ok';
      case 'AVISO': case 'BORRADOR': case 'DRAFT': case 'PENDIENTE': case 'INTERRUMPIDO': case 'IN_PROGRESS': case 'HALTED': return 'warn';
      case 'EN_CURSO': return 'info';
      case 'FALTA': case 'ERROR': case 'FAILURE': case 'RECHAZADO': return 'danger';
      default: return 'neutro';
    }
  }

  iconoTono(t: Tono): string {
    return { ok: 'check_circle', warn: 'warning', danger: 'error', info: 'autorenew', neutro: 'help' }[t];
  }

  textoEstado(s: string | null | undefined): string {
    return ({
      OK: 'Bien', AVISO: 'Revisar', FALTA: 'Falta', ERROR: 'Error', DESCONOCIDO: 'Sin datos', PUBLICADA: 'Publicada',
      BORRADOR: 'Borrador', EN_LINEA: 'En línea', COMPILA: 'Compila', SIN_DATOS: 'Sin datos', PENDIENTE: 'En cola',
      EN_CURSO: 'Ejecutando', INTERRUMPIDO: 'Interrumpido', RECHAZADO: 'Rechazado', COMPLETED: 'Publicada',
      DRAFT: 'Borrador', IN_PROGRESS: 'Desplegando', HALTED: 'Detenida',
    } as Record<string, string>)[(s ?? '').toUpperCase()] ?? (s ?? '—');
  }

  nombrePista(p: string): string {
    return ({ internal: 'Prueba interna', alpha: 'Prueba cerrada', beta: 'Prueba abierta', production: 'Producción' } as Record<string, string>)[p] ?? p;
  }

  nombreTipo(t: string): string {
    return ({ web: 'Web', apk: 'APK directo', exe: 'Escritorio' } as Record<string, string>)[t] ?? t;
  }

  textoDestino(d: string): string {
    return ({
      artefacto: 'Solo compilar (artefacto)', interna: 'Subir a prueba interna de Play',
      simulador: 'Simulador (sin firma)', testflight: 'TestFlight (firmado)',
    } as Record<string, string>)[d] ?? d;
  }

  duracionTrabajo(t: Trabajo): string {
    const i = this.ts(t.inicio);
    if (!i) return '—';
    const fin = this.ts(t.fin) ?? Date.now();
    return duracion((fin - i) / 1000);
  }

  permisos(): string[] {
    const v = this.integridad()?.crudo?.['permisos'];
    return Array.isArray(v) ? (v as string[]).map((p) => p.replace('android.permission.', '')) : [];
  }

  dato(clave: string): string {
    const v = this.integridad()?.crudo?.[clave];
    return v == null ? '—' : String(v);
  }

  latest(clave: string): string {
    const v = this.datos()?.servidor.latest?.[clave];
    return v == null ? '—' : String(v);
  }
}
