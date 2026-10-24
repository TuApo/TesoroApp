import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { obtenerUsuarioActual } from '../../../../../../core/utils/usuario-actual';
import { ComunicacionesApiService } from '../../../comunicaciones/service/comunicaciones-api.service';
import { DockService } from '../../../comunicaciones/service/dock.service';
import { LlamadaService } from '../../../comunicaciones/service/llamada.service';
import {
  Conexion, ETIQUETA_ALERTA, ETIQUETA_CONEXION, ETIQUETA_ROSTRO, ETIQUETA_VISITA, EstadoPersona, EstadoRostro, Finca, Marcacion, Rastro, Tablero, Visita, Zona,
} from '../../campo.models';
import { CampoApiService } from '../../services/campo-api.service';
import { CampoService, haceCuanto, horaCorta, hoyIso, mensajeDe } from '../../services/campo.service';
import { CirculoMapa, LineaMapa, MapaCampoComponent, MarcadorMapa } from '../../components/mapa-campo/mapa-campo.component';

/** Lo que manda el servidor por SSE cada vez que un teléfono reporta posición (o un latido sin GPS). */
interface EventoPosicion {
  usuario_id: string; recibido_ms: number; bateria: number | null; red: string | null;
  lat?: number; lon?: number; precision_m?: number | null; capturado_ms?: number;
}

type FiltroConexion = Conexion | 'TODAS';
type Seleccion = { tipo: 'persona'; id: string } | { tipo: 'finca'; id: number } | null;

/** Color del círculo de cada persona según qué tan fresca es su señal. */
const COLOR_CONEXION: Record<Conexion, string> = {
  EN_LINEA: '#16A34A',
  RECIENTE: '#84CC16',
  SIN_SENAL: '#F87171',
  NUNCA: '#94A3B8',
};

const ORDEN_CONEXION: Record<Conexion, number> = { EN_LINEA: 0, RECIENTE: 1, SIN_SENAL: 2, NUNCA: 3 };

const TILES_DEFECTO = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIBUCION_DEFECTO = '© OpenStreetMap';

/** Puntos del recorrido con precisión peor que esto se descartan: dibujan zigzags falsos. */
const PRECISION_MAXIMA_RASTRO_M = 300;

/** Cada cuánto se trae el tablero completo (lo vivo llega por SSE entre medio). */
const REFRESCO_MS = 60_000;

const ROSTRO_MAL: ReadonlySet<EstadoRostro> = new Set<EstadoRostro>(['NO_COINCIDE', 'ERROR']);

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  const a = partes[0][0] ?? '';
  const b = partes.length > 2 ? partes[2][0] : partes.length > 1 ? partes[1][0] : '';
  return (a + (b ?? '')).toUpperCase();
}

/**
 * Mapa en vivo del trabajo de campo (`/dashboard/campo/mapa`), para supervisores y
 * administración.
 *
 *  · Trae el tablero (personas, fincas, zonas, visitas de hoy) y lo vuelve a traer cada minuto.
 *  · Entre medio, los eventos SSE del canal de comunicaciones mueven los marcadores:
 *    `campo-posicion` actualiza dónde está y su batería; `campo-marcacion`, en qué finca entró.
 *  · Tocar a alguien abre su detalle (última marcación con selfie, chat, recorrido de hoy);
 *    tocar una finca dice quién está ahí ahora.
 *
 * Si el tablero no carga (por ejemplo, un coordinador sin permiso de supervisión) se muestran
 * al menos las fincas de su paquete.
 */
@Component({
  selector: 'app-mapa-vivo',
  standalone: true,
  imports: [MatIconModule, RouterLink, NgTemplateOutlet, MapaCampoComponent],
  templateUrl: './mapa-vivo.component.html',
  styleUrls: ['../../campo-ui.css', './mapa-vivo.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapaVivoComponent {
  private readonly api = inject(CampoApiService);
  readonly campo = inject(CampoService);
  private readonly comunicaciones = inject(ComunicacionesApiService);
  private readonly dock = inject(DockService);
  private readonly llamadas = inject(LlamadaService);
  private readonly destroy = inject(DestroyRef);

  readonly etiquetaAlerta = ETIQUETA_ALERTA;
  readonly etiquetaRostro = ETIQUETA_ROSTRO;
  readonly etiquetaConexion = ETIQUETA_CONEXION;
  readonly etiquetaVisita = ETIQUETA_VISITA;
  readonly pestanasConexion: { valor: FiltroConexion; nombre: string }[] = [
    { valor: 'TODAS', nombre: 'Todos' },
    { valor: 'EN_LINEA', nombre: 'En línea' },
    { valor: 'RECIENTE', nombre: 'Con señal' },
    { valor: 'SIN_SENAL', nombre: 'Sin señal' },
    { valor: 'NUNCA', nombre: 'Nunca' },
  ];

  private readonly yo = obtenerUsuarioActual().id;

  readonly tablero = signal<Tablero | null>(null);
  /** Copia viva de las personas: la mueven los eventos SSE sin esperar el refresco. */
  readonly personas = signal<EstadoPersona[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly ultimaCarga = signal<number | null>(null);

  readonly zonaId = signal<number | null>(null);
  readonly conexion = signal<FiltroConexion>('TODAS');
  readonly busqueda = signal('');

  readonly seleccion = signal<Seleccion>(null);
  readonly rastro = signal<Rastro | null>(null);
  readonly cargandoRastro = signal(false);
  readonly aviso = signal<string | null>(null);
  readonly abriendoChat = signal(false);
  /** Puntos a encuadrar: solo cambia cuando queremos mover la cámara. */
  readonly encuadre = signal<[number, number][] | null>(null);

  /** Reloj para que los "hace X min" no se queden quietos. */
  private readonly ahora = signal(Date.now());
  readonly escritorio = signal(false);
  private encuadradoInicial = false;

  // ─── Datos derivados ────────────────────────────────────────────────────

  readonly zonas = computed<Zona[]>(() => this.tablero()?.zonas ?? this.campo.paquete()?.zonas ?? []);
  readonly fincas = computed<Finca[]>(() => this.tablero()?.fincas ?? this.campo.fincas());
  readonly visitasHoy = computed<Visita[]>(() => this.tablero()?.visitas_hoy ?? []);

  readonly tilesUrl = computed(() => this.campo.paquete()?.config?.tiles_url || TILES_DEFECTO);
  readonly atribucion = computed(() => this.campo.paquete()?.config?.tiles_atribucion || ATRIBUCION_DEFECTO);

  private readonly fincasPorId = computed(() => new Map(this.fincas().map(f => [f.id, f])));

  readonly fincasFiltradas = computed(() => {
    const z = this.zonaId();
    return this.fincas().filter(f => f.activa && (z == null || f.zona_id === z));
  });

  /** Personas de la zona elegida (sin los demás filtros): base de los conteos de las pestañas. */
  private readonly personasZona = computed(() => {
    const z = this.zonaId();
    return z == null ? this.personas() : this.personas().filter(p => p.zona_id === z);
  });

  readonly conteoConexion = computed(() => {
    const c: Record<FiltroConexion, number> = { TODAS: 0, EN_LINEA: 0, RECIENTE: 0, SIN_SENAL: 0, NUNCA: 0 };
    for (const p of this.personasZona()) { c.TODAS++; c[p.conexion]++; }
    return c;
  });

  readonly personasFiltradas = computed(() => {
    const c = this.conexion();
    const q = sinTildes(this.busqueda().trim());
    return this.personasZona()
      .filter(p => (c === 'TODAS' || p.conexion === c) && (!q || sinTildes(p.nombre).includes(q)
        || sinTildes(p.finca_actual_nombre ?? '').includes(q)))
      .sort((a, b) => ORDEN_CONEXION[a.conexion] - ORDEN_CONEXION[b.conexion]
        || (b.alertas - a.alertas) || a.nombre.localeCompare(b.nombre, 'es'));
  });

  /** Conteos en vivo (los de personas salen de la copia viva; el resto, del resumen del servidor). */
  readonly kpis = computed(() => {
    const ps = this.personasZona();
    const r = this.tablero()?.resumen;
    return {
      enLinea: ps.filter(p => p.conexion === 'EN_LINEA').length,
      sinSenal: ps.filter(p => p.conexion === 'SIN_SENAL').length,
      enFinca: ps.filter(p => p.finca_actual_id != null).length,
      visitasHoy: r?.visitas_hoy ?? 0,
      visitasCumplidas: r?.visitas_cumplidas ?? 0,
      alertasRostro: r?.alertas_rostro ?? 0,
      fincasSinUbicar: r?.fincas_sin_ubicar ?? this.fincas().filter(f => f.activa && (f.lat == null || f.lon == null)).length,
    };
  });

  readonly personaSel = computed<EstadoPersona | null>(() => {
    const s = this.seleccion();
    return s?.tipo === 'persona' ? this.personas().find(p => p.usuario_id === s.id) ?? null : null;
  });

  readonly fincaSel = computed<Finca | null>(() => {
    const s = this.seleccion();
    return s?.tipo === 'finca' ? this.fincasPorId().get(s.id) ?? null : null;
  });

  /** Quién está ahora en la finca seleccionada (según su última entrada). */
  readonly enFincaSel = computed(() => {
    const f = this.fincaSel();
    return f ? this.personas().filter(p => p.finca_actual_id === f.id) : [];
  });

  readonly visitasFincaSel = computed(() => {
    const f = this.fincaSel();
    return f ? this.visitasHoy().filter(v => v.finca_id === f.id) : [];
  });

  readonly rastroResumen = computed(() => {
    const r = this.rastro();
    if (!r) return null;
    const pts = r.puntos;
    return {
      puntos: pts.length,
      marcaciones: r.marcaciones.length,
      desde: pts.length ? horaCorta(pts[0][2]) : null,
      hasta: pts.length ? horaCorta(pts[pts.length - 1][2]) : null,
    };
  });

  readonly marcadores = computed<MarcadorMapa[]>(() => {
    const sel = this.seleccion();
    const out: MarcadorMapa[] = [];
    for (const f of this.fincasFiltradas()) {
      if (f.lat == null || f.lon == null) continue;
      out.push({
        id: `f:${f.id}`, lat: f.lat, lon: f.lon, tipo: 'finca', color: f.zona_color || '#475569', etiqueta: f.nombre,
        seleccionado: sel?.tipo === 'finca' && sel.id === f.id,
      });
    }
    const r = this.rastro();
    if (r) {
      for (const m of r.marcaciones) {
        if (m.lat == null || m.lon == null) continue;
        out.push({
          id: `m:${m.id}`, lat: m.lat, lon: m.lon, tipo: 'punto', color: m.tipo === 'ENTRADA' ? '#16A34A' : '#0F172A',
          etiqueta: `${m.tipo === 'ENTRADA' ? 'Entrada' : 'Salida'} ${horaCorta(m.capturado_ms)}${m.finca_nombre ? ' · ' + m.finca_nombre : ''}`,
        });
      }
    }
    for (const p of this.personasFiltradas()) {
      if (p.lat == null || p.lon == null) continue;
      out.push({
        id: `p:${p.usuario_id}`, lat: p.lat, lon: p.lon, tipo: 'persona', color: COLOR_CONEXION[p.conexion],
        iniciales: iniciales(p.nombre), etiqueta: p.nombre, pulso: p.conexion === 'EN_LINEA',
        seleccionado: sel?.tipo === 'persona' && sel.id === p.usuario_id,
      });
    }
    return out;
  });

  readonly circulos = computed<CirculoMapa[]>(() => this.fincasFiltradas()
    .filter(f => f.lat != null && f.lon != null)
    .map(f => ({ lat: f.lat as number, lon: f.lon as number, radioM: f.radio_m, color: f.zona_color || '#475569' })));

  readonly lineas = computed<LineaMapa[]>(() => {
    const r = this.rastro();
    if (!r) return [];
    const puntos = r.puntos
      .filter(p => p[3] < 0 || p[3] <= PRECISION_MAXIMA_RASTRO_M)
      .map(p => [p[0], p[1]] as [number, number]);
    return puntos.length > 1 ? [{ puntos, color: '#2563EB' }] : [];
  });

  constructor() {
    this.campo.iniciar();
    this.cargar();

    this.campo.eventos$.pipe(takeUntilDestroyed()).subscribe(e => {
      if (e.nombre === 'campo-posicion') this.alPosicion(e.datos as EventoPosicion);
      else if (e.nombre === 'campo-marcacion') this.alMarcacion(e.datos as Marcacion);
    });

    const refresco = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') this.cargar(true);
    }, REFRESCO_MS);
    const reloj = setInterval(() => this.ahora.set(Date.now()), 30_000);
    this.destroy.onDestroy(() => { clearInterval(refresco); clearInterval(reloj); });

    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(min-width: 1000px)');
      this.escritorio.set(mq.matches);
      const cambio = (ev: MediaQueryListEvent) => this.escritorio.set(ev.matches);
      mq.addEventListener('change', cambio);
      this.destroy.onDestroy(() => mq.removeEventListener('change', cambio));
    }
  }

  // ─── Carga y eventos en vivo ────────────────────────────────────────────

  cargar(silencioso = false): void {
    if (!silencioso) this.cargando.set(true);
    this.api.tablero().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: t => {
        this.tablero.set(t);
        this.personas.set(this.fusionar(t.personas));
        this.error.set(null);
        this.cargando.set(false);
        this.ultimaCarga.set(Date.now());
        if (!this.encuadradoInicial) { this.encuadradoInicial = true; this.encuadrarTodo(); }
      },
      error: err => {
        this.cargando.set(false);
        // Un fallo del refresco silencioso no borra lo que ya se ve.
        if (!this.tablero()) this.error.set(mensajeDe(err, 'No se pudo cargar el tablero en vivo'));
        if (!this.encuadradoInicial && this.fincas().length) { this.encuadradoInicial = true; this.encuadrarTodo(); }
      },
    });
  }

  /** Lo que llegó por SSE después de la foto del servidor no se pierde con el refresco. */
  private fusionar(servidor: EstadoPersona[]): EstadoPersona[] {
    const locales = new Map(this.personas().map(p => [p.usuario_id, p]));
    return servidor.map(s => {
      const l = locales.get(s.usuario_id);
      if (!l || (l.recibido_ms ?? 0) <= (s.recibido_ms ?? 0)) return s;
      return {
        ...s, lat: l.lat, lon: l.lon, precision_m: l.precision_m, posicion_ms: l.posicion_ms, recibido_ms: l.recibido_ms,
        bateria: l.bateria, red: l.red, conexion: l.conexion,
      };
    });
  }

  private alPosicion(d: EventoPosicion): void {
    if (!d?.usuario_id) return;
    const conPosicion = typeof d.lat === 'number' && typeof d.lon === 'number';
    // Alguien que no estaba en el tablero (recién asignado): que lo traiga el próximo refresco.
    if (!this.personas().some(p => p.usuario_id === d.usuario_id)) return;
    this.personas.update(l => l.map(p => {
      if (p.usuario_id !== d.usuario_id) return p;
      return {
        ...p,
        recibido_ms: d.recibido_ms ?? Date.now(),
        bateria: d.bateria ?? p.bateria,
        red: d.red ?? p.red,
        conexion: 'EN_LINEA' as Conexion,
        ...(conPosicion ? { lat: d.lat as number, lon: d.lon as number, precision_m: d.precision_m ?? null, posicion_ms: d.capturado_ms ?? null } : {}),
      };
    }));
    // Si se está viendo su recorrido de hoy, se alarga en vivo.
    const r = this.rastro();
    if (conPosicion && r && r.usuario_id === d.usuario_id) {
      this.rastro.set({ ...r, puntos: [...r.puntos, [d.lat as number, d.lon as number, d.capturado_ms ?? Date.now(), d.precision_m ?? -1]] });
    }
  }

  private alMarcacion(m: Marcacion): void {
    if (!m?.usuario_id) return;
    this.personas.update(l => l.map(p => {
      if (p.usuario_id !== m.usuario_id) return p;
      // Solo si es más nueva que la que ya se tiene (las que llegan atrasadas sin señal no pisan).
      if (p.ultima_marcacion && p.ultima_marcacion.capturado_ms > m.capturado_ms) return p;
      const entra = m.tipo === 'ENTRADA';
      return {
        ...p,
        ultima_marcacion: m,
        finca_actual_id: entra ? m.finca_id : null,
        finca_actual_nombre: entra ? m.finca_nombre : null,
        alertas: p.alertas + (m.alertas?.length ? 1 : 0),
      };
    }));
    const r = this.rastro();
    if (r && r.usuario_id === m.usuario_id) {
      this.rastro.set({ ...r, marcaciones: [...r.marcaciones.filter(x => x.id !== m.id), m] });
    }
  }

  // ─── Interacción ────────────────────────────────────────────────────────

  alClicMarcador(id: string): void {
    const [tipo, valor] = [id.slice(0, 2), id.slice(2)];
    if (tipo === 'p:') this.elegirPersona(valor, false);
    else if (tipo === 'f:') this.elegirFinca(Number(valor), false);
    // Los puntos de marcación del recorrido solo muestran su rótulo (title).
  }

  elegirPersona(id: string, centrar = true): void {
    const cambia = !(this.seleccion()?.tipo === 'persona' && this.seleccion()?.id === id);
    this.seleccion.set({ tipo: 'persona', id });
    this.aviso.set(null);
    if (cambia && this.rastro() && this.rastro()?.usuario_id !== id) this.rastro.set(null);
    const p = this.personas().find(x => x.usuario_id === id);
    if (centrar && p?.lat != null && p.lon != null) this.encuadre.set([[p.lat, p.lon]]);
  }

  elegirFinca(id: number, centrar = true): void {
    this.seleccion.set({ tipo: 'finca', id });
    this.aviso.set(null);
    const f = this.fincasPorId().get(id);
    if (centrar && f?.lat != null && f.lon != null) this.encuadre.set([[f.lat, f.lon]]);
  }

  cerrar(): void {
    this.seleccion.set(null);
    this.aviso.set(null);
  }

  @HostListener('document:keydown.escape')
  alEscape(): void {
    if (this.seleccion()) this.cerrar();
  }

  encuadrarTodo(): void {
    const pts: [number, number][] = [];
    for (const f of this.fincasFiltradas()) if (f.lat != null && f.lon != null) pts.push([f.lat, f.lon]);
    for (const p of this.personasFiltradas()) if (p.lat != null && p.lon != null) pts.push([p.lat, p.lon]);
    if (pts.length) this.encuadre.set(pts);
  }

  centrarEn(p: EstadoPersona): void {
    if (p.lat != null && p.lon != null) this.encuadre.set([[p.lat, p.lon]]);
    if (!this.escritorio()) this.seleccion.set(null);
  }

  cambiarZona(valor: string): void {
    this.zonaId.set(valor === '' ? null : Number(valor));
    this.encuadrarTodo();
  }

  alternarConexion(c: FiltroConexion): void {
    this.conexion.set(this.conexion() === c ? 'TODAS' : c);
  }

  async verRecorrido(p: EstadoPersona): Promise<void> {
    if (this.rastro()?.usuario_id === p.usuario_id) { this.rastro.set(null); return; }
    this.cargandoRastro.set(true);
    this.aviso.set(null);
    try {
      const r = await firstValueFrom(this.api.rastro(p.usuario_id, hoyIso()));
      const pts: [number, number][] = r.puntos
        .filter(x => x[3] < 0 || x[3] <= PRECISION_MAXIMA_RASTRO_M)
        .map(x => [x[0], x[1]]);
      for (const m of r.marcaciones) if (m.lat != null && m.lon != null) pts.push([m.lat, m.lon]);
      if (!pts.length) {
        this.aviso.set('Hoy no hay recorrido registrado para esta persona.');
        this.rastro.set(null);
        return;
      }
      this.rastro.set(r);
      this.encuadre.set(pts);
      // En el teléfono la hoja tapa el mapa: se cierra para ver la línea.
      if (!this.escritorio()) {
        this.seleccion.set(null);
        if (typeof document !== 'undefined') document.querySelector('.mapa-vivo-mapa')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (e) {
      this.aviso.set(mensajeDe(e, 'No se pudo traer el recorrido'));
    } finally {
      this.cargandoRastro.set(false);
    }
  }

  ocultarRecorrido(): void {
    this.rastro.set(null);
  }

  async chatear(usuarioId: string): Promise<void> {
    await this.conConversacion(usuarioId, id => this.dock.abrir(id));
  }

  async llamar(usuarioId: string): Promise<void> {
    await this.conConversacion(usuarioId, id => void this.llamadas.llamar(id, 'AUDIO'));
  }

  private async conConversacion(usuarioId: string, hacer: (conversacionId: string) => void): Promise<void> {
    if (this.abriendoChat()) return;
    this.abriendoChat.set(true);
    this.aviso.set(null);
    try {
      const c = await firstValueFrom(this.comunicaciones.directa(usuarioId));
      hacer(c.id);
    } catch (e) {
      this.aviso.set(mensajeDe(e, 'No se pudo abrir la conversación'));
    } finally {
      this.abriendoChat.set(false);
    }
  }

  // ─── Ayudas de la plantilla ─────────────────────────────────────────────

  esYo(id: string): boolean { return !!this.yo && this.yo === id; }

  hace(ms: number | null | undefined): string {
    this.ahora();
    return haceCuanto(ms);
  }

  hora(ms: number | null | undefined): string { return horaCorta(ms); }

  iniciales(nombre: string): string { return iniciales(nombre); }

  colorConexion(c: Conexion): string { return COLOR_CONEXION[c]; }

  selfie(m: Marcacion | null): string | null { return m ? this.api.absoluta(m.selfie_url) : null; }

  claseRostro(e: EstadoRostro): string {
    if (e === 'VALIDADA' || e === 'APROBADA_MANUAL') return 'ok';
    if (ROSTRO_MAL.has(e)) return 'mal';
    if (e === 'SIN_REFERENCIA' || e === 'SIN_SELFIE') return 'aviso';
    return 'info';
  }

  claseBateria(b: number | null): string {
    if (b == null) return '';
    return b <= 15 ? 'mal' : b <= 30 ? 'aviso' : '';
  }

  iconoBateria(b: number | null): string {
    if (b == null) return 'battery_unknown';
    if (b <= 15) return 'battery_alert';
    if (b >= 90) return 'battery_full';
    return 'battery_std';
  }

  iconoRed(red: string | null): string {
    const r = (red ?? '').toLowerCase();
    if (r.includes('wifi')) return 'wifi';
    if (!r || r === 'none' || r === 'offline') return 'signal_cellular_off';
    return 'signal_cellular_alt';
  }

  etiquetaRed(red: string | null): string {
    const r = (red ?? '').toLowerCase();
    if (!r) return 'Red desconocida';
    if (r.includes('wifi')) return 'Wi-Fi';
    if (r === 'none' || r === 'offline') return 'Sin red';
    return r.toUpperCase();
  }

  distancia(m: number | null): string {
    if (m == null) return '';
    return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
  }

  zonaNombre(id: number | null): string {
    if (id == null) return 'Sin zona';
    return this.zonas().find(z => z.id === id)?.nombre ?? 'Sin zona';
  }

  confianza(c: number | null): string {
    if (c == null) return '';
    const v = c <= 1 ? c * 100 : c;
    return `${Math.round(v)} %`;
  }

  leerTexto(e: Event): string { return (e.target as HTMLInputElement | HTMLSelectElement).value; }
}
