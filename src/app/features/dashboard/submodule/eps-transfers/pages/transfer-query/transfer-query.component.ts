import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, ViewChild, ElementRef } from '@angular/core';
import { TrasladosService } from '../../service/traslados.service';
import { SharedModule } from '@/app/shared/shared.module';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import Swal from 'sweetalert2';
import { MatTableDataSource } from '@angular/material/table';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ElectronWindowService } from '@/app/core/services/electron-window.service';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';
import { DateRangeDialogComponent } from '@/app/shared/components/date-rang-dialog/date-rang-dialog.component';
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { environment } from '@/environments/environment';

/**
 * Los archivos fisicos de gestion_documental viven siempre en el server de
 * produccion sin importar si la app esta apuntando a dev o LAN: el upload
 * se hizo ahi y los discos no se replican entre ambientes. Por eso el
 * prefijo es fijo, no se toma de environment.apiUrl.
 */
const MEDIA_BASE_URL = 'https://formulario.tsservicios.co';

interface RangoFechas {
  start: string | null;
  end: string | null;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-transfer-query',
  imports: [
    SharedModule
  ],
  templateUrl: './transfer-query.component.html',
  styleUrl: './transfer-query.component.css'
})
export class TransferQueryComponent implements OnInit {
  myForm!: FormGroup;
  dataSource = new MatTableDataSource<any>([]);
  isExporting = false;
  isDeactivating = false;

  /** Solo GERENCIA, ADMIN y el correo de tuafiliacion ven los botones admin. */
  puedeAdministrar = false;

  @ViewChild('uploadDeactivateInput') uploadDeactivateInput?: ElementRef<HTMLInputElement>;

  displayedColumns: string[] = [
    'codigo_traslado',
    'solicitud_traslado',
    'eps_a_trasladar',
    'responsable',
    'estado_del_traslado'
  ];

  constructor(
    private trasladosService: TrasladosService,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef,
    private electronWindow: ElectronWindowService,
    private dialog: MatDialog,
    private utilityService: UtilityServiceService,
  ) {
    this.myForm = this.fb.group({
      cedula: ['', Validators.required],
    });
  }

  ngOnInit(): void {
    const user = this.utilityService.getUser();
    const rol = String(user?.rol?.nombre || '').toUpperCase();
    const correo = String(user?.correo_electronico || '').toLowerCase();
    this.puedeAdministrar =
      rol === 'GERENCIA' ||
      rol === 'ADMIN' ||
      correo === 'tuafiliacion@tsservicios.co';
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value.trim().toLowerCase();
    this.dataSource.filter = filterValue;
  }

  onSubmit(): void {
    if (this.myForm.valid) {
      this.trimField('cedula');

      Swal.fire({
        title: 'Buscando información...',
        html: 'Por favor, espere.',
        icon: 'info',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });

      this.trasladosService.buscarAfiliacionPorId(this.myForm.value.cedula).subscribe(
        (data: any) => {
          Swal.close();
          this.dataSource.data = Array.isArray(data) ? data : (data?.results || data?.data || []);
          this.cdr.markForCheck();
        },
        (_error: any) => {
          Swal.close();
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se pudo realizar la consulta. Por favor, inténtelo de nuevo más tarde.',
          });
          this.cdr.markForCheck();
        }
      );
    }
  }


  private trimField(fieldName: string) {
    const control = this.myForm.get(fieldName);
    if (control && control.value && typeof control.value === 'string') {
      control.setValue(control.value.trim());
    }
  }

  verDocumento(solicitud: string): void {
    this.electronWindow.openDocument(solicitud, { title: 'Solicitud de traslado' });
  }

  // ====================================================================
  // Helpers de UI para badges de estado en la tabla.
  // ====================================================================
  private normalizarEstado(raw: string | null | undefined): string {
    return String(raw || '').trim().toLowerCase();
  }

  estadoEsOk(raw: string | null | undefined): boolean {
    const e = this.normalizarEstado(raw);
    return e === 'aceptado' || e === 'aprobado' || e === 'efectivo' || e === 'efectivos';
  }

  estadoEsPendiente(raw: string | null | undefined): boolean {
    const e = this.normalizarEstado(raw);
    return e === 'pendiente' || e === 'en proceso' || e === 'en curso' || e === 'asignado';
  }

  estadoEsRechazado(raw: string | null | undefined): boolean {
    const e = this.normalizarEstado(raw);
    return e === 'rechazado' || e === 'no efectivo' || e === 'devuelto' || e === 'cancelado';
  }

  /**
   * Resuelve la URL del PDF a abrir desde el response del backend.
   * Prioridad: solicitud_doc.file_url (gestion_documental) > external_url (Drive).
   * Fallback al campo legacy solicitud_traslado solo si todavia existe.
   *
   * El backend devuelve `solicitud_doc.file_url` como path Windows absoluto
   * (`C:\\media\\...\\file.pdf`) en vez de URL HTTP, asi que aqui se recorta
   * desde `/media/` y se prefija con MEDIA_BASE_URL.
   */
  resolveSolicitudUrl(element: any): string | null {
    // Prioridad #1: documento subido a ms-documents. El 83% de los traslados
    // tienen document_id con file_url NULL (external_url ""), así que sin esto
    // la columna decía "Sin documento" y el botón Ver nunca abría el PDF.
    // El endpoint /api/v1/documents/{id}/download entrega el PDF (con JWT).
    const docId = element?.solicitud_doc?.document_id;
    if (docId) {
      return `${environment.apiUrl}/api/v1/documents/${docId}/download`;
    }

    const raw = (
      element?.solicitud_doc?.file_url ||
      element?.external_url ||
      element?.solicitud_traslado ||
      null
    );
    if (!raw) return null;

    let url = String(raw).trim();
    if (!url) return null;

    // Ya es URL absoluta (http(s), data:, blob:, file:)
    if (/^(https?:|data:|blob:|file:)/i.test(url)) return url;

    // Normalizamos separadores de Windows.
    url = url.replace(/\\/g, '/');

    // Si tiene "/media/" en algun punto, extraemos desde ahi.
    const idx = url.toLowerCase().indexOf('/media/');
    if (idx >= 0) {
      const path = url.substring(idx); // empieza con "/media/..."
      return `${MEDIA_BASE_URL}${path}`;
    }

    return null;
  }

  /**
   * "2025-09-04 14:23:11.123456" -> Date local.
   */
  private parseFechaUltimasActualizaciones(raw: string): Date | null {
    if (!raw) return null;
    const normal = raw.replace(' ', 'T');
    const d = new Date(normal);
    return isNaN(d.getTime()) ? null : d;
  }

  /** "2025-09-04 14:23" a partir de un Date. */
  private formatFechaCorta(d: Date | null): string {
    if (!d) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /**
   * `ultimas_actualizaciones` es el JSON { "<timestamp>": "<estado>" } que el
   * backend acumula en cada cambio de estado (subida, separacion, radicado,
   * efectivo, etc.). Devuelve el historial completo ordenado de lo mas
   * antiguo a lo mas reciente.
   *
   * En algunas filas viejas el campo llega como string JSON en vez de dict,
   * por eso se intenta parsear antes de recorrerlo.
   */
  private getHistorialEstados(element: any): { fecha: Date | null; estado: string; clave: string }[] {
    let ua = element?.ultimas_actualizaciones;
    if (typeof ua === 'string') {
      try {
        ua = JSON.parse(ua);
      } catch {
        return [];
      }
    }
    if (!ua || typeof ua !== 'object' || Array.isArray(ua)) return [];

    return Object.entries(ua as Record<string, unknown>)
      .filter(([clave]) => !!clave)
      .map(([clave, estado]) => ({
        clave,
        fecha: this.parseFechaUltimasActualizaciones(clave),
        estado: String(estado ?? '').trim() || 'Sin estado',
      }))
      .sort((a, b) => {
        const ta = a.fecha ? a.fecha.getTime() : Number.POSITIVE_INFINITY;
        const tb = b.fecha ? b.fecha.getTime() : Number.POSITIVE_INFINITY;
        if (ta !== tb) return ta - tb;
        return a.clave.localeCompare(b.clave);
      });
  }

  /** Historial en texto multilinea para la celda del Excel. */
  private historialEstadosTexto(element: any): string {
    const historial = this.getHistorialEstados(element);
    if (historial.length === 0) return 'Sin historial';

    return historial
      .map((h, i) => `${i + 1}) ${this.formatFechaCorta(h.fecha) || h.clave} -> ${h.estado}`)
      .join('\n');
  }

  /**
   * Para una fila ya retornada por el backend de exportar-por-fecha-subida,
   * usa _fecha_subida_iso si viene; si no, calcula desde ultimas_actualizaciones.
   */
  private getFechaSubida(element: any): Date | null {
    if (element?._fecha_subida_iso) {
      // "2026-07-21 17:49:48.394879+00:00": espacio en vez de T + microsegundos;
      // sin normalizar, algunos navegadores lo parsean como Invalid Date.
      const d = new Date(String(element._fecha_subida_iso).replace(' ', 'T'));
      if (!isNaN(d.getTime())) return d;
    }
    const ua = element?.ultimas_actualizaciones;
    if (ua && typeof ua === 'object') {
      const claves = Object.keys(ua).filter(k => !!k);
      if (claves.length > 0) {
        const masAntigua = [...claves].sort()[0];
        const d = this.parseFechaUltimasActualizaciones(masAntigua);
        if (d && !isNaN(d.getTime())) return d;
      }
    }
    if (element?.marca_temporal_solicitud) {
      // Instant serializado como epoch en SEGUNDOS; new Date() lo lee como ms
      // (→ 1970). Convertimos segundos→ms si viene numérico.
      const raw = element.marca_temporal_solicitud;
      const d = new Date(typeof raw === 'number' ? raw * 1000 : raw);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  /**
   * Abre el dialog de rango, consulta al backend TODOS los traslados activos
   * cuya fecha de subida cae en el rango (sin importar la cedula del form),
   * y genera el Excel profesional.
   */
  async descargarExcel(): Promise<void> {
    if (!this.puedeAdministrar) return;

    const dialogRef = this.dialog.open<DateRangeDialogComponent, void, RangoFechas>(
      DateRangeDialogComponent,
      { width: '550px', autoFocus: true, restoreFocus: true }
    );
    const rango = await firstValueFrom(dialogRef.afterClosed());
    if (rango === undefined) return;

    if (!rango.start && !rango.end) {
      const ok = await Swal.fire({
        icon: 'warning',
        title: 'Sin fechas',
        text: 'No elegiste rango. Esto puede traer toda la base. ¿Continuar?',
        showCancelButton: true,
        confirmButtonText: 'Sí, exportar todo',
        cancelButtonText: 'Cancelar',
      });
      if (!ok.isConfirmed) return;
    }

    this.isExporting = true;
    this.cdr.markForCheck();

    Swal.fire({
      title: 'Generando Excel...',
      html: 'Consultando traslados en el rango.',
      icon: 'info',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const data = await firstValueFrom(
        this.trasladosService.exportarPorFechaSubida(rango.start, rango.end)
      );
      const filas = Array.isArray(data) ? data : [];

      if (filas.length === 0) {
        Swal.close();
        Swal.fire({
          icon: 'info',
          title: 'Sin resultados',
          text: 'No hay traslados activos con fecha de subida dentro del rango seleccionado.',
        });
        return;
      }

      await this.generarExcel(filas, rango);
      Swal.close();
    } catch (_e) {
      Swal.close();
      Swal.fire({
        icon: 'error',
        title: 'No se pudo generar el Excel',
        text: 'Ocurrio un error al consultar el backend o construir el archivo.',
      });
    } finally {
      this.isExporting = false;
      this.cdr.markForCheck();
    }
  }

  /** Construye el workbook con los datos ya filtrados por el backend. */
  private async generarExcel(filas: any[], rango: RangoFechas): Promise<void> {
    const decoradas = filas
      .map(f => ({ raw: f, fechaSubida: this.getFechaSubida(f) }))
      .sort((a, b) => {
        const ta = a.fechaSubida ? a.fechaSubida.getTime() : Number.POSITIVE_INFINITY;
        const tb = b.fechaSubida ? b.fechaSubida.getTime() : Number.POSITIVE_INFINITY;
        return ta - tb;
      });

    const ahora = new Date();
    const sufijo = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}${String(ahora.getDate()).padStart(2, '0')}_${String(ahora.getHours()).padStart(2, '0')}${String(ahora.getMinutes()).padStart(2, '0')}`;
    const rangoLabel = this.labelRango(rango);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'TesoroApp';
    wb.created = ahora;
    wb.modified = ahora;

    const ws = wb.addWorksheet('Traslados', { views: [{ state: 'frozen', ySplit: 4 }] });

    ws.mergeCells('A1:L1');
    const tituloCell = ws.getCell('A1');
    tituloCell.value = 'Reporte de Traslados EPS';
    tituloCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    tituloCell.alignment = { vertical: 'middle', horizontal: 'center' };
    tituloCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF21263C' } };
    ws.getRow(1).height = 28;

    ws.mergeCells('A2:L2');
    const subCell = ws.getCell('A2');
    subCell.value = `Rango: ${rangoLabel}    |    Total: ${decoradas.length}    |    Generado: ${ahora.toLocaleString('es-CO')}`;
    subCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF4B5563' } };
    subCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(2).height = 18;

    ws.getRow(3).height = 6;

    // El indice de cada columna se usa mas abajo para alinear/formatear celdas.
    // Si se agrega o mueve una columna hay que revisar COL_* tambien.
    const columnas = [
      { header: 'Codigo Traslado', width: 18 },
      { header: 'Cedula', width: 16 },
      { header: 'Fecha de Subida', width: 22 },
      { header: 'EPS a Trasladar', width: 24 },
      { header: 'EPS Trasladada', width: 24 },
      { header: 'Responsable', width: 26 },
      { header: 'Estado Actual', width: 22 },
      { header: 'Historial de Estados', width: 46 },
      { header: 'Observacion', width: 32 },
      { header: 'Numero Radicado', width: 22 },
      { header: 'Fecha Efectividad', width: 20 },
      { header: 'Solicitud', width: 20 },
    ];

    const COL_CODIGO = 1;
    const COL_FECHA_SUBIDA = 3;
    const COL_HISTORIAL = 8;
    const COL_RADICADO = 10;
    const COL_FECHA_EFECTIVIDAD = 11;
    const COL_SOLICITUD = 12;

    const headerRow = ws.getRow(4);
    columnas.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF21263C' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF21263C' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'medium', color: { argb: 'FF8CD50A' } },
      };
      ws.getColumn(i + 1).width = c.width;
    });
    headerRow.height = 26;

    decoradas.forEach((entry, idx) => {
      const r = entry.raw;
      const url = this.resolveSolicitudUrl(r);
      const row = ws.getRow(5 + idx);

      const historial = this.historialEstadosTexto(r);
      const lineasHistorial = historial.split('\n').length;

      row.getCell(1).value = r.codigo_traslado ?? '';
      row.getCell(2).value = r.numero_cedula ?? '';
      row.getCell(3).value = entry.fechaSubida ?? null;
      row.getCell(4).value = r.eps_a_trasladar ?? '';
      row.getCell(5).value = r.eps_trasladada ?? '';
      row.getCell(6).value = r.responsable ?? '';
      row.getCell(7).value = r.estado_del_traslado ?? '';
      row.getCell(COL_HISTORIAL).value = historial;
      row.getCell(9).value = r.observacion_estado ?? '';
      row.getCell(10).value = r.numero_radicado ?? '';
      row.getCell(11).value = r.fecha_efectividad ?? '';

      const solicitudCell = row.getCell(COL_SOLICITUD);
      if (url) {
        solicitudCell.value = { text: 'Ver solicitud', hyperlink: url, tooltip: url };
        solicitudCell.font = { name: 'Calibri', size: 11, color: { argb: 'FF21263C' }, underline: true };
      } else {
        solicitudCell.value = 'Sin documento';
        solicitudCell.font = { name: 'Calibri', size: 11, color: { argb: 'FF94A3B8' }, italic: true };
      }

      const baseFont = { name: 'Calibri', size: 11 } as const;
      const banded = idx % 2 === 1;
      for (let c = 1; c <= columnas.length; c++) {
        const cell = row.getCell(c);
        if (c !== COL_SOLICITUD) cell.font = baseFont;
        if (c === COL_HISTORIAL) {
          cell.font = { name: 'Consolas', size: 10, color: { argb: 'FF334155' } };
        }
        cell.alignment = {
          vertical: c === COL_HISTORIAL ? 'top' : 'middle',
          horizontal:
            c === COL_CODIGO ||
            c === COL_FECHA_SUBIDA ||
            c === COL_RADICADO ||
            c === COL_FECHA_EFECTIVIDAD
              ? 'center'
              : 'left',
          wrapText: true,
        };
        cell.border = {
          top: { style: 'hair', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
          left: { style: 'hair', color: { argb: 'FFE2E8F0' } },
          right: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        };
        if (banded) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }

      row.getCell(COL_FECHA_SUBIDA).numFmt = 'yyyy-mm-dd hh:mm';
      // El historial es multilinea: la fila crece con la cantidad de estados.
      // Se limita a 12 lineas visibles para no romper la lectura del reporte
      // (el contenido completo sigue en la celda).
      row.height = Math.max(22, Math.min(lineasHistorial, 12) * 14);
    });

    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columnas.length } };
    ws.pageSetup.printTitlesRow = '1:4';
    ws.pageSetup.fitToPage = true;
    ws.pageSetup.fitToWidth = 1;
    ws.pageSetup.fitToHeight = 0;
    ws.pageSetup.orientation = 'landscape';
    ws.pageSetup.margins = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `traslados_${sufijo}.xlsx`);
  }

  /** Texto humano del rango para el subtitulo del Excel. */
  private labelRango(r: RangoFechas): string {
    if (!r.start && !r.end) return 'Todos';
    if (r.start && r.end) return `${r.start} a ${r.end}`;
    if (r.start) return `Desde ${r.start}`;
    return `Hasta ${r.end}`;
  }

  // ====================================================================
  // Desactivar masivo: subir Excel con codigos o cedulas y soft-delete.
  // ====================================================================

  /** Dispara el file picker para el Excel de desactivacion. */
  abrirSelectorDesactivar(): void {
    if (!this.puedeAdministrar) return;
    this.uploadDeactivateInput?.nativeElement.click();
  }

  /** Maneja el archivo elegido en el input file. */
  async onArchivoDesactivar(event: Event): Promise<void> {
    if (!this.puedeAdministrar) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset para que volver a elegir el mismo archivo dispare 'change'
    input.value = '';
    if (!file) return;

    if (!/\.xlsx?$/i.test(file.name)) {
      Swal.fire({ icon: 'error', title: 'Formato no soportado', text: 'Sube un archivo .xlsx o .xls' });
      return;
    }

    try {
      const { codigos, cedulas } = await this.parseExcelDesactivar(file);

      if (codigos.length === 0 && cedulas.length === 0) {
        Swal.fire({
          icon: 'info',
          title: 'Archivo vacio',
          text: 'No se encontraron codigos ni cedulas en el archivo.',
        });
        return;
      }

      const total = codigos.length + cedulas.length;
      const confirm = await Swal.fire({
        icon: 'warning',
        title: '¿Desactivar traslados?',
        html: `Se procesaran <b>${codigos.length}</b> codigo(s) y <b>${cedulas.length}</b> cedula(s).<br>
               Total entradas: <b>${total}</b>.<br><br>
               Los traslados se marcaran como inactivos (soft-delete).<br>
               No se borran de la BD ni se tocan los PDFs en gestion documental.`,
        showCancelButton: true,
        confirmButtonText: 'Si, desactivar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#b42318',
      });
      if (!confirm.isConfirmed) return;

      this.isDeactivating = true;
      this.cdr.markForCheck();

      Swal.fire({
        title: 'Desactivando...',
        icon: 'info',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
      });

      const resp: any = await firstValueFrom(
        this.trasladosService.desactivarTrasladosMasivo(codigos, cedulas)
      );

      Swal.close();
      Swal.fire({
        icon: 'success',
        title: 'Desactivacion completada',
        html: `
          <p><b>${resp?.desactivados ?? 0}</b> traslado(s) desactivado(s).</p>
          ${resp?.codigos_no_encontrados?.length
            ? `<p style="color:var(--warn-fg)">Codigos no encontrados: ${resp.codigos_no_encontrados.join(', ')}</p>`
            : ''}
        `,
      });

      // Refrescar la tabla actual si la cedula consultada esta entre las desactivadas.
      if (this.dataSource.data.length > 0) {
        this.dataSource.data = this.dataSource.data.filter(r =>
          !resp?.codigos_desactivados?.includes(r.codigo_traslado)
        );
      }
    } catch (e: any) {
      Swal.close();
      const detail = e?.error?.error || e?.message || 'No se pudo procesar el archivo.';
      Swal.fire({ icon: 'error', title: 'Error', text: detail });
    } finally {
      this.isDeactivating = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Lee la primera hoja del Excel y extrae codigos (numericos) y cedulas
   * (texto). Se aceptan archivos con cualquier estructura: por cada celda
   * de las primeras 2 columnas, se intenta clasificar.
   * - Numero entero -> codigo_traslado
   * - String/numero con > 6 digitos sin formato -> cedula
   * Si la columna A tiene header 'codigo' o 'cedula', respetamos esa pista.
   */
  private async parseExcelDesactivar(file: File): Promise<{ codigos: number[]; cedulas: string[] }> {
    const buffer = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) return { codigos: [], cedulas: [] };

    const codigosSet = new Set<number>();
    const cedulasSet = new Set<string>();

    // Detectar header en fila 1
    const firstA = String(ws.getCell('A1').text || '').trim().toLowerCase();
    const firstB = String(ws.getCell('B1').text || '').trim().toLowerCase();
    let headerCols: { col: number; tipo: 'codigo' | 'cedula' }[] = [];
    if (firstA.includes('codigo') || firstA.includes('código')) headerCols.push({ col: 1, tipo: 'codigo' });
    else if (firstA.includes('cedula') || firstA.includes('cédula') || firstA.includes('documento')) headerCols.push({ col: 1, tipo: 'cedula' });
    if (firstB.includes('codigo') || firstB.includes('código')) headerCols.push({ col: 2, tipo: 'codigo' });
    else if (firstB.includes('cedula') || firstB.includes('cédula') || firstB.includes('documento')) headerCols.push({ col: 2, tipo: 'cedula' });

    const startRow = headerCols.length > 0 ? 2 : 1;

    const tryAdd = (raw: any, tipo: 'codigo' | 'cedula' | 'auto') => {
      if (raw === null || raw === undefined) return;
      const txt = String(raw).trim();
      if (!txt) return;

      if (tipo === 'codigo' || (tipo === 'auto' && /^\d{1,9}$/.test(txt))) {
        const n = parseInt(txt, 10);
        if (!isNaN(n)) codigosSet.add(n);
      } else if (tipo === 'cedula' || tipo === 'auto') {
        // cedula: solo digitos, 6+ caracteres
        const soloDigitos = txt.replace(/[^0-9]/g, '');
        if (soloDigitos.length >= 6) cedulasSet.add(soloDigitos);
      }
    };

    if (headerCols.length > 0) {
      for (let r = startRow; r <= ws.rowCount; r++) {
        for (const hc of headerCols) {
          const cell = ws.getCell(r, hc.col);
          tryAdd(cell.value, hc.tipo);
        }
      }
    } else {
      // Sin header: probar columnas A y B con clasificacion automatica
      for (let r = 1; r <= ws.rowCount; r++) {
        tryAdd(ws.getCell(r, 1).value, 'auto');
        tryAdd(ws.getCell(r, 2).value, 'auto');
      }
    }

    return { codigos: [...codigosSet], cedulas: [...cedulasSet] };
  }

}
