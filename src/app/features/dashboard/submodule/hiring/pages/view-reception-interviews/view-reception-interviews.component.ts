import { isPlatformBrowser } from '@angular/common';
import {  Component, DestroyRef, Inject, OnInit, PLATFORM_ID , ChangeDetectionStrategy } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';

// ❌ NO import estático de Swal (evita problemas SSR/prerender)
// import Swal from 'sweetalert2';

import { SharedModule } from '@/app/shared/shared.module';
import { DateRangeDialogComponent } from '@/app/shared/components/date-rang-dialog/date-rang-dialog.component';
import { InfoVacantesService } from '../../service/info-vacantes/info-vacantes.service';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { SedeScopeService } from '@/app/shared/services/sede-scope/sede-scope.service';
import { ColumnCellTemplateDirective } from '@/app/shared/directives/column-cell-template.directive';

type FlatRow = Record<string, any>;
type ExportCol = { header: string; key: string; width?: number };

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-view-reception-interviews',
  standalone: true,
  imports: [SharedModule, StandardFilterTable, MatDialogModule, ColumnCellTemplateDirective],
  templateUrl: './view-reception-interviews.component.html',
  styleUrls: ['./view-reception-interviews.component.css'],
} )
export class ViewReceptionInterviewsComponent implements OnInit {
  private readonly isBrowser: boolean;

  title = 'Entrevistas (HOY)';
  isLoading = false;

  rows: FlatRow[] = [];
  columns: ColumnDefinition[] = [];

  oficina = '';
  /** Oficinas sobre las que el usuario puede operar (multi-sede V62). */
  oficinasDisponibles: string[] = [];
  /** true si hay más de una: entonces se muestra el selector de oficina. */
  puedeElegirOficina = false;

  private readonly EXPORT_COLS: ExportCol[] = [
    { header: 'Entrevista - Fecha/Hora (última)', key: 'entrevista_fecha_ultima', width: 26 },
    { header: 'Entrevista - Oficina', key: 'entrevista_oficina', width: 18 },
    { header: 'Entrevista - ¿Cómo se enteró?', key: 'entrevista_como_entero', width: 30 },
    { header: 'Entrevista - ¿Cómo se proyecta a un año?', key: 'entrevista_como_proyecta', width: 34 },

    { header: 'Candidato - Tipo doc', key: 'cand_tipo_doc', width: 16 },
    { header: 'Candidato - Nº documento', key: 'cand_num_doc', width: 18 },

    { header: 'Proceso - Entrevistado', key: 'proc_entrevistado', width: 16 },
    { header: 'Proceso - Prueba técnica', key: 'proc_prueba_tecnica', width: 18 },
    { header: 'Proceso - Autorizado', key: 'proc_autorizado', width: 14 },
    { header: 'Proceso - Exámenes médicos', key: 'proc_examenes_medicos', width: 20 },
    { header: 'Proceso - Contratado', key: 'proc_contratado', width: 14 },

    { header: 'Candidato - Primer apellido', key: 'cand_primer_apellido', width: 18 },
    { header: 'Candidato - Segundo apellido', key: 'cand_segundo_apellido', width: 18 },
    { header: 'Candidato - Primer nombre', key: 'cand_primer_nombre', width: 18 },
    { header: 'Candidato - Segundo nombre', key: 'cand_segundo_nombre', width: 18 },

    { header: 'Candidato - Fecha de nacimiento', key: 'cand_fecha_nac', width: 18 },
    { header: 'Candidato - Edad', key: 'cand_edad', width: 10 },
    { header: 'Candidato - Estado civil', key: 'cand_estado_civil', width: 14 },

    { header: 'Info CC - Fecha de expedición', key: 'infocc_fecha_expedicion', width: 18 },

    { header: 'Residencia - Barrio', key: 'res_barrio', width: 22 },
    { header: 'Residencia - ¿Hace cuánto vive en la zona?', key: 'res_hace_cuanto', width: 28 },

    { header: 'Contacto - WhatsApp', key: 'cont_whatsapp', width: 16 },
    { header: 'Contacto - Teléfono', key: 'cont_telefono', width: 16 },

    { header: 'Candidato - Sexo', key: 'cand_sexo', width: 10 },

    { header: 'Experiencia - ¿Tiene?', key: 'exp_tiene', width: 14 },
    { header: 'Contacto - Email', key: 'cont_email', width: 26 },

    { header: 'Experiencias - Empresas (todas)', key: 'exps_empresas', width: 32 },
    { header: 'Experiencia - Labores realizadas', key: 'exps_labores', width: 40 },

    { header: 'Formación - Nivel', key: 'form_nivel', width: 18 },

    { header: 'Hijos - ¿Tiene?', key: 'hijos_tiene', width: 12 },
    { header: 'Hijos - ¿Cuántos?', key: 'hijos_cuantos', width: 14 },
    { header: 'Hijos - Edades (coma)', key: 'hijos_edades', width: 18 },

    { header: 'Vivienda - Responsable hijos', key: 'viv_responsable_hijos', width: 22 },
    { header: 'Vivienda - Personas con quien convive', key: 'viv_convive', width: 28 },
    { header: 'Vivienda - ¿Estudia actualmente?', key: 'viv_estudia', width: 20 },

    { header: 'Proceso - Aplica / No aplica', key: 'proc_aplica', width: 18 },
    { header: 'Proceso - Motivo no aplica', key: 'proc_motivo_no_aplica', width: 26 },
    { header: 'Proceso - Motivo en espera', key: 'proc_motivo_espera', width: 26 },

    { header: 'Publicación - Finca', key: 'pub_finca', width: 22 },
    { header: 'Publicación - Cargo', key: 'pub_cargo', width: 22 },
    { header: 'Publicación - Fecha de prueba', key: 'pub_fecha_prueba', width: 18 },

    { header: 'Proceso - Detalle', key: 'proc_detalle', width: 40 },
  ];

  constructor(
    private readonly infoVacantesService: InfoVacantesService,
    private readonly utilityService: UtilityServiceService,
    private readonly sedeScope: SedeScopeService,
    private readonly dialog: MatDialog,
    private readonly destroyRef: DestroyRef,
    @Inject(PLATFORM_ID) platformId: Object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);

    this.columns = this.EXPORT_COLS.map((c) => {
      const type: ColumnDefinition['type'] =
        c.key === 'entrevista_fecha_ultima'
          ? 'date'
          : c.key === 'cand_edad' || c.key === 'hijos_cuantos'
            ? 'number'
            : 'text';

      const widthPx = c.width ? Math.min(520, Math.max(120, c.width * 7)) : undefined;

      return {
        name: c.key,
        header: c.header,
        type,
        width: widthPx ? `${widthPx}px` : undefined,
        filterable: true,
        sortable: true,
      } as ColumnDefinition;
    });
  }

  ngOnInit(): void {
    if (this.isBrowser) {
      // Multi-sede (V62): arranca en la sede ACTIVA, pero quien tenga varias puede
      // moverse entre ellas. El endpoint agrupa por UNA oficina, así que el selector
      // cambia de oficina en vez de sumarlas.
      this.oficinasDisponibles = this.sedeScope.nombres();
      this.puedeElegirOficina = this.oficinasDisponibles.length > 1;
      const activa = this.sedeScope.activa()
        || String(this.utilityService.getUser?.()?.sede?.nombre ?? '');
      this.oficina = String(activa).trim();
    }
    this.loadInterviewsToday();
  }

  /** Cambio de oficina desde el selector: recarga la tabla del día. */
  onOficinaChange(): void {
    this.loadInterviewsToday();
  }

  loadInterviewsToday(): void {
    this.isLoading = true;

    const oficina = this.normalizeOffice(this.oficina);

    this.infoVacantesService
      .getCandidatosEntrevistasHoy({ full: true, oficina })
      .pipe(
        finalize(() => (this.isLoading = false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (data) => (this.rows = this.flattenCandidates(data || [])),
        error: async (err) => {
          console.error(err);
          await this.swalFire('Error', 'No se pudo cargar la información de hoy.', 'error');
          this.rows = [];
        },
      });
  }

  openRangeDialogAndExport(): void {
    if (!this.isBrowser) return;

    const ref = this.dialog.open(DateRangeDialogComponent, {
      width: '420px',
      data: { title: 'Descargar Excel por rango' },
    });

    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (raw: any) => {
        const meta = this.extractRangeMeta(raw);

        if (!meta) {
          await this.swalFire('Atención', 'Debes seleccionar un rango de fechas válido.', 'info');
          return;
        }

        this.exportRangeExcel(meta);
      });
  }

  // =========================================================
  // ✅ soporta múltiples llaves/formats
  // =========================================================
  private extractRangeMeta(raw: any): { from: string; to: string; oficina?: string } | null {
    if (!raw) return null;

    const fromRaw =
      raw.from ?? raw.start ?? raw.startDate ?? raw.dateFrom ?? raw.desde ?? raw.fechaInicio ?? raw.fecha_inicio;
    const toRaw = raw.to ?? raw.end ?? raw.endDate ?? raw.dateTo ?? raw.hasta ?? raw.fechaFin ?? raw.fecha_fin;

    const fromDate = this.coerceToDate(fromRaw);
    if (!fromDate) return null;

    const toDate = this.coerceToDate(toRaw) ?? fromDate;

    const from = this.formatDateYYYYMMDD(fromDate);
    const to = this.formatDateYYYYMMDD(toDate);

    const oficina = this.normalizeOffice(
      raw.oficina ?? raw.office ?? raw.sede ?? raw.oficinaSeleccionada ?? this.oficina,
    );

    return { from, to, oficina };
  }

  private coerceToDate(value: any): Date | null {
    if (!value) return null;

    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }

    const s = String(value).trim();
    if (!s) return null;

    // yyyy-mm-dd -> Date LOCAL
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mm = Number(m[2]);
      const d = Number(m[3]);
      const dt = new Date(y, mm - 1, d);
      return isNaN(dt.getTime()) ? null : dt;
    }

    const dt = new Date(s);
    return isNaN(dt.getTime()) ? null : dt;
  }

  private exportRangeExcel(meta: { from: string; to: string; oficina?: string }): void {
    if (!this.isBrowser) return;

    const labelOffice = meta.oficina ? ` | Oficina: ${meta.oficina}` : '';

    this.swalLoading('Generando Excel...', `Rango ${meta.from} → ${meta.to}${labelOffice}`);

    this.infoVacantesService
      .getCandidatosEntrevistasRango({ from: meta.from, to: meta.to, full: true, oficina: meta.oficina })
      .pipe(
        finalize(() => this.swalClose()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: async (data) => {
          const rows = this.flattenCandidates(data || []);
          await this.buildAndDownloadExcel(rows, meta);
          await this.swalFire('Listo', 'Excel generado correctamente.', 'success');
        },
        error: async (err) => {
          console.error(err);
          await this.swalFire('Error', 'No se pudo generar el Excel del rango.', 'error');
        },
      });
  }

  private normalizeOffice(value: unknown): string | undefined {
    const s = String(value ?? '').trim();
    return s.length ? s : undefined;
  }

  private formatDateYYYYMMDD(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // =========================================================
  // 👇 Data mapping
  // =========================================================
  private flattenCandidates(candidatos: any[]): FlatRow[] {
    return (candidatos || []).map((c) => {
      const contacto = c?.contacto || {};
      const residencia = c?.residencia || {};
      const infoCc = c?.info_cc || {};
      const vivienda = c?.vivienda || {};
      const formaciones: any[] = Array.isArray(c?.formaciones) ? c.formaciones : [];
      const experiencias: any[] = Array.isArray(c?.experiencias) ? c.experiencias : [];
      const hijos: any[] = Array.isArray(c?.hijos) ? c.hijos : [];
      const entrevistas: any[] = Array.isArray(c?.entrevistas) ? c.entrevistas : [];

      const lastEnt = this.pickLastInterview(entrevistas);
      const proceso = lastEnt?.proceso || {};
      const publicacion = proceso?.publicacion || {};

      const edadCand = this.calcAge(c?.fecha_nacimiento);

      const empresas = this.uniqueJoin(experiencias.map((x) => x?.empresa).filter(Boolean));
      const labores = this.uniqueJoin(
        experiencias
          .map((x) => x?.labores_realizadas || x?.labores_principales || x?.labores_especificas)
          .filter(Boolean),
      );

      const formNivel = this.uniqueJoin(
        formaciones.map((x) => x?.nivel || x?.nivel_educativo || x?.titulo || x?.formacion || x?.grado).filter(Boolean),
      );

      const hijosTiene = hijos.length > 0;
      const hijosEdades = hijos
        .map((h) => this.calcAge(h?.fecha_nac) ?? h?.edad)
        .filter((v) => v !== null && v !== undefined && v !== '')
        .join(', ');

      return {
        entrevista_fecha_ultima: this.toDate(lastEnt?.updated_at || lastEnt?.created_at),
        entrevista_oficina: lastEnt?.oficina ?? '',
        entrevista_como_entero: lastEnt?.como_se_entero ?? '',
        entrevista_como_proyecta: lastEnt?.como_se_proyecta ?? '',

        cand_tipo_doc: c?.tipo_doc ?? '',
        cand_num_doc: c?.numero_documento ?? '',

        proc_entrevistado: this.yesNo(proceso?.entrevistado),
        proc_prueba_tecnica: this.yesNo(proceso?.prueba_tecnica),
        proc_autorizado: this.yesNo(proceso?.autorizado),
        proc_examenes_medicos: this.yesNo(proceso?.examenes_medicos ?? proceso?.examen_medico),
        proc_contratado: this.yesNo(proceso?.contratado),

        cand_primer_apellido: c?.primer_apellido ?? '',
        cand_segundo_apellido: c?.segundo_apellido ?? '',
        cand_primer_nombre: c?.primer_nombre ?? '',
        cand_segundo_nombre: c?.segundo_nombre ?? '',

        cand_fecha_nac: c?.fecha_nacimiento ?? '',
        cand_edad: edadCand ?? '',
        cand_estado_civil: c?.estado_civil ?? '',

        infocc_fecha_expedicion: infoCc?.fecha_expedicion ?? '',

        res_barrio: residencia?.barrio ?? '',
        res_hace_cuanto: residencia?.hace_cuanto_vive ?? '',

        cont_whatsapp: contacto?.whatsapp ?? '',
        cont_telefono: contacto?.celular ?? contacto?.telefono ?? '',
        cont_email: contacto?.email ?? '',

        cand_sexo: c?.sexo ?? '',
        exp_tiene: experiencias.length > 0 ? 'SI' : 'NO',

        exps_empresas: empresas,
        exps_labores: labores,

        form_nivel: formNivel,

        hijos_tiene: hijosTiene ? 'SI' : 'NO',
        hijos_cuantos: hijos.length,
        hijos_edades: hijosEdades,

        viv_responsable_hijos: vivienda?.responsable_hijos ?? '',
        viv_convive: vivienda?.personas_con_quien_convive ?? vivienda?.convive_con ?? '',
        viv_estudia: this.yesNo(vivienda?.estudia_actualmente ?? vivienda?.estudia),

        proc_aplica: proceso?.aplica ?? proceso?.aplica_o_no_aplica ?? '',
        proc_motivo_no_aplica: proceso?.motivo_no_aplica ?? '',
        proc_motivo_espera: proceso?.motivo_espera ?? proceso?.motivo_en_espera ?? '',

        pub_finca: publicacion?.finca ?? publicacion?.nombre_finca ?? '',
        pub_cargo: publicacion?.cargo ?? publicacion?.nombre_cargo ?? '',
        pub_fecha_prueba: publicacion?.fecha_prueba ?? '',

        proc_detalle: proceso?.detalle ?? proceso?.observaciones ?? '',
      };
    });
  }

  private pickLastInterview(entrevistas: any[]): any | null {
    if (!entrevistas?.length) return null;
    return entrevistas.reduce((best, cur) => {
      const bd = this.parseServerDate(best?.updated_at || best?.created_at)?.getTime() ?? 0;
      const cd = this.parseServerDate(cur?.updated_at || cur?.created_at)?.getTime() ?? 0;
      return cd >= bd ? cur : best;
    }, entrevistas[0]);
  }

  private toDate(value: any): Date | null {
    return this.parseServerDate(value);
  }

  /**
   * - Con zona (Z o +hh:mm) => new Date(...)
   * - Sin zona (yyyy-mm-ddTHH:mm:ss o "yyyy-mm-dd HH:mm:ss") => se asume UTC
   * - Solo fecha yyyy-mm-dd => fecha local
   */
  private parseServerDate(value: any): Date | null {
    if (!value) return null;

    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }

    const s0 = String(value).trim();
    if (!s0) return null;

    const s = s0.includes(' ') && !s0.includes('T') ? s0.replace(' ', 'T') : s0;

    if (/[zZ]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }

    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);

      if (!m[4]) {
        const local = new Date(y, mo - 1, d);
        return isNaN(local.getTime()) ? null : local;
      }

      const hh = Number(m[4]);
      const mm = Number(m[5]);
      const ss = m[6] ? Number(m[6]) : 0;
      const ms = m[7] ? Number(String(m[7]).padEnd(3, '0')) : 0;

      const utcMs = Date.UTC(y, mo - 1, d, hh, mm, ss, ms);
      const utcDate = new Date(utcMs);
      return isNaN(utcDate.getTime()) ? null : utcDate;
    }

    const d = new Date(s0);
    return isNaN(d.getTime()) ? null : d;
  }

  private calcAge(dateStr?: string): number | null {
    if (!dateStr) return null;

    // Si viene yyyy-mm-dd, usar local sin corrimiento
    const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(dateStr);

    if (isNaN(d.getTime())) return null;

    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const mm = now.getMonth() - d.getMonth();
    if (mm < 0 || (mm === 0 && now.getDate() < d.getDate())) age--;
    return age;
  }

  private yesNo(v: any): string {
    if (v === true) return 'SI';
    if (v === false) return 'NO';
    if (typeof v === 'string') {
      const s = v.trim().toUpperCase();
      if (['SI', 'SÍ', 'YES', 'TRUE', '1'].includes(s)) return 'SI';
      if (['NO', 'FALSE', '0'].includes(s)) return 'NO';
      return v;
    }
    if (v === 1) return 'SI';
    if (v === 0) return 'NO';
    return '';
  }

  private uniqueJoin(values: any[]): string {
    const set = new Set<string>();
    (values || []).forEach((v) => {
      const s = String(v ?? '').trim();
      if (s) set.add(s);
    });
    return Array.from(set).join(', ');
  }

  private async buildAndDownloadExcel(rows: FlatRow[], meta: { from: string; to: string; oficina?: string }): Promise<void> {
    if (!this.isBrowser) return;

    const excelJSImport: any = await import('exceljs');
    const WorkbookCtor = excelJSImport?.Workbook ?? excelJSImport?.default?.Workbook;
    if (!WorkbookCtor) throw new Error('No se pudo cargar ExcelJS.Workbook');

    const fileSaver: any = await import('file-saver');
    const saveAs: (blob: Blob, filename: string) => void = fileSaver?.saveAs ?? fileSaver?.default?.saveAs;
    if (!saveAs) throw new Error('No se pudo cargar file-saver.saveAs');

    const workbook = new WorkbookCtor();
    workbook.creator = 'Sistema';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Entrevistas', {
      views: [{ state: 'frozen', ySplit: 3 }],
      properties: { defaultRowHeight: 18 },
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    // ======= Paleta =======
    const BRAND = 'FF0C2771';
    const BRAND_2 = 'FF1B46C2';
    const SOFT = 'FFF4F7FF';
    const HEADER = BRAND_2;
    const HEADER_TXT = 'FFFFFFFF';
    const BORDER = 'FFE5E7EB';
    const ZEBRA = 'FFF8FAFF';
    const OK = 'FFD1FAE5';
    const NO = 'FFFEE2E2';

    const colCount = this.EXPORT_COLS.length;

    // ======= Título / Subtítulo =======
    const title = 'REPORTE DE ENTREVISTAS';

    const generated = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date());

    const subtitleParts = [
      `Rango: ${meta.from} a ${meta.to}`,
      meta.oficina ? `Oficina: ${meta.oficina}` : null,
      `Generado: ${generated}`,
    ].filter(Boolean) as string[];

    sheet.mergeCells(1, 1, 1, colCount);
    const t = sheet.getCell(1, 1);
    t.value = title;
    t.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    t.alignment = { vertical: 'middle', horizontal: 'center' };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    sheet.getRow(1).height = 28;

    sheet.mergeCells(2, 1, 2, colCount);
    const st = sheet.getCell(2, 1);
    st.value = subtitleParts.join('   |   ');
    st.font = { italic: true, size: 11, color: { argb: BRAND } };
    st.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    st.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
    sheet.getRow(2).height = 20;

    // ======= Columnas =======
    sheet.columns = this.EXPORT_COLS.map((c) => ({
      key: c.key,
      width: c.width ?? 18,
      style: { alignment: { vertical: 'top', wrapText: true } },
    }));

    // ======= Header (fila 3) ✅ sin columna vacía =======
    const headerRow = sheet.getRow(3);
    headerRow.height = 34;
    headerRow.font = { bold: true, size: 11, color: { argb: HEADER_TXT } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    this.EXPORT_COLS.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = col.header;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER } };
      cell.border = {
        top: { style: 'thin', color: { argb: BORDER } },
        left: { style: 'thin', color: { argb: BORDER } },
        bottom: { style: 'thin', color: { argb: BORDER } },
        right: { style: 'thin', color: { argb: BORDER } },
      };
    });

    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: colCount } };

    // ======= Datos =======
    const normalizeText = (v: any) => (typeof v === 'string' ? v.normalize('NFC') : v);

    const safeRows = (rows || []).map((r) => {
      const out: any = {};
      this.EXPORT_COLS.forEach((c) => (out[c.key] = normalizeText(r?.[c.key] ?? '')));
      return out;
    });

    safeRows.forEach((obj) => sheet.addRow(obj));

    // ======= Estilos por celda: zebra, bordes, formatos, SI/NO =======
    const lastRow = sheet.lastRow?.number ?? 3;

    const dateKeys = new Set<string>([
      'entrevista_fecha_ultima',
      'cand_fecha_nac',
      'infocc_fecha_expedicion',
      'pub_fecha_prueba',
    ]);
    const numKeys = new Set<string>(['cand_edad', 'hijos_cuantos']);

    const keyByIndex = (idx: number) => this.EXPORT_COLS[idx - 1]?.key;

    for (let r = 4; r <= lastRow; r++) {
      const row = sheet.getRow(r);
      row.height = 18;

      const zebraFill = r % 2 === 0 ? ZEBRA : 'FFFFFFFF';

      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        const key = keyByIndex(c);

        cell.border = {
          top: { style: 'thin', color: { argb: BORDER } },
          left: { style: 'thin', color: { argb: BORDER } },
          bottom: { style: 'thin', color: { argb: BORDER } },
          right: { style: 'thin', color: { argb: BORDER } },
        };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebraFill } };
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };

        // fechas
        if (key && dateKeys.has(key)) {
          const d = this.parseServerDate(cell.value);
          if (d && !isNaN(d.getTime())) {
            cell.value = d;
            cell.numFmt = key === 'entrevista_fecha_ultima' ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd';
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          }
        }

        // números
        if (key && numKeys.has(key)) {
          const v = cell.value as any;
          const n = typeof v === 'number' ? v : String(v).trim() ? Number(v) : NaN;
          if (!Number.isNaN(n)) {
            cell.value = n;
            cell.numFmt = '0';
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          }
        }

        // SI / NO (colorea)
        const s = String(cell.value ?? '').trim().toUpperCase();
        if (s === 'SI' || s === 'SÍ') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OK } };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          cell.font = { bold: true };
        } else if (s === 'NO') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NO } };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          cell.font = { bold: true };
        }
      }

      row.commit();
    }

    sheet.pageSetup.margins = {
      left: 0.25,
      right: 0.25,
      top: 0.35,
      bottom: 0.35,
      header: 0.2,
      footer: 0.2,
    };

    const baseName = meta.from === meta.to ? `entrevistas_${meta.from}` : `entrevistas_${meta.from}_a_${meta.to}`;
    const safeOffice = meta.oficina ? String(meta.oficina).trim().replace(/\s+/g, '_') : '';
    const filename = safeOffice ? `${baseName}_${safeOffice}.xlsx` : `${baseName}.xlsx`;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    saveAs(blob, filename);
  }

  // =========================================================
  // ✅ SweetAlert2 SSR-safe (lazy load)
  // =========================================================
  private async swal(): Promise<any | null> {
    if (!this.isBrowser) return null;
    const mod: any = await import('sweetalert2');
    return mod?.default ?? mod;
  }

  private async swalFire(title: string, text: string, icon: 'success' | 'error' | 'info' | 'warning' | 'question') {
    const Swal = await this.swal();
    if (!Swal) return;
    return Swal.fire({ title, text, icon });
  }

  private async swalLoading(title: string, text: string) {
    const Swal = await this.swal();
    if (!Swal) return;
    return Swal.fire({
      title,
      text,
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });
  }

  private async swalClose() {
    const Swal = await this.swal();
    if (!Swal) return;
    Swal.close();
  }
}
