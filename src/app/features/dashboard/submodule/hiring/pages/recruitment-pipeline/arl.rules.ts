/**
 * Afiliación a la ARL requerida para contratar (ms-hr V74, 2026-10-21).
 *
 * Lógica pura, sin Angular. El paso ARL de Selección va después de Exámenes de
 * ingreso: se carga el certificado (PDF tipo 30 de gestión documental) y se
 * reescriben sus datos (ARL, fecha de inicio de afiliación y tipo de cotizante).
 *
 * La regla, igual que la del examen médico:
 *  - Solo aplica a procesos creados desde la fecha de corte
 *    (`proceso.arl_bloqueo.aplica`, lo calcula el backend).
 *  - Sin certificado y sus datos, la pestaña Contratación se cierra.
 *  - Al pasar a `contratado`, ms-hr exige además que la fecha de inicio de
 *    afiliación sea la fecha de ingreso del contrato (409 `ARL_REQUERIDA`).
 *  - Un ADMIN puede saltarlo (queda en `arl_bloqueo.salto`).
 *  - El paso solo se abre con el examen médico resuelto (apto o saltado).
 */

export type TipoCotizante = 'DEPENDIENTE' | 'INDEPENDIENTE';

export const TIPO_DOCUMENTO_ARL = 30;
export const ARL_POR_DEFECTO = 'SURA';

/** Las ARL del país; SURA primero porque es la que se usa. */
export const ARLS: readonly string[] = [
  'SURA', 'POSITIVA', 'COLMENA', 'BOLÍVAR', 'AXA COLPATRIA', 'LA EQUIDAD', 'MAPFRE', 'ALFA',
];

export const TIPOS_COTIZANTE: readonly { valor: TipoCotizante; etiqueta: string }[] = [
  { valor: 'DEPENDIENTE', etiqueta: 'Dependiente' },
  { valor: 'INDEPENDIENTE', etiqueta: 'Independiente' },
];

export const FALTA_PDF = 'Cargar el certificado de afiliación a la ARL de este proceso.';
export const FALTA_NOMBRE = 'Registrar el nombre de la ARL.';
export const FALTA_FECHA = 'Registrar la fecha de inicio de afiliación a la ARL.';
export const FALTA_TIPO = 'Registrar el tipo de cotizante (dependiente o independiente).';

/** Fila de `tabla_contratacion_ArlProceso` tal como llega en el proceso. */
export interface AfiliacionArl {
  proceso_id?: number | null;
  arl_nombre?: string | null;
  fecha_inicio_afiliacion?: string | null;
  tipo_cotizante?: string | null;
  /** 1 a 5. */
  clase_riesgo?: number | null;
  /** Porcentaje de cotización (2.436 = 2,436 %). */
  porcentaje_cotizacion?: number | string | null;
  documento_id?: number | null;
  identidad_resultado?: string | null;
  identidad_justificacion?: string | null;
  registrado_por?: string | null;
  registrado_at?: string | null;
}

export interface SaltoArl {
  por?: string | null;
  motivo?: string | null;
  at?: string | null;
}

export interface EstadoArl {
  /** La regla aplica a este proceso (creado desde la fecha de corte). */
  readonly aplica: boolean;
  readonly afiliacion: AfiliacionArl | null;
  /** Lo que falta del paso, una cosa por línea. Vacío si no aplica. */
  readonly faltantes: string[];
  readonly salto: SaltoArl | null;
  /** La pestaña Contratación se cierra por la ARL. */
  readonly bloquea: boolean;
}

/** Lo que falta del paso ARL, con o sin la regla aplicada. */
export function faltantesArl(a: AfiliacionArl | null | undefined): string[] {
  const out: string[] = [];
  if (a?.documento_id == null) out.push(FALTA_PDF);
  if (!String(a?.arl_nombre ?? '').trim()) out.push(FALTA_NOMBRE);
  if (!String(a?.fecha_inicio_afiliacion ?? '').trim()) out.push(FALTA_FECHA);
  if (!String(a?.tipo_cotizante ?? '').trim()) out.push(FALTA_TIPO);
  return out;
}

/** Evalúa la ARL de un proceso tal como llega en `by-document?full=1`. */
export function evaluarArl(proc: any, local?: AfiliacionArl | null): EstadoArl {
  const aplica = proc?.arl_bloqueo?.aplica === true;
  const salto: SaltoArl | null = proc?.arl_bloqueo?.salto ?? null;
  const afiliacion: AfiliacionArl | null = local !== undefined ? local : (proc?.arl ?? null);
  const faltantes = aplica ? faltantesArl(afiliacion) : [];
  return { aplica, afiliacion, faltantes, salto, bloquea: aplica && !salto && faltantes.length > 0 };
}

/** Texto para tooltips: una cosa por línea. */
export function textoBloqueoArl(e: EstadoArl): string {
  if (!e.bloquea) return '';
  return ['Contratación bloqueada por la ARL:', ...e.faltantes.map((f) => `• ${f}`)].join('\n');
}

/** El 409 del backend al contratar sin ARL o con la fecha de ingreso distinta. */
export function esBloqueoArl(err: any): boolean {
  return err?.status === 409 && err?.error?.codigo === 'ARL_REQUERIDA';
}

/** 'AAAA-MM-DD' de cualquier fecha ISO, Date o 'DD/MM/AAAA'. null si no se entiende. */
export function isoDia(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const dos = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${dos(v.getMonth() + 1)}-${dos(v.getDate())}`;
  }
  // Moment u otro objeto con format().
  if (typeof v === 'object' && typeof (v as any).format === 'function') {
    return isoDia(String((v as any).format('YYYY-MM-DD')));
  }
  const s = String(v).trim();
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : null;
}

/** 'DD/MM/AAAA' para mostrar. */
export function fechaCorta(iso: string | null | undefined): string {
  const d = isoDia(iso);
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
}

/** true/false si las dos fechas existen; null si falta alguna. */
export function fechasCoinciden(inicioArl: unknown, ingreso: unknown): boolean | null {
  const a = isoDia(inicioArl);
  const b = isoDia(ingreso);
  if (!a || !b) return null;
  return a === b;
}

// ───────── Lectura del certificado ─────────
//
// Los certificados de la ARL vienen con capa de texto (SURA: "HACE CONSTAR …
// Número identificación | Nombre | Fecha inicio afiliación | … | Tipo Cotizante").
// De ahí se proponen los campos; quien carga los revisa y los puede reescribir.

export interface DatosCertificado {
  arl: string | null;
  fechaInicio: string | null;
  tipoCotizante: TipoCotizante | null;
  claseRiesgo: number | null;
  porcentajeCotizacion: number | null;
  /** La cédula del trabajador aparece en el texto. */
  cedulaEncontrada: boolean;
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Propone ARL, fecha de inicio y tipo de cotizante a partir del texto del PDF. */
export function leerCertificadoArl(texto: string, cedula: string | null | undefined): DatosCertificado {
  const t = sinTildes(String(texto ?? '')).toUpperCase().replace(/\s+/g, ' ');

  let arl: string | null = null;
  if (/\bSURA\b|SURAMERICANA/.test(t)) arl = 'SURA';
  else if (/\bPOSITIVA\b/.test(t)) arl = 'POSITIVA';
  else if (/\bCOLMENA\b/.test(t)) arl = 'COLMENA';
  else if (/\bBOLIVAR\b/.test(t)) arl = 'BOLÍVAR';
  else if (/COLPATRIA/.test(t)) arl = 'AXA COLPATRIA';
  else if (/\bEQUIDAD\b/.test(t)) arl = 'LA EQUIDAD';
  else if (/\bMAPFRE\b/.test(t)) arl = 'MAPFRE';
  else if (/\bALFA\b/.test(t)) arl = 'ALFA';

  // El certificado puede listar a varias personas: se toma la fila de ESTA cédula.
  const ced = String(cedula ?? '').replace(/\D/g, '');
  const plano = t.replace(/[.,]/g, '');
  const pos = ced.length >= 5 ? plano.indexOf(ced) : -1;
  const fila = pos >= 0 ? plano.slice(pos, pos + 220) : plano;

  const fecha = /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/.exec(fila);
  let tipo: TipoCotizante | null = null;
  if (/\bINDEPENDIENTE\b/.test(fila)) tipo = 'INDEPENDIENTE';
  else if (/\bDEPENDIENTE\b/.test(fila)) tipo = 'DEPENDIENTE';

  // Van en el párrafo "HACE CONSTAR" ("Clase de riesgo 3, Porcentaje de
  // cotización 2.436%"), no en la fila de la persona. Se lee del texto con
  // los puntos intactos: `plano` les quita la coma y el punto decimal.
  const clase = /CLASE\s+(?:DE\s+)?RIESGO\s*:?\s*([1-5])\b/.exec(t);
  const pct = /PORCENTAJE\s+(?:DE\s+)?COTIZACION\s*:?\s*(\d{1,2}(?:[.,]\d{1,4})?)\s*%?/.exec(t);

  return {
    arl,
    fechaInicio: fecha ? isoDia(fecha[1]) : null,
    tipoCotizante: tipo,
    claseRiesgo: clase ? Number(clase[1]) : null,
    porcentajeCotizacion: pct ? Number(pct[1].replace(',', '.')) : null,
    cedulaEncontrada: pos >= 0,
  };
}
