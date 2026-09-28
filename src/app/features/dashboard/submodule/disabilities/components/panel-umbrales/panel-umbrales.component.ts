import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ColumnaTabla, TABLA_ESTANDAR, TonoBadge } from '@/app/shared/components/tabla-estandar';
import {
  CadenaUmbral,
  InformeUmbrales,
  PagadorUmbral,
  SituacionCadena,
} from '../../models/incapacidad-gestion.model';
import { IncapacidadGestionService } from '../../services/incapacidad-gestion/incapacidad-gestion.service';
import {
  AlcanceUmbrales,
  CorteHorizonte,
  ETIQUETA_PAGADOR,
  EstadoAlCorte,
  FiltroCambio,
  UMBRAL_EPS,
  UMBRAL_FONDO,
  aFecha,
  cumpleCambio,
  enAlcance,
  estadoAlCorte,
  fechaCorta,
  panorama,
  relativo,
  sumarDias,
} from '../../utils/umbrales';

/** Fila de la tabla: la cadena y lo que le pasa a la fecha de analisis. */
export interface FilaUmbral {
  c: CadenaUmbral;
  e: EstadoAlCorte;
}

interface DefinicionAlcance {
  id: AlcanceUmbrales;
  etiqueta: string;
  ayuda: string;
  icono: string;
}

/** Los alcances, en el orden en que se pintan (el primero es el de entrada). */
export const ALCANCES: readonly DefinicionAlcance[] = [
  { id: 'ACTIVOS', etiqueta: 'Casos activos', icono: 'monitor_heart',
    ayuda: 'Incapacitados hoy + los que terminaron hace 30 días o menos' },
  { id: 'VIGENTE', etiqueta: 'Incapacitados hoy', icono: 'personal_injury',
    ayuda: 'La incapacidad registrada termina hoy o después' },
  { id: 'RECIENTE', etiqueta: 'Terminaron hace poco', icono: 'update',
    ayuda: 'Hace 30 días o menos: puede llegar una prórroga que aún no se registró' },
  { id: 'HISTORICO', etiqueta: 'Históricos', icono: 'history',
    ayuda: 'Terminaron hace más de 30 días: esa cuenta se cerró y ya no cambia' },
  { id: 'POR_REVISAR', etiqueta: 'Fechas por revisar', icono: 'report_problem',
    ayuda: 'Fechas imposibles (errores de digitación): no se cuentan hasta corregirlas' },
];

const TONO_SITUACION: Readonly<Record<SituacionCadena, TonoBadge>> = {
  VIGENTE: 'info',
  RECIENTE: 'neutro',
  HISTORICO: 'neutro',
  POR_REVISAR: 'danger',
};

const TONO_PAGADOR: Readonly<Record<PagadorUmbral, TonoBadge>> = {
  EPS: 'info',
  FONDO_PENSIONES: 'warn',
  EPS_POST_540: 'violet',
};

/**
 * Umbrales de 180 y 540 dias ubicados en el tiempo (revision funcional 2026-09-28).
 *
 * Responde tres preguntas que el informe anterior no dejaba ver:
 *  1. ¿Que casos son de HOY y cuales son historia? — selector de situacion arriba.
 *  2. ¿Como se ve dentro de 15 dias, un mes, dos, tres? — panorama por horizonte.
 *  3. ¿Quien cambia de pagador y cuando? — la tabla con el dia 181 y el 541 de cada cadena.
 *
 * Carga sola (`GET /informes/umbrales`) y es de solo lectura. Se usa en el dialogo de la
 * consulta y en las pestañas de Alertas e Informes, para que las tres digan lo mismo.
 */
@Component({
  selector: 'app-panel-umbrales',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatSlideToggleModule, MatTooltipModule, ...TABLA_ESTANDAR],
  templateUrl: './panel-umbrales.component.html',
  styleUrl: './panel-umbrales.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelUmbralesComponent {
  private readonly srv = inject(IncapacidadGestionService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly alcances = ALCANCES;
  readonly umbralFondo = UMBRAL_FONDO;
  readonly umbralEps = UMBRAL_EPS;

  // ── Estado ────────────────────────────────────────────────────────────

  readonly informe = signal<InformeUmbrales | null>(null);
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly alcance = signal<AlcanceUmbrales>('ACTIVOS');
  /** Dias hacia adelante de la fecha de analisis (0 = hoy). */
  readonly horizonte = signal(0);
  /** Proyectar suponiendo que siguen incapacitados sin interrupcion (prorrogas). */
  readonly siContinua = signal(true);
  readonly filtroCambio = signal<FiltroCambio>('TODOS');

  // ── Derivados ─────────────────────────────────────────────────────────

  readonly hoy = computed(() => aFecha(this.informe()?.fechaCorte) ?? new Date());
  readonly fechaAnalisis = computed(() => sumarDias(this.hoy(), this.horizonte()));
  readonly textoAnalisis = computed(() =>
    this.horizonte() === 0 ? 'hoy' : `el ${fechaCorta(this.fechaAnalisis())}`,
  );
  readonly corte = computed(() => fechaCorta(this.hoy()));

  /** Las vistas que miran casos vivos tienen panorama y proyeccion; las otras no. */
  readonly vistaActiva = computed(() => ['ACTIVOS', 'VIGENTE', 'RECIENTE'].includes(this.alcance()));

  readonly cadenas = computed(() => this.informe()?.cadenas ?? []);

  readonly conteoAlcance = computed<Record<AlcanceUmbrales, number>>(() => {
    const c = this.informe()?.conteos ?? {};
    const vig = c.VIGENTE ?? 0;
    const rec = c.RECIENTE ?? 0;
    return {
      ACTIVOS: vig + rec,
      VIGENTE: vig,
      RECIENTE: rec,
      HISTORICO: c.HISTORICO ?? 0,
      POR_REVISAR: c.POR_REVISAR ?? 0,
    };
  });

  readonly cortes = computed<CorteHorizonte[]>(() =>
    panorama(
      this.cadenas().filter((c) => enAlcance(c, this.alcance())),
      this.hoy(),
      this.informe()?.horizontes ?? [15, 30, 60, 90],
      this.siContinua(),
    ),
  );

  /** Filas del alcance con su estado a la fecha de analisis (antes del filtro de cambio). */
  private readonly filasAlcance = computed<FilaUmbral[]>(() => {
    const hoy = this.hoy();
    const fecha = this.fechaAnalisis();
    const siContinua = this.siContinua();
    return this.cadenas()
      .filter((c) => enAlcance(c, this.alcance()))
      .map((c) => ({ c, e: estadoAlCorte(c, hoy, fecha, siContinua) }));
  });

  readonly filas = computed<FilaUmbral[]>(() => {
    if (!this.vistaActiva()) return this.filasAlcance();
    const filtro = this.filtroCambio();
    return this.filasAlcance().filter((f) => cumpleCambio(f.e, filtro));
  });

  /** Opciones del filtro de cambio con su conteo, redactadas con la fecha de analisis. */
  readonly opcionesCambio = computed(() => {
    const filas = this.filasAlcance();
    const cuando = this.textoAnalisis();
    const contar = (f: FiltroCambio) => filas.filter((x) => cumpleCambio(x.e, f)).length;
    const opciones: { id: FiltroCambio; texto: string; n: number }[] = [
      { id: 'TODOS', texto: 'Todos', n: filas.length },
    ];
    if (this.horizonte() > 0) {
      opciones.push(
        { id: 'PASAN_FONDO', texto: `Pasan al fondo de aquí al ${fechaCorta(this.fechaAnalisis())}`, n: contar('PASAN_FONDO') },
        { id: 'VUELVEN_EPS', texto: `Vuelven a la EPS (día 541) de aquí al ${fechaCorta(this.fechaAnalisis())}`, n: contar('VUELVEN_EPS') },
      );
    }
    opciones.push(
      { id: 'CON_EPS', texto: `Con la EPS ${cuando}`, n: contar('CON_EPS') },
      { id: 'CON_FONDO', texto: `Con el fondo de pensiones ${cuando}`, n: contar('CON_FONDO') },
      { id: 'POST_540', texto: `De vuelta en la EPS (+540) ${cuando}`, n: contar('POST_540') },
    );
    return opciones;
  });

  // ── Tabla ─────────────────────────────────────────────────────────────

  readonly columnas = computed<ColumnaTabla<FilaUmbral>[]>(() => {
    const revisar = this.alcance() === 'POR_REVISAR';
    const cuando = this.horizonte() === 0 ? 'hoy' : `al ${fechaCorta(this.fechaAnalisis())}`;
    const hoy = this.hoy();

    const cols: ColumnaTabla<FilaUmbral>[] = [
      { id: 'persona', header: 'Persona', tarjeta: 'titulo', minAncho: '190px',
        valor: (f) => f.c.nombreCompleto, copiaTexto: (f) => `${f.c.nombreCompleto} (${f.c.cedula})` },
      { id: 'cedula', header: 'Cédula', prioridad: 3, tarjeta: 'subtitulo', valor: (f) => f.c.cedula },
      { id: 'empresa', header: 'Empresa / finca', prioridad: 2, tarjeta: 'cuerpo', minAncho: '150px',
        valor: (f) => f.c.centroCosto || f.c.empresa || '',
        formato: (f) => f.c.centroCosto || f.c.empresa || '—' },
      { id: 'grupo', header: 'Temporal', prioridad: 3, tarjeta: 'meta',
        valor: (f) => (f.c.entidadGrupo === 'ALIANZA' ? 'Alianza' : f.c.entidadGrupo === 'APOYO' ? 'Apoyo' : ''),
        formato: (f) => (f.c.entidadGrupo === 'ALIANZA' ? 'Alianza' : f.c.entidadGrupo === 'APOYO' ? 'Apoyo' : '—') },
      { id: 'eps', header: 'EPS', prioridad: 3, tarjeta: 'meta', valor: (f) => f.c.eps ?? '', formato: (f) => f.c.eps || '—' },
      { id: 'afp', header: 'Fondo (AFP)', prioridad: 3, tarjeta: 'meta', valor: (f) => f.c.afp ?? '', formato: (f) => f.c.afp || '—' },
      { id: 'diagnostico', header: 'Diagnóstico', prioridad: 2, tarjeta: 'cuerpo', minAncho: '150px',
        valor: (f) => f.c.codigoDiagnostico ?? '',
        copiaTexto: (f) => [f.c.codigoDiagnostico, f.c.descripcionDiagnostico].filter(Boolean).join(' - ') },
      { id: 'situacion', header: 'Situación', tarjeta: 'badge', minAncho: '140px',
        valor: (f) => f.c.situacionEtiqueta,
        badge: (f) => ({ texto: f.c.situacionEtiqueta, tono: TONO_SITUACION[f.c.situacion] }),
        copiaTexto: (f) => `${f.c.situacionEtiqueta} · ${this.textoFin(f.c)}` },
    ];

    if (revisar) {
      cols.push(
        { id: 'motivo', header: 'Qué revisar', tarjeta: 'cuerpo', minAncho: '280px',
          valor: (f) => f.c.motivoRevision ?? '' },
        { id: 'fechas', header: 'Fechas registradas', prioridad: 2, tarjeta: 'meta',
          valor: (f) => `${f.c.fechaInicioUltima ?? ''} → ${f.c.fechaFinUltima ?? ''}`,
          formato: (f) => `${fechaCorta(aFecha(f.c.fechaInicioUltima))} → ${fechaCorta(aFecha(f.c.fechaFinUltima))}` },
      );
      return cols;
    }

    cols.push(
      { id: 'dias', header: `Días ${cuando}`, align: 'right', tarjeta: 'meta',
        valor: (f) => f.e.diasAlCorte },
      { id: 'dia181', header: 'Pasa al fondo (día 181)', minAncho: '150px', tarjeta: 'meta',
        valor: (f) => aFecha(f.c.fechaPasaFondo),
        copiaTexto: (f) => `${fechaCorta(aFecha(f.c.fechaPasaFondo))} (${this.textoHito(f.c, f.c.fechaPasaFondo, f.c.fondoCertificado, UMBRAL_FONDO, hoy)})` },
      { id: 'dia541', header: 'Vuelve a la EPS (día 541)', minAncho: '150px', prioridad: 2, tarjeta: 'meta',
        valor: (f) => aFecha(f.c.fechaVuelveEps),
        copiaTexto: (f) => `${fechaCorta(aFecha(f.c.fechaVuelveEps))} (${this.textoHito(f.c, f.c.fechaVuelveEps, f.c.epsCertificado, UMBRAL_EPS, hoy)})` },
      { id: 'pagador', header: `Paga ${cuando}`, tarjeta: 'badge',
        valor: (f) => ETIQUETA_PAGADOR[f.e.pagadorAlCorte],
        badge: (f) => ({ texto: ETIQUETA_PAGADOR[f.e.pagadorAlCorte], tono: TONO_PAGADOR[f.e.pagadorAlCorte] }) },
    );
    return cols;
  });

  readonly idFila = (f: FilaUmbral) => f.c.incapacidadId;
  readonly claseFila = (f: FilaUmbral) =>
    f.e.pasaAlFondo || f.e.vuelveEps ? 'pu-fila-cambia' : '';

  constructor() {
    this.cargar();
  }

  // ── Acciones ──────────────────────────────────────────────────────────

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.srv.umbrales().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (inf) => {
        this.informe.set(inf);
        this.cargando.set(false);
      },
      error: () => {
        this.cargando.set(false);
        this.error.set('No se pudo cargar el informe de umbrales. Inténtalo de nuevo.');
      },
    });
  }

  elegirAlcance(id: AlcanceUmbrales): void {
    this.alcance.set(id);
    this.filtroCambio.set('TODOS');
  }

  elegirHorizonte(dias: number, filtro: FiltroCambio = 'TODOS'): void {
    this.horizonte.set(dias);
    this.filtroCambio.set(filtro);
  }

  elegirFiltro(id: FiltroCambio): void {
    this.filtroCambio.set(id);
  }

  alternarProrrogas(valor: boolean): void {
    this.siContinua.set(valor);
  }

  abrirIncapacidad(f: FilaUmbral): void {
    void this.router.navigate(['/dashboard/disabilities/registro', f.c.incapacidadId]);
  }

  // ── Presentacion ──────────────────────────────────────────────────────

  tonoSituacion(s: SituacionCadena): TonoBadge {
    return TONO_SITUACION[s];
  }

  tituloCorte(h: CorteHorizonte): string {
    return h.dias === 0 ? 'Hoy' : `En ${h.dias} días`;
  }

  fecha(d: Date | null): string {
    return fechaCorta(d);
  }

  fechaIso(v: string | null): string {
    return fechaCorta(aFecha(v));
  }

  /** "hasta el 08/10 (en 10 días)" o "terminó el 20/09". */
  textoFin(c: CadenaUmbral): string {
    const fin = aFecha(c.fechaFinUltima);
    if (!fin) return '';
    if (c.situacion === 'VIGENTE') return `hasta el ${fechaCorta(fin)}`;
    return `terminó el ${fechaCorta(fin)}`;
  }

  /** Porcentaje del ancho de la barra de dias (escala 0-720: 180 al 25 %, 540 al 75 %). */
  anchoBarra(dias: number): number {
    return Math.min(100, Math.max(0, (dias / 720) * 100));
  }

  /**
   * Que tan seguro es un hito (dia 181 o 541) para mostrarlo junto a la fecha:
   * ya ocurrio, esta dentro de lo registrado, o depende de que siga incapacitado.
   */
  textoHito(c: CadenaUmbral, fechaIso: string | null, certificado: boolean, umbral: number, hoy: Date): string {
    const fecha = aFecha(fechaIso);
    if (!fecha) return '—';
    if (c.diasAcumuladosFin > umbral && fecha <= hoy) return `ya ocurrió (${relativo(fecha, hoy)})`;
    if (certificado) return `registrado · ${relativo(fecha, hoy)}`;
    if (c.situacion === 'VIGENTE') return `si sigue incapacitado · ${relativo(fecha, hoy)}`;
    if (c.situacion === 'RECIENTE') return 'solo si llega una prórroga';
    return 'no llegó: la cadena se cortó';
  }

  claseHito(c: CadenaUmbral, fechaIso: string | null, certificado: boolean, umbral: number): string {
    const fecha = aFecha(fechaIso);
    if (!fecha) return '';
    if (c.diasAcumuladosFin > umbral && fecha <= this.hoy()) return 'pu-hito-ocurrio';
    if (certificado) return 'pu-hito-registrado';
    if (c.situacion === 'VIGENTE') return 'pu-hito-proyectado';
    return 'pu-hito-no';
  }
}
