import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

import { ProcessControlService } from '../../services/process-control.service';
import { ApiProblem } from '../../models/dynamic-forms.models';
import {
  BulkMode, BulkPreview, BulkRow, FormColumn,
} from '../../models/process.models';

export interface BulkLoadData {
  formId: number;
  /** Columnas que el rol puede escribir: son las que lleva la plantilla. */
  columns: FormColumn[];
  keyField: string | null;
  keyLabel: string | null;
}

type Paso = 'cargar' | 'preview' | 'resultado';

/** Filas que se pintan de entrada; el resto queda tras "mostrar todas". */
const TOPE_RENDER = 200;

/**
 * CARGA MASIVA para crear o corregir registros en bloque.
 *
 * Flujo en DOS pasos, deliberadamente, igual que el pegado masivo de afiliaciones:
 *
 *   1. CARGAR  — se sube un .xlsx/.csv o se pega un bloque copiado de Excel. El parseo
 *                ocurre aquí, en el navegador; al servidor viajan filas ya tabuladas.
 *   2. PREVIEW — el servidor cruza cada fila contra la base REAL (por ID interno, si no
 *                por la llave de negocio) y responde qué pasaría con cada una: crear,
 *                actualizar (con el diff campo a campo), sin cambios o con error.
 *
 * Aplicar es una tercera llamada explícita. El preview no escribe nada y el servidor
 * vuelve a planificar al aplicar, así que un preview visto hace diez minutos no puede
 * pisar el cambio que otra persona hizo mientras tanto.
 */
@Component({
  selector: 'app-bulk-load-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatProgressBarModule, MatTooltipModule,
  ],
  templateUrl: './bulk-load-dialog.component.html',
  styleUrls: ['./bulk-load-dialog.component.css'],
})
export class BulkLoadDialogComponent {
  readonly data = inject<BulkLoadData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<BulkLoadDialogComponent>);
  private svc = inject(ProcessControlService);
  private destroyRef = inject(DestroyRef);

  readonly paso = signal<Paso>('cargar');
  readonly modo = signal<BulkMode>('UPSERT');
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly nombreArchivo = signal<string>('');

  /** Filas tabuladas del archivo: [{cabecera: valor}]. */
  private readonly filas = signal<Record<string, string>[]>([]);
  readonly totalFilas = computed(() => this.filas().length);

  readonly preview = signal<BulkPreview | null>(null);
  readonly mostrarTodas = signal(false);
  readonly aplicado = signal<{ creados: number; actualizados: number; saltados: number; errores: number } | null>(null);
  readonly fallidas = signal<BulkRow[]>([]);

  /** Texto pegado desde Excel (paso 1, alternativa al archivo). */
  textoPegado = '';

  readonly filasVisibles = computed<BulkRow[]>(() => {
    const rows = this.preview()?.rows ?? [];
    return this.mostrarTodas() ? rows : rows.slice(0, TOPE_RENDER);
  });

  readonly hayMas = computed(() => (this.preview()?.rows.length ?? 0) > TOPE_RENDER);

  readonly aplicables = computed(() => {
    const p = this.preview();
    return p ? p.to_create + p.to_update : 0;
  });

  // ---------- Paso 1: plantilla, archivo o pegado ----------

  /**
   * Plantilla con las columnas que ESTE usuario puede llenar, más la columna ID.
   *
   * Se incluye ID a propósito aunque venga vacía: es el camino sin ambigüedad para
   * corregir registros existentes (se pega el ID de una exportación previa). Si se deja
   * vacía, el servidor cruza por la llave de negocio del formulario.
   */
  descargarPlantilla(): void {
    const cabeceras = ['ID', ...this.data.columns.map(c => c.label)];
    const ejemplo: Record<string, string> = {};
    for (const h of cabeceras) ejemplo[h] = '';

    const hoja = XLSX.utils.json_to_sheet([ejemplo], { header: cabeceras });
    hoja['!cols'] = cabeceras.map(h => ({ wch: Math.max(12, h.length + 4) }));

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Datos');

    // Segunda hoja con las reglas: el operador abre el archivo días después y ya no
    // recuerda qué significaba dejar el ID vacío.
    const instrucciones = [
      ['Cómo llenar esta plantilla'],
      [''],
      ['1. Una fila por registro. No cambies los nombres de las columnas.'],
      ['2. Columna ID: déjala vacía para crear un registro nuevo.'],
      this.data.keyLabel
        ? [`   Si la dejas vacía y "${this.data.keyLabel}" coincide con un registro existente, se ACTUALIZA ese registro.`]
        : ['   Este formulario no tiene campo llave: sin ID, cada fila crea un registro nuevo.'],
      ['3. Fechas: AAAA-MM-DD o DD/MM/AAAA. Horas: HH:mm.'],
      ['4. Preguntas de selección múltiple: separa las opciones con punto y coma (;).'],
      ['5. Los archivos y fotos no se cargan por aquí: se suben desde el formulario.'],
      [''],
      ['Antes de aplicar verás un resumen fila por fila de lo que va a pasar.'],
    ];
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(instrucciones), 'Instrucciones');

    const buf = XLSX.write(libro, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    saveAs(new Blob([buf], { type: 'application/octet-stream' }),
      `plantilla-formulario-${this.data.formId}.xlsx`);
  }

  async archivoElegido(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';                       // permite volver a elegir el mismo archivo
    if (!file) return;

    this.error.set(null);
    this.cargando.set(true);
    try {
      const buf = await file.arrayBuffer();
      const libro = XLSX.read(buf, { type: 'array', cellDates: false, raw: false });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      // defval: '' para que una celda vacía llegue como columna presente y vacía (borrar
      // un valor) en vez de desaparecer de la fila (dejarlo como está). Son cosas distintas.
      const filas = XLSX.utils.sheet_to_json<Record<string, string>>(hoja, { defval: '', raw: false });
      this.nombreArchivo.set(file.name);
      this.recibirFilas(filas);
    } catch {
      this.error.set('No se pudo leer el archivo. Debe ser .xlsx, .xls o .csv con una fila de encabezados.');
    } finally {
      this.cargando.set(false);
    }
  }

  /** Pegado desde Excel: primera línea = encabezados, separador TAB (o punto y coma). */
  usarPegado(): void {
    const texto = this.textoPegado.trim();
    if (!texto) {
      this.error.set('Pega el contenido copiado desde Excel, con la fila de encabezados incluida.');
      return;
    }
    const lineas = texto.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lineas.length < 2) {
      this.error.set('Hacen falta al menos dos líneas: los encabezados y una fila de datos.');
      return;
    }
    const sep = lineas[0].includes('\t') ? '\t' : ';';
    const cabeceras = lineas[0].split(sep).map(h => h.trim());
    const filas = lineas.slice(1).map(l => {
      const celdas = l.split(sep);
      const fila: Record<string, string> = {};
      cabeceras.forEach((h, i) => { fila[h] = (celdas[i] ?? '').trim(); });
      return fila;
    });
    this.nombreArchivo.set('(pegado desde Excel)');
    this.recibirFilas(filas);
  }

  private recibirFilas(filas: Record<string, string>[]): void {
    const limpias = filas.filter(f => Object.values(f).some(v => String(v ?? '').trim() !== ''));
    if (limpias.length === 0) {
      this.error.set('El archivo no trae filas con datos.');
      return;
    }
    this.filas.set(limpias);
    this.error.set(null);
    this.pedirPreview();
  }

  // ---------- Paso 2: preview ----------

  pedirPreview(): void {
    if (this.filas().length === 0) return;
    this.cargando.set(true);
    this.error.set(null);
    this.svc.preview(this.data.formId, {
      mode: this.modo(),
      filename: this.nombreArchivo(),
      rows: this.filas(),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: p => {
        this.preview.set(p);
        this.mostrarTodas.set(false);
        this.paso.set('preview');
        this.cargando.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.cargando.set(false);
        this.error.set(this.mensaje(e, 'No se pudo revisar el archivo.'));
      },
    });
  }

  cambiarModo(m: BulkMode): void {
    this.modo.set(m);
    // Cambiar el modo cambia el diagnóstico de cada fila (lo que era "crear" puede pasar
    // a ser un error), así que se vuelve a pedir el preview en vez de recalcular a ojo.
    if (this.paso() === 'preview') this.pedirPreview();
  }

  volverACargar(): void {
    this.paso.set('cargar');
    this.preview.set(null);
    this.filas.set([]);
    this.textoPegado = '';
    this.nombreArchivo.set('');
    this.error.set(null);
  }

  // ---------- Paso 3: aplicar ----------

  aplicar(): void {
    if (this.aplicables() === 0) return;
    this.cargando.set(true);
    this.error.set(null);
    this.svc.apply(this.data.formId, {
      mode: this.modo(),
      filename: this.nombreArchivo(),
      rows: this.filas(),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        this.cargando.set(false);
        this.aplicado.set({
          creados: res.created,
          actualizados: res.updated,
          saltados: res.skipped,
          errores: res.errors,
        });
        this.fallidas.set(res.failed ?? []);
        this.paso.set('resultado');
      },
      error: (e: HttpErrorResponse) => {
        this.cargando.set(false);
        this.error.set(this.mensaje(e, 'No se pudo aplicar la carga.'));
      },
    });
  }

  /** Cierra devolviendo true si se escribió algo: la tabla de atrás se recarga sola. */
  cerrar(): void {
    const r = this.aplicado();
    this.ref.close(!!r && (r.creados > 0 || r.actualizados > 0));
  }

  // ---------- Presentación ----------

  etiquetaResultado(o: string): string {
    switch (o) {
      case 'CREATE': return 'Se crea';
      case 'UPDATE': return 'Se actualiza';
      case 'NO_CHANGE': return 'Sin cambios';
      case 'ERROR': return 'Error';
      default: return o;
    }
  }

  claseResultado(o: string): string {
    switch (o) {
      case 'CREATE': return 'blk-chip--crear';
      case 'UPDATE': return 'blk-chip--actualizar';
      case 'NO_CHANGE': return 'blk-chip--igual';
      case 'ERROR': return 'blk-chip--error';
      default: return '';
    }
  }

  resumenCambios(fila: BulkRow): string {
    if (!fila.changes?.length) return '';
    return fila.changes
      .map(c => `${c.label || c.field}: ${c.before || '—'} → ${c.after || '—'}`)
      .join(' · ');
  }

  private mensaje(e: HttpErrorResponse, porDefecto: string): string {
    const p = e?.error as ApiProblem | undefined;
    return p?.detail || p?.title || porDefecto;
  }
}
