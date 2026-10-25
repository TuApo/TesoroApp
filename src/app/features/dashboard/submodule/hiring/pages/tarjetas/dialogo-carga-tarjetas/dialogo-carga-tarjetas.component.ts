import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { Subscription } from 'rxjs';

import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import {
  FilaResultado,
  FormatoCarga,
  RespuestaAplicacion,
  RespuestaSimulacion,
  TarjetasService,
} from '../../../service/tarjetas.service';

/** Lo que devuelve el diálogo al cerrarse. */
export interface ResultadoDialogoCargaTarjetas {
  /** `true` si se aplicó algo y el listado debe recargarse. */
  recargar: boolean;
}

/** Extensiones que acepta el backend. */
export const EXTENSIONES_ACEPTADAS = ['.xls', '.xlsx'] as const;

/** Tope de tamaño, el mismo que valida el backend. */
export const TAMANO_MAXIMO_ARCHIVO = 15 * 1024 * 1024;

/**
 * Carga masiva de tarjetas en dos pasos.
 *
 * ```
 *   elegir archivo → SIMULAR → revisar el veredicto → CONFIRMAR → APLICAR
 * ```
 *
 * La simulación **no escribe ninguna tarjeta**: el backend lee, normaliza, valida y compara
 * contra la base, y devuelve qué haría con cada fila. Solo el botón de confirmar persiste.
 *
 * El diálogo no se cierra ante un error: el usuario descarga el Excel de resultados,
 * corrige su archivo y vuelve a intentarlo. Volver a subir el mismo archivo es seguro —
 * la carga es idempotente y la segunda pasada sale como SIN_CAMBIOS.
 */
@Component({
  selector: 'app-dialogo-carga-tarjetas',
  standalone: true,
  imports: [
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatChipsModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './dialogo-carga-tarjetas.component.html',
  styleUrl: './dialogo-carga-tarjetas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoCargaTarjetasComponent implements OnDestroy {
  private readonly ref =
    inject<MatDialogRef<DialogoCargaTarjetasComponent, ResultadoDialogoCargaTarjetas>>(MatDialogRef);
  private readonly srv = inject(TarjetasService);

  private peticion?: Subscription;

  readonly extensionesTexto = EXTENSIONES_ACEPTADAS.join(' o ');

  // ── Estado ──────────────────────────────────────────────────────────────

  readonly archivo = signal<File | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly codigoError = signal<string | null>(null);

  readonly simulacion = signal<RespuestaSimulacion | null>(null);
  readonly aplicacion = signal<RespuestaAplicacion | null>(null);
  readonly formato = signal<FormatoCarga | null>(null);
  readonly formatoVisible = signal(false);

  /** Hubo al menos una escritura: el listado de atrás tiene que recargarse. */
  private aplicado = false;

  readonly paso = computed<'archivo' | 'revision' | 'resultado'>(() => {
    if (this.aplicacion()) return 'resultado';
    return this.simulacion() ? 'revision' : 'archivo';
  });

  /** Nada aplicable = no tiene sentido ofrecer el botón de confirmar. */
  readonly puedeAplicar = computed(() => {
    const s = this.simulacion();
    return !!s && s.resumen.filas_validas > 0;
  });

  readonly columnas: ColumnaTabla<FilaResultado>[] = [
    { id: 'fila', header: 'Fila', valor: (f) => f.fila, align: 'right', ancho: '80px', tarjeta: 'titulo' },
    { id: 'estado', header: 'Estado', valor: (f) => f.estado, minAncho: '170px' },
    { id: 'accion', header: 'Acción prevista', valor: (f) => f.accion, minAncho: '140px' },
    { id: 'identificacion', header: 'Identificación', valor: (f) => f.identificacion ?? '—', minAncho: '130px' },
    { id: 'tarjeta', header: 'Tarjeta', valor: (f) => f.numero_tarjeta ?? '—', minAncho: '160px' },
    { id: 'mensaje', header: 'Detalle', valor: (f) => f.mensaje ?? '', minAncho: '320px', tarjeta: 'cuerpo' },
  ];

  constructor() {
    this.srv.formato().subscribe({
      next: (f) => this.formato.set(f),
      // El contrato de columnas es ayuda, no requisito: si falla, la carga sigue.
      error: () => this.formato.set(null),
    });
  }

  ngOnDestroy(): void {
    this.peticion?.unsubscribe();
  }

  // ── Elegir archivo ──────────────────────────────────────────────────────

  alElegirArchivo(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    this.aceptar(input.files?.[0] ?? null);
    input.value = '';
  }

  alSoltar(evento: DragEvent): void {
    evento.preventDefault();
    this.aceptar(evento.dataTransfer?.files?.[0] ?? null);
  }

  alArrastrar(evento: DragEvent): void {
    evento.preventDefault();
  }

  private aceptar(archivo: File | null): void {
    if (!archivo) return;
    const nombre = archivo.name.toLowerCase();
    if (!EXTENSIONES_ACEPTADAS.some((e) => nombre.endsWith(e))) {
      this.error.set(`Solo se admiten archivos ${this.extensionesTexto}.`);
      return;
    }
    if (archivo.size > TAMANO_MAXIMO_ARCHIVO) {
      this.error.set(`El archivo pesa más de ${TAMANO_MAXIMO_ARCHIVO / (1024 * 1024)} MB.`);
      return;
    }
    this.error.set(null);
    this.codigoError.set(null);
    this.simulacion.set(null);
    this.aplicacion.set(null);
    this.archivo.set(archivo);
  }

  quitarArchivo(): void {
    this.archivo.set(null);
    this.simulacion.set(null);
    this.aplicacion.set(null);
    this.error.set(null);
  }

  // ── Paso 1: simular ─────────────────────────────────────────────────────

  simular(): void {
    const archivo = this.archivo();
    if (!archivo || this.cargando()) return;

    this.cargando.set(true);
    this.error.set(null);
    this.codigoError.set(null);

    this.peticion = this.srv.simular(archivo).subscribe({
      next: (r) => {
        this.simulacion.set(r);
        this.cargando.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.mostrarError(e);
        this.cargando.set(false);
      },
    });
  }

  // ── Paso 2: aplicar ─────────────────────────────────────────────────────

  aplicar(): void {
    const s = this.simulacion();
    if (!s || this.cargando()) return;

    this.cargando.set(true);
    this.error.set(null);

    this.peticion = this.srv.aplicar(s.lote_id).subscribe({
      next: (r) => {
        this.aplicacion.set(r);
        this.aplicado = true;
        this.cargando.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.mostrarError(e);
        this.cargando.set(false);
      },
    });
  }

  // ── Descargas ───────────────────────────────────────────────────────────

  descargarResultado(soloProblemas: boolean): void {
    const loteId = this.aplicacion()?.lote_id ?? this.simulacion()?.lote_id;
    if (!loteId) return;
    this.srv.resultadoExcel(loteId, soloProblemas).subscribe({
      next: (blob) => this.descargar(blob,
        `${soloProblemas ? 'tarjetas_errores' : 'tarjetas_resultado'}_lote_${loteId}.xlsx`),
      error: (e: HttpErrorResponse) => this.mostrarError(e),
    });
  }

  private descargar(blob: Blob, nombre: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Cerrar ──────────────────────────────────────────────────────────────

  cerrar(): void {
    this.ref.close({ recargar: this.aplicado });
  }

  volverAEmpezar(): void {
    this.archivo.set(null);
    this.simulacion.set(null);
    this.aplicacion.set(null);
    this.error.set(null);
  }

  alternarFormato(): void {
    this.formatoVisible.update((v) => !v);
  }

  // ── Errores ─────────────────────────────────────────────────────────────

  /**
   * El backend manda `{error, codigo}` con códigos estables
   * (IMPORTACION_TARJETAS_*). Se muestran los dos: el mensaje para el usuario y el código
   * para que soporte sepa exactamente qué pasó.
   */
  private mostrarError(e: HttpErrorResponse): void {
    const cuerpo = e.error ?? {};
    this.error.set(cuerpo.error ?? cuerpo.message ?? 'No se pudo procesar el archivo.');
    this.codigoError.set(cuerpo.codigo ?? null);
  }

  tamanoLegible(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
