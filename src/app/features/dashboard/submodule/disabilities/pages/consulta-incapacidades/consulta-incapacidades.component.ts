import { DecimalPipe, registerLocaleData } from '@angular/common';
import localeEsCo from '@angular/common/locales/es-CO';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  afterEveryRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSort, Sort } from '@angular/material/sort';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Observable, Subject, Subscription, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, map, switchMap, tap } from 'rxjs/operators';
import Swal from 'sweetalert2';

import { ColumnCellTemplateDirective } from '@/app/shared/directives/column-cell-template.directive';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';

import {
  EstadoDocumento,
  EstadoIncapacidad,
  NivelAlerta,
  ResponsablePago,
  TipoIncapacidad,
} from '../../models/incapacidad-v2.model';
import {
  IncapacidadV2Service,
  OrdenListado,
} from '../../services/incapacidad-v2/incapacidad-v2.service';
import { aIsoCorto, parsearFechaFlexible } from '../../utils/fechas';
import { codigoSinGuion } from '../../utils/codigos';
import {
  OpcionSelect,
  SelectBuscadorComponent,
} from './componentes/select-buscador/select-buscador.component';
import {
  CATALOGOS_RESPALDO,
  COLOR_ESTADO,
  COLOR_ESTADO_DOCUMENTO,
  COLOR_NIVEL_ALERTA,
  COLOR_RESPONSABLE_PAGO,
  CONTEOS_KPI_VACIOS,
  ChipFiltro,
  ConteosKpi,
  DefinicionKpi,
  FiltrosConsultaIncapacidad,
  IncapacidadResumenExtendido,
  KPIS,
  construirStatusConfig,
  etiquetaDeCatalogo,
} from './consulta-incapacidades.model';
import {
  DatosDialogoDetalle,
  DialogoDetalleIncapacidadComponent,
  ResultadoDialogoDetalle,
} from './dialogos/dialogo-detalle-incapacidad/dialogo-detalle-incapacidad.component';
import {
  DatosDialogoExportar,
  DialogoExportarIncapacidadesComponent,
} from './dialogos/dialogo-exportar-incapacidades/dialogo-exportar-incapacidades.component';
import {
  DialogoCargaMasivaRadicadosComponent,
  ResultadoDialogoCargaMasiva,
} from './dialogos/dialogo-carga-masiva-radicados/dialogo-carga-masiva-radicados.component';
import {
  DatosDialogoExportMasivo,
  DialogoExportMasivoComponent,
} from './dialogos/dialogo-export-masivo/dialogo-export-masivo.component';
import { DialogoInformeUmbralComponent } from './dialogos/dialogo-informe-umbral/dialogo-informe-umbral.component';
import { indicadorSoportes, soportesCompletos } from './exportacion-incapacidades';

// Los KPI se pintan con separador de miles colombiano (1.234, no 1,234).
// `main.ts` registra el locale pero NO provee `LOCALE_ID`, asi que el pipe lo
// recibe explicitamente; se registra tambien aqui para que la vista funcione
// aunque se cargue desde el bootstrap de servidor (que no lo registra).
registerLocaleData(localeEsCo, 'es-CO');

/** Ruta de la vista de registro/edicion (la construye F2). */
export const RUTA_REGISTRO = '/dashboard/disabilities/registro';

/** Clave de persistencia de la configuracion de columnas de la tabla. */
export const CLAVE_ALMACENAMIENTO_TABLA = 'incapacidades-v2-consulta-tabla';

/** Fila lista para pintar: todo pre-formateado, sin llamadas desde la plantilla. */
export interface FilaTabla {
  id: number;
  consecutivoSistema: string;
  cedula: string;
  nombreCompleto: string;
  empresa: string;
  centroCosto: string;
  tipoIncapacidad: string;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  dias: number | null;
  diasEmpresa: number | null;
  diasEntidad: number | null;
  eps: string;
  responsablePago: string;
  estado: string;
  estadoDocumento: string;
  soportes: string;
  creadoPor: string;
  creadoEn: Date | null;

  // ── Radicacion (V44) ────────────────────────────────────────────────
  numeroRadicado: string;
  fechaRadicado: Date | null;
  semanaRadicacion: string;
  entidadGrupo: string;
  dondeRadicado: string;
  radicadoPor: string;

  // ── Metadatos (no son columnas) ─────────────────────────────────────
  estadoCodigo: EstadoIncapacidad;
  puedeValidarse: boolean;
  soportesOk: boolean | null;
  nivelAlerta: NivelAlerta | null;
  origen: IncapacidadResumenExtendido;
}

/**
 * Campos por los que el backend puede ordenar.
 * La clave es el `name` de la columna; el valor, el campo de la entidad.
 * Lo que no este aqui se manda tal cual.
 */
const CAMPO_ORDEN: Readonly<Record<string, string>> = {
  // La lista blanca del backend (CAMPOS_ORDENABLES) no tiene campos derivados:
  // se traducen a los atributos reales de la entidad o el sort responde 400.
  consecutivoSistema: 'codigoUnico',
  nombreCompleto: 'primerApellido',
  creadoEn: 'creadoEn',
};

/** Guion largo para las celdas vacias (mejor que dejarlas en blanco). */
const VACIO = '—';

function textoOVacio(valor: unknown): string {
  const texto = valor === null || valor === undefined ? '' : String(valor).trim();
  return texto || VACIO;
}

function numeroONulo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return isNaN(n) ? null : n;
}

/**
 * Vista de CONSULTA / CRUD de incapacidades v2.
 *
 * ARQUITECTURA (leer antes de tocar):
 *
 *  1. TODO el filtrado y la paginacion son de SERVIDOR. Cada cambio del panel
 *     de filtros dispara `GET /Incapacidades/v2` con los parametros y vuelve a
 *     calcular los KPI. Nunca se filtra el array en memoria: seria mentir sobre
 *     el total (el error clasico del modulo viejo).
 *
 *  2. La tabla es `app-standard-filter-table`, el componente compartido que ya
 *     usan 23 modulos. De el se aprovechan el render, las columnas sticky, el
 *     conmutador tabla/tarjetas, el selector de columnas visibles, la
 *     persistencia en localStorage, el estado vacio y el overlay de carga.
 *     Se le neutralizan por CSS tres cosas (ver el .css, seccion "PIEZAS
 *     NEUTRALIZADAS"): su buscador local, su exportador y su paginador, porque
 *     los tres trabajan solo sobre las filas ya cargadas y aqui eso enganaria.
 *     En su lugar esta vista pone su propio buscador (servidor), su propio
 *     dialogo de exportacion (con alcance real) y su propio paginador.
 *
 *  3. ZONELESS: todo el estado son signals. No hay ni un `markForCheck`.
 *     Las suscripciones se cortan con `takeUntilDestroyed` Y ademas se guardan
 *     en un `Subscription` que se libera en `ngOnDestroy` (los componentes
 *     viejos del modulo tienen fugas; aqui no se replican).
 */
@Component({
  selector: 'app-consulta-incapacidades',
  standalone: true,
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatSelectModule,
    MatButtonToggleModule,
    MatDividerModule,
    MatTooltipModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    StandardFilterTable,
    ColumnCellTemplateDirective,
    SelectBuscadorComponent,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './consulta-incapacidades.component.html',
  styleUrl: './consulta-incapacidades.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsultaIncapacidadesComponent implements OnInit, OnDestroy {
  private readonly srv = inject(IncapacidadV2Service);
  private readonly dialogo = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Referencia a la tabla compartida (para engancharle el ordenamiento). */
  private readonly tabla = viewChild(StandardFilterTable);

  /** Se libera entera en ngOnDestroy. */
  private readonly subs = new Subscription();

  /** Instancia de MatSort ya enganchada y su suscripcion (se rehacen al vuelo). */
  private sortEnganchado?: MatSort;
  private suscripcionOrden?: Subscription;

  readonly rutaRegistro = RUTA_REGISTRO;
  readonly claveAlmacenamiento = CLAVE_ALMACENAMIENTO_TABLA;
  readonly kpisDefinidos = KPIS;

  /** Tamanos de pagina del paginador REAL (el de servidor). */
  readonly opcionesTamanoPagina: number[] = [10, 20, 50, 100];

  /**
   * El paginador interno de la tabla compartida esta oculto por CSS, pero su
   * `MatTableDataSource` sigue recortando por `pageSize`. Se le da un tamano
   * enorme para que ese recorte sea la identidad y pinte la pagina completa que
   * ya vino del servidor. Son constantes (no expresiones en la plantilla) para
   * no disparar `ngOnChanges` en cada ciclo de deteccion.
   */
  readonly tamanoInternoTabla = 1000;
  readonly opcionesTamanoInterno: number[] = [1000];

  // ── Estado de la consulta ─────────────────────────────────────────────

  readonly filas = signal<FilaTabla[]>([]);
  readonly crudas = signal<IncapacidadResumenExtendido[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly tamanoPagina = signal(20);
  readonly orden = signal<OrdenListado | undefined>(undefined);
  readonly cargando = signal(false);
  readonly error = signal('');

  readonly filtrosAplicados = signal<FiltrosConsultaIncapacidad>({});

  // ── Catalogos ─────────────────────────────────────────────────────────

  readonly catalogos = this.srv.catalogosCache;
  /** `true` si se estan usando los catalogos de respaldo (endpoint caido). */
  readonly catalogosDeRespaldo = signal(false);
  private readonly catalogosLocales = signal(CATALOGOS_RESPALDO);

  /** Catalogo efectivo: el del backend si llego, si no el de respaldo. */
  private readonly catalogoEfectivo = computed(
    () => this.catalogos() ?? this.catalogosLocales(),
  );

  // ── KPI (conteos del backend, NO de la pagina cargada) ────────────────

  readonly kpis = signal<ConteosKpi>({ ...CONTEOS_KPI_VACIOS });
  readonly cargandoKpis = signal(false);

  // ── Facetas derivadas de lo que el backend ya devolvio ────────────────

  private readonly facetas = signal<Record<string, string[]>>({
    empresa: [],
    centroCosto: [],
    eps: [],
    afp: [],
    oficina: [],
    temporal: [],
    creadoPor: [],
  });

  /** Nombres de la matriz oficial de EPS (V43): base del filtro de EPS. */
  private readonly epsMatrizNombres = signal<string[]>([]);

  // ── UI ────────────────────────────────────────────────────────────────

  readonly panelFiltrosAbierto = signal(true);

  // ── Formulario de filtros ─────────────────────────────────────────────

  readonly formulario = new FormGroup({
    q: new FormControl('', { nonNullable: true }),
    empresa: new FormControl('', { nonNullable: true }),
    centroCosto: new FormControl('', { nonNullable: true }),
    temporal: new FormControl('', { nonNullable: true }),
    eps: new FormControl('', { nonNullable: true }),
    afp: new FormControl('', { nonNullable: true }),
    oficina: new FormControl('', { nonNullable: true }),
    tipoIncapacidad: new FormControl('', { nonNullable: true }),
    estado: new FormControl('', { nonNullable: true }),
    estadoDocumento: new FormControl('', { nonNullable: true }),
    responsablePago: new FormControl('', { nonNullable: true }),
    soportesCompletos: new FormControl<'' | 'true' | 'false'>('', { nonNullable: true }),
    registradoPor: new FormControl('', { nonNullable: true }),
    // ── Radicacion (V44) ────────────────────────────────────────────────
    numeroRadicado: new FormControl('', { nonNullable: true }),
    semanaRadicacion: new FormControl('', { nonNullable: true }),
    entidadGrupo: new FormControl<'' | 'APOYO' | 'ALIANZA'>('', { nonNullable: true }),
    rangoInicio: new FormGroup({
      start: new FormControl<Date | null>(null),
      end: new FormControl<Date | null>(null),
    }),
    rangoRegistro: new FormGroup({
      start: new FormControl<Date | null>(null),
      end: new FormControl<Date | null>(null),
    }),
    rangoRadicado: new FormGroup({
      start: new FormControl<Date | null>(null),
      end: new FormControl<Date | null>(null),
    }),
  });

  // ── Disparadores ──────────────────────────────────────────────────────

  private readonly recargarLista$ = new Subject<void>();
  private readonly recargarKpis$ = new Subject<void>();

  constructor() {
    // Matriz de EPS (V43): siembra las opciones del filtro de EPS aunque las
    // filas ya cargadas aun no hayan mostrado todas las EPS. Si falla, el
    // filtro sigue funcionando solo con las facetas observadas.
    this.srv
      .epsMatriz()
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((matriz) => {
        if (matriz?.length) this.epsMatrizNombres.set(matriz.map((e) => e.nombre));
      });

    // Listado (switchMap: la respuesta vieja se descarta si llega tarde).
    this.subs.add(
      this.recargarLista$
        .pipe(
          tap(() => {
            this.cargando.set(true);
            this.error.set('');
          }),
          switchMap(() =>
            this.srv
              .listar(
                this.filtrosAplicados(),
                this.pagina(),
                this.tamanoPagina(),
                this.orden(),
              )
              .pipe(
                catchError((e: unknown) => {
                  this.error.set(mensajeDeError(e));
                  return of(null);
                }),
              ),
          ),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((pagina) => {
          this.cargando.set(false);
          if (!pagina) {
            this.filas.set([]);
            this.crudas.set([]);
            this.total.set(0);
            return;
          }
          const contenido = (pagina.content ?? []) as IncapacidadResumenExtendido[];
          this.crudas.set(contenido);
          this.filas.set(contenido.map((r) => this.aFila(r)));
          this.total.set(pagina.totalElements ?? contenido.length);
          this.absorberFacetas(contenido);
        }),
    );

    // KPI.
    this.subs.add(
      this.recargarKpis$
        .pipe(
          tap(() => this.cargandoKpis.set(true)),
          switchMap(() => this.consultarKpis()),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((conteos) => {
          this.cargandoKpis.set(false);
          this.kpis.set(conteos);
        }),
    );

    // Cada cambio del panel se aplica solo (la funcional pidio "muy dinamico").
    this.subs.add(
      this.formulario.valueChanges
        .pipe(debounceTime(350), takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.aplicarFiltros()),
    );

    // El `MatSort` de la tabla compartida se destruye y se vuelve a crear cada
    // vez que el usuario conmuta entre tabla y tarjetas, asi que no basta con
    // engancharlo una vez en `ngAfterViewInit`: hay que revisar en cada render
    // si cambio la instancia (comparacion de referencia, coste despreciable).
    afterEveryRender(() => this.engancharOrdenamiento());
  }

  // ── Ciclo de vida ─────────────────────────────────────────────────────

  ngOnInit(): void {
    this.subs.add(
      this.srv
        .catalogos()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.catalogosDeRespaldo.set(false),
          error: () => this.catalogosDeRespaldo.set(true),
        }),
    );

    this.filtrosAplicados.set(this.construirFiltros());
    this.recargarLista$.next();
    this.recargarKpis$.next();
  }

  ngOnDestroy(): void {
    this.suscripcionOrden?.unsubscribe();
    this.subs.unsubscribe();
    this.recargarLista$.complete();
    this.recargarKpis$.complete();
  }

  /**
   * El componente compartido no expone el ordenamiento como `@Output`, pero su
   * `MatSort` es publico. Se engancha aqui para que ordenar por una columna
   * reordene TODO el resultado en el servidor y no solo la pagina visible.
   *
   * Se vuelve a enganchar si cambia la instancia (pasa al conmutar entre vista
   * de tabla y de tarjetas), y se suelta la anterior para no acumular fugas.
   */
  private engancharOrdenamiento(): void {
    const sort = this.tabla()?.sort;
    if (sort === this.sortEnganchado) return;

    this.suscripcionOrden?.unsubscribe();
    this.sortEnganchado = sort;
    if (!sort) return;

    this.suscripcionOrden = sort.sortChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((evento: Sort) => {
        if (!evento.direction) {
          this.orden.set(undefined);
        } else {
          const campo = CAMPO_ORDEN[evento.active] ?? evento.active;
          this.orden.set({ campo, direccion: evento.direction });
        }
        this.pagina.set(0);
        this.recargarLista$.next();
      });
  }

  // ── Columnas ──────────────────────────────────────────────────────────

  /**
   * Definicion de columnas. Se recalcula cuando llegan los catalogos porque
   * `statusConfig` se indexa por la ETIQUETA visible, no por el codigo.
   *
   * `filterable: false` en todas a proposito: el filtrado de este listado es de
   * servidor y vive en el panel de arriba. Dejar activos los filtros locales del
   * componente compartido haria creer que se filtra sobre el total cuando en
   * realidad solo se filtraria la pagina cargada.
   */
  readonly columnas = computed<ColumnDefinition[]>(() => {
    const cat = this.catalogoEfectivo();

    return [
      {
        name: 'consecutivoSistema',
        header: 'Codigo unico',
        type: 'text',
        width: '140px',
        filterable: false,
        stickyStart: true,
      },
      { name: 'cedula', header: 'Cedula', type: 'text', width: '120px', filterable: false },
      {
        name: 'nombreCompleto',
        header: 'Trabajador',
        type: 'text',
        width: '220px',
        filterable: false,
      },
      { name: 'empresa', header: 'Empresa', type: 'text', width: '180px', filterable: false },
      {
        name: 'centroCosto',
        header: 'Centro de costo',
        type: 'text',
        width: '170px',
        filterable: false,
      },
      {
        name: 'tipoIncapacidad',
        header: 'Tipo',
        type: 'text',
        width: '170px',
        filterable: false,
      },
      { name: 'fechaInicio', header: 'Inicio', type: 'date', width: '110px', filterable: false },
      { name: 'fechaFin', header: 'Fin', type: 'date', width: '110px', filterable: false },
      {
        name: 'dias',
        header: 'Dias',
        type: 'number',
        width: '80px',
        align: 'right',
        filterable: false,
      },
      {
        name: 'diasEmpresa',
        header: 'Dias empresa',
        type: 'number',
        width: '110px',
        align: 'right',
        filterable: false,
      },
      {
        name: 'diasEntidad',
        header: 'Dias entidad',
        type: 'number',
        width: '110px',
        align: 'right',
        filterable: false,
      },
      { name: 'eps', header: 'EPS', type: 'text', width: '150px', filterable: false },
      {
        name: 'responsablePago',
        header: 'Responsable de pago',
        type: 'status',
        width: '180px',
        filterable: false,
        statusConfig: construirStatusConfig<ResponsablePago>(
          cat.responsablesPago,
          COLOR_RESPONSABLE_PAGO,
        ),
      },
      {
        name: 'estado',
        header: 'Estado',
        type: 'status',
        width: '160px',
        filterable: false,
        statusConfig: construirStatusConfig<EstadoIncapacidad>(cat.estados, COLOR_ESTADO),
      },
      {
        name: 'estadoDocumento',
        header: 'Estado del documento',
        type: 'status',
        width: '190px',
        filterable: false,
        statusConfig: construirStatusConfig<EstadoDocumento>(
          cat.estadosDocumento,
          COLOR_ESTADO_DOCUMENTO,
        ),
      },
      {
        name: 'soportes',
        header: 'Soportes',
        type: 'custom',
        width: '110px',
        filterable: false,
        sortable: false,
      },
      // ── Radicacion (V44) ───────────────────────────────────────────────
      {
        name: 'numeroRadicado',
        header: 'Numero de radicado',
        type: 'text',
        width: '160px',
        filterable: false,
      },
      {
        name: 'fechaRadicado',
        header: 'Fecha de radicado',
        type: 'date',
        width: '140px',
        filterable: false,
      },
      {
        name: 'semanaRadicacion',
        header: 'Semana',
        type: 'text',
        width: '90px',
        filterable: false,
      },
      {
        name: 'entidadGrupo',
        header: 'Entidad (carpeta)',
        type: 'text',
        width: '130px',
        filterable: false,
      },
      {
        name: 'dondeRadicado',
        header: 'Donde se radico',
        type: 'text',
        width: '140px',
        filterable: false,
        sortable: false,
      },
      {
        name: 'radicadoPor',
        header: 'Radicado por',
        type: 'text',
        width: '160px',
        filterable: false,
        sortable: false,
      },
      {
        name: 'creadoPor',
        header: 'Registrado por',
        type: 'text',
        width: '170px',
        filterable: false,
        // El backend no acepta ordenar por creadoPor (lista blanca): seria un 400.
        sortable: false,
      },
      {
        name: 'creadoEn',
        header: 'Fecha de registro',
        type: 'date',
        width: '140px',
        filterable: false,
      },
      {
        name: 'actions',
        header: 'Acciones',
        type: 'custom',
        width: '170px',
        filterable: false,
        sortable: false,
        stickyEnd: true,
      },
    ];
  });

  /** Claves de las columnas que se ven en la tabla (para el dialogo de export). */
  readonly nombresColumnasTabla = computed(() =>
    this.columnas()
      .map((c) => c.name)
      .filter((n) => n !== 'actions'),
  );

  // ── Opciones de los desplegables ──────────────────────────────────────

  private opcionesDeCatalogo(
    lista: readonly { codigo: string; etiqueta: string; automatico?: boolean }[],
  ): OpcionSelect[] {
    return lista.map((o) => ({
      valor: o.codigo,
      etiqueta: o.etiqueta || o.codigo,
      detalle: o.codigo,
      automatico: o.automatico === true,
    }));
  }

  readonly opcionesTipo = computed(() =>
    this.opcionesDeCatalogo(this.catalogoEfectivo().tiposIncapacidad),
  );
  readonly opcionesEstado = computed(() =>
    this.opcionesDeCatalogo(this.catalogoEfectivo().estados),
  );
  readonly opcionesEstadoDocumento = computed(() =>
    this.opcionesDeCatalogo(this.catalogoEfectivo().estadosDocumento),
  );
  readonly opcionesResponsablePago = computed(() =>
    this.opcionesDeCatalogo(this.catalogoEfectivo().responsablesPago),
  );

  private opcionesFaceta(campo: string): OpcionSelect[] {
    return (this.facetas()[campo] ?? []).map((v) => ({ valor: v, etiqueta: v }));
  }

  readonly opcionesEmpresa = computed(() => this.opcionesFaceta('empresa'));
  readonly opcionesCentroCosto = computed(() => this.opcionesFaceta('centroCosto'));
  /** EPS: la matriz oficial de cartera (V43) + lo que haya devuelto el backend. */
  readonly opcionesEps = computed<OpcionSelect[]>(() => {
    const nombres = new Set<string>(this.epsMatrizNombres());
    for (const vista of this.facetas()['eps'] ?? []) nombres.add(vista);
    return [...nombres]
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((v) => ({ valor: v, etiqueta: v }));
  });
  readonly opcionesAfp = computed(() => this.opcionesFaceta('afp'));
  readonly opcionesOficina = computed(() => this.opcionesFaceta('oficina'));
  readonly opcionesRegistradoPor = computed(() => this.opcionesFaceta('creadoPor'));

  /** Temporal: los dos codigos conocidos + lo que haya devuelto el backend. */
  readonly opcionesTemporal = computed<OpcionSelect[]>(() => {
    const conocidas: OpcionSelect[] = [
      { valor: 'Apoyo Laboral', etiqueta: 'Apoyo Laboral', detalle: 'AL' },
      { valor: 'Tu Alianza', etiqueta: 'Tu Alianza', detalle: 'TA' },
    ];
    const vistas = this.facetas()['temporal'] ?? [];
    const extra = vistas
      .filter((v) => !conocidas.some((c) => c.valor === v))
      .map((v) => ({ valor: v, etiqueta: v }));
    return [...conocidas, ...extra];
  });

  // ── Chips de filtros activos ──────────────────────────────────────────

  readonly chips = computed<ChipFiltro[]>(() => {
    const f = this.filtrosAplicados();
    const cat = this.catalogoEfectivo();
    const lista: ChipFiltro[] = [];

    const agregar = (claves: string[], etiqueta: string, valor: string, icono: string) => {
      if (valor) lista.push({ claves, etiqueta, valor, icono });
    };

    agregar(['q'], 'Busqueda', f.q ?? '', 'search');
    agregar(['empresa'], 'Empresa', f.empresa ?? '', 'business');
    agregar(['centroCosto'], 'Centro de costo', f.centroCosto ?? '', 'account_tree');
    agregar(['temporal'], 'Temporal', f.temporal ?? '', 'groups');
    agregar(['eps'], 'EPS', f.eps ?? '', 'local_hospital');
    agregar(['afp'], 'Fondo de pension', f.afp ?? '', 'savings');
    agregar(['oficina'], 'Oficina', f.oficina ?? '', 'apartment');
    agregar(
      ['tipoIncapacidad'],
      'Tipo',
      etiquetaDeCatalogo(cat.tiposIncapacidad, f.tipoIncapacidad),
      'category',
    );
    agregar(['estado'], 'Estado', etiquetaDeCatalogo(cat.estados, f.estado), 'flag');
    agregar(
      ['estadoDocumento'],
      'Estado del documento',
      etiquetaDeCatalogo(cat.estadosDocumento, f.estadoDocumento),
      'description',
    );
    agregar(
      ['responsablePago'],
      'Responsable de pago',
      etiquetaDeCatalogo(cat.responsablesPago, f.responsablePago),
      'payments',
    );
    agregar(['registradoPor'], 'Registrado por', f.registradoPor ?? '', 'person');

    if (f.soportesCompletos === 'true') {
      agregar(['soportesCompletos'], 'Soportes', 'Completos', 'attach_file');
    } else if (f.soportesCompletos === 'false') {
      agregar(['soportesCompletos'], 'Soportes', 'Incompletos', 'attach_file_off');
    }

    if (f.desde || f.hasta) {
      agregar(
        ['rangoInicio'],
        'Inicio de la incapacidad',
        rangoLegible(f.desde, f.hasta),
        'event',
      );
    }
    if (f.registradoDesde || f.registradoHasta) {
      agregar(
        ['rangoRegistro'],
        'Fecha de registro',
        rangoLegible(f.registradoDesde, f.registradoHasta),
        'history',
      );
    }

    // ── Radicacion (V44) ────────────────────────────────────────────────
    agregar(['numeroRadicado'], 'Numero de radicado', f.numeroRadicado ?? '', 'tag');
    agregar(
      ['semanaRadicacion'],
      'Semana',
      f.semanaRadicacion ? `Semana ${f.semanaRadicacion}` : '',
      'date_range',
    );
    agregar(
      ['entidadGrupo'],
      'Entidad',
      f.entidadGrupo === 'APOYO' ? 'Apoyo' : f.entidadGrupo === 'ALIANZA' ? 'Alianza' : '',
      'folder_shared',
    );
    if (f.fechaRadicadoDesde || f.fechaRadicadoHasta) {
      agregar(
        ['rangoRadicado'],
        'Fecha de radicado',
        rangoLegible(f.fechaRadicadoDesde, f.fechaRadicadoHasta),
        'outgoing_mail',
      );
    }

    return lista;
  });

  readonly hayFiltros = computed(() => this.chips().length > 0);

  /** "21 – 40 de 500" para la cabecera de resultados. */
  readonly textoRango = computed(() => {
    const total = this.total();
    if (total === 0) return 'Sin resultados';
    const inicio = this.pagina() * this.tamanoPagina() + 1;
    const fin = Math.min(inicio + this.filas().length - 1, total);
    return `${inicio} – ${fin} de ${total}`;
  });

  // ── Construccion de los filtros que van al servidor ───────────────────

  /**
   * Traduce el formulario a los query params del backend.
   * Las fechas pasan SIEMPRE por `aIsoCorto` (prohibido `toISOString`: en UTC-5
   * restaria un dia). Los valores vacios no se incluyen.
   */
  construirFiltros(): FiltrosConsultaIncapacidad {
    const v = this.formulario.getRawValue();
    const filtros: FiltrosConsultaIncapacidad = {};

    const texto = (valor: string | null | undefined) => (valor ?? '').trim();

    if (texto(v.q)) filtros.q = texto(v.q);
    if (texto(v.empresa)) filtros.empresa = texto(v.empresa);
    if (texto(v.centroCosto)) filtros.centroCosto = texto(v.centroCosto);
    if (texto(v.temporal)) filtros.temporal = texto(v.temporal);
    if (texto(v.eps)) filtros.eps = texto(v.eps);
    if (texto(v.afp)) filtros.afp = texto(v.afp);
    if (texto(v.oficina)) filtros.oficina = texto(v.oficina);
    if (texto(v.registradoPor)) filtros.registradoPor = texto(v.registradoPor);

    if (texto(v.tipoIncapacidad)) {
      filtros.tipoIncapacidad = texto(v.tipoIncapacidad) as TipoIncapacidad;
    }
    if (texto(v.estado)) filtros.estado = texto(v.estado) as EstadoIncapacidad;
    if (texto(v.estadoDocumento)) {
      filtros.estadoDocumento = texto(v.estadoDocumento) as EstadoDocumento;
    }
    if (texto(v.responsablePago)) {
      filtros.responsablePago = texto(v.responsablePago) as ResponsablePago;
    }

    if (v.soportesCompletos === 'true' || v.soportesCompletos === 'false') {
      filtros.soportesCompletos = v.soportesCompletos;
    }

    const inicioDesde = aIsoCorto(v.rangoInicio.start);
    const inicioHasta = aIsoCorto(v.rangoInicio.end);
    if (inicioDesde) filtros.desde = inicioDesde;
    if (inicioHasta) filtros.hasta = inicioHasta;

    const registroDesde = aIsoCorto(v.rangoRegistro.start);
    const registroHasta = aIsoCorto(v.rangoRegistro.end);
    if (registroDesde) filtros.registradoDesde = registroDesde;
    if (registroHasta) filtros.registradoHasta = registroHasta;

    // ── Radicacion (V44) ────────────────────────────────────────────────
    if (texto(v.numeroRadicado)) filtros.numeroRadicado = texto(v.numeroRadicado);
    const semana = Number(texto(v.semanaRadicacion));
    if (texto(v.semanaRadicacion) && Number.isInteger(semana) && semana > 0) {
      filtros.semanaRadicacion = semana;
    }
    if (v.entidadGrupo === 'APOYO' || v.entidadGrupo === 'ALIANZA') {
      filtros.entidadGrupo = v.entidadGrupo;
    }
    const radicadoDesde = aIsoCorto(v.rangoRadicado.start);
    const radicadoHasta = aIsoCorto(v.rangoRadicado.end);
    if (radicadoDesde) filtros.fechaRadicadoDesde = radicadoDesde;
    if (radicadoHasta) filtros.fechaRadicadoHasta = radicadoHasta;

    return filtros;
  }

  /** Aplica el formulario: vuelve a la pagina 0 y recarga listado + KPI. */
  aplicarFiltros(): void {
    const nuevos = this.construirFiltros();
    if (JSON.stringify(nuevos) === JSON.stringify(this.filtrosAplicados())) return;

    this.filtrosAplicados.set(nuevos);
    this.pagina.set(0);
    this.recargarLista$.next();
    this.recargarKpis$.next();
  }

  /** Recarga manual (boton "Actualizar" y tras crear/editar/eliminar). */
  recargar(): void {
    this.recargarLista$.next();
    this.recargarKpis$.next();
  }

  limpiarTodo(): void {
    this.formulario.reset({
      q: '',
      empresa: '',
      centroCosto: '',
      temporal: '',
      eps: '',
      afp: '',
      oficina: '',
      tipoIncapacidad: '',
      estado: '',
      estadoDocumento: '',
      responsablePago: '',
      soportesCompletos: '',
      registradoPor: '',
      numeroRadicado: '',
      semanaRadicacion: '',
      entidadGrupo: '',
      rangoInicio: { start: null, end: null },
      rangoRegistro: { start: null, end: null },
      rangoRadicado: { start: null, end: null },
    });
  }

  /** Quita un chip concreto. */
  quitarChip(chip: ChipFiltro): void {
    for (const clave of chip.claves) {
      if (clave === 'rangoInicio' || clave === 'rangoRegistro' || clave === 'rangoRadicado') {
        this.formulario.controls[clave].setValue({ start: null, end: null });
      } else {
        const control = this.formulario.get(clave);
        control?.setValue('');
      }
    }
  }

  alternarPanel(): void {
    this.panelFiltrosAbierto.update((v) => !v);
  }

  // ── KPI ───────────────────────────────────────────────────────────────

  /**
   * Los conteos salen del backend en UNA llamada (`GET /Incapacidades/v2/resumen`, V44),
   * con los MISMOS filtros del panel. Si ese endpoint falla (backend anterior), se degrada
   * al camino viejo de una peticion `size=1` por tarjeta.
   */
  private consultarKpis(): Observable<ConteosKpi> {
    const base = this.filtrosAplicados();
    return this.srv.resumen(base).pipe(
      map((r): ConteosKpi => ({
        total: r.total,
        recibidas: r.porEstado?.['RECIBIDA'] ?? 0,
        validadas: r.porEstado?.['VALIDADA'] ?? 0,
        prescritas: r.porEstadoDocumento?.['PRESCRITA'] ?? 0,
        noCumplen: r.porEstadoDocumento?.['NO_CUMPLE'] ?? 0,
        soportesIncompletos: r.sinSoportes,
      })),
      catchError(() => this.consultarKpisPorTarjeta()),
    );
  }

  /** Camino de respaldo: 6 peticiones `size=1` (el contrato viejo, sin /resumen). */
  private consultarKpisPorTarjeta(): Observable<ConteosKpi> {
    const base = this.filtrosAplicados();

    // Una peticion por tarjeta, todas en paralelo y con `size=1`: solo interesa
    // `totalElements`. Si una falla, esa tarjeta queda en "—" y las demas siguen.
    const peticiones = KPIS.map((k) =>
      this.srv.listar({ ...base, ...k.filtro }, 0, 1).pipe(
        map((p): number | null => (typeof p.totalElements === 'number' ? p.totalElements : 0)),
        catchError(() => of<number | null>(null)),
      ),
    );

    return forkJoin(peticiones).pipe(
      map((resultados) => {
        const conteos: ConteosKpi = { ...CONTEOS_KPI_VACIOS };
        KPIS.forEach((k, i) => {
          conteos[k.clave] = resultados[i] ?? null;
        });
        return conteos;
      }),
    );
  }

  /** Al pulsar una tarjeta-KPI se aplica su filtro. */
  aplicarKpi(definicion: DefinicionKpi): void {
    if (definicion.clave === 'total') {
      this.limpiarTodo();
      return;
    }

    const filtro = definicion.filtro;
    this.formulario.patchValue({
      estado: filtro.estado ?? '',
      estadoDocumento: filtro.estadoDocumento ?? '',
      soportesCompletos: filtro.soportesCompletos ?? '',
    });
  }

  /** Numero del KPI o `null` mientras no se sabe. */
  valorKpi(clave: DefinicionKpi['clave']): number | null {
    return this.kpis()[clave];
  }

  /** `true` si el filtro de esa tarjeta es exactamente el que esta aplicado. */
  kpiActivo(definicion: DefinicionKpi): boolean {
    if (definicion.clave === 'total') return !this.hayFiltros();

    const aplicados = this.filtrosAplicados() as Record<string, unknown>;
    const entradas = Object.entries(definicion.filtro);
    return entradas.length > 0 && entradas.every(([clave, valor]) => aplicados[clave] === valor);
  }

  // ── Paginacion ────────────────────────────────────────────────────────

  alCambiarPagina(evento: PageEvent): void {
    let recargar = false;

    if (evento.pageSize !== this.tamanoPagina()) {
      this.tamanoPagina.set(evento.pageSize);
      this.pagina.set(0);
      recargar = true;
    }
    if (evento.pageIndex !== this.pagina()) {
      this.pagina.set(evento.pageIndex);
      recargar = true;
    }

    if (recargar) this.recargarLista$.next();
  }

  // ── Acciones de fila ──────────────────────────────────────────────────

  verDetalle(fila: FilaTabla): void {
    const datos: DatosDialogoDetalle = { id: fila.id, resumen: fila.origen };

    const ref = this.dialogo.open<
      DialogoDetalleIncapacidadComponent,
      DatosDialogoDetalle,
      ResultadoDialogoDetalle | undefined
    >(DialogoDetalleIncapacidadComponent, {
      data: datos,
      width: '980px',
      maxWidth: '96vw',
      maxHeight: '92vh',
      autoFocus: false,
      panelClass: 'disab-dialogo',
    });

    this.subs.add(
      ref.afterClosed().subscribe((resultado) => {
        if (!resultado) return;
        if (resultado.accion === 'editar') this.editar(fila);
        if (resultado.accion === 'eliminar') this.eliminar(fila);
        if (resultado.accion === 'validar') this.validar(fila);
        if (resultado.accion === 'recargar') this.recargar();
      }),
    );
  }

  editar(fila: FilaTabla): void {
    void this.router.navigate([RUTA_REGISTRO, fila.id]);
  }

  /** Borrado LOGICO: se avisa expresamente en la confirmacion. */
  eliminar(fila: FilaTabla): void {
    void Swal.fire({
      icon: 'warning',
      title: '¿Eliminar la incapacidad?',
      html:
        `<p style="margin:0 0 8px">Se eliminara <b>${escaparHtml(fila.consecutivoSistema)}</b> ` +
        `de <b>${escaparHtml(fila.nombreCompleto)}</b>.</p>` +
        '<p style="margin:0;font-size:13px;color:#64748b">' +
        'Es un <b>borrado logico</b>: la incapacidad deja de aparecer en la consulta, ' +
        'pero se conserva en el historico del sistema para auditoria.</p>',
      showCancelButton: true,
      confirmButtonText: 'Si, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#c62828',
      reverseButtons: true,
    }).then((respuesta) => {
      if (!respuesta.isConfirmed) return;

      this.subs.add(
        this.srv.eliminar(fila.id).subscribe({
          next: () => {
            avisar('success', 'Incapacidad eliminada');
            this.recargar();
          },
          error: (e: unknown) => {
            void Swal.fire({
              icon: 'error',
              title: 'No se pudo eliminar',
              text: mensajeDeError(e),
            });
          },
        }),
      );
    });
  }

  /** Promueve a VALIDADA. El 409 llega como `{ ok:false, motivosBloqueo }`. */
  validar(fila: FilaTabla): void {
    this.subs.add(
      this.srv.promoverAValidada(fila.id).subscribe({
        next: (resultado) => {
          if (resultado.ok) {
            avisar('success', 'Incapacidad validada');
            this.recargar();
            return;
          }
          const motivos = resultado.motivosBloqueo
            .map((m) => `<li style="margin:4px 0">${escaparHtml(m)}</li>`)
            .join('');
          void Swal.fire({
            icon: 'warning',
            title: 'No se puede validar todavia',
            html: `<ul style="text-align:left;padding-left:18px;margin:0">${motivos}</ul>`,
            confirmButtonText: 'Entendido',
          });
        },
        error: (e: unknown) => {
          void Swal.fire({ icon: 'error', title: 'Error al validar', text: mensajeDeError(e) });
        },
      }),
    );
  }

  /** Clic sobre la fila (la tabla compartida lo emite). */
  alPulsarFila(fila: unknown): void {
    this.verDetalle(fila as FilaTabla);
  }

  // ── Exportacion ───────────────────────────────────────────────────────

  abrirExportacion(): void {
    const datos: DatosDialogoExportar = {
      filtros: this.filtrosAplicados(),
      orden: this.orden(),
      filasPaginaActual: this.crudas(),
      total: this.total(),
      paginaActual: this.pagina(),
      tamanoPagina: this.tamanoPagina(),
      columnasEnTabla: this.nombresColumnasTabla(),
      catalogos: this.catalogoEfectivo(),
    };

    this.dialogo.open(DialogoExportarIncapacidadesComponent, {
      data: datos,
      width: '760px',
      maxWidth: '96vw',
      maxHeight: '92vh',
      autoFocus: false,
      panelClass: 'disab-dialogo',
    });
  }

  // ── Radicacion (V44): carga masiva, descarga masiva e informe ─────────

  /** Carga masiva de numeros de radicado; al cerrar con exitos, recarga la tabla. */
  abrirCargaMasivaRadicados(): void {
    const ref = this.dialogo.open(DialogoCargaMasivaRadicadosComponent, {
      width: '860px',
      maxWidth: '95vw',
      maxHeight: '92vh',
      autoFocus: false,
      panelClass: 'disab-dialogo',
    });
    this.subs.add(
      ref.afterClosed().subscribe((resultado?: ResultadoDialogoCargaMasiva) => {
        if (resultado?.recargar) this.recargar();
      }),
    );
  }

  /** ZIP de soportes renombrados o Excel consolidado del servidor (jobs asincronos). */
  abrirExportMasivo(): void {
    const datos: DatosDialogoExportMasivo = {
      filtros: this.filtrosAplicados(),
      // El 0 es informacion (el dialogo avisa "no hay nada que exportar"): no se
      // convierte en null.
      totalEstimado: this.total(),
    };
    this.dialogo.open(DialogoExportMasivoComponent, {
      data: datos,
      width: '640px',
      maxWidth: '95vw',
      maxHeight: '92vh',
      autoFocus: false,
      panelClass: 'disab-dialogo',
    });
  }

  /** Informe de personas proximas a 180/540 dias de incapacidad acumulada. */
  abrirInformeUmbral(): void {
    this.dialogo.open(DialogoInformeUmbralComponent, {
      width: '1000px',
      maxWidth: '95vw',
      maxHeight: '92vh',
      autoFocus: false,
      panelClass: 'disab-dialogo',
    });
  }

  // ── Mapeo backend -> fila ─────────────────────────────────────────────

  private aFila(r: IncapacidadResumenExtendido): FilaTabla {
    const cat = this.catalogoEfectivo();

    return {
      id: r.id,
      // V47: el codigo visible de cartera ({AP|TA}{SEDE}{n}, ej. TASB018) manda; las
      // historicas sin codigo caen al codigoUnico tecnico (cedula_fecha).
      // Reunion 2026-08-26: el codigo tecnico se muestra SIN guion bajo.
      consecutivoSistema: textoOVacio(codigoSinGuion(r.codigoConsecutivo ?? r.consecutivoSistema ?? r.codigoUnico)),
      cedula: textoOVacio(r.cedula),
      nombreCompleto: textoOVacio(r.nombreCompleto),
      empresa: textoOVacio(r.empresa),
      centroCosto: textoOVacio(r.centroCosto),
      tipoIncapacidad: etiquetaDeCatalogo(cat.tiposIncapacidad, r.tipoIncapacidad) || VACIO,
      // Fechas como Date: si se pasara el texto ISO, el `date` pipe lo tratria
      // como UTC y en Colombia (UTC-5) pintaria el dia anterior.
      fechaInicio: parsearFechaFlexible(r.fechaInicio),
      fechaFin: parsearFechaFlexible(r.fechaFin),
      dias: numeroONulo(r.dias),
      diasEmpresa: numeroONulo(r.diasEmpresa),
      diasEntidad: numeroONulo(r.diasEntidad),
      // La EPS llega con espacios finales ("NUEVA EPS ", "SURA ").
      eps: textoOVacio(r.eps),
      responsablePago: etiquetaDeCatalogo(cat.responsablesPago, r.responsablePago) || VACIO,
      estado: etiquetaDeCatalogo(cat.estados, r.estado) || VACIO,
      estadoDocumento: etiquetaDeCatalogo(cat.estadosDocumento, r.estadoDocumento) || VACIO,
      soportes: indicadorSoportes(r) || VACIO,
      creadoPor: textoOVacio(r.creadoPor),
      creadoEn: r.creadoEn ? new Date(r.creadoEn) : null,

      numeroRadicado: textoOVacio(r.numeroRadicado),
      fechaRadicado: parsearFechaFlexible(r.fechaRadicado),
      semanaRadicacion: r.semanaRadicacion ? String(r.semanaRadicacion) : VACIO,
      entidadGrupo: textoOVacio(r.entidadGrupoEtiqueta),
      dondeRadicado: textoOVacio(r.dondeRadicadoEtiqueta),
      radicadoPor: textoOVacio(r.radicadoPor),

      estadoCodigo: r.estado,
      puedeValidarse: r.estado === 'RECIBIDA',
      soportesOk: soportesCompletos(r),
      nivelAlerta: r.nivelAlertaMaximo ?? null,
      origen: r,
    };
  }

  /**
   * Alimenta los desplegables de empresa / centro de costo / EPS / AFP /
   * oficina / temporal / registrado por con los valores distintos que va
   * devolviendo el backend. Nunca se pierden valores ya vistos.
   */
  private absorberFacetas(filas: readonly IncapacidadResumenExtendido[]): void {
    if (!filas.length) return;

    const actual = this.facetas();
    const siguiente: Record<string, string[]> = { ...actual };
    let cambio = false;

    const campos: { clave: string; leer: (f: IncapacidadResumenExtendido) => unknown }[] = [
      { clave: 'empresa', leer: (f) => f.empresa },
      { clave: 'centroCosto', leer: (f) => f.centroCosto },
      { clave: 'eps', leer: (f) => f.eps },
      { clave: 'afp', leer: (f) => f.afp },
      { clave: 'oficina', leer: (f) => f.oficina },
      { clave: 'temporal', leer: (f) => f.temporal },
      { clave: 'creadoPor', leer: (f) => f.creadoPor },
    ];

    for (const campo of campos) {
      const conjunto = new Set(actual[campo.clave] ?? []);
      const antes = conjunto.size;
      for (const fila of filas) {
        const valor = (campo.leer(fila) ?? '').toString().trim();
        if (valor) conjunto.add(valor);
      }
      if (conjunto.size !== antes) {
        siguiente[campo.clave] = [...conjunto].sort((a, b) => a.localeCompare(b, 'es'));
        cambio = true;
      }
    }

    if (cambio) this.facetas.set(siguiente);
  }

  // ── Utilidades de plantilla ───────────────────────────────────────────

  /** Estilo del punto de alerta de la fila. */
  colorAlerta(nivel: NivelAlerta | null): string {
    return nivel ? COLOR_NIVEL_ALERTA[nivel].color : 'transparent';
  }

  trackFila = (_: number, fila: FilaTabla) => fila.id;
}

/** Rango de fechas legible para los chips. */
function rangoLegible(desde?: string, hasta?: string): string {
  const d = formatearIso(desde);
  const h = formatearIso(hasta);
  if (d && h) return `${d} — ${h}`;
  if (d) return `desde ${d}`;
  if (h) return `hasta ${h}`;
  return '';
}

function formatearIso(iso?: string): string {
  const fecha = parsearFechaFlexible(iso);
  if (!fecha) return '';
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${fecha.getFullYear()}`;
}

/** Mensaje de error util (y honesto sobre el backend v2 que aun no existe). */
export function mensajeDeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'No hay conexion con el servidor. Revisa tu red e intenta de nuevo.';
    }
    if (error.status === 401 || error.status === 403) {
      return 'Tu sesion no tiene permiso para consultar incapacidades.';
    }
    if (error.status === 404) {
      return 'El servicio de incapacidades v2 todavia no responde en este entorno.';
    }
    if (error.status >= 500) {
      return 'El servidor fallo al consultar las incapacidades. Intentalo mas tarde.';
    }
    const cuerpo = error.error as { message?: unknown } | string | null;
    if (typeof cuerpo === 'string' && cuerpo.trim()) return cuerpo.trim();
    if (cuerpo && typeof cuerpo === 'object' && typeof cuerpo.message === 'string') {
      return cuerpo.message;
    }
    return `Error ${error.status} al consultar incapacidades.`;
  }
  return 'Ocurrio un error inesperado al consultar incapacidades.';
}

/** Escapa texto que se inyecta como HTML en los Swal. */
function escaparHtml(texto: string): string {
  return (texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Toast discreto arriba a la derecha. */
function avisar(icono: 'success' | 'info' | 'error', titulo: string): void {
  void Swal.fire({
    toast: true,
    position: 'top-end',
    icon: icono,
    title: titulo,
    showConfirmButton: false,
    timer: 2600,
    timerProgressBar: true,
  });
}
