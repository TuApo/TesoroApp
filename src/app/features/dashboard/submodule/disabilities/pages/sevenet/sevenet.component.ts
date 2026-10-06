/**
 * SEVENET (reunion funcional 2026-10-05).
 *
 * SEVENET es el aplicativo de ARCHIVO DIGITAL de la empresa (lo administra Angela). Se carga
 * con un archivo plano (Excel con la ruta de cada PDF) mas los PDF de SOLO la primera hoja de
 * cada incapacidad (no la historia clinica).
 *
 * Fase 1 (esta pantalla): con fecha inicial y final se genera una CARPETA COMPRIMIDA con la
 * primera hoja de TODAS las incapacidades del rango, consolidada (Apoyo y Alianza juntas). Se
 * trabaja por semanas: los atajos dan la semana de cartera (lunes a sabado). El rango se mira
 * por fecha de REGISTRO (lo cargado esa semana, lo normal) o por fecha de inicio.
 *
 * El ZIP lo arma el servidor como trabajo asincrono (`ZIP_SEVENET`): el gateway corta a los
 * 30 s, asi que se crea el trabajo, se sondea cada 2,5 s y al terminar se descarga solo. El
 * boton del archivo plano queda deshabilitado hasta definir con Angela la estructura del
 * "archivo arbol".
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription, of, timer } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  startWith,
  switchMap,
  takeWhile,
  tap,
} from 'rxjs/operators';
import { saveAs } from 'file-saver';

import { ExportJob } from '../../models/incapacidad-v2.model';
import { IncapacidadV2Service } from '../../services/incapacidad-v2/incapacidad-v2.service';
import { aIsoCorto } from '../../utils/fechas';
import type { FiltrosConsultaIncapacidad } from '../consulta-incapacidades/consulta-incapacidades.model';
import { INTERVALO_SONDEO_MS } from '../consulta-incapacidades/dialogos/dialogo-export-masivo/dialogo-export-masivo.component';

/** Fecha por la que se mira el rango. */
export type EjeSevenet = 'REGISTRO' | 'INICIO';

export interface RangoSemana {
  inicio: Date;
  fin: Date;
}

/** Espera tras el ultimo cambio del rango antes de contar (no pedir en cada tecla). */
export const MS_ESPERA_CONTEO = 300;

/** Aviso del boton del archivo plano (fase 2, pendiente de la reunion con Angela). */
export const AVISO_ARCHIVO_PLANO = 'Pendiente: se define con Ángela (estructura del archivo árbol)';

/**
 * Semana de cartera que contiene `referencia`: de LUNES a SABADO. El domingo pertenece a la
 * semana que empezo el lunes anterior (igual que `SemanaRadicacion` de ms-hr).
 * `desplazamiento = -1` da la semana anterior. Fechas locales, sin horas.
 */
export function semanaCartera(referencia: Date, desplazamiento = 0): RangoSemana {
  const dia = referencia.getDay(); // 0 = domingo ... 6 = sabado
  const desdeLunes = dia === 0 ? 6 : dia - 1;
  const inicio = new Date(
    referencia.getFullYear(),
    referencia.getMonth(),
    referencia.getDate() - desdeLunes + 7 * desplazamiento,
  );
  const fin = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + 5);
  return { inicio, fin };
}

/**
 * Filtros del trabajo y del conteo (los mismos, para que el numero mostrado sea lo que trae
 * la carpeta). Contrato de ms-hr: registro -> `registradoDesde/Hasta`; inicio -> `desde/hasta`.
 */
export function filtrosSevenet(
  eje: EjeSevenet,
  desde: string,
  hasta: string,
): FiltrosConsultaIncapacidad {
  return eje === 'REGISTRO'
    ? { registradoDesde: desde, registradoHasta: hasta }
    : { desde, hasta };
}

/** `yyyy-MM-dd` -> `dd/MM/yyyy` para mostrar ('' si no hay fecha). */
function legible(iso: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : '';
}

/** Mensaje del backend (`{"error": "..."}`) o el de respaldo. */
function mensajeError(e: unknown, porDefecto: string): string {
  const err = e as { error?: { error?: string; message?: string } } | null;
  return err?.error?.error || err?.error?.message || porDefecto;
}

/** El rango con el que se creo el trabajo en curso (el formulario puede cambiar despues). */
interface RangoGenerado {
  desde: string;
  hasta: string;
  eje: EjeSevenet;
}

@Component({
  selector: 'app-sevenet',
  standalone: true,
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatTooltipModule,
  ],
  providers: [provideNativeDateAdapter(), { provide: MAT_DATE_LOCALE, useValue: 'es-CO' }],
  templateUrl: './sevenet.component.html',
  styleUrls: ['../gestion-incapacidades.comun.css', './sevenet.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SevenetComponent {
  private readonly srv = inject(IncapacidadV2Service);
  private readonly destroyRef = inject(DestroyRef);

  readonly avisoArchivoPlano = AVISO_ARCHIVO_PLANO;

  // ── Rango ─────────────────────────────────────────────────────────────

  readonly form = new FormGroup({
    eje: new FormControl<EjeSevenet>('REGISTRO', { nonNullable: true }),
    inicial: new FormControl<Date | null>(null),
    final: new FormControl<Date | null>(null),
  });

  /** Puente zoneless: el valor del formulario como signal. */
  private readonly valores = toSignal(
    this.form.valueChanges.pipe(
      startWith(null),
      map(() => this.form.getRawValue()),
    ),
    { requireSync: true },
  );

  readonly eje = computed(() => this.valores().eje);
  readonly desde = computed(() => aIsoCorto(this.valores().inicial));
  readonly hasta = computed(() => aIsoCorto(this.valores().final));
  readonly desdeTexto = computed(() => legible(this.desde()));
  readonly hastaTexto = computed(() => legible(this.hasta()));

  /** '' si el rango sirve; si no, que le falta (las dos fechas son obligatorias). */
  readonly problemaRango = computed(() => this.problemaDe(this.desde(), this.hasta()));

  /** Filtros listos para el servidor, o `null` si el rango no sirve. */
  readonly filtros = computed<FiltrosConsultaIncapacidad | null>(() =>
    this.problemaRango() ? null : filtrosSevenet(this.eje(), this.desde(), this.hasta()),
  );

  /** Atajo que coincide con el rango actual (para resaltarlo). */
  readonly atajo = computed<'ACTUAL' | 'ANTERIOR' | null>(() => {
    const d = this.desde();
    const h = this.hasta();
    const esta = semanaCartera(new Date());
    const anterior = semanaCartera(new Date(), -1);
    if (d === aIsoCorto(esta.inicio) && h === aIsoCorto(esta.fin)) return 'ACTUAL';
    if (d === aIsoCorto(anterior.inicio) && h === aIsoCorto(anterior.fin)) return 'ANTERIOR';
    return null;
  });

  // ── Conteo previo ─────────────────────────────────────────────────────

  /** Cuantas incapacidades hay en el rango (`null` = sin calcular o sin rango). */
  readonly conteo = signal<number | null>(null);
  readonly contando = signal(false);
  readonly errorConteo = signal('');

  // ── Trabajo ZIP_SEVENET ───────────────────────────────────────────────

  readonly job = signal<ExportJob | null>(null);
  readonly generando = signal(false);
  readonly descargando = signal(false);
  readonly errorJob = signal('');
  readonly rangoGenerado = signal<RangoGenerado | null>(null);
  private sondeo?: Subscription;
  /** La descarga automatica ocurre solo la PRIMERA vez que llega COMPLETADO. */
  private descargaAutomaticaHecha = false;

  readonly fase = computed<'inicio' | 'progreso' | 'completado' | 'error'>(() => {
    const job = this.job();
    if (!job) return 'inicio';
    if (job.estado === 'COMPLETADO') return 'completado';
    if (job.estado === 'ERROR') return 'error';
    return 'progreso';
  });

  readonly enCurso = computed(() => this.generando() || this.fase() === 'progreso');

  /** Con 0 incapacidades no hay nada que comprimir; si el conteo fallo, se deja intentar. */
  readonly puedeGenerar = computed(
    () => !!this.filtros() && !this.enCurso() && this.conteo() !== 0,
  );

  readonly progresoDeterminado = computed(() => (this.job()?.totalRegistros ?? 0) > 0);

  readonly progreso = computed(() => {
    const job = this.job();
    const total = job?.totalRegistros ?? 0;
    if (!job || total <= 0) return 0;
    return Math.min(100, Math.round(((job.procesados ?? 0) / total) * 100));
  });

  readonly textoRangoGenerado = computed(() => {
    const r = this.rangoGenerado();
    if (!r) return '';
    const eje = r.eje === 'REGISTRO' ? 'por fecha de registro' : 'por fecha de inicio';
    return `Del ${legible(r.desde)} al ${legible(r.hasta)}, ${eje}`;
  });

  constructor() {
    // Arranca con la semana en curso: es lo que se carga a SEVENET cada semana.
    this.aplicarSemana(0);
    this.conectarConteo();
  }

  // ── Rango ─────────────────────────────────────────────────────────────

  /** Atajos "Esta semana" (0) y "Semana anterior" (-1): lunes a sabado. */
  aplicarSemana(desplazamiento: 0 | -1): void {
    const { inicio, fin } = semanaCartera(new Date(), desplazamiento);
    this.form.patchValue({ inicial: inicio, final: fin });
  }

  private problemaDe(desde: string, hasta: string): string {
    if (!desde) return 'Elige la fecha inicial.';
    if (!hasta) return 'Elige la fecha final.';
    if (desde > hasta) return 'La fecha inicial no puede ser posterior a la final.';
    return '';
  }

  /**
   * Cuenta con `GET /Incapacidades/v2` (tamano 1 -> totalElements) y los MISMOS filtros que
   * llevara el trabajo. Cada cambio del rango cancela la cuenta anterior (`switchMap`).
   */
  private conectarConteo(): void {
    this.form.valueChanges
      .pipe(
        startWith(null),
        map(() => {
          const v = this.form.getRawValue();
          const desde = aIsoCorto(v.inicial);
          const hasta = aIsoCorto(v.final);
          return this.problemaDe(desde, hasta) ? null : filtrosSevenet(v.eje, desde, hasta);
        }),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap((filtros) => {
          this.conteo.set(null);
          this.errorConteo.set('');
          this.contando.set(!!filtros);
        }),
        debounceTime(MS_ESPERA_CONTEO),
        switchMap((filtros) =>
          !filtros
            ? of(null)
            : this.srv.listar(filtros, 0, 1).pipe(
                map((pagina) => pagina.totalElements ?? 0),
                catchError((e: unknown) => {
                  this.errorConteo.set(
                    mensajeError(e, 'No se pudo contar las incapacidades del rango.'),
                  );
                  return of(null);
                }),
              ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((total) => {
        this.conteo.set(total);
        this.contando.set(false);
      });
  }

  // ── Generar, sondear y descargar ──────────────────────────────────────

  generar(): void {
    const filtros = this.filtros();
    if (!filtros || !this.puedeGenerar()) return;
    this.sondeo?.unsubscribe();
    this.descargaAutomaticaHecha = false;
    this.errorJob.set('');
    this.job.set(null);
    this.generando.set(true);
    this.rangoGenerado.set({ desde: this.desde(), hasta: this.hasta(), eje: this.eje() });

    this.srv
      .crearExport('ZIP_SEVENET', filtros)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (job) => {
          this.generando.set(false);
          this.job.set(job);
          this.iniciarSondeo(job.id);
        },
        error: (e: unknown) => {
          this.generando.set(false);
          this.errorJob.set(
            mensajeError(e, 'No se pudo crear la carpeta en el servidor. Inténtalo de nuevo.'),
          );
        },
      });
  }

  /** Mismo sondeo que la descarga masiva: cada 2,5 s hasta COMPLETADO o ERROR. */
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
          // El trabajo sigue en el servidor, pero sin sondeo no se puede seguir: se vuelve
          // al inicio para generarlo otra vez.
          this.job.set(null);
          this.errorJob.set('Se perdió la consulta del estado de la carpeta. Genérala de nuevo.');
        },
      });
  }

  descargar(): void {
    const job = this.job();
    if (!job || job.estado !== 'COMPLETADO' || this.descargando()) return;
    this.errorJob.set('');
    this.descargando.set(true);
    this.srv
      .descargarExport(job.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.descargando.set(false);
          this.guardarArchivo(blob, job.nombreResultado || this.nombreRespaldo());
        },
        error: () => {
          this.descargando.set(false);
          this.errorJob.set('No se pudo descargar la carpeta. Usa el botón "Descargar de nuevo".');
        },
      });
  }

  /** Envoltura de `saveAs` separada para poder espiarla en las pruebas. */
  guardarArchivo(blob: Blob, nombre: string): void {
    saveAs(blob, nombre);
  }

  /** Mismo patron de nombre que usa el servidor, por si no lo informa. */
  private nombreRespaldo(): string {
    const r = this.rangoGenerado();
    return r ? `sevenet_${r.desde}_${r.hasta}.zip` : 'sevenet-incapacidades.zip';
  }

  /** Tamano legible del resultado ('' si el servidor no lo informa). */
  tamanoLegible(bytes: number | null | undefined): string {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
