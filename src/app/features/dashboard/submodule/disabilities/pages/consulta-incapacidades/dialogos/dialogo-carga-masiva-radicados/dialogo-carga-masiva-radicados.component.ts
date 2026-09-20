import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import * as XLSX from 'xlsx';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../../../shared/components/tabla-estandar';
import {
  FilaCargaMasivaRadicados,
  ResultadoCargaMasivaRadicados,
} from '../../../../models/incapacidad-v2.model';
import { IncapacidadV2Service } from '../../../../services/incapacidad-v2/incapacidad-v2.service';

/** Lo que devuelve el dialogo al cerrarse. */
export interface ResultadoDialogoCargaMasiva {
  /** `true` si al menos un radicado quedo guardado y la vista debe recargar. */
  recargar: boolean;
}

/** Extensiones que acepta el backend. */
export const EXTENSIONES_ACEPTADAS = ['.xlsx', '.csv'] as const;

/** Tope de tamano del archivo: 5 MB. */
export const TAMANO_MAXIMO_ARCHIVO = 5 * 1024 * 1024;

/** Cabeceras de la plantilla, en el orden que espera el backend. */
const CABECERAS_PLANTILLA = [
  'Cedula',
  'Fecha inicio',
  'Numero radicado',
  'Fecha radicado',
  'Donde se radico',
] as const;

/** Fila de ejemplo de la plantilla (fechas en dd/mm/aaaa, como pide el backend). */
const FILA_EJEMPLO = [
  '1070982591',
  '12/08/2026',
  'RAD-000123',
  '18/08/2026',
  'pagina',
] as const;

/** Anchos de columna (en caracteres) para las hojas que genera el dialogo. */
const ANCHOS_PLANTILLA = [14, 14, 18, 14, 18];

/** `20260818-1435` para nombrar archivos sin pisarse entre descargas. */
function marcaDeTiempo(): string {
  const ahora = new Date();
  const dosDigitos = (n: number) => n.toString().padStart(2, '0');
  return (
    `${ahora.getFullYear()}${dosDigitos(ahora.getMonth() + 1)}${dosDigitos(ahora.getDate())}` +
    `-${dosDigitos(ahora.getHours())}${dosDigitos(ahora.getMinutes())}`
  );
}

/**
 * Dialogo de carga masiva de numeros de radicado.
 *
 * Flujo:
 *   1. El usuario descarga la plantilla (o trae su propio .xlsx/.csv con las
 *      columnas Cedula + Fecha inicio + Numero radicado).
 *   2. Elige el archivo (clic o arrastrar) y pulsa "Procesar".
 *   3. El backend radica FILA A FILA y responde el detalle completo: aqui se
 *      pintan los contadores y la tabla de resultados, y los fallidos se pueden
 *      descargar en un Excel con su motivo para corregirlos y reintentar.
 *
 * El dialogo NO se cierra ante un error: el usuario corrige y reintenta.
 * Al cerrar devuelve `{ recargar }` para que la vista de consulta sepa si debe
 * refrescar el listado (hubo al menos un radicado guardado).
 */
@Component({
  selector: 'app-dialogo-carga-masiva-radicados',
  standalone: true,
  imports: [
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    MatTooltipModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './dialogo-carga-masiva-radicados.component.html',
  styleUrl: './dialogo-carga-masiva-radicados.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoCargaMasivaRadicadosComponent implements OnDestroy {
  /** El dialogo no necesita datos de entrada; se acepta `{}` por contrato. */
  readonly datos = inject<Record<string, unknown> | null>(MAT_DIALOG_DATA, {
    optional: true,
  });
  private readonly ref =
    inject<MatDialogRef<DialogoCargaMasivaRadicadosComponent, ResultadoDialogoCargaMasiva>>(
      MatDialogRef,
    );
  private readonly srv = inject(IncapacidadV2Service);

  private peticion?: Subscription;

  /** Para pintar en la ayuda: ".xlsx o .csv". */
  readonly extensionesTexto = EXTENSIONES_ACEPTADAS.join(' o ');

  // ── Estado ────────────────────────────────────────────────────────────

  /** Archivo elegido (ya validado en extension y tamano). */
  readonly archivo = signal<File | null>(null);

  /** `true` mientras se arrastra un archivo encima de la zona. */
  readonly arrastrando = signal(false);

  /** `true` mientras la peticion esta en vuelo. */
  readonly procesando = signal(false);

  /** Respuesta del backend del ULTIMO procesamiento. */
  readonly resultado = signal<ResultadoCargaMasivaRadicados | null>(null);

  /** Mensaje de error (validacion local o fallo HTTP). */
  readonly error = signal('');

  /** Exitosos ACUMULADOS entre reintentos: decide el `recargar` del cierre. */
  private readonly exitososAcumulados = signal(0);

  // ── Derivados ─────────────────────────────────────────────────────────

  readonly nombreArchivo = computed(() => this.archivo()?.name ?? '');

  /** Tamano legible del archivo elegido ("824 KB" / "2,1 MB"). */
  readonly tamanoLegible = computed(() => {
    const bytes = this.archivo()?.size ?? 0;
    if (bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  });

  readonly puedeProcesar = computed(() => this.archivo() !== null && !this.procesando());

  /** Filas que fallaron (alimentan la tabla y el Excel de fallidos). */
  readonly filasFallidas = computed<FilaCargaMasivaRadicados[]>(
    () => (this.resultado()?.filas ?? []).filter((f) => !f.ok),
  );

  readonly hayFallidos = computed(() => this.filasFallidas().length > 0);

  // ── Tabla de resultados (tabla estandar) ──────────────────────────────

  readonly columnasResultado: ColumnaTabla<FilaCargaMasivaRadicados>[] = [
    { id: 'fila', header: 'Fila', valor: (f) => f.fila, align: 'right', ancho: '60px', tarjeta: 'meta' },
    { id: 'cedula', header: 'Cedula', valor: (f) => f.cedula, tarjeta: 'titulo' },
    { id: 'fechaInicio', header: 'Fecha inicio', valor: (f) => f.fechaInicio, tarjeta: 'meta' },
    { id: 'radicado', header: 'Radicado', valor: (f) => f.numeroRadicado, tarjeta: 'subtitulo' },
    { id: 'resultado', header: 'Resultado', valor: (f) => f.mensaje, tarjeta: 'cuerpo', minAncho: '200px' },
  ];

  readonly idResultado = (f: FilaCargaMasivaRadicados) => f.fila;
  /** Las filas que no se radicaron se resaltan. */
  readonly claseResultado = (f: FilaCargaMasivaRadicados) => (f.ok ? '' : 'te-fila--peligro');

  // ── Plantilla ─────────────────────────────────────────────────────────

  /** Genera la plantilla .xlsx con las cabeceras esperadas y UNA fila de ejemplo. */
  descargarPlantilla(): void {
    const hoja = XLSX.utils.aoa_to_sheet([[...CABECERAS_PLANTILLA], [...FILA_EJEMPLO]]);
    hoja['!cols'] = ANCHOS_PLANTILLA.map((wch) => ({ wch }));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Radicados');
    XLSX.writeFile(libro, 'plantilla-carga-radicados.xlsx');
  }

  // ── Seleccion de archivo ──────────────────────────────────────────────

  /**
   * Valida y adopta un archivo (viene del input o del arrastre).
   * Si no pasa la validacion se explica el motivo y NO se reemplaza el actual.
   */
  tomarArchivo(archivo: File): void {
    const nombre = archivo.name.toLowerCase();
    const extensionValida = EXTENSIONES_ACEPTADAS.some((ext) => nombre.endsWith(ext));

    if (!extensionValida) {
      this.error.set(`Solo se aceptan archivos ${this.extensionesTexto}.`);
      return;
    }
    if (archivo.size > TAMANO_MAXIMO_ARCHIVO) {
      this.error.set('El archivo supera el tamano maximo de 5 MB.');
      return;
    }

    this.error.set('');
    this.resultado.set(null);
    this.archivo.set(archivo);
  }

  alSeleccionarArchivo(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (archivo) this.tomarArchivo(archivo);
    // Se limpia para que volver a elegir el MISMO archivo dispare `change`.
    input.value = '';
  }

  alArrastrarEncima(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(true);
  }

  alSalirArrastre(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(false);
  }

  alSoltar(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(false);
    const archivo = evento.dataTransfer?.files?.[0];
    if (archivo) this.tomarArchivo(archivo);
  }

  quitarArchivo(): void {
    this.archivo.set(null);
    this.resultado.set(null);
    this.error.set('');
  }

  // ── Procesamiento ─────────────────────────────────────────────────────

  procesar(): void {
    const archivo = this.archivo();
    if (!archivo || this.procesando()) return;

    this.error.set('');
    this.resultado.set(null);
    this.procesando.set(true);

    this.peticion = this.srv.cargaMasivaRadicados(archivo).subscribe({
      next: (res) => {
        this.procesando.set(false);
        this.resultado.set(res);
        this.exitososAcumulados.update((n) => n + (res.exitosos ?? 0));
      },
      error: (err: HttpErrorResponse) => {
        this.procesando.set(false);
        this.error.set(this.mensajeDeError(err));
      },
    });
  }

  /** Traduce el fallo HTTP a algo accionable; el dialogo NO se cierra. */
  private mensajeDeError(err: HttpErrorResponse): string {
    if (err.status === 0) {
      return 'No hay conexion con el servidor. Revisa tu red e intentalo de nuevo.';
    }
    if (err.status === 413) {
      return 'El servidor rechazo el archivo por tamano. Divide el archivo e intentalo de nuevo.';
    }
    const detalle =
      typeof err.error?.message === 'string' && err.error.message.trim()
        ? ` Detalle: ${err.error.message.trim()}`
        : '';
    return (
      `No se pudo procesar el archivo (HTTP ${err.status}). ` +
      `Corrige el archivo o intentalo de nuevo; no se radico ninguna fila.${detalle}`
    );
  }

  // ── Exportar fallidos ─────────────────────────────────────────────────

  /** Excel con SOLO las filas fallidas y su motivo, para corregir y reintentar. */
  exportarFallidos(): void {
    const fallidas = this.filasFallidas();
    if (fallidas.length === 0) return;

    const cabeceras = ['Fila', 'Cedula', 'Fecha inicio', 'Numero radicado', 'Motivo'];
    const datos = fallidas.map((f) => ({
      Fila: f.fila,
      Cedula: f.cedula,
      'Fecha inicio': f.fechaInicio,
      'Numero radicado': f.numeroRadicado,
      Motivo: f.mensaje,
    }));

    const hoja = XLSX.utils.json_to_sheet(datos, { header: cabeceras });
    hoja['!cols'] = [6, 14, 14, 18, 60].map((wch) => ({ wch }));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Fallidos');
    XLSX.writeFile(libro, `radicados-fallidos-${marcaDeTiempo()}.xlsx`);
  }

  // ── Cierre ────────────────────────────────────────────────────────────

  cerrar(): void {
    this.peticion?.unsubscribe();
    this.ref.close({ recargar: this.exitososAcumulados() > 0 });
  }

  ngOnDestroy(): void {
    this.peticion?.unsubscribe();
  }
}
