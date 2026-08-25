import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Inject,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, filter, map, switchMap, tap } from 'rxjs/operators';

import {
  ModuloAccesible,
  PermissionsService,
  normalizarTexto,
} from '../../../../core/services/permissions.service';
import { getLocalStorageItem, setLocalStorageItem } from '../../../../core/utils/safe-storage';
import { QuickSearchService } from '../../submodule/dynamic-forms/services/quick-search.service';
import {
  QuickSearchField,
  QuickSearchForm,
  QuickSearchRecord,
  QuickSearchResult,
} from '../../submodule/dynamic-forms/models/quick-search.models';

/** Qué es una fila del desplegable (decide el icono, el destino y el orden). */
type SmartTipo = 'modulo' | 'formulario' | 'registro' | 'ia';

/** Fila del desplegable. */
interface SmartItem {
  tipo: SmartTipo;
  /** Bloque al que pertenece; la cabecera se pinta en la primera fila de cada bloque. */
  grupo: string;
  /** true = esta fila abre su bloque (la que lleva la cabecera). */
  primeroDelGrupo: boolean;
  titulo: string;
  detalle: string;
  icono: string;
  /** true = el icono viene del árbol (Material Symbols); false = icono propio de la UI. */
  simbolo: boolean;
  ruta?: string;
  /** Registro: pares etiqueta/valor con lo que hay dentro, sin abrir la pantalla. */
  datos?: QuickSearchField[];
  /** Etiqueta corta a la derecha del título (estado del registro, nº de registros…). */
  chip?: string;
  /** Registro que hay que abrir en la ficha individual al llegar a la tabla. */
  registroId?: number;
  /** Solo las pantallas del menú se guardan como "recientes". */
  recordar?: boolean;
}

/** Cabeceras de los bloques del desplegable. */
const GRUPO_MODULOS = 'Ir a un módulo';
const GRUPO_RESULTADOS = 'Módulos y submódulos';
const GRUPO_FORMULARIOS = 'Formularios dinámicos';
const GRUPO_REGISTROS = 'Información rápida de registros';
const GRUPO_IA = 'Asistente';

/** Submódulo de gestión de Formularios Dinámicos (mismo valor que usa el host de vistas). */
const RUTA_FORMULARIOS = '/dashboard/gestion-del-programa/formularios-dinamicos';

/** Estados de una respuesta, en español (los mismos rótulos que la tabla de respuestas). */
const ESTADOS: Record<string, string> = {
  DRAFT: 'Borrador',
  SUBMITTED: 'Enviada',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
};

/**
 * Menú inteligente del header: una sola caja para llegar a donde sea.
 *
 * Busca a la vez en tres sitios y los ofrece en bloques separados:
 *   · MÓDULOS y submódulos del árbol de permisos (misma fuente que el menú lateral),
 *   · FORMULARIOS dinámicos por nombre → su tabla de registros,
 *   · REGISTROS ya guardados por su contenido (una cédula, un nombre, un contrato) →
 *     la ficha individual, con un adelanto de lo que hay dentro sin salir del menú.
 *
 * Y si lo escrito parece una pregunta, la manda al asistente de IA.
 *
 * Lo que puede ver cada usuario NO se decide aquí: los módulos salen de su árbol de
 * permisos y los formularios y registros los filtra ms-forms con las mismas reglas que
 * exigen esas pantallas.
 */
@Component({
  selector: 'app-smart-menu',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './smart-menu.component.html',
  styleUrls: ['./smart-menu.component.css'],
})
export class SmartMenuComponent implements OnInit, OnDestroy {
  private readonly permisos = inject(PermissionsService);
  private readonly router = inject(Router);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly quickSearch = inject(QuickSearchService);
  private readonly destroyRef = inject(DestroyRef);

  /** Pantalla del asistente conversacional. */
  private readonly RUTA_IA = '/dashboard/herramientas-ia/asistente';
  private readonly MAX_RESULTADOS = 7;
  /** Con resultados de formularios y registros, los módulos ceden sitio. */
  private readonly MAX_RESULTADOS_CON_DATOS = 4;
  private readonly MAX_SUGERENCIAS = 6;
  private readonly MAX_RECIENTES = 6;
  /** Formularios y registros que pide al backend (el mismo tope para los dos bloques). */
  private readonly MAX_REMOTOS = 5;
  /** Con menos letras no se va al backend: casaría con demasiado. */
  private readonly MIN_REMOTO = 2;
  private readonly ESPERA_REMOTA_MS = 280;
  private readonly CLAVE_RECIENTES = 'smartMenuRecientes';
  private readonly MOBILE_BREAKPOINT = 900;

  /**
   * Destinos que el menú lateral tiene fijos (no vienen del árbol de permisos)
   * y que tiene todo el mundo: sin esto, escribir "inicio" no encontraba nada.
   */
  private readonly FIJOS: ModuloAccesible[] = [
    { id: '__inicio', nombre: 'Inicio', ruta: '/dashboard', icono: 'home', padres: [] },
    { id: '__configuracion', nombre: 'Configuración', ruta: '/dashboard/configuracion', icono: 'settings', padres: [] },
  ];

  @ViewChild('campo') private campo?: ElementRef<HTMLInputElement>;

  readonly consulta = signal<string>('');
  readonly abierto = signal<boolean>(false);
  readonly activo = signal<number>(0);
  readonly compacto = signal<boolean>(false);
  readonly atajo = signal<string>('Ctrl K');
  /** Hay una búsqueda de formularios/registros en vuelo. */
  readonly buscando = signal<boolean>(false);

  private readonly modulos = signal<ModuloAccesible[]>([]);
  private readonly recientes = signal<string[]>([]);
  /** El chat de IA también es un módulo del árbol: si no hay permiso, no se ofrece. */
  private readonly puedeIa = signal<boolean>(false);
  /** Última respuesta del backend; trae el texto con el que se pidió (ver `remotoVigente`). */
  private readonly remoto = signal<QuickSearchResult | null>(null);

  /** Cada tecla pasa por aquí: se debouncea y solo la última consulta llega al backend. */
  private readonly tecleo = new Subject<string>();

  private readonly isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.recientes.set(this.leerRecientes());
    this.revisarAncho();
    this.atajo.set(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘ K' : 'Ctrl K');
    window.addEventListener('resize', this.onResize);
    this.escucharTecleo();
  }

  ngOnDestroy(): void {
    if (this.isBrowser) window.removeEventListener('resize', this.onResize);
  }

  // ── Búsqueda en el backend ────────────────────────────────────────────────────

  /**
   * Formularios y registros de ms-forms. Solo la ÚLTIMA consulta llega (switchMap), y un
   * error se traga con resultados vacíos: el buscador de módulos tiene que seguir vivo
   * aunque ms-forms esté caído.
   */
  private escucharTecleo(): void {
    this.tecleo
      .pipe(
        debounceTime(this.ESPERA_REMOTA_MS),
        map((v) => v.trim()),
        distinctUntilChanged(),
        tap((v) => {
          if (v.length < this.MIN_REMOTO) {
            this.remoto.set(null);
            this.buscando.set(false);
          }
        }),
        filter((v) => v.length >= this.MIN_REMOTO),
        tap(() => this.buscando.set(true)),
        switchMap((v) => this.quickSearch.search(v, this.MAX_REMOTOS).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.buscando.set(false);
        this.remoto.set(res);
        this.activo.set(0);
      });
  }

  /**
   * Resultados del backend SOLO si son de lo que hay escrito ahora mismo. El backend
   * devuelve la consulta con la que respondió: así lo que llega tarde no se pinta bajo
   * un texto que el usuario ya cambió.
   */
  private readonly remotoVigente = computed<QuickSearchResult | null>(() => {
    const res = this.remoto();
    return res && res.query === this.consulta().trim() ? res : null;
  });

  // ── Resultados ────────────────────────────────────────────────────────────────

  /** Módulos que coinciden con lo escrito; sin texto, las sugerencias de siempre. */
  readonly resultados = computed<ModuloAccesible[]>(() => {
    const q = normalizarTexto(this.consulta());
    const modulos = this.modulos();
    if (!q) return this.sugerencias(modulos);

    const res = this.remotoVigente();
    const tope = res && (res.forms.length || res.records.length)
      ? this.MAX_RESULTADOS_CON_DATOS
      : this.MAX_RESULTADOS;

    const tokens = q.split(' ').filter(Boolean);
    return modulos
      .map((m) => ({ m, puntos: this.puntuar(m, q, tokens) }))
      .filter((x) => x.puntos > 0)
      .sort((a, b) => b.puntos - a.puntos || a.m.nombre.length - b.m.nombre.length)
      .slice(0, tope)
      .map((x) => x.m);
  });

  /**
   * ¿Lo escrito parece una pregunta y no el nombre de un módulo? Solo decide el
   * ORDEN (qué queda seleccionado al pulsar Enter): la fila de IA y los módulos
   * se ofrecen siempre, la última palabra la tiene el usuario.
   */
  readonly modoPregunta = computed<boolean>(() => {
    const texto = this.consulta().trim();
    if (!texto) return false;
    if (/[¿?]/.test(texto)) return true;

    const t = normalizarTexto(texto);
    const arranquePregunta =
      /^(que|cual|cuales|como|cuando|cuanto|cuantos|cuanta|cuantas|donde|quien|quienes|por que|porque|para que|explica|explicame|resume|resumen|dime|muestra|muestrame|necesito|ayuda|ayudame|genera|analiza|calcula|hazme|dame|puedo|puede|se puede|hay|existe|existen)\b/;
    if (arranquePregunta.test(t)) return true;

    // Una frase larga rara vez es el nombre de una pantalla.
    return t.split(' ').filter(Boolean).length >= 4;
  });

  /** Lo que se pinta: módulos + formularios + registros + (con texto y permiso) la fila de IA. */
  readonly items = computed<SmartItem[]>(() => {
    const texto = this.consulta().trim();
    const grupoModulos = texto ? GRUPO_RESULTADOS : GRUPO_MODULOS;
    const modulos = this.resultados().map((m) => this.deModulo(m, grupoModulos));
    if (!texto) return this.marcarGrupos(modulos);

    const res = this.remotoVigente();
    const formularios = (res?.forms ?? []).map((f) => this.deFormulario(f));
    const registros = (res?.records ?? []).map((r) => this.deRegistro(r));
    const delSistema = [...modulos, ...formularios, ...registros];

    if (!this.puedeIa()) return this.marcarGrupos(delSistema);

    const ia: SmartItem = {
      tipo: 'ia',
      grupo: GRUPO_IA,
      primeroDelGrupo: false,
      titulo: `Preguntar a la IA: “${texto}”`,
      detalle: 'Abre el asistente y envía tu pregunta',
      icono: 'auto_awesome',
      simbolo: false,
    };
    return this.marcarGrupos(
      this.modoPregunta() || delSistema.length === 0 ? [ia, ...delSistema] : [...delSistema, ia],
    );
  });

  readonly sinResultados = computed<boolean>(() => this.items().length === 0);

  /** Marca la primera fila de cada bloque: es la que pinta la cabecera. */
  private marcarGrupos(items: SmartItem[]): SmartItem[] {
    let anterior = '';
    return items.map((it) => {
      const primero = it.grupo !== anterior;
      anterior = it.grupo;
      return primero ? { ...it, primeroDelGrupo: true } : it;
    });
  }

  private sugerencias(modulos: ModuloAccesible[]): ModuloAccesible[] {
    const porRuta = new Map(modulos.map((m) => [m.ruta, m]));
    const recientes = this.recientes()
      .map((ruta) => porRuta.get(ruta))
      .filter((m): m is ModuloAccesible => !!m);

    const vistos = new Set(recientes.map((m) => m.ruta));
    const relleno = modulos.filter((m) => !vistos.has(m.ruta));
    return [...recientes, ...relleno].slice(0, this.MAX_SUGERENCIAS);
  }

  /**
   * Puntaje de coincidencia. Exige que TODAS las palabras escritas aparezcan en
   * algún lado del módulo (nombre, padres o ruta) — así "nomina novedades"
   * encuentra la hoja aunque el nombre sea solo "Novedades" — y premia que la
   * coincidencia sea en el nombre y lo más al principio posible.
   */
  private puntuar(m: ModuloAccesible, consulta: string, tokens: string[]): number {
    const nombre = normalizarTexto(m.nombre);
    const contexto = normalizarTexto(
      [...m.padres, m.nombre, m.ruta.replace(/[-/]+/g, ' ')].join(' '),
    );
    if (!tokens.every((t) => contexto.includes(t))) return 0;

    let puntos = 10;
    if (nombre === consulta) puntos += 100;
    else if (nombre.startsWith(consulta)) puntos += 70;
    else if (new RegExp(`\\b${this.escaparRegex(consulta)}`).test(nombre)) puntos += 55;
    else if (nombre.includes(consulta)) puntos += 40;
    else if (tokens.every((t) => nombre.includes(t))) puntos += 25;

    // A igualdad de coincidencia, lo menos anidado suele ser lo que se busca.
    return puntos - m.padres.length * 2;
  }

  private escaparRegex(v: string): string {
    return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── Filas ─────────────────────────────────────────────────────────────────────

  private deModulo(m: ModuloAccesible, grupo: string): SmartItem {
    return {
      tipo: 'modulo',
      grupo,
      primeroDelGrupo: false,
      titulo: m.nombre,
      detalle: m.padres.length ? m.padres.join(' › ') : 'Módulo',
      icono: m.icono && m.icono !== 'widgets' ? m.icono : 'chevron_right',
      simbolo: true,
      ruta: m.ruta,
      recordar: true,
    };
  }

  /** Formulario → su tabla de registros (o el formulario, si solo puede llenarlo). */
  private deFormulario(f: QuickSearchForm): SmartItem {
    const registros = f.submissions_count === 1 ? '1 registro' : `${f.submissions_count} registros`;
    return {
      tipo: 'formulario',
      grupo: GRUPO_FORMULARIOS,
      primeroDelGrupo: false,
      titulo: f.name,
      detalle: f.can_view_responses
        ? [f.category, `Ver la tabla · ${registros}`].filter(Boolean).join(' · ')
        : [f.category, 'Abrir el formulario'].filter(Boolean).join(' · '),
      icono: 'table_chart',
      simbolo: false,
      ruta: this.rutaFormulario(f),
      chip: f.can_view_responses ? undefined : 'Solo llenar',
    };
  }

  /** Registro → la tabla de su formulario, abierta en la ficha individual de ESE registro. */
  private deRegistro(r: QuickSearchRecord): SmartItem {
    const partes = [r.form_name];
    if (r.status && ESTADOS[r.status]) partes.push(ESTADOS[r.status]);
    if (r.match_label) partes.push(`coincide en ${r.match_label}`);
    return {
      tipo: 'registro',
      grupo: GRUPO_REGISTROS,
      primeroDelGrupo: false,
      titulo: r.title,
      detalle: partes.join(' · '),
      icono: 'contact_page',
      simbolo: false,
      ruta: this.rutaRespuestas(r),
      datos: r.fields,
      registroId: r.id,
    };
  }

  /**
   * Ruta canónica del formulario (la que tiene colgada del menú) o, si no está colgado,
   * la del submódulo de gestión. Cuando el usuario puede ver los registros se entra
   * directo a la tabla; si solo puede llenarlo, al formulario.
   */
  private rutaFormulario(f: QuickSearchForm): string {
    const base = f.route_path ? `/dashboard/${f.route_path}` : `${RUTA_FORMULARIOS}/${f.id}`;
    return f.can_view_responses ? `${base}/respuestas` : base;
  }

  private rutaRespuestas(r: QuickSearchRecord): string {
    const base = r.route_path ? `/dashboard/${r.route_path}` : `${RUTA_FORMULARIOS}/${r.form_id}`;
    return `${base}/respuestas`;
  }

  // ── Apertura / cierre ─────────────────────────────────────────────────────────

  abrir(): void {
    if (!this.isBrowser) return;
    this.recargarModulos();
    this.activo.set(0);
    this.abierto.set(true);
    this.enfocarCampo();
  }

  cerrar(): void {
    this.abierto.set(false);
    this.activo.set(0);
    if (this.compacto()) this.consulta.set('');
  }

  limpiar(): void {
    this.consulta.set('');
    this.activo.set(0);
    this.remoto.set(null);
    this.buscando.set(false);
    this.tecleo.next('');
    this.enfocarCampo();
  }

  onConsulta(valor: string): void {
    this.consulta.set(valor);
    this.activo.set(0);
    this.tecleo.next(valor);
    if (!this.abierto()) this.abrir();
  }

  /** Relee el árbol en cada apertura: el navbar lo refresca contra el backend. */
  private recargarModulos(): void {
    const delArbol = this.permisos.listReadableModules();
    const rutas = new Set(delArbol.map((m) => m.ruta));
    const fijos = this.FIJOS.filter((f) => !rutas.has(f.ruta));
    this.modulos.set([...fijos, ...delArbol]);
    this.puedeIa.set(this.permisos.canReadRoute(this.RUTA_IA));
  }

  private enfocarCampo(): void {
    if (!this.isBrowser) return;
    setTimeout(() => {
      const el = this.campo?.nativeElement;
      el?.focus();
      el?.select();
    });
  }

  // ── Navegación ────────────────────────────────────────────────────────────────

  ejecutar(item: SmartItem): void {
    if (item.tipo === 'ia') {
      const pregunta = this.consulta().trim();
      this.limpiarYCerrar();
      this.router.navigate([this.RUTA_IA], { queryParams: { q: pregunta } });
      return;
    }

    if (!item.ruta) return;
    if (item.recordar) this.guardarReciente(item.ruta);
    this.limpiarYCerrar();

    // La tabla de respuestas abre la ficha individual del registro que pide la URL.
    if (item.registroId != null) {
      this.router.navigate([item.ruta], { queryParams: { registro: item.registroId } });
      return;
    }
    this.router.navigateByUrl(item.ruta);
  }

  private limpiarYCerrar(): void {
    this.cerrar();
    this.consulta.set('');
    this.remoto.set(null);
    this.buscando.set(false);
    // Vaciar también el flujo: si no, `distinctUntilChanged` se quedaría con el último
    // texto y volver a escribir lo mismo no dispararía la búsqueda.
    this.tecleo.next('');
  }

  private guardarReciente(ruta: string): void {
    const siguiente = [ruta, ...this.recientes().filter((r) => r !== ruta)].slice(0, this.MAX_RECIENTES);
    this.recientes.set(siguiente);
    setLocalStorageItem(this.CLAVE_RECIENTES, JSON.stringify(siguiente));
  }

  private leerRecientes(): string[] {
    try {
      const raw = getLocalStorageItem(this.CLAVE_RECIENTES);
      const lista = raw ? JSON.parse(raw) : null;
      return Array.isArray(lista) ? lista.filter((r) => typeof r === 'string') : [];
    } catch {
      return [];
    }
  }

  // ── Teclado ───────────────────────────────────────────────────────────────────

  onTeclado(ev: KeyboardEvent): void {
    const total = this.items().length;

    switch (ev.key) {
      case 'ArrowDown':
        if (!total) return;
        ev.preventDefault();
        this.activo.set((this.activo() + 1) % total);
        break;
      case 'ArrowUp':
        if (!total) return;
        ev.preventDefault();
        this.activo.set((this.activo() - 1 + total) % total);
        break;
      case 'Enter': {
        const item = this.items()[this.activo()];
        if (!item) return;
        ev.preventDefault();
        this.ejecutar(item);
        break;
      }
      case 'Escape':
        ev.preventDefault();
        this.limpiarYCerrar();
        this.campo?.nativeElement.blur();
        break;
      case 'Tab':
        this.cerrar();
        break;
    }
  }

  /** Ctrl/⌘ + K desde cualquier pantalla del dashboard. */
  @HostListener('document:keydown', ['$event'])
  onAtajoGlobal(ev: KeyboardEvent): void {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    if ((ev.key || '').toLowerCase() !== 'k') return;
    ev.preventDefault();
    this.abrir();
  }

  @HostListener('document:click', ['$event'])
  onClickFuera(ev: MouseEvent): void {
    if (!this.abierto()) return;
    const dentro = this.host.nativeElement.contains(ev.target as Node);
    if (!dentro) this.cerrar();
  }

  // ── Responsive ────────────────────────────────────────────────────────────────

  private onResize = () => this.revisarAncho();

  private revisarAncho(): void {
    if (!this.isBrowser) return;
    const compacto = window.innerWidth <= this.MOBILE_BREAKPOINT;
    if (compacto !== this.compacto()) {
      this.compacto.set(compacto);
      if (!compacto) this.abierto.set(false);
    }
  }

  esActivo(i: number): boolean {
    return this.activo() === i;
  }

  marcarActivo(i: number): void {
    this.activo.set(i);
  }
}
