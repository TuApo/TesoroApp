import {
  ChangeDetectionStrategy, Component, DestroyRef, Input, OnInit, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { saveAs } from 'file-saver';
import Swal from 'sweetalert2';

import { DynamicFormService } from '../../services/dynamic-form.service';
import { ProcessControlService } from '../../services/process-control.service';
import { ApiProblem, SubmissionStatus } from '../../models/dynamic-forms.models';
import {
  FormAccess, FormColumn, ProcessRecord, ProcessSummary,
} from '../../models/process.models';
import { BulkLoadDialogComponent, BulkLoadData } from '../../components/bulk-load-dialog/bulk-load-dialog.component';
import { RecordHistoryDialogComponent } from '../../components/record-history-dialog/record-history-dialog.component';
import { RecordEditDialogComponent, RecordEditData } from '../../components/record-edit-dialog/record-edit-dialog.component';

/** Columnas del formulario que caben en la tabla sin volverla ilegible; el resto, al Excel. */
const MAX_COLUMNAS_TABLA = 12;

/**
 * CONTROL DEL PROCESO — la quinta vista de un formulario dinámico.
 *
 * Las otras cuatro miran el formulario; esta mira EL DATO: en qué estado está cada
 * registro, si cambió después de enviarse, quién lo tocó y cuándo. Desde aquí se
 * interviene — de a uno (solo las columnas que el rol tenga concedidas) o en bloque con
 * una carga masiva en dos pasos, como el pegado masivo de afiliaciones.
 *
 * Todo lo que se puede hacer sale del ACCESO EFECTIVO que resuelve el backend
 * (`accessInput`): sin permiso de edición no hay botón de editar, y sin columnas
 * concedidas el diálogo de edición no muestra ninguna. El backend vuelve a comprobarlo
 * en cada operación: esto es para no ofrecer lo que se va a negar.
 */
@Component({
  selector: 'app-form-process',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatCardModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatPaginatorModule, MatProgressBarModule, MatSelectModule,
    MatSnackBarModule, MatTooltipModule,
  ],
  templateUrl: './form-process.component.html',
  styleUrls: ['./form-process.component.css'],
})
export class FormProcessComponent implements OnInit {
  /** Id inyectado por el dispatcher (form-view-host); si no, se lee de la ruta. */
  @Input() set formIdInput(id: number | undefined) {
    if (id != null && Number.isFinite(id) && id > 0) {
      this.idPorInput = id;
      this.inicializar(id);
    }
  }
  private idPorInput?: number;

  /**
   * Acceso efectivo que ya resolvió el host. Se acepta por input para no repetir la
   * llamada; si no llega (entrada directa por URL) se pide en ngOnInit.
   */
  @Input() set accessInput(a: FormAccess | null | undefined) {
    if (a) this.acceso.set(a);
  }

  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private svc = inject(ProcessControlService);
  private formsSvc = inject(DynamicFormService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  // ── Estado ──────────────────────────────────────────────────────────
  readonly formId = signal<number>(0);
  readonly acceso = signal<FormAccess | null>(null);
  readonly columnas = signal<FormColumn[]>([]);
  readonly resumen = signal<ProcessSummary | null>(null);
  readonly filas = signal<ProcessRecord[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  // ── Filtros ─────────────────────────────────────────────────────────
  readonly filtroEstado = signal<SubmissionStatus | 'TODOS'>('TODOS');
  readonly soloCambiados = signal(false);
  readonly busquedaLlave = signal('');
  readonly page = signal(0);
  readonly size = signal(25);

  /** Serial de carga: descarta respuestas que llegan tarde tras cambiar un filtro. */
  private serial = 0;

  // ── Derivados ───────────────────────────────────────────────────────

  /** Columnas que se pintan en la tabla (las primeras; el resto vive en el Excel). */
  readonly columnasVisibles = computed(() => {
    const visibles = this.acceso()?.visible_fields;
    const todas = this.columnas();
    const permitidas = visibles == null ? todas : todas.filter(c => visibles.includes(c.key));
    return permitidas.slice(0, MAX_COLUMNAS_TABLA);
  });

  readonly hayColumnasOcultas = computed(() => {
    const visibles = this.acceso()?.visible_fields;
    const todas = this.columnas();
    const permitidas = visibles == null ? todas.length : todas.filter(c => visibles.includes(c.key)).length;
    return permitidas > MAX_COLUMNAS_TABLA;
  });

  readonly puedeEditar = computed(() => this.acceso()?.can_edit_responses === true);
  readonly puedeCargar = computed(() => this.acceso()?.can_bulk_load === true);
  readonly puedeExportar = computed(() => this.acceso()?.can_export === true);

  /** Etiqueta del campo llave, para la cabecera de la columna y el buscador. */
  readonly etiquetaLlave = computed(() => {
    const clave = this.acceso()?.process_key_field;
    if (!clave) return null;
    return this.columnas().find(c => c.key === clave)?.label ?? 'Llave';
  });

  /** Columnas que este usuario puede escribir; vacío = ninguna (no se ofrece editar). */
  readonly columnasEditables = computed<FormColumn[]>(() => {
    const permitidas = this.acceso()?.editable_fields;
    const todas = this.columnas();
    return permitidas == null ? todas : todas.filter(c => permitidas.includes(c.key));
  });

  ngOnInit(): void {
    if (this.idPorInput) return;                 // ya inicializado por el @Input
    const id = Number(this.route.snapshot.paramMap.get('formId'));
    if (Number.isFinite(id) && id > 0) this.inicializar(id);
    else this.error.set('No se pudo determinar el formulario.');
  }

  private inicializar(id: number): void {
    if (this.formId() === id) return;
    this.formId.set(id);
    this.filas.set([]);
    this.total.set(0);
    this.page.set(0);

    if (!this.acceso()) {
      this.svc.myAccess(id).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: a => this.acceso.set(a), error: () => { /* la tabla ya avisa */ } });
    }
    this.svc.columns(id).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: c => this.columnas.set(c), error: () => this.columnas.set([]) });
    this.cargarResumen();
    this.cargar();
  }

  // ── Carga ───────────────────────────────────────────────────────────

  cargarResumen(): void {
    const id = this.formId();
    if (!id) return;
    this.svc.summary(id).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: r => this.resumen.set(r), error: () => this.resumen.set(null) });
  }

  cargar(): void {
    const id = this.formId();
    if (!id) return;
    const mio = ++this.serial;
    this.cargando.set(true);
    this.error.set(null);

    const estado = this.filtroEstado();
    this.svc.records(id, {
      status: estado === 'TODOS' ? null : estado,
      onlyChanged: this.soloCambiados(),
      key: this.busquedaLlave(),
      page: this.page(),
      size: this.size(),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        if (mio !== this.serial) return;         // llegó tarde: hay un filtro más nuevo
        this.filas.set(res.content);
        this.total.set(res.total);
        this.cargando.set(false);
      },
      error: (e: HttpErrorResponse) => {
        if (mio !== this.serial) return;
        this.cargando.set(false);
        this.error.set(this.mensaje(e, 'No se pudieron cargar los registros.'));
      },
    });
  }

  // ── Filtros ─────────────────────────────────────────────────────────

  cambiarEstado(estado: SubmissionStatus | 'TODOS'): void {
    this.filtroEstado.set(estado);
    this.page.set(0);
    this.cargar();
  }

  alternarCambiados(valor: boolean): void {
    this.soloCambiados.set(valor);
    this.page.set(0);
    this.cargar();
  }

  buscarLlave(texto: string): void {
    this.busquedaLlave.set(texto);
    this.page.set(0);
    this.cargar();
  }

  onPage(e: PageEvent): void {
    this.page.set(e.pageIndex);
    this.size.set(e.pageSize);
    this.cargar();
  }

  // ── Acciones por registro ───────────────────────────────────────────

  verHistorial(fila: ProcessRecord): void {
    this.dialog.open(RecordHistoryDialogComponent, {
      width: '760px',
      maxWidth: '95vw',
      data: { submissionId: fila.id, recordKey: fila.record_key },
    });
  }

  editar(fila: ProcessRecord): void {
    const editables = this.columnasEditables();
    if (editables.length === 0) {
      void Swal.fire({
        icon: 'info',
        title: 'Sin columnas asignadas',
        text: 'Tu rol puede ver el control del proceso pero no tiene ninguna columna '
          + 'habilitada para escribir. Pídeselo a quien administra el formulario.',
        confirmButtonText: 'Entendido',
      });
      return;
    }
    const data: RecordEditData = { formId: this.formId(), record: fila, columns: editables };
    this.dialog.open(RecordEditDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      data,
    }).afterClosed().subscribe((actualizado?: ProcessRecord) => {
      if (!actualizado) return;
      // Se parchea la fila en su sitio en vez de recargar: recargar perdería la página,
      // el filtro y el scroll justo después de guardar.
      this.filas.update(fs => fs.map(f => (f.id === actualizado.id ? actualizado : f)));
      this.cargarResumen();
      this.snack.open('Registro actualizado', 'OK', { duration: 2500 });
    });
  }

  // ── Carga masiva ────────────────────────────────────────────────────

  abrirCargaMasiva(): void {
    const data: BulkLoadData = {
      formId: this.formId(),
      columns: this.columnasEditables(),
      keyField: this.acceso()?.process_key_field ?? null,
      keyLabel: this.etiquetaLlave(),
    };
    this.dialog.open(BulkLoadDialogComponent, {
      width: '1000px',
      maxWidth: '96vw',
      disableClose: true,
      data,
    }).afterClosed().subscribe((aplicado?: boolean) => {
      if (!aplicado) return;
      this.page.set(0);
      this.cargar();
      this.cargarResumen();
    });
  }

  // ── Exportar ────────────────────────────────────────────────────────

  /**
   * Excel con TRES hojas: "Respuestas" (el último estado de cada registro),
   * "Cambios" (todo el historial, fila por cambio) y "Cargas masivas" (los lotes).
   * Lo arma el backend y viene completo, sin el tope de la tabla.
   */
  exportar(): void {
    const id = this.formId();
    if (!id) return;
    this.cargando.set(true);
    this.formsSvc.exportXlsx(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        this.cargando.set(false);
        if (res.body) saveAs(res.body, `formulario-${id}-proceso.xlsx`);
      },
      error: (e: HttpErrorResponse) => {
        this.cargando.set(false);
        this.snack.open(this.mensaje(e, 'No se pudo generar el Excel.'), 'Cerrar', { duration: 5000 });
      },
    });
  }

  // ── Helpers de plantilla ────────────────────────────────────────────

  valor(fila: ProcessRecord, columna: FormColumn): string {
    const v = fila.values?.[columna.key];
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(x => this.textoPlano(x)).join('; ');
    return this.textoPlano(v);
  }

  private textoPlano(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o['filename']) return String(o['filename']);
      if (o['lat'] != null && o['lng'] != null) return `${o['lat']}, ${o['lng']}`;
      return JSON.stringify(v);
    }
    return String(v);
  }

  etiquetaEstado(estado: string): string {
    switch (estado) {
      case 'DRAFT': return 'Borrador';
      case 'SUBMITTED': return 'Enviado';
      case 'APPROVED': return 'Aprobado';
      case 'REJECTED': return 'Rechazado';
      default: return estado;
    }
  }

  claseEstado(estado: string): string {
    switch (estado) {
      case 'DRAFT': return 'chip-neutro';
      case 'SUBMITTED': return 'chip-info';
      case 'APPROVED': return 'chip-ok';
      case 'REJECTED': return 'chip-error';
      default: return 'chip-neutro';
    }
  }

  private mensaje(e: HttpErrorResponse, porDefecto: string): string {
    const p = e?.error as ApiProblem | undefined;
    return p?.detail || p?.title || porDefecto;
  }
}
