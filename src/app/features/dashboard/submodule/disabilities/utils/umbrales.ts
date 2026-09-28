/**
 * Umbrales 180 / 540 ubicados en el tiempo (revision funcional 2026-09-28).
 *
 * El backend (`GET /informes/umbrales`) entrega cada cadena continua con su situacion a hoy y
 * las fechas de los dias 181 y 541; aqui se proyecta a una fecha futura para el panorama
 * ("¿como se ve dentro de 15 dias, de un mes…?"). Espejo de `CadenaUmbral.acumuladoAl` de
 * ms-hr: si se toca una regla alla, tocarla aqui.
 *
 *  - Una cadena VIGENTE sigue sumando dias hasta el fin registrado; con `siContinua` suma
 *    tambien despues (la persona sigue incapacitada sin interrupcion: prorrogas).
 *  - Una cadena que ya termino (reciente o historica) no suma mas: su cuenta se cerro.
 *  - Las de fechas por revisar no se proyectan ni cuentan en el panorama.
 */
import { CadenaUmbral, PagadorUmbral, SituacionCadena } from '../models/incapacidad-gestion.model';

export const UMBRAL_FONDO = 180;
export const UMBRAL_EPS = 540;

const MS_DIA = 86_400_000;

/** 'yyyy-MM-dd' como fecha LOCAL (un `new Date('2026-09-28')` se leeria en UTC y restaria un dia). */
export function aFecha(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d.getTime()) ? null : d;
}

export function sumarDias(fecha: Date, dias: number): Date {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + dias);
}

/** Dias calendario de `a` a `b` (b - a), inmune a cambios de hora. */
export function diasEntre(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / MS_DIA);
}

/** Quien paga segun el dia de la cadena: 1-180 EPS, 181-540 fondo, 541+ EPS de nuevo. */
export function pagadorSegunDia(dia: number): PagadorUmbral {
  if (dia > UMBRAL_EPS) return 'EPS_POST_540';
  if (dia > UMBRAL_FONDO) return 'FONDO_PENSIONES';
  return 'EPS';
}

export const ETIQUETA_PAGADOR: Readonly<Record<PagadorUmbral, string>> = {
  EPS: 'EPS',
  FONDO_PENSIONES: 'Fondo de pensiones',
  EPS_POST_540: 'EPS (despues de 540)',
};

/** La cadena esta "activa": incapacitado hoy o termino hace poco. */
export function esActiva(c: CadenaUmbral): boolean {
  return c.situacion === 'VIGENTE' || c.situacion === 'RECIENTE';
}

/** Dias de la cadena a una fecha (espejo de CadenaUmbral.acumuladoAl de ms-hr). */
export function acumuladoAl(c: CadenaUmbral, fecha: Date, siContinua: boolean): number {
  if (c.situacion !== 'VIGENTE') return c.diasAcumuladosFin;
  const inicio = aFecha(c.inicioCadena);
  const fin = aFecha(c.fechaFinUltima);
  if (!inicio || !fin) return c.diasAcumuladosFin;
  const tope = siContinua || fecha < fin ? fecha : fin;
  if (tope < inicio) return 0;
  return diasEntre(inicio, tope) + 1;
}

/** Lo que ocurre con UNA cadena entre hoy y la fecha de analisis. */
export interface EstadoAlCorte {
  diasHoy: number;
  diasAlCorte: number;
  pagadorAlCorte: PagadorUmbral;
  /** Cruza el dia 181 despues de hoy y hasta la fecha. */
  pasaAlFondo: boolean;
  /** Cruza el dia 541 despues de hoy y hasta la fecha. */
  vuelveEps: boolean;
}

export function estadoAlCorte(c: CadenaUmbral, hoy: Date, fecha: Date, siContinua: boolean): EstadoAlCorte {
  const diasHoy = acumuladoAl(c, hoy, siContinua);
  const diasAlCorte = acumuladoAl(c, fecha, siContinua);
  return {
    diasHoy,
    diasAlCorte,
    pagadorAlCorte: pagadorSegunDia(diasAlCorte),
    pasaAlFondo: diasHoy <= UMBRAL_FONDO && diasAlCorte > UMBRAL_FONDO,
    vuelveEps: diasHoy <= UMBRAL_EPS && diasAlCorte > UMBRAL_EPS,
  };
}

/** Una columna del panorama: como se reparten los casos activos a una fecha. */
export interface CorteHorizonte {
  /** 0 = hoy. */
  dias: number;
  fecha: Date;
  conEps: number;
  conFondo: number;
  post540: number;
  pasanAlFondo: number;
  vuelvenEps: number;
}

/** El panorama de los casos ACTIVOS hoy y a cada horizonte. */
export function panorama(
  cadenas: readonly CadenaUmbral[],
  hoy: Date,
  horizontes: readonly number[],
  siContinua: boolean,
): CorteHorizonte[] {
  const activas = cadenas.filter(esActiva);
  return [0, ...horizontes].map((dias) => {
    const fecha = sumarDias(hoy, dias);
    const corte: CorteHorizonte = { dias, fecha, conEps: 0, conFondo: 0, post540: 0, pasanAlFondo: 0, vuelvenEps: 0 };
    for (const c of activas) {
      const e = estadoAlCorte(c, hoy, fecha, siContinua);
      if (e.pagadorAlCorte === 'EPS') corte.conEps++;
      else if (e.pagadorAlCorte === 'FONDO_PENSIONES') corte.conFondo++;
      else corte.post540++;
      if (e.pasaAlFondo) corte.pasanAlFondo++;
      if (e.vuelveEps) corte.vuelvenEps++;
    }
    return corte;
  });
}

// ── Filtros de la tabla ─────────────────────────────────────────────────

/** Que casos se miran: los activos (por defecto) o una situacion puntual. */
export type AlcanceUmbrales = 'ACTIVOS' | SituacionCadena;

export function enAlcance(c: CadenaUmbral, alcance: AlcanceUmbrales): boolean {
  return alcance === 'ACTIVOS' ? esActiva(c) : c.situacion === alcance;
}

/** Filtro por lo que pasa hasta la fecha de analisis. */
export type FiltroCambio = 'TODOS' | 'PASAN_FONDO' | 'VUELVEN_EPS' | 'CON_EPS' | 'CON_FONDO' | 'POST_540';

export function cumpleCambio(e: EstadoAlCorte, filtro: FiltroCambio): boolean {
  switch (filtro) {
    case 'TODOS': return true;
    case 'PASAN_FONDO': return e.pasaAlFondo;
    case 'VUELVEN_EPS': return e.vuelveEps;
    case 'CON_EPS': return e.pagadorAlCorte === 'EPS';
    case 'CON_FONDO': return e.pagadorAlCorte === 'FONDO_PENSIONES';
    case 'POST_540': return e.pagadorAlCorte === 'EPS_POST_540';
  }
}

// ── Textos ──────────────────────────────────────────────────────────────

/** "hoy", "manana", "en 5 dias", "hace 12 dias". */
export function relativo(fecha: Date, hoy: Date): string {
  const d = diasEntre(hoy, fecha);
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  if (d === -1) return 'ayer';
  return d > 0 ? `en ${d} días` : `hace ${-d} días`;
}

export function fechaCorta(fecha: Date | null): string {
  if (!fecha) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(fecha.getDate())}/${p(fecha.getMonth() + 1)}/${fecha.getFullYear()}`;
}
