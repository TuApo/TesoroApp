import {
  Component,
  DestroyRef,
  Inject,
  OnInit,
  ViewChild,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  computed,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatMenu } from '@angular/material/menu';

import Swal from 'sweetalert2';
import saveAs from 'file-saver';
import { finalize, firstValueFrom, interval } from 'rxjs';
import { HttpEventType } from '@angular/common/http';

import { SharedModule } from '@/app/shared/shared.module';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import {
  VerPdfsComponent,
  ViewerDocument,
} from '../../components/ver-pdfs/ver-pdfs.component';
import { DateRangeDialogComponent } from '@/app/shared/components/date-rang-dialog/date-rang-dialog.component';
import { HiringService } from '../../service/hiring.service';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { ReportesService } from '../../service/reportes/reportes.service';
import { compararOficinas, ordenarPorOficina } from './oficinas-orden';
import { SedesSeleccionService } from '@/app/shared/services/sedes-seleccion/sedes-seleccion.service';
import { claveOficina } from '@/app/shared/utils/sedes-seleccion';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';

/** Una contratación finalizada desde el pipeline (reemplaza una fila del cruce). */
interface ContratacionRow {
  numero_documento: string;
  tem: 'AL' | 'TA' | null;
  fecha_ingreso: string | null;
  arl_ok: boolean | null;
  arl_fecha: string | null;
  arl_detalle: string | null;
  finalizado_por: string | null;
  finalizado_at: string | null;
}

interface ReporteRow {
  id?: number;
  fecha: string;
  nombre: string;
  sede: string;
  cantidadContratosTuAlianza: number;
  cantidadContratosApoyoLaboral: number;
  nota?: string;
  cedulas?: any[];
  traslados?: any[];
  cruce_document?: { file_url?: string } | null;
  sst_document?: { file_url?: string } | null;
  /**
   * Vacío en los reportes cargados a mano desde hiring-report (ahí el cruce es
   * un archivo adjunto). Lleno en los que se armaron con "Finalizar
   * contratación": para esos el cruce se GENERA desde BD.
   */
  contrataciones?: ContratacionRow[];
}

interface ConsolidadoRow {
  fecha: string;
  status: string;
  sede: string;
  cantidadContratosTuAlianza: number;
  cantidadContratosApoyoLaboral: number;
  totalIngresos: number;
  cedulas: number;
  traslados: number;
  sst: string;
  notas?: string;
}

interface FincaRow {
  fechaIngreso: string;
  centroCosto: string;
  total: number;
}

interface ErrorValidacionRow {
  id: number;
  fecha: string;
  tipoDeError: string;
  registro: string;
  mensaje: string;
  responsable: string;
  oficina: string;
}

const STATUS_REPORTADO = 'Reportado';
const STATUS_SIN_CONTRATACION = 'Sin contratación';
const STATUS_NO_REPORTO = 'No reportó';

// ADMINISTRATIVOS sí se muestra, pero va de última (ver oficinas-orden.ts).
// ANDES y MONTE_VERDE ya no están aquí: las esconde el flag `opera_seleccion` del
// catálogo de sedes (ms-auth-admin V129), ver `sedesFueraSeleccion`.
const EXCLUDED_SEDES = new Set<string>([
  'FORANEOS',
  'VIRTUAL',
]);

/** Etiqueta para filas sin oficina registrada. */
const SIN_OFICINA = 'SIN OFICINA';

/**
 * Índice (0-based) de la columna TEM en el Excel generado por
 * `reporte/candidatos-excel/` (plantilla gestion_contratacion/base.xlsx).
 * Es fija, así que no hay que detectarla como en los cruces adjuntos.
 */
const CRUCE_COL_TEM = 2;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-view-reports',
  imports: [SharedModule, StandardFilterTable, MatButtonModule, MatProgressBarModule],
  templateUrl: './view-reports.component.html',
  styleUrl: './view-reports.component.css',
})
export class ViewReportsComponent implements OnInit {
  @ViewChild(MatMenu) menu!: MatMenu;

  reportes = signal<ReporteRow[]>([]);
  consolidado = signal<ConsolidadoRow[]>([]);
  fincas = signal<FincaRow[]>([]);
  erroresValidacion = signal<ErrorValidacionRow[]>([]);
  erroresPorTipo = signal<Record<string, number>>({});
  activeFrom = signal<string>('');
  activeTo = signal<string>('');

  isLoadingReportes = signal(false);
  isLoadingErrores = signal(false);
  isExporting = signal(false);
  activeRangeLabel = signal('Hoy');
  lastUpdate = signal<Date | null>(null);
  liveMode = signal(true);
  zipProgress = signal<number | null>(null);
  zipLoadedMb = signal<number>(0);
  zipTotalMb = signal<number | null>(null);
  zipLabel = signal<string>('');

  private static readonly AUTO_REFRESH_MS = 20000;

  readonly isLiveRefresh = computed(() => {
    if (!this.liveMode()) return false;
    const today = this.todayIso();
    return this.activeFrom() === today && this.activeTo() === today;
  });

  userCorreo = '';
  userNombre = '';

  isSidebarHidden = false;
  private readonly isBrowser: boolean;

  private readonly adminEmails = new Set<string>([
    'tuafiliacion@tsservicios.co',
    'programador.ts@gmail.com',
    'a.seguridad.ts@gmail.com',
    'a.sotelotualianza@gmail.com',
    'nominacentral9@gmail.com',
  ]);

  get isAdminReportUser(): boolean {
    return this.adminEmails.has((this.userCorreo || '').toLowerCase());
  }

  readonly kpis = computed(() => {
    const rows = this.consolidado();
    const sum = (key: keyof ConsolidadoRow) =>
      rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

    return {
      tuAlianza: sum('cantidadContratosTuAlianza'),
      apoyoLaboral: sum('cantidadContratosApoyoLaboral'),
      cedulas: sum('cedulas'),
      oficinasReportaron: rows.filter((r) => r.status === STATUS_REPORTADO).length,
      oficinasTotal: rows.length,
    };
  });

  reportesColumns: ColumnDefinition[] = [
    { name: 'fecha', header: 'Fecha y hora', type: 'date', dateFormat: 'dd/MM/yyyy HH:mm', width: '170px', align: 'left' },
    { name: 'nombre', header: 'Persona quien subió', type: 'text', align: 'left' },
    { name: 'sede', header: 'Sede', type: 'text', align: 'left' },
    {
      name: 'cantidadContratosTuAlianza',
      header: 'Contratos Tu Alianza',
      type: 'number',
      width: '150px',
      align: 'right',
    },
    {
      name: 'cantidadContratosApoyoLaboral',
      header: 'Contratos Apoyo Laboral',
      type: 'number',
      width: '180px',
      align: 'right',
    },
    { name: 'nota', header: 'Nota', type: 'text', align: 'left' },
    {
      name: 'actions',
      header: 'Documentos',
      type: 'custom',
      width: '220px',
      align: 'center',
      filterable: false,
    },
  ];

  consolidadoColumns: ColumnDefinition[] = [
    { name: 'fecha', header: 'Fecha', type: 'date', width: '140px', align: 'left' },
    {
      name: 'status',
      header: 'Estado',
      type: 'status',
      width: '170px',
      align: 'left',
      statusConfig: {
        [STATUS_NO_REPORTO]: { color: '#991b1b', background: '#fee2e2' },
        [STATUS_SIN_CONTRATACION]: { color: '#b45309', background: '#fef3c7' },
        [STATUS_REPORTADO]: { color: '#166534', background: '#dcfce7' },
      },
    },
    { name: 'sede', header: 'Oficina', type: 'text', align: 'left' },
    {
      name: 'cantidadContratosTuAlianza',
      header: 'Contratos Tu Alianza',
      type: 'number',
      width: '150px',
      align: 'right',
    },
    {
      name: 'cantidadContratosApoyoLaboral',
      header: 'Contratos Apoyo Laboral',
      type: 'number',
      width: '180px',
      align: 'right',
    },
    {
      name: 'totalIngresos',
      header: 'Total ingresos',
      type: 'number',
      width: '140px',
      align: 'right',
    },
    {
      name: 'cedulas',
      header: 'Cédulas subidas',
      type: 'number',
      width: '140px',
      align: 'right',
    },
    {
      name: 'traslados',
      header: 'Traslados',
      type: 'number',
      width: '120px',
      align: 'right',
    },
    {
      name: 'sst',
      header: 'SST',
      type: 'select',
      options: ['Sí', 'No'],
      width: '80px',
      align: 'center',
    },
    { name: 'notas', header: 'Notas', type: 'text', align: 'left' },
  ];

  fincasColumns: ColumnDefinition[] = [
    { name: 'fechaIngreso', header: 'Fecha', type: 'text', width: '160px', align: 'left' },
    { name: 'centroCosto', header: 'Centro de Costo', type: 'text', align: 'left' },
    { name: 'total', header: 'Total', type: 'number', width: '120px', align: 'right' },
  ];

  erroresColumns: ColumnDefinition[] = [
    { name: 'fecha', header: 'Fecha', type: 'date', width: '160px', align: 'left' },
    {
      name: 'tipoDeError',
      header: 'Tipo',
      type: 'custom',
      width: '200px',
      align: 'left',
      customClassConfig: {
        'Validación ARL': { color: '#991b1b', background: '#fee2e2' },
        'Documento de Contratación': { color: '#92400e', background: '#fef3c7' },
        'Cruce Diario - Pre-validación': { color: '#7c2d12', background: '#ffedd5' },
        'Cédulas Escaneadas - Previsualizador': { color: '#1e40af', background: '#dbeafe' },
        'Traslados - Previsualizador': { color: '#5b21b6', background: '#ede9fe' },
      },
    },
    { name: 'oficina', header: 'Oficina', type: 'text', width: '170px', align: 'left' },
    { name: 'registro', header: 'Cédula / Registro', type: 'text', width: '160px', align: 'left' },
    { name: 'responsable', header: 'Responsable', type: 'text', width: '220px', align: 'left' },
    { name: 'mensaje', header: 'Detalle del error', type: 'text', align: 'left' },
  ];

  /**
   * Claves (`claveOficina`) de las sedes que Selección ya no opera (V129
   * `opera_seleccion = 0`: ANDES, MONTE_VERDE). Salen del consolidado cuando no
   * reportaron —no se les va a pedir reporte—, pero si en el rango consultado SÍ
   * reportaron (datos históricos) la fila se sigue viendo.
   */
  private sedesFueraSeleccion = new Set<string>();

  constructor(
    private readonly hiringService: HiringService,
    private readonly reportesService: ReportesService,
    private readonly dialog: MatDialog,
    private readonly utilityService: UtilityServiceService,
    private readonly sedesSeleccion: SedesSeleccionService,
    private readonly cdr: ChangeDetectorRef,
    private readonly destroyRef: DestroyRef,
    @Inject(PLATFORM_ID) private readonly platformId: object,
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  async ngOnInit(): Promise<void> {
    if (!this.isBrowser) return;

    // Antes del primer consolidado: decide qué sedes sin reporte se esconden.
    this.sedesFueraSeleccion = await firstValueFrom(this.sedesSeleccion.clavesFuera());

    const user = await this.utilityService.getUser();
    if (user) {
      this.userCorreo = user.correo_electronico;
      this.userNombre = `${user.datos_basicos.nombres} ${user.datos_basicos.apellidos}`;
      this.cdr.markForCheck();
    }

    const today = this.todayIso();
    this.activeRangeLabel.set('Hoy');
    this.activeFrom.set(today);
    this.activeTo.set(today);
    this.loadReportes({ fechaDesde: today, fechaHasta: today });
    this.loadErroresValidacion(today, today);
    this.setupAutoRefresh();
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private setupAutoRefresh(): void {
    if (!this.isBrowser) return;

    interval(ViewReportsComponent.AUTO_REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        if (!this.isLiveRefresh()) return;
        if (this.isLoadingReportes() || this.isLoadingErrores()) return;

        const from = this.activeFrom();
        const to = this.activeTo();
        this.loadReportes({ fechaDesde: from, fechaHasta: to }, true);
        this.loadErroresValidacion(from, to, true);
      });
  }

  isArray(value: any): boolean {
    return Array.isArray(value);
  }

  toggleSidebar(): void {
    if (!this.isBrowser) return;
    this.isSidebarHidden = !this.isSidebarHidden;
  }

  hasAnyDocument(row: any): boolean {
    return (
      (Array.isArray(row?.cedulas) && row.cedulas.length > 0) ||
      (Array.isArray(row?.traslados) && row.traslados.length > 0) ||
      (Array.isArray(row?.contrataciones) && row.contrataciones.length > 0) ||
      !!row?.cruce_document?.file_url ||
      !!row?.sst_document?.file_url
    );
  }

  /** Detalle de las contrataciones finalizadas desde el pipeline, con estado ARL. */
  openContratacionesDialog(row: ReporteRow): void {
    if (!this.isBrowser) return;

    const filas = row.contrataciones ?? [];
    const cuerpo = filas
      .map((c) => {
        const arl =
          c.arl_ok === true
            ? '<span style="color:#166534;">ARL OK</span>'
            : c.arl_ok === false
              ? `<span style="color:#991b1b;">ARL: ${c.arl_detalle || 'no cuadra'}</span>`
              : '<span style="color:#92400e;">ARL sin validar</span>';
        return (
          `<tr>` +
          `<td style="padding:4px 8px;">${c.numero_documento}</td>` +
          `<td style="padding:4px 8px; text-align:center;">${c.tem ?? '—'}</td>` +
          `<td style="padding:4px 8px;">${c.fecha_ingreso ?? '—'}</td>` +
          `<td style="padding:4px 8px;">${arl}</td>` +
          `<td style="padding:4px 8px;">${c.finalizado_por ?? '—'}</td>` +
          `</tr>`
        );
      })
      .join('');

    Swal.fire({
      title: `Contrataciones — ${row.sede || 'Sin oficina'}`,
      width: 800,
      html:
        `<div style="max-height:60vh; overflow:auto;">` +
        `<table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">` +
        `<thead><tr style="background:#f1f5f9;">` +
        `<th style="padding:6px 8px;">Cédula</th>` +
        `<th style="padding:6px 8px;">TEM</th>` +
        `<th style="padding:6px 8px;">F. Ingreso</th>` +
        `<th style="padding:6px 8px;">ARL</th>` +
        `<th style="padding:6px 8px;">Finalizó</th>` +
        `</tr></thead><tbody>${cuerpo}</tbody></table></div>`,
    });
  }

  /**
   * Adjunta al reporte del día lo que NO produce el pipeline por candidato:
   * la constancia GRUPAL de inducción SST y la nota de la jornada.
   */
  async abrirAdjuntos(row: ReporteRow): Promise<void> {
    if (!this.isBrowser || !row?.id) return;

    const { value } = await Swal.fire({
      title: `Adjuntos — ${row.sede || 'Sin oficina'}`,
      html:
        `<p style="text-align:left; margin:0 0 10px 0; font-size:13px; color:#475569;">` +
        `El SST individual de cada persona ya queda enlazado al finalizar su ` +
        `contratación. Esto es la constancia <b>grupal</b> del día.</p>` +
        `<input type="file" id="vr-sst" accept=".pdf" class="swal2-file">` +
        `<textarea id="vr-nota" class="swal2-textarea" placeholder="Nota del día (opcional)">${row.nota ?? ''}</textarea>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => {
        const input = document.getElementById('vr-sst') as HTMLInputElement | null;
        const nota = (document.getElementById('vr-nota') as HTMLTextAreaElement | null)?.value ?? '';
        return { file: input?.files?.[0] ?? null, nota };
      },
    });

    if (!value) return;
    if (!value.file && (value.nota ?? '') === (row.nota ?? '')) return;

    try {
      await firstValueFrom(
        this.reportesService.adjuntarAlReporte(row.id, {
          sst_document: value.file,
          nota: value.nota,
        }),
      );
      Swal.fire({ icon: 'success', title: 'Guardado', timer: 1600, showConfirmButton: false });
      this.loadReportes({ fechaDesde: this.activeFrom(), fechaHasta: this.activeTo() });
    } catch (err: any) {
      console.error('[abrirAdjuntos] Error:', err);
      Swal.fire({
        icon: 'error',
        title: 'No se pudo guardar',
        text: err?.message ?? 'Error al adjuntar al reporte.',
      });
    }
  }

  private loadReportes(
    filters?: {
      nombre?: string;
      fechaDesde?: string;
      fechaHasta?: string;
    },
    silent = false,
  ): void {
    if (!this.isBrowser) return;

    if (!silent) this.isLoadingReportes.set(true);

    this.reportesService
      .getReportes(filters)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (!silent) this.isLoadingReportes.set(false);
        }),
      )
      .subscribe({
        next: ({ reportes, consolidado }) => {
          this.reportes.set(reportes ?? []);

          if (this.isAdminReportUser) {
            const normalizado: ConsolidadoRow[] = (consolidado ?? [])
              .filter(
                (item: any) =>
                  !EXCLUDED_SEDES.has(
                    String(item?.sede ?? '').trim().toUpperCase(),
                  ),
              )
              // Sedes fuera de Selección: solo si en el rango sí reportaron (histórico).
              .filter(
                (item: any) =>
                  !this.sedesFueraSeleccion.has(claveOficina(item?.sede)) ||
                  this.normalizeStatus(item?.status) !== STATUS_NO_REPORTO,
              )
              .map((item: any) => ({
                ...item,
                sst: item.sst ? 'Sí' : 'No',
                status: this.normalizeStatus(item.status),
              }));

            // Orden fijo de oficinas (no por estado), para que la tabla se lea
            // siempre igual y coincida con el Excel de bases unidas.
            this.consolidado.set(ordenarPorOficina(normalizado, (r) => r.sede));
          } else {
            this.consolidado.set([]);
          }

          this.lastUpdate.set(new Date());
        },
        error: (err) => {
          if (silent) {
            console.warn('[loadReportes] auto-refresh falló:', err);
            return;
          }
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Ocurrió un error al obtener los reportes.',
          });
        },
      });
  }

  private loadErroresValidacion(from?: string, to?: string, silent = false): void {
    if (!this.isBrowser) return;

    if (!silent) this.isLoadingErrores.set(true);

    this.reportesService
      .getErroresValidacion({
        fechaDesde: from || undefined,
        fechaHasta: to || undefined,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (!silent) this.isLoadingErrores.set(false);
        }),
      )
      .subscribe({
        next: ({ errores, por_tipo }) => {
          const rows: ErrorValidacionRow[] = (errores ?? []).map((e) => ({
            id: e.id,
            fecha: e.fecha_creacion ?? '',
            tipoDeError: e.tipoDeError || 'Sin tipo',
            registro: e.registro != null ? String(e.registro) : '',
            mensaje: e.mensaje || '',
            responsable: e.responsable || '',
            oficina: e.oficina || SIN_OFICINA,
          }));
          this.erroresValidacion.set(ordenarPorOficina(rows, (r) => r.oficina));
          this.erroresPorTipo.set(por_tipo ?? {});
          this.lastUpdate.set(new Date());
        },
        error: (err) => {
          console.error('[loadErroresValidacion] Falló:', err);
          if (!silent) {
            this.erroresValidacion.set([]);
            this.erroresPorTipo.set({});
          }
        },
      });
  }

  openDocsDialog(title: string, docs: any[] | null | undefined): void {
    if (!this.isBrowser) return;

    const documents: ViewerDocument[] = (docs ?? [])
      .filter((d: any) => !!d?.file_url)
      .map((d: any) => ({
        id: d.id,
        title: d.title,
        type_name: d.type_name,
        file_url: d.file_url,
      }));

    this.dialog.open(VerPdfsComponent, {
      minWidth: '90vw',
      panelClass: 'docs-viewer-dialog',
      data: { title, documents },
    });
  }

  /**
   * Único punto donde se cambia el rango de fechas.
   * Todo lo demás (tablas, ZIPs y exportaciones) consume `activeFrom()` /
   * `activeTo()`, así lo que se descarga siempre es lo mismo que se ve filtrado.
   */
  openDateRangeDialog(): void {
    if (!this.isBrowser) return;

    const dialogRef = this.dialog.open(DateRangeDialogComponent, {
      width: '550px',
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result?: { start: string | null; end: string | null }) => {
        if (!result || (!result.start && !result.end)) return;
        this.handleFilterTables(result.start ?? '', result.end ?? '');
      });
  }

  // ---- Exportaciones del menú: usan el rango ya activo, no vuelven a preguntar ----

  exportContratacion(): void {
    if (!this.isBrowser) return;
    this.handleExportContratacion(this.activeFrom(), this.activeTo());
  }

  generateCentroCostoTable(): void {
    if (!this.isBrowser) return;
    this.handleGenerateCentroCosto(this.activeFrom(), this.activeTo());
  }

  exportFincas(): void {
    if (!this.isBrowser) return;
    this.handleExportFincas(this.activeFrom(), this.activeTo());
  }

  private handleFilterTables(from: string, to: string): void {
    this.liveMode.set(false);
    this.activeRangeLabel.set(this.buildRangeLabel(from, to));
    this.activeFrom.set(from);
    this.activeTo.set(to);
    this.loadReportes({
      fechaDesde: from || undefined,
      fechaHasta: to || undefined,
    });
    this.loadErroresValidacion(from, to);
  }

  resumeLiveMode(): void {
    if (!this.isBrowser) return;
    const today = this.todayIso();
    this.liveMode.set(true);
    this.activeRangeLabel.set('Hoy');
    this.activeFrom.set(today);
    this.activeTo.set(today);
    this.loadReportes({ fechaDesde: today, fechaHasta: today });
    this.loadErroresValidacion(today, today);
  }

  refreshErroresValidacion(): void {
    this.loadErroresValidacion(this.activeFrom(), this.activeTo());
  }

  private handleExportContratacion(from: string, to: string): void {
    this.isExporting.set(true);

    this.hiringService
      .obtenerBaseContratacionPorFechas(from, to)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.isExporting.set(false)),
      )
      .subscribe({
        next: (blob: Blob) => {
          if (!blob || blob.size === 0) {
            Swal.fire({
              icon: 'warning',
              title: 'Sin datos',
              text: 'No se encontraron registros para el rango seleccionado.',
            });
            return;
          }
          saveAs(
            blob,
            `reporte_contratacion_${from || 'sin_desde'}_a_${to || 'sin_hasta'}.xlsx`,
          );
        },
        error: (err) => {
          Swal.fire({
            icon: 'error',
            title: 'Error al descargar',
            text: err?.message ?? 'Ocurrió un error al descargar el archivo.',
          });
        },
      });
  }

  private handleGenerateCentroCosto(from: string, to: string): void {
    this.isExporting.set(true);

    this.hiringService
      .obtenerReportesPorFechasCentroCosto(from, to)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.isExporting.set(false)),
      )
      .subscribe({
        next: ({ resultado }) => {
          const total = resultado?.total_general ?? 0;
          if (total === 0) {
            Swal.fire({
              icon: 'warning',
              title: 'No hay reportes',
              text: 'No se encontraron reportes para las fechas seleccionadas.',
            });
            this.fincas.set([]);
            return;
          }

          const detalles = resultado?.detalles ?? [];
          this.fincas.set(this.formatData(detalles));
        },
        error: (err) => {
          Swal.fire({
            icon: 'error',
            title: 'Error al cargar',
            text: err?.message ?? 'Ocurrió un error al cargar los reportes.',
          });
        },
      });
  }

  private handleExportFincas(from: string, to: string): void {
    this.isExporting.set(true);

    this.hiringService
      .descargarReporteFechaIngresoCentroCostoFincas(from, to)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.isExporting.set(false)),
      )
      .subscribe({
        next: (blob: Blob) => {
          if (!blob || blob.size === 0) {
            Swal.fire({
              icon: 'warning',
              title: 'No hay reportes',
              text: 'No se encontraron reportes de fincas para las fechas seleccionadas.',
            });
            return;
          }

          saveAs(
            blob,
            `reporte_fincas_${from || 'sin_desde'}_a_${to || 'sin_hasta'}.xlsx`,
          );
        },
        error: (err) => {
          Swal.fire({
            icon: 'error',
            title: 'Error al descargar',
            text:
              err?.message ??
              'Ocurrió un error al descargar el reporte de fincas.',
          });
        },
      });
  }

  private normalizeStatus(raw: unknown): string {
    const s = String(raw ?? '').trim().toUpperCase();
    if (!s) return STATUS_NO_REPORTO;
    if (s === 'REALIZO REPORTE' || s === 'REPORTADO') return STATUS_REPORTADO;
    if (s === 'NO HUBO CONTRATACION' || s === 'SIN CONTRATACION' || s === 'SIN CONTRATACIÓN') {
      return STATUS_SIN_CONTRATACION;
    }
    if (
      s === 'NO REPORTO' ||
      s === 'NO REPORTÓ' ||
      s === 'SIN REPORTE' ||
      s === 'PENDIENTE' ||
      s.includes('NO REPORT')
    ) {
      return STATUS_NO_REPORTO;
    }
    return STATUS_NO_REPORTO;
  }

  private buildRangeLabel(from: string, to: string): string {
    const today = new Date().toISOString().slice(0, 10);
    const fmt = (iso: string) => {
      const [y, m, d] = iso.split('-');
      return `${d}/${m}/${y}`;
    };

    if (from && to) {
      if (from === to) return from === today ? 'Hoy' : fmt(from);
      return `${fmt(from)} → ${fmt(to)}`;
    }
    if (from) return `Desde ${fmt(from)}`;
    if (to) return `Hasta ${fmt(to)}`;
    return 'Sin rango';
  }

  private formatData(data: any): FincaRow[] {
    const fechas = Object.keys(data).sort((a, b) => {
      const dA = new Date(a.split('/').reverse().join('-')).getTime();
      const dB = new Date(b.split('/').reverse().join('-')).getTime();
      return dB - dA;
    });

    const resultado: FincaRow[] = [];
    fechas.forEach((fecha) => {
      let first = true;
      data[fecha].forEach((item: any) => {
        resultado.push({
          fechaIngreso: first ? fecha : '',
          centroCosto: item.centro_costo,
          total: item.total,
        });
        first = false;
      });
    });
    return resultado;
  }

  async descargarCrucesCombinados(): Promise<void> {
    if (!this.isBrowser) return;

    const from = this.activeFrom();
    const to = this.activeTo();

    // Dos orígenes conviviendo:
    //  a) Reportes NUEVOS (botón "Finalizar contratación" del pipeline): no hay
    //     archivo, el cruce se GENERA desde BD con las cédulas finalizadas.
    //  b) Reportes VIEJOS (hiring-report): traen `cruce_document` adjunto y se
    //     siguen leyendo igual, para no perder el histórico ni romper a las
    //     oficinas que aún cargan a mano.
    const fuentes = new Map<string, string>();          // url  -> oficina
    const cedulasPorOficina = new Map<string, string[]>(); // oficina -> cédulas
    const personaPorCedula: Record<string, string> = {};

    for (const r of this.reportes()) {
      const oficina = (r.sede || '').trim() || SIN_OFICINA;

      const finalizadas = r.contrataciones ?? [];
      if (finalizadas.length) {
        const acc = cedulasPorOficina.get(oficina) ?? [];
        for (const c of finalizadas) {
          const ced = String(c?.numero_documento ?? '').trim();
          if (!ced) continue;
          acc.push(ced);
          personaPorCedula[ced] = c.finalizado_por || r.nombre || '';
        }
        cedulasPorOficina.set(oficina, acc);
        continue;
      }

      const url = r.cruce_document?.file_url;
      if (url && !fuentes.has(url)) fuentes.set(url, oficina);
    }

    const totalGeneradas = [...cedulasPorOficina.values()].reduce((a, c) => a + c.length, 0);

    if (fuentes.size === 0 && totalGeneradas === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Sin bases',
        text: `No hay contrataciones finalizadas ni bases adjuntas en el rango ${this.activeRangeLabel()}.`,
      });
      return;
    }

    this.isExporting.set(true);

    try {
      const XLSX = await import('xlsx');

      // Caja en vez de `let header: any[] | null`: se llena dentro de `absorber`
      // y TypeScript no sigue las asignaciones hechas en un closure — daba
      // "Property 'length' does not exist on type 'never'".
      const headerBox: any[][] = [];
      const alianzaRows: { cells: any[]; oficina: string }[] = [];
      const apoyoRows: { cells: any[]; oficina: string }[] = [];

      /** Parte un workbook en las dos hojas, marcando la oficina de origen. */
      const absorber = (buf: ArrayBuffer, oficina: string, colFija?: number) => {
        const wb = XLSX.read(buf, { type: 'array' });

        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          const data: any[][] = XLSX.utils.sheet_to_json(ws, {
            header: 1,
            defval: '',
            blankrows: false,
          });
          if (data.length < 2) continue;

          const [rawHeader, ...body] = data;
          if (!headerBox.length) headerBox.push(rawHeader);

          // El Excel generado siempre trae TEM en la columna 2 (índice 0-based);
          // en los adjuntos hay que detectarla porque cada oficina armaba el suyo.
          const colIdx = colFija ?? this.detectEmpresaColumn(rawHeader, body);

          for (const row of body) {
            if (!row.some((c) => String(c ?? '').trim() !== '')) continue;
            const bucket = this.classifyRow(row, colIdx, sheetName);
            if (bucket === 'TA') alianzaRows.push({ cells: row, oficina });
            else if (bucket === 'AL') apoyoRows.push({ cells: row, oficina });
          }
        }
      };

      // ── a) Cruces generados desde BD, por oficina ──
      const oficinasGeneradas = [...cedulasPorOficina.entries()].sort((a, b) =>
        compararOficinas(a[0], b[0]),
      );

      for (const [oficina, cedulas] of oficinasGeneradas) {
        if (!cedulas.length) continue;
        try {
          const blob = await firstValueFrom(
            this.reportesService.generarCruceExcel(cedulas, { personas: personaPorCedula }),
          );
          absorber(await blob.arrayBuffer(), oficina, CRUCE_COL_TEM);
        } catch (err) {
          console.error(`[descargarCrucesCombinados] Falló la generación de ${oficina}:`, err);
        }
      }

      // ── b) Cruces adjuntos (hiring-report) ──
      const fuentesOrdenadas = [...fuentes.entries()].sort((a, b) =>
        compararOficinas(a[1], b[1]),
      );

      for (const [url, oficina] of fuentesOrdenadas) {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        absorber(await resp.arrayBuffer(), oficina);
      }

      if (!headerBox.length) {
        Swal.fire({
          icon: 'warning',
          title: 'Sin datos',
          text: 'Los archivos de base están vacíos o no se pudieron leer.',
        });
        return;
      }
      const header = headerBox[0];

      if (alianzaRows.length === 0 && apoyoRows.length === 0) {
        Swal.fire({
          icon: 'warning',
          title: 'No se pudo clasificar',
          html:
            'No se encontró una columna que distinga TA / AL.<br><br>' +
            'En los cruces <b>generados</b> el TEM sale de la temporal de la vacante: ' +
            'si la vacante no tiene <i>temporal</i> ni <i>empresa usuaria</i>, la columna sale vacía.<br>' +
            'En los cruces <b>adjuntos</b>, verifica que el archivo incluya una columna con esos valores.',
        });
        return;
      }

      // Ancho común para que "Oficina" quede SIEMPRE en la última columna,
      // aunque las bases de origen traigan distinta cantidad de columnas.
      let width = header.length;
      for (const r of alianzaRows) width = Math.max(width, r.cells.length);
      for (const r of apoyoRows) width = Math.max(width, r.cells.length);

      const pad = (cells: any[]): any[] => {
        const out = cells.slice(0, width);
        while (out.length < width) out.push('');
        return out;
      };
      const conOficina = (r: { cells: any[]; oficina: string }): any[] => [
        ...pad(r.cells),
        r.oficina,
      ];

      const headerOut = [...pad(header), 'Oficina'];

      const newWb = XLSX.utils.book_new();
      const wsTA = XLSX.utils.aoa_to_sheet([headerOut, ...alianzaRows.map(conOficina)]);
      const wsAL = XLSX.utils.aoa_to_sheet([headerOut, ...apoyoRows.map(conOficina)]);
      XLSX.utils.book_append_sheet(newWb, wsTA, 'Tu Alianza');
      XLSX.utils.book_append_sheet(newWb, wsAL, 'Apoyo Laboral');

      const out = XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
      const fileName = `bases_unidas_${from || 'sin_desde'}_a_${to || 'sin_hasta'}.xlsx`;
      saveAs(
        new Blob([out], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        fileName,
      );

      Swal.fire({
        icon: 'success',
        title: 'Descarga lista',
        html:
          `Rango: <b>${this.activeRangeLabel()}</b><br>` +
          `Generadas desde el sistema: <b>${totalGeneradas}</b> contratación(es) ` +
          `en ${oficinasGeneradas.length} oficina(s).<br>` +
          `Bases adjuntas combinadas: <b>${fuentes.size}</b>.<br>` +
          `<b>Tu Alianza:</b> ${alianzaRows.length} filas<br>` +
          `<b>Apoyo Laboral:</b> ${apoyoRows.length} filas<br>` +
          `<small>La última columna de cada hoja indica la oficina de origen.</small>`,
      });
    } catch (err: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error al combinar bases',
        text: err?.message ?? 'No se pudieron combinar los archivos de base.',
      });
    } finally {
      this.isExporting.set(false);
    }
  }

  private detectEmpresaColumn(header: any[], body: any[][]): number {
    const headerIdx = header.findIndex((h) => {
      const s = String(h ?? '').toLowerCase().trim();
      return (
        s === 'empresa' ||
        s === 'cliente' ||
        s === 'ta/al' ||
        s === 'ta_al' ||
        s === 'tipo' ||
        s.includes('empresa') ||
        s.includes('alianza') ||
        s.includes('apoyo')
      );
    });
    if (headerIdx >= 0) return headerIdx;

    const sample = body.slice(0, Math.min(30, body.length));
    let bestIdx = -1;
    let bestScore = 0;

    for (let c = 0; c < header.length; c++) {
      let score = 0;
      for (const row of sample) {
        const s = String(row[c] ?? '').trim().toUpperCase();
        if (
          s === 'TA' ||
          s === 'AL' ||
          s === 'ALIANZA' ||
          s === 'APOYO' ||
          s.includes('TU ALIANZA') ||
          s.includes('APOYO LABORAL')
        ) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = c;
      }
    }
    return bestIdx;
  }

  private classifyRow(
    row: any[],
    colIdx: number,
    sheetName: string,
  ): 'TA' | 'AL' | null {
    const normalize = (v: unknown) => String(v ?? '').trim().toUpperCase();

    if (colIdx >= 0) {
      const v = normalize(row[colIdx]);
      if (v === 'TA' || v.includes('TU ALIANZA') || v === 'ALIANZA') return 'TA';
      if (v === 'AL' || v.includes('APOYO LABORAL') || v === 'APOYO') return 'AL';
    }

    const sn = normalize(sheetName);
    if (sn.includes('ALIANZA') || sn === 'TA') return 'TA';
    if (sn.includes('APOYO') || sn === 'AL') return 'AL';

    for (const cell of row) {
      const v = normalize(cell);
      if (v === 'TA' || v.includes('TU ALIANZA')) return 'TA';
      if (v === 'AL' || v.includes('APOYO LABORAL')) return 'AL';
    }
    return null;
  }

  descargarDocumentosZip(tipo: 'cedulas' | 'traslados' | 'sst'): void {
    if (!this.isBrowser) return;

    // `sinManifiestos`: el ZIP trae únicamente los archivos, sin los .txt de
    // duplicados/faltantes adentro. El detalle se muestra en este modal.
    const config = {
      cedulas: {
        label: 'cédulas',
        headerPrefix: 'Cedulas',
        file: 'cedulas',
        noun: 'cédula',
        sinManifiestos: true,
      },
      traslados: {
        label: 'traslados',
        headerPrefix: 'Traslados',
        file: 'traslados',
        noun: 'traslado',
        sinManifiestos: false,
      },
      sst: {
        label: 'SST',
        headerPrefix: 'Sst',
        file: 'sst',
        noun: 'documento SST',
        sinManifiestos: false,
      },
    }[tipo];

    const from = this.activeFrom();
    const to = this.activeTo();

    this.isExporting.set(true);
    this.zipLabel.set(config.label);
    this.zipProgress.set(null);
    this.zipLoadedMb.set(0);
    this.zipTotalMb.set(null);

    const resetProgress = () => {
      this.isExporting.set(false);
      this.zipProgress.set(null);
      this.zipLoadedMb.set(0);
      this.zipTotalMb.set(null);
      this.zipLabel.set('');
    };

    this.reportesService
      .downloadDocumentosZip(tipo, {
        fechaDesde: from || undefined,
        fechaHasta: to || undefined,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(resetProgress),
      )
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.DownloadProgress) {
            const loadedMb = event.loaded / (1024 * 1024);
            this.zipLoadedMb.set(Math.round(loadedMb * 10) / 10);

            if (event.total && event.total > 0) {
              const totalMb = event.total / (1024 * 1024);
              this.zipTotalMb.set(Math.round(totalMb * 10) / 10);
              const pct = Math.min(99, Math.floor((event.loaded / event.total) * 100));
              this.zipProgress.set(pct);
            } else {
              this.zipProgress.set(null);
            }
            return;
          }

          if (event.type !== HttpEventType.Response) return;

          const blob = event.body;
          if (!blob || blob.size === 0) {
            Swal.fire({
              icon: 'warning',
              title: `Sin ${config.label}`,
              text: `No se encontraron documentos de ${config.label} para el rango seleccionado.`,
            });
            return;
          }

          this.zipProgress.set(100);
          const fileName = `${config.file}_${from || 'sin_desde'}_a_${to || 'sin_hasta'}.zip`;
          saveAs(blob, fileName);

          const headers = event.headers;
          const p = config.headerPrefix;
          const incluidas = Number(headers.get(`X-${p}-Incluidas`) || 0);
          const faltantes = Number(headers.get(`X-${p}-Faltantes`) || 0);
          const duplicadas = Number(headers.get(`X-${p}-Duplicadas`) || 0);
          const repesExtra = Number(headers.get(`X-${p}-Repeticiones-Extra`) || 0);
          const detalleRaw = headers.get(`X-${p}-Duplicadas-Detalle`) || '';
          const truncado = headers.get(`X-${p}-Duplicadas-Truncado`) === '1';
          const manifestLabel = config.file.toUpperCase();

          type DupItem = { cedula: string; sedes: string[]; veces: number };
          let detalle: DupItem[] = [];
          if (detalleRaw) {
            try {
              detalle = JSON.parse(decodeURIComponent(detalleRaw));
            } catch {
              detalle = [];
            }
          }

          const escapeHtml = (s: string): string =>
            String(s ?? '')
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');

          let extraHtml = '';
          if (duplicadas > 0) {
            extraHtml +=
              `<div style="margin-top:14px; text-align:left;">` +
              `<div style="font-weight:600; color:#92400e;">` +
              `⚠️ ${duplicadas} ${config.noun}(s) duplicado(s) — ${repesExtra} repetición(es) extra` +
              `</div>`;

            if (detalle.length > 0) {
              const rows = detalle
                .map(
                  (d) =>
                    `<tr>` +
                    `<td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-family:ui-monospace,monospace;">${escapeHtml(d.cedula)}</td>` +
                    `<td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;">${escapeHtml(d.sedes.join(', '))}</td>` +
                    `<td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;text-align:center;">${d.veces}</td>` +
                    `</tr>`,
                )
                .join('');
              extraHtml +=
                `<div style="max-height:260px;overflow:auto;margin-top:8px;border:1px solid #e2e8f0;border-radius:8px;">` +
                `<table style="width:100%;border-collapse:collapse;font-size:0.88rem;">` +
                `<thead><tr style="background:#fef3c7;color:#78350f;">` +
                `<th style="text-align:left;padding:6px 8px;">Cédula</th>` +
                `<th style="text-align:left;padding:6px 8px;">Oficinas</th>` +
                `<th style="text-align:center;padding:6px 8px;">Veces</th>` +
                `</tr></thead><tbody>${rows}</tbody></table></div>`;
              if (truncado) {
                extraHtml +=
                  `<div style="margin-top:6px;font-size:0.82rem;color:#64748b;">` +
                  `Se muestran los primeros ${detalle.length} ${config.noun}(s) duplicado(s).` +
                  (config.sinManifiestos
                    ? ''
                    : ` El detalle completo está en <b>_${manifestLabel}_DUPLICADAS.txt</b> dentro del ZIP.`) +
                  `</div>`;
              }
            }
            extraHtml += `</div>`;
          }

          if (faltantes > 0) {
            extraHtml +=
              `<div style="margin-top:14px; text-align:left;">` +
              `<div style="font-weight:600; color:#991b1b;">` +
              `❌ ${faltantes} ${config.noun}(s) están en BD pero falta el archivo en almacenamiento` +
              `</div>` +
              `<div style="font-size:0.85rem;color:#475569;margin-top:4px;">` +
              (config.sinManifiestos
                ? `Esos registros no quedaron dentro del ZIP.`
                : `Detalle dentro del ZIP en <b>_${manifestLabel}_FALTANTES.txt</b>.`) +
              `</div></div>`;
          }

          Swal.fire({
            icon: duplicadas > 0 || faltantes > 0 ? 'warning' : 'success',
            title: 'Descarga lista',
            width: duplicadas > 0 ? 720 : undefined,
            html:
              `<div style="text-align:left;">` +
              `Se generó el ZIP de ${config.label} para el rango ` +
              `<b>${this.activeRangeLabel()}</b>.<br>` +
              `Archivos incluidos: <b>${incluidas}</b>.` +
              `</div>` +
              extraHtml,
          });
        },
        error: (err) => {
          Swal.fire({
            icon: 'error',
            title: 'Error al descargar',
            text:
              err?.message ??
              `Ocurrió un error al descargar el ZIP de ${config.label}.`,
          });
        },
      });
  }
}
