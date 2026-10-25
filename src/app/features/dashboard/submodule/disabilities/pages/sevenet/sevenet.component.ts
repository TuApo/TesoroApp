/**
 * SEVENET (reunion funcional 2026-10-05).
 *
 * SEVENET es el aplicativo de ARCHIVO DIGITAL de la empresa (lo administra Angela). Se carga
 * con un archivo plano (Excel con la ruta de cada PDF) mas los PDF de SOLO la primera hoja de
 * cada incapacidad (no la historia clinica).
 *
 * Fase 1: con fecha inicial y final se genera una CARPETA COMPRIMIDA con la primera hoja de
 * TODAS las incapacidades del rango (en la fase 2 ya separada por empleador, ver abajo). Se
 * trabaja por semanas: los atajos dan la semana de lunes a DOMINGO (la de cartera es de lunes a sabado,
 * pero aqui el domingo no puede quedar fuera de toda semana: lo registrado ese dia se perderia). El rango se mira
 * por fecha de REGISTRO (lo cargado esa semana, lo normal) o por fecha de inicio.
 *
 * El ZIP lo arma el servidor como trabajo asincrono (`ZIP_SEVENET`): el gateway corta a los
 * 30 s, asi que se crea el trabajo, se sondea cada 2,5 s y al terminar se descarga solo.
 *
 * Fase 2 (respuesta de la funcional 2026-10-07, con sus 4 Excel de cargue): el ZIP sale separado
 * por empleador (`SEMANA {N} APOYO|ALIANZA/{CEDULA}.pdf`) con el ARCHIVO PLANO de cada uno (hoja
 * "Plantilla_original_ok"), cuya `ruta_imagen` = carpeta base + carpeta de la semana + cedula.
 * Por eso aqui se piden la semana SEVENET (obligatoria) y la carpeta base del computador donde se
 * descomprime; las dos se recuerdan en localStorage (la semana con su fecha, para sugerir la
 * siguiente). "Solo archivo plano" pide unicamente los Excel, sin bajar PDF.
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
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
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

import { getLocalStorageItem, setLocalStorageItem } from '../../../../../../core/utils/safe-storage';
import { ExportJob, ExportOpcionesSevenet } from '../../models/incapacidad-v2.model';
import { IncapacidadV2Service } from '../../services/incapacidad-v2/incapacidad-v2.service';
import { aIsoCorto } from '../../utils/fechas';
import type { FiltrosConsultaIncapacidad } from '../consulta-incapacidades/consulta-incapacidades.model';
import { INTERVALO_SONDEO_MS } from '../consulta-incapacidades/dialogos/dialogo-export-masivo/dialogo-export-masivo.component';
import { GuiaSaludComponent } from '../../components/guia-salud/guia-salud.component';

/** Fecha por la que se mira el rango. */
export type EjeSevenet = 'REGISTRO' | 'INICIO';

export interface RangoSemana {
  inicio: Date;
  fin: Date;
}

/** Espera tras el ultimo cambio del rango antes de contar (no pedir en cada tecla). */
export const MS_ESPERA_CONTEO = 300;

/** Carpeta del computador de cartera que usan las plantillas de cargue de la funcional. */
export const CARPETA_BASE_POR_DEFECTO = 'C:\\Users\\AUXCART1\\Desktop\\SEVENET\\';
/** Topes del contrato de `opciones` (ms-hr los valida igual). */
export const MAX_CARPETA_BASE = 200;
export const MAX_SEMANA_SEVENET = 9999;
/**
 * Donde se recuerdan la ultima semana usada (con su fecha) y la carpeta base. Esta en
 * `CLAVES_DE_DISPOSITIVO` de safe-storage: el logout borra el localStorage y sin eso la semana
 * nunca se podria sugerir de una semana a la siguiente.
 */
export const CLAVE_MEMORIA_SEVENET = 'tuapo.incapacidades.sevenet';

/** Lo que se recuerda entre visitas (por navegador). */
export interface MemoriaSevenet {
  /** 0 = no hay semana recordada (solo la carpeta). */
  semana: number;
  /** `yyyy-MM-dd` del dia en que se uso esa semana. */
  fecha: string;
  carpetaBase: string;
  /** Reunion 2026-10-20: Apoyo y Alianza en una sola carpeta (por defecto si nunca se eligio). */
  unirTemporales?: boolean;
}

/** '' si la semana sirve (entero de 1 a 9999); si no, que le pasa. */
export function problemaSemana(semana: number | null | undefined): string {
  if (semana === null || semana === undefined || Number.isNaN(semana)) return 'Escribe la semana SEVENET.';
  if (!Number.isInteger(semana) || semana < 1 || semana > MAX_SEMANA_SEVENET) {
    return `La semana SEVENET debe ser un número entero entre 1 y ${MAX_SEMANA_SEVENET}.`;
  }
  return '';
}

/** Carpeta sin espacios sobrantes; vacia = la de las plantillas (lo que el backend usa por defecto). */
export function normalizarCarpetaBase(carpeta: string | null | undefined): string {
  const limpia = (carpeta ?? '').trim();
  return limpia || CARPETA_BASE_POR_DEFECTO;
}

/**
 * Como quedara `ruta_imagen` en el archivo plano (espejo de `OpcionesSevenet.normalizar` de ms-hr:
 * quita las barras finales, '\' o '/', y deja UNA '\'). Sirve para que quien carga vea donde debe
 * descomprimir; con solo "termina en '\'" el ejemplo mostraba `D:\SEV/\SEMANA...` o `\\` dobles
 * que el archivo plano no trae.
 */
export function rutaImagenEjemplo(
  carpeta: string,
  semana: number | null,
  grupo: 'APOYO' | 'ALIANZA' | null,
): string {
  const conBarra = `${normalizarCarpetaBase(carpeta).replace(/[\\/]+$/, '')}\\`;
  const n = problemaSemana(semana) ? 'N' : String(semana);
  // grupo null = Apoyo y Alianza unidas (reunion 2026-10-20): SEMANA {N}\CEDULA.pdf
  return grupo ? `${conBarra}SEMANA ${n} ${grupo}\\CEDULA.pdf` : `${conBarra}SEMANA ${n}\\CEDULA.pdf`;
}

/**
 * Lee la memoria tolerando todo: sin almacenamiento, JSON roto o valores fuera de rango dan
 * `null` (o se ignora el campo malo) y la pantalla arranca con los valores por defecto.
 */
export function leerMemoriaSevenet(): MemoriaSevenet | null {
  try {
    const crudo = getLocalStorageItem(CLAVE_MEMORIA_SEVENET);
    if (!crudo) return null;
    const dato = JSON.parse(crudo) as Partial<MemoriaSevenet> | null;
    if (!dato || typeof dato !== 'object') return null;
    const semana = typeof dato.semana === 'number' && !problemaSemana(dato.semana) ? dato.semana : null;
    const fecha = typeof dato.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dato.fecha) ? dato.fecha : null;
    const carpeta =
      typeof dato.carpetaBase === 'string' && dato.carpetaBase.trim() && dato.carpetaBase.length <= MAX_CARPETA_BASE
        ? dato.carpetaBase
        : CARPETA_BASE_POR_DEFECTO;
    // Sin semana valida y con su fecha no hay que sugerir; la carpeta igual se recuerda.
    const unir = typeof dato.unirTemporales === 'boolean' ? dato.unirTemporales : undefined;
    return {
      semana: semana && fecha ? semana : 0,
      fecha: semana && fecha ? fecha : '',
      carpetaBase: carpeta,
      ...(unir === undefined ? {} : { unirTemporales: unir }),
    };
  } catch {
    return null;
  }
}

/** Guarda la memoria; si el navegador no deja (cuota, modo privado), no pasa nada. */
export function guardarMemoriaSevenet(memoria: MemoriaSevenet): void {
  try {
    setLocalStorageItem(CLAVE_MEMORIA_SEVENET, JSON.stringify(memoria));
  } catch {
    /* sin memoria: la proxima vez se escribe la semana a mano */
  }
}

/**
 * Semana a sugerir: la ultima usada mas las semanas (lunes a domingo) transcurridas desde
 * entonces. Misma semana = mismo numero (rehacer el cargue). `null` si no hay memoria.
 */
export function semanaSugerida(memoria: MemoriaSevenet | null, hoy: Date): number | null {
  if (!memoria || !memoria.semana || !memoria.fecha) return null;
  const [a, m, d] = memoria.fecha.split('-').map(Number);
  const lunesUsada = semanaCartera(new Date(a, m - 1, d)).inicio.getTime();
  const lunesHoy = semanaCartera(hoy).inicio.getTime();
  // round: un cambio de horario (si lo hubiera) no debe restar una semana.
  const semanas = Math.round((lunesHoy - lunesUsada) / (7 * 24 * 60 * 60 * 1000));
  // Fecha guardada en el futuro (reloj cambiado): se sugiere la misma, nunca una menor.
  return Math.min(MAX_SEMANA_SEVENET, memoria.semana + Math.max(0, semanas));
}

/**
 * Semana que contiene `referencia`: de LUNES a DOMINGO. El domingo pertenece a la semana que
 * empezo el lunes anterior (igual que `SemanaRadicacion` de ms-hr) y CIERRA el rango: con lunes a
 * sabado lo registrado un domingo no caia en ninguna semana (revision de integracion 2026-10-06).
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
  const fin = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + 6);
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
  semana: number;
  soloPlano: boolean;
}

@Component({
  selector: 'app-sevenet',
  standalone: true,
  imports: [
    GuiaSaludComponent,
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
    MatSlideToggleModule,
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

  // ── Datos del cargue (semana SEVENET y carpeta base) ──────────────────

  /** Lo recordado de la vez anterior (se lee una vez al abrir). */
  private readonly memoria = leerMemoriaSevenet();

  readonly cargue = new FormGroup({
    semana: new FormControl<number | null>(semanaSugerida(this.memoria, new Date())),
    carpetaBase: new FormControl<string>(this.memoria?.carpetaBase ?? CARPETA_BASE_POR_DEFECTO, {
      nonNullable: true,
    }),
  });

  private readonly valoresCargue = toSignal(
    this.cargue.valueChanges.pipe(
      startWith(null),
      map(() => this.cargue.getRawValue()),
    ),
    { requireSync: true },
  );

  readonly semana = computed(() => this.valoresCargue().semana);
  /** Para los textos: la semana o 'N' mientras no sirva. */
  readonly semanaTexto = computed(() => (problemaSemana(this.semana()) ? 'N' : String(this.semana())));
  /** La carpeta que se enviara (vacia = la de las plantillas). */
  readonly carpetaBase = computed(() => normalizarCarpetaBase(this.valoresCargue().carpetaBase));

  /** '' si semana y carpeta sirven; si no, que falta (la semana es obligatoria para generar). */
  readonly problemaCargue = computed(() => {
    const semana = problemaSemana(this.semana());
    if (semana) return semana;
    if (this.valoresCargue().carpetaBase.trim().length > MAX_CARPETA_BASE) {
      return `La carpeta base admite hasta ${MAX_CARPETA_BASE} caracteres.`;
    }
    return '';
  });

  /**
   * Reunion 2026-10-20: "se puede unir ambas temporales". Por defecto UNIDAS (una sola carpeta
   * `SEMANA {N}`); se recuerda lo ultimo que eligio quien carga.
   */
  readonly unirTemporales = signal(this.memoria?.unirTemporales ?? true);

  readonly rutaEjemplo = computed(() =>
    rutaImagenEjemplo(
      this.valoresCargue().carpetaBase,
      this.semana(),
      this.unirTemporales() ? null : 'APOYO',
    ),
  );

  /** De donde salio la semana sugerida (o que se recordara para la proxima). */
  readonly ayudaSemana =
    this.memoria?.semana && this.memoria.fecha
      ? `Sugerida a partir de la ${this.memoria.semana}, usada el ${legible(this.memoria.fecha)}.`
      : 'La de SEVENET; se recuerda para sugerir la siguiente.';

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

  /**
   * Con 0 incapacidades no hay nada que comprimir; si el conteo fallo, se deja intentar. La
   * semana SEVENET es obligatoria: nombra las carpetas y arma las rutas del archivo plano.
   */
  readonly puedeGenerar = computed(
    () => !!this.filtros() && !this.enCurso() && this.conteo() !== 0 && !this.problemaCargue(),
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
    const plano = r.soloPlano ? ' (solo archivo plano)' : '';
    return `Semana ${r.semana}${plano}: del ${legible(r.desde)} al ${legible(r.hasta)}, ${eje}`;
  });

  /** Lo que se esta armando o quedo listo: carpeta completa o solo el archivo plano. */
  readonly soloPlanoGenerado = computed(() => this.rangoGenerado()?.soloPlano ?? false);

  constructor() {
    // Arranca con la semana en curso: es lo que se carga a SEVENET cada semana.
    this.aplicarSemana(0);
    this.conectarConteo();
  }

  // ── Rango ─────────────────────────────────────────────────────────────

  /** Atajos "Esta semana" (0) y "Semana anterior" (-1): lunes a domingo. */
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

  /** Vuelve a la carpeta de las plantillas de la funcional. */
  restablecerCarpeta(): void {
    this.cargue.controls.carpetaBase.setValue(CARPETA_BASE_POR_DEFECTO);
  }

  // ── Generar, sondear y descargar ──────────────────────────────────────

  /**
   * `soloPlano = false`: carpeta por empleador con los PDF + archivo plano. `true`: solo los
   * archivos planos (sin bajar PDF; util si las carpetas ya se cargaron).
   */
  generar(soloPlano = false): void {
    const filtros = this.filtros();
    const semana = this.semana();
    if (!filtros || !this.puedeGenerar() || semana === null) return;
    const carpetaBase = this.carpetaBase();
    const unirTemporales = this.unirTemporales();
    const opciones: ExportOpcionesSevenet = { semanaSevenet: semana, carpetaBase, soloPlano, unirTemporales };
    // Se recuerda al usarla: la proxima vez se sugiere la siguiente semana.
    guardarMemoriaSevenet({ semana, fecha: aIsoCorto(new Date()), carpetaBase, unirTemporales });

    this.sondeo?.unsubscribe();
    this.descargaAutomaticaHecha = false;
    this.errorJob.set('');
    this.job.set(null);
    this.generando.set(true);
    this.rangoGenerado.set({ desde: this.desde(), hasta: this.hasta(), eje: this.eje(), semana, soloPlano });

    this.srv
      .crearExport('ZIP_SEVENET', filtros, opciones)
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
    return r ? `sevenet_semana${r.semana}_${r.desde}_${r.hasta}.zip` : 'sevenet-incapacidades.zip';
  }

  /** Tamano legible del resultado ('' si el servidor no lo informa). */
  tamanoLegible(bytes: number | null | undefined): string {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
