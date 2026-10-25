import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import {
  CATEGORIA_ACTIVO, COLOR_TIPO, CroquisSvg, leerMetaAreas, leerPisos, serializarCroquis, siguienteCodigoActivo,
} from '../../components/croquis-svg/croquis-svg';
import { Plano3d } from '../../components/plano-3d/plano-3d';
import type { CambioPlano, SeleccionPlano, VistaCamara } from '../../components/plano-3d/motor-plano-3d';
import {
  ActivoCroquis, Area, Croquis, ElementoCroquis, EstadoActivo, FormaArea, MetaArea, ModoLuz, Oficina, PisoCroquis, TipoArea, TurnosService,
} from '../../service/turnos.service';
import { EndpointMon, MonitoreoService } from '../../../activos-monitoreo/monitoreo.service';

type Herramienta = 'seleccionar' | TipoArea | ElementoCroquis['tipo'] | 'SILLA2' | 'SILLA3' | 'SILLA4';
type Seleccion = { tipo: 'area' | 'elemento'; id: string } | null;
type Arrastre = { modo: 'mover' | 'redimensionar' | 'rotar'; sel: NonNullable<Seleccion>; x0: number; y0: number; ox: number; oy: number; ow: number; oh: number; cx: number; cy: number; rot0: number; ang0: number };
type Estado = { areas: Area[]; pisos: PisoCroquis[]; meta: Record<string, MetaArea> };

/** Tamaños reales por tipo de área (metros) al crearla con un clic. */
const TAMANO_AREA_M: Record<string, [number, number]> = {
  RECEPCION: [3, 2], MODULO: [2, 1.5], VENTANILLA: [1.5, 1], PUESTO: [1.6, 1.2], OFICINA: [3, 3],
  AREA_ATENCION: [5, 4], SALA_ESPERA: [5, 4], PASILLO: [6, 1.5], BANO: [2, 2], SALIDA: [1.2, 0.6],
  ENTRADA: [1.2, 0.6], ESCALERA: [3, 1.2], ASCENSOR: [1.8, 1.8], OTRO: [2, 2],
};
/** Tamaños reales por mueble (metros). */
const TAMANO_ELEMENTO_M: Record<string, [number, number]> = {
  PARED: [4, 0.15], PUERTA: [0.9, 0.9], VENTANA: [1.5, 0.15], SILLA: [0.55, 0.55], MOSTRADOR: [2.4, 0.7],
  MESA: [1.6, 0.8], FLECHA: [2, 0.4], TEXTO: [3, 0.5], PLANTA: [0.6, 0.6], ICONO: [0.6, 0.6],
  LUZ: [0.4, 0.4], ARCHIVADOR: [0.5, 0.6], ESTANTE: [1.2, 0.4], SOFA: [1.8, 0.8], PANTALLA: [1.2, 0.12],
  CAMARA: [0.3, 0.3], EQUIPO: [1.2, 0.7], MODELO3D: [1, 1],
};
/** Capacidad por defecto: cuántas personas atienden en un área de ese tipo. */
const CAPACIDAD_TIPO: Record<string, number> = {
  RECEPCION: 1, MODULO: 1, VENTANILLA: 1, PUESTO: 1, OFICINA: 1, AREA_ATENCION: 4,
};
/** Muebles que al crearse ya nacen como activo de la empresa (con su placa). */
const PISO_VACIO: PisoCroquis = { id: 'p1', nombre: 'Piso 1', ancho: 1000, alto: 700, elementos: [] };
const NACE_ACTIVO = new Set(['MESA', 'SILLA', 'MOSTRADOR', 'ARCHIVADOR', 'ESTANTE', 'SOFA', 'PANTALLA', 'EQUIPO', 'CAMARA']);
const GRUPO_OBJETO: Record<string, string> = {
  PARED: 'Paredes, puertas y ventanas', PUERTA: 'Paredes, puertas y ventanas', VENTANA: 'Paredes, puertas y ventanas',
  MESA: 'Muebles', SILLA: 'Muebles', MOSTRADOR: 'Muebles', ARCHIVADOR: 'Muebles', ESTANTE: 'Muebles', SOFA: 'Muebles', PLANTA: 'Muebles', MODELO3D: 'Muebles',
  LUZ: 'Luces, pantallas y equipos', PANTALLA: 'Luces, pantallas y equipos', EQUIPO: 'Luces, pantallas y equipos', CAMARA: 'Luces, pantallas y equipos',
  TEXTO: 'Señalización', FLECHA: 'Señalización', ICONO: 'Señalización',
};

export interface FilaActivo { id: string; pisoId: string; piso: string; tipo: string; nombreTipo: string; ubicacion: string; a: ActivoCroquis; unidades: number }

/**
 * La mesa de trabajo del plano de la oficina: dibujarlo con medidas reales, en varios pisos,
 * decir qué hay en cada lado y llevar el inventario de lo que hay ahí.
 *
 * <p>3D PRIMERO: se edita sobre el plano en 3D (colocar con un clic, arrastrar para mover, el
 * anillo azul gira, la bola cambia el tamaño, las paredes se dibujan tramo a tramo). El 2D
 * (el mismo dibujo del cartel y del televisor) queda como segunda vista, con todo lo mismo.
 *
 * <p>LAS ÁREAS SON LOS PUESTOS. Un área con capacidad N genera al guardar N puntos de atención.
 * Lo demás (paredes, muebles, luces, textos) viaja como JSON por piso; los muebles pueden llevar
 * su ficha de activo (código de placa, estado, responsable…) y se listan en el inventario.
 *
 * <p>Guardado completo: se manda todo y se sustituye lo que había. Un plano ya publicado no se
 * toca: guardar abre versión nueva. Las versiones viejas se ven en solo lectura (las áreas son
 * siempre las vigentes: guardar una versión vieja dejaría la oficina sin puestos).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-croquis-editor',
  imports: [CommonModule, FormsModule, MatIconModule, MatTooltipModule, CroquisSvg, Plano3d, ...TABLA_ESTANDAR],
  templateUrl: './croquis-editor.html',
  styleUrls: ['../../styles/turnos-comun.css', './croquis-editor.css'],
})
export class CroquisEditor implements OnInit {
  readonly id = input.required<string>();

  private api = inject(TurnosService);
  private monitoreo = inject(MonitoreoService);
  private router = inject(Router);
  readonly lienzo = viewChild<ElementRef<HTMLElement>>('lienzo');
  readonly plano3d = viewChild(Plano3d);
  readonly previewCamara = viewChild<ElementRef<HTMLCanvasElement>>('previewCamara');

  readonly oficina = signal<Oficina | null>(null);
  readonly croquis = signal<Croquis | null>(null);
  readonly versiones = signal<Croquis[]>([]);
  readonly areas = signal<Area[]>([]);
  readonly pisos = signal<PisoCroquis[]>([]);
  readonly meta = signal<Record<string, MetaArea>>({});
  readonly pisoId = signal<string>('p1');
  readonly fondoColor = signal('#FFFFFF');
  readonly nombre = signal('Croquis');
  readonly escala = signal(2);
  readonly herramienta = signal<Herramienta>('seleccionar');
  readonly seleccion = signal<Seleccion>(null);
  readonly cuadricula = signal(true);
  readonly regla = signal(true);
  readonly cotas = signal(true);
  readonly ajustar = signal(true);
  readonly zoom = signal(1);
  readonly sucio = signal(false);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly renombrandoPiso = signal<string | null>(null);
  nombrePisoTemporal = '';

  /** 3D es la vista principal; la elección se recuerda en este navegador. */
  readonly modo = signal<'3d' | '2d'>(leerModo());
  /** La pista de manejo del 3D; se cierra con la × y vuelve con el botón de ayuda. */
  readonly pista = signal(leerPista());
  /** Paredes a media altura en el editor (vista «casa de muñecas»): no tapan lo que hay detrás. */
  readonly paredesBajas = signal(leerBandera('croquis:paredes-bajas', true));
  readonly sin3d = signal<string | null>(null);
  readonly calidad3d = signal<'alta' | 'baja'>('alta');
  readonly panel = signal<'props' | 'objetos'>('props');
  readonly filtroObjetos = signal('');
  readonly inventarioAbierto = signal(false);
  readonly endpoints = signal<EndpointMon[]>([]);
  readonly estadosEquipos = signal<Map<string, string>>(new Map());

  readonly TIPOS_AREA: { tipo: TipoArea; icono: string; nombre: string; ayuda: string }[] = [
    { tipo: 'OFICINA', icono: 'business_center', nombre: 'Oficina privada', ayuda: 'Un puesto: quien la abre atiende ahí' },
    { tipo: 'PUESTO', icono: 'desk', nombre: 'Puesto', ayuda: 'Un escritorio de atención' },
    { tipo: 'AREA_ATENCION', icono: 'groups', nombre: 'Área compartida', ayuda: 'Varias personas atienden (capacidad)' },
    { tipo: 'MODULO', icono: 'meeting_room', nombre: 'Módulo', ayuda: 'Un puesto' },
    { tipo: 'VENTANILLA', icono: 'storefront', nombre: 'Ventanilla', ayuda: 'Un puesto' },
    { tipo: 'RECEPCION', icono: 'support_agent', nombre: 'Recepción', ayuda: 'Un puesto' },
    { tipo: 'PASILLO', icono: 'directions_walk', nombre: 'Pasillo / apoyo', ayuda: 'Apoyo móvil: sin escritorio fijo' },
    { tipo: 'SALA_ESPERA', icono: 'chair', nombre: 'Sala de espera', ayuda: 'No atiende' },
    { tipo: 'BANO', icono: 'wc', nombre: 'Baño', ayuda: '' },
    { tipo: 'ENTRADA', icono: 'login', nombre: 'Entrada', ayuda: '' },
    { tipo: 'SALIDA', icono: 'logout', nombre: 'Salida', ayuda: '' },
    { tipo: 'ESCALERA', icono: 'stairs', nombre: 'Escalera', ayuda: 'Diga si sube o baja y a qué piso' },
    { tipo: 'ASCENSOR', icono: 'elevator', nombre: 'Ascensor', ayuda: '' },
    { tipo: 'OTRO', icono: 'category', nombre: 'Otra área', ayuda: '' },
  ];
  readonly GRUPOS_ELEMENTO: { titulo: string; items: { tipo: Herramienta; icono: string; nombre: string; ayuda?: string }[] }[] = [
    { titulo: 'Construcción', items: [
      { tipo: 'PARED', icono: 'horizontal_rule', nombre: 'Pared', ayuda: 'En 3D: clic en el inicio y clic en el final; sigue encadenando. Doble clic o Esc termina.' },
      { tipo: 'PUERTA', icono: 'door_front', nombre: 'Puerta' },
      { tipo: 'VENTANA', icono: 'window', nombre: 'Ventana' },
    ] },
    { titulo: 'Muebles', items: [
      { tipo: 'MESA', icono: 'table_restaurant', nombre: 'Escritorio / mesa' },
      { tipo: 'SILLA', icono: 'chair_alt', nombre: 'Silla ×1' },
      { tipo: 'SILLA2', icono: 'weekend', nombre: 'Sillas ×2' },
      { tipo: 'SILLA3', icono: 'weekend', nombre: 'Sillas ×3' },
      { tipo: 'SILLA4', icono: 'weekend', nombre: 'Sillas ×4' },
      { tipo: 'MOSTRADOR', icono: 'countertops', nombre: 'Mostrador' },
      { tipo: 'ARCHIVADOR', icono: 'inventory_2', nombre: 'Archivador' },
      { tipo: 'ESTANTE', icono: 'shelves', nombre: 'Estante' },
      { tipo: 'SOFA', icono: 'chair', nombre: 'Sofá / banca' },
      { tipo: 'PLANTA', icono: 'potted_plant', nombre: 'Planta' },
    ] },
    { titulo: 'Luces y equipos', items: [
      { tipo: 'LUZ', icono: 'lightbulb', nombre: 'Luz', ayuda: 'Ilumina en 3D; puede parpadear. Al llamar un turno, las luces del área destino parpadean.' },
      { tipo: 'PANTALLA', icono: 'tv', nombre: 'Pantalla / TV' },
      { tipo: 'EQUIPO', icono: 'computer', nombre: 'Equipo de cómputo' },
      { tipo: 'CAMARA', icono: 'videocam', nombre: 'Cámara' },
      { tipo: 'MODELO3D', icono: 'view_in_ar', nombre: 'Modelo 3D (URL)' },
    ] },
    { titulo: 'Señalización', items: [
      { tipo: 'FLECHA', icono: 'arrow_right_alt', nombre: 'Flecha' },
      { tipo: 'TEXTO', icono: 'title', nombre: 'Texto' },
      { tipo: 'ICONO', icono: 'emoji_symbols', nombre: 'Icono' },
    ] },
  ];
  readonly FORMAS: FormaArea[] = ['RECTANGULO', 'REDONDEADO', 'CIRCULO'];
  readonly ICONOS = ['place', 'desk', 'print', 'local_cafe', 'wifi', 'accessible', 'local_parking', 'restaurant', 'phone', 'info', 'emergency', 'fire_extinguisher', 'water_drop', 'elevator'];
  readonly MODOS_LUZ: { valor: ModoLuz; nombre: string }[] = [
    { valor: 'FIJA', nombre: 'Fija' }, { valor: 'PARPADEO', nombre: 'Parpadeo' }, { valor: 'RESPIRA', nombre: 'Respira (suave)' }, { valor: 'APAGADA', nombre: 'Apagada' },
  ];
  readonly ESTADOS_ACTIVO: { valor: EstadoActivo; nombre: string }[] = [
    { valor: 'BUENO', nombre: 'Bueno' }, { valor: 'REGULAR', nombre: 'Regular' }, { valor: 'DANADO', nombre: 'Dañado' }, { valor: 'BAJA', nombre: 'Dado de baja' },
  ];

  /** Mientras llega el croquis no hay pisos: un piso vacío evita que la plantilla lea de `undefined`. */
  readonly piso = computed<PisoCroquis>(() => this.pisos().find(p => p.id === this.pisoId()) ?? this.pisos()[0] ?? PISO_VACIO);
  readonly areasDelPiso = computed(() => {
    const id = this.piso()?.id;
    const primero = this.pisos()[0]?.id === id;
    return this.areas().filter(a => a.piso === id || (!a.piso && primero));
  });
  readonly elementos = computed(() => this.piso()?.elementos ?? []);
  readonly areaSel = computed<Area | null>(() => {
    const s = this.seleccion();
    return s?.tipo === 'area' ? this.areas().find(a => a.id === s.id) ?? null : null;
  });
  readonly elementoSel = computed<ElementoCroquis | null>(() => {
    const s = this.seleccion();
    return s?.tipo === 'elemento' ? this.elementos().find(e => e.id === s.id) ?? null : null;
  });
  readonly metaSel = computed<MetaArea>(() => { const a = this.areaSel(); return a ? this.meta()[a.id] ?? {} : {}; });
  readonly croquisVista = computed<Croquis>(() => ({
    ...(this.croquis() ?? ({} as Croquis)),
    ancho: this.piso()?.ancho ?? 1200, alto: this.piso()?.alto ?? 800, fondo_color: this.fondoColor(), nombre: this.nombre(),
    escala_cm_px: this.escala(), areas: this.areas(), elementos_json: null, fondo_imagen_url: this.croquis()?.fondo_imagen_url ?? null,
  } as Croquis));
  readonly puestosTotales = computed(() => this.areas().filter(a => a.activa !== false).reduce((s, a) => s + (a.capacidad || 0), 0));
  /** Solo la última versión se edita: las áreas (puestos) son siempre las vigentes. */
  readonly soloLectura = computed(() => {
    const c = this.croquis(), v = this.versiones();
    return !!c && v.length > 1 && c.version < Math.max(...v.map(x => x.version));
  });
  readonly seleccion3d = computed<SeleccionPlano | null>(() => this.seleccion());
  readonly herramienta3d = computed<string | null>(() => {
    const h = this.herramienta();
    return h === 'seleccionar' || this.soloLectura() ? null : h;
  });
  readonly tamanoHerramienta = computed<[number, number] | null>(() => {
    const h = this.herramienta();
    if (h === 'seleccionar') return null;
    if (this.TIPOS_AREA.some(t => t.tipo === h)) return TAMANO_AREA_M[h] ?? [2, 2];
    const n = h === 'SILLA2' ? 2 : h === 'SILLA3' ? 3 : h === 'SILLA4' ? 4 : 1;
    const base = TAMANO_ELEMENTO_M[h.startsWith('SILLA') ? 'SILLA' : h] ?? [1, 1];
    return [base[0] * n, base[1]];
  });
  readonly ayudaHerramienta = computed(() => {
    const h = this.herramienta();
    if (h === 'seleccionar') return null;
    for (const g of this.GRUPOS_ELEMENTO) { const i = g.items.find(x => x.tipo === h); if (i) return i.ayuda ?? `Clic en el plano para poner: ${i.nombre}. Shift para seguir poniendo; Esc para terminar.`; }
    const a = this.TIPOS_AREA.find(t => t.tipo === h);
    return a ? `Clic en el plano para poner: ${a.nombre}. Shift para seguir poniendo; Esc para terminar.` : null;
  });

  /** Lista de objetos del piso (la forma fácil de elegir una pared delgada o un mueble tapado). */
  readonly objetos = computed(() => {
    const q = this.filtroObjetos().trim().toLowerCase();
    const grupos = new Map<string, { sel: NonNullable<Seleccion>; icono: string; nombre: string; detalle: string; bloqueado?: boolean }[]>();
    const add = (g: string, x: { sel: NonNullable<Seleccion>; icono: string; nombre: string; detalle: string; bloqueado?: boolean }) => {
      if (q && !`${x.nombre} ${x.detalle}`.toLowerCase().includes(q)) return;
      (grupos.get(g) ?? grupos.set(g, []).get(g)!).push(x);
    };
    for (const a of this.areasDelPiso()) {
      add('Áreas y puestos', { sel: { tipo: 'area', id: a.id }, icono: this.TIPOS_AREA.find(t => t.tipo === a.tipo)?.icono ?? 'crop_square', nombre: a.nombre, detalle: `${this.nombreTipo(a.tipo)}${a.capacidad ? ` · ${a.capacidad} puesto${a.capacidad > 1 ? 's' : ''}` : ''}` });
    }
    for (const e of this.elementos()) {
      add(GRUPO_OBJETO[e.tipo] ?? 'Otros', { sel: { tipo: 'elemento', id: e.id }, icono: this.iconoTipo(e.tipo), nombre: this.nombreElemento(e), detalle: [e.activo?.codigo, this.medida(e)].filter(Boolean).join(' · '), bloqueado: e.bloqueado });
    }
    const orden = ['Áreas y puestos', 'Paredes, puertas y ventanas', 'Muebles', 'Luces, pantallas y equipos', 'Señalización', 'Otros'];
    return orden.filter(g => grupos.has(g)).map(g => ({ titulo: g, items: grupos.get(g)! }));
  });

  /** Inventario: todos los muebles con ficha de activo, de todos los pisos. */
  readonly inventario = computed<FilaActivo[]>(() => {
    const out: FilaActivo[] = [];
    for (const p of this.pisos()) {
      const primero = this.pisos()[0]?.id === p.id;
      const areas = this.areas().filter(a => a.activa !== false && (a.piso === p.id || (!a.piso && primero)));
      for (const e of p.elementos) {
        if (!e.activo) continue;
        const cx = e.x + e.ancho / 2, cy = e.y + e.alto / 2;
        const area = areas.find(a => cx >= a.x && cx <= a.x + a.ancho && cy >= a.y && cy <= a.y + a.alto);
        out.push({ id: e.id, pisoId: p.id, piso: p.nombre, tipo: e.tipo, nombreTipo: this.nombreElemento(e), ubicacion: area?.nombre ?? '—', a: e.activo, unidades: e.tipo === 'SILLA' ? e.cantidad || 1 : 1 });
      }
    }
    return out.sort((x, y) => x.a.codigo.localeCompare(y.a.codigo));
  });
  readonly valorInventario = computed(() => this.inventario().reduce((s, f) => s + (Number(f.a.valor) || 0), 0));
  readonly valorTexto = computed(() => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(this.valorInventario()));
  readonly columnasInventario: ColumnaTabla<FilaActivo>[] = [
    { id: 'codigo', header: 'Código (placa)', valor: f => f.a.codigo, tarjeta: 'titulo' },
    { id: 'tipo', header: 'Mueble', valor: f => f.nombreTipo, tarjeta: 'subtitulo' },
    { id: 'categoria', header: 'Categoría', valor: f => f.a.categoria, prioridad: 2 },
    { id: 'unidades', header: 'Unidades', align: 'right', valor: f => f.unidades, prioridad: 3 },
    { id: 'estado', header: 'Estado', align: 'center', tarjeta: 'badge', valor: f => this.nombreEstado(f.a.estado),
      badge: f => ({ texto: this.nombreEstado(f.a.estado), tono: f.a.estado === 'BUENO' ? 'ok' : f.a.estado === 'REGULAR' ? 'warn' : f.a.estado === 'DANADO' ? 'danger' : 'neutro' }) },
    { id: 'piso', header: 'Piso', valor: f => f.piso, prioridad: 2 },
    { id: 'ubicacion', header: 'Área', valor: f => f.ubicacion, prioridad: 2 },
    { id: 'responsable', header: 'Responsable', valor: f => f.a.responsable ?? '', prioridad: 2 },
    { id: 'marca', header: 'Marca', valor: f => f.a.marca ?? '', prioridad: 3 },
    { id: 'serial', header: 'Serie', valor: f => f.a.serial ?? '', prioridad: 3 },
    { id: 'valor', header: 'Valor', align: 'right', prioridad: 3, valor: f => (f.a.valor == null ? null : Number(f.a.valor)),
      formato: f => (f.a.valor == null ? '—' : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(f.a.valor))) },
    { id: 'fecha', header: 'Compra', valor: f => f.a.fecha_compra ?? '', prioridad: 3 },
  ];
  readonly idFilaInventario = (f: FilaActivo) => f.id;

  private arrastre: Arrastre | null = null;
  private historial: Estado[] = [];
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // La cámara elegida muestra lo que ve en un lienzo del panel.
    effect(() => {
      const e = this.elementoSel();
      const canvas = this.previewCamara()?.nativeElement ?? null;
      const p3d = this.plano3d();
      if (!p3d) return;
      p3d.usarPreview(e?.tipo === 'CAMARA' ? canvas : null);
      p3d.previsualizarCamara(e?.tipo === 'CAMARA' ? e.id : null);
    });
    effect(() => { try { localStorage.setItem('croquis:modo', this.modo()); } catch { /* sin almacenamiento */ } });
    effect(() => { try { localStorage.setItem('croquis:pista', this.pista() ? '1' : '0'); } catch { /* sin almacenamiento */ } });
    effect(() => { try { localStorage.setItem('croquis:paredes-bajas', this.paredesBajas() ? '1' : '0'); } catch { /* sin almacenamiento */ } });
  }

  ngOnInit(): void {
    this.api.oficina(this.id()).subscribe({ next: o => this.oficina.set(o), error: () => this.error.set('Oficina no encontrada') });
    this.cargar();
    // Equipos monitoreados (si el inventario corporativo está disponible): para ligar EQUIPO y colorearlo.
    const leerEquipos = () => this.monitoreo.endpoints().subscribe({
      next: l => { this.endpoints.set(l); this.estadosEquipos.set(new Map(l.map(x => [String(x.id), String(x.estado ?? 'DESCONOCIDO')]))); },
      error: () => { /* sin monitoreo: los equipos quedan en gris */ },
    });
    leerEquipos();
    const t = setInterval(leerEquipos, 60_000);
    this.destroyRef.onDestroy(() => clearInterval(t));
  }

  private cargar(): void {
    this.api.croquis(this.id(), true).subscribe({
      next: c => { this.aplicar(c); this.api.versionesCroquis(this.id()).subscribe({ next: v => this.versiones.set(v), error: () => {} }); },
      error: () => this.aplicar(null),
    });
  }

  private aplicar(c: Croquis | null): void {
    this.croquis.set(c);
    this.areas.set(c?.areas ? c.areas.map(a => ({ ...a, capacidad: a.capacidad ?? 0, movil: !!a.movil })) : []);
    const pisos = leerPisos(c);
    this.pisos.set(pisos);
    this.meta.set(leerMetaAreas(c?.elementos_json));
    this.pisoId.set(pisos[0].id);
    this.fondoColor.set(c?.fondo_color || '#FFFFFF');
    this.nombre.set(c?.nombre || 'Croquis');
    this.escala.set(Number(c?.escala_cm_px) || 2);
    this.seleccion.set(null);
    this.sucio.set(false);
    this.historial = [];
  }

  cargarVersion(id: string): void {
    if (this.sucio() && !confirm('Hay cambios sin guardar. ¿Cambiar de versión igualmente?')) return;
    this.api.croquisPorId(id).subscribe({ next: c => this.aplicar(c), error: () => {} });
  }

  volverALaActual(): void {
    const v = this.versiones();
    const ultima = v.reduce((a, b) => (b.version > a.version ? b : a), v[0]);
    if (ultima) this.cargarVersion(ultima.id);
  }

  // ── Vista ─────────────────────────────────────────────────────────────

  cambiarModo(m: '3d' | '2d'): void { this.modo.set(m); this.herramienta.set('seleccionar'); }
  vista(v: VistaCamara): void { this.plano3d()?.vista(v); }
  enfocarSeleccion(): void { const s = this.seleccion(); if (s) this.plano3d()?.enfocar(s.id); }

  // ── Medidas ───────────────────────────────────────────────────────────

  px(m: number): number { return Math.round(m * 100 / this.escala()); }
  m(px: number): number { return Math.round(px * this.escala()) / 100; }
  private snap(v: number): number { return this.ajustar() ? Math.round(v / this.px(0.1)) * this.px(0.1) : Math.round(v); }
  medida(e: ElementoCroquis): string { return `${this.m(e.ancho)}×${this.m(e.alto)} m`; }

  cambiarEscala(v: number): void {
    const nueva = Math.max(0.5, Math.min(10, +v || 2));
    if (nueva === this.escala()) return;
    if (!confirm('Cambiar la escala no mueve nada: solo cambia cuántos centímetros vale cada píxel. ¿Continuar?')) return;
    this.escala.set(nueva);
    this.sucio.set(true);
  }

  // ── Historial (Ctrl+Z) ────────────────────────────────────────────────

  private recordar(): void {
    this.historial.push({ areas: this.areas(), pisos: this.pisos(), meta: this.meta() });
    if (this.historial.length > 60) this.historial.shift();
  }

  deshacer(): void {
    const e = this.historial.pop();
    if (!e) return;
    this.areas.set(e.areas); this.pisos.set(e.pisos); this.meta.set(e.meta);
    const s = this.seleccion();
    if (s && !(s.tipo === 'area' ? e.areas.some(a => a.id === s.id) : e.pisos.some(p => p.elementos.some(x => x.id === s.id)))) this.seleccion.set(null);
    this.sucio.set(true);
  }
  get puedeDeshacer(): boolean { return this.historial.length > 0; }

  // ── Pisos ─────────────────────────────────────────────────────────────

  elegirPiso(id: string): void { this.pisoId.set(id); this.seleccion.set(null); }

  agregarPiso(): void {
    this.recordar();
    const n = this.pisos().length + 1;
    const base = this.piso();
    const nivel = Math.max(...this.pisos().map(p => p.nivel ?? 0)) + 1;
    const nuevo: PisoCroquis = { id: `p${Date.now().toString(36)}`, nombre: `Piso ${n}`, ancho: base?.ancho ?? 1200, alto: base?.alto ?? 800, elementos: [], nivel };
    this.pisos.update(l => [...l, nuevo]);
    this.pisoId.set(nuevo.id);
    this.sucio.set(true);
  }

  empezarRenombrarPiso(p: PisoCroquis): void { this.renombrandoPiso.set(p.id); this.nombrePisoTemporal = p.nombre; }
  guardarNombrePiso(p: PisoCroquis): void {
    const nombre = this.nombrePisoTemporal.trim();
    this.renombrandoPiso.set(null);
    if (!nombre || nombre === p.nombre) return;
    this.pisos.update(l => l.map(x => (x.id === p.id ? { ...x, nombre } : x)));
    this.sucio.set(true);
  }

  eliminarPiso(p: PisoCroquis): void {
    if (this.pisos().length <= 1) return;
    const conAreas = this.areas().some(a => a.piso === p.id && a.activa !== false);
    if (conAreas) { this.error.set('Ese piso tiene áreas: muévalas o elimínelas primero'); setTimeout(() => this.error.set(null), 3000); return; }
    if (!confirm(`¿Eliminar "${p.nombre}" con sus elementos?`)) return;
    this.recordar();
    this.pisos.update(l => l.filter(x => x.id !== p.id));
    this.pisoId.set(this.pisos()[0].id);
    this.sucio.set(true);
  }

  tamanoPiso(campo: 'ancho' | 'alto', metros: number): void {
    const px = Math.max(this.px(2), Math.min(this.px(120), this.px(+metros || 0)));
    this.pisos.update(l => l.map(x => (x.id === this.pisoId() ? { ...x, [campo]: px } : x)));
    this.sucio.set(true);
  }
  datoPiso(campo: 'nivel' | 'altura3d', v: number): void {
    const valor = campo === 'nivel' ? Math.round(+v || 0) : Math.max(2.2, Math.min(8, +v || 2.7));
    this.pisos.update(l => l.map(x => (x.id === this.pisoId() ? { ...x, [campo]: valor } : x)));
    this.sucio.set(true);
  }

  moverAreaAPiso(a: Area, pisoId: string): void {
    this.recordar();
    this.areas.update(l => l.map(x => (x.id === a.id ? { ...x, piso: pisoId } : x)));
    this.sucio.set(true);
  }

  // ── Coordenadas 2D ────────────────────────────────────────────────────

  private aLienzo(e: PointerEvent): { x: number; y: number } {
    const svg = this.lienzo()?.nativeElement.querySelector('svg');
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return { x: vb.x + ((e.clientX - r.left) / r.width) * vb.width, y: vb.y + ((e.clientY - r.top) / r.height) * vb.height };
  }

  // ── Crear ─────────────────────────────────────────────────────────────

  clicLienzo(e: PointerEvent): void {
    const h = this.herramienta();
    if (h === 'seleccionar' || this.soloLectura()) { this.seleccion.set(null); return; }
    const p = this.aLienzo(e);
    this.crear(h, p.x, p.y);
    if (!e.shiftKey) this.herramienta.set('seleccionar');
  }

  /** El 3D colocó la herramienta en (x, y) = centro, en px. */
  colocarDesde3d(ev: { tipo: string; x: number; y: number }): void {
    this.crear(ev.tipo as Herramienta, ev.x, ev.y);
    // En 3D la herramienta sigue activa hasta Esc (poner varias sillas o luces seguidas es lo normal).
  }

  /** Un tramo de pared dibujado en 3D (px). */
  paredDesde3d(ev: { x1: number; y1: number; x2: number; y2: number }): void {
    this.recordar();
    const largo = Math.hypot(ev.x2 - ev.x1, ev.y2 - ev.y1);
    const grosor = this.px(0.15);
    const cx = (ev.x1 + ev.x2) / 2, cy = (ev.y1 + ev.y2) / 2;
    const el: ElementoCroquis = {
      id: crypto.randomUUID(), tipo: 'PARED', x: Math.round(cx - largo / 2), y: Math.round(cy - grosor / 2),
      ancho: Math.round(largo), alto: grosor, rotacion: Math.round(Math.atan2(ev.y2 - ev.y1, ev.x2 - ev.x1) * 180 / Math.PI),
    };
    this.pisos.update(l => l.map(x => (x.id === this.pisoId() ? { ...x, elementos: [...x.elementos, el] } : x)));
    this.sucio.set(true);
  }

  private crear(h: Herramienta, cx: number, cy: number): void {
    if (h === 'seleccionar') return;
    this.recordar();
    const pisoId = this.piso().id;
    if (this.TIPOS_AREA.some(t => t.tipo === h)) {
      const tipo = h as TipoArea;
      const [wm, hm] = TAMANO_AREA_M[tipo] ?? [2, 2];
      const w = this.px(wm), hh = this.px(hm);
      const n = this.areas().filter(a => a.tipo === tipo).length + 1;
      const base = this.TIPOS_AREA.find(t => t.tipo === tipo)!.nombre;
      const conNumero = ['MODULO', 'VENTANILLA', 'PUESTO', 'OFICINA', 'AREA_ATENCION'].includes(tipo);
      const a: Area = {
        id: crypto.randomUUID(), nombre: conNumero ? `${base} ${n}` : base,
        codigo: null, tipo, x: this.snap(cx - w / 2), y: this.snap(cy - hh / 2), ancho: w, alto: hh, rotacion: 0,
        forma: tipo === 'SALA_ESPERA' ? 'REDONDEADO' : 'RECTANGULO', puntos_json: null, color: null, icono: null,
        referencia: null, piso: pisoId, descripcion: null, orden: this.areas().length, activa: true,
        capacidad: CAPACIDAD_TIPO[tipo] ?? 0, movil: tipo === 'PASILLO',
      };
      if (tipo === 'PASILLO') a.capacidad = 1;
      this.areas.update(l => [...l, a]);
      if (tipo === 'ESCALERA') this.meta.update(m => ({ ...m, [a.id]: { sentido: 'SUBE', conecta_piso: this.pisoVecino(1) } }));
      this.seleccion.set({ tipo: 'area', id: a.id });
    } else {
      const cantidad = h === 'SILLA2' ? 2 : h === 'SILLA3' ? 3 : h === 'SILLA4' ? 4 : 1;
      const tipo = (h.startsWith('SILLA') ? 'SILLA' : h) as ElementoCroquis['tipo'];
      const [wm0, hm] = TAMANO_ELEMENTO_M[tipo] ?? [1, 1];
      const wm = tipo === 'SILLA' ? wm0 * cantidad : wm0;
      const w = this.px(wm), hh = this.px(hm);
      const el: ElementoCroquis = {
        id: crypto.randomUUID(), tipo, x: this.snap(cx - w / 2), y: this.snap(cy - hh / 2), rotacion: 0,
        ancho: w, alto: hh, cantidad: tipo === 'SILLA' ? cantidad : undefined,
        texto: tipo === 'TEXTO' ? 'Texto' : undefined, tamano: tipo === 'TEXTO' ? 16 : tipo === 'ICONO' ? 28 : undefined,
        icono: tipo === 'ICONO' ? 'place' : undefined,
        ...(tipo === 'LUZ' ? { luz_modo: 'FIJA' as ModoLuz, intensidad: 0.7, color: '#FFE8A3' } : {}),
        ...(tipo === 'CAMARA' ? { fov: 70, alcance: 8, inclinacion: -20, z: 2.4 } : {}),
        ...(tipo === 'PANTALLA' ? { z: 1.4 } : {}),
      };
      if (NACE_ACTIVO.has(tipo)) el.activo = this.activoNuevo(tipo);
      this.pisos.update(l => l.map(x => (x.id === pisoId ? { ...x, elementos: [...x.elementos, el] } : x)));
      this.seleccion.set({ tipo: 'elemento', id: el.id });
    }
    this.sucio.set(true);
  }

  private pisoVecino(delta: number): string | null {
    const actual = this.piso();
    const nivel = (actual.nivel ?? 0) + delta;
    return this.pisos().find(p => (p.nivel ?? 0) === nivel)?.id ?? null;
  }

  // ── Activos ───────────────────────────────────────────────────────────

  private todosLosActivos(): (ActivoCroquis | null | undefined)[] {
    return this.pisos().flatMap(p => p.elementos.map(e => e.activo));
  }

  private activoNuevo(tipo: string): ActivoCroquis {
    return this.activoNuevoEntre(tipo, this.todosLosActivos());
  }

  private activoNuevoEntre(tipo: string, existentes: (ActivoCroquis | null | undefined)[]): ActivoCroquis {
    return {
      codigo: siguienteCodigoActivo(tipo, this.oficina()?.codigo, existentes),
      categoria: CATEGORIA_ACTIVO[tipo]?.categoria ?? 'Mobiliario', estado: 'BUENO',
    };
  }

  esMueble(e: ElementoCroquis): boolean { return !!CATEGORIA_ACTIVO[e.tipo]; }

  /** Muebles y equipos que ya estaban en el plano antes de existir las fichas de activo. */
  readonly sinFicha = computed(() => this.pisos().reduce((n, p) => n + p.elementos.filter(e => NACE_ACTIVO.has(e.tipo) && !e.activo).length, 0));

  /** Les da código de activo a todos los muebles sin ficha, en un solo paso (se puede deshacer). */
  registrarActivosFaltantes(): void {
    if (this.soloLectura() || !this.sinFicha()) return;
    this.recordar();
    const existentes = this.todosLosActivos().slice();
    this.pisos.update(ps => ps.map(p => ({
      ...p,
      elementos: p.elementos.map(e => {
        if (!NACE_ACTIVO.has(e.tipo) || e.activo) return e;
        const activo = this.activoNuevoEntre(e.tipo, existentes);
        existentes.push(activo);
        return { ...e, activo };
      }),
    })));
    this.sucio.set(true);
  }

  alternarActivo(): void {
    const e = this.elementoSel();
    if (!e) return;
    if (e.activo && !confirm(`¿Quitar la ficha de activo ${e.activo.codigo}? Se pierden sus datos.`)) return;
    this.actualizarElemento({ activo: e.activo ? null : this.activoNuevo(e.tipo) });
  }

  actualizarActivo(cambio: Partial<ActivoCroquis>): void {
    const e = this.elementoSel();
    if (!e?.activo) return;
    this.actualizarElemento({ activo: { ...e.activo, ...cambio } });
  }

  nuevoCodigo(): void {
    const e = this.elementoSel();
    if (!e?.activo) return;
    const otros = this.todosLosActivos().filter(a => a !== e.activo);
    this.actualizarActivo({ codigo: siguienteCodigoActivo(e.tipo, this.oficina()?.codigo, otros) });
  }

  abrirActivo(f: FilaActivo): void {
    this.inventarioAbierto.set(false);
    this.pisoId.set(f.pisoId);
    this.seleccion.set({ tipo: 'elemento', id: f.id });
    this.panel.set('props');
    setTimeout(() => this.plano3d()?.enfocar(f.id), 60);
  }

  nombreEstado(e: EstadoActivo): string { return this.ESTADOS_ACTIVO.find(x => x.valor === e)?.nombre ?? e; }

  // ── Mover / redimensionar / rotar (2D) ────────────────────────────────

  elegir(ev: { tipo: 'area' | 'elemento'; id: string; evento: PointerEvent; asa?: boolean; rotar?: boolean }): void {
    // Con una herramienta activa, el clic sobre un área pone el mueble ahí (no la selecciona).
    if (this.herramienta() !== 'seleccionar' && !ev.asa && !ev.rotar) return;
    ev.evento.stopPropagation();
    this.seleccion.set({ tipo: ev.tipo, id: ev.id });
    if (this.soloLectura()) return;
    const obj = ev.tipo === 'area' ? this.areas().find(a => a.id === ev.id) : this.elementos().find(e => e.id === ev.id);
    if (!obj || (ev.tipo === 'elemento' && (obj as ElementoCroquis).bloqueado)) return;
    const p = this.aLienzo(ev.evento);
    const cx = obj.x + obj.ancho / 2, cy = obj.y + obj.alto / 2;
    this.recordar();
    this.arrastre = {
      modo: ev.rotar ? 'rotar' : ev.asa ? 'redimensionar' : 'mover', sel: { tipo: ev.tipo, id: ev.id },
      x0: p.x, y0: p.y, ox: obj.x, oy: obj.y, ow: obj.ancho, oh: obj.alto, cx, cy,
      rot0: obj.rotacion || 0, ang0: Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI,
    };
    (ev.evento.currentTarget as Element | null)?.setPointerCapture?.(ev.evento.pointerId);
  }

  mover(e: PointerEvent): void {
    const d = this.arrastre;
    if (!d) return;
    const p = this.aLienzo(e);
    const dx = p.x - d.x0, dy = p.y - d.y0;
    let cambio: Record<string, unknown>;
    if (d.modo === 'mover') {
      cambio = { x: this.snap(Math.max(0, Math.min(this.piso().ancho - d.ow, d.ox + dx))), y: this.snap(Math.max(0, Math.min(this.piso().alto - d.oh, d.oy + dy))) };
    } else if (d.modo === 'redimensionar') {
      // En el marco del objeto: la esquina opuesta queda quieta aunque esté girado.
      const r = (d.rot0 * Math.PI) / 180;
      const ox = d.cx - (d.ow / 2) * Math.cos(r) + (d.oh / 2) * Math.sin(r);
      const oy = d.cy - (d.ow / 2) * Math.sin(r) - (d.oh / 2) * Math.cos(r);
      const vx = p.x - ox, vy = p.y - oy;
      const w = this.snap(Math.max(this.px(0.1), vx * Math.cos(r) + vy * Math.sin(r)));
      const h = this.snap(Math.max(this.px(0.05), -vx * Math.sin(r) + vy * Math.cos(r)));
      const cx = ox + (w / 2) * Math.cos(r) - (h / 2) * Math.sin(r);
      const cy = oy + (w / 2) * Math.sin(r) + (h / 2) * Math.cos(r);
      cambio = { ancho: w, alto: h, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) };
    } else {
      const ang = Math.atan2(p.y - d.cy, p.x - d.cx) * 180 / Math.PI;
      let rot = d.rot0 + (ang - d.ang0);
      if (!e.altKey) rot = Math.round(rot / 15) * 15;      // Alt = libre; si no, de 15 en 15
      rot = ((rot + 180) % 360 + 360) % 360 - 180;
      cambio = { rotacion: Math.round(rot) };
    }
    this.aplicarCambio(d.sel, cambio, false);
  }

  soltar(): void { this.arrastre = null; }

  /** Cambio que llega del 3D al soltar (mover, girar o redimensionar). */
  cambioDesde3d(ev: { sel: SeleccionPlano; patch: CambioPlano }): void {
    if (this.soloLectura()) return;
    this.aplicarCambio(ev.sel, ev.patch as Record<string, unknown>);
  }

  seleccionDesde3d(s: SeleccionPlano | null): void {
    this.seleccion.set(s);
    if (s) this.panel.set('props');
  }

  /** Elegir en la lista: lo selecciona, lo enfoca y abre sus propiedades para editarlo de una vez. */
  elegirObjeto(sel: NonNullable<Seleccion>): void {
    this.seleccion.set(sel);
    this.panel.set('props');
    if (this.modo() === '3d') this.plano3d()?.enfocar(sel.id);
  }

  rotar(grados: number): void {
    const s = this.seleccion();
    if (!s) return;
    const obj = s.tipo === 'area' ? this.areaSel() : this.elementoSel();
    if (!obj) return;
    let rot = (obj.rotacion || 0) + grados;
    rot = ((rot + 180) % 360 + 360) % 360 - 180;
    this.aplicarCambio(s, { rotacion: rot });
  }

  teclado(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.deshacer(); return; }
    const s = this.seleccion();
    if (e.key === 'Escape') { this.herramienta.set('seleccionar'); this.seleccion.set(null); return; }
    if (!s || this.soloLectura()) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.eliminarSeleccion(); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); this.rotar(e.shiftKey ? -15 : 15); return; }
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey) { e.preventDefault(); this.enfocarSeleccion(); return; }
    if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.duplicarSeleccion(); return; }
    const paso = e.shiftKey ? this.px(0.5) : this.px(0.1);
    const delta: Record<string, [number, number]> = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    const obj = s.tipo === 'area' ? this.areaSel() : this.elementoSel();
    if (obj) this.aplicarCambio(s, { x: obj.x + d[0], y: obj.y + d[1] });
  }

  /** Un mismo cambio (posición, tamaño, giro) sirve para áreas y para muebles. */
  private aplicarCambio(s: NonNullable<Seleccion>, cambio: Record<string, unknown>, recordar = true): void {
    if (recordar) this.recordar();
    if (s.tipo === 'area') this.areas.update(l => l.map(a => (a.id === s.id ? { ...a, ...(cambio as Partial<Area>) } : a)));
    else this.pisos.update(l => l.map(p => (p.id === this.pisoId() ? { ...p, elementos: p.elementos.map(x => (x.id === s.id ? { ...x, ...(cambio as Partial<ElementoCroquis>) } : x)) } : p)));
    this.sucio.set(true);
  }

  actualizarArea(cambio: Partial<Area>): void {
    const a = this.areaSel();
    if (!a) return;
    this.aplicarCambio({ tipo: 'area', id: a.id }, cambio as Record<string, unknown>);
  }
  actualizarAreaM(campo: 'x' | 'y' | 'ancho' | 'alto', metros: number): void { this.actualizarArea({ [campo]: this.px(+metros || 0) }); }
  cambiarTipoArea(tipo: TipoArea): void {
    const a = this.areaSel();
    if (!a) return;
    const cambio: Partial<Area> = { tipo };
    if (!a.capacidad && CAPACIDAD_TIPO[tipo]) cambio.capacidad = CAPACIDAD_TIPO[tipo];
    if (tipo === 'PASILLO' && !a.capacidad) { cambio.capacidad = 1; cambio.movil = true; }
    this.actualizarArea(cambio);
  }
  actualizarMeta(cambio: Partial<MetaArea>): void {
    const a = this.areaSel();
    if (!a) return;
    this.recordar();
    this.meta.update(m => ({ ...m, [a.id]: { ...(m[a.id] ?? {}), ...cambio } }));
    this.sucio.set(true);
  }

  actualizarElemento(cambio: Partial<ElementoCroquis>): void {
    const e = this.elementoSel();
    if (!e) return;
    this.aplicarCambio({ tipo: 'elemento', id: e.id }, cambio as Record<string, unknown>);
  }
  actualizarElementoM(campo: 'x' | 'y' | 'ancho' | 'alto', metros: number): void { this.actualizarElemento({ [campo]: this.px(+metros || 0) }); }
  cantidadSillas(n: number): void {
    const e = this.elementoSel();
    if (!e || e.tipo !== 'SILLA') return;
    const cantidad = Math.max(1, Math.min(4, +n || 1));
    const porSilla = e.ancho / Math.max(1, e.cantidad || 1);
    this.actualizarElemento({ cantidad, ancho: Math.round(porSilla * cantidad) });
  }
  alternarBloqueo(): void { const e = this.elementoSel(); if (e) this.actualizarElemento({ bloqueado: !e.bloqueado }); }

  duplicarSeleccion(): void {
    this.recordar();
    const a = this.areaSel();
    if (a) {
      const copia = { ...a, id: crypto.randomUUID(), x: a.x + this.px(0.4), y: a.y + this.px(0.4), nombre: siguienteNombre(a.nombre), orden: this.areas().length, puestos: undefined };
      this.areas.update(l => [...l, copia]);
      const m = this.meta()[a.id];
      if (m) this.meta.update(x => ({ ...x, [copia.id]: { ...m } }));
      this.seleccion.set({ tipo: 'area', id: copia.id });
    }
    const e = this.elementoSel();
    if (e) {
      const copia: ElementoCroquis = { ...e, id: crypto.randomUUID(), x: e.x + this.px(0.4), y: e.y + this.px(0.4), bloqueado: false };
      if (e.activo) copia.activo = { ...e.activo, codigo: siguienteCodigoActivo(e.tipo, this.oficina()?.codigo, this.todosLosActivos()), serial: null };
      this.pisos.update(l => l.map(p => (p.id === this.pisoId() ? { ...p, elementos: [...p.elementos, copia] } : p)));
      this.seleccion.set({ tipo: 'elemento', id: copia.id });
    }
    this.sucio.set(true);
  }

  eliminarSeleccion(): void {
    const s = this.seleccion();
    if (!s) return;
    if (s.tipo === 'area') {
      const a = this.areas().find(x => x.id === s.id);
      if (a?.servicios?.length && !confirm(`El área "${a.nombre}" tiene servicios asignados (${a.servicios.join(', ')}). Se desactiva, no se borra. ¿Continuar?`)) return;
      if (a?.puestos?.some(p => p.usuario_ref) && !confirm(`Alguien está atendiendo en "${a.nombre}" ahora mismo. Su puesto quedará inactivo cuando cierre. ¿Continuar?`)) return;
      this.recordar();
      this.areas.update(l => l.filter(x => x.id !== s.id));
    } else {
      const e = this.elementoSel();
      if (e?.activo && !confirm(`"${this.nombreElemento(e)}" es el activo ${e.activo.codigo}. Quitarlo del plano lo saca del inventario. ¿Continuar?`)) return;
      this.recordar();
      this.pisos.update(l => l.map(p => (p.id === this.pisoId() ? { ...p, elementos: p.elementos.filter(x => x.id !== s.id) } : p)));
    }
    this.seleccion.set(null);
    this.sucio.set(true);
  }

  traerAlFrente(): void {
    const s = this.seleccion();
    if (!s) return;
    this.recordar();
    if (s.tipo === 'area') this.areas.update(l => { const a = l.find(x => x.id === s.id)!; return [...l.filter(x => x.id !== s.id), a].map((x, i) => ({ ...x, orden: i })); });
    else this.pisos.update(l => l.map(p => (p.id === this.pisoId() ? { ...p, elementos: [...p.elementos.filter(x => x.id !== s.id), p.elementos.find(x => x.id === s.id)!] } : p)));
    this.sucio.set(true);
  }

  colorPorDefecto(a: Area): string { return COLOR_TIPO[a.tipo]?.borde ?? '#2B59F0'; }
  nombreTipo(t: string): string { return this.TIPOS_AREA.find(x => x.tipo === t)?.nombre ?? t; }
  iconoTipo(t: string): string {
    for (const g of this.GRUPOS_ELEMENTO) { const i = g.items.find(x => x.tipo === t); if (i) return i.icono; }
    return 'category';
  }
  nombreElemento(e: ElementoCroquis): string {
    if (e.tipo === 'TEXTO') return `Texto «${e.texto ?? ''}»`;
    if (e.tipo === 'SILLA') return (e.cantidad || 1) > 1 ? `Sillas ×${e.cantidad}` : 'Silla';
    for (const g of this.GRUPOS_ELEMENTO) { const i = g.items.find(x => x.tipo === e.tipo); if (i) return i.nombre; }
    return e.tipo;
  }
  nombrePiso(id: string | null | undefined): string { return this.pisos().find(p => p.id === id)?.nombre ?? '—'; }

  // ── Guardar / publicar ────────────────────────────────────────────────

  guardar(nuevaVersion = false): void {
    if (this.soloLectura()) { this.error.set('Está viendo una versión anterior: vuelva a la actual para guardar'); return; }
    this.ocupado.set(true);
    this.error.set(null);
    const primero = this.pisos()[0];
    const idsAreas = new Set(this.areas().map(a => a.id));
    const meta = Object.fromEntries(Object.entries(this.meta()).filter(([k]) => idsAreas.has(k)));
    this.api.guardarCroquis(this.id(), {
      nombre: this.nombre(), ancho: primero.ancho, alto: primero.alto, escala_cm_px: this.escala(),
      fondo_color: this.fondoColor(), fondo_imagen_url: this.croquis()?.fondo_imagen_url ?? null,
      elementos_json: serializarCroquis(this.pisos(), meta),
      areas: this.areas().map(({ servicios: _s, puestos: _p, ...a }) => a),
      nueva_version: nuevaVersion,
    }).subscribe({
      next: c => {
        this.ocupado.set(false);
        const pisoActual = this.pisoId();
        const sel = this.seleccion();
        this.aplicar(c);
        if (this.pisos().some(p => p.id === pisoActual)) this.pisoId.set(pisoActual);
        if (sel) this.seleccion.set(sel);
        this.aviso.set(`Guardado (versión ${c.version}) · ${this.puestosTotales()} puestos · ${this.inventario().length} activos`);
        this.api.versionesCroquis(this.id()).subscribe({ next: v => this.versiones.set(v), error: () => {} });
        setTimeout(() => this.aviso.set(null), 3500);
      },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar'); },
    });
  }

  publicar(): void {
    const c = this.croquis();
    if (!c) return;
    if (this.sucio()) { this.error.set('Guarde antes de publicar'); return; }
    if (!confirm('Publicar deja esta versión como el plano vigente: es la que se imprime y la que ve el televisor. ¿Continuar?')) return;
    this.ocupado.set(true);
    this.api.publicarCroquis(c.id).subscribe({
      next: r => { this.ocupado.set(false); this.aplicar(r); this.aviso.set('Plano publicado: el televisor ya lo usa'); setTimeout(() => this.aviso.set(null), 2500); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo publicar'); },
    });
  }

  volver(): void {
    if (this.sucio() && !confirm('Hay cambios sin guardar. ¿Salir igualmente?')) return;
    this.router.navigate(['/dashboard/turnos/oficinas']);
  }

  irAlCartel(): void { this.router.navigate(['/dashboard/turnos/cartel']); }
}

function leerPista(): boolean {
  return leerBandera('croquis:pista', true);
}

function leerBandera(clave: string, porDefecto: boolean): boolean {
  try { const v = localStorage.getItem(clave); return v === null ? porDefecto : v === '1'; } catch { return porDefecto; }
}

function leerModo(): '3d' | '2d' {
  try { return localStorage.getItem('croquis:modo') === '2d' ? '2d' : '3d'; } catch { return '3d'; }
}

/** "Módulo 3" → "Módulo 4"; "Oficina" → "Oficina 2". */
function siguienteNombre(nombre: string): string {
  const m = /^(.*?)(\d+)\s*$/.exec(nombre);
  return m ? `${m[1]}${+m[2] + 1}` : `${nombre} 2`;
}
