import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription, timer } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';
import { saveAs } from 'file-saver';

import {
  ExportJob,
  FiltrosIncapacidadV2,
  TipoExportJob,
} from '../../../../models/incapacidad-v2.model';
import { IncapacidadV2Service } from '../../../../services/incapacidad-v2/incapacidad-v2.service';

/**
 * `FILTRADO` (por defecto): el usuario elige ZIP de soportes o Excel consolidado del filtro.
 * `BASE_ACTUAL` (reunion 2026-10-05, boton "Base actual"): tipo EXCEL_BASE_ACTUAL fijo, sin
 * tarjetas y SIN filtros: el servidor exporta toda la base.
 */
export type ModoExportMasivo = 'FILTRADO' | 'BASE_ACTUAL';

/** Lo que recibe el dialogo desde la vista de consulta. */
export interface DatosDialogoExportMasivo {
  /** Filtros que estan aplicados AHORA en la consulta (los mismos que ve el usuario). */
  filtros: FiltrosIncapacidadV2;
  /** Total de registros que cumplen el filtro segun la tabla (`null` si no se conoce). */
  totalEstimado: number | null;
  /** Sin valor = `FILTRADO`. */
  modo?: ModoExportMasivo;
}

/** Nombre de descarga si el servidor no manda `nombreResultado` (no deberia pasar). */
export function nombrePorDefectoExport(tipo: TipoExportJob): string {
  switch (tipo) {
    case 'ZIP_SOPORTES':
      return 'soportes-incapacidades.zip';
    case 'ZIP_SEVENET':
      return 'sevenet-incapacidades.zip';
    case 'EXCEL_BASE_ACTUAL':
      return 'base-actual-incapacidades.xlsx';
    default:
      return 'incapacidades.xlsx';
  }
}

/** Cada cuanto se pregunta al servidor por el estado del trabajo. */
export const INTERVALO_SONDEO_MS = 2500;

/** En que pantalla esta el dialogo. Se deriva del trabajo, no se guarda aparte. */
export type FaseExportMasivo = 'seleccion' | 'progreso' | 'completado' | 'error';

/** Tarjeta seleccionable del paso 1. */
export interface TarjetaTipoExport {
  tipo: TipoExportJob;
  icono: string;
  titulo: string;
  descripcion: string;
}

export const TARJETAS_TIPO_EXPORT: readonly TarjetaTipoExport[] = [
  {
    tipo: 'ZIP_SOPORTES',
    icono: 'folder_zip',
    titulo: 'ZIP de soportes (PDFs renombrados)',
    descripcion:
      'Carpetas Apoyo|Alianza / Semana / EPS, con los nombres exactos que exige cada portal',
  },
  {
    tipo: 'EXCEL_CONSOLIDADO',
    icono: 'table_view',
    titulo: 'Excel consolidado (servidor)',
    descripcion: 'Todas las columnas y todas las filas del filtro actual, sin límite',
  },
];

/**
 * Dialogo de exportacion masiva SERVER-SIDE.
 *
 * A diferencia del dialogo hermano (`dialogo-exportar-incapacidades`), aqui el
 * archivo NO se arma en el navegador: el gateway corta toda peticion a los 30 s,
 * asi que el backend encola un TRABAJO asincrono (`POST /exports`) y este
 * dialogo se limita a sondear su estado cada 2,5 s hasta COMPLETADO o ERROR.
 *
 * Flujo:
 *   1. El usuario elige el tipo (ZIP de soportes o Excel consolidado).
 *   2. "Generar" crea el trabajo con los filtros YA aplicados en la consulta.
 *   3. Barra de progreso con `procesados / totalRegistros` (indeterminada
 *      mientras el servidor no informa el total).
 *   4. Al llegar a COMPLETADO se descarga sola UNA vez; el boton "Descargar"
 *      queda para repetirla.
 *
 * Cerrar el dialogo NO cancela nada: el trabajo sigue en el servidor (y su
 * resultado expira a los 7 dias). Al reabrir no se retoma: es aceptado.
 *
 * Abrirlo con:
 *   dialog.open(DialogoExportMasivoComponent, {
 *     width: '640px',
 *     maxWidth: '95vw',
 *     data: { filtros, totalEstimado },
 *   });
 */
@Component({
  selector: 'app-dialogo-export-masivo',
  standalone: true,
  imports: [
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  templateUrl: './dialogo-export-masivo.component.html',
  styleUrl: './dialogo-export-masivo.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoExportMasivoComponent implements OnDestroy {
  readonly datos = inject<DatosDialogoExportMasivo>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<DialogoExportMasivoComponent>>(MatDialogRef);
  private readonly srv = inject(IncapacidadV2Service);
  private readonly destroyRef = inject(DestroyRef);

  /** Suscripciones sueltas (crear y descargar). El sondeo va aparte. */
  private readonly subs = new Subscription();
  private sondeo?: Subscription;

  /** La descarga automatica solo ocurre la PRIMERA vez que llega COMPLETADO. */
  private descargaAutomaticaHecha = false;

  readonly tarjetas: readonly TarjetaTipoExport[] = TARJETAS_TIPO_EXPORT;

  /** Boton "Base actual": tipo fijo y sin filtros. */
  readonly esBaseActual = this.datos.modo === 'BASE_ACTUAL';

  // ── Estado ────────────────────────────────────────────────────────────

  readonly tipo = signal<TipoExportJob>(this.esBaseActual ? 'EXCEL_BASE_ACTUAL' : 'ZIP_SOPORTES');

  /** El trabajo tal como lo reporta el servidor (`null` = todavia no hay). */
  readonly job = signal<ExportJob | null>(null);

  /** `true` mientras el POST de creacion esta en vuelo. */
  readonly generando = signal(false);

  /** `true` mientras se baja el blob del resultado. */
  readonly descargando = signal(false);

  /** Errores LOCALES (crear, sondear o descargar). Los del trabajo van en el job. */
  readonly error = signal('');

  // ── Derivados ─────────────────────────────────────────────────────────

  readonly fase = computed<FaseExportMasivo>(() => {
    const job = this.job();
    if (!job) return 'seleccion';
    if (job.estado === 'COMPLETADO') return 'completado';
    if (job.estado === 'ERROR') return 'error';
    return 'progreso';
  });

  /** El filtro actual no tiene registros: no hay nada que exportar (la base actual no filtra). */
  readonly sinRegistros = computed(() => !this.esBaseActual && this.datos.totalEstimado === 0);

  readonly puedeGenerar = computed(
    () => this.fase() === 'seleccion' && !this.generando() && !this.sinRegistros(),
  );

  /** La barra es determinada solo cuando el servidor ya informo el total. */
  readonly progresoDeterminado = computed(() => {
    const job = this.job();
    return !!job && (job.totalRegistros ?? 0) > 0;
  });

  /** Porcentaje 0-100 (0 mientras no se conoce el total). */
  readonly progreso = computed(() => {
    const job = this.job();
    if (!job) return 0;
    const total = job.totalRegistros ?? 0;
    if (total <= 0) return 0;
    return Math.min(100, Math.round(((job.procesados ?? 0) / total) * 100));
  });

  // ── Paso 1: tipo ──────────────────────────────────────────────────────

  seleccionarTipo(tipo: TipoExportJob): void {
    if (this.fase() !== 'seleccion' || this.esBaseActual) return;
    this.tipo.set(tipo);
  }

  // ── Generar y sondear ─────────────────────────────────────────────────

  generar(): void {
    if (!this.puedeGenerar()) return;
    this.error.set('');
    this.generando.set(true);

    this.subs.add(
      this.srv.crearExport(this.tipo(), this.esBaseActual ? {} : this.datos.filtros).subscribe({
        next: (job) => {
          this.generando.set(false);
          this.job.set(job);
          this.iniciarSondeo(job.id);
        },
        error: () => {
          this.generando.set(false);
          this.error.set('No se pudo crear el trabajo de exportación. Inténtalo de nuevo.');
        },
      }),
    );
  }

  /**
   * Pregunta el estado cada `INTERVALO_SONDEO_MS` hasta que el trabajo termina.
   * `takeWhile(..., true)` deja pasar TAMBIEN el estado terminal antes de
   * completar, y `takeUntilDestroyed` corta el timer si el dialogo se destruye.
   */
  private iniciarSondeo(id: string): void {
    this.sondeo?.unsubscribe();
    this.sondeo = timer(0, INTERVALO_SONDEO_MS)
      .pipe(
        switchMap(() => this.srv.estadoExport(id)),
        takeWhile((job) => job.estado !== 'COMPLETADO' && job.estado !== 'ERROR', true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (job) => {
          this.job.set(job);
          if (job.estado === 'COMPLETADO' && !this.descargaAutomaticaHecha) {
            this.descargaAutomaticaHecha = true;
            this.descargar();
          }
        },
        error: () => {
          // El trabajo sigue vivo en el servidor, pero sin sondeo este dialogo
          // ya no puede seguirlo: se vuelve al paso 1 para generar otro.
          this.job.set(null);
          this.error.set(
            'Se perdió la consulta del estado del trabajo. Genera la exportación de nuevo.',
          );
        },
      });
  }

  // ── Descarga ──────────────────────────────────────────────────────────

  descargar(): void {
    const job = this.job();
    if (!job || job.estado !== 'COMPLETADO' || this.descargando()) return;
    this.error.set('');
    this.descargando.set(true);

    this.subs.add(
      this.srv.descargarExport(job.id).subscribe({
        next: (blob) => {
          this.descargando.set(false);
          this.guardarArchivo(blob, job.nombreResultado || nombrePorDefectoExport(job.tipo));
        },
        error: () => {
          this.descargando.set(false);
          this.error.set('No se pudo descargar el resultado. Inténtalo con el botón "Descargar".');
        },
      }),
    );
  }

  /** Envoltura de `saveAs` separada para poder espiarla en las pruebas. */
  guardarArchivo(blob: Blob, nombre: string): void {
    saveAs(blob, nombre);
  }

  // ── Otras acciones ────────────────────────────────────────────────────

  /** Vuelve al paso 1 (tras un ERROR o para generar el otro tipo). */
  reintentar(): void {
    this.sondeo?.unsubscribe();
    this.sondeo = undefined;
    this.descargaAutomaticaHecha = false;
    this.job.set(null);
    this.error.set('');
  }

  /** Cerrar NO cancela el trabajo: sigue corriendo en el servidor. */
  cerrar(): void {
    this.sondeo?.unsubscribe();
    this.ref.close();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.sondeo?.unsubscribe();
  }

  // ── Utilidades de presentacion ────────────────────────────────────────

  /** Tamano legible del resultado ('' si el servidor no lo informa). */
  tamanoLegible(bytes: number | null): string {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  trackTarjeta = (_: number, tarjeta: TarjetaTipoExport) => tarjeta.tipo;
}
