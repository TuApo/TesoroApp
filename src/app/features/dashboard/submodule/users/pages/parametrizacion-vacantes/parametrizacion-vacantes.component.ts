import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatSelect } from '@angular/material/select';

import { SharedModule } from '@/app/shared/shared.module';
import { AvisoDialogComponent, AvisoDialogData, AvisoIcono } from '@/app/shared/components/confirm-dialog/confirm-dialog.component';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
// El buscador inteligente nacio en Crear Vacante y es standalone: se reutiliza tal cual en vez
// de copiarlo. Busca por palabras sueltas, resalta lo que casa y solo saca la caja de busqueda
// cuando hay mas de 7 opciones, asi que sirve igual para 177 centros que para 3 calendarios.
import { SmartSelectComponent } from '../../../vacancies/components/smart-select/smart-select.component';
import { DynamicFormDialogComponent, FieldConfig } from '@/app/shared/components/dynamic-form-dialog/dynamic-form-dialog.component';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';

import {
  AreaOperativa,
  SeguroFunerario, CentroSeguro, SeguroCentro, SalarioMinimoAnio,
  PerfilVacante, CargoArea, ConfiguracionCentroCargo, EsquemaLabor,
  CargoVacante, CentroArea, CentroOpcion, CentroVacante, DatosMaestroEmpresa, EmpresaVacante,
  ParametrizacionVacantesService, ReglaLabor, ResumenCadena, TipoResolucion,
  ResolucionPagoCasino,
  CondicionDocumento, DestinoDocumento, DocumentoEmpresa, DocumentoEmpresaRequest, EmpresaDocumentos,
  EmpresaDocumentosResumen, EtapaDocumento, FormaDocumento, ModoDocumentos, NaturalezaDocumento,
  TipoDocumental, TipoDocumentalRequest, TipoDocumentalResumen,
  CalendarioPago, CentroCasino, CentroGrupoPago, GrupoPago, OrigenCasino, PagoModoCentro,
  PoliticaCasino, ResumenGrupoCentro, ResumenPagoCentro,
} from '../../services/parametrizacion-vacantes/parametrizacion-vacantes.service';
import { Temporal, TemporalRequest, TemporalesService } from '../../services/parametrizacion-vacantes/temporales.service';
import { CalendarioPagoDialogComponent, CalendarioPagoDialogData } from './calendario-pago-dialog.component';
import { PoliticaCasinoDialogComponent, PoliticaCasinoDialogData } from './politica-casino-dialog.component';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { environment } from '@/environments/environment';
import { catchError, forkJoin, of } from 'rxjs';

/**
 * Fila del resumen de pago y casino en la tabla estándar: una por grupo de pago
 * del centro, o una sola (sin grupo) si el centro no tiene ninguno.
 */
interface FilaResumenPago {
  c: ResumenPagoCentro;
  g: ResumenGrupoCentro | null;
}

/** Un eslabon de la cadena de configuracion, tal como se pinta en la primera pestana. */
export interface PasoCadena {
  n: number;
  titulo: string;
  detalle: string;
  /** Cuantas filas hay hoy. null mientras carga. */
  conteo: number | null;
  /** true = se administra en esta misma pantalla; false = vive en otra pantalla. */
  propio: boolean;
  /** Ruta de la pantalla que lo administra, si es de otro modulo. */
  ruta?: string[];
  /** Indice de la pestana de esta pantalla que lo administra, si es propio. */
  tab?: number;
  /** Bloquea la cadena: sin esto no se puede seguir. */
  critico: boolean;
}

/** Un destino de un documento, tal como se edita en la matriz de la pestaña «Documentos». */
export interface CeldaDestino {
  /** false = el documento no va a este destino. Forma y copias se conservan por si se vuelve a marcar. */
  incluido: boolean;
  forma: FormaDocumento;
  /** null = el backend guarda 1. */
  copias: number | null;
  orden: number | null;
}

/** Copia LOCAL de un documento de la empresa. Nada llega al backend hasta «Guardar cambios». */
export interface FilaDocumento {
  tipo: TipoDocumentalResumen;
  obligatorio: boolean;
  orden_archivo: number | null;
  bloque_archivo: number | null;
  /** No se edita aquí: viaja tal cual para no perder de qué versión del listado salió. */
  version_listado: string | null;
  /** Una celda por destino del enumerado, incluida o no. */
  destinos: Record<DestinoDocumento, CeldaDestino>;
}

/** Un destino como columna de la matriz. */
export interface DestinoColumna {
  codigo: DestinoDocumento;
  etiqueta: string;
  /** Solo el escáner de la usuaria admite la forma DIGITAL; los demás son papel. */
  admiteDigital: boolean;
}

/**
 * Una fila de la edición LOCAL de «Centro + Casino». `grupo_pago_id` null = todo el centro.
 *
 * `politica_defecto_*` es el casino por defecto del grupo: si lo tiene, el centro no puede
 * darle otro (el backend responde CASINO_CONTRADICE_GRUPO).
 */
export interface FilaCasinoCentro {
  grupo_pago_id: number | null;
  etiqueta: string;
  politica_defecto_id: number | null;
  politica_defecto_codigo: string | null;
  /** null = sin fila: el centro/grupo no queda con ninguna política propia. */
  politica_casino_id: number | null;
}

/**
 * Parametrizacion de CREACION DE VACANTES.
 *
 * Administra lo que hasta ahora vivia cableado en `shared/data/labores-por-mes.data.ts`
 * (910 lineas, 432 reglas y 218 mapeos cargo->area transcritos de un Excel). Mientras
 * ese archivo siga en el repo NO es la fuente de verdad: lo es esta pantalla.
 *
 * Cinco pestanas, en el orden en que hace falta configurarlas:
 *   Areas -> Esquemas -> Reglas -> Cargo/Area -> Configuracion centro+cargo
 */

/** Una opción de los filtros encadenados. `null` en el id = «todas». */
export interface OpcionFiltroTemporal { id: number | null; nombre: string; }
export interface OpcionFiltroEmpresa { ref: number | null; nombre: string; temporalRef: number | null; }
export interface OpcionFiltroCentro { id: number | null; etiqueta: string; empresaRef: number | null; temporalRef: number | null; }

/**
 * Filtros encadenados TEMPORAL → EMPRESA USUARIA → CENTRO DE COSTO.
 *
 * <p>Encadenar significa dos cosas, y las dos hacen falta:
 * <ul>
 *   <li><b>Hacia abajo</b>: elegir la temporal recorta las empresas, y elegir la empresa recorta
 *       los centros. Sin eso, el tercer desplegable sigue teniendo 177 opciones y filtrar no
 *       ahorra nada.</li>
 *   <li><b>Hacia arriba</b>: elegir un centro rellena su empresa y su temporal. Así se puede ir
 *       directo al centro por su nombre —que es como se busca en la práctica— sin que los otros
 *       dos campos queden en blanco contradiciendo lo que se ve.</li>
 * </ul>
 *
 * <p>Al recortar hacia abajo se SUELTA lo que deja de encajar (si la empresa elegida no es de la
 * temporal nueva, se limpia) en vez de dejar un filtro imposible que no devuelve nada y no
 * explica por qué.
 *
 * <p>No es un componente: es estado compartido por las tres pestañas que lo usan, cada una con su
 * propia instancia. Se apoya en `signal`/`computed`, que funcionan fuera de un contexto de
 * inyección.
 */
export class FiltrosCentroJerarquicos {

  readonly TODAS_TEMPORALES: OpcionFiltroTemporal = { id: null, nombre: 'Todas las temporales' };
  readonly TODAS_EMPRESAS: OpcionFiltroEmpresa = { ref: null, nombre: 'Todas las empresas', temporalRef: null };
  readonly TODOS_CENTROS: OpcionFiltroCentro = { id: null, etiqueta: 'Todos los centros', empresaRef: null, temporalRef: null };

  readonly temporal = signal<number | null>(null);
  readonly empresa = signal<number | null>(null);
  readonly centro = signal<number | null>(null);

  // El buscador inteligente se registra como CVA: necesita un control para poder MOSTRAR lo
  // elegido cuando el valor se fija desde fuera (al encadenar hacia arriba, por ejemplo).
  readonly ctrlTemporal = new FormControl<number | null>(null);
  readonly ctrlEmpresa = new FormControl<number | null>(null);
  readonly ctrlCentro = new FormControl<number | null>(null);

  /**
   * @param conTodos false en las pestañas donde el centro es la SELECCIÓN de trabajo y no un
   *   filtro: ahí «todos los centros» no significa nada.
   */
  constructor(
    private readonly temporales: () => OpcionFiltroTemporal[],
    private readonly empresas: () => OpcionFiltroEmpresa[],
    private readonly centros: () => OpcionFiltroCentro[],
    private readonly conTodos = true) {}

  readonly opcionesTemporal = computed<OpcionFiltroTemporal[]>(() =>
    [this.TODAS_TEMPORALES, ...this.temporales()]);

  readonly opcionesEmpresa = computed<OpcionFiltroEmpresa[]>(() => {
    const t = this.temporal();
    const suyas = this.empresas().filter(e => t === null || e.temporalRef === t);
    return [this.TODAS_EMPRESAS, ...suyas];
  });

  readonly opcionesCentro = computed<OpcionFiltroCentro[]>(() => {
    const t = this.temporal();
    const e = this.empresa();
    const suyos = this.centros().filter(c =>
      (e === null || c.empresaRef === e) && (t === null || c.temporalRef === t));
    return this.conTodos ? [this.TODOS_CENTROS, ...suyos] : suyos;
  });

  /** Cuántas opciones quedan tras el recorte. Lo pinta la pantalla junto a los filtros. */
  readonly centrosVisibles = computed(() => this.opcionesCentro().filter(c => c.id !== null).length);

  elegirTemporal(id: number | null): void {
    this.temporal.set(id);
    const e = this.empresas().find(x => x.ref === this.empresa());
    if (id !== null && e && e.temporalRef !== id) this.fijarEmpresa(null);
    this.podarCentro();
    this.sincronizar();
  }

  elegirEmpresa(ref: number | null): void {
    this.fijarEmpresa(ref);
    // Hacia arriba: la empresa sabe de qué temporal es.
    const e = this.empresas().find(x => x.ref === ref);
    if (e?.temporalRef != null) this.temporal.set(e.temporalRef);
    this.podarCentro();
    this.sincronizar();
  }

  /** Devuelve el id elegido para que quien llama cargue lo suyo. */
  elegirCentro(id: number | null): number | null {
    this.centro.set(id);
    const c = this.centros().find(x => x.id === id);
    if (c) {
      if (c.empresaRef != null) this.empresa.set(c.empresaRef);
      if (c.temporalRef != null) this.temporal.set(c.temporalRef);
    }
    this.sincronizar();
    return id;
  }

  limpiar(): void {
    this.temporal.set(null);
    this.empresa.set(null);
    this.centro.set(null);
    this.sincronizar();
  }

  get hayFiltro(): boolean {
    return this.temporal() !== null || this.empresa() !== null || this.centro() !== null;
  }

  private fijarEmpresa(ref: number | null): void {
    this.empresa.set(ref);
  }

  /** El centro elegido que ya no encaja con temporal/empresa se suelta. */
  private podarCentro(): void {
    const id = this.centro();
    if (id === null) return;
    if (!this.opcionesCentro().some(c => c.id === id)) this.centro.set(null);
  }

  private sincronizar(): void {
    if (this.ctrlTemporal.value !== this.temporal()) this.ctrlTemporal.setValue(this.temporal(), { emitEvent: false });
    if (this.ctrlEmpresa.value !== this.empresa()) this.ctrlEmpresa.setValue(this.empresa(), { emitEvent: false });
    if (this.ctrlCentro.value !== this.centro()) this.ctrlCentro.setValue(this.centro(), { emitEvent: false });
  }
}

@Component({
  selector: 'app-parametrizacion-vacantes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SharedModule, StandardFilterTable, MatTabsModule, MatDialogModule,
    MatSnackBarModule, MatIconModule, MatButtonModule, MatTooltipModule,
    MatProgressSpinnerModule, MatSlideToggleModule, RouterLink, SmartSelectComponent,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './parametrizacion-vacantes.component.html',
  styleUrls: ['./parametrizacion-vacantes.component.css'],
})
export class ParametrizacionVacantesComponent implements OnInit {
  private svc = inject(ParametrizacionVacantesService);
  private temporalesSvc = inject(TemporalesService);
  private http = inject(HttpClient);
  private snack = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  /** Pestana activa; la cadena la usa para saltar al paso correspondiente. */
  tabActivo = signal(0);

  cargando = signal(false);
  temporales = signal<Temporal[]>([]);
  /** Centros para el selector de «Configuración centro + cargo». */
  opcionesCentro = signal<CentroOpcion[]>([]);
  empresas = signal<EmpresaVacante[]>([]);

  // Cascada EMPRESA -> CENTRO. La empresa seleccionada manda; al cambiarla se limpian
  // los centros para que no queden visibles los de la anterior ni un instante.
  // Multi-seleccion: una, varias o todas. El filtro va por REFERENCIA, nunca por nombre.
  empresasSel = signal<number[]>([]);
  /** Texto del buscador del selector. Filtra la lista mientras se escribe. */
  buscadorEmpresa = signal('');
  centros = signal<CentroVacante[]>([]);
  verNoHabilitados = signal(false);
  /** Ver también las áreas retiradas del alcance (las 15 que no están en el Excel). */
  verAreasRetiradas = signal(false);
  verPerfilesVacanteInactivos = signal(false);
  /** Catálogo de cargos del alcance (74). Independiente de centros y áreas. */
  cargos = signal<CargoVacante[]>([]);
  verCargosNoHabilitados = signal(false);
  cargandoCentros = signal(false);

  /**
   * Conteos de la cadena. Vienen SIEMPRE del backend: derivarlos de las listas ya
   * cargadas daba números falsos — la de reglas viene filtrada por esquema, la de
   * centros solo trae los de la empresa seleccionada, y el conteo de centros salía de un
   * endpoint global que contaba las 312 fincas del maestro entero en vez de las 32
   * habilitadas para vacantes.
   */
  resumen = signal<ResumenCadena | null>(null);
  areas = signal<AreaOperativa[]>([]);
  perfilesVacante = signal<PerfilVacante[]>([]);
  esquemas = signal<EsquemaLabor[]>([]);
  reglas = signal<ReglaLabor[]>([]);
  cargoAreas = signal<CargoArea[]>([]);
  configuraciones = signal<ConfiguracionCentroCargo[]>([]);

  /** Filtro activo de la pestana de reglas; null = todos los esquemas. */
  esquemaFiltro = signal<number | null>(null);

  /** Cuantos mapeos legacy siguen sin enlazar con tabla_cargos. */
  sinConciliar = computed(() => this.cargoAreas().filter(c => !c.conciliado).length);

  /** Esquemas declarados pero todavia sin ninguna regla (HMVE / JARDINES). */
  esquemasVacios = computed(() => this.esquemas().filter(e => !e.reglas_activas));

  /** Los CINCO, para los selectores que sí deben poder tocar el legacy. */
  esquemasTodos = signal<EsquemaLabor[]>([]);

  /** Esquemas del alcance con reglas pero SIN ninguna configuración que las alcance. */
  esquemasSinConectar = computed(() =>
    this.esquemas().filter(e => (e.reglas_activas ?? 0) > 0 && !(e.configuraciones_activas ?? 0)));
  codigosEsquemasVacios = computed(() => this.esquemasVacios().map(e => e.codigo).join(', '));

  readonly pageSizeOptions = [10, 25, 50, 100];

  /**
   * Los 8 eslabones en el orden en que hay que configurarlos. Se pinta como cadena y no
   * como una lista suelta de tablas porque el orden IMPORTA: sin temporal no hay empresa
   * usuaria util, sin centro de costo no hay configuracion de puesto, y sin esa
   * configuracion el resolutor de labor no puede responder nada.
   *
   * Los eslabones 2, 3 y 4 se administran en pantallas que YA EXISTEN; aqui solo se
   * enlazan. Duplicar sus CRUD crearia dos sitios donde editar el mismo maestro.
   */
  cadena = computed<PasoCadena[]>(() => {
    const r = this.resumen();
    // null = todavía no llegó el resumen. Se propaga como null para que la tarjeta diga
    // «sin dato» en vez de «vacío», que sería afirmar algo que no sabemos.
    const n = (v: number | undefined) => (r ? v ?? 0 : null);
    return [
      { n: 1, titulo: 'Temporal', propio: true, tab: 1, critico: true,
        detalle: 'Quien contrata: Apoyo Laboral, Tu Alianza…',
        conteo: this.temporales().length },
      { n: 2, titulo: 'Empresa usuaria', propio: true, tab: 2, critico: true,
        detalle: 'Solo las habilitadas para vacantes; el maestro global tiene más.',
        conteo: n(r?.empresas_habilitadas) },
      { n: 3, titulo: 'Centro de costo', propio: true, tab: 3, critico: true,
        detalle: 'Solo los habilitados para vacantes, en todas las empresas.',
        conteo: n(r?.centros_habilitados) },
      { n: 4, titulo: 'Cargo', propio: true, tab: 4, critico: true,
        detalle: 'Solo los habilitados para vacantes; el maestro global tiene más.',
        conteo: n(r?.cargos_habilitados) },
      // `critico: false` a proposito: un catálogo de perfiles vacío NO impide resolver
      // la labor ni publicar —el formulario cae a su lista de respaldo—, así que no
      // debe salir como «siguiente paso» por delante de un eslabón que sí bloquea.
      { n: 5, titulo: 'Perfil vacante', propio: true, tab: 5, critico: false,
        detalle: 'Rosa, Clavel… llena el campo «Área» del formulario. No interviene en la labor.',
        conteo: n(r?.perfiles_vacante_activos) },
      { n: 6, titulo: 'Área operativa', propio: true, tab: 6, critico: true,
        detalle: 'CU, PO, AD… el vocabulario con el que se resuelve la labor.',
        conteo: n(r?.areas_activas) },
      { n: 7, titulo: 'Esquema de labor', propio: true, tab: 7, critico: true,
        detalle: 'Qué juego de reglas aplica y cómo resuelve.',
        conteo: n(r?.esquemas_activos) },
      { n: 8, titulo: 'Reglas de labor', propio: true, tab: 8, critico: true,
        detalle: 'mes (+ área / rango de días) → texto de la labor.',
        conteo: n(r?.reglas_activas) },
      { n: 9, titulo: 'Configuración centro + cargo', propio: true, tab: 10, critico: true,
        detalle: 'Las combinaciones AUTORIZADAS. Sin esto el resolutor no responde.',
        conteo: n(r?.configuraciones_activas) },
    ];
  });

  /** El primer eslabón vacío: es donde el usuario tiene que actuar ahora. */
  primerPasoVacio = computed(() => this.cadena().find(p => p.critico && p.conteo === 0) ?? null);

  readonly colEmpresas: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '128px', filterable: false },
    { name: 'nombre', header: 'Empresa (maestro)', type: 'text', filterable: true, stickyStart: true, width: '30%' },
    { name: 'nit', header: 'NIT', type: 'text', filterable: true },
    // La temporal NO es un dato de la empresa: se deriva de sus centros de costo.
    // 'Sin centros' no es lo mismo que 'sin temporal' — es que no hay de donde deducirla.
    { name: 'temporalTxt', header: 'Temporal', type: 'text', filterable: true, width: '22%' },
    // Datos de contacto. Salen del MAESTRO, no del alcance: se editan aquí por comodidad
    // —es donde se administra la empresa usuaria— pero se guardan en ms-payroll.
    { name: 'representante_legal', header: 'Representante legal', type: 'text', filterable: true, width: '18%' },
    { name: 'representante_legal_documento', header: 'Cédula representante', type: 'text', filterable: true, width: '130px' },
    { name: 'direccion', header: 'Dirección', type: 'text', filterable: true, width: '20%' },
    { name: 'telefono', header: 'Teléfono', type: 'text', filterable: true, width: '130px' },
    { name: 'correo', header: 'Correo', type: 'text', filterable: true, width: '18%' },
    { name: 'nombre_excel', header: 'Nombre en origen', type: 'text', filterable: true },
    // Cuándo se tocó por última vez el ALCANCE de esta empresa. Solo el día: `updated_at`
    // es un instante, pero la hora aquí no aporta. El tipo de conciliación sigue viéndose
    // y editándose en el diálogo de «Editar alcance»; ya no ocupa columna.
    { name: 'updated_at', header: 'Fecha de actualización', type: 'date',
      filterable: true, width: '160px' },
    { name: 'activo_vacantes', header: 'En alcance', type: 'status',
      statusConfig: { false: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  readonly colCentros: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '160px', filterable: false },
    { name: 'empresa_nombre', header: 'Empresa', type: 'text', filterable: true, width: '22%' },
    { name: 'finca', header: 'Centro / Finca', type: 'text', filterable: true, stickyStart: true, width: '24%' },
    { name: 'ccostos', header: 'Cód. costo', type: 'text', filterable: true },
    { name: 'ciudad', header: 'Ciudad', type: 'text', filterable: true },
    { name: 'direccion', header: 'Dirección', type: 'text', width: '26%' },
    { name: 'areasTxt', header: 'Áreas permitidas', type: 'status',
      statusConfig: { 'Sin áreas': { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
    { name: 'estadoTxt', header: 'En vacantes', type: 'status',
      statusConfig: { 'No habilitado': { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  readonly colCargos: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '128px', filterable: false },
    { name: 'nombre', header: 'Cargo', type: 'text', filterable: true, stickyStart: true, width: '55%' },
    { name: 'arlTxt', header: '% ARL', type: 'status',
      // 0 % se resalta: la ARL se copia al contrato como snapshot, así que un cargo con 0
      // arrastra ese valor a nómina. Es un pendiente, no un dato válido.
      statusConfig: { 'Sin ARL': { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
    { name: 'estadoTxt', header: 'En vacantes', type: 'status',
      statusConfig: { 'No habilitado': { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  readonly colTemporales: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '170px', filterable: false },
    { name: 'temporal_key', header: 'Clave', type: 'text', filterable: true, stickyStart: true },
    { name: 'nombre_display', header: 'Nombre para documentos', type: 'text', filterable: true, width: '30%' },
    { name: 'nit', header: 'NIT', type: 'text', filterable: true },
    { name: 'direccion', header: 'Dirección', type: 'text' },
    { name: 'email', header: 'Correo', type: 'text' },
    { name: 'activa', header: 'Activa', type: 'status',
      statusConfig: { false: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  // ── Columnas ──────────────────────────────────────────────────────────────

  readonly colPerfilesVacante: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '128px', filterable: false },
    { name: 'nombre', header: 'Perfil', type: 'text', filterable: true, stickyStart: true, width: '28%' },
    { name: 'descripcion', header: 'Descripción', type: 'text', filterable: true },
    { name: 'orden', header: 'Orden', type: 'text', width: '90px' },
    { name: 'activo', header: 'Activo', type: 'status',
      statusConfig: { false: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  colPerfilesVacanteVisibles = computed<ColumnDefinition[]>(() =>
    this.verPerfilesVacanteInactivos()
      ? this.colPerfilesVacante
      : this.colPerfilesVacante.filter(c => c.name !== 'activo'));

  perfilesVacanteInactivos = computed(() => this.perfilesVacante().filter(p => !p.activo).length);


  // ── Seguros funerarios ───────────────────────────────────────────────────
  //
  // El seguro existe por sí mismo (nombre + valor) y los centros se le asocian por una
  // relación N:M, así que un centro puede tener VARIOS seguros. No hay valor por defecto:
  // un centro tiene los que diga la relación y ninguno más.

  seguros = signal<SeguroFunerario[]>([]);
  verSegurosInactivos = signal(false);

  readonly colSeguros: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '128px', filterable: false },
    { name: 'nombre', header: 'Seguro', type: 'text', filterable: true, stickyStart: true, width: '26%' },
    { name: 'valorTxt', header: 'Valor', type: 'text', width: '130px' },
    { name: 'periodicidad', header: 'Periodicidad', type: 'text', filterable: true, width: '130px' },
    { name: 'descuentoTxt', header: 'Descuento', type: 'text', width: '160px' },
    { name: 'centrosTxt', header: 'Centros asignados', type: 'text', width: '170px' },
    { name: 'descripcion', header: 'Descripción', type: 'text' },
    { name: 'activo', header: 'Activo', type: 'status',
      statusConfig: { false: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  colSegurosVisibles = computed<ColumnDefinition[]>(() =>
    this.verSegurosInactivos()
      ? this.colSeguros
      : this.colSeguros.filter(c => c.name !== 'activo'));

  segurosInactivos = computed(() => this.seguros().filter(s => !s.activo).length);

  // ── Salario mínimo por año ───────────────────────────────────────────────
  //
  // Todas las empresas pagan el mínimo. Los documentos de contratación imprimen el del
  // año en que se creó el contrato; un año sin fila usa el último anterior configurado.

  salariosMinimos = signal<SalarioMinimoAnio[]>([]);

  readonly colSalarioMinimo: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '96px', filterable: false },
    { name: 'anio', header: 'Año', type: 'text', filterable: true, width: '90px' },
    { name: 'salarioTxt', header: 'Salario mínimo', type: 'text', width: '160px' },
    { name: 'auxilioTxt', header: 'Auxilio de transporte', type: 'text', width: '180px' },
    { name: 'observacion', header: 'Observación', type: 'text' },
  ];

  // ── Grupos de pago, fechas de pago y casino ──────────────────────────────
  //
  // Tres catálogos y dos relaciones por centro:
  //   calendario_pago → CUÁNDO se paga. El texto del documento y el estado VIGENTE/VENCIDO
  //                     los calcula el BACKEND; aquí solo se muestran.
  //   politica_casino → si hay casino, qué comidas y cuánto vale cada una.
  //   grupo_pago      → el grupo, con su casino POR DEFECTO.
  //   centro + grupos → qué grupos tiene el centro y con qué calendario cada uno.
  //   centro + casino → la política del centro entero o la de uno de sus grupos.
  //
  // Precedencia del casino (la resuelve el backend): CENTRO_GRUPO → GRUPO → CENTRO.

  /** Índices de las pestañas nuevas. Van AL FINAL: `cadena()` cablea los de las anteriores. */
  private readonly TAB_CENTRO_PAGO = 17;
  private readonly TAB_CENTRO_CASINO = 18;

  calendarios = signal<CalendarioPago[]>([]);
  verCalendariosInactivos = signal(false);
  politicasCasino = signal<PoliticaCasino[]>([]);
  verPoliticasInactivas = signal(false);
  gruposPago = signal<GrupoPago[]>([]);
  verGruposPagoInactivos = signal(false);

  /** Solo los vivos: es lo que se puede asignar a un centro o poner de casino por defecto. */
  calendariosActivos = computed(() => this.calendarios().filter(c => c.activo !== false));
  politicasActivas = computed(() => this.politicasCasino().filter(p => p.activo !== false));

  calendariosInactivos = computed(() => this.calendarios().filter(c => !c.activo).length);
  politicasInactivas = computed(() => this.politicasCasino().filter(p => !p.activo).length);
  gruposPagoInactivos = computed(() => this.gruposPago().filter(g => !g.activo).length);

  readonly colCalendarios: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '128px', filterable: false },
    { name: 'codigo', header: 'Código', type: 'text', filterable: true, stickyStart: true, width: '20%' },
    { name: 'tipoTxt', header: 'Tipo', type: 'text', filterable: true, width: '160px' },
    { name: 'cuandoTxt', header: 'Cuándo paga', type: 'text', width: '220px' },
    // Lo arma el backend: si aquí se compusiera otra frase habría dos versiones del mismo texto.
    { name: 'texto_documento', header: 'Texto del documento', type: 'text', width: '30%' },
    { name: 'estado', header: 'Estado', type: 'status',
      statusConfig: { VENCIDO: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
    { name: 'centrosTxt', header: 'En uso', type: 'text', width: '170px' },
    { name: 'activo', header: 'Activo', type: 'status',
      statusConfig: { false: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  colCalendariosVisibles = computed<ColumnDefinition[]>(() =>
    this.verCalendariosInactivos()
      ? this.colCalendarios
      : this.colCalendarios.filter(c => c.name !== 'activo'));

  readonly colPoliticasCasino: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '128px', filterable: false },
    { name: 'codigo', header: 'Código', type: 'text', filterable: true, stickyStart: true, width: '22%' },
    { name: 'servicioTxt', header: 'Servicio', type: 'status',
      statusConfig: { 'No ofrece': { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
    { name: 'comidasTxt', header: 'Comidas', type: 'text', width: '26%' },
    { name: 'texto_documento', header: 'Texto del documento', type: 'text', width: '28%' },
    { name: 'usoTxt', header: 'En uso', type: 'text', width: '200px' },
    { name: 'activo', header: 'Activo', type: 'status',
      statusConfig: { false: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  colPoliticasVisibles = computed<ColumnDefinition[]>(() =>
    this.verPoliticasInactivas()
      ? this.colPoliticasCasino
      : this.colPoliticasCasino.filter(c => c.name !== 'activo'));

  readonly colGruposPago: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '128px', filterable: false },
    { name: 'numero', header: 'Número', type: 'text', filterable: true, stickyStart: true, width: '100px' },
    { name: 'nombre', header: 'Nombre', type: 'text', filterable: true, width: '26%' },
    { name: 'casinoTxt', header: 'Casino por defecto', type: 'text', filterable: true, width: '24%' },
    { name: 'centrosTxt', header: 'Centros asignados', type: 'text', width: '170px' },
    { name: 'descripcion', header: 'Descripción', type: 'text' },
    { name: 'activo', header: 'Activo', type: 'status',
      statusConfig: { false: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  colGruposPagoVisibles = computed<ColumnDefinition[]>(() =>
    this.verGruposPagoInactivos()
      ? this.colGruposPago
      : this.colGruposPago.filter(c => c.name !== 'activo'));

  // ── Centro + Pago (edición local hasta «Guardar») ────────────────────────

  centroPagoSel = signal<number | null>(null);
  cargandoCentroPago = signal(false);
  guardandoCentroPago = signal(false);
  /** TODOS los grupos activos frente al centro; se editan `asignada` y su calendario. */
  filasPago = signal<CentroGrupoPago[]>([]);
  private firmaPagoOriginal = signal('');
  /** Si Crear Vacante exigirá grupo de pago en este centro. Lo deciden los datos. */
  pagoModo = signal<PagoModoCentro | null>(null);

  pagoSucio = computed(() => this.firmaPago(this.filasPago()) !== this.firmaPagoOriginal());
  /** Un grupo marcado sin calendario no se puede guardar: el PUT exige los dos. */
  gruposSinCalendario = computed(() => this.filasPago().filter(f => f.asignada && f.calendario_pago_id == null));
  gruposDelCentro = computed(() => this.filasPago().filter(f => f.asignada).length);

  centroPagoNombre = computed(() =>
    this.opcionesCentro().find(c => c.id === this.centroPagoSel())?.etiqueta ?? '');

  // ── Centro + Casino (edición local hasta «Guardar») ──────────────────────

  centroCasinoSel = signal<number | null>(null);
  cargandoCentroCasino = signal(false);
  guardandoCentroCasino = signal(false);
  filasCasino = signal<FilaCasinoCentro[]>([]);
  private firmaCasinoOriginal = signal('');

  casinoSucio = computed(() => this.firmaCasino(this.filasCasino()) !== this.firmaCasinoOriginal());

  /**
   * Filas que el backend rechazaría con CASINO_CONTRADICE_GRUPO: el grupo trae casino por
   * defecto y aquí se le está poniendo otro. Se bloquea antes de mandarlo.
   */
  casinoContradice = computed(() => this.filasCasino().filter(f =>
    f.grupo_pago_id !== null && f.politica_defecto_id != null
    && f.politica_casino_id != null && f.politica_casino_id !== f.politica_defecto_id));

  centroCasinoNombre = computed(() =>
    this.opcionesCentro().find(c => c.id === this.centroCasinoSel())?.etiqueta ?? '');

  // ── Resumen de pago y casino (sección de la cadena) ──────────────────────

  resumenPago = signal<ResumenPagoCentro[]>([]);
  cargandoResumenPago = signal(false);

  /** De dónde salió el casino de cada grupo. El enum crudo no dice nada al usuario. */
  readonly origenCasinoTxt: Record<OrigenCasino, string> = {
    CENTRO_GRUPO: 'Centro + grupo',
    GRUPO: 'Por defecto del grupo',
    CENTRO: 'Todo el centro',
  };

  resumenPagoFiltrado = computed(() => {
    const tmp = this.filtrosCadena.temporal();
    const emp = this.filtrosCadena.empresa();
    const cen = this.filtrosCadena.centro();
    return this.resumenPago().filter(c =>
      (tmp === null || c.temporal_config_ref === tmp)
      && (emp === null || c.empresa_usuaria_ref === emp)
      && (cen === null || c.centro_costo_id === cen));
  });

  /**
   * El resumen en filas planas para la tabla estándar: una por grupo de pago. El
   * centro se repite en cada fila para que ordenar o filtrar no deje grupos
   * huérfanos de su centro.
   */
  filasResumenPago = computed<FilaResumenPago[]>(() =>
    this.resumenPagoFiltrado().flatMap((c): FilaResumenPago[] =>
      c.grupos.length ? c.grupos.map(g => ({ c, g })) : [{ c, g: null }]));

  readonly columnasResumenPago: ColumnaTabla<FilaResumenPago>[] = [
    { id: 'centro', header: 'Centro', tarjeta: 'titulo', minAncho: '240px',
      valor: (f) => f.c.finca || ('Centro ' + f.c.centro_costo_id) },
    { id: 'grupo', header: 'Grupo de pago', tarjeta: 'subtitulo', minAncho: '180px',
      valor: (f) => (f.g ? `${f.g.numero} · ${f.g.nombre}` : 'Sin grupos de pago') },
    { id: 'calendario', header: 'Calendario', tarjeta: 'cuerpo',
      valor: (f) => (f.g ? f.g.calendario_codigo || 'Sin calendario' : '') },
    { id: 'casino', header: 'Casino', tarjeta: 'cuerpo',
      valor: (f) => (f.g ? f.g.politica_casino_codigo || 'Sin casino' : '') },
    { id: 'origen', header: 'Origen', prioridad: 2, tarjeta: 'meta',
      valor: (f) => (f.g?.casino_origen ? this.origenCasinoTxt[f.g.casino_origen] : ''),
      formato: (f) => (f.g?.casino_origen ? this.origenCasinoTxt[f.g.casino_origen] : '—') },
  ];

  /** Rojo si le falta algo (gana al aviso); ámbar si el calendario venció. */
  readonly claseFilaResumenPago = (f: FilaResumenPago): string => {
    if (!f.g || !f.g.politica_casino_id || !!f.g.casino_error) return 'te-fila--peligro';
    if (f.g.calendario_estado === 'VENCIDO') return 'te-fila--alerta';
    return '';
  };
  readonly idFilaResumenPago = (f: FilaResumenPago) => `${f.c.centro_costo_id}-${f.g?.grupo_pago_id ?? 'x'}`;

  /** Solo las empresas que aparecen en el resumen: filtrar por una sin centros no sirve. */
  // ── Filtros encadenados con buscador (temporal → empresa → centro) ───────
  // Tres instancias y no una: la Cadena filtra una tabla y las otras dos eligen el centro
  // sobre el que se trabaja. Compartir el estado haría que moverse de pestaña cambiara lo que
  // el usuario estaba mirando en la otra.

  /** Listas normalizadas que alimentan los tres filtros. */
  opcionesTemporalFiltro = computed<OpcionFiltroTemporal[]>(() =>
    this.temporales()
      .filter(t => t.id != null)
      .map(t => ({ id: t.id!, nombre: t.nombre_display }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));

  opcionesEmpresaFiltro = computed<OpcionFiltroEmpresa[]>(() =>
    this.empresas()
      .map(e => ({
        ref: e.empresa_usuaria_ref,
        nombre: e.nombre ?? e.nombre_excel ?? `Empresa ${e.empresa_usuaria_ref}`,
        temporalRef: e.temporal_config_ref ?? null,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));

  /** ref de empresa -> su temporal y su nombre, para colgar de ahí los centros. */
  private empresaPorRef = computed(() => {
    const m = new Map<number, OpcionFiltroEmpresa>();
    for (const e of this.opcionesEmpresaFiltro()) if (e.ref != null) m.set(e.ref, e);
    return m;
  });

  opcionesCentroFiltro = computed<OpcionFiltroCentro[]>(() => {
    const empresas = this.empresaPorRef();
    return this.opcionesCentro().map(c => ({
      id: c.id,
      etiqueta: c.etiqueta,
      empresaRef: c.empresa_usuaria_ref,
      temporalRef: c.empresa_usuaria_ref == null ? null : empresas.get(c.empresa_usuaria_ref)?.temporalRef ?? null,
    }));
  });

  private nuevoFiltro(conTodos: boolean): FiltrosCentroJerarquicos {
    return new FiltrosCentroJerarquicos(
      () => this.opcionesTemporalFiltro(), () => this.opcionesEmpresaFiltro(),
      () => this.opcionesCentroFiltro(), conTodos);
  }

  /** Cadena de configuración: los tres son FILTROS de la tabla. */
  filtrosCadena = this.nuevoFiltro(true);
  /** Centro + Pago y Centro + Casino: temporal y empresa acotan; el centro es la selección. */
  filtrosPago = this.nuevoFiltro(false);
  filtrosCasino = this.nuevoFiltro(false);

  valorTemporalFiltro = (t: OpcionFiltroTemporal) => t.id;
  etiquetaTemporalFiltro = (t: OpcionFiltroTemporal) => t.nombre;
  valorEmpresaFiltro = (e: OpcionFiltroEmpresa) => e.ref;
  etiquetaEmpresaFiltro = (e: OpcionFiltroEmpresa) => e.nombre;
  valorCentroFiltro = (c: OpcionFiltroCentro) => c.id;
  etiquetaCentroFiltro = (c: OpcionFiltroCentro) => c.etiqueta;
  /** Lo que distingue dos fincas homónimas es su empresa. */
  detalleCentroFiltro = (c: OpcionFiltroCentro) =>
    c.empresaRef == null ? null : this.empresaPorRef().get(c.empresaRef)?.nombre ?? null;

  /** Rojo: al centro le falta algo. Ámbar: su calendario ya venció. */
  centrosPagoIncompletos = computed(() =>
    this.resumenPagoFiltrado().filter(c => c.sin_grupos || c.sin_casino).length);
  centrosPagoVencidos = computed(() =>
    this.resumenPagoFiltrado().filter(c => c.calendario_vencido).length);

  readonly colAreas: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '128px', filterable: false },
    { name: 'codigo', header: 'Código', type: 'text', filterable: true, stickyStart: true, width: '110px' },
    { name: 'nombre', header: 'Nombre', type: 'text', filterable: true, width: '40%' },
    { name: 'descripcion', header: 'Descripción', type: 'text' },
    // Solo tienen sentido al mirar las retiradas: en el listado por defecto las 6 son
    // todas activas y CONFIRMADA, así que serían dos columnas con el mismo valor repetido.
    { name: 'estado', header: 'Estado', type: 'status',
      statusConfig: { PENDIENTE_PARAMETRIZACION: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
    { name: 'activo', header: 'Activo', type: 'status',
      statusConfig: { false: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  colAreasVisibles = computed<ColumnDefinition[]>(() =>
    this.verAreasRetiradas()
      ? this.colAreas
      : this.colAreas.filter(c => c.name !== 'estado' && c.name !== 'activo'));

  readonly colEsquemas: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '128px', filterable: false },
    { name: 'nombre', header: 'Nombre', type: 'text', filterable: true, stickyStart: true },
    { name: 'codigo', header: 'Código', type: 'text', filterable: true },
    { name: 'resolucionTxt', header: 'Resolución', type: 'text', filterable: true },
    { name: 'reglas_activas', header: 'Reglas activas', type: 'text' },
    // Con reglas > 0 y esto en 0 el esquema es INALCANZABLE desde el flujo nuevo: existen
    // las reglas pero no hay ninguna configuración que apunte a ellas. Se resalta.
    { name: 'configsTxt', header: 'Configuraciones', type: 'status',
      statusConfig: { 'Sin conectar': { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
    { name: 'estadoTxt', header: 'Estado', type: 'status',
      statusConfig: { 'Fuera de alcance': { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
    { name: 'origen', header: 'Origen', type: 'status',
      statusConfig: { LEGACY_TS: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
    { name: 'descripcion', header: 'Descripción', type: 'text', width: '30%' },
  ];

  /** Etiquetas legibles del tipo de resolución. El enum crudo no dice nada al usuario. */
  private static readonly RESOLUCION_TXT: Record<string, string> = {
    MES_AREA: 'MES + ÁREA',
    MES: 'MES',
    MES_RANGO_DIA: 'MES + RANGO DE DÍA',
    MES_DIA: 'MES + DÍA',
    FIJA: 'FIJA',
  };

  readonly colReglas: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '128px', filterable: false },
    { name: 'esquema_codigo', header: 'Esquema', type: 'text', filterable: true, stickyStart: true },
    { name: 'area_codigo', header: 'Área', type: 'text', filterable: true },
    { name: 'mes', header: 'Mes', type: 'text', filterable: true },
    { name: 'rangoDias', header: 'Días', type: 'text' },
    { name: 'codigo_eq', header: 'Código EQ', type: 'text', filterable: true },
    { name: 'descripcion_labor', header: 'Labor', type: 'text', width: '40%', filterable: true },
    { name: 'origen', header: 'Origen', type: 'text' },
    { name: 'activo', header: 'Activo', type: 'status',
      statusConfig: { false: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  readonly colCargoAreas: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '170px', filterable: false },
    { name: 'cargo_nombre_origen', header: 'Cargo', type: 'text', filterable: true, stickyStart: true, width: '40%' },
    { name: 'esquema_codigo', header: 'Esquema', type: 'text', filterable: true },
    { name: 'area_codigo', header: 'Área', type: 'text', filterable: true },
    { name: 'conciliadoTxt', header: 'Conciliado', type: 'status',
      statusConfig: { No: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
    { name: 'origen', header: 'Origen', type: 'text' },
    { name: 'activo', header: 'Activo', type: 'status',
      statusConfig: { false: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  readonly colConfig: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '128px', filterable: false },
    { name: 'centro_nombre', header: 'Centro de costo', type: 'text', filterable: true, stickyStart: true, width: '22%' },
    { name: 'cargo_nombre_origen', header: 'Cargo', type: 'text', filterable: true, width: '30%' },
    { name: 'area_codigo', header: 'Área', type: 'text', filterable: true },
    { name: 'esquema_codigo', header: 'Esquema', type: 'text', filterable: true },
    { name: 'tipo_labor', header: 'Tipo labor', type: 'text', filterable: true },
    { name: 'labor_fija_override', header: 'Labor fija', type: 'text', width: '25%' },
    { name: 'activo', header: 'Activo', type: 'status',
      statusConfig: { false: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  ngOnInit(): void {
    this.cargarTodo();
  }

  cargarTodo(): void {
    this.cargarTemporales();
    this.cargarEmpresas();
    this.cargarCentros();
    this.cargarCargos();
    this.cargarResumen();
    this.cargarOpcionesCentro();
    this.cargarAreas();
    this.cargarPerfilesVacante();
    this.cargarEsquemas();
    this.cargarReglas();
    this.cargarCargoAreas();
    this.cargarConfiguraciones();
    this.cargarSeguros();
    this.cargarDocumentos();
    this.cargarSalarioMinimo();
    this.cargarCalendariosPago();
    this.cargarPoliticasCasino();
    this.cargarGruposPago();
    this.cargarResumenPago();
  }

  // ── Carga ─────────────────────────────────────────────────────────────────

  /**
   * Por defecto SOLO las 6 del Excel. Las otras 15 siguen en la tabla porque 228 reglas
   * de labor y 60 mapeos cargo→área las referencian (la FK impide borrarlas), pero no
   * pintan nada en el catálogo del flujo nuevo y solo estorban.
   */
  cargarAreas(): void {
    this.svc.listarAreas(this.verAreasRetiradas() ? undefined : true).subscribe({
      next: r => this.areas.set(r ?? []),
      error: e => this.error('No se pudieron cargar las áreas operativas', e),
    });
  }

  cargarPerfilesVacante(): void {
    // Sin `activo` viene el catálogo entero: esta pantalla administra, así que
    // también tiene que ver los que están fuera del desplegable.
    this.svc.listarPerfilesVacante().subscribe({
      next: r => this.perfilesVacante.set(r ?? []),
      error: e => this.error('No se pudieron cargar los perfiles de vacante', e),
    });
  }

  alternarPerfilesVacanteInactivos(ver: boolean): void {
    this.verPerfilesVacanteInactivos.set(ver);
  }

  nuevoPerfilVacante(): void {
    this.abrirDialogo('Nuevo perfil de vacante', this.camposPerfilVacante(), {}, v =>
      this.svc.crearPerfilVacante(v).subscribe({
        next: () => this.ok('Perfil de vacante creado', () => this.cargarPerfilesVacante()),
        error: e => this.error('No se pudo crear el perfil de vacante', e),
      }));
  }

  editarPerfilVacante(p: PerfilVacante): void {
    this.abrirDialogo(`Editar «${p.nombre}»`, this.camposPerfilVacante(), p, v =>
      this.svc.actualizarPerfilVacante(p.id!, v).subscribe({
        next: () => this.ok('Perfil de vacante actualizado', () => this.cargarPerfilesVacante()),
        error: e => this.error('No se pudo actualizar el perfil de vacante', e),
      }));
  }

  togglePerfilVacante(p: PerfilVacante): void {
    this.svc.estadoPerfilVacante(p.id!, !p.activo).subscribe({
      next: () => this.ok(p.activo ? 'Perfil retirado del desplegable' : 'Perfil activado',
                          () => this.cargarPerfilesVacante()),
      error: e => this.error('No se pudo cambiar el estado', e),
    });
  }

  private camposPerfilVacante(): FieldConfig[] {
    return [
      { name: 'nombre', label: 'Perfil', type: 'text', required: true, maxLength: 120,
        hint: 'Tal cual debe salir en el desplegable de la vacante. Ej: Rosa, Clavel, Pompon.' },
      { name: 'descripcion', label: 'Descripción', type: 'text', maxLength: 300 },
      { name: 'orden', label: 'Orden', type: 'number',
        hint: 'Posición en el desplegable. Se numeran de 10 en 10 para poder intercalar.' },
    ];
  }

  alternarAreasRetiradas(ver: boolean): void {
    this.verAreasRetiradas.set(ver);
    this.cargarAreas();
  }

  /**
   * Cuántas quedaron fuera del alcance. Los dos números salen del backend: restar contra
   * un 21 escrito a mano dejaría de ser cierto en cuanto alguien cree o retire un área.
   */
  areasRetiradas = computed(() => {
    const r = this.resumen();
    return r ? Math.max(0, r.areas_totales - r.areas_activas) : 0;
  });

  /** El interruptor «Mostrar legacy» de la pestaña de esquemas. */
  verEsquemasLegacy = signal(false);

  alternarEsquemasLegacy(ver: boolean): void {
    this.verEsquemasLegacy.set(ver);
    this.cargarEsquemas();
  }

  /**
   * DOS listas, y la diferencia importa:
   *
   * · `esquemas()` es el ALCANCE — por defecto solo ALIANZA, HMVE y JARDINES. Es lo que
   *   alimenta el selector de una CONFIGURACIÓN nueva, para que nadie le cuelgue una a
   *   APOYO o BLU y mezcle las dos fuentes. El backend además lo rechaza.
   *
   * · `esquemasTodos()` son los cinco. Alimenta los selectores de REGLAS y de CARGO→ÁREA,
   *   porque las 348 reglas de APOYO y BLU y sus mapeos son la línea base de paridad
   *   frente al TS legacy y tienen que seguir siendo consultables y editables.
   */
  cargarEsquemas(): void {
    this.svc.listarEsquemas(undefined, this.verEsquemasLegacy()).subscribe({
      next: r => this.esquemas.set((r ?? []).map(e => this.decorarEsquema(e))),
      error: e => this.error('No se pudieron cargar los esquemas de labor', e),
    });
    this.svc.listarEsquemas(undefined, true).subscribe({
      next: r => this.esquemasTodos.set(r ?? []),
      error: () => this.esquemasTodos.set([]),
    });
  }

  /** Columnas derivadas: la tabla compartida pinta propiedades planas, no expresiones. */
  private decorarEsquema(e: EsquemaLabor): EsquemaLabor {
    const configs = e.configuraciones_activas ?? 0;
    return {
      ...e,
      resolucionTxt: ParametrizacionVacantesComponent.RESOLUCION_TXT[e.tipo_resolucion] ?? e.tipo_resolucion,
      configsTxt: configs > 0 ? `${configs}` : 'Sin conectar',
      estadoTxt: e.habilitado_vacantes ? (e.activo ? 'Activo' : 'Inactivo') : 'Fuera de alcance',
    } as EsquemaLabor;
  }

  cargarReglas(): void {
    this.cargando.set(true);
    this.svc.listarReglas({ esquemaId: this.esquemaFiltro() ?? undefined }).subscribe({
      next: r => {
        // rangoDias y conciliadoTxt son columnas derivadas: la tabla compartida pinta
        // propiedades planas, no expresiones.
        this.reglas.set((r ?? []).map(x => ({ ...x, rangoDias: this.rango(x) } as ReglaLabor)));
        this.cargando.set(false);
      },
      error: e => { this.cargando.set(false); this.error('No se pudieron cargar las reglas de labor', e); },
    });
  }

  /** El interruptor «Ver dados de baja» de la pestaña Cargo → Área. */
  verCargoAreasInactivos = signal(false);

  alternarCargoAreasInactivos(ver: boolean): void {
    this.verCargoAreasInactivos.set(ver);
    this.cargarCargoAreas();
  }

  cargarCargoAreas(): void {
    this.svc.listarCargoAreas({ incluirInactivos: this.verCargoAreasInactivos() }).subscribe({
      next: r => this.cargoAreas.set((r ?? []).map(x => ({
        ...x, conciliadoTxt: x.conciliado ? 'Sí' : 'No',
      } as CargoArea))),
      error: e => this.error('No se pudieron cargar los mapeos cargo/área', e),
    });
  }

  cargarConfiguraciones(): void {
    this.svc.listarConfiguraciones().subscribe({
      next: r => this.configuraciones.set(r ?? []),
      error: e => this.error('No se pudieron cargar las configuraciones', e),
    });
  }

  /** Centros del desplegable. Se cargan una vez con la pantalla, no al abrir el diálogo:
   *  el formulario se arma de forma síncrona y llegarían tarde. */
  cargarOpcionesCentro(): void {
    this.svc.opcionesCentro().subscribe({
      next: r => this.opcionesCentro.set(r ?? []),
      error: e => this.error('No se pudieron cargar los centros de costo', e),
    });
  }

  filtrarPorEsquema(id: number | null): void {
    this.esquemaFiltro.set(id);
    this.cargarReglas();
  }

  // ── Empresas usuarias habilitadas (eslabón 2) ─────────────────────────────

  cargarEmpresas(): void {
    this.svc.listarEmpresas().subscribe({
      next: r => this.empresas.set((r ?? []).map(e => ({
        ...e,
        // Columna derivada: la tabla compartida pinta propiedades planas.
        // La ASIGNADA manda; la deducida de los centros es el respaldo. Si no hay
        // ninguna, se dice por que — 'sin centros' no es lo mismo que 'sin temporal'.
        temporalTxt: this.nombreTemporal(e.temporal_config_ref)
          ?? e.temporal ?? 'Sin asignar',
      } as EmpresaVacante))),
      error: e => this.error('No se pudieron cargar las empresas habilitadas', e),
    });
  }

  /** Nombre de la temporal asignada, resuelto contra las ya cargadas en la pestaña 1. */
  private nombreTemporal(ref: number | null | undefined): string | null {
    if (ref == null) return null;
    return this.temporales().find(t => t.id === ref)?.nombre_display ?? `Temporal #${ref}`;
  }

  /**
   * Mete una empresa del MAESTRO en el alcance de vacantes.
   *
   * No da de alta una empresa nueva —eso es del maestro de ms-payroll—: la elige de las
   * que todavía no están habilitadas. El endpoint existía desde el principio; lo que
   * faltaba era de dónde sacar la referencia sin sabérsela de memoria.
   */
  nuevaEmpresa(): void {
    this.svc.empresasCandidatas().subscribe({
      next: candidatas => {
        if (!candidatas?.length) {
          this.snack.open(
            'Todas las empresas usuarias del maestro ya están en el alcance de vacantes.',
            'Cerrar', { duration: 5000 });
          return;
        }
        const campos: FieldConfig[] = [
          { name: 'empresa_usuaria_ref', label: 'Empresa del maestro', type: 'select', required: true,
            options: candidatas.map(c => ({
              value: c.empresa_usuaria_ref,
              label: c.nit ? `${c.nombre ?? 'Sin nombre'} — NIT ${c.nit}` : (c.nombre ?? `Ref ${c.empresa_usuaria_ref}`),
            })),
            hint: 'Solo se listan las que aún no están habilitadas para vacantes.' },
          ...this.camposAlcanceEmpresa(false),
        ];
        this.abrirDialogo('Habilitar empresa para vacantes', campos, {}, v =>
          this.svc.habilitarEmpresa({
            empresa_usuaria_ref: Number(v.empresa_usuaria_ref),
            nombre_excel: v.nombre_excel || undefined,
            tipo_conciliacion: v.tipo_conciliacion || undefined,
            temporal_config_ref: v.temporal_config_ref ? Number(v.temporal_config_ref) : undefined,
            activo: true,
            representante_legal_documento: (v.representante_legal_documento ?? '').trim() || undefined,
            ...this.soloMaestro(v),
          }).subscribe({
            next: () => this.ok('Empresa habilitada para vacantes',
              () => { this.cargarEmpresas(); this.cargarResumen(); }),
            error: err => this.error('No se pudo habilitar la empresa', err),
          }));
      },
      error: e => this.error('No se pudieron leer las empresas del maestro', e),
    });
  }

  /**
   * Campos del ALCANCE, los únicos que esta pantalla puede tocar de una empresa.
   *
   * Razón social y NIT NO están: son del maestro de ms-payroll y aquí solo se leen.
   * `nombre_excel` y `tipo_conciliacion` sí, porque son los dos con los que se arregla
   * una fila marcada REQUIERE_REVISION, y hasta ahora no había forma de editarlos.
   */
  /**
   * @param incluirIdentidad razón social y NIT. Se omiten al habilitar una empresa: ahí ya
   *        se elige del desplegable del maestro, y un campo de texto al lado invitando a
   *        reescribir el nombre solo confunde.
   */
  private camposAlcanceEmpresa(incluirIdentidad = true): FieldConfig[] {
    return [
      { name: 'temporal_config_ref', label: 'Temporal', type: 'select',
        options: this.temporales().map(t => ({ value: t.id!, label: t.nombre_display })),
        hint: 'Bajo qué temporal opera esta empresa usuaria. Es un dato propio del alcance de vacantes.' },
      ...this.camposMaestroEmpresa(incluirIdentidad),
      { name: 'nombre_excel', label: 'Nombre en la hoja de origen', type: 'text', maxLength: 200,
        hint: 'Cómo venía escrita en el Excel. Es la trazabilidad de la conciliación.' },
      { name: 'tipo_conciliacion', label: 'Tipo de conciliación', type: 'select',
        options: ['EXACTA', 'NORMALIZADA', 'POR_NIT', 'REQUIERE_REVISION', 'MANUAL']
          .map(x => ({ value: x, label: x })),
        hint: 'Cómo se emparejó con el maestro. Pásala a MANUAL cuando la revises a mano.' },
    ];
  }

  /**
   * Los campos que NO son del alcance: viven en el maestro de entidades externas
   * (ms-payroll) y se guardan allá. Se editan desde aquí porque es donde se administra la
   * empresa usuaria, pero no se duplican en db_admin — el mismo dato lo ven nómina,
   * contratación y documentos.
   */
  private camposMaestroEmpresa(incluirIdentidad: boolean): FieldConfig[] {
    return [
      ...(incluirIdentidad ? [
        { name: 'nombre', label: 'Empresa (razón social)', type: 'text', maxLength: 150,
          hint: 'Del maestro de entidades externas. Cambiarla aquí la cambia en toda la plataforma.' },
        { name: 'nit', label: 'NIT', type: 'text', maxLength: 20,
          hint: 'Único en el maestro: si ya lo tiene otra entidad, el guardado se rechaza.' },
      ] as FieldConfig[] : []),
      { name: 'representante_legal', label: 'Representante legal', type: 'text', maxLength: 150 },
      // La cédula NO es del maestro: se guarda en la habilitación (db_admin). Va aquí al lado
      // del nombre porque para quien lo llena es un solo dato.
      { name: 'representante_legal_documento', label: 'Cédula del representante legal', type: 'text', maxLength: 40,
        hint: 'La imprimen las plantillas de contratación. Vacíala para borrarla.' },
      { name: 'direccion', label: 'Dirección', type: 'text', maxLength: 200 },
      { name: 'telefono', label: 'Teléfono', type: 'text', maxLength: 40 },
      { name: 'correo', label: 'Correo', type: 'text', maxLength: 150 },
    ];
  }

  /**
   * Recorta a los campos del maestro y descarta los vacíos. El backend interpreta ausente
   * como «no lo toques», así que mandar '' borraría el dato en el maestro sin quererlo.
   */
  private soloMaestro(v: Record<string, any>): DatosMaestroEmpresa {
    const out: DatosMaestroEmpresa = {};
    for (const k of ['nombre', 'nit', 'representante_legal', 'direccion', 'telefono', 'correo'] as const) {
      const val = typeof v[k] === 'string' ? v[k].trim() : v[k];
      if (val) out[k] = val;
    }
    return out;
  }

  /** Edita el ALCANCE de la empresa. No toca razón social ni NIT: eso es del maestro. */
  editarEmpresa(e: EmpresaVacante): void {
    this.abrirDialogo(`Editar ${e.nombre ?? e.nombre_excel ?? 'la empresa'}`,
      this.camposAlcanceEmpresa(),
      {
        temporal_config_ref: e.temporal_config_ref,
        nombre: e.nombre,
        nit: e.nit,
        representante_legal: e.representante_legal,
        representante_legal_documento: e.representante_legal_documento,
        direccion: e.direccion,
        telefono: e.telefono,
        correo: e.correo,
        nombre_excel: e.nombre_excel,
        tipo_conciliacion: e.tipo_conciliacion,
      },
      v => this.svc.actualizarEmpresa(e.id, {
        temporal_config_ref: v.temporal_config_ref ? Number(v.temporal_config_ref) : undefined,
        nombre_excel: v.nombre_excel ?? undefined,
        tipo_conciliacion: v.tipo_conciliacion ?? undefined,
        representante_legal_documento: typeof v.representante_legal_documento === 'string'
          ? v.representante_legal_documento.trim() : (e.representante_legal_documento ? '' : undefined),
        ...this.soloMaestro(v),
      }).subscribe({
        next: () => this.ok('Empresa actualizada', () => this.cargarEmpresas()),
        error: err => this.error('No se pudo actualizar la empresa', err),
      }));
  }

  /** Saca o devuelve la empresa al alcance de vacantes. NO la toca en el maestro. */
  toggleEmpresa(e: EmpresaVacante): void {
    this.svc.estadoEmpresa(e.id, !e.activo_vacantes).subscribe({
      next: () => this.ok(e.activo_vacantes ? 'Empresa excluida de vacantes' : 'Empresa habilitada',
        () => this.cargarEmpresas()),
      error: err => this.error('No se pudo cambiar el estado', err),
    });
  }

  // ── Cargos del alcance (catálogo, eslabón 4) ──────────────────────────────

  /**
   * Catálogo de los 74. NO depende de centro_costo_area ni de
   * centro_costo_configuracion: son el nivel siguiente y pueden estar en 0.
   */
  cargarCargos(): void {
    this.svc.cargosHabilitados(this.verCargosNoHabilitados()).subscribe({
      next: r => this.cargos.set((r ?? []).map(c => ({
        ...c,
        arlTxt: c.porcentaje_arl ? `${c.porcentaje_arl} %` : 'Sin ARL',
        estadoTxt: c.habilitado_vacantes ? 'Habilitado' : 'No habilitado',
      } as CargoVacante))),
      error: e => this.error('No se pudieron cargar los cargos', e),
    });
  }

  alternarCargosNoHabilitados(ver: boolean): void {
    this.verCargosNoHabilitados.set(ver);
    this.cargarCargos();
  }

  nuevoCargo(): void {
    this.abrirDialogo('Nuevo cargo', this.camposCargo(), { porcentaje_arl: 2.436 }, v =>
      this.svc.crearCargo(v).subscribe({
        next: () => this.ok('Cargo creado y habilitado para vacantes', () => this.cargarCargos()),
        error: e => this.error('No se pudo crear el cargo', e),
      }));
  }

  editarCargo(c: CargoVacante): void {
    this.abrirDialogo(`Editar ${c.nombre}`, this.camposCargo(), c, v =>
      this.svc.actualizarCargo(c.id, v).subscribe({
        next: () => this.ok('Cargo actualizado', () => this.cargarCargos()),
        error: e => this.error('No se pudo actualizar el cargo', e),
      }));
  }

  private camposCargo(): FieldConfig[] {
    return [
      { name: 'nombre', label: 'Nombre del cargo', type: 'text', required: true, maxLength: 150,
        hint: 'Se guarda en MAYÚSCULAS, como los otros 206 del maestro. Renombrar conserva '
            + 'el cargo: no se rompe lo que ya apunta a él.' },
      // Las tasas reales del maestro son 2,436 y 4,35: tres decimales, no enteros.
      { name: 'porcentaje_arl', label: '% ARL', type: 'number', min: 0, max: 100, step: 0.001,
        inputMode: 'decimal', suffix: '%',
        hint: 'Se copia al contrato como snapshot y llega hasta nómina. Déjalo en 0 solo si '
            + 'negocio aún no lo ha dictado.' },
    ];
  }

  toggleCargo(c: CargoVacante): void {
    this.svc.estadoCargo(c.id, !c.habilitado_vacantes).subscribe({
      next: () => this.ok(c.habilitado_vacantes ? 'Cargo excluido de vacantes' : 'Cargo habilitado',
        () => this.cargarCargos()),
      error: e => this.error('No se pudo cambiar el estado', e),
    });
  }

  /** Cuántos del alcance siguen sin porcentaje de ARL. */
  cargosSinArl = computed(() =>
    this.cargos().filter(c => c.habilitado_vacantes && !c.porcentaje_arl).length);

  // ── Centros de costo (eslabón 3) ──────────────────────────────────────────

  /** Nombre de la empresa seleccionada, para los títulos y mensajes. */
  /** Empresas habilitadas, que son las únicas que pueden tener centros de vacantes. */
  empresasHabilitadas = computed(() => this.empresas().filter(e => e.activo_vacantes));

  /**
   * Buscador "inteligente": ignora tildes, mayúsculas y sufijos societarios, y busca
   * tanto en la razón social como en el nombre del Excel y el NIT. Así "sagaro",
   * "SÁGARO S.A" y "800013638" encuentran la misma empresa.
   */
  empresasFiltradas = computed(() => {
    const q = this.normalizar(this.buscadorEmpresa());
    const base = this.empresasHabilitadas();
    if (!q) return base;
    return base.filter(e => {
      const heno = this.normalizar(`${e.nombre ?? ''} ${e.nombre_excel ?? ''} ${e.nit ?? ''}`);
      // Todas las palabras deben aparecer: "flores ipa" encuentra FLORES IPANEMA.
      return q.split(' ').every(palabra => heno.includes(palabra));
    });
  });

  private normalizar(v: string): string {
    return (v ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\b(S\.?A\.?S\.?|S\.?A\.?|LTDA\.?|C\.?I\.?)\b/g, ' ')
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Nombres de las empresas seleccionadas, para títulos y avisos. */
  empresaSelNombre = computed(() => {
    const refs = this.empresasSel();
    if (!refs.length) return null;
    const nombres = refs
      .map(r => this.empresas().find(x => x.empresa_usuaria_ref === r))
      .map(e => e?.nombre ?? e?.nombre_excel ?? '—');
    return nombres.length <= 2 ? nombres.join(' y ') : `${nombres.length} empresas`;
  });

  /** Con más de una empresa seleccionada hace falta saber de cuál es cada centro. */
  colCentrosVisibles = computed<ColumnDefinition[]>(() =>
    this.empresasSel().length > 1
      ? this.colCentros
      : this.colCentros.filter(c => c.name !== 'empresa_nombre'));

  @ViewChild('inputBuscador') inputBuscador?: ElementRef<HTMLInputElement>;

  /** El grupo de pestañas, para poder realinear el scroll al cambiar de pestaña. */
  @ViewChild('grupoPestanas', { read: ElementRef }) grupoPestanas?: ElementRef<HTMLElement>;

  /**
   * Resumen que se pinta en el campo cerrado. Con 19 empresas la lista de nombres
   * separada por comas desborda y no se lee nada.
   */
  resumenSeleccion = computed(() => {
    const refs = this.empresasSel();
    if (!refs.length) return '';
    if (refs.length === 1) {
      const e = this.empresas().find(x => x.empresa_usuaria_ref === refs[0]);
      return e?.nombre ?? e?.nombre_excel ?? `Empresa #${refs[0]}`;
    }
    if (refs.length === this.empresasHabilitadas().length) return `Todas (${refs.length})`;
    return `${refs.length} empresas seleccionadas`;
  });

  /**
   * Al abrir: limpia la búsqueda anterior y pone el foco en el buscador, para poder
   * escribir de inmediato. Al cerrar también limpia, así el panel no reabre filtrado
   * con un texto que el usuario ya no recuerda haber escrito.
   */
  alAbrirSelector(abierto: boolean): void {
    this.buscadorEmpresa.set('');
    if (!abierto) return;
    // setTimeout: el panel se monta después de este evento; sin él no hay input al que enfocar.
    setTimeout(() => this.inputBuscador?.nativeElement?.focus(), 0);
  }

  seleccionarTodas(): void {
    this.empresasSel.set(this.empresasFiltradas().map(e => e.empresa_usuaria_ref));
    this.cargarCentros();
  }

  limpiarSeleccion(): void {
    this.empresasSel.set([]);
    this.centros.set([]);
  }

  /**
   * Al cambiar de empresa se LIMPIA el centro antes de pedir los nuevos. Si no, entre la
   * petición y la respuesta se verían los de la empresa anterior como si fueran de ésta.
   */
  seleccionarEmpresas(refs: number[]): void {
    this.empresasSel.set(refs ?? []);
    // Se limpia ANTES de pedir: si no, entre la petición y la respuesta se verían los
    // centros de la selección anterior como si fueran de ésta.
    this.centros.set([]);
    this.cargarCentros();
  }

  alternarNoHabilitados(ver: boolean): void {
    this.verNoHabilitados.set(ver);
    this.cargarCentros();
  }

  cargarCentros(): void {
    const refs = this.empresasSel();
    if (!refs.length) { this.centros.set([]); return; }
    this.cargandoCentros.set(true);
    this.svc.listarCentros(refs, this.verNoHabilitados()).subscribe({
      next: r => {
        this.centros.set((r ?? []).map(c => ({
          ...c,
          estadoTxt: c.habilitado_vacantes ? 'Habilitado' : 'No habilitado',
          // 'Sin áreas' se resalta: un centro sin áreas no puede llegar a tener cargos
          // ni resolver labor, así que es un hueco que hay que ver de un vistazo.
          areasTxt: c.areas || 'Sin áreas',
        } as CentroVacante)));
        this.cargandoCentros.set(false);
      },
      error: e => { this.cargandoCentros.set(false); this.error('No se pudieron cargar los centros', e); },
    });
  }

  nuevoCentro(): void {
    const refs = this.empresasSel();
    // Crear exige UNA empresa concreta: con varias seleccionadas no se sabe de cuál sería.
    if (refs.length !== 1) {
      this.snack.open(refs.length ? 'Selecciona una sola empresa para crear un centro.'
                                  : 'Selecciona primero una empresa usuaria.',
        'Cerrar', { duration: 4000 });
      return;
    }
    const ref = refs[0];
    this.abrirDialogo(`Nuevo centro de ${this.empresaSelNombre()}`, this.camposCentro(), {}, v =>
      this.svc.crearCentro({ ...v, empresa_usuaria_ref: ref }).subscribe({
        next: () => this.ok('Centro creado', () => this.cargarCentros()),
        error: e => this.error('No se pudo crear el centro', e),
      }));
  }

  editarCentro(c: CentroVacante): void {
    this.abrirDialogo(`Editar ${c.finca}`, this.camposCentro(), c, v =>
      this.svc.actualizarCentro(c.id, v).subscribe({
        next: () => this.ok('Centro actualizado', () => this.cargarCentros()),
        error: e => this.error('No se pudo actualizar el centro', e),
      }));
  }

  /**
   * Asigna las áreas permitidas del centro. Se ofrecen solo las 6 activas del catálogo:
   * las 15 que negocio sacó del alcance no pueden volver a entrar por aquí.
   */
  areasDeCentro(c: CentroVacante): void {
    this.svc.areasDeCentro(c.id).subscribe({
      next: (areas: CentroArea[]) => {
        const campos: FieldConfig[] = [
          { name: 'area_ids', label: 'Áreas permitidas', type: 'select', multiple: true,
            options: areas.map(a => ({ value: a.area_id, label: `${a.codigo} · ${a.nombre ?? ''}`.trim() })),
            hint: 'Solo las áreas que este centro trabaja realmente. No las marques todas por defecto.' },
        ];
        const actuales = areas.filter(a => a.asignada).map(a => a.area_id);
        this.abrirDialogo(`Áreas de ${c.finca}`, campos, { area_ids: actuales }, v =>
          this.svc.fijarAreasDeCentro(c.id, v.area_ids ?? []).subscribe({
            next: () => this.ok('Áreas actualizadas', () => this.cargarCentros()),
            error: e => this.error('No se pudieron guardar las áreas', e),
          }));
      },
      error: e => this.error('No se pudieron cargar las áreas del centro', e),
    });
  }

  /** Saca o devuelve el centro al selector de vacantes. No lo toca en otros módulos. */
  toggleCentro(c: CentroVacante): void {
    this.svc.estadoCentro(c.id, !c.habilitado_vacantes).subscribe({
      next: () => this.ok(c.habilitado_vacantes ? 'Centro excluido de vacantes' : 'Centro habilitado',
        () => this.cargarCentros()),
      error: e => this.error('No se pudo cambiar el estado', e),
    });
  }

  private camposCentro(): FieldConfig[] {
    return [
      { name: 'finca', label: 'Nombre del centro', type: 'text', required: true, maxLength: 200,
        hint: 'Puede repetirse entre empresas distintas: la identidad es (empresa, centro).' },
      { name: 'ccostos', label: 'Código de costo', type: 'text', maxLength: 50 },
      { name: 'subcentro', label: 'Subcentro', type: 'text', maxLength: 80 },
      { name: 'ciudad', label: 'Ciudad', type: 'text', maxLength: 120 },
      { name: 'direccion', label: 'Dirección', type: 'text', maxLength: 300 },
      // Contacto del gestor del centro: los tres juntos, que es como se usan.
      { name: 'nombre_gestor', label: 'Nombre del gestor', type: 'text', maxLength: 200,
        hint: 'Quién responde por este centro. Se usa para contactarlo, no para permisos.' },
      { name: 'telefono_gestor', label: 'Teléfono del gestor', type: 'text', maxLength: 50 },
      { name: 'email_gestor', label: 'Correo del gestor', type: 'text', maxLength: 200 },
    ];
  }

  // ── Temporales (eslabón 1) ────────────────────────────────────────────────

  /** El interruptor «Ver retiradas» de la pestaña de temporales. */
  verTemporalesInactivas = signal(false);

  alternarTemporalesInactivas(ver: boolean): void {
    this.verTemporalesInactivas.set(ver);
    this.cargarTemporales();
  }

  /**
   * Retira o devuelve una temporal.
   *
   * El alta y la baja pasan por el MISMO PUT de upsert, así que basta con reenviar la
   * fila cambiando `activa`. Hay que mandar el resto de campos: el backend solo
   * conserva lo que no se le manda en las dos imágenes, todo lo demás lo pisa.
   */
  toggleTemporal(t: Temporal): void {
    const activa = !(t.activa !== false);
    this.temporalesSvc.guardar(t.temporal_key, {
      temporal_key: t.temporal_key,
      nombre_display: t.nombre_display,
      nit: t.nit ?? null,
      direccion: t.direccion ?? null,
      email: t.email ?? null,
      activa,
    }).subscribe({
      next: () => this.ok(activa ? 'Temporal reactivada' : 'Temporal retirada',
        () => { this.cargarTemporales(); this.cargarEmpresas(); }),
      error: err => this.error('No se pudo cambiar el estado de la temporal', err),
    });
  }

  cargarTemporales(): void {
    this.temporalesSvc.listar(this.verTemporalesInactivas()).subscribe({
      next: r => this.temporales.set(r ?? []),
      error: e => this.error('No se pudieron cargar las temporales', e),
    });
  }

  nuevaTemporal(): void {
    this.abrirDialogo('Nueva temporal', this.camposTemporal(false), {}, v => {
      // La clave la deriva del nombre si no la escriben, con la misma normalizacion
      // que espera el backend, para no crear "TU ALIANZA SAS" y "TU_ALIANZA" a la vez.
      const key = TemporalesService.normalizarKey(v.temporal_key || v.nombre_display);
      if (!key) {
        this.snack.open('Indica la clave o al menos el nombre.', 'Cerrar', { duration: 4000 });
        return;
      }
      if (this.temporales().some(t => t.temporal_key === key)) {
        this.snack.open(`Ya existe una temporal con la clave ${key}.`, 'Cerrar', { duration: 5000 });
        return;
      }
      this.svcTemporalGuardar(key, v, 'Temporal creada');
    });
  }

  editarTemporal(t: Temporal): void {
    // temporal_key NO se edita: es con la que el resto de la plataforma referencia a
    // esta temporal (centros_costos.temporal es texto, sin FK que proteja el renombrado).
    this.abrirDialogo(`Editar ${t.nombre_display}`, this.camposTemporal(true), t, v =>
      this.svcTemporalGuardar(t.temporal_key, v, 'Temporal actualizada', t.activa !== false, t));
  }

  /** Datos documentales de la temporal (ms-hr V60). Los imprimen las plantillas de contratación. */
  private static readonly CAMPOS_DOCUMENTALES_TEMPORAL = [
    'representante_legal_nombre', 'representante_legal_tipo_doc', 'representante_legal_documento',
    'direccion_coordinador', 'telefono_coordinador', 'arl_por_defecto', 'ccf_por_defecto',
  ] as const;

  /**
   * Solo lo que el usuario CAMBIÓ. En estos campos el backend lee null/omitido como «no
   * tocar» y '' como «borrar», al revés que nit/dirección/correo. Mandar todo el formulario
   * haría que un valor que no llegó en el listado se borrara al editar el NIT; por eso se
   * compara contra la fila original y lo que no cambió se omite (undefined no viaja).
   */
  private datosDocumentalesTemporal(v: any, original?: Temporal): Partial<TemporalRequest> {
    const out: Partial<TemporalRequest> = {};
    for (const k of ParametrizacionVacantesComponent.CAMPOS_DOCUMENTALES_TEMPORAL) {
      const nuevo = typeof v?.[k] === 'string' ? v[k].trim() : '';
      const antes = (original?.[k] ?? '').trim();
      if (nuevo === antes) continue;
      // '' solo llega aquí si antes había algo y el usuario lo vació: eso sí es borrar.
      out[k] = nuevo;
    }
    return out;
  }

  /**
   * El backend hace upsert por clave: mismo PUT para alta y edicion.
   *
   * `activa` se ARRASTRA en vez de fijarse en true. Estaba cableado a true, así que
   * editar el NIT de una temporal retirada la reactivaba sin decirlo.
   */
  private svcTemporalGuardar(key: string, v: any, mensaje: string, activa = true, original?: Temporal): void {
    this.temporalesSvc.guardar(key, {
      temporal_key: key,
      nombre_display: (v.nombre_display ?? '').trim(),
      nit: v.nit || null,
      direccion: v.direccion || null,
      email: v.email || null,
      // null = no tocar las imagenes ya cargadas (firma y sello se suben aparte).
      firma_imagen: null,
      sello_imagen: null,
      activa,
      // Los logos (logo_principal/carne/borde/referenciacion) NO se mandan: sin ellos el
      // backend no los toca. Ver el TODO de camposTemporal.
      ...this.datosDocumentalesTemporal(v, original),
    }).subscribe({
      next: () => this.ok(mensaje, () => this.cargarTemporales()),
      error: e => this.error('No se pudo guardar la temporal', e),
    });
  }

  private camposTemporal(editando: boolean): FieldConfig[] {
    const campos: FieldConfig[] = [];
    if (!editando) {
      campos.push({ name: 'temporal_key', label: 'Clave (opcional)', type: 'text', maxLength: 100,
        hint: 'Se normaliza sola (TU_ALIANZA). Si la dejas vacía se deriva del nombre. No se puede cambiar después.' });
    }
    campos.push(
      { name: 'nombre_display', label: 'Nombre para documentos', type: 'text', required: true, maxLength: 300,
        hint: 'Razón social tal como debe imprimirse en contratos y formularios.' },
      { name: 'nit', label: 'NIT', type: 'text', maxLength: 30 },
      { name: 'direccion', label: 'Dirección', type: 'text', maxLength: 400 },
      { name: 'email', label: 'Correo', type: 'text', maxLength: 200 },
      // Datos documentales (V60). Largos = columnas de afiliacion_temporal_config.
      { name: 'representante_legal_nombre', label: 'Representante legal: nombre', type: 'text', maxLength: 200,
        hint: 'Tal como se imprime en contratos y formularios.' },
      { name: 'representante_legal_tipo_doc', label: 'Representante legal: tipo de documento', type: 'text',
        maxLength: 20, hint: 'Ej: C.C, C.E, P.P.T.' },
      { name: 'representante_legal_documento', label: 'Representante legal: documento', type: 'text', maxLength: 40 },
      { name: 'direccion_coordinador', label: 'Dirección del coordinador', type: 'text', maxLength: 300,
        hint: 'Sale en el reverso del carné.' },
      { name: 'telefono_coordinador', label: 'Teléfono del coordinador', type: 'text', maxLength: 60,
        hint: 'Sale en el reverso del carné.' },
      { name: 'arl_por_defecto', label: 'ARL por defecto', type: 'text', maxLength: 120,
        hint: 'Se usa si el trabajador no tiene ARL registrada.' },
      { name: 'ccf_por_defecto', label: 'Caja de compensación por defecto', type: 'text', maxLength: 120,
        hint: 'Se usa si el trabajador no tiene CCF registrada.' },
      // TODO(logos): el backend ya acepta logo_principal, logo_carne, logo_borde y
      // logo_referenciacion (data URI; null = no tocar, '' = quitar) y el listado trae
      // tiene_logo_*. No se ofrecen aquí porque DynamicFormDialogComponent no tiene campo de
      // imagen y la firma/sello tampoco se suben desde este diálogo. Hace falta un cargador
      // de imagen propio antes de exponerlos.
    );
    return campos;
  }

  /**
   * Conteos de los maestros que viven en otras pantallas. Solo para saber si el eslabón
   * está cubierto; si el endpoint falla se deja en null y la cadena lo muestra como
   * "sin dato" en vez de como "vacío", que sería mentir.
   */
  /** Conteos de la cadena, de una sola llamada al backend. */
  cargarResumen(): void {
    this.svc.resumenCadena().subscribe({
      next: r => this.resumen.set(r),
      error: e => this.error('No se pudo cargar el resumen de la cadena', e),
    });
  }


  /** Salta a la pestaña que administra ese eslabón. */
  irAPaso(paso: PasoCadena): void {
    if (paso.tab !== undefined) this.cambiarTab(paso.tab);
  }

  /**
   * Cambia de pestaña y deja la vista donde estaría si la barra fuera parte del borde
   * superior: pegada arriba y el contenido nuevo empezando justo debajo. Sin esto, al
   * cambiar de pestaña desde media tabla la nueva arrancaba por la mitad.
   */
  cambiarTab(indice: number): void {
    this.tabActivo.set(indice);
    this.alinearConBarra();
  }

  /**
   * Sube el scroll hasta que el borde superior del grupo de pestañas coincide con el del
   * área visible, que es exactamente donde la barra ya está pegada (CSS `position: sticky`).
   * Si la barra todavía no se ha pegado —la pantalla se ve desde arriba— no toca nada:
   * bajar la vista por su cuenta sería peor que dejarla quieta.
   */
  private alinearConBarra(): void {
    const grupo = this.grupoPestanas?.nativeElement;
    if (!grupo) return;

    const cont = this.contenedorScroll(grupo);
    const arribaGrupo = grupo.getBoundingClientRect().top;

    if (!cont) {
      // Sin contenedor propio el que scrollea es la ventana.
      if (arribaGrupo < 0) window.scrollTo({ top: window.scrollY + arribaGrupo, behavior: 'auto' });
      return;
    }

    // Borde superior del área visible del contenedor (padding box, que es contra lo que
    // se posiciona un elemento sticky).
    const arribaArea = cont.getBoundingClientRect().top + cont.clientTop;
    const delta = arribaGrupo - arribaArea;
    if (delta >= 0) return;

    cont.scrollTo({ top: cont.scrollTop + delta, behavior: 'auto' });
  }

  /**
   * Primer ancestro que scrollea. Es el mismo criterio que usa el navegador para decidir
   * contra quién se pega un `position: sticky`, así que ambos miran el mismo borde. Hoy
   * resuelve a `.dashboard-page-wrapper` (styles.css), pero no se cablea el selector:
   * si el shell cambia, esto sigue funcionando.
   */
  private contenedorScroll(desde: HTMLElement): HTMLElement | null {
    let el = desde.parentElement;
    while (el && el !== document.body) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') return el;
      el = el.parentElement;
    }
    return null;
  }

  // ── Áreas operativas ──────────────────────────────────────────────────────

  nuevaArea(): void {
    this.abrirDialogo('Nueva área operativa', this.camposArea(), {}, v =>
      this.svc.crearArea(v).subscribe({
        next: () => this.ok('Área creada', () => this.cargarAreas()),
        error: e => this.error('No se pudo crear el área', e),
      }));
  }

  editarArea(a: AreaOperativa): void {
    this.abrirDialogo(`Editar área ${a.codigo}`, this.camposArea(), a, v =>
      this.svc.actualizarArea(a.id!, v).subscribe({
        next: () => this.ok('Área actualizada', () => this.cargarAreas()),
        error: e => this.error('No se pudo actualizar el área', e),
      }));
  }

  toggleArea(a: AreaOperativa): void {
    this.svc.estadoArea(a.id!, !a.activo).subscribe({
      next: () => this.ok(a.activo ? 'Área desactivada' : 'Área activada', () => this.cargarAreas()),
      error: e => this.error('No se pudo cambiar el estado', e),
    });
  }

  private camposArea(): FieldConfig[] {
    return [
      { name: 'codigo', label: 'Código', type: 'text', required: true, maxLength: 16,
        hint: 'Ej: CU, PO, AD. Se guarda en mayúsculas.' },
      { name: 'nombre', label: 'Nombre', type: 'text', maxLength: 120,
        hint: 'Déjalo vacío si negocio aún no confirmó el nombre oficial.' },
      { name: 'descripcion', label: 'Descripción', type: 'text', maxLength: 300 },
    ];
  }

  // ── Esquemas de labor ─────────────────────────────────────────────────────

  nuevoEsquema(): void {
    this.abrirDialogo('Nuevo esquema de labor', this.camposEsquema(), { tipo_resolucion: 'MES_AREA' }, v =>
      this.svc.crearEsquema(v).subscribe({
        next: () => this.ok('Esquema creado', () => this.cargarEsquemas()),
        error: e => this.error('No se pudo crear el esquema', e),
      }));
  }

  editarEsquema(e: EsquemaLabor): void {
    this.abrirDialogo(`Editar esquema ${e.codigo}`, this.camposEsquema(), e, v =>
      this.svc.actualizarEsquema(e.id!, v).subscribe({
        next: () => this.ok('Esquema actualizado', () => this.cargarEsquemas()),
        error: err => this.error('No se pudo actualizar el esquema', err),
      }));
  }

  toggleEsquema(e: EsquemaLabor): void {
    this.svc.estadoEsquema(e.id!, !e.activo).subscribe({
      next: () => this.ok(e.activo ? 'Esquema desactivado' : 'Esquema activado', () => this.cargarEsquemas()),
      error: err => this.error('No se pudo cambiar el estado', err),
    });
  }

  private camposEsquema(): FieldConfig[] {
    return [
      { name: 'codigo', label: 'Código', type: 'text', required: true, maxLength: 32 },
      { name: 'nombre', label: 'Nombre', type: 'text', maxLength: 120 },
      { name: 'tipo_resolucion', label: 'Tipo de resolución', type: 'select', required: true, options: [
        { value: 'MES_AREA', label: 'Mes + área' },
        { value: 'MES', label: 'Solo mes' },
        { value: 'MES_DIA', label: 'Mes + día exacto' },
        { value: 'MES_RANGO_DIA', label: 'Mes + rango de días' },
        { value: 'FIJA', label: 'Labor fija (sin reglas)' },
      ], hint: 'Decide qué campos exige cada regla. No se puede cambiar si el esquema ya tiene reglas.' },
      { name: 'descripcion', label: 'Descripción', type: 'text', maxLength: 400 },
    ];
  }

  // ── Reglas de labor ───────────────────────────────────────────────────────

  nuevaRegla(): void {
    this.abrirDialogo('Nueva regla de labor', this.camposRegla(), { prioridad: 0 }, v =>
      this.svc.crearRegla(this.limpiarRegla(v)).subscribe({
        next: () => this.ok('Regla creada', () => this.cargarReglas()),
        error: e => this.error('No se pudo crear la regla', e),
      }));
  }

  editarRegla(r: ReglaLabor): void {
    this.abrirDialogo(`Editar regla ${r.codigo_eq ?? r.id}`, this.camposRegla(), r, v =>
      this.svc.actualizarRegla(r.id!, this.limpiarRegla(v)).subscribe({
        next: () => this.ok('Regla actualizada', () => this.cargarReglas()),
        error: e => this.error('No se pudo actualizar la regla', e),
      }));
  }

  toggleRegla(r: ReglaLabor): void {
    this.svc.estadoRegla(r.id!, !r.activo).subscribe({
      next: () => this.ok(r.activo ? 'Regla desactivada' : 'Regla activada', () => this.cargarReglas()),
      error: e => this.error('No se pudo cambiar el estado', e),
    });
  }

  private camposRegla(): FieldConfig[] {
    return [
      // Los CINCO: una regla de APOYO o BLU tiene que seguir siendo editable.
      { name: 'esquema_id', label: 'Esquema', type: 'select', required: true,
        options: this.esquemasTodos().map(e => ({ value: e.id!, label: `${e.codigo} (${e.tipo_resolucion})` })) },
      { name: 'area_id', label: 'Área operativa', type: 'select',
        options: [{ value: null as any, label: '— Sin área (solo esquemas por mes) —' },
                  ...this.areas().filter(a => a.activo).map(a => ({ value: a.id!, label: `${a.codigo} · ${a.nombre ?? 'sin nombre'}` }))] },
      { name: 'mes', label: 'Mes (1-12)', type: 'number', min: 1, max: 12 },
      { name: 'dia_desde', label: 'Día desde (1-31)', type: 'number', min: 1, max: 31,
        hint: 'Solo para esquemas por día/rango. Inclusivo.' },
      { name: 'dia_hasta', label: 'Día hasta (1-31)', type: 'number', min: 1, max: 31, hint: 'Inclusivo.' },
      { name: 'codigo_eq', label: 'Código EQ', type: 'text', maxLength: 32, hint: 'Clave del Excel origen, p.ej. 1CU.' },
      { name: 'descripcion_labor', label: 'Labor', type: 'text', required: true,
        hint: 'Texto que se escribirá en la vacante.' },
      { name: 'vigencia_desde', label: 'Vigente desde', type: 'date' },
      { name: 'vigencia_hasta', label: 'Vigente hasta', type: 'date' },
      { name: 'prioridad', label: 'Prioridad', type: 'number',
        hint: 'A mayor número, gana. Permite una excepción sin borrar la regla general.' },
    ];
  }

  /** El diálogo devuelve '' para los numéricos vacíos; el backend espera null. */
  private limpiarRegla(v: any): Partial<ReglaLabor> {
    const num = (x: any) => (x === '' || x === null || x === undefined ? null : Number(x));
    // Las claves van en snake_case: es lo que espera Jackson en ms-auth-admin. Con
    // camelCase el campo se descarta en silencio y el guardado "no hace nada".
    return {
      ...v,
      area_id: v.area_id === '' || v.area_id === undefined ? null : v.area_id,
      mes: num(v.mes),
      dia_desde: num(v.dia_desde),
      dia_hasta: num(v.dia_hasta),
      prioridad: v.prioridad === '' || v.prioridad == null ? 0 : Number(v.prioridad),
    };
  }

  // ── Cargo ↔ área ──────────────────────────────────────────────────────────

  nuevoCargoArea(): void {
    this.abrirDialogo('Nuevo mapeo cargo → área', this.camposCargoArea(), {}, v =>
      this.svc.crearCargoArea(v).subscribe({
        next: () => this.ok('Mapeo creado', () => this.cargarCargoAreas()),
        error: e => this.error('No se pudo crear el mapeo', e),
      }));
  }

  editarCargoArea(c: CargoArea): void {
    this.abrirDialogo(`Editar ${c.cargo_nombre_origen}`, this.camposCargoArea(), c, v =>
      this.svc.actualizarCargoArea(c.id!, v).subscribe({
        next: () => this.ok('Mapeo actualizado', () => this.cargarCargoAreas()),
        error: e => this.error('No se pudo actualizar el mapeo', e),
      }));
  }

  /** Retira o devuelve un mapeo. No se borra: es la línea base de la migración legacy. */
  toggleCargoArea(c: CargoArea): void {
    this.svc.estadoCargoArea(c.id!, !c.activo).subscribe({
      next: () => this.ok(c.activo ? 'Mapeo dado de baja' : 'Mapeo reactivado',
        () => this.cargarCargoAreas()),
      error: err => this.error('No se pudo cambiar el estado del mapeo', err),
    });
  }

  conciliar(c: CargoArea): void {
    this.svc.conciliarCargoArea(c.id!).subscribe({
      next: () => this.ok('Cargo conciliado con el maestro', () => this.cargarCargoAreas()),
      error: e => this.error('No se pudo conciliar', e),
    });
  }

  private camposCargoArea(): FieldConfig[] {
    return [
      { name: 'cargo_nombre_origen', label: 'Cargo', type: 'text', required: true, maxLength: 150 },
      // Los CINCO: los 218 mapeos legacy cuelgan de APOYO y BLU.
      { name: 'esquema_id', label: 'Esquema', type: 'select', required: true,
        options: this.esquemasTodos().map(e => ({ value: e.id!, label: e.codigo })) },
      { name: 'area_id', label: 'Área operativa', type: 'select', required: true,
        options: this.areas().filter(a => a.activo).map(a => ({ value: a.id!, label: `${a.codigo} · ${a.nombre ?? 'sin nombre'}` })) },
    ];
  }

  // ── Configuración centro + cargo ──────────────────────────────────────────

  nuevaConfiguracion(): void {
    this.abrirDialogo('Nueva configuración centro + cargo', this.camposConfig(), { tipo_labor: 'PARAMETRIZADA' }, v =>
      this.svc.crearConfiguracion({ ...v, centro_costo_id: Number(v.centro_costo_id) }).subscribe({
        next: () => this.ok('Configuración creada', () => this.cargarConfiguraciones()),
        error: e => this.error('No se pudo crear la configuración', e),
      }));
  }

  editarConfiguracion(c: ConfiguracionCentroCargo): void {
    this.abrirDialogo(
      `Editar ${c.centro_nombre ?? `centro ${c.centro_costo_id}`} · ${c.cargo_nombre_origen}`,
      this.camposConfig(), c, v =>
      this.svc.actualizarConfiguracion(c.id!, v).subscribe({
        next: () => this.ok('Configuración actualizada', () => this.cargarConfiguraciones()),
        error: e => this.error('No se pudo actualizar la configuración', e),
      }));
  }

  toggleConfiguracion(c: ConfiguracionCentroCargo): void {
    this.svc.estadoConfiguracion(c.id!, !c.activo).subscribe({
      next: () => this.ok(c.activo ? 'Configuración desactivada' : 'Configuración activada',
        () => this.cargarConfiguraciones()),
      error: e => this.error('No se pudo cambiar el estado', e),
    });
  }

  private camposConfig(): FieldConfig[] {
    return [
      // El valor sigue siendo el id —es la FK con la que se guarda— pero lo que se elige
      // es el nombre. El backend ya manda las etiquetas desambiguadas.
      { name: 'centro_costo_id', label: 'Centro de costo', type: 'select', required: true,
        options: this.opcionesCentro().map(o => ({ value: o.id, label: o.etiqueta })),
        hint: 'Solo los centros habilitados para vacantes; los demás no pueden resolver labor.' },
      { name: 'cargo_nombre_origen', label: 'Cargo', type: 'text', required: true, maxLength: 150 },
      { name: 'area_id', label: 'Área operativa', type: 'select', required: true,
        options: this.areas().filter(a => a.activo).map(a => ({ value: a.id!, label: `${a.codigo} · ${a.nombre ?? 'sin nombre'}` })) },
      // SOLO el alcance: APOYO y BLU no pueden gobernar una configuración nueva. Se
      // filtra aquí por comodidad; quien lo intente por API se lleva un 409 del backend.
      { name: 'esquema_id', label: 'Esquema de labor', type: 'select', required: true,
        options: this.esquemasTodos().filter(e => e.activo && e.habilitado_vacantes)
          .map(e => ({ value: e.id!, label: `${e.codigo} (${e.tipo_resolucion})` })) },
      { name: 'tipo_labor', label: 'Tipo de labor', type: 'select', required: true, options: [
        { value: 'PARAMETRIZADA', label: 'Parametrizada (esquema + reglas)' },
        { value: 'FIJA', label: 'Fija (texto fijo del centro)' },
      ]},
      { name: 'labor_fija_override', label: 'Labor fija (opcional)', type: 'text',
        hint: 'Solo para tipo FIJA. Si se deja vacío se usa el sublabor del centro de costo.' },
    ];
  }

  // ── Seguros funerarios ───────────────────────────────────────────────────

  cargarSeguros(): void {
    // Sin `activo`: esta pantalla administra, así que también ve los retirados.
    this.svc.listarSeguros().subscribe({
      next: r => this.seguros.set((r ?? []).map(s => ({
        ...s,
        // Columnas derivadas: la tabla compartida pinta propiedades planas.
        valorTxt: this.pesos(s.valor),
        descuentoTxt: s.descuento_nomina ? 'Por nómina' : 'Lo asume la empresa',
        // Un seguro sin centros no se le cobra a nadie: hay que verlo de un vistazo.
        centrosTxt: s.centros_asignados
          ? `${s.centros_asignados} centro(s)`
          : 'Ninguno todavía',
      } as SeguroFunerario))),
      error: e => this.error('No se pudieron cargar los seguros funerarios', e),
    });
  }

  alternarSegurosInactivos(ver: boolean): void {
    this.verSegurosInactivos.set(ver);
  }

  nuevoSeguro(): void {
    this.abrirDialogo('Nuevo seguro funerario', this.camposSeguro(),
      { periodicidad: 'QUINCENAL', descuento_nomina: true }, v =>
        this.svc.crearSeguro(v).subscribe({
          next: () => this.ok('Seguro creado. Ahora asígnale centros.', () => this.cargarSeguros()),
          error: e => this.error('No se pudo crear el seguro', e),
        }));
  }

  editarSeguro(s: SeguroFunerario): void {
    this.abrirDialogo(`Editar «${s.nombre}»`, this.camposSeguro(s), s, v =>
      this.svc.actualizarSeguro(s.id!, v).subscribe({
        next: () => this.ok('Seguro actualizado', () => this.cargarSeguros()),
        error: e => this.error('No se pudo actualizar el seguro', e),
      }));
  }

  toggleSeguro(s: SeguroFunerario): void {
    this.svc.estadoSeguro(s.id!, !s.activo).subscribe({
      next: () => this.ok(s.activo ? 'Seguro retirado' : 'Seguro activado',
                          () => this.cargarSeguros()),
      error: e => this.error('No se pudo cambiar el estado', e),
    });
  }

  /**
   * Asigna el seguro a varios centros de una vez. Existe porque el quincenal está en 186
   * centros: hacerlo centro a centro no es trabajo que se le pueda pedir a nadie.
   */
  centrosDeSeguro(s: SeguroFunerario): void {
    this.svc.centrosDeSeguro(s.id!).subscribe({
      next: (centros: SeguroCentro[]) => {
        const campos: FieldConfig[] = [
          { name: 'centro_costo_ids', label: 'Centros con este seguro', type: 'select', multiple: true,
            options: centros.map(c => ({
              value: c.centro_costo_id,
              label: `${c.centro_nombre ?? c.centro_codigo} · ${c.empresa_nombre ?? ''}`.trim(),
            })),
            hint: 'Solo centros habilitados para vacantes. Quitar uno da de baja la relación, '
                + 'no la borra: explica un descuento ya aplicado.' },
        ];
        const actuales = centros.filter(c => c.asignada).map(c => c.centro_costo_id);
        this.abrirDialogo(`Centros de «${s.nombre}»`, campos, { centro_costo_ids: actuales }, v =>
          this.svc.fijarCentrosDeSeguro(s.id!, v.centro_costo_ids ?? []).subscribe({
            next: () => this.ok('Centros actualizados', () => this.cargarSeguros()),
            error: e => this.error('No se pudieron guardar los centros', e),
          }));
      },
      error: e => this.error('No se pudieron cargar los centros del seguro', e),
    });
  }

  /**
   * Los seguros de UN centro, desde la fila de la pestaña «Centros de costo». Es la vista
   * simétrica de la anterior y la que describió negocio: «por centro de costo».
   *
   * Multiselección porque un centro puede tener VARIOS seguros — Flores de los Andes y
   * Monteverde tienen los dos.
   */
  segurosDeCentro(c: CentroVacante): void {
    this.svc.segurosDeCentro(c.id).subscribe({
      next: (lista: CentroSeguro[]) => {
        if (!lista.length) {
          this.snack.open('No hay seguros funerarios activos. Créalos en la pestaña «Seguros funerarios».',
            'Cerrar', { duration: 5000 });
          return;
        }
        const campos: FieldConfig[] = [
          { name: 'seguro_ids', label: 'Seguros de este centro', type: 'select', multiple: true,
            options: lista.map(s => ({
              value: s.seguro_funerario_id,
              label: `${s.nombre} · ${this.pesos(s.valor)} ${s.periodicidad.toLowerCase()}`,
            })),
            hint: 'Un centro puede tener varios seguros a la vez. El valor lo manda el seguro, '
                + 'no el centro: si hace falta otro precio, es otro seguro.' },
        ];
        const actuales = lista.filter(s => s.asignada).map(s => s.seguro_funerario_id);
        this.abrirDialogo(`Seguros funerarios de ${c.finca}`, campos, { seguro_ids: actuales }, v =>
          this.svc.fijarSegurosDeCentro(c.id, v.seguro_ids ?? []).subscribe({
            next: () => this.ok('Seguros del centro actualizados', () => this.cargarSeguros()),
            error: e => this.error('No se pudieron guardar los seguros', e),
          }));
      },
      error: e => this.error('No se pudieron cargar los seguros del centro', e),
    });
  }

  private camposSeguro(actual?: SeguroFunerario): FieldConfig[] {
    const asignados = actual?.centros_asignados ?? 0;
    return [
      { name: 'nombre', label: 'Nombre del seguro', type: 'text', required: true, maxLength: 160,
        hint: 'Es la clave: dos seguros no pueden llamarse igual.' },
      { name: 'valor', label: 'Valor', type: 'number', required: true, min: 0, prefix: '$',
        hint: asignados
          ? `Cambiarlo lo cambia en los ${asignados} centros que tienen este seguro.`
          : 'El mismo valor para todos los centros que se le asignen. Si un grupo necesita '
            + 'otro precio, créale otro seguro.' },
      { name: 'periodicidad', label: 'Periodicidad', type: 'select', required: true,
        options: [{ value: 'QUINCENAL', label: 'Quincenal' }, { value: 'MENSUAL', label: 'Mensual' }] },
      { name: 'descuento_nomina', label: 'Se descuenta por nómina', type: 'checkbox' },
      { name: 'descripcion', label: 'Descripción', type: 'text', maxLength: 400 },
    ];
  }

  // ── Salario mínimo por año ───────────────────────────────────────────────

  cargarSalarioMinimo(): void {
    this.svc.listarSalarioMinimo().subscribe({
      next: r => this.salariosMinimos.set((r ?? []).map(v => ({
        ...v,
        salarioTxt: this.pesos(v.salario_minimo),
        auxilioTxt: this.pesos(v.auxilio_transporte),
      } as SalarioMinimoAnio))),
      error: e => this.error('No se pudo cargar el salario mínimo por año', e),
    });
  }

  nuevoSalarioMinimo(): void {
    const ultimo = this.salariosMinimos()[0];
    const anio = Math.max(new Date().getFullYear(), (ultimo?.anio ?? 0) + 1);
    this.abrirDialogo('Nuevo año', this.camposSalarioMinimo(true), { anio }, v =>
      this.guardarSalarioMinimo(Number(v.anio), v, 'Año agregado'));
  }

  editarSalarioMinimo(v: SalarioMinimoAnio): void {
    this.abrirDialogo(`Salario mínimo ${v.anio}`, this.camposSalarioMinimo(false), v, r =>
      this.guardarSalarioMinimo(v.anio, r, 'Año actualizado'));
  }

  private guardarSalarioMinimo(anio: number, v: any, msg: string): void {
    this.svc.guardarSalarioMinimo(anio, {
      salario_minimo: Number(v.salario_minimo),
      auxilio_transporte: Number(v.auxilio_transporte),
      observacion: v.observacion ?? null,
    }).subscribe({
      next: () => this.ok(msg, () => this.cargarSalarioMinimo()),
      error: e => this.error('No se pudo guardar el salario mínimo', e),
    });
  }

  private camposSalarioMinimo(nuevo: boolean): FieldConfig[] {
    return [
      { name: 'anio', label: 'Año', type: 'number', required: true, min: 2000, max: 2100, disabled: !nuevo,
        hint: 'Año de creación del contrato al que aplica.' },
      { name: 'salario_minimo', label: 'Salario mínimo', type: 'number', required: true, min: 1, prefix: '$',
        hint: 'Es el salario que imprimen los documentos de los contratos creados ese año.' },
      { name: 'auxilio_transporte', label: 'Auxilio de transporte', type: 'number', required: true, min: 0, prefix: '$' },
      { name: 'observacion', label: 'Observación', type: 'text', maxLength: 200 },
    ];
  }

  /** Formato de pesos para las columnas derivadas y las etiquetas de los desplegables. */
  private pesos(v: number | null | undefined): string {
    if (v == null) return 'Sin valor';
    return '$' + Number(v).toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }

  // ── Documentos de contratación ───────────────────────────────────────────
  //
  // Qué documentos lleva cada empresa usuaria, a qué destinos, en qué forma y cuántas
  // copias. Es la ÚLTIMA pestaña a propósito: `cadena` cablea los índices de las demás.
  //
  // La matriz se edita EN LOCAL (`filasDocs`) y solo llega al backend con «Guardar
  // cambios», que es un reemplazo exacto y transaccional. «Sucio» no es una bandera que se
  // enciende al tocar: se compara lo que se mandaría con lo que devolvió el backend, así
  // que deshacer a mano un cambio deja la pantalla limpia otra vez.

  /** Apoyo Laboral: la temporal que tiene perfiles documentales hoy. */
  private static readonly TEMPORAL_DOCS_DEFECTO = 1;

  /** Columnas de la matriz, en el orden del enumerado del backend. */
  readonly destinosDoc: readonly DestinoColumna[] = [
    { codigo: 'ARCHIVO_TEMPORAL', etiqueta: 'Archivo temporal', admiteDigital: false },
    { codigo: 'ESCANER_USUARIA', etiqueta: 'Escáner usuaria (digital)', admiteDigital: true },
    { codigo: 'TRABAJADOR_FINCA', etiqueta: 'Trabajador (finca)', admiteDigital: false },
    { codigo: 'TRABAJADOR', etiqueta: 'Trabajador', admiteDigital: false },
  ];

  /** Los destinos que producen papel: los que desglosan las copias físicas. */
  readonly destinosFisicos = this.destinosDoc.filter(d => !d.admiteDigital);

  readonly naturalezaTxt: Record<NaturalezaDocumento, string> = {
    GENERADO: 'Generado',
    DILIGENCIADO_MANUAL: 'Diligenciado a mano',
    SOPORTE_CARGADO: 'Soporte cargado',
    CONSULTA: 'Consulta',
  };

  readonly etapaTxt: Record<EtapaDocumento, string> = {
    SELECCION: 'Selección',
    CONTRATACION: 'Contratación',
    AFILIACION: 'Afiliación',
    INGRESO: 'Ingreso',
  };

  readonly condicionTxt: Record<CondicionDocumento, string> = {
    NINGUNA: 'Siempre',
    CARGO_CRITICO: 'Cargo crítico',
    SEGUN_CARGO: 'Según cargo',
    OMITIBLE_TEMPORADA: 'Omitible en temporada',
  };

  /** Qué hace cada posición del interruptor. Se repite en el tooltip y en la confirmación. */
  readonly modoDocsTxt: Record<ModoDocumentos, string> = {
    OFF: 'contratación usa los perfiles por expresión regular de siempre; la parametrización no interviene.',
    SOMBRA: 'contratación sigue con los perfiles de siempre, pero consulta la parametrización, compara y registra las diferencias.',
    ON: 'contratación usa SOLO la parametrización; una empresa sin documentos parametrizados da error.',
  };

  temporalDocs = signal<number>(ParametrizacionVacantesComponent.TEMPORAL_DOCS_DEFECTO);
  /** null = todavía no se sabe (o no se pudo leer): el interruptor queda deshabilitado. */
  modoDocs = signal<ModoDocumentos | null>(null);
  cambiandoModoDocs = signal(false);

  empresasDocs = signal<EmpresaDocumentosResumen[]>([]);
  cargandoEmpresasDocs = signal(false);
  /** `empresa_vacante_id` de la empresa abierta en el detalle. */
  empresaDocsSel = signal<number | null>(null);
  /** Lo último que devolvió el backend para la empresa abierta. Es la referencia de «sucio». */
  detalleDocs = signal<EmpresaDocumentos | null>(null);
  cargandoDetalleDocs = signal(false);
  guardandoDocs = signal(false);
  /** Edición local de la matriz. */
  filasDocs = signal<FilaDocumento[]>([]);

  tiposDocs = signal<TipoDocumental[]>([]);

  @ViewChild('detalleDocsRef', { read: ElementRef }) detalleDocsRef?: ElementRef<HTMLElement>;

  readonly colEmpresasDocs: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '90px', filterable: false },
    { name: 'empresaTxt', header: 'Empresa', type: 'text', filterable: true, stickyStart: true, width: '50%' },
    { name: 'documentos', header: 'Documentos', type: 'text', width: '130px' },
    { name: 'estadoTxt', header: 'Estado', type: 'status',
      statusConfig: {
        'Sin parametrizar': { color: 'var(--warn-fg)', background: 'var(--warn-bg)' },
        'Excluida de vacantes': { color: 'var(--warn-fg)', background: 'var(--warn-bg)' },
      } },
  ];

  readonly colTiposDocs: ColumnDefinition[] = [
    { name: 'actions', header: 'Acciones', type: 'custom', stickyStart: true, width: '128px', filterable: false },
    { name: 'codigo', header: 'Código', type: 'text', filterable: true, stickyStart: true, width: '210px' },
    { name: 'nombre', header: 'Nombre', type: 'text', filterable: true, width: '26%' },
    { name: 'naturalezaTxt', header: 'Naturaleza', type: 'text', filterable: true },
    { name: 'plantillaTxt', header: 'Plantilla', type: 'text', filterable: true },
    { name: 'etapaTxt', header: 'Etapa', type: 'text', filterable: true },
    { name: 'vigenciaTxt', header: 'Vigencia', type: 'text', width: '120px' },
    { name: 'condicionTxt', header: 'Condición', type: 'text', filterable: true },
    { name: 'asignadasTxt', header: 'Empresas asignadas', type: 'text', width: '160px' },
    { name: 'activo', header: 'Activo', type: 'status',
      statusConfig: { false: { color: 'var(--warn-fg)', background: 'var(--warn-bg)' } } },
  ];

  /** Solo las que siguen en el alcance: una excluida sin documentos no es un pendiente. */
  empresasDocsSinParametrizar = computed(() =>
    this.empresasDocs().filter(e => e.sin_parametrizacion && e.activo !== false));

  nombreEmpresaDocs = computed(() => {
    const id = this.empresaDocsSel();
    if (id == null) return '';
    return this.empresasDocs().find(e => e.empresa_vacante_id === id)?.empresaTxt
      ?? this.detalleDocs()?.nombre_excel ?? `Empresa #${id}`;
  });

  /** Mismo orden que el backend: orden de archivo (vacíos al final) y luego código. */
  filasDocsOrdenadas = computed(() => [...this.filasDocs()].sort((a, b) => this.compararFilasDocs(a, b)));

  private firmaDocsOriginal = computed(() => {
    const d = this.detalleDocs();
    return d ? this.firmaDocs(this.aFilasDocs(d.documentos ?? [])) : '';
  });

  docsSucio = computed(() => !!this.detalleDocs() && this.firmaDocs(this.filasDocs()) !== this.firmaDocsOriginal());

  /**
   * Totales de lo que hay EN PANTALLA, no de lo guardado: se recalculan mientras se edita.
   * Físicas = copias en forma distinta de DIGITAL; digitales = copias en DIGITAL. Una celda
   * con las copias vacías cuenta 1, que es lo que guarda el backend.
   */
  totalesDocs = computed(() => {
    const porDestino: Record<DestinoDocumento, number> =
      { ARCHIVO_TEMPORAL: 0, ESCANER_USUARIA: 0, TRABAJADOR_FINCA: 0, TRABAJADOR: 0 };
    let fisicas = 0;
    let digitales = 0;
    const filas = this.filasDocs();
    for (const f of filas) {
      for (const col of this.destinosDoc) {
        const c = f.destinos[col.codigo];
        if (!c.incluido) continue;
        const n = c.copias ?? 1;
        if (c.forma === 'DIGITAL') {
          digitales += n;
        } else {
          fisicas += n;
          porDestino[col.codigo] += n;
        }
      }
    }
    return { documentos: filas.length, fisicas, digitales, porDestino };
  });

  /**
   * Las mismas reglas que valida el backend, para no mandar un guardado que va a rebotar y
   * poder señalar la fila. El backend sigue siendo quien decide.
   */
  erroresDocs = computed(() => {
    const out: { tipoId: number; mensaje: string }[] = [];
    for (const f of this.filasDocsOrdenadas()) {
      const doc = `«${f.tipo.nombre}»`;
      const agregar = (mensaje: string) => out.push({ tipoId: f.tipo.id, mensaje });
      if (f.orden_archivo != null && f.orden_archivo < 1) agregar(`${doc}: el orden de archivo empieza en 1.`);
      if (f.bloque_archivo != null && (f.bloque_archivo < 1 || f.bloque_archivo > 5)) {
        agregar(`${doc}: el bloque de archivo va de 1 a 5.`);
      }
      const incluidos = this.destinosDoc.filter(col => f.destinos[col.codigo].incluido);
      if (!incluidos.length) agregar(`${doc} no tiene destinos: marca al menos uno.`);
      for (const col of incluidos) {
        const c = f.destinos[col.codigo];
        if (c.copias != null && c.copias < 0) agregar(`${doc} · ${col.etiqueta}: las copias no pueden ser negativas.`);
        if (c.forma === 'DIGITAL' && !col.admiteDigital) {
          agregar(`${doc} · ${col.etiqueta}: la forma digital solo aplica al escáner de la usuaria.`);
        }
      }
    }
    return out;
  });

  filasDocsConError = computed(() => new Set(this.erroresDocs().map(e => e.tipoId)));

  /** Tipos activos que la empresa aún no tiene (en la edición local). */
  tiposDocsDisponibles = computed(() => {
    const presentes = new Set(this.filasDocs().map(f => f.tipo.id));
    return this.tiposDocs().filter(t => t.activo !== false && t.id != null && !presentes.has(t.id));
  });

  tiposDocsInactivos = computed(() => this.tiposDocs().filter(t => t.activo === false).length);

  cargarDocumentos(): void {
    this.cargarEmpresasDocs();
    this.cargarModoDocs();
    this.cargarTiposDocs();
    // «Recargar todo» no debe tirar una edición en curso: el detalle solo se refresca limpio.
    if (this.empresaDocsSel() != null && !this.docsSucio()) this.cargarDetalleDocs();
  }

  cargarEmpresasDocs(): void {
    const ref = this.temporalDocs();
    this.cargandoEmpresasDocs.set(true);
    this.svc.resumenDocumentosEmpresas(ref).subscribe({
      next: r => {
        // Llegó tarde: el usuario ya cambió de temporal y la respuesta es de la anterior.
        if (ref !== this.temporalDocs()) return;
        this.empresasDocs.set((r ?? []).map(e => ({
          ...e,
          // Columnas derivadas: la tabla compartida pinta propiedades planas.
          empresaTxt: e.nombre_excel
            ?? this.empresas().find(x => x.id === e.empresa_vacante_id)?.nombre
            ?? `Empresa #${e.empresa_vacante_id}`,
          estadoTxt: e.activo === false ? 'Excluida de vacantes'
            : e.sin_parametrizacion ? 'Sin parametrizar' : 'Parametrizada',
        })));
        this.cargandoEmpresasDocs.set(false);
      },
      error: e => {
        this.cargandoEmpresasDocs.set(false);
        this.error('No se pudieron cargar las empresas de la temporal', e);
      },
    });
  }

  cargarModoDocs(): void {
    const ref = this.temporalDocs();
    this.svc.modoDocumentos(ref).subscribe({
      next: r => { if (ref === this.temporalDocs()) this.modoDocs.set(r?.modo ?? 'OFF'); },
      error: e => {
        if (ref === this.temporalDocs()) this.modoDocs.set(null);
        this.error('No se pudo leer el modo de documentos de la temporal', e);
      },
    });
  }

  cargarTiposDocs(): void {
    // Sin `activo`: esta pantalla administra, así que también ve los inactivos.
    this.svc.listarTiposDocumentales().subscribe({
      next: r => this.tiposDocs.set((r ?? []).map(t => ({
        ...t,
        naturalezaTxt: this.naturalezaTxt[t.naturaleza] ?? t.naturaleza,
        etapaTxt: this.etapaTxt[t.etapa] ?? t.etapa,
        condicionTxt: t.condicion ? (this.condicionTxt[t.condicion] ?? t.condicion) : this.condicionTxt.NINGUNA,
        plantillaTxt: t.plantilla_codigo ?? '—',
        vigenciaTxt: t.vigencia_dias ? `${t.vigencia_dias} días` : 'Sin vigencia',
        asignadasTxt: t.empresas_asignadas ? `${t.empresas_asignadas} empresa(s)` : 'Ninguna',
      } as TipoDocumental))),
      error: e => this.error('No se pudo cargar el catálogo de tipos documentales', e),
    });
  }

  cargarDetalleDocs(desplazar = false): void {
    const id = this.empresaDocsSel();
    if (id == null) {
      this.detalleDocs.set(null);
      this.filasDocs.set([]);
      return;
    }
    this.cargandoDetalleDocs.set(true);
    this.svc.documentosDeEmpresa(id).subscribe({
      next: r => {
        // Llegó tarde: ya se abrió otra empresa.
        if (id !== this.empresaDocsSel()) return;
        this.aplicarDetalleDocs(r);
        this.cargandoDetalleDocs.set(false);
        if (desplazar) this.desplazarADetalleDocs();
      },
      error: e => {
        if (id === this.empresaDocsSel()) this.cargandoDetalleDocs.set(false);
        this.error('No se pudieron cargar los documentos de la empresa', e);
      },
    });
  }

  /** Cambia de temporal. Con cambios sin guardar pide confirmación; si se cancela, el selector vuelve. */
  cambiarTemporalDocs(ref: number, selector: MatSelect): void {
    if (ref == null || ref === this.temporalDocs()) return;
    this.siDescartarDocs(() => {
      this.temporalDocs.set(ref);
      this.empresaDocsSel.set(null);
      this.detalleDocs.set(null);
      this.filasDocs.set([]);
      this.empresasDocs.set([]);
      this.modoDocs.set(null);
      this.cargarEmpresasDocs();
      this.cargarModoDocs();
    }, () => { selector.value = this.temporalDocs(); });
  }

  seleccionarEmpresaDocs(e: EmpresaDocumentosResumen): void {
    if (!e) return;
    if (e.empresa_vacante_id === this.empresaDocsSel()) {
      this.desplazarADetalleDocs();
      return;
    }
    this.siDescartarDocs(() => {
      this.empresaDocsSel.set(e.empresa_vacante_id);
      this.detalleDocs.set(null);
      this.filasDocs.set([]);
      this.cargarDetalleDocs(true);
    });
  }

  cerrarDetalleDocs(): void {
    this.siDescartarDocs(() => {
      this.empresaDocsSel.set(null);
      this.detalleDocs.set(null);
      this.filasDocs.set([]);
    });
  }

  /**
   * Interruptor por temporal. Cambia el flujo REAL de contratación, así que siempre pide
   * confirmación; si se cancela o falla, el grupo de botones vuelve a la posición anterior
   * (el control ya se movió al hacer clic y la señal no cambió, así que no lo haría solo).
   */
  cambiarModoDocs(modo: ModoDocumentos, grupo: MatButtonToggleGroup): void {
    const anterior = this.modoDocs();
    if (!modo || modo === anterior) return;
    const ref = this.temporalDocs();
    const temporal = this.nombreTemporal(ref) ?? `Temporal #${ref}`;
    const sinParametrizar = this.empresasDocsSinParametrizar().length;
    const explicacion = (['OFF', 'SOMBRA', 'ON'] as ModoDocumentos[])
      .map(m => m === modo
        ? `<strong>${m}: ${this.modoDocsTxt[m]}</strong>`
        : `${m}: ${this.modoDocsTxt[m]}`)
      .join('<br>');
    const riesgo = modo === 'ON' && sinParametrizar
      ? `<br><br><strong>${sinParametrizar} empresa(s) de esta temporal no tienen documentos parametrizados</strong>: `
        + 'con ON su contratación dará error.'
      : '';
    this.confirmar(modo === 'ON' ? 'warning' : 'question', `¿Pasar ${temporal} a ${modo}?`,
      explicacion + riesgo, `Pasar a ${modo}`,
      () => {
        this.cambiandoModoDocs.set(true);
        this.svc.fijarModoDocumentos(ref, { modo }).subscribe({
          next: r => {
            this.cambiandoModoDocs.set(false);
            if (ref === this.temporalDocs()) this.modoDocs.set(r?.modo ?? modo);
            this.ok(`Modo de documentos de ${temporal}: ${r?.modo ?? modo}`, () => this.cargarEmpresasDocs());
          },
          error: e => {
            this.cambiandoModoDocs.set(false);
            grupo.value = anterior;
            this.error('No se pudo cambiar el modo de documentos', e);
          },
        });
      },
      () => { grupo.value = anterior; });
  }

  aplicarPerfilDocs(): void {
    const det = this.detalleDocs();
    if (!det) return;
    if (det.temporal_config_ref == null) {
      this.snack.open('La empresa no tiene temporal asignada: asígnasela en «Empresas usuarias» antes de aplicar un perfil.',
        'Cerrar', { duration: 6000 });
      return;
    }
    const nombre = this.nombreEmpresaDocs();
    this.svc.listarPerfilesDocumentales(det.temporal_config_ref).subscribe({
      next: perfiles => {
        if (!perfiles?.length) {
          this.snack.open('La temporal de esta empresa no tiene perfiles documentales.', 'Cerrar', { duration: 5000 });
          return;
        }
        const campos: FieldConfig[] = [
          { name: 'perfil', label: 'Perfil', type: 'select', required: true,
            options: perfiles.map(p => ({
              value: p.codigo,
              label: `${p.nombre} (${p.codigo}) · ${p.documentos} documentos`
                + (p.version_listado ? ` · listado ${p.version_listado}` : ''),
            })),
            hint: 'Sustituye POR COMPLETO los documentos actuales de la empresa.' },
        ];
        this.abrirDialogo(`Aplicar perfil a ${nombre}`, campos, {}, v => {
          const perfil = perfiles.find(p => p.codigo === v.perfil);
          if (!perfil) return;
          this.confirmar('warning', '¿Aplicar el perfil?',
            `Los <strong>${det.documentos.length}</strong> documento(s) actuales de `
            + `<strong>${this.html(nombre)}</strong> se sustituyen por los <strong>${perfil.documentos}</strong> `
            + `del perfil <strong>${this.html(perfil.nombre)}</strong>.`
            + (this.docsSucio() ? '<br>Los cambios sin guardar también se pierden.' : ''),
            'Aplicar perfil',
            () => this.svc.aplicarPerfilDocumental(det.empresa_vacante_id, perfil.codigo).subscribe({
              next: r => this.docsReemplazados(r, `Perfil ${perfil.codigo} aplicado`),
              error: e => this.error('No se pudo aplicar el perfil', e),
            }));
        });
      },
      error: e => this.error('No se pudieron cargar los perfiles documentales', e),
    });
  }

  /** El backend solo copia entre empresas de la misma temporal; se ofrecen solo esas, y con documentos. */
  copiarDocsDesde(): void {
    const det = this.detalleDocs();
    if (!det) return;
    const candidatas = det.temporal_config_ref == null ? [] : this.empresasDocs().filter(e =>
      e.empresa_vacante_id !== det.empresa_vacante_id
      && e.temporal_config_ref === det.temporal_config_ref
      && e.documentos > 0);
    if (!candidatas.length) {
      this.snack.open('No hay otra empresa de la misma temporal con documentos parametrizados.',
        'Cerrar', { duration: 5000 });
      return;
    }
    const nombre = this.nombreEmpresaDocs();
    const campos: FieldConfig[] = [
      { name: 'origen', label: 'Copiar desde', type: 'select', required: true,
        options: candidatas.map(e => ({ value: e.empresa_vacante_id, label: `${e.empresaTxt} · ${e.documentos} documentos` })),
        hint: 'Empresas de la misma temporal con documentos. Sustituye POR COMPLETO los de esta empresa.' },
    ];
    this.abrirDialogo(`Copiar documentos a ${nombre}`, campos, {}, v => {
      const origen = candidatas.find(e => e.empresa_vacante_id === Number(v.origen));
      if (!origen) return;
      this.confirmar('warning', '¿Copiar los documentos?',
        `Los <strong>${det.documentos.length}</strong> documento(s) actuales de `
        + `<strong>${this.html(nombre)}</strong> se sustituyen por los <strong>${origen.documentos}</strong> `
        + `de <strong>${this.html(origen.empresaTxt)}</strong>.`
        + (this.docsSucio() ? '<br>Los cambios sin guardar también se pierden.' : ''),
        'Copiar documentos',
        () => this.svc.copiarDocumentosDesde(det.empresa_vacante_id, origen.empresa_vacante_id).subscribe({
          next: r => this.docsReemplazados(r, `Documentos copiados desde ${origen.empresaTxt}`),
          error: e => this.error('No se pudieron copiar los documentos', e),
        }));
    });
  }

  /**
   * Código de compañía, documento del representante y canal de datos personales: los imprimen
   * las plantillas (el canal, la Autorización de uso de derechos de imagen).
   */
  datosPlantillasDocs(): void {
    const det = this.detalleDocs();
    if (!det) return;
    const campos: FieldConfig[] = [
      { name: 'codigo_compania', label: 'Código de compañía', type: 'text', maxLength: 10,
        hint: 'Lo imprimen las plantillas de contratación. Vacíalo para borrarlo.' },
      { name: 'representante_legal_documento', label: 'Documento del representante legal', type: 'text', maxLength: 40,
        hint: 'De la empresa usuaria. El nombre del representante se edita en «Empresas usuarias».' },
      { name: 'correo_datos_personales', label: 'Correo de protección de datos personales', type: 'text', maxLength: 160,
        pattern: /^\s*([^\s@]+@[^\s@.]+(\.[^\s@.]+)+)?\s*$/,
        hint: 'Canal de atención al titular de la empresa usuaria (Autorización de derechos de imagen). Sin dato sale en blanco.' },
      { name: 'telefono_datos_personales', label: 'Teléfono de protección de datos personales', type: 'text', maxLength: 40,
        hint: 'Canal de atención al titular de la empresa usuaria.' },
    ];
    this.abrirDialogo(`Datos para plantillas · ${this.nombreEmpresaDocs()}`, campos,
      {
        codigo_compania: det.codigo_compania, representante_legal_documento: det.representante_legal_documento,
        correo_datos_personales: det.correo_datos_personales, telefono_datos_personales: det.telefono_datos_personales,
      },
      v => this.svc.actualizarDatosDocumentales(det.empresa_vacante_id, {
        // El diálogo devuelve null en lo que nunca tuvo valor (= no tocar) y '' en lo que se
        // vació (= borrar): es justo la semántica del backend.
        codigo_compania: typeof v.codigo_compania === 'string' ? v.codigo_compania.trim() : null,
        representante_legal_documento: typeof v.representante_legal_documento === 'string'
          ? v.representante_legal_documento.trim() : null,
        correo_datos_personales: typeof v.correo_datos_personales === 'string' ? v.correo_datos_personales.trim() : null,
        telefono_datos_personales: typeof v.telefono_datos_personales === 'string' ? v.telefono_datos_personales.trim() : null,
      }).subscribe({
        next: r => {
          if (r?.empresa_vacante_id === this.empresaDocsSel()) {
            // La respuesta trae también los documentos del SERVIDOR: con una edición en curso
            // solo se toman los datos, para no pisar la matriz sin guardar.
            if (this.docsSucio()) this.detalleDocs.set(r);
            else this.aplicarDetalleDocs(r);
          }
          this.ok('Datos para plantillas guardados', () => undefined);
        },
        error: e => this.error('No se pudieron guardar los datos para plantillas', e),
      }));
  }

  /** Agrega una fila LOCAL. Se guarda con «Guardar cambios». */
  agregarDocumento(): void {
    if (!this.detalleDocs()) return;
    const disponibles = this.tiposDocsDisponibles();
    if (!disponibles.length) {
      this.snack.open(this.tiposDocs().length
        ? 'La empresa ya tiene todos los tipos documentales activos.'
        : 'El catálogo de tipos documentales está vacío o no se pudo cargar.', 'Cerrar', { duration: 5000 });
      return;
    }
    const campos: FieldConfig[] = [
      { name: 'tipo_documental_id', label: 'Documento', type: 'select', required: true,
        options: disponibles.map(t => ({ value: t.id!, label: `${t.nombre} (${t.codigo})` })),
        hint: 'Solo tipos activos que la empresa aún no tiene.' },
      { name: 'destinos', label: 'Destinos', type: 'select', multiple: true, required: true,
        options: this.destinosDoc.map(d => ({ value: d.codigo, label: d.etiqueta })),
        hint: 'A dónde va. La forma y las copias se ajustan después en la matriz.' },
      { name: 'obligatorio', label: 'Obligatorio', type: 'checkbox' },
    ];
    this.abrirDialogo('Agregar documento', campos, { destinos: ['ARCHIVO_TEMPORAL'], obligatorio: true }, v => {
      const tipo = disponibles.find(t => t.id === Number(v.tipo_documental_id));
      if (!tipo || tipo.id == null) return;
      const elegidos = new Set<string>(v.destinos ?? []);
      const destinos = {} as Record<DestinoDocumento, CeldaDestino>;
      for (const col of this.destinosDoc) {
        destinos[col.codigo] = { ...this.celdaVaciaDoc(col), incluido: elegidos.has(col.codigo) };
      }
      // Al final del archivo: el siguiente orden libre.
      const siguienteOrden = this.filasDocs().reduce((max, f) => Math.max(max, f.orden_archivo ?? 0), 0) + 1;
      const fila: FilaDocumento = {
        tipo: {
          id: tipo.id, codigo: tipo.codigo, nombre: tipo.nombre, naturaleza: tipo.naturaleza,
          plantilla_codigo: tipo.plantilla_codigo ?? null, etapa: tipo.etapa,
          vigencia_dias: tipo.vigencia_dias ?? null, condicion: tipo.condicion ?? null,
          observacion: tipo.observacion ?? null, tipo_documento_ref: tipo.tipo_documento_ref ?? null,
        },
        obligatorio: !!v.obligatorio,
        orden_archivo: siguienteOrden,
        bloque_archivo: null,
        version_listado: null,
        destinos,
      };
      this.filasDocs.update(filas => [...filas, fila]);
      this.snack.open(`«${tipo.nombre}» agregado. Se guarda con «Guardar cambios».`, 'OK', { duration: 3000 });
    });
  }

  quitarDocumento(f: FilaDocumento): void {
    this.filasDocs.update(filas => filas.filter(x => x.tipo.id !== f.tipo.id));
  }

  descartarDocs(): void {
    const det = this.detalleDocs();
    if (det) this.filasDocs.set(this.aFilasDocs(det.documentos ?? []));
  }

  guardarDocs(): void {
    const det = this.detalleDocs();
    if (!det || !this.docsSucio() || this.guardandoDocs()) return;
    const errores = this.erroresDocs();
    if (errores.length) {
      this.snack.open(errores[0].mensaje, 'Cerrar', { duration: 6000 });
      return;
    }
    const id = det.empresa_vacante_id;
    this.guardandoDocs.set(true);
    this.svc.fijarDocumentosDeEmpresa(id, this.aPeticionDocs(this.filasDocs())).subscribe({
      next: r => {
        this.guardandoDocs.set(false);
        if (id === this.empresaDocsSel()) this.aplicarDetalleDocs(r);
        this.ok('Documentos de la empresa guardados', () => this.recargarTrasCambioDocs());
      },
      error: e => {
        this.guardandoDocs.set(false);
        this.error('No se pudieron guardar los documentos', e);
      },
    });
  }

  // Edición de celdas. Siempre objetos nuevos: la señal solo avisa si cambia la referencia.

  cambiarObligatorioDoc(f: FilaDocumento, obligatorio: boolean): void {
    this.editarFilaDoc(f.tipo.id, x => ({ ...x, obligatorio }));
  }

  cambiarNumeroDoc(f: FilaDocumento, campo: 'orden_archivo' | 'bloque_archivo', raw: unknown): void {
    const valor = this.enteroDoc(raw);
    this.editarFilaDoc(f.tipo.id, x =>
      campo === 'orden_archivo' ? { ...x, orden_archivo: valor } : { ...x, bloque_archivo: valor });
  }

  alternarDestinoDoc(f: FilaDocumento, destino: DestinoDocumento, incluido: boolean): void {
    this.editarFilaDoc(f.tipo.id, x => this.conCeldaDoc(x, destino, { ...x.destinos[destino], incluido }));
  }

  cambiarFormaDoc(f: FilaDocumento, destino: DestinoDocumento, forma: FormaDocumento): void {
    this.editarFilaDoc(f.tipo.id, x => this.conCeldaDoc(x, destino, { ...x.destinos[destino], forma }));
  }

  cambiarNumeroDestinoDoc(f: FilaDocumento, destino: DestinoDocumento, campo: 'copias' | 'orden', raw: unknown): void {
    const valor = this.enteroDoc(raw);
    this.editarFilaDoc(f.tipo.id, x => this.conCeldaDoc(x, destino,
      campo === 'copias' ? { ...x.destinos[destino], copias: valor } : { ...x.destinos[destino], orden: valor }));
  }

  // ── Catálogo de tipos documentales ──

  /** @param inicial lo ya escrito, para reabrir el diálogo sin perderlo si falta la plantilla. */
  nuevoTipoDoc(inicial: any = { condicion: 'NINGUNA' }): void {
    this.abrirDialogo('Nuevo tipo documental', this.camposTipoDoc(true), inicial, v => {
      if (!this.plantillaSiGeneradoDoc(v)) { this.nuevoTipoDoc(v); return; }
      this.svc.crearTipoDocumental(this.limpiarTipoDoc(v, true)).subscribe({
        next: () => this.ok('Tipo documental creado', () => this.cargarTiposDocs()),
        error: e => this.error('No se pudo crear el tipo documental', e),
      });
    });
  }

  editarTipoDoc(t: TipoDocumental, valor?: any): void {
    this.abrirDialogo(`Editar «${t.nombre}»`, this.camposTipoDoc(false), valor ?? t, v => {
      if (!this.plantillaSiGeneradoDoc(v)) { this.editarTipoDoc(t, v); return; }
      this.svc.actualizarTipoDocumental(t.id!, this.limpiarTipoDoc(v, false)).subscribe({
        next: () => this.ok('Tipo documental actualizado', () => {
          this.cargarTiposDocs();
          // El detalle pinta nombre, chips y observación del tipo.
          if (this.empresaDocsSel() != null && !this.docsSucio()) this.cargarDetalleDocs();
        }),
        error: e => this.error('No se pudo actualizar el tipo documental', e),
      });
    });
  }

  /** El backend rechaza (EN_USO) desactivar un tipo que lleva alguna empresa. */
  toggleTipoDoc(t: TipoDocumental): void {
    this.svc.estadoTipoDocumental(t.id!, !t.activo).subscribe({
      next: () => this.ok(t.activo ? 'Tipo documental desactivado' : 'Tipo documental activado',
        () => this.cargarTiposDocs()),
      error: e => {
        this.error('No se pudo cambiar el estado', e);
        // El interruptor ya se movió en pantalla: recargar lo devuelve a la verdad.
        this.cargarTiposDocs();
      },
    });
  }

  private camposTipoDoc(creando: boolean): FieldConfig[] {
    const opciones = <T extends string>(txt: Record<T, string>) =>
      (Object.keys(txt) as T[]).map(k => ({ value: k, label: txt[k] }));
    return [
      ...(creando ? [
        { name: 'codigo', label: 'Código', type: 'text', required: true, maxLength: 60,
          pattern: /^[A-Za-z0-9_]{2,60}$/,
          parse: (x: any) => (typeof x === 'string' ? x.trim().toUpperCase() : x),
          hint: 'MAYÚSCULAS, dígitos y guion bajo. Lo comparten gestión documental y plantillas: no se cambia después.' },
      ] as FieldConfig[] : []),
      { name: 'nombre', label: 'Nombre', type: 'text', required: true, maxLength: 200 },
      { name: 'nombre_listado', label: 'Nombre en el listado', type: 'text', maxLength: 300,
        hint: 'Como aparece en el listado de documentos de la temporal, si es distinto.' },
      { name: 'naturaleza', label: 'Naturaleza', type: 'select', required: true, options: opciones(this.naturalezaTxt) },
      { name: 'plantilla_codigo', label: 'Código de plantilla', type: 'text', maxLength: 80,
        hint: 'Obligatorio si la naturaleza es «Generado».' },
      { name: 'etapa', label: 'Etapa', type: 'select', required: true, options: opciones(this.etapaTxt) },
      { name: 'vigencia_dias', label: 'Vigencia (días)', type: 'number', min: 1,
        hint: creando ? 'Vacío = sin vigencia.'
                      : 'Vacío = sin vigencia. Una vigencia ya guardada no se puede vaciar desde aquí.' },
      { name: 'condicion', label: 'Condición', type: 'select', options: opciones(this.condicionTxt),
        hint: 'Cuándo puede no aplicar a un trabajador concreto.' },
      { name: 'observacion', label: 'Observación', type: 'textarea', maxLength: 500 },
    ];
  }

  private plantillaSiGeneradoDoc(v: any): boolean {
    if (v?.naturaleza !== 'GENERADO') return true;
    if (typeof v.plantilla_codigo === 'string' && v.plantilla_codigo.trim()) return true;
    this.snack.open('Un documento «Generado» necesita código de plantilla: sin plantilla no hay nada que generar.',
      'Cerrar', { duration: 6000 });
    return false;
  }

  /**
   * En la edición el backend lee null como «no tocar» y '' como «borrar». El diálogo ya
   * devuelve null en lo que nunca tuvo valor y '' en lo que se vació, así que basta con
   * recortar sin convertir '' en null.
   */
  private limpiarTipoDoc(v: any, creando: boolean): TipoDocumentalRequest {
    const txt = (x: any): string | null => (typeof x === 'string' ? x.trim() : null);
    const vig = v?.vigencia_dias;
    const body: TipoDocumentalRequest = {
      nombre: (v.nombre ?? '').trim(),
      nombre_listado: txt(v.nombre_listado),
      naturaleza: v.naturaleza,
      plantilla_codigo: txt(v.plantilla_codigo),
      etapa: v.etapa,
      condicion: v.condicion || 'NINGUNA',
      vigencia_dias: vig === '' || vig == null || !Number.isFinite(Number(vig)) ? null : Math.trunc(Number(vig)),
      observacion: txt(v.observacion),
    };
    if (creando) body.codigo = (v.codigo ?? '').trim().toUpperCase();
    return body;
  }

  // ── plumbing de documentos ──

  private aplicarDetalleDocs(r: EmpresaDocumentos): void {
    this.detalleDocs.set(r);
    this.filasDocs.set(this.aFilasDocs(r?.documentos ?? []));
  }

  /** Perfil aplicado o copia: el servidor sustituyó todo y la respuesta es la verdad. */
  private docsReemplazados(r: EmpresaDocumentos, mensaje: string): void {
    if (r?.empresa_vacante_id === this.empresaDocsSel()) this.aplicarDetalleDocs(r);
    this.ok(mensaje, () => this.recargarTrasCambioDocs());
  }

  /** Cambió qué documentos lleva una empresa: su conteo y las «empresas asignadas» del catálogo. */
  private recargarTrasCambioDocs(): void {
    this.cargarEmpresasDocs();
    this.cargarTiposDocs();
  }

  private siDescartarDocs(accion: () => void, alCancelar?: () => void): void {
    if (!this.docsSucio()) { accion(); return; }
    this.confirmar('warning', 'Hay cambios sin guardar',
      `Los cambios en los documentos de <strong>${this.html(this.nombreEmpresaDocs())}</strong> se perderán.`,
      'Descartar cambios', accion, alCancelar);
  }

  /** Sin zona no hay un «después de pintar» al que engancharse: se espera a que el @if monte el detalle. */
  private desplazarADetalleDocs(): void {
    setTimeout(() => this.detalleDocsRef?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  private aFilasDocs(docs: DocumentoEmpresa[]): FilaDocumento[] {
    return docs.map(d => {
      const destinos = {} as Record<DestinoDocumento, CeldaDestino>;
      for (const col of this.destinosDoc) {
        const x = (d.destinos ?? []).find(y => y.destino === col.codigo);
        destinos[col.codigo] = x
          ? { incluido: true, forma: x.forma, copias: x.copias ?? 1, orden: x.orden ?? null }
          : this.celdaVaciaDoc(col);
      }
      return {
        tipo: d.tipo,
        obligatorio: d.obligatorio !== false,
        orden_archivo: d.orden_archivo ?? null,
        bloque_archivo: d.bloque_archivo ?? null,
        version_listado: d.version_listado ?? null,
        destinos,
      };
    });
  }

  /** Un destino sin marcar. Si se marca, arranca en DIGITAL en el escáner y en ORIGINAL en los demás. */
  private celdaVaciaDoc(col: DestinoColumna): CeldaDestino {
    return { incluido: false, forma: col.admiteDigital ? 'DIGITAL' : 'ORIGINAL', copias: 1, orden: null };
  }

  /** Lo que viaja en el PUT. Ordenado por tipo para que sirva también de firma de «sucio». */
  private aPeticionDocs(filas: FilaDocumento[]): DocumentoEmpresaRequest[] {
    return [...filas]
      .sort((a, b) => a.tipo.id - b.tipo.id)
      .map(f => ({
        tipo_documental_id: f.tipo.id,
        obligatorio: f.obligatorio,
        orden_archivo: f.orden_archivo,
        bloque_archivo: f.bloque_archivo,
        version_listado: f.version_listado,
        destinos: this.destinosDoc
          .filter(col => f.destinos[col.codigo].incluido)
          .map(col => {
            const c = f.destinos[col.codigo];
            return { destino: col.codigo, forma: c.forma, copias: c.copias, orden: c.orden };
          }),
      }));
  }

  private firmaDocs(filas: FilaDocumento[]): string {
    return JSON.stringify(this.aPeticionDocs(filas));
  }

  /** Mismo criterio que `DocumentosMapper.ORDEN_DOCUMENTOS` del backend. */
  private compararFilasDocs(a: FilaDocumento, b: FilaDocumento): number {
    const oa = a.orden_archivo ?? Number.MAX_SAFE_INTEGER;
    const ob = b.orden_archivo ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a.tipo.codigo < b.tipo.codigo ? -1 : a.tipo.codigo > b.tipo.codigo ? 1 : 0;
  }

  private editarFilaDoc(tipoId: number, cambio: (f: FilaDocumento) => FilaDocumento): void {
    this.filasDocs.update(filas => filas.map(f => (f.tipo.id === tipoId ? cambio(f) : f)));
  }

  private conCeldaDoc(f: FilaDocumento, destino: DestinoDocumento, celda: CeldaDestino): FilaDocumento {
    return { ...f, destinos: { ...f.destinos, [destino]: celda } };
  }

  /** Vacío = null; lo demás, entero. Un negativo se conserva para que la validación lo señale. */
  private enteroDoc(raw: unknown): number | null {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const n = Number(String(raw).replace(',', '.'));
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }

  // ── Calendarios de pago ──────────────────────────────────────────────────

  cargarCalendariosPago(): void {
    // Sin `activo`: esta pantalla administra, así que también ve los retirados.
    this.svc.listarCalendariosPago().subscribe({
      next: r => this.calendarios.set((r ?? []).map(c => ({
        ...c,
        // Columnas derivadas: la tabla compartida pinta propiedades planas.
        tipoTxt: c.tipo === 'RECURRENTE_MENSUAL' ? 'Recurrente mensual' : 'Fechas específicas',
        cuandoTxt: c.tipo === 'RECURRENTE_MENSUAL'
          ? `Días ${c.dia_pago_1 ?? '—'} y ${c.dia_pago_2 ?? '—'} de cada mes`
          : `${(c.fechas ?? []).length} fecha(s) · última: ${c.ultima_fecha ?? '—'}`,
        centrosTxt: c.centros_asignados
          ? `${c.centros_asignados} grupo(s) de centro`
          : 'Sin usar todavía',
      } as CalendarioPago))),
      error: e => this.error('No se pudieron cargar los calendarios de pago', e),
    });
  }

  alternarCalendariosInactivos(ver: boolean): void {
    this.verCalendariosInactivos.set(ver);
  }

  nuevoCalendarioPago(): void { this.abrirCalendarioPago(null); }

  editarCalendarioPago(c: CalendarioPago): void { this.abrirCalendarioPago(c); }

  /**
   * Diálogo propio: un calendario de FECHAS_ESPECIFICAS lleva una LISTA de fechas y
   * `DynamicFormDialogComponent` solo pinta campos sueltos.
   */
  private abrirCalendarioPago(c: CalendarioPago | null,
                              opts: { duplicar?: boolean; alGuardar?: (nuevo: CalendarioPago) => void } = {}): void {
    const modo = opts.duplicar ? 'duplicar' : (c ? 'edicion' : 'alta');
    const data: CalendarioPagoDialogData = { calendario: c, modo, enUso: c?.centros_asignados ?? 0 };
    const ref = this.dialog.open(CalendarioPagoDialogComponent, { width: 'min(640px, 95vw)', data });
    ref.afterClosed().subscribe(body => {
      if (!body) return;
      // El PUT es reemplazo completo: el cuerpo del diálogo ya trae solo lo del tipo elegido.
      // Duplicar SIEMPRE crea, aunque el diálogo venga relleno de otro calendario.
      const edita = !!c?.id && !opts.duplicar;
      const peticion = edita
        ? this.svc.actualizarCalendarioPago(c!.id!, body)
        : this.svc.crearCalendarioPago(body);
      peticion.subscribe({
        next: (guardado) => this.ok(edita ? 'Calendario actualizado' : 'Calendario creado', () => {
          this.cargarCalendariosPago();
          this.cargarResumenPago();
          if (!edita && guardado) opts.alGuardar?.(guardado);
        }),
        error: e => this.error('No se pudo guardar el calendario de pago', e),
      });
    });
  }

  // ── Tocar el catálogo SIN salir del centro ───────────────────────────────
  // El dato vive en el catálogo: el calendario tiene las fechas y la política el valor, así que
  // cambiarlos alcanza a todos los centros que los usen.
  //
  // En Centro + PAGO no se editan las fechas a propósito (decisión del usuario, 2026-09-17):
  // desde aquí solo se ELIGE el calendario, y para cambiar sus fechas se va a la pestaña
  // «Calendarios de pago». Queda la copia, que no toca nada existente.
  //
  // En Centro + CASINO vale lo mismo (2026-09-17): el valor se cambia en «Políticas de casino».
  // En las dos pestañas queda solo «Duplicar», que crea un catálogo nuevo y lo deja elegido en
  // esa fila; así un ajuste para UN centro no se lleva por delante a los demás.

  /** Copia ese calendario en uno nuevo y lo deja elegido en la fila (sin guardar todavía). */
  duplicarCalendarioDeFila(f: CentroGrupoPago): void {
    const cal = this.calendarios().find(c => c.id === f.calendario_pago_id);
    if (!cal) return;
    this.abrirCalendarioPago(cal, {
      duplicar: true,
      alGuardar: nuevo => this.cambiarCalendarioDeGrupo(f, nuevo.id ?? null),
    });
  }

  /** Copia esa política en una nueva y la deja elegida en la fila (sin guardar todavía). */
  duplicarPoliticaDeFilaCasino(f: FilaCasinoCentro): void {
    const pol = this.politicasCasino().find(p => p.id === f.politica_casino_id);
    if (!pol) return;
    this.abrirPoliticaCasino(pol, {
      duplicar: true,
      alGuardar: nueva => this.cambiarPoliticaDeFila(f, nueva.id ?? null),
    });
  }

  /** El backend lo rechaza con CALENDARIO_EN_USO si algún grupo de centro lo usa. */
  toggleCalendarioPago(c: CalendarioPago): void {
    this.svc.estadoCalendarioPago(c.id!, !c.activo).subscribe({
      next: () => this.ok(c.activo ? 'Calendario retirado' : 'Calendario activado',
                          () => this.cargarCalendariosPago()),
      error: e => this.error('No se pudo cambiar el estado del calendario', e),
    });
  }

  // ── Políticas de casino ──────────────────────────────────────────────────

  cargarPoliticasCasino(): void {
    this.svc.listarPoliticasCasino().subscribe({
      next: r => this.politicasCasino.set((r ?? []).map(p => ({
        ...p,
        servicioTxt: p.ofrece_servicio ? 'Ofrece casino' : 'No ofrece',
        comidasTxt: (p.comidas ?? []).length
          ? (p.comidas ?? []).map(c => `${this.comidaTxt(c.comida)} ${this.pesos(c.valor)}`).join(' · ')
          : '—',
        usoTxt: this.usoPolitica(p),
      } as PoliticaCasino))),
      error: e => this.error('No se pudieron cargar las políticas de casino', e),
    });
  }

  /** Dónde se está usando la política: es lo que impide retirarla (POLITICA_EN_USO). */
  private usoPolitica(p: PoliticaCasino): string {
    const partes: string[] = [];
    if (p.centros_asignados) partes.push(`${p.centros_asignados} centro(s)`);
    if (p.grupos_por_defecto?.length) partes.push(`defecto de ${p.grupos_por_defecto.join(', ')}`);
    return partes.length ? partes.join(' · ') : 'Sin usar todavía';
  }

  private comidaTxt(c: string): string {
    return c.charAt(0) + c.slice(1).toLowerCase();
  }

  alternarPoliticasInactivas(ver: boolean): void {
    this.verPoliticasInactivas.set(ver);
  }

  nuevaPoliticaCasino(): void { this.abrirPoliticaCasino(null); }

  editarPoliticaCasino(p: PoliticaCasino): void { this.abrirPoliticaCasino(p); }

  /** Diálogo propio: la política lleva la LISTA de comidas con su valor. */
  private abrirPoliticaCasino(p: PoliticaCasino | null,
                              opts: { duplicar?: boolean; alGuardar?: (nueva: PoliticaCasino) => void } = {}): void {
    const modo = opts.duplicar ? 'duplicar' : (p ? 'edicion' : 'alta');
    const data: PoliticaCasinoDialogData = { politica: p, modo, enUso: p?.centros_asignados ?? 0 };
    const ref = this.dialog.open(PoliticaCasinoDialogComponent, { width: 'min(640px, 95vw)', data });
    ref.afterClosed().subscribe(body => {
      if (!body) return;
      // El PUT reemplaza también las comidas: las que no viajen se dan de baja.
      const edita = !!p?.id && !opts.duplicar;
      const peticion = edita
        ? this.svc.actualizarPoliticaCasino(p!.id!, body)
        : this.svc.crearPoliticaCasino(body);
      peticion.subscribe({
        next: (guardada) => this.ok(edita ? 'Política actualizada' : 'Política creada', () => {
          this.cargarPoliticasCasino();
          this.cargarResumenPago();
          if (!edita && guardada) opts.alGuardar?.(guardada);
        }),
        error: e => this.error('No se pudo guardar la política de casino', e),
      });
    });
  }

  /** Rechazada (POLITICA_EN_USO) si la usa un centro o es el casino por defecto de un grupo. */
  togglePoliticaCasino(p: PoliticaCasino): void {
    this.svc.estadoPoliticaCasino(p.id!, !p.activo).subscribe({
      next: () => this.ok(p.activo ? 'Política retirada' : 'Política activada',
                          () => this.cargarPoliticasCasino()),
      error: e => this.error('No se pudo cambiar el estado de la política', e),
    });
  }

  // ── Grupos de pago ───────────────────────────────────────────────────────

  cargarGruposPago(): void {
    this.svc.listarGruposPago().subscribe({
      next: r => this.gruposPago.set((r ?? []).map(g => ({
        ...g,
        casinoTxt: g.politica_casino_codigo ?? 'Sin casino por defecto',
        centrosTxt: g.centros_asignados ? `${g.centros_asignados} centro(s)` : 'Ninguno todavía',
      } as GrupoPago))),
      error: e => this.error('No se pudieron cargar los grupos de pago', e),
    });
  }

  alternarGruposPagoInactivos(ver: boolean): void {
    this.verGruposPagoInactivos.set(ver);
  }

  nuevoGrupoPago(): void {
    this.abrirDialogo('Nuevo grupo de pago', this.camposGrupoPago(), { politica_casino_id: null }, v =>
      this.svc.crearGrupoPago(this.limpiarGrupoPago(v)).subscribe({
        next: () => this.ok('Grupo creado. Ahora asígnalo a los centros que lo usan.',
                            () => this.cargarGruposPago()),
        error: e => this.error('No se pudo crear el grupo de pago', e),
      }));
  }

  editarGrupoPago(g: GrupoPago): void {
    this.abrirDialogo(`Editar grupo ${g.numero}`, this.camposGrupoPago(),
      { ...g, politica_casino_id: g.politica_casino_id ?? null }, v =>
        this.svc.actualizarGrupoPago(g.id!, this.limpiarGrupoPago(v)).subscribe({
          next: () => this.ok('Grupo actualizado',
                              () => { this.cargarGruposPago(); this.cargarResumenPago(); }),
          error: e => this.error('No se pudo actualizar el grupo de pago', e),
        }));
  }

  /** El backend lo rechaza con GRUPO_EN_USO si algún centro lo tiene. */
  toggleGrupoPago(g: GrupoPago): void {
    this.svc.estadoGrupoPago(g.id!, !g.activo).subscribe({
      next: () => this.ok(g.activo ? 'Grupo retirado' : 'Grupo activado',
                          () => this.cargarGruposPago()),
      error: e => this.error('No se pudo cambiar el estado del grupo', e),
    });
  }

  /**
   * El NÚMERO no se pide: lo asigna el backend con el siguiente libre. Es la clave del grupo,
   * no un dato que nadie deba recordar, y pedirlo solo daba pie a dejarlo vacío y llevarse un
   * 400. Al editar tampoco se toca: el grupo ya tiene el suyo y renumerar movería el histórico.
   */
  private camposGrupoPago(): FieldConfig[] {
    return [
      { name: 'nombre', label: 'Nombre', type: 'text', maxLength: 120,
        hint: 'Si lo dejas vacío se llama GRUPO n, con el número que le toque.' },
      { name: 'descripcion', label: 'Descripción', type: 'text', maxLength: 400 },
      { name: 'politica_casino_id', label: 'Casino por defecto', type: 'select',
        options: [
          { value: null, label: 'Sin casino por defecto' },
          ...this.politicasActivas().map(p => ({ value: p.id, label: p.codigo })),
        ],
        hint: 'Un centro con este grupo no puede quedar con otra política: el backend '
            + 'responde CASINO_CONTRADICE_GRUPO.' },
    ];
  }

  /**
   * El diálogo devuelve '' para los vacíos; el backend espera null.
   *
   * `numero` NO viaja: en el alta lo pone el backend y en la edición se conserva el que ya
   * tiene (el PUT solo cambia lo que recibe).
   */
  private limpiarGrupoPago(v: any): Partial<GrupoPago> {
    return {
      nombre: v.nombre || null,
      descripcion: v.descripcion || null,
      politica_casino_id: v.politica_casino_id === '' || v.politica_casino_id == null
        ? null : Number(v.politica_casino_id),
    };
  }

  // ── Centro + Pago ────────────────────────────────────────────────────────

  cambiarCentroPago(id: number | null): void {
    // El filtro encadenado rellena hacia arriba temporal y empresa del centro elegido.
    this.centroPagoSel.set(this.filtrosPago.elegirCentro(id));
    this.cargarCentroPago();
  }

  /** Acotar por temporal o empresa puede soltar el centro elegido: entonces se deja de editar. */
  acotarPago(nivel: 'temporal' | 'empresa', valor: number | null): void {
    if (nivel === 'temporal') this.filtrosPago.elegirTemporal(valor);
    else this.filtrosPago.elegirEmpresa(valor);
    if (this.filtrosPago.centro() !== this.centroPagoSel()) {
      this.centroPagoSel.set(this.filtrosPago.centro());
      this.cargarCentroPago();
    }
  }

  /**
   * Los grupos del centro y si Crear Vacante va a exigir grupo de pago aquí. El GET
   * devuelve TODOS los grupos activos con `asignada`, igual que las áreas del centro.
   */
  cargarCentroPago(): void {
    const id = this.centroPagoSel();
    if (id == null) { this.filasPago.set([]); this.pagoModo.set(null); this.firmaPagoOriginal.set(''); return; }
    this.cargandoCentroPago.set(true);
    forkJoin({
      grupos: this.svc.gruposPagoDeCentro(id),
      // El modo es informativo: si falla no debe tumbar la pantalla.
      modo: this.svc.pagoModoDeCentro(id).pipe(catchError(() => of(null as PagoModoCentro | null))),
    }).subscribe({
      next: r => {
        const filas = (r.grupos ?? []).map(g => ({ ...g }));
        this.filasPago.set(filas);
        this.firmaPagoOriginal.set(this.firmaPago(filas));
        this.pagoModo.set(r.modo);
        this.cargandoCentroPago.set(false);
      },
      error: e => {
        this.cargandoCentroPago.set(false);
        this.error('No se pudieron cargar los grupos de pago del centro', e);
      },
    });
  }

  /**
   * El calendario del catálogo, para pintar su texto y su estado mientras se edita.
   * Es una BÚSQUEDA por id: el texto y el VENCIDO siguen siendo del backend.
   */
  calendarioPorId(id: number | null | undefined): CalendarioPago | null {
    if (id == null) return null;
    return this.calendarios().find(c => c.id === id) ?? null;
  }

  politicaPorId(id: number | null | undefined): PoliticaCasino | null {
    if (id == null) return null;
    return this.politicasCasino().find(p => p.id === id) ?? null;
  }

  alternarGrupoCentro(f: CentroGrupoPago, asignada: boolean): void {
    this.filasPago.set(this.filasPago().map(x => x.grupo_pago_id === f.grupo_pago_id
      ? { ...x, asignada, calendario_pago_id: asignada ? x.calendario_pago_id ?? null : null }
      : x));
  }

  cambiarCalendarioDeGrupo(f: CentroGrupoPago, calendarioId: number | null): void {
    this.filasPago.set(this.filasPago().map(x => x.grupo_pago_id === f.grupo_pago_id
      ? { ...x, calendario_pago_id: calendarioId }
      : x));
  }

  descartarCentroPago(): void { this.cargarCentroPago(); }

  /** Reemplazo EXACTO: los grupos que no viajan se dan de baja en el centro. */
  guardarCentroPago(): void {
    const id = this.centroPagoSel();
    if (id == null || this.gruposSinCalendario().length) return;
    const items = this.filasPago()
      .filter(f => f.asignada && f.calendario_pago_id != null)
      .map(f => ({ grupo_pago_id: f.grupo_pago_id, calendario_pago_id: f.calendario_pago_id! }));
    this.guardandoCentroPago.set(true);
    this.svc.fijarGruposPagoDeCentro(id, items).subscribe({
      next: () => {
        this.guardandoCentroPago.set(false);
        this.ok('Grupos de pago del centro actualizados', () => {
          this.cargarCentroPago();
          this.cargarCalendariosPago();
          this.cargarGruposPago();
          this.cargarResumenPago();
        });
      },
      error: e => {
        this.guardandoCentroPago.set(false);
        this.error('No se pudieron guardar los grupos de pago del centro', e);
      },
    });
  }

  /** Solo lo editable: qué grupos quedan y con qué calendario cada uno. */
  private firmaPago(filas: CentroGrupoPago[]): string {
    return JSON.stringify(filas
      .filter(f => f.asignada)
      .map(f => [f.grupo_pago_id, f.calendario_pago_id ?? null])
      .sort((a, b) => Number(a[0]) - Number(b[0])));
  }

  // ── Centro + Casino ──────────────────────────────────────────────────────

  cambiarCentroCasino(id: number | null): void {
    this.centroCasinoSel.set(this.filtrosCasino.elegirCentro(id));
    this.cargarCentroCasino();
  }

  acotarCasino(nivel: 'temporal' | 'empresa', valor: number | null): void {
    if (nivel === 'temporal') this.filtrosCasino.elegirTemporal(valor);
    else this.filtrosCasino.elegirEmpresa(valor);
    if (this.filtrosCasino.centro() !== this.centroCasinoSel()) {
      this.centroCasinoSel.set(this.filtrosCasino.centro());
      this.cargarCentroCasino();
    }
  }

  /**
   * Se piden las dos cosas: los grupos del centro (para saber a qué se le puede poner
   * casino y cuál trae el suyo por defecto) y las filas ACTIVAS de casino del centro.
   */
  /**
   * Lo que de verdad le aplica a cada grupo, resuelto POR EL BACKEND.
   *
   * La tabla de arriba enseña las EXCEPCIONES guardadas, y eso confunde: un grupo «sin política
   * propia» sí tiene casino, el del centro o el de su grupo. Aquí se guarda el resultado de
   * `resolver-pago-casino` —el mismo que usará Crear Vacante— para poder enseñarlo al lado.
   */
  casinoResuelto = signal<Map<number, ResolucionPagoCasino>>(new Map());
  casinoSinResolver = signal<Map<number, string>>(new Map());

  /** El casino que aplica a un grupo, ya resuelto. */
  resueltoDe(f: FilaCasinoCentro): ResolucionPagoCasino | null {
    return f.grupo_pago_id == null ? null : this.casinoResuelto().get(f.grupo_pago_id) ?? null;
  }

  errorResueltoDe(f: FilaCasinoCentro): string | null {
    return f.grupo_pago_id == null ? null : this.casinoSinResolver().get(f.grupo_pago_id) ?? null;
  }

  /** De dónde sale, en palabras. El enum crudo no le dice nada a nadie. */
  origenResueltoDe(f: FilaCasinoCentro): string | null {
    const r = this.resueltoDe(f);
    return r ? this.origenCasinoTxt[r.casino_origen] ?? r.casino_origen : null;
  }

  /** Pregunta al backend el casino de cada grupo del centro, uno por grupo. */
  private resolverCasinoDeLosGrupos(centroId: number, grupos: number[]): void {
    this.casinoResuelto.set(new Map());
    this.casinoSinResolver.set(new Map());
    for (const grupoPagoId of grupos) {
      this.svc.resolverPagoCasino({ centroId, grupoPagoId }).subscribe({
        next: r => this.casinoResuelto.update(m => new Map(m).set(grupoPagoId, r)),
        // 409 con código estable: el grupo se queda sin casino y hay que verlo aquí.
        error: e => this.casinoSinResolver.update(m =>
          new Map(m).set(grupoPagoId, e?.error?.codigo ?? 'ERROR_RESOLUCION')),
      });
    }
  }

  cargarCentroCasino(): void {
    const id = this.centroCasinoSel();
    if (id == null) { this.filasCasino.set([]); this.firmaCasinoOriginal.set(''); return; }
    this.cargandoCentroCasino.set(true);
    forkJoin({
      grupos: this.svc.gruposPagoDeCentro(id),
      casino: this.svc.casinoDeCentro(id),
    }).subscribe({
      next: r => {
        const actual = new Map<string, number>();
        for (const c of r.casino ?? []) actual.set(this.claveCasino(c.grupo_pago_id), c.politica_casino_id);
        const filas: FilaCasinoCentro[] = [
          {
            grupo_pago_id: null,
            etiqueta: 'Todo el centro',
            politica_defecto_id: null,
            politica_defecto_codigo: null,
            politica_casino_id: actual.get(this.claveCasino(null)) ?? null,
          },
          ...(r.grupos ?? []).filter(g => g.asignada).map(g => ({
            grupo_pago_id: g.grupo_pago_id,
            etiqueta: `Grupo ${g.numero} · ${g.nombre}`,
            politica_defecto_id: g.politica_defecto_id ?? null,
            politica_defecto_codigo: g.politica_defecto_codigo ?? null,
            politica_casino_id: actual.get(this.claveCasino(g.grupo_pago_id)) ?? null,
          })),
        ];
        this.filasCasino.set(filas);
        this.firmaCasinoOriginal.set(this.firmaCasino(filas));
        this.resolverCasinoDeLosGrupos(id, filas.filter(f => f.grupo_pago_id != null).map(f => f.grupo_pago_id!));
        this.cargandoCentroCasino.set(false);
      },
      error: e => {
        this.cargandoCentroCasino.set(false);
        this.error('No se pudo cargar el casino del centro', e);
      },
    });
  }

  cambiarPoliticaDeFila(f: FilaCasinoCentro, politicaId: number | null): void {
    this.filasCasino.set(this.filasCasino().map(x => x.grupo_pago_id === f.grupo_pago_id
      ? { ...x, politica_casino_id: politicaId }
      : x));
  }

  descartarCentroCasino(): void { this.cargarCentroCasino(); }

  /** Reemplazo EXACTO: las filas sin política se dan de baja. */
  guardarCentroCasino(): void {
    const id = this.centroCasinoSel();
    if (id == null || this.casinoContradice().length) return;
    const items = this.filasCasino()
      .filter(f => f.politica_casino_id != null)
      .map(f => ({ grupo_pago_id: f.grupo_pago_id, politica_casino_id: f.politica_casino_id! }));
    this.guardandoCentroCasino.set(true);
    this.svc.fijarCasinoDeCentro(id, items).subscribe({
      next: () => {
        this.guardandoCentroCasino.set(false);
        this.ok('Casino del centro actualizado', () => {
          this.cargarCentroCasino();
          this.cargarPoliticasCasino();
          this.cargarResumenPago();
        });
      },
      error: e => {
        this.guardandoCentroCasino.set(false);
        this.error('No se pudo guardar el casino del centro', e);
      },
    });
  }

  /** `null` (todo el centro) y el id de un grupo tienen que dar claves distintas. */
  private claveCasino(grupoId: number | null): string {
    return grupoId === null ? 'CENTRO' : `G${grupoId}`;
  }

  private firmaCasino(filas: FilaCasinoCentro[]): string {
    return JSON.stringify(filas
      .filter(f => f.politica_casino_id != null)
      .map(f => [this.claveCasino(f.grupo_pago_id), f.politica_casino_id])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  }

  // ── Resumen de pago y casino (sección de la cadena) ──────────────────────

  cargarResumenPago(): void {
    this.cargandoResumenPago.set(true);
    this.svc.resumenPagoCentros().subscribe({
      next: r => { this.resumenPago.set(r ?? []); this.cargandoResumenPago.set(false); },
      error: e => {
        this.cargandoResumenPago.set(false);
        this.error('No se pudo cargar el resumen de pago y casino', e);
      },
    });
  }

  filtrarCadena(nivel: 'temporal' | 'empresa' | 'centro', valor: number | null): void {
    if (nivel === 'temporal') this.filtrosCadena.elegirTemporal(valor);
    else if (nivel === 'empresa') this.filtrosCadena.elegirEmpresa(valor);
    else this.filtrosCadena.elegirCentro(valor);
  }

  limpiarFiltrosCadena(): void { this.filtrosCadena.limpiar(); }

  /** Del resumen a la pestaña que arregla el hueco, con el centro ya seleccionado. */
  irACentroPago(c: ResumenPagoCentro): void {
    this.centroPagoSel.set(c.centro_costo_id);
    this.cargarCentroPago();
    this.cambiarTab(this.TAB_CENTRO_PAGO);
  }

  irACentroCasino(c: ResumenPagoCentro): void {
    this.centroCasinoSel.set(c.centro_costo_id);
    this.cargarCentroCasino();
    this.cambiarTab(this.TAB_CENTRO_CASINO);
  }

  /** Confirmación con MatDialog (no Swal): se apila bien sobre otros diálogos. */
  private confirmar(icono: AvisoIcono, titulo: string, html: string, textoConfirmar: string,
                    alConfirmar: () => void, alCancelar?: () => void): void {
    const data: AvisoDialogData = { icono, titulo, html, textoConfirmar, textoCancelar: 'Cancelar' };
    this.dialog.open(AvisoDialogComponent, { data }).afterClosed().subscribe(ok => {
      if (ok === true) alConfirmar();
      else alCancelar?.();
    });
  }

  /** Escapa texto de datos antes de meterlo en el HTML de la confirmación. */
  private html(texto: string | null | undefined): string {
    return (texto ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  private rango(r: ReglaLabor): string {
    if (r.dia_desde == null && r.dia_hasta == null) return 'mes completo';
    return `${r.dia_desde ?? 1}–${r.dia_hasta ?? 31}`;
  }

  private abrirDialogo(title: string, fields: FieldConfig[], value: any, onSubmit: (v: any) => void): void {
    const ref = this.dialog.open(DynamicFormDialogComponent, {
      width: 'min(640px, 95vw)',
      data: { title, submitText: 'Guardar', fields, value },
    });
    ref.afterClosed().subscribe(v => { if (v) onSubmit(v); });
  }

  private ok(msg: string, recargar: () => void): void {
    this.snack.open(msg, 'OK', { duration: 2500 });
    recargar();
    // Cualquier alta o baja cambia algún conteo de la cadena. Refrescarlo aquí evita que
    // la primera pestaña quede mostrando cifras de antes del cambio.
    this.cargarResumen();
  }

  /** El backend manda {error, codigo}; mostrarlo es lo que evita el "no funciona" a ciegas. */
  private error(fallback: string, e: any): void {
    const detalle = e?.error?.error ?? e?.error?.detail ?? null;
    const codigo = e?.error?.codigo ? ` [${e.error.codigo}]` : '';
    this.snack.open(detalle ? `${detalle}${codigo}` : fallback, 'Cerrar', { duration: 6000 });
  }
}
