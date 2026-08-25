import { ChangeDetectionStrategy, Component, DestroyRef, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, formatCurrency, formatNumber } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

import Swal from 'sweetalert2';
import { saveAs } from 'file-saver';

import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { FieldRendererComponent } from '@/app/shared/components/forms/field-renderer/field-renderer.component';
import { DynamicFormService } from '../../services/dynamic-form.service';
import { SubmissionService } from '../../services/submission.service';
import { MediaOffloadService } from '../../services/media-offload.service';
import {
  AiSummary,
  ApiProblem,
  DocumentRef,
  DynamicField,
  FieldType,
  FieldValue,
  FormDetail,
  FormSection,
  FormStructure,
  LocationValue,
  Submission,
  SubmissionStatus,
  VersionInfo,
  asDocumentRefs,
  isDocumentRef,
} from '../../models/dynamic-forms.models';

/** Columna derivada de la estructura: un campo del formulario pintable en la tabla. */
interface ColumnaEscalar {
  seccion: string;
  nombre: string;
  etiqueta: string;
  tipo: FieldType;
  /** Opciones fijas del campo: alimentan el filtro de tipo lista de la tabla. */
  opciones?: string[];
}

/** Tipos de campo que caben en una celda de tabla sin renderer. */
const TIPOS_ESCALARES: ReadonlySet<FieldType> = new Set<FieldType>([
  'TEXT_SHORT', 'NUMBER', 'CURRENCY', 'DATE', 'SINGLE_CHOICE', 'DROPDOWN',
]);

/** Los dos únicos tipos que no son una pregunta: no tienen valor que tabular. */
const TIPOS_SIN_VALOR: ReadonlySet<FieldType> = new Set<FieldType>(['COMMENT', 'SECTION']);

/**
 * Fila de la tabla estándar: valores PLANOS (lo que ella busca, ordena y filtra)
 * más `_s`, la respuesta original que usan las plantillas de celda y las acciones.
 */
type FilaTabla = Record<string, unknown> & { _s: Submission };

/** Sección de la ficha individual: campos ordenados (sin COMMENT) y sus valores. */
interface SeccionVista {
  sec: FormSection;
  campos: DynamicField[];
  valores: Record<string, FieldValue>;
}

/** Página del backend: ms-forms recorta `size` a 100 (SubmissionService.pageable). */
const TAMANO_PAGINA = 100;
/**
 * Tope de respuestas que se traen a la pantalla. La tabla estándar filtra, ordena y
 * busca EN CLIENTE —que es justo lo que se quiere aquí— y para eso necesita tener las
 * filas; traerlas todas sin límite sería descargar un histórico entero. Pasado el
 * tope se avisa en pantalla y el Excel (que lo arma el backend) sigue siendo completo.
 */
const TOPE_FILAS = 500;
/** Tope de columnas de preguntas: más allá la tabla es ilegible y pesa. */
const TOPE_COLUMNAS = 30;

/**
 * Formularios Dinámicos — Respuestas de UN formulario (ruta :formId/respuestas).
 *
 * Dos maneras de leer lo mismo, en pestañas:
 *  · TABLA      → la tabla estándar de la plataforma (app-standard-filter-table) con
 *                 una columna por pregunta, derivadas de la ESTRUCTURA de la versión
 *                 filtrada; nunca hardcodeadas. De ahí salen gratis el buscador, los
 *                 filtros por columna, el selector de columnas, las plantillas de vista
 *                 y la exportación. Esa tabla filtra en CLIENTE, así que las filas se
 *                 traen por páginas de 100 hasta el tope y se avisa si algo quedó fuera.
 *  · INDIVIDUAL → una respuesta a la vez, pintada campo por campo con
 *                 app-field-renderer en modo readonly (el mismo del detalle): despacha
 *                 por el TIPO REAL, así que una foto se ve como foto y un archivo como
 *                 chip descargable. Para el PDF y la traza completa está el detalle.
 *
 * Los filtros de versión y estado son del SERVIDOR y mandan sobre las dos pestañas.
 */
@Component({
  selector: 'app-form-responses',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, RouterLink,
    MatButtonModule, MatCardModule, MatFormFieldModule,
    MatProgressBarModule, MatProgressSpinnerModule, MatSelectModule, MatSnackBarModule,
    MatTabsModule, MatTooltipModule,
    StandardFilterTable, FieldRendererComponent,
  ],
  templateUrl: './form-responses.component.html',
  styleUrls: ['./form-responses.component.css'],
})
export class FormResponsesComponent implements OnInit {
  /**
   * Id inyectado por el DISPATCHER (form-view-host). Cuando llega, la vista se
   * inicializa con ese id sin mirar la ruta; el setter también reacciona si el host
   * reutiliza el componente y cambia de formulario. Sin input, se lee `formId` de la
   * ruta clásica :formId/respuestas.
   */
  @Input() set formIdInput(id: number | undefined) {
    if (id != null && Number.isFinite(id) && id > 0) {
      this.idPorInput = id;
      this.inicializar(id);
    }
  }
  private idPorInput?: number;

  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private formsSvc = inject(DynamicFormService);
  private submissionsSvc = inject(SubmissionService);
  private media = inject(MediaOffloadService);
  private snack = inject(MatSnackBar);

  // ── Estado de la página ─────────────────────────────────────────────
  formId = signal<number>(0);
  form = signal<FormDetail | null>(null);
  versiones = signal<VersionInfo[]>([]);
  estructura = signal<FormStructure | null>(null);

  /** null = todas las versiones (listByForm sin `version`). */
  versionFiltro = signal<number | null>(null);
  /** '' = todos los estados. */
  estadoFiltro = signal<SubmissionStatus | ''>('');

  filas = signal<Submission[]>([]);
  total = signal(0);

  /** Pestaña visible: 0 = tabla, 1 = individual. */
  pestana = signal(0);
  /** Respuesta abierta en la pestaña individual (id), null = la primera de la lista. */
  seleccionId = signal<number | null>(null);
  /** Estructuras por versión: la ficha se pinta con el esquema CON EL QUE se respondió. */
  private estructuraPorVersion = signal<Record<number, FormStructure>>({});

  /**
   * Respuesta que la URL pide abrir (?registro=), pendiente de que llegue la lista.
   * La pone el buscador inteligente del header al saltar directo a un registro.
   */
  private registroPedido = signal<number | null>(null);

  cargando = signal(false);
  exportando = signal(false);
  /** Generación del resumen IA en vuelo (el texto anterior sigue visible mientras tanto). */
  resumenCargando = signal(false);
  /** id de la respuesta cuyo cambio de estado está en vuelo (deshabilita sus botones). */
  procesandoId = signal<number | null>(null);

  /** Opciones del filtro de estado (etiquetas en español). */
  readonly ESTADOS: ReadonlyArray<{ valor: SubmissionStatus | ''; etiqueta: string }> = [
    { valor: '', etiqueta: 'Todos los estados' },
    { valor: 'SUBMITTED', etiqueta: 'Enviada' },
    { valor: 'APPROVED', etiqueta: 'Aprobada' },
    { valor: 'REJECTED', etiqueta: 'Rechazada' },
    { valor: 'DRAFT', etiqueta: 'Borrador' },
  ];

  /**
   * Una columna por PREGUNTA de la estructura filtrada, en orden de sección y campo.
   * Los hijos de un campo SECTION entran también: en el payload viven PLANOS dentro
   * de la misma sección, así que `payload[seccion][nombre]` los alcanza igual.
   *
   * COMMENT y SECTION quedan fuera (no llevan valor). Se corta en TOPE_COLUMNAS: más
   * allá la tabla deja de ser legible, y el Excel del backend sí las trae todas.
   */
  columnas = computed<ColumnaEscalar[]>(() => {
    const est = this.estructura();
    if (!est) return [];
    const cols: ColumnaEscalar[] = [];
    const secciones = [...est.sections].sort((a, b) => a.order_no - b.order_no);
    for (const sec of secciones) {
      const codigo = sec.code ?? '';
      if (!codigo) continue;
      const campos = [...sec.fields].sort((a, b) => a.order_no - b.order_no);
      for (const campo of campos) {
        for (const c of [campo, ...(campo.children ?? [])]) {
          if (!c.name || TIPOS_SIN_VALOR.has(c.type)) continue;
          if (cols.length >= TOPE_COLUMNAS) return cols;
          cols.push({
            seccion: codigo,
            nombre: c.name,
            etiqueta: c.label,
            tipo: c.type,
            opciones: c.schema?.options?.map(o => o.label),
          });
        }
      }
    }
    return cols;
  });

  /** Quedaron preguntas fuera de la tabla por el tope de columnas. */
  columnasRecortadas = computed(() => this.columnas().length >= TOPE_COLUMNAS);

  /** Las 3 primeras columnas escalares: el renglón de contexto de la lista individual. */
  columnasClave = computed<ColumnaEscalar[]>(() =>
    this.columnas().filter(c => TIPOS_ESCALARES.has(c.tipo)).slice(0, 3));

  /**
   * Definición de columnas para la tabla estándar: las fijas de toda respuesta
   * (id, versión, estado, enviado, usuario) más una por pregunta, con el `type` que
   * corresponde para que la tabla filtre y ordene bien (fechas como fechas, dinero
   * como dinero, y las preguntas de opción única como lista desplegable).
   */
  columnasTabla = computed<ColumnDefinition[]>(() => {
    const fijas: ColumnDefinition[] = [
      { name: 'id', header: 'ID', type: 'number', width: '90px', align: 'center' },
      { name: 'version', header: 'Versión', type: 'text', width: '100px', align: 'center' },
      {
        name: 'estado', header: 'Estado', type: 'status', width: '130px', align: 'center',
        statusConfig: {
          'Enviada': { color: '#1849a9', background: '#eff8ff' },
          'Aprobada': { color: '#067647', background: '#ecfdf3' },
          'Rechazada': { color: '#b42318', background: '#fef3f2' },
          'Borrador': { color: '#475467', background: '#f2f4f7' },
        },
      },
      // Fecha Y hora: saber a qué hora llegó cada respuesta es parte del dato.
      { name: 'enviado', header: 'Enviado', type: 'date', dateFormat: 'dd/MM/yyyy HH:mm', width: '170px', align: 'center' },
      { name: 'usuario', header: 'Usuario', type: 'text', width: '220px' },
    ];
    const preguntas: ColumnDefinition[] = this.columnas().map(col => {
      const base = { name: this.claveColumna(col), header: col.etiqueta, width: '190px' };
      switch (col.tipo) {
        case 'CURRENCY':
          return { ...base, type: 'number' as const, format: 'currency' as const, align: 'right' as const };
        case 'NUMBER':
        case 'RATING':
          return { ...base, type: 'number' as const, align: 'right' as const };
        case 'DATE':
          return { ...base, type: 'date' as const, align: 'center' as const };
        case 'SINGLE_CHOICE':
        case 'DROPDOWN':
          // Con opciones fijas el filtro es una lista; con origen parametrizado no las
          // conocemos aquí (las resuelve el servidor al llenar) y se queda como texto.
          return col.opciones?.length
            ? { ...base, type: 'select' as const, options: col.opciones }
            : { ...base, type: 'text' as const };
        default:
          return { ...base, type: 'text' as const };
      }
    });
    return [
      ...fijas,
      ...preguntas,
      { name: 'actions', header: 'Acciones', type: 'custom', width: '150px', stickyEnd: true, sortable: false, filterable: false },
    ];
  });

  /**
   * Filas planas para la tabla estándar. El nombre de un campo solo es único DENTRO de
   * su sección, así que la clave de columna lleva las dos partes.
   */
  filasTabla = computed<FilaTabla[]>(() => {
    const cols = this.columnas();
    return this.filas().map(fila => {
      const row: FilaTabla = {
        id: fila.id,
        version: fila.version != null ? `v${fila.version}` : '—',
        estado: this.estadoEtiqueta(fila.status),
        enviado: fila.submitted_at ?? fila.created_at ?? null,
        usuario: this.usuarioDe(fila),
        _s: fila,
      };
      for (const col of cols) row[this.claveColumna(col)] = this.valorPlano(fila, col);
      return row;
    });
  });

  /** Hay más respuestas en el servidor de las que caben en pantalla (TOPE_FILAS). */
  truncado = computed(() => this.total() > this.filas().length);

  // ── Pestaña individual ──────────────────────────────────────────────

  /** Respuesta abierta: la seleccionada o, si no hay, la primera de la lista. */
  seleccionada = computed<Submission | null>(() => {
    const lista = this.filas();
    if (lista.length === 0) return null;
    const id = this.seleccionId();
    return lista.find(f => f.id === id) ?? lista[0];
  });

  indiceActual = computed(() => {
    const sel = this.seleccionada();
    return sel ? this.filas().findIndex(f => f.id === sel.id) : -1;
  });

  /**
   * Secciones y valores de la respuesta abierta, con la estructura DE SU VERSIÓN
   * (no la vigente): una respuesta vieja se lee con el esquema con el que se llenó.
   */
  seccionesVista = computed<SeccionVista[]>(() => {
    const sel = this.seleccionada();
    if (!sel) return [];
    const est = this.estructuraDe(sel);
    if (!est) return [];
    const payload = sel.payload ?? {};
    return [...est.sections]
      .sort((a, b) => a.order_no - b.order_no)
      .map(sec => ({
        sec,
        campos: sec.fields.filter(f => f.type !== 'COMMENT').sort((a, b) => a.order_no - b.order_no),
        valores: (payload[sec.code ?? ''] ?? {}) as Record<string, FieldValue>,
      }));
  });

  /** La ficha está esperando la estructura de la versión con que se respondió. */
  fichaCargando = computed(() => {
    const sel = this.seleccionada();
    return !!sel && this.estructuraDe(sel) == null;
  });

  /** URL de descarga de media — el renderer la usa para miniaturas, players y chips. */
  readonly downloadUrlFn = (ref: DocumentRef): string => this.media.downloadUrl(ref);

  valorDe(vm: SeccionVista, f: DynamicField): FieldValue {
    return vm.valores[f.name ?? ''] ?? null;
  }

  /**
   * Clave con la que la tabla estándar recuerda columnas visibles, anchos y plantillas.
   * Va por formulario: las columnas de uno no significan nada en otro.
   */
  claveTabla = computed(() => `df-respuestas-${this.formId()}`);

  /** Clic en una fila de la tabla: abre esa respuesta en la pestaña individual. */
  abrirFicha(row: unknown): void {
    const fila = row as { _s?: Submission } | null;
    const sub = fila?._s;
    if (!sub) return;
    this.seleccionar(sub.id);
    this.pestana.set(1);
  }

  seleccionar(id: number): void {
    this.seleccionId.set(id);
    this.asegurarEstructuraDeSeleccion();
  }

  /** Navegación anterior/siguiente dentro de las respuestas cargadas. */
  mover(paso: -1 | 1): void {
    const lista = this.filas();
    const i = this.indiceActual();
    if (i < 0) return;
    const destino = i + paso;
    if (destino < 0 || destino >= lista.length) return;
    this.seleccionar(lista[destino].id);
  }

  /** Renglón de contexto de la lista: las primeras preguntas escalares. */
  resumenFila(fila: Submission): string {
    const partes = this.columnasClave()
      .map(col => this.valorCelda(fila, col))
      .filter(v => v !== '—');
    return partes.join(' · ');
  }

  /** Estructura con la que se pinta una respuesta: la de SU versión si ya se cargó. */
  private estructuraDe(sub: Submission): FormStructure | null {
    const v = sub.version;
    if (v == null) return this.estructura();
    return this.estructuraPorVersion()[v] ?? (this.estructura()?.version.version === v ? this.estructura() : null);
  }

  /** Pide la estructura de la versión de la respuesta abierta si aún no está en caché. */
  private asegurarEstructuraDeSeleccion(): void {
    const sel = this.seleccionada();
    const id = this.formId();
    if (!sel || !id) return;
    const v = sel.version;
    if (v == null || this.estructuraDe(sel) != null) return;
    this.formsSvc.structure(id, v)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: est => this.estructuraPorVersion.update(m => ({ ...m, [v]: est })),
        error: () => this.snack.open(
          `No se pudo cargar el formato de la versión v${v}.`, 'Cerrar', { duration: 4000 }),
      });
  }

  /** Clave estable de columna: el `name` solo es único dentro de su sección. */
  private claveColumna(col: ColumnaEscalar): string {
    return `c_${col.seccion}__${col.nombre}`;
  }

  ngOnInit(): void {
    // El formId llega por la ruta; si cambia (navegación entre formularios) se reinicia
    // todo. Con id inyectado por el host, el setter ya inicializó y la ruta no se mira.
    if (this.idPorInput == null) {
      this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(pm => {
        const id = Number(pm.get('formId'));
        if (!Number.isFinite(id) || id <= 0) return;
        this.inicializar(id);
      });
    }
    // ?registro= : el buscador del header entra directo a la ficha de un registro. Va
    // DESPUÉS de la ruta a propósito (así la carga ya está en vuelo) y en su propia
    // suscripción, porque saltar de un registro a otro del mismo formulario solo cambia
    // el query param y no vuelve a pasar por inicializar().
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(qp => {
      const id = Number(qp.get('registro'));
      if (!Number.isFinite(id) || id <= 0) return;
      this.registroPedido.set(id);
      this.abrirRegistroPedido();
    });
  }

  /**
   * Abre la respuesta que pide la URL. Puede no estar entre las filas cargadas (el tope
   * de filas, o un filtro de versión/estado): en ese caso se pide suelta al backend y se
   * antepone, para que la ficha y las flechas de anterior/siguiente funcionen igual.
   */
  private abrirRegistroPedido(): void {
    const id = this.registroPedido();
    if (id == null) return;
    if (this.filas().some(f => f.id === id)) {
      this.registroPedido.set(null);
      this.seleccionar(id);
      this.pestana.set(1);
      return;
    }
    if (this.cargando()) return; // siguen llegando páginas: se reintenta al terminar

    this.registroPedido.set(null);
    this.submissionsSvc.get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: sub => {
          if (sub.form_id !== this.formId()) return; // el enlace apunta a otro formulario
          this.filas.set([sub, ...this.filas()]);
          this.seleccionar(sub.id);
          this.pestana.set(1);
        },
        error: () => this.snack.open('No se encontró ese registro.', 'Cerrar', { duration: 4000 }),
      });
  }

  /** Reinicia filtros y carga base, estructura y respuestas del formulario `id`. */
  private inicializar(id: number): void {
    this.formId.set(id);
    this.versionFiltro.set(null);
    this.estadoFiltro.set('');
    this.estructuraPorVersion.set({});
    this.cargarBase(id);
    this.cargarEstructura();
    this.cargarRespuestas();
  }

  // ── Filtros ─────────────────────────────────────────────────────────

  onVersionChange(valor: number | null): void {
    this.versionFiltro.set(valor);
    this.cargarEstructura(); // las columnas dependen de la versión filtrada
    this.cargarRespuestas();
  }

  onEstadoChange(valor: SubmissionStatus | ''): void {
    this.estadoFiltro.set(valor);
    this.cargarRespuestas();
  }

  /** Cambio de pestaña: al entrar a la ficha hay que tener el formato de su versión. */
  onPestana(indice: number): void {
    this.pestana.set(indice);
    if (indice === 1) this.asegurarEstructuraDeSeleccion();
  }

  // ── Resumen IA ──────────────────────────────────────────────────────

  /**
   * Pide un resumen NUEVO a ms-forms (que lo genera con ms-ai y lo guarda). Si la IA
   * falla, el backend responde 503 sin tocar lo guardado: el panel sigue mostrando el
   * resumen anterior en vez de quedarse en blanco.
   */
  generarResumen(): void {
    const id = this.formId();
    if (!id || this.resumenCargando()) return;
    this.resumenCargando.set(true);
    this.formsSvc.generateAiSummary(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r: AiSummary) => {
          this.resumenCargando.set(false);
          this.aplicarResumen(r);
          this.snack.open('Resumen actualizado', 'Cerrar', { duration: 3000 });
        },
        error: (err: unknown) => {
          this.resumenCargando.set(false);
          void this.mensajeProblema(err, 'No se pudo generar el resumen. Se conserva el anterior.')
            .then(msg => this.snack.open(msg, 'Cerrar', { duration: 6000 }));
        },
      });
  }

  /** Llegaron respuestas después de generarlo: el texto sigue siendo el vigente. */
  resumenDesactualizado(): boolean {
    const f = this.form();
    return !!f?.ai_summary
      && f.ai_summary_submissions != null
      && f.submissions_count > f.ai_summary_submissions;
  }

  private aplicarResumen(r: AiSummary): void {
    const f = this.form();
    if (!f) return;
    this.form.set({
      ...f,
      ai_summary: r.summary ?? null,
      ai_responses_summary: r.responses_summary ?? null,
      ai_summary_at: r.generated_at ?? null,
      ai_summary_submissions: r.submissions_count ?? null,
    });
  }

  // ── Carga de datos ──────────────────────────────────────────────────

  private cargarBase(id: number): void {
    this.formsSvc.get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: f => this.form.set(f),
        error: () => this.snack.open('No se pudo cargar el formulario.', 'Cerrar', { duration: 4000 }),
      });
    this.formsSvc.versions(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: vs => this.versiones.set([...vs].sort((a, b) => b.version - a.version)),
        error: () => this.versiones.set([]),
      });
  }

  /** Estructura de la versión filtrada; sin filtro, la publicada vigente. */
  private cargarEstructura(): void {
    const id = this.formId();
    if (!id) return;
    this.formsSvc.structure(id, this.versionFiltro() ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: est => this.estructura.set(est),
        // Sin versión publicada la tabla simplemente no pinta columnas de campos.
        error: () => this.estructura.set(null),
      });
  }

  /**
   * Trae las respuestas de los filtros actuales por páginas de 100 (el tope que impone
   * ms-forms) hasta TOPE_FILAS, y las va acumulando: la tabla estándar busca y filtra
   * en cliente, así que necesita las filas en la mano. Las páginas se van pintando a
   * medida que llegan en vez de esperar a la última.
   *
   * `carga` es el serial: si el usuario cambia de filtro a mitad, lo que llegue tarde
   * de la carga anterior se descarta en vez de mezclarse con lo nuevo.
   */
  private carga = 0;

  private cargarRespuestas(): void {
    const id = this.formId();
    if (!id) return;
    const mia = ++this.carga;
    this.filas.set([]);
    this.total.set(0);
    this.seleccionId.set(null);
    this.cargando.set(true);
    this.cargarPagina(id, 0, mia);
  }

  private cargarPagina(id: number, pagina: number, mia: number): void {
    this.submissionsSvc.listByForm(id, {
      version: this.versionFiltro() ?? undefined,
      status: this.estadoFiltro() || undefined,
      page: pagina,
      size: TAMANO_PAGINA,
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: pag => {
          if (mia !== this.carga) return; // llegó tarde: los filtros ya cambiaron
          const acumuladas = pagina === 0 ? pag.content : [...this.filas(), ...pag.content];
          this.filas.set(acumuladas);
          this.total.set(pag.total);
          const faltan = acumuladas.length < pag.total && acumuladas.length < TOPE_FILAS;
          if (faltan && pag.content.length > 0) {
            this.cargarPagina(id, pagina + 1, mia);
            return;
          }
          this.cargando.set(false);
          this.abrirRegistroPedido();
          // La ficha individual necesita el formato de la versión de la respuesta abierta.
          if (this.pestana() === 1) this.asegurarEstructuraDeSeleccion();
        },
        error: async err => {
          if (mia !== this.carga) return;
          this.cargando.set(false);
          // Lo ya acumulado se conserva: media lista es mejor que ninguna.
          if (pagina === 0) { this.filas.set([]); this.total.set(0); }
          // Aunque el listado falle, el registro que pide la URL se puede traer suelto.
          this.abrirRegistroPedido();
          this.snack.open(
            await this.mensajeProblema(err, 'No se pudieron cargar las respuestas.'),
            'Cerrar', { duration: 5000 },
          );
        },
      });
  }

  // ── Celdas ──────────────────────────────────────────────────────────

  estadoEtiqueta(estado: SubmissionStatus): string {
    const opcion = this.ESTADOS.find(e => e.valor === estado);
    return opcion?.etiqueta ?? estado;
  }

  /** badge--submitted | badge--approved | badge--rejected | badge--draft (ver CSS). */
  estadoClase(estado: SubmissionStatus): string {
    return `badge badge--${estado.toLowerCase()}`;
  }

  usuarioDe(fila: Submission): string {
    if (fila.created_by) return fila.created_by;
    return fila.public_link_id != null ? 'anónimo (link)' : '—';
  }

  /** Valor de una columna escalar: payload[seccion][nombre], formateado por TIPO. */
  valorCelda(fila: Submission, col: ColumnaEscalar): string {
    const valor = fila.payload?.[col.seccion]?.[col.nombre] ?? null;
    if (valor == null || (typeof valor === 'string' && valor.trim() === '')) return '—';
    if (Array.isArray(valor)) {
      const partes = (valor as unknown[]).map(v =>
        isDocumentRef(v) ? v.filename : this.formatoEscalar(String(v), col.tipo));
      return partes.length ? partes.join('; ') : '—';
    }
    if (isDocumentRef(valor)) return valor.filename;
    if (typeof valor === 'object') return '—'; // p. ej. LOCATION: no es escalar, no debería llegar
    return this.formatoEscalar(valor, col.tipo);
  }

  /**
   * Valor CRUDO para la tabla estándar: número donde hay número y fecha ISO donde hay
   * fecha, porque de eso dependen su orden y sus filtros (el formato bonito lo pone
   * ella con el `type`/`format` de la columna). Lo que no es escalar —archivos, fotos,
   * firma, ubicación, selección múltiple— baja a un texto legible.
   */
  private valorPlano(fila: Submission, col: ColumnaEscalar): string | number | null {
    const valor = fila.payload?.[col.seccion]?.[col.nombre] ?? null;
    if (valor == null || (typeof valor === 'string' && valor.trim() === '')) return null;

    switch (col.tipo) {
      case 'NUMBER':
      case 'CURRENCY':
      case 'RATING': {
        const n = typeof valor === 'number' ? valor : Number(valor);
        return Number.isFinite(n) ? n : String(valor);
      }
      case 'DATE':
        return typeof valor === 'string' ? valor : String(valor);
      case 'PHOTO':
      case 'VIDEO':
      case 'FILE':
      case 'SIGNATURE':
      case 'SCAN_DOC':
      case 'SCAN_ID': {
        const refs = asDocumentRefs(valor as FieldValue);
        if (refs.length === 0) return null;
        if (col.tipo === 'SIGNATURE') return 'Firmado';
        return refs.length === 1 ? refs[0].filename : `${refs.length} archivos`;
      }
      case 'LOCATION': {
        const loc = valor as LocationValue;
        return typeof loc?.lat === 'number' && typeof loc?.lng === 'number'
          ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`
          : null;
      }
      default:
        if (Array.isArray(valor)) return (valor as unknown[]).map(v => String(v)).join('; ');
        if (isDocumentRef(valor)) return valor.filename;
        if (typeof valor === 'object') return null;
        return String(valor);
    }
  }

  /** Formato es-CO por tipo: fecha dd/MM/yyyy, moneda COP, número con miles. */
  private formatoEscalar(valor: string | number, tipo: FieldType): string {
    switch (tipo) {
      case 'DATE': {
        const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : String(valor);
      }
      case 'CURRENCY': {
        const n = typeof valor === 'number' ? valor : Number(valor);
        return Number.isFinite(n) ? formatCurrency(n, 'es-CO', '$', 'COP', '1.0-0') : String(valor);
      }
      case 'NUMBER': {
        const n = typeof valor === 'number' ? valor : Number(valor);
        return Number.isFinite(n) ? formatNumber(n, 'es-CO') : String(valor);
      }
      default:
        return String(valor);
    }
  }

  // ── Acciones ────────────────────────────────────────────────────────

  /** SUBMITTED → APPROVED | REJECTED, con confirmación y refresco de la página actual. */
  async cambiarEstado(fila: Submission, destino: 'APPROVED' | 'REJECTED'): Promise<void> {
    const aprobar = destino === 'APPROVED';
    const res = await Swal.fire({
      title: aprobar ? '¿Aprobar respuesta?' : '¿Rechazar respuesta?',
      text: `La respuesta #${fila.id} quedará en estado ${aprobar ? 'Aprobada' : 'Rechazada'}.`,
      icon: aprobar ? 'question' : 'warning',
      showCancelButton: true,
      confirmButtonText: aprobar ? 'Sí, aprobar' : 'Sí, rechazar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: aprobar ? '#0f766e' : '#b42318',
    });
    if (!res.isConfirmed) return;

    this.procesandoId.set(fila.id);
    this.submissionsSvc.changeStatus(fila.id, destino)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: actualizada => {
          this.procesandoId.set(null);
          this.snack.open(aprobar ? 'Respuesta aprobada.' : 'Respuesta rechazada.', 'Cerrar', { duration: 3500 });
          // Se parchea la fila en su sitio: recargar la lista entera perdería la
          // respuesta abierta en la ficha, el filtro de la tabla y el scroll.
          this.filas.update(lista => lista.map(f => f.id === fila.id
            ? { ...f, ...actualizada, payload: actualizada?.payload ?? f.payload, status: destino }
            : f));
        },
        error: async err => {
          this.procesandoId.set(null);
          Swal.fire('Error', await this.mensajeProblema(err, 'No se pudo cambiar el estado de la respuesta.'), 'error');
        },
      });
  }

  /** Excel del backend con los filtros vigentes; nombre desde Content-Disposition. */
  exportarExcel(): void {
    const id = this.formId();
    if (!id || this.exportando()) return;
    this.exportando.set(true);
    this.formsSvc.exportXlsx(id, {
      version: this.versionFiltro() ?? undefined,
      status: this.estadoFiltro() || undefined,
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: resp => {
          this.exportando.set(false);
          const blob = resp.body;
          if (!blob) {
            Swal.fire('Error', 'El servidor no devolvió el archivo.', 'error');
            return;
          }
          const cd = resp.headers.get('Content-Disposition') || '';
          const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
          const nombre = m
            ? decodeURIComponent(m[1])
            : `Respuestas_${this.form()?.code ?? id}.xlsx`;
          saveAs(blob, nombre);
          this.snack.open('Excel descargado.', 'Cerrar', { duration: 3000 });
        },
        error: async err => {
          this.exportando.set(false);
          Swal.fire('Error', await this.mensajeProblema(err, 'No se pudo exportar el Excel.'), 'error');
        },
      });
  }

  // ── Errores del API ─────────────────────────────────────────────────

  /**
   * Extrae el `detail` del ProblemDetail (RFC 7807). En descargas blob el
   * cuerpo del error también llega como Blob y hay que parsearlo.
   */
  private async mensajeProblema(err: unknown, porDefecto: string): Promise<string> {
    const e = err as HttpErrorResponse;
    let cuerpo: unknown = e?.error;
    if (cuerpo instanceof Blob) {
      try { cuerpo = JSON.parse(await cuerpo.text()); } catch { cuerpo = null; }
    }
    const problema = cuerpo as ApiProblem | null;
    return problema?.detail || porDefecto;
  }
}
