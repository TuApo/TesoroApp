import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subject, firstValueFrom, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import QRCode from 'qrcode';

import { ComunicacionesApiService } from '../../../comunicaciones/service/comunicaciones-api.service';
import { UsuarioDir } from '../../../comunicaciones/modelos';
import { Finca, Miembro, PersonaMin, Zona } from '../../campo.models';
import { CampoApiService } from '../../services/campo-api.service';
import { CampoService, mensajeDe } from '../../services/campo.service';
import { CirculoMapa, MapaCampoComponent, MarcadorMapa } from '../../components/mapa-campo/mapa-campo.component';

type Pestana = 'fincas' | 'zonas';

/** Lo que se edita de una finca (el resto lo calcula el servidor). */
interface FormFinca {
  nombre: string; zona_id: number | null; lat: number | null; lon: number | null; radio_m: number;
  direccion: string; notas: string; activa: boolean;
}

interface FormZona { id: number | null; nombre: string; color: string; sede: string; descripcion: string; activa: boolean }

/** Cartel QR listo para mostrar o imprimir. */
interface CartelQr { finca_id: number; nombre: string; zona: string | null; contenido: string; version: number; imagen: string }

/** Persona que se puede agregar (del equipo o de toda la plataforma). */
interface Candidato { id: string; nombre: string; detalle: string | null }

const RADIO_MIN = 30;
const RADIO_MAX = 2000;
const COLOR_DEFECTO = '#2563EB';

/**
 * Parametrización del trabajo de campo (`/dashboard/campo/fincas`): fincas y zonas.
 *
 * Solo administración edita; supervisores y coordinadores la ven en modo consulta.
 * Al elegir una finca se ve en el mapa con su geocerca: un toque en el mapa mueve el
 * alfiler. Si un coordinador propuso la ubicación al marcar (finca sin ubicar), se
 * pinta punteada para aceptarla con un botón.
 *
 * El QR de cada finca se imprime como cartel tamaño carta; regenerarlo invalida los
 * carteles ya pegados (el teléfono compara la huella del token).
 */
@Component({
  selector: 'app-campo-fincas',
  standalone: true,
  imports: [FormsModule, MatIconModule, MapaCampoComponent],
  templateUrl: './fincas.component.html',
  styleUrls: ['../../campo-ui.css', './fincas.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FincasComponent {
  private readonly api = inject(CampoApiService);
  private readonly com = inject(ComunicacionesApiService);
  private readonly destroy = inject(DestroyRef);
  readonly campo = inject(CampoService);

  readonly RADIO_MIN = RADIO_MIN;
  readonly RADIO_MAX = RADIO_MAX;

  readonly admin = computed(() => this.campo.paquete()?.perfil === 'ADMIN');
  readonly tiles = computed(() => this.campo.paquete()?.config?.tiles_url || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  readonly atribucion = computed(() => this.campo.paquete()?.config?.tiles_atribucion || '© OpenStreetMap');

  readonly pestana = signal<Pestana>('fincas');
  readonly fincas = signal<Finca[]>([]);
  readonly zonas = signal<Zona[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<{ texto: string; tipo: 'ok' | 'mal' } | null>(null);
  readonly trabajando = signal(false);

  // ─── Filtros ────────────────────────────────────────────────────────────
  readonly texto = signal('');
  /** '' = todas, 'sin' = sin zona, o el id de la zona. */
  readonly filtroZona = signal<string>('');
  readonly soloSinUbicar = signal(false);
  readonly soloPropuesta = signal(false);
  readonly verInactivas = signal(false);

  readonly filtradas = computed(() => {
    const q = normalizar(this.texto());
    const z = this.filtroZona();
    return this.fincas().filter(f => {
      if (!this.verInactivas() && !f.activa) return false;
      if (z === 'sin' && f.zona_id != null) return false;
      if (z && z !== 'sin' && String(f.zona_id) !== z) return false;
      if (this.soloSinUbicar() && f.lat != null && f.lon != null) return false;
      if (this.soloPropuesta() && f.propuesta_lat == null) return false;
      if (q && !normalizar(`${f.nombre} ${f.clave} ${f.direccion ?? ''} ${f.zona_nombre ?? ''}`).includes(q)) return false;
      return true;
    });
  });
  readonly totalSinUbicar = computed(() => this.fincas().filter(f => f.activa && (f.lat == null || f.lon == null)).length);
  readonly totalPropuestas = computed(() => this.fincas().filter(f => f.propuesta_lat != null).length);
  readonly zonaFiltrada = computed(() => {
    const z = this.filtroZona();
    return z && z !== 'sin' ? this.zonas().find(x => String(x.id) === z) ?? null : null;
  });

  // ─── Finca elegida ──────────────────────────────────────────────────────
  readonly seleccionId = signal<number | null>(null);
  readonly seleccion = computed(() => this.fincas().find(f => f.id === this.seleccionId()) ?? null);
  readonly form = signal<FormFinca | null>(null);
  readonly vista = signal<{ lat: number; lon: number; zoom?: number } | null>(null);

  readonly cambios = computed(() => {
    const f = this.seleccion(), v = this.form();
    if (!f || !v) return false;
    return f.nombre !== v.nombre || f.zona_id !== v.zona_id || f.lat !== v.lat || f.lon !== v.lon || f.radio_m !== v.radio_m
      || (f.direccion ?? '') !== v.direccion || (f.notas ?? '') !== v.notas || f.activa !== v.activa;
  });

  readonly marcadores = computed<MarcadorMapa[]>(() => {
    const sel = this.seleccion(), v = this.form();
    const out: MarcadorMapa[] = [];
    // De contexto, las demás fincas ubicadas (tenues): tocarlas las abre.
    for (const f of this.fincas()) {
      if (f.id === sel?.id || f.lat == null || f.lon == null || !f.activa) continue;
      out.push({ id: `f${f.id}`, lat: f.lat, lon: f.lon, tipo: 'finca', color: f.zona_color || COLOR_DEFECTO, etiqueta: f.nombre, tenue: true });
    }
    if (sel && sel.propuesta_lat != null && sel.propuesta_lon != null) {
      out.push({ id: 'propuesta', lat: sel.propuesta_lat, lon: sel.propuesta_lon, tipo: 'punto', color: '#F59E0B',
        etiqueta: `Propuesta de ${sel.propuesta_por_nombre ?? 'un coordinador'}` });
    }
    if (sel && v && v.lat != null && v.lon != null) {
      out.push({ id: 'actual', lat: v.lat, lon: v.lon, tipo: 'finca', color: sel.zona_color || COLOR_DEFECTO, etiqueta: v.nombre, seleccionado: true });
    }
    return out;
  });

  readonly circulos = computed<CirculoMapa[]>(() => {
    const sel = this.seleccion(), v = this.form();
    const out: CirculoMapa[] = [];
    if (sel && sel.propuesta_lat != null && sel.propuesta_lon != null) {
      out.push({ lat: sel.propuesta_lat, lon: sel.propuesta_lon, radioM: v?.radio_m ?? sel.radio_m, color: '#F59E0B', punteado: true });
    }
    if (sel && v && v.lat != null && v.lon != null) {
      const color = this.zonas().find(z => z.id === v.zona_id)?.color || sel.zona_color || COLOR_DEFECTO;
      out.push({ lat: v.lat, lon: v.lon, radioM: v.radio_m, color });
    }
    return out;
  });

  // ─── Coordinadores de la finca ──────────────────────────────────────────
  readonly equipo = signal<Miembro[]>([]);
  private equipoPedido = false;
  readonly buscarCoord = signal('');
  readonly resultadosPlataforma = signal<UsuarioDir[]>([]);
  readonly buscandoPlataforma = signal(false);
  private readonly consulta$ = new Subject<string>();

  readonly candidatos = computed<Candidato[]>(() => {
    const q = normalizar(this.buscarCoord());
    if (q.length < 2) return [];
    const ya = new Set((this.seleccion()?.coordinadores ?? []).map(c => c.id));
    const out = new Map<string, Candidato>();
    for (const m of this.equipo()) {
      if (ya.has(m.usuario_id) || !normalizar(m.nombre).includes(q)) continue;
      out.set(m.usuario_id, { id: m.usuario_id, nombre: m.nombre, detalle: [m.cargo_campo, m.zona_nombre].filter(Boolean).join(' · ') || null });
    }
    for (const u of this.resultadosPlataforma()) {
      if (ya.has(u.id) || out.has(u.id)) continue;
      out.set(u.id, { id: u.id, nombre: u.nombre, detalle: [u.cargo || u.rol, u.sede].filter(Boolean).join(' · ') || null });
    }
    return [...out.values()].slice(0, 12);
  });

  // ─── Hojas ──────────────────────────────────────────────────────────────
  readonly cartel = signal<CartelQr | null>(null);
  readonly cargandoQr = signal(false);
  readonly nuevaFinca = signal<{ nombre: string; zona_id: number | null } | null>(null);
  readonly formZona = signal<FormZona | null>(null);
  readonly imprimiendoZona = signal<string | null>(null);

  private relojAviso: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.campo.iniciar();
    this.cargar();
    this.consulta$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => {
        if (q.trim().length < 3) { this.buscandoPlataforma.set(false); return of([] as UsuarioDir[]); }
        this.buscandoPlataforma.set(true);
        return this.com.buscarPersonas(q.trim(), 20).pipe(catchError(() => of([] as UsuarioDir[])));
      }),
      takeUntilDestroyed(this.destroy),
    ).subscribe(r => { this.resultadosPlataforma.set(r); this.buscandoPlataforma.set(false); });
  }

  // ─── Carga ──────────────────────────────────────────────────────────────

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.api.fincas(true).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: l => { this.fincas.set(ordenarPorNombre(l)); this.cargando.set(false); },
      error: e => { this.error.set(mensajeDe(e, 'No se pudieron cargar las fincas')); this.cargando.set(false); },
    });
    this.cargarZonas();
  }

  private cargarZonas(): void {
    this.api.zonas().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: z => this.zonas.set([...z].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))),
      error: e => this.avisar(mensajeDe(e, 'No se pudieron cargar las zonas'), 'mal'),
    });
  }

  private cargarEquipo(): void {
    if (this.equipoPedido) return;
    this.equipoPedido = true;
    this.api.jerarquia().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: l => this.equipo.set(l),
      error: () => { this.equipoPedido = false; },
    });
  }

  sincronizar(): void {
    this.trabajando.set(true);
    this.api.sincronizarFincas().subscribe({
      next: r => {
        this.trabajando.set(false);
        this.avisar(r.nuevas === 0 ? 'El directorio no tiene fincas nuevas' :
          r.nuevas === 1 ? 'Se trajo 1 finca nueva del directorio' : `Se trajeron ${r.nuevas} fincas nuevas del directorio`, 'ok');
        this.cargar();
      },
      error: e => { this.trabajando.set(false); this.avisar(mensajeDe(e, 'No se pudieron traer las fincas del directorio'), 'mal'); },
    });
  }

  // ─── Selección y edición ────────────────────────────────────────────────

  elegir(f: Finca): void {
    this.seleccionId.set(f.id);
    this.form.set(aForm(f));
    this.buscarCoord.set('');
    this.resultadosPlataforma.set([]);
    if (f.lat != null && f.lon != null) this.vista.set({ lat: f.lat, lon: f.lon, zoom: 16 });
    else if (f.propuesta_lat != null && f.propuesta_lon != null) this.vista.set({ lat: f.propuesta_lat, lon: f.propuesta_lon, zoom: 16 });
    else {
      // Sin ubicación: se centra en otra finca de la misma zona para empezar cerca.
      const vecina = this.fincas().find(x => x.zona_id === f.zona_id && x.lat != null && x.lon != null)
        ?? this.fincas().find(x => x.lat != null && x.lon != null);
      if (vecina?.lat != null && vecina.lon != null) this.vista.set({ lat: vecina.lat, lon: vecina.lon, zoom: 13 });
    }
    if (this.admin()) this.cargarEquipo();
  }

  cerrarFinca(): void {
    if (this.cambios() && !confirm('Hay cambios sin guardar. ¿Salir de todos modos?')) return;
    this.seleccionId.set(null);
    this.form.set(null);
  }

  poner<K extends keyof FormFinca>(campo: K, valor: FormFinca[K]): void {
    this.form.update(f => f && { ...f, [campo]: valor });
  }

  ponerRadio(valor: unknown): void {
    const n = Math.round(Number(valor));
    if (!Number.isFinite(n)) return;
    this.poner('radio_m', Math.max(RADIO_MIN, Math.min(RADIO_MAX, n)));
  }

  ponerCoordenada(campo: 'lat' | 'lon', valor: unknown): void {
    const n = valor === '' || valor == null ? null : Number(valor);
    this.poner(campo, n == null || !Number.isFinite(n) ? null : n);
  }

  tocarMapa(p: { lat: number; lon: number }): void {
    if (!this.admin() || !this.form()) return;
    this.form.update(f => f && { ...f, lat: redondear(p.lat), lon: redondear(p.lon) });
  }

  tocarMarcador(id: string): void {
    if (!id.startsWith('f')) return;
    const f = this.fincas().find(x => `f${x.id}` === id);
    if (!f) return;
    if (this.cambios() && !confirm('Hay cambios sin guardar en esta finca. ¿Abrir la otra de todos modos?')) return;
    this.elegir(f);
  }

  quitarUbicacion(): void {
    this.form.update(f => f && { ...f, lat: null, lon: null });
  }

  deshacer(): void {
    const f = this.seleccion();
    if (f) this.form.set(aForm(f));
  }

  guardar(): void {
    const f = this.seleccion(), v = this.form();
    if (!f || !v) return;
    if (!v.nombre.trim()) { this.avisar('La finca necesita un nombre', 'mal'); return; }
    if ((v.lat == null) !== (v.lon == null)) { this.avisar('Falta la latitud o la longitud', 'mal'); return; }
    this.trabajando.set(true);
    this.api.editarFinca(f.id, {
      nombre: v.nombre.trim(), zona_id: v.zona_id, lat: v.lat, lon: v.lon, radio_m: v.radio_m,
      direccion: v.direccion.trim() || null, notas: v.notas.trim() || null, activa: v.activa,
      quitar_zona: v.zona_id == null && f.zona_id != null,
      quitar_ubicacion: v.lat == null && f.lat != null,
    }).subscribe({
      next: r => { this.trabajando.set(false); this.reemplazar(r); this.form.set(aForm(r)); this.avisar('Finca guardada', 'ok'); this.cargarZonas(); },
      error: e => { this.trabajando.set(false); this.avisar(mensajeDe(e, 'No se pudo guardar la finca'), 'mal'); },
    });
  }

  aceptarPropuesta(): void {
    const f = this.seleccion();
    if (!f) return;
    this.trabajando.set(true);
    this.api.editarFinca(f.id, { aceptar_propuesta: true }).subscribe({
      next: r => {
        this.trabajando.set(false);
        this.reemplazar(r);
        this.form.set(aForm(r));
        if (r.lat != null && r.lon != null) this.vista.set({ lat: r.lat, lon: r.lon, zoom: 16 });
        this.avisar('Ubicación aceptada', 'ok');
      },
      error: e => { this.trabajando.set(false); this.avisar(mensajeDe(e, 'No se pudo aceptar la propuesta'), 'mal'); },
    });
  }

  private reemplazar(r: Finca): void {
    this.fincas.update(l => l.some(x => x.id === r.id) ? l.map(x => x.id === r.id ? r : x) : ordenarPorNombre([...l, r]));
  }

  // ─── Coordinadores ──────────────────────────────────────────────────────

  escribirCoord(q: string): void {
    this.buscarCoord.set(q);
    this.consulta$.next(q);
  }

  agregarCoordinador(c: Candidato): void {
    const f = this.seleccion();
    if (!f) return;
    this.asignar(f, [...f.coordinadores.map(x => x.id), c.id], `${c.nombre} quedó asignado a la finca`);
    this.buscarCoord.set('');
    this.resultadosPlataforma.set([]);
  }

  quitarCoordinador(p: PersonaMin): void {
    const f = this.seleccion();
    if (!f) return;
    this.asignar(f, f.coordinadores.filter(x => x.id !== p.id).map(x => x.id), `${p.nombre} ya no coordina esta finca`);
  }

  private asignar(f: Finca, usuarios: string[], ok: string): void {
    this.trabajando.set(true);
    this.api.asignarCoordinadores(f.id, usuarios).subscribe({
      next: r => { this.trabajando.set(false); this.reemplazar(r); this.avisar(ok, 'ok'); },
      error: e => { this.trabajando.set(false); this.avisar(mensajeDe(e, 'No se pudieron cambiar los coordinadores'), 'mal'); },
    });
  }

  // ─── QR ─────────────────────────────────────────────────────────────────

  async abrirQr(): Promise<void> {
    const f = this.seleccion();
    if (!f) return;
    this.cargandoQr.set(true);
    try {
      const q = await firstValueFrom(this.api.qr(f.id));
      this.cartel.set(await armarCartel(q, f.zona_nombre));
    } catch (e) {
      this.avisar(mensajeDe(e, 'No se pudo generar el QR de la finca'), 'mal');
    } finally {
      this.cargandoQr.set(false);
    }
  }

  async regenerarQr(): Promise<void> {
    const c = this.cartel();
    if (!c) return;
    if (!confirm('Al regenerar el QR, los carteles que ya están impresos y pegados en la finca dejan de servir. ¿Continuar?')) return;
    this.cargandoQr.set(true);
    try {
      const q = await firstValueFrom(this.api.regenerarQr(c.finca_id));
      this.cartel.set(await armarCartel(q, c.zona));
      this.fincas.update(l => l.map(x => x.id === c.finca_id ? { ...x, qr_version: q.version } : x));
      this.avisar('QR nuevo generado: imprime y pega el cartel nuevo', 'ok');
    } catch (e) {
      this.avisar(mensajeDe(e, 'No se pudo regenerar el QR'), 'mal');
    } finally {
      this.cargandoQr.set(false);
    }
  }

  imprimirCartel(): void {
    const c = this.cartel();
    if (c) imprimir(documentoCarteles([c]));
  }

  async imprimirZona(): Promise<void> {
    const z = this.zonaFiltrada();
    if (!z) return;
    const lista = this.fincas().filter(f => f.zona_id === z.id && f.activa);
    if (!lista.length) { this.avisar('La zona no tiene fincas activas', 'mal'); return; }
    if (lista.length > 40 && !confirm(`Se van a generar ${lista.length} carteles (una hoja por finca). ¿Continuar?`)) return;
    const carteles: CartelQr[] = [];
    try {
      for (const [i, f] of lista.entries()) {
        this.imprimiendoZona.set(`Preparando ${i + 1} de ${lista.length}…`);
        carteles.push(await armarCartel(await firstValueFrom(this.api.qr(f.id)), z.nombre));
      }
      imprimir(documentoCarteles(carteles));
    } catch (e) {
      this.avisar(mensajeDe(e, 'No se pudieron preparar los carteles de la zona'), 'mal');
    } finally {
      this.imprimiendoZona.set(null);
    }
  }

  // ─── Crear finca ────────────────────────────────────────────────────────

  abrirNuevaFinca(): void {
    const z = this.zonaFiltrada();
    this.nuevaFinca.set({ nombre: '', zona_id: z?.id ?? null });
  }

  ponerNueva(campo: 'nombre' | 'zona_id', valor: string | number | null): void {
    this.nuevaFinca.update(n => n && { ...n, [campo]: valor });
  }

  crearFinca(): void {
    const n = this.nuevaFinca();
    if (!n || !n.nombre.trim()) { this.avisar('Escribe el nombre de la finca', 'mal'); return; }
    this.trabajando.set(true);
    this.api.crearFinca({ nombre: n.nombre.trim(), zona_id: n.zona_id, radio_m: this.campo.paquete()?.config?.radio_defecto_m }).subscribe({
      next: f => {
        this.trabajando.set(false);
        this.nuevaFinca.set(null);
        this.reemplazar(f);
        this.elegir(f);
        this.avisar('Finca creada: toca el mapa para ubicarla', 'ok');
      },
      error: e => { this.trabajando.set(false); this.avisar(mensajeDe(e, 'No se pudo crear la finca'), 'mal'); },
    });
  }

  // ─── Zonas ──────────────────────────────────────────────────────────────

  abrirZona(z: Zona | null): void {
    this.formZona.set(z
      ? { id: z.id, nombre: z.nombre, color: z.color || COLOR_DEFECTO, sede: z.sede ?? '', descripcion: z.descripcion ?? '', activa: z.activa }
      : { id: null, nombre: '', color: COLOR_DEFECTO, sede: '', descripcion: '', activa: true });
  }

  ponerZona<K extends keyof FormZona>(campo: K, valor: FormZona[K]): void {
    this.formZona.update(z => z && { ...z, [campo]: valor });
  }

  guardarZona(): void {
    const z = this.formZona();
    if (!z) return;
    if (!z.nombre.trim()) { this.avisar('La zona necesita un nombre', 'mal'); return; }
    this.trabajando.set(true);
    this.api.guardarZona(z.id, {
      nombre: z.nombre.trim(), color: z.color, sede: z.sede.trim() || null, descripcion: z.descripcion.trim() || null, activa: z.activa,
    }).subscribe({
      next: () => {
        this.trabajando.set(false);
        this.formZona.set(null);
        this.avisar(z.id == null ? 'Zona creada' : 'Zona guardada', 'ok');
        this.cargar();
      },
      error: e => { this.trabajando.set(false); this.avisar(mensajeDe(e, 'No se pudo guardar la zona'), 'mal'); },
    });
  }

  borrarZona(z: Zona): void {
    const extra = z.fincas ? ` Sus ${z.fincas} finca(s) quedarán sin zona.` : '';
    if (!confirm(`¿Borrar la zona «${z.nombre}»?${extra}`)) return;
    this.trabajando.set(true);
    this.api.borrarZona(z.id).subscribe({
      next: () => {
        this.trabajando.set(false);
        this.formZona.set(null);
        if (this.filtroZona() === String(z.id)) this.filtroZona.set('');
        this.avisar('Zona borrada', 'ok');
        this.cargar();
      },
      error: e => { this.trabajando.set(false); this.avisar(mensajeDe(e, 'No se pudo borrar la zona'), 'mal'); },
    });
  }

  // ─── Utilidades de plantilla ────────────────────────────────────────────

  iniciales(nombre: string): string { return iniciales(nombre); }

  zonaPorId(id: number | null): Zona | null { return id == null ? null : this.zonas().find(z => z.id === id) ?? null; }

  avisar(texto: string, tipo: 'ok' | 'mal'): void {
    this.aviso.set({ texto, tipo });
    if (this.relojAviso) clearTimeout(this.relojAviso);
    this.relojAviso = setTimeout(() => this.aviso.set(null), 5000);
  }
}

// ─── Funciones puras ─────────────────────────────────────────────────────

function aForm(f: Finca): FormFinca {
  return {
    nombre: f.nombre, zona_id: f.zona_id, lat: f.lat, lon: f.lon, radio_m: f.radio_m || 100,
    direccion: f.direccion ?? '', notas: f.notas ?? '', activa: f.activa,
  };
}

function ordenarPorNombre(l: Finca[]): Finca[] {
  return [...l].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function redondear(n: number): number { return Math.round(n * 1e6) / 1e6; }

export function iniciales(nombre: string | null | undefined): string {
  const p = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
}

async function armarCartel(q: { finca_id: number; nombre: string; contenido: string; version: number }, zona: string | null): Promise<CartelQr> {
  const imagen = await QRCode.toDataURL(q.contenido, { width: 640, margin: 1, errorCorrectionLevel: 'M' });
  return { finca_id: q.finca_id, nombre: q.nombre, zona, contenido: q.contenido, version: q.version, imagen };
}

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** HTML imprimible tamaño carta: una hoja por finca. */
function documentoCarteles(carteles: CartelQr[]): string {
  const hojas = carteles.map(c => `
    <section class="hoja">
      <div class="marca">TuApo · Trabajo de campo</div>
      <h1>${esc(c.nombre)}</h1>
      ${c.zona ? `<div class="zona">${esc(c.zona)}</div>` : ''}
      <img src="${c.imagen}" alt="QR de ${esc(c.nombre)}" />
      <p class="instr">Escanea con la app TuApo al llegar y al salir</p>
      <p class="pie">Finca #${c.finca_id} · Versión ${c.version} del QR · No lo dobles ni lo tapes</p>
    </section>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Carteles QR</title>
    <style>
      @page { size: letter portrait; margin: 16mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111827; }
      .hoja { height: calc(279.4mm - 32mm); display: flex; flex-direction: column; align-items: center; justify-content: center;
              text-align: center; page-break-after: always; break-after: page; }
      .hoja:last-child { page-break-after: auto; break-after: auto; }
      .marca { font-size: 14pt; color: #4B5563; letter-spacing: .04em; text-transform: uppercase; }
      h1 { font-size: 34pt; margin: 6mm 0 2mm; line-height: 1.1; }
      .zona { font-size: 16pt; color: #374151; }
      img { width: 140mm; height: 140mm; margin: 8mm 0; image-rendering: pixelated; }
      .instr { font-size: 22pt; font-weight: 700; margin: 0; }
      .pie { font-size: 11pt; color: #6B7280; margin-top: 6mm; }
    </style></head><body>${hojas}</body></html>`;
}

/**
 * Imprime desde un iframe oculto: no lo bloquea el bloqueador de ventanas (la impresión de
 * una zona llega después de varias peticiones y window.open ya no contaría como gesto).
 */
function imprimir(html: string): void {
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  marco.onload = () => {
    const w = marco.contentWindow;
    if (!w) return;
    setTimeout(() => { w.focus(); w.print(); }, 250);
    setTimeout(() => marco.remove(), 60_000);
  };
  document.body.appendChild(marco);
  marco.srcdoc = html;
}
