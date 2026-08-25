import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import * as XLSX from 'xlsx';

import {
  ActualizacionEmpresaImportResult,
  ActualizacionEmpresaRow,
  Client,
  NominaService,
} from '../../service/nomina/nomina.service';
import { ValidationPreviewDialogComponent } from '@/app/shared/components/validation-preview-dialog/validation-preview-dialog.component';
import { PreviewIssue, PreviewSchema } from 'src/app/shared/model/validation-preview';
import { MatSelectModule } from '@angular/material/select';

type Step = 'select' | 'previewing' | 'done' | 'error';

/**
 * Pestaña "Actualización por empresa usuaria". Mismo proceso que la Carga Masiva:
 * el preview se muestra en el modal reutilizable ValidationPreviewDialogComponent
 * (tabla + chips de error/advertencia por fila + "Confirmar Todo"), y la
 * confirmación corre contra el backend vía import_token.
 *
 * La empresa seleccionada en pantalla manda el parser/plantilla (NO la columna
 * EMPRESA del Excel). Solo se actualizan ceco, codigo_c_costo, fecha_ingreso y
 * auxilio_transporte_ley del contrato activo. El salario nunca se toca.
 */
@Component({
  selector: 'app-actualizacion-empresa-usuaria',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatAutocompleteModule,
    MatProgressBarModule, MatDialogModule, MatSelectModule,
  ],
  templateUrl: './actualizacion-empresa-usuaria.component.html',
  styleUrl: './actualizacion-empresa-usuaria.component.css',
})
export class ActualizacionEmpresaUsuariaComponent implements OnInit {
  private svc = inject(NominaService);
  private dialog = inject(MatDialog);

  empresas = signal<Client[]>([]);
  empresaId = signal<number | null>(null);
  /** Texto escrito en el autocomplete (filtra empresas por nombre o NIT). */
  empresaQuery = signal('');
  /** Periodo al que se asocia la base. null = solo actualizar datos. */
  periodoId = signal<number | null>(null);
  periodos = signal<any[]>([]);
  selectedFile = signal<File | null>(null);
  isDragging = signal(false);

  step = signal<Step>('select');
  importResult = signal<ActualizacionEmpresaImportResult | null>(null);
  errorMsg = signal<string>('');

  /** Filas no aplicadas (estado error) agrupadas por tipo de caso, con conteo. */
  resumenErroresPorTipo = computed(() => this.agruparPorTipo('error'));
  /** Filas aplicadas con advertencia, agrupadas por tipo de caso, con conteo. */
  resumenAdvertenciasPorTipo = computed(() => this.agruparPorTipo('warn'));

  /** ¿Hay al menos una fila con error o advertencia para exportar a Excel? */
  puedeDescargarLog = computed(() => {
    const res = this.importResult();
    return !!res?.results?.some(
      (r) => (r.errores?.length ?? 0) > 0 || (r.advertencias?.length ?? 0) > 0,
    );
  });

  /** Empresas que matchean el texto escrito (nombre o NIT, sin acentos/mayúsculas). */
  empresasFiltradas = computed(() => {
    const q = this.norm(this.empresaQuery());
    const all = this.empresas();
    if (!q) return all;
    return all.filter(
      (e) => this.norm(e.nombre_legal).includes(q) || (e.nit ?? '').toLowerCase().includes(q),
    );
  });

  puedePrevisualizar = computed(() => this.empresaId() != null && this.selectedFile() != null);

  ngOnInit(): void {
    this.svc.getClientesActivos().subscribe({
      next: (cs) => this.empresas.set(cs),
      error: () => this.empresas.set([]),
    });
  }

  // ── Selector de empresa (autocomplete con filtro) ───────────────────────────
  onQueryChange(value: string): void {
    this.empresaQuery.set(value);
    if (this.empresaId() != null) {
      this.empresaId.set(null);
      this.resetState();
    }
  }

  onPeriodoSelected(id: number | null): void { this.periodoId.set(id); }

  /** Periodos disponibles para asociar la base. Se cargan al elegir empresa. */
  private cargarPeriodos(): void {
    this.svc.getPeriodos().subscribe({
      next: (ps: any[]) => this.periodos.set(ps ?? []),
      error: () => this.periodos.set([]),
    });
  }

  onEmpresaSelected(empresa: Client): void {
    this.empresaId.set(empresa.id_entidad);
    this.empresaQuery.set(empresa.nombre_legal);
    this.resetState();
    // El censo es por (periodo, EMPRESA): al cambiar de empresa se limpia el
    // periodo a propósito. Si se arrastrara, la base de la empresa nueva se
    // asociaría en silencio al periodo elegido para la anterior.
    this.periodoId.set(null);
    this.cargarPeriodos();
  }

  displayEmpresa = (e: Client | string | null): string =>
    e && typeof e === 'object' ? e.nombre_legal : (e ?? '');

  private norm(s: string): string {
    return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  // ── Archivo ─────────────────────────────────────────────────────────────────
  openFilePicker(input: HTMLInputElement): void { input.click(); }

  onFileSelected(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) this.setFile(f);
  }

  onDragOver(e: DragEvent): void { e.preventDefault(); this.isDragging.set(true); }
  onDragLeave(e: DragEvent): void { e.preventDefault(); this.isDragging.set(false); }
  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.isDragging.set(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) this.setFile(f);
  }

  private setFile(f: File): void {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      this.errorMsg.set('Solo se permiten archivos Excel (.xlsx / .xls).');
      this.step.set('error');
      return;
    }
    this.selectedFile.set(f);
    this.errorMsg.set('');
    this.resetState();
  }

  quitarArchivo(): void {
    this.selectedFile.set(null);
    this.resetState();
  }

  private resetState(): void {
    this.importResult.set(null);
    this.step.set('select');
    this.errorMsg.set('');
  }

  // ── Previsualizar (abre el modal de Carga Masiva) ───────────────────────────
  async previsualizar(): Promise<void> {
    const id = this.empresaId();
    const file = this.selectedFile();
    if (id == null) { this.errorMsg.set('Selecciona la empresa usuaria.'); this.step.set('error'); return; }
    if (!file) { this.errorMsg.set('Selecciona un archivo Excel.'); this.step.set('error'); return; }

    this.step.set('previewing');
    this.errorMsg.set('');
    try {
      const resp = await firstValueFrom(this.svc.previewActualizacionEmpresa(id, file));

      // Errores generales (empresa/plantilla/columnas/archivo) → no se abre el modal.
      if (resp.errores_generales?.length) {
        this.errorMsg.set(resp.errores_generales.join('  '));
        this.step.set('error');
        return;
      }
      if (!resp.results?.length || !resp.import_token) {
        this.errorMsg.set('El archivo no tiene filas para procesar.');
        this.step.set('error');
        return;
      }

      const token = resp.import_token;
      const allRows = resp.results;
      const allIds = allRows.map((r) => String(r.row_number));

      // Advertencias generales (p.ej. columna EMPRESA informativa) → issues globales.
      const externalIssues: PreviewIssue[] = (resp.advertencias_generales ?? []).map((m, i) => ({
        id: `gen-${i}`, itemId: 'general', severity: 'info', message: m,
      }));

      // "Confirmar Todo" → aplica por import_token. Aceptamos TODAS las filas para
      // que el modal cierre; el desglose real (actualizadas/omitidas) va en el
      // resultado final. El backend nunca aplica filas con error (las valida).
      const serverValidate = async () => {
        const res = await firstValueFrom(
          this.svc.importarActualizacionEmpresa(id, token, this.periodoId()));
        return { acceptedItemIds: allIds, errors: [] as PreviewIssue[], serverResult: res };
      };

      const ref = this.dialog.open(ValidationPreviewDialogComponent, {
        width: '95vw',
        maxWidth: '95vw',
        height: '90vh',
        disableClose: true,
        data: {
          schema: this.buildSchema(),
          items: allRows.map((r) => ({ ...r })),
          phase: 'pre',
          title: `Previsualización — ${resp.empresa_usuaria_nombre ?? 'empresa usuaria'}`,
          subtitle: `${resp.total_filas} filas · ${resp.total_validas} válidas · `
            + `${resp.total_con_advertencia} con advertencia · ${resp.total_con_error} con error. `
            + `El salario no se modifica.`,
          summaryErrorsOnly: true, // el resumen por tipo solo lista errores
          externalIssues,
          serverValidate,
        },
      });

      const result = await firstValueFrom(ref.afterClosed());
      if (!result?.accepted) { this.step.set('select'); return; }

      this.importResult.set(result.result as ActualizacionEmpresaImportResult);
      this.step.set('done');
    } catch (e: any) {
      this.errorMsg.set(e?.error?.error ?? e?.message ?? 'No se pudo previsualizar el archivo.');
      this.step.set('error');
    }
  }

  /** Schema del modal reutilizable para las filas de actualización (solo lectura). */
  private buildSchema(): PreviewSchema<ActualizacionEmpresaRow, ActualizacionEmpresaRow[]> {
    const fmtBool = (b: boolean | null) => (b === null ? '—' : b ? 'Sí' : 'No');
    return {
      title: 'Previsualización de actualización',
      subtitle: 'Revisa los datos antes de aplicar. El salario no se modifica.',
      itemId: (r) => String(r.row_number),
      columns: [
        { key: 'row_number', header: 'Fila', width: '56px', cell: (r) => r.row_number },
        { key: 'cedula', header: 'Cédula', width: '120px', cell: (r) => r.cedula ?? '—' },
        { key: 'nombre', header: 'Nombre', width: '200px', cell: (r) => r.nombre_excel ?? '—' },
        { key: 'ccosto', header: 'CCOSTO', width: '100px',
          cell: (r) => r.codigo_c_costo_normalizado ?? r.ccosto_excel ?? '—' },
        { key: 'ingreso', header: 'Fecha ingreso', width: '120px',
          cell: (r) => r.fecha_ingreso_parseada ?? r.ingreso_excel ?? '—' },
        { key: 'sublegal', header: 'SUB LEGAL', width: '120px',
          cell: (r) => `${fmtBool(r.auxilio_transporte_ley_parseado)} (${r.sub_legal_excel ?? '—'})` },
        { key: 'distribucion', header: 'Distribución', width: '160px', cell: (r) => r.distribucion_excel ?? '—' },
        { key: 'ceco', header: 'CECO resuelto', width: '200px',
          cell: (r) => (r.ceco_codigo ? `${r.ceco_codigo} · ${r.ceco_nombre}` : '—') },
        { key: 'estado', header: 'Estado', width: '110px', cell: (r) => r.estado_fila },
      ],
      editFields: [], // solo lectura: el backend valida/parsea; no se edita en el modal
      validateItem: (r): PreviewIssue[] => {
        const id = String(r.row_number);
        const issues: PreviewIssue[] = [];
        (r.errores ?? []).forEach((m, i) =>
          issues.push({ id: `${id}-e${i}`, itemId: id, severity: 'error', message: m,
            category: this.classifyIssue(m) }));
        (r.advertencias ?? []).forEach((m, i) =>
          issues.push({ id: `${id}-w${i}`, itemId: id, severity: 'warn', message: m,
            category: this.classifyIssue(m) }));
        return issues;
      },
      buildResult: (items) => items,
      allowRemove: false,
      allowCancel: true,
    };
  }

  /**
   * Clasifica un mensaje de error/advertencia del backend en un "tipo de caso"
   * legible, para el resumen agregado. Los mensajes vienen del validador del
   * servicio (validarFila); el orden importa (categorías específicas primero).
   */
  private classifyIssue(msg: string): string {
    const m = (msg ?? '').toLowerCase();
    if (m.includes('persona no encontrada')) return 'Cédula no existe en nómina';
    if (m.includes('cedula es obligatoria') || m.includes('cédula es obligatoria')) return 'Cédula faltante';
    if (m.includes('otra empresa usuaria')) return 'Contrato de otra empresa';
    if (m.includes('no tiene contrato activo')) return 'Sin contrato activo';
    if (m.includes('contratos activos con la empresa')) return 'Varios contratos activos';
    if (m.includes('equivalencia de centro de costo')) return 'Sin equivalencia CECO';
    if (m.includes('distribucion es obligatoria') || m.includes('distribución es obligatoria')) return 'Distribución faltante';
    if (m.startsWith('ccosto')) return 'CCOSTO faltante';
    if (m.includes('ingreso')) return 'Fecha de ingreso inválida';
    if (m.includes('sub legal')) return 'SUB LEGAL inválido';
    if (m.includes('centro de costo') && m.includes('ya no existe')) return 'CECO ya no existe';
    if (m.includes('contrato') && m.includes('ya no existe')) return 'Contrato ya no existe';
    if (m.includes('sin contrato/ceco resuelto')) return 'Sin contrato/CECO resuelto';
    if (m.includes('conflicto de datos')) return 'Conflicto de datos (fecha de ingreso)';
    if (m.includes('no se pudo actualizar el contrato')) return 'No se pudo actualizar el contrato';
    if (m.includes('import_token')) return 'Token expiró — vuelva a previsualizar';
    return 'Otro';
  }

  /**
   * Agrupa las filas del resultado por tipo de caso, contando FILAS distintas.
   * Para 'error' considera solo las filas no aplicadas (estado_fila === 'error');
   * para 'warn', cualquier fila que traiga advertencias.
   */
  private agruparPorTipo(sev: 'error' | 'warn'): { tipo: string; filas: number }[] {
    const res = this.importResult();
    if (!res?.results?.length) return [];
    const counts = new Map<string, Set<number>>();
    for (const row of res.results) {
      if (sev === 'error' && row.estado_fila !== 'error') continue;
      const msgs = sev === 'error' ? row.errores : row.advertencias;
      if (!msgs?.length) continue;
      const tipos = new Set(msgs.map((m) => this.classifyIssue(m)));
      for (const t of tipos) {
        if (!counts.has(t)) counts.set(t, new Set<number>());
        counts.get(t)!.add(row.row_number);
      }
    }
    return [...counts.entries()]
      .map(([tipo, filas]) => ({ tipo, filas: filas.size }))
      .sort((a, b) => b.filas - a.filas);
  }

  /**
   * Descarga un Excel con el log de la carga: una fila por cada mensaje de
   * error o advertencia (no por fila del Excel), para que el operador pueda
   * revisar y corregir caso por caso. El salario nunca se toca, así que no va.
   */
  descargarLog(): void {
    const res = this.importResult();
    if (!res?.results?.length) return;

    const filas: Record<string, string | number>[] = [];
    for (const r of res.results) {
      const base = {
        Fila: r.row_number,
        Cédula: r.cedula ?? '',
        Nombre: r.nombre_excel ?? '',
        Estado: r.estado_fila,
      };
      for (const m of r.errores ?? []) {
        filas.push({ ...base, Severidad: 'Error', 'Tipo de caso': this.classifyIssue(m), Mensaje: m });
      }
      for (const m of r.advertencias ?? []) {
        filas.push({ ...base, Severidad: 'Advertencia', 'Tipo de caso': this.classifyIssue(m), Mensaje: m });
      }
    }
    if (!filas.length) return;

    // Orden de columnas explícito (json_to_sheet respeta el header dado).
    const header = ['Fila', 'Cédula', 'Nombre', 'Severidad', 'Tipo de caso', 'Mensaje', 'Estado'];
    const ws = XLSX.utils.json_to_sheet(filas, { header });
    ws['!cols'] = [
      { wch: 6 }, { wch: 16 }, { wch: 28 }, { wch: 12 }, { wch: 28 }, { wch: 70 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Log');

    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
      + `-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const empresa = this.norm(this.empresaQuery()).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'empresa';
    XLSX.writeFile(wb, `log-actualizacion-${empresa}-${stamp}.xlsx`);
  }

  reiniciar(): void {
    this.selectedFile.set(null);
    this.importResult.set(null);
    this.errorMsg.set('');
    this.step.set('select');
  }

  isStep(s: Step): boolean { return this.step() === s; }
}
