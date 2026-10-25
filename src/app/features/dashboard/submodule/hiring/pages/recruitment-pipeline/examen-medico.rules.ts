/**
 * Examen médico requerido para contratar (pedido #10, ms-hr V63).
 *
 * Lógica pura, sin Angular: la usa el pipeline para decidir si la pestaña
 * Contratación se abre y para decir QUÉ falta. El backend aplica la misma regla
 * al pasar a `contratado` (409 `EXAMEN_MEDICO_REQUERIDO`), así que esto es la
 * ayuda en pantalla, no la seguridad.
 *
 * La regla:
 *  - Solo aplica a procesos creados desde la fecha de corte
 *    (`proceso.examen_bloqueo.aplica`, lo calcula el backend).
 *  - Exige el PDF del examen de ESTE proceso: el enlazado en
 *    `examen_medico.documento_id` o uno tipo 32 subido desde que se abrió el
 *    proceso (uno anterior es de otra contratación).
 *  - Exige el concepto APTO o APTO CON RESTRICCIONES.
 *  - Un ADMIN puede saltarlo (queda en `examen_bloqueo.salto`).
 */

export type ConceptoExamen = 'APTO' | 'APTO_CON_RESTRICCIONES' | 'NO_APTO' | 'APLAZADO';

export interface OpcionConcepto {
  readonly valor: ConceptoExamen;
  readonly etiqueta: string;
  readonly icono: string;
  readonly ayuda: string;
  readonly permiteContratar: boolean;
}

/** Los cuatro conceptos, en el orden en que se muestran. Sin valor por defecto. */
export const CONCEPTOS_EXAMEN: readonly OpcionConcepto[] = [
  { valor: 'APTO', etiqueta: 'Apto', icono: 'verified', permiteContratar: true,
    ayuda: 'Puede contratarse.' },
  { valor: 'APTO_CON_RESTRICCIONES', etiqueta: 'Apto con restricciones', icono: 'rule', permiteContratar: true,
    ayuda: 'Puede contratarse; hay que escribir las restricciones.' },
  { valor: 'NO_APTO', etiqueta: 'No apto', icono: 'block', permiteContratar: false,
    ayuda: 'Rechaza el proceso (901 examen).' },
  { valor: 'APLAZADO', etiqueta: 'Aplazado', icono: 'schedule', permiteContratar: false,
    ayuda: 'El proceso queda en espera: ni se contrata ni se rechaza.' },
];

export const FALTA_PDF = 'Cargar el PDF del examen médico de este proceso.';
export const FALTA_CONCEPTO = 'Registrar el concepto médico (APTO o APTO CON RESTRICCIONES).';

/** Lee un concepto tolerando grafías viejas ("NO APTO", "apto con restricciones"). */
export function normalizarConcepto(raw: unknown): ConceptoExamen | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toUpperCase().replace(/[\s-]+/g, '_');
  switch (s) {
    case 'APTO': return 'APTO';
    case 'APTO_CON_RESTRICCIONES':
    case 'APTO_CON_RESTRICCION': return 'APTO_CON_RESTRICCIONES';
    case 'NO_APTO':
    case 'NOAPTO': return 'NO_APTO';
    case 'APLAZADO':
    case 'APLAZADA': return 'APLAZADO';
    default: return null;
  }
}

export function etiquetaConcepto(c: ConceptoExamen | null | undefined): string {
  return CONCEPTOS_EXAMEN.find((o) => o.valor === c)?.etiqueta ?? 'Sin concepto';
}

export function conceptoPermiteContratar(c: ConceptoExamen | null | undefined): boolean {
  return c === 'APTO' || c === 'APTO_CON_RESTRICCIONES';
}

/** Documento del expediente tal como lo lista gestión documental. */
export interface DocExamen {
  uploaded_at?: string | null;
  created_at?: string | null;
}

export interface SaltoExamen {
  por?: string | null;
  motivo?: string | null;
  at?: string | null;
}

export interface EstadoExamen {
  /** La regla aplica a este proceso (creado desde la fecha de corte). */
  readonly aplica: boolean;
  readonly concepto: ConceptoExamen | null;
  readonly pdfCargado: boolean;
  /** Lo que falta, una cosa por línea. Vacío si no aplica. */
  readonly faltantes: string[];
  /** Un ADMIN saltó el bloqueo de este proceso. */
  readonly salto: SaltoExamen | null;
  /** La pestaña Contratación se cierra. */
  readonly bloquea: boolean;
}

function instante(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

/**
 * Evalúa el examen de un proceso.
 *
 * @param proc      el proceso tal como llega en `by-document?full=1`
 * @param docs      soportes tipo 32 de la persona (`examenDocs()` del pipeline)
 * @param conceptoLocal lo que está elegido en pantalla (se guarda solo al cambiar;
 *                  mientras llega el guardado, manda lo de la pantalla)
 */
export function evaluarExamen(
  proc: any,
  docs: readonly DocExamen[] | null | undefined,
  conceptoLocal?: ConceptoExamen | null,
): EstadoExamen {
  const aplica = proc?.examen_bloqueo?.aplica === true;
  const salto: SaltoExamen | null = proc?.examen_bloqueo?.salto ?? null;
  const em = proc?.examen_medico ?? null;
  const concepto = conceptoLocal !== undefined ? conceptoLocal : normalizarConcepto(em?.concepto);

  const abierto = instante(proc?.created_at);
  const pdfCargado = em?.documento_id != null
    || (docs ?? []).some((d) => {
      const t = instante(d?.uploaded_at) ?? instante(d?.created_at);
      // Sin fecha de apertura (payload viejo) vale cualquier soporte.
      return t !== null && (abierto === null || t >= abierto);
    });

  const faltantes: string[] = [];
  if (aplica) {
    if (!pdfCargado) faltantes.push(FALTA_PDF);
    if (!concepto) faltantes.push(FALTA_CONCEPTO);
    else if (!conceptoPermiteContratar(concepto)) {
      faltantes.push(`El concepto médico es ${etiquetaConcepto(concepto).toUpperCase()}: no permite contratar.`);
    }
  }
  return {
    aplica,
    concepto,
    pdfCargado,
    faltantes,
    salto,
    bloquea: aplica && !salto && faltantes.length > 0,
  };
}

// ───────── Orden estricto de Salud ocupacional ─────────
//
// 1) IPS principal y Lista de exámenes (obligatorios).
// 2) Cargar el PDF del examen: acción PROPIA, independiente del concepto.
// 3) Solo con el PDF de ESTE proceso cargado se decide el concepto.
// Elegir un concepto nunca sube un documento y subir uno nunca fija concepto.

export const CAMPO_IPS = 'IPS principal';
export const CAMPO_LISTA_EXAMENES = 'Lista de exámenes';
export const PRIMERO_CARGA_EXAMEN = 'Primero carga el examen';

/** Campos obligatorios que faltan para poder cargar el PDF del examen. */
export function faltantesParaCargarExamen(ips: unknown, examenes: unknown): string[] {
  const faltan: string[] = [];
  if (!String(ips ?? '').trim()) faltan.push(CAMPO_IPS);
  const lista = Array.isArray(examenes) ? examenes.filter((e) => String(e ?? '').trim()) : [];
  if (!lista.length) faltan.push(CAMPO_LISTA_EXAMENES);
  return faltan;
}

/**
 * Exámenes de la lista sin resultado (APTO / NO APTO) marcado. El resultado de
 * cada examen se marca ANTES de cargar el PDF y es obligatorio para cargarlo.
 */
export function examenesSinResultado(
  examenes: readonly (string | null | undefined)[] | null | undefined,
  resultados: readonly ({ aptoStatus?: unknown } | null | undefined)[] | null | undefined,
): string[] {
  const res = resultados ?? [];
  return (examenes ?? []).flatMap((e, i) => {
    const v = String(res[i]?.aptoStatus ?? '').trim().toUpperCase();
    return v === 'APTO' || v === 'NO APTO' ? [] : [String(e ?? `Examen ${i + 1}`).trim()];
  });
}

/** Resultado médico de un examen de la lista, tal como queda en el soporte. */
export type ResultadoExamen = 'APTO' | 'NO APTO';
export interface ResultadoDeExamen {
  readonly examen: string;
  readonly resultado: ResultadoExamen;
}

/** Máximo del título en gestión documental (VARCHAR 255) con holgura. */
const MAX_TITULO = 250;
/** `[AUDIOMETRIA=APTO; OPTOMETRIA=NO APTO]` antes de la extensión. */
const RE_RESULTADOS_TITULO = /\s*\[([^\]]*)\]\s*(?=\.[a-z0-9]{2,5}$|$)/i;

function limpiarParaTitulo(examen: string): string {
  return String(examen ?? '').replace(/[[\]=;]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizarResultado(raw: unknown): ResultadoExamen | null {
  const v = String(raw ?? '').trim().toUpperCase().replace(/[_\s]+/g, ' ');
  return v === 'APTO' ? 'APTO' : v === 'NO APTO' || v === 'NOAPTO' ? 'NO APTO' : null;
}

/**
 * Título del soporte con el resultado de cada examen:
 * `EXAMENES_MEDICOS_1_20261015 [AUDIOMETRIA=APTO; OPTOMETRIA=NO APTO].pdf`.
 * Así el documento dice por sí mismo qué examen fue apto y cuál no. Si no cabe
 * en el título se dejan fuera los últimos (nunca uno a medias).
 */
export function tituloConResultados(base: string, resultados: readonly ResultadoDeExamen[]): string {
  const m = /(\.[a-z0-9]{2,5})$/i.exec(base);
  const ext = m ? m[1] : '';
  const raiz = m ? base.slice(0, -ext.length) : base;
  const partes: string[] = [];
  for (const r of resultados) {
    const parte = `${limpiarParaTitulo(r.examen)}=${r.resultado}`;
    const prueba = `${raiz} [${[...partes, parte].join('; ')}]${ext}`;
    if (prueba.length > MAX_TITULO) break;
    partes.push(parte);
  }
  return partes.length ? `${raiz} [${partes.join('; ')}]${ext}` : base;
}

/** Lee del título de un soporte el resultado de cada examen ([] si no lo trae). */
export function resultadosDesdeTitulo(titulo: string | null | undefined): ResultadoDeExamen[] {
  const m = RE_RESULTADOS_TITULO.exec(String(titulo ?? ''));
  if (!m) return [];
  return m[1].split(';').flatMap((parte) => {
    const i = parte.lastIndexOf('=');
    if (i <= 0) return [];
    const examen = parte.slice(0, i).trim();
    const resultado = normalizarResultado(parte.slice(i + 1));
    return examen && resultado ? [{ examen, resultado }] : [];
  });
}

/** El título sin la lista de resultados (para mostrarlo como nombre). */
export function tituloSinResultados(titulo: string | null | undefined): string {
  return String(titulo ?? '').replace(RE_RESULTADOS_TITULO, '');
}

/** Empareja la lista de exámenes con sus resultados marcados (solo los marcados). */
export function resultadosMarcados(
  examenes: readonly (string | null | undefined)[] | null | undefined,
  resultados: readonly ({ aptoStatus?: unknown } | null | undefined)[] | null | undefined,
): ResultadoDeExamen[] {
  const res = resultados ?? [];
  return (examenes ?? []).flatMap((e, i) => {
    const r = normalizarResultado(res[i]?.aptoStatus);
    const examen = String(e ?? '').trim();
    return examen && r ? [{ examen, resultado: r }] : [];
  });
}

/** "Para cargar el examen falta: IPS principal y Lista de exámenes." ('' si no falta nada). */
export function textoFaltantesCarga(faltan: readonly string[]): string {
  if (!faltan.length) return '';
  return `Para cargar el examen falta: ${unirConY(faltan)}.`;
}

function unirConY(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
}

/** El concepto (Apto / Apto con restricciones / No apto / Aplazado) se puede elegir. */
export function conceptoHabilitado(faltanCarga: readonly string[], pdfCargado: boolean): boolean {
  return faltanCarga.length === 0 && pdfCargado;
}

/** Por qué el concepto todavía no se puede elegir (null si ya se puede). */
export function motivoConceptoBloqueado(faltanCarga: readonly string[], pdfCargado: boolean): string | null {
  if (faltanCarga.length) return `${PRIMERO_CARGA_EXAMEN}: completa ${unirConY(faltanCarga)}.`;
  if (!pdfCargado) return `${PRIMERO_CARGA_EXAMEN}: adjunta el PDF y pulsa «Cargar examen».`;
  return null;
}

/** Texto para tooltips y avisos: una cosa por línea. */
export function textoBloqueoExamen(e: EstadoExamen): string {
  if (!e.bloquea) return '';
  return ['Contratación bloqueada por el examen médico:', ...e.faltantes.map((f) => `• ${f}`)].join('\n');
}

/** El 409 del backend al contratar sin examen. */
export function esBloqueoExamen(err: any): boolean {
  return err?.status === 409 && err?.error?.codigo === 'EXAMEN_MEDICO_REQUERIDO';
}
