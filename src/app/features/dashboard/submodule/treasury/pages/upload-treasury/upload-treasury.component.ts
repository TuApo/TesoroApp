import { InfoCardComponent } from '@/app/shared/components/info-card/info-card.component';

import {  Component, ElementRef, ViewChild , ChangeDetectionStrategy } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import { TesoreriaService, ExcelImportResponse } from '../../service/teroreria/tesoreria.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-upload-treasury',
  imports: [InfoCardComponent, MatCardModule, MatIconModule, MatButtonModule],
  templateUrl: './upload-treasury.component.html',
  styleUrl: './upload-treasury.component.css'
} )
export class UploadTreasuryComponent {

  constructor(private tesoreriaService: TesoreriaService) { }

  @ViewChild('fileInsert', { static: false }) fileInsert!: ElementRef<HTMLInputElement>;
  @ViewChild('fileSaldos', { static: false }) fileSaldos!: ElementRef<HTMLInputElement>;
  @ViewChild('fileEliminar', { static: false }) fileEliminar!: ElementRef<HTMLInputElement>;

  busy = false;

  cards = [
    { id: 'insert' as const, title: 'Insertar empleados (masivo)', imageUrl: 'icons/cards/excel.png' },
    { id: 'saldos' as const, title: 'Actualizar saldos (masivo)', imageUrl: 'icons/cards/excel.png' },
    { id: 'eliminar' as const, title: 'Actualizar estados (masivo)', imageUrl: 'icons/cards/excel.png' }
  ];

  /**
   * Normaliza la cédula (columna 1) tal como la espera Tesorería: mayúsculas y
   * SIN separadores (puntos, comas, espacios, guiones). Deja solo dígitos, o una
   * "X" inicial seguida de dígitos (extranjeros). Así "1.005.851.505" o
   * "1,005,851,505" se convierten en "1005851505" y quedan consultables.
   */
  private normalizarCedula(raw: any): string {
    const s = String(raw ?? '').trim().toUpperCase();
    if (!s) return '';
    const soloDigitos = s.replace(/[^0-9]/g, '');
    if (!soloDigitos) return '';
    return s.charAt(0) === 'X' ? 'X' + soloDigitos : soloDigitos;
  }

  onCardClick(cardId: 'insert' | 'saldos' | 'eliminar') {
    if (this.busy) return;
    if (cardId === 'insert') this.fileInsert?.nativeElement.click();
    if (cardId === 'saldos') this.fileSaldos?.nativeElement.click();
    if (cardId === 'eliminar') this.fileEliminar?.nativeElement.click();
  }

  async downloadTemplate(id: 'insert' | 'saldos' | 'eliminar') {
    if (id === 'insert') {
      try {
        const response = await fetch('templates/BASE.xlsx');
        if (!response.ok) throw new Error('No se pudo descargar el template');
        const blob = await response.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'BASE.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      } catch (e) {
        console.error('Error descargando template:', e);
        Swal.fire('Error', 'No se pudo descargar el template. Verifique que el archivo exista.', 'error');
      }
      return;
    }

    // Generar plantillas dinamicamente para saldos y estados
    const wb = XLSX.utils.book_new();
    let ws: XLSX.WorkSheet;

    if (id === 'saldos') {
      ws = XLSX.utils.aoa_to_sheet([['CEDULA', 'SALDOS', 'SALDO_PENDIENTE']]);
      ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Saldos');
      XLSX.writeFile(wb, 'plantilla_saldos.xlsx');
    } else {
      ws = XLSX.utils.aoa_to_sheet([['CEDULA']]);
      ws['!cols'] = [{ wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Estados');
      XLSX.writeFile(wb, 'plantilla_estados_inactivos.xlsx');
    }
  }

  private async validateInsertExcel(file: File): Promise<{ errors: string[], errorRows: any[][], headersRow: any[], totalValidRows: number }> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0]; // O BASE
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
          const errors: string[] = [];
          const errorRows: any[][] = [];

          let headerRowIdx = -1;
          const colIndices = { CODIGO: -1, CEDULA: -1, NOMBRE: -1, INGRESO: -1 };

          // Buscar la fila de encabezados en las primeras 20 filas (Normalizando cabeceras)
          for (let i = 0; i < Math.min(20, rows.length); i++) {
            const row = rows[i];
            const normalizedRow = row.map(c => String(c).trim().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, ' ').toUpperCase());
            
            const reqCols = ['CODIGO', 'CEDULA', 'NOMBRE', 'INGRESO'];
            const hasAllReq = reqCols.every(req => normalizedRow.includes(req));
            
            if (hasAllReq) {
              headerRowIdx = i;
              colIndices.CODIGO = normalizedRow.indexOf('CODIGO');
              colIndices.CEDULA = normalizedRow.indexOf('CEDULA');
              colIndices.NOMBRE = normalizedRow.indexOf('NOMBRE');
              colIndices.INGRESO = normalizedRow.indexOf('INGRESO');
              break;
            }
          }

          if (headerRowIdx === -1) {
            errors.push('No se encontró la fila de cabeceras válida (Debe contener CODIGO, CEDULA, NOMBRE e INGRESO) en las primeras 20 filas.');
            return resolve({ errors, errorRows: [], headersRow: [], totalValidRows: 0 });
          }

          const seenCedulas = new Set<string>();
          let totalValidRows = 0;

          for (let i = headerRowIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0 || row.every(c => String(c).trim() === '')) continue; // omitir vacías

            const cedula = this.normalizarCedula(row[colIndices.CEDULA]);
            const ingreso = String(row[colIndices.INGRESO] || '').trim();

            let rowHasError = false;

            if (!cedula) {
              const hasOtherData = row.some((c, index) => index > 0 && String(c).trim() !== '');
              if (hasOtherData) {
                  errors.push(`Fila ${i + 1}: Fila contiene datos pero no tiene CÉDULA.`);
                  rowHasError = true;
                  errorRows.push([...row, 'Fila contiene datos pero no tiene CÉDULA.']);
              }
              continue;
            }

            // Duplicados
            if (seenCedulas.has(cedula)) {
                errors.push(`Fila ${i + 1}: Cédula duplicada en este Excel "${cedula}".`);
                rowHasError = true;
            } else {
                seenCedulas.add(cedula);
            }

            // Regla 1: Cédula solo números o inicia con X / x
            if (!/^([xX][a-zA-Z0-9]+|\d+)$/.test(cedula)) {
              errors.push(`Fila ${i + 1}: Cédula inválida "${cedula}". Debe ser numérica o iniciar con X.`);
              rowHasError = true;
            }

            // Regla 2: INGRESO no vacío, no solo "00:00:00", numérico de Excel o fecha de String válida
            if (!ingreso) {
              errors.push(`Fila ${i + 1}: La fecha de INGRESO está vacía (Cédula: ${cedula}).`);
              rowHasError = true;
            } else if (ingreso === '00:00:00' || ingreso === '0') {
               errors.push(`Fila ${i + 1}: La fecha de INGRESO es inválida (solo hora o cero) (Cédula: ${cedula}).`);
               rowHasError = true;
            } else {
               if (!this.isValidDateOrExcelSerial(row[colIndices.INGRESO])) {
                   errors.push(`Fila ${i + 1}: La fecha de INGRESO "${ingreso}" no parece ser válida (Cédula: ${cedula}).`);
                   rowHasError = true;
               }
            }

            if (rowHasError) {
                errorRows.push([...row, errors[errors.length - 1]]);
            } else {
                totalValidRows++;
            }
          }
          resolve({ errors, errorRows, headersRow: [...rows[headerRowIdx], 'MOTIVO_ERROR'], totalValidRows });
        } catch (err) {
          resolve({ errors: ['Error al leer Excel'], errorRows: [], headersRow: [], totalValidRows: 0 });
        }
      };
      reader.onerror = () => resolve({ errors: ['Error al cargar el archivo.'], errorRows: [], headersRow: [], totalValidRows: 0 });
      reader.readAsArrayBuffer(file);
    });
  }

  private isValidDateOrExcelSerial(value: any): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'number') {
        return value > 1; // Simple heuristic for valid excel numbers (which act as dates)
    }
    const strVal = String(value).trim();
    if (/^\d+(\.\d*)?$/.test(strVal) && Number(strVal) > 1) return true;
    // Check YYYY-MM-DD
    const d = new Date(strVal);
    if (!isNaN(d.getTime())) return true;
    
    // Other common patterns DD/MM/YYYY or YYYY/MM/DD
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(strVal)) return true;
    if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(strVal)) return true;
    
    return false;
  }

  async handleFile(kind: 'insert' | 'saldos' | 'eliminar', ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Validate extension
    const name = file.name.toLowerCase();
    if (kind === 'insert' && !name.endsWith('.xlsx')) {
      Swal.fire({ icon: 'error', title: 'Archivo inválido', text: 'Para insertar empleados solo se permiten archivos .xlsx.' });
      input.value = '';
      return;
    }
    if (kind !== 'insert' && !(name.endsWith('.xlsx') || name.endsWith('.xls'))) {
      Swal.fire({ icon: 'error', title: 'Archivo inválido', text: 'Solo se permiten archivos Excel (.xlsx, .xls).' });
      input.value = '';
      return;
    }

    try {
      this.busy = true;

      if (kind === 'saldos') {
        await this.procesarSaldosExcel(file);
      } else if (kind === 'eliminar') {
        await this.procesarEstadosExcel(file);
      } else {
        await this.handleInsertFile(file);
      }

    } catch (e: any) {
      console.error(e);
      let errorMsg = 'Error comunicándose con el backend';
      if (e.error) {
        if (typeof e.error === 'string') errorMsg = e.error;
        else if (e.error.error) errorMsg = e.error.error;
        else if (e.error.detail) errorMsg = e.error.detail;
      } else if (e.message) {
        errorMsg = e.message;
      }
      Swal.fire({ icon: 'error', title: 'Error de importación', html: `<b>Motivo:</b><br>${errorMsg}` });
    } finally {
      this.busy = false;
      input.value = '';
    }
  }

  /** Insert empleados — flujo original con validación y envío al backend */
  private async handleInsertFile(file: File) {
    Swal.fire({ icon: 'info', title: 'Validando formato...', html: 'Revisando reglas de Excel (Cédula e Ingreso)...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const valRes = await this.validateInsertExcel(file);
    if (valRes.errors.length > 0) {
      if (valRes.totalValidRows === 0) {
        Swal.fire('Error', 'El archivo no contiene filas válidas.', 'error');
        return;
      }

      const decision = await Swal.fire({
        icon: 'warning',
        title: 'Se encontraron errores',
        html: `<p>Hay <b>${valRes.errors.length} filas</b> con errores previstos (ej. Ingreso vacío).</p>
               <p>Las filas inválidas se descartarán y se importarán las otras. ¿Deseas descargar un Excel con los motivos y continuar subiendo las <b>${valRes.totalValidRows} correctas</b>?</p>`,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Descargar y continuar',
        denyButtonText: 'Continuar sin descargar',
        cancelButtonText: 'Cancelar',
        width: '600px'
      });

      if (decision.isDismissed) return;

      if (decision.isConfirmed) {
        const errorSheetData = [valRes.headersRow, ...valRes.errorRows];
        const ws = XLSX.utils.aoa_to_sheet(errorSheetData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Errores_Importacion');
        XLSX.writeFile(wb, 'empleados_errores.xlsx');
      }
    }

    Swal.fire({ icon: 'info', title: 'Procesando archivo...', html: 'El backend está importando y mapeando el archivo Excel.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const res = await this.tesoreriaService.importarPersonasExcel(file);
    this.showImportResult(res, 'insert');
  }

  /** Leer Excel con columnas: CEDULA, SALDOS, SALDO_PENDIENTE (opcional) */
  private async procesarSaldosExcel(file: File) {
    Swal.fire({ icon: 'info', title: 'Leyendo archivo...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const rows = await this.leerFilasExcel(file);
    if (rows.length < 2) {
      Swal.fire('Aviso', 'El archivo está vacío o no tiene datos.', 'info');
      return;
    }

    // Detectar columnas por cabecera
    const headerRow = rows[0].map((c: any) => String(c).trim().toUpperCase());
    const colCedula = headerRow.findIndex((h: string) => h.includes('CEDULA'));
    const colSaldos = headerRow.findIndex((h: string) => h === 'SALDOS');
    const colPendiente = headerRow.findIndex((h: string) => h.includes('PENDIENTE'));

    if (colCedula === -1 || colSaldos === -1) {
      Swal.fire('Error', 'El archivo debe tener al menos las columnas CEDULA y SALDOS.', 'error');
      return;
    }

    const dataRows = rows.slice(1).filter((r: any[]) => String(r[colCedula] ?? '').trim() !== '');
    if (dataRows.length === 0) {
      Swal.fire('Aviso', 'No se encontraron filas con datos.', 'info');
      return;
    }

    const toNum = (v: any) => {
      const n = Number(String(v ?? '0').replace(/[, ]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };

    let updated = 0;
    let errors: { cedula: string; error: string }[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const cedula = this.normalizarCedula(row[colCedula]);
      if (!cedula) {
        errors.push({ cedula: String(row[colCedula] ?? ''), error: 'Cédula inválida (sin dígitos)' });
        continue;
      }
      const saldos = toNum(row[colSaldos]);
      const cambios: any = { saldos };

      if (colPendiente !== -1 && row[colPendiente] !== undefined && String(row[colPendiente]).trim() !== '') {
        cambios.saldo_pendiente = toNum(row[colPendiente]);
      }

      Swal.update({ html: `Actualizando ${i + 1} de ${dataRows.length}…` });

      try {
        await this.tesoreriaService.actualizarParcial(cedula, cambios);
        updated++;
      } catch (e: any) {
        errors.push({ cedula, error: e?.error?.detail ?? e?.message ?? 'Error desconocido' });
      }
    }

    this.mostrarResultadoBatch('Saldos actualizados', dataRows.length, updated, errors);
  }

  /** Leer Excel con columna CEDULA — marcar todos como inactivos */
  private async procesarEstadosExcel(file: File) {
    Swal.fire({ icon: 'info', title: 'Leyendo archivo...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const rows = await this.leerFilasExcel(file);
    if (rows.length < 2) {
      Swal.fire('Aviso', 'El archivo está vacío o no tiene datos.', 'info');
      return;
    }

    const headerRow = rows[0].map((c: any) => String(c).trim().toUpperCase());
    const colCedula = headerRow.findIndex((h: string) => h.includes('CEDULA'));

    if (colCedula === -1) {
      Swal.fire('Error', 'El archivo debe tener la columna CEDULA.', 'error');
      return;
    }

    const cedulas = rows.slice(1)
      .map((r: any[]) => this.normalizarCedula(r[colCedula]))
      .filter((c: string) => c !== '');

    if (cedulas.length === 0) {
      Swal.fire('Aviso', 'No se encontraron cédulas en el archivo.', 'info');
      return;
    }

    const confirm = await Swal.fire({
      icon: 'warning',
      title: '¿Confirmar inactivación?',
      html: `Se marcarán <b>${cedulas.length}</b> personas como <b>INACTIVAS</b>.`,
      showCancelButton: true,
      confirmButtonText: 'Sí, inactivar',
      cancelButtonText: 'Cancelar',
    });
    if (!confirm.isConfirmed) return;

    Swal.fire({ icon: 'info', title: 'Procesando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    let updated = 0;
    let errors: { cedula: string; error: string }[] = [];

    for (let i = 0; i < cedulas.length; i++) {
      Swal.update({ html: `Inactivando ${i + 1} de ${cedulas.length}…` });
      try {
        await this.tesoreriaService.actualizarParcial(cedulas[i], { activo: false });
        updated++;
      } catch (e: any) {
        errors.push({ cedula: cedulas[i], error: e?.error?.detail ?? e?.message ?? 'Error desconocido' });
      }
    }

    this.mostrarResultadoBatch('Estados actualizados', cedulas.length, updated, errors);
  }

  /** Lee un archivo Excel y retorna las filas como array de arrays */
  private leerFilasExcel(file: File): Promise<any[][]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          resolve(XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }));
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Error al leer el archivo'));
      reader.readAsArrayBuffer(file);
    });
  }

  private mostrarResultadoBatch(titulo: string, total: number, ok: number, errors: { cedula: string; error: string }[]) {
    const hasErrors = errors.length > 0;
    let html = `
      <div style="text-align:left">
        <p><b>Total procesadas:</b> ${total}</p>
        <p><b>Actualizadas correctamente:</b> ${ok}</p>
        <p><b>Errores:</b> ${errors.length}</p>
      </div>`;

    if (hasErrors) {
      html += `<hr/><div style="text-align:left;color:red;max-height:150px;overflow-y:auto"><ul>
        ${errors.map(e => `<li>${e.cedula}: ${e.error}</li>`).join('')}
      </ul></div>`;
    }

    Swal.fire({ icon: hasErrors ? 'warning' : 'success', title: titulo, html, width: '550px' });
  }

  private showImportResult(res: ExcelImportResponse, kind: 'insert' | 'saldos' | 'eliminar') {
    const hasErrors = (res.errors_count ?? 0) > 0;

    const deactivatedHtml = kind === 'insert'
      ? `<p><b>Inactivados (no presentes en el archivo):</b> ${res.deactivated ?? 0}</p>`
      : '';

    let html = `
      <div style="text-align: left;">
        <p><b>Total Filas Leídas:</b> ${res.total_rows ?? 0}</p>
        <p><b>Procesadas (Válidas):</b> ${res.processed ?? 0}</p>
        <p><b>Nuevos Creados:</b> ${res.created ?? 0}</p>
        <p><b>Actualizados:</b> ${res.updated ?? 0}</p>
        <p><b>Omitidas (Sin cambios/Vacías):</b> ${res.skipped ?? 0}</p>
        ${deactivatedHtml}
      </div>
    `;

    if (hasErrors && Array.isArray(res.errors_sample)) {
      
      const escapeHtml = (unsafe: string) => {
        return unsafe.replace(/&/g, "&amp;")
                     .replace(/</g, "&lt;")
                     .replace(/>/g, "&gt;")
                     .replace(/"/g, "&quot;")
                     .replace(/'/g, "&#039;");
      };

      html += `
        <hr/>
        <div style="text-align: left; color: red;">
          <p><b>Errores Encontrados: ${res.errors_count}</b></p>
          <ul style="max-height: 150px; overflow-y: auto;">
            ${res.errors_sample.map(e => `<li>Fila ${e.row}: ${escapeHtml(String(e.error))}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    Swal.fire({
      icon: hasErrors ? 'warning' : 'success',
      title: 'Importación Finalizada',
      html,
      width: '600px'
    });
  }

}
