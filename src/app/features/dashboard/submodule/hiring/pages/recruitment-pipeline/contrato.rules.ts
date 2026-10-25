/**
 * Reglas del contrato "real" del pipeline.
 *
 * El backend crea la fila de Contrato ANTES de contratar: el flujo
 * `generar_codigo` (update-by-document / generar_codigo_contrato_para_cedula)
 * inserta una fila solo para reservar el `codigo_contrato`, y el modelo tiene
 * `contrato_activo = BooleanField(default=True)`. Resultado: candidatos que
 * apenas van en prueba técnica aparecían con "Contrato activo" y el pipeline
 * bloqueado, mientras el historial decía PRUEBA TÉCNICA (caso CC 1128324722).
 *
 * Regla: un contrato es REAL solo si el proceso llegó a `contratado === true`
 * o —solo en procesos de la época Django— el contrato ya tiene `fecha_ingreso`.
 * Una fila con solo el código reservado NO bloquea nada.
 *
 * Aparte del componente para poder probarse sin levantar la página entera.
 */

/**
 * Primer proceso de la plataforma nueva (la migración LEGACY_MIGRADO del
 * 2026-08-09 arranca en este id; los ids son crecientes).
 *
 * En Django nadie marcaba `contratado`: la fecha de ingreso ERA la marca, y hay
 * 55.033 contratos así (el último, el proceso 76847). Desde este id la marca es
 * solo `contratado`, que pone el botón "Contratar", porque la fecha de ingreso se
 * guarda ANTES de contratar: los documentos de contratación la necesitan y se
 * generan antes de pulsar "Contratar". Con la regla vieja, el primer guardado
 * automático de "Pago y Transporte" ya pintaba CONTRATADO y bloqueaba el pipeline.
 * Verificado 2026-09-22: con este corte ningún contrato existente cambia de estado
 * salvo el que dejó a medias el guardado automático.
 */
export const PRIMER_PROCESO_PLATAFORMA_NUEVA = 77599;

/** ¿En este proceso la fecha de ingreso vale como marca de contratado (época Django)? */
function fechaIngresoMarcaContratado(procesoId: unknown): boolean {
  // Sin id no se sabe de qué época es: se conserva la regla de siempre.
  if (procesoId == null || procesoId === '') return true;
  const id = Number(procesoId);
  return !Number.isFinite(id) || id < PRIMER_PROCESO_PLATAFORMA_NUEVA;
}

/**
 * ¿El proceso representa una contratación real (no solo un código reservado)?
 *
 * OJO con exigir la fila de Contrato: `contratado` se puede marcar sin que
 * exista `ContratoCandidato` (el pipeline lo pone al cerrar contratación y la
 * fila solo nace al reservar código / guardar pago y transporte). Esa gente
 * salía CONTRATADO en el historial laboral y a la vez SIN pill ni banner en el
 * header, o sea sin ninguna forma de darle de baja (caso CC 1006913166).
 */
export function esContratoReal(proceso: any): boolean {
  if (!proceso) return false;
  if (proceso?.contratado === true) return true;
  return fechaIngresoMarcaContratado(proceso?.id) && !!proceso?.contrato?.fecha_ingreso;
}

/**
 * ¿El candidato tiene un contrato REAL y ACTIVO?
 * Esto es lo único que bloquea el pipeline (banner + tabs deshabilitados).
 *
 * Solo un `contrato_activo === false` EXPLÍCITO retira: es lo que escribe la
 * baja. Sin fila de contrato (undefined) o con la columna en NULL —que es
 * nullable en el modelo, así que existen filas así— no hay nada que lo haya
 * retirado y el contrato sigue vigente.
 *
 * Es la MISMA regla que usa el historial laboral (`contrato_activo === false`
 * → RETIRADO). Cuando el header exigía `=== true`, header e historial decían
 * cosas distintas sobre la misma persona y no había cómo darle de baja.
 */
export function tieneContratoActivoReal(proceso: any): boolean {
  if (!esContratoReal(proceso)) return false;
  return proceso?.contrato?.contrato_activo !== false;
}

export type EstadoContratoPill = 'sin_fila' | 'activo' | 'retirado' | 'en_tramite';

/**
 * Estado del pill de contrato del header:
 * - 'activo'     → contrato real y vigente: "Contratado" (verde, clickable para dar de baja).
 * - 'retirado'   → contrato finalizado (baja con fecha_retiro): "Sin contrato" en rojo + fecha.
 * - 'en_tramite' → fila esqueleto: solo código reservado, aún no contratado (neutral).
 * - 'sin_fila'   → no hay fila de contrato (no se muestra pill).
 */
export function estadoContratoPill(proceso: any): EstadoContratoPill {
  // 'activo' se evalúa ANTES que la ausencia de fila: un proceso `contratado`
  // sin ContratoCandidato sigue siendo un contrato vigente que hay que poder
  // dar de baja. Sin esto el header no pintaba nada y el pipeline quedaba sin
  // salida (ver esContratoReal).
  if (tieneContratoActivoReal(proceso)) return 'activo';
  const contrato = proceso?.contrato;
  if (!contrato) return 'sin_fila';
  if (contrato.contrato_activo === false) {
    // "Sin contrato" en rojo es para un contrato que SE FINALIZÓ: la baja
    // siempre deja fecha_retiro (y apaga `contratado`, por eso no se exige
    // esContratoReal). Una fila inactiva sin fecha de retiro y que nunca fue
    // contrato real no es un retiro: no se pinta nada, el pipeline sigue igual.
    return contrato.fecha_retiro || esContratoReal(proceso) ? 'retirado' : 'sin_fila';
  }
  return 'en_tramite';
}

/**
 * Versión para las filas PLANAS del historial laboral (ProcesoMiniSerializer,
 * /procesos/by-document-min): ahí `contratado` y `contrato_fecha_ingreso`
 * vienen al nivel de la fila, no anidados.
 */
export function esContratoRealMini(row: any): boolean {
  return row?.contratado === true
    || (fechaIngresoMarcaContratado(row?.id) && !!row?.contrato_fecha_ingreso);
}

/**
 * Proceso vigente del candidato para leer su estado (etapas, resultados...).
 *
 * Una Entrevista puede existir SIN proceso y es un estado válido: el formulario
 * público abre una entrevista nueva cuando el proceso anterior quedó en estado
 * terminal (contratado / rechazado / no pasó), y el proceso solo se crea cuando
 * alguien atiende a la persona en el pipeline. Como las entrevistas llegan
 * ordenadas por fecha desc, `entrevistas[0]` puede ser esa entrevista recién
 * abierta y sin proceso — y todo lo que colgaba de ahí se veía vacío.
 *
 * Se mantiene la preferencia por la más reciente; solo si esa no tiene proceso
 * se cae a la siguiente que sí lo tenga.
 */
export function procesoVigente(candidato: any): any | null {
  return (
    procesoPorId(candidato, candidato?.proceso_vigente_id)
    ?? procesosDe(candidato)[0]
    ?? null
  );
}

/** Procesos de la persona, en el orden en que llegan las entrevistas. */
function procesosDe(candidato: any): any[] {
  const entrevistas: any[] = Array.isArray(candidato?.entrevistas) ? candidato.entrevistas : [];
  return entrevistas.map(e => e?.proceso).filter(Boolean);
}

/**
 * Proceso concreto por id, tal como lo resolvió el SERVIDOR.
 *
 * El backend manda `proceso_vigente_id` / `proceso_contrato_id` calculados con
 * `gestion_contratacion/proceso_estado.py`. Que el criterio viva en un solo
 * lado es justamente el arreglo: mientras cada pantalla lo deducía sola, con
 * dos turnos abiertos cada una apuntaba a un proceso distinto.
 *
 * Si el id no viene (backend sin desplegar) se devuelve null y el llamador cae
 * a su heurística de siempre, así que el orden de despliegue da igual.
 */
function procesoPorId(candidato: any, id: any): any | null {
  if (id == null) return null;
  return procesosDe(candidato).find(p => String(p?.id) === String(id)) ?? null;
}

/**
 * Proceso del que hay que leer el CONTRATO del candidato.
 *
 * El header miraba siempre `entrevistas[0].proceso`, y eso fallaba cuando la
 * entrevista más reciente es de un turno nuevo que todavía no tiene proceso (o
 * tiene uno de otra vacante): el contrato vive en una entrevista anterior. Se
 * veía CONTRATADO en el historial laboral y a la vez el header sin pill, así
 * que no había cómo dar de baja (caso CC 1097727446).
 *
 * Prioridad: contrato real y activo → contrato real (aunque esté retirado) →
 * fila de contrato (código reservado) → la primera entrevista, como antes.
 */
export function procesoDelContrato(candidato: any): any | null {
  const delServidor = procesoPorId(candidato, candidato?.proceso_contrato_id);
  if (delServidor) return delServidor;

  const procesos = procesosDe(candidato);
  if (!procesos.length) return candidato?.entrevistas?.[0]?.proceso ?? null;

  return (
    procesos.find(p => tieneContratoActivoReal(p))
    ?? procesos.find(p => esContratoReal(p))
    ?? procesos.find(p => !!p?.contrato)
    ?? candidato?.entrevistas?.[0]?.proceso
    ?? null
  );
}

/**
 * Proceso del contrato que se está TRAMITANDO: de aquí salen fecha de ingreso, oficina,
 * código y carné para finalizar, imprimir o marcar.
 *
 * Es `procesoDelContrato` salvo tras una baja: un contrato dado de baja ya no cuenta para
 * nada y la persona queda como si nunca se hubiera contratado (el contrato viejo sigue
 * solo como histórico: pill "Sin contrato", historial laboral). Si el vigente es otro
 * proceso, posterior al retirado, se lee el vigente aunque aún no tenga contrato; antes
 * "Finalizar contratación" mandaba la fecha de ingreso y la oficina del contrato retirado,
 * y el carné y el código del recuadro salían del contrato viejo.
 */
export function procesoContratoEnCurso(candidato: any): any | null {
  const delContrato = procesoDelContrato(candidato);
  if (delContrato?.contrato?.contrato_activo !== false) return delContrato;
  const vigente = procesoVigente(candidato);
  return vigente?.id != null && String(vigente.id) !== String(delContrato?.id)
    && Number(vigente.id) > Number(delContrato?.id)
    ? vigente
    : delContrato;
}

/**
 * Proceso del que se leen (y en el que se guardan) los ANTECEDENTES.
 *
 * Es el proceso VIGENTE, ni más ni menos. Lo importante es que lectura y
 * escritura sean el MISMO: antes se leía de `entrevistas[0].proceso` y se
 * guardaba donde el backend decidiera por su cuenta, así que con dos turnos
 * abiertos el formulario se pintaba en blanco después de guardar
 * (caso CC 1006913166).
 *
 * NO se prefiere "el proceso que ya tiene antecedentes": los de un turno
 * anterior pertenecen a ESE turno y reusarlos filtraría estado de una vacante
 * a otra. Un turno nuevo empieza con los antecedentes en blanco a propósito —
 * hay que volver a consultarlos.
 */
export function procesoDeAntecedentes(candidato: any): any | null {
  return procesoVigente(candidato);
}

/**
 * Proceso abierto DESPUÉS de dar de baja un contrato, con la fecha en que arrancó.
 *
 * Al dar de baja, ms-hr abre entrevista + proceso nuevos: la persona vuelve a
 * contratarse desde cero. Lo que se generó, subió o mandó a firmar para el contrato
 * dado de baja (documentos, borradores, solicitud de firma) NO cuenta para el nuevo:
 * se compara contra `inicio` (la creación de la entrevista del proceso nuevo).
 *
 * null cuando no hay un contrato dado de baja en OTRO proceso anterior: ahí todo
 * sigue como siempre.
 */
export function turnoTrasBaja(candidato: any): { procesoId: string; inicio: string } | null {
  const entrevistas: any[] = Array.isArray(candidato?.entrevistas) ? candidato.entrevistas : [];
  const vigente = procesoVigente(candidato);
  if (!vigente || vigente?.contrato?.contrato_activo === false) return null;
  const huboBaja = entrevistas.some(e =>
    e?.proceso && String(e.proceso.id) !== String(vigente.id) && e.proceso?.contrato?.contrato_activo === false);
  if (!huboBaja) return null;
  const inicio = entrevistas.find(e => String(e?.proceso?.id) === String(vigente.id))?.created_at;
  return inicio ? { procesoId: String(vigente.id), inicio: String(inicio) } : null;
}

/**
 * Milisegundos de una fecha ISO o `dd/MM/yyyy HH:mm[:ss]` (la de ms-templates, en hora local);
 * NaN si no se entiende. `Date.parse` sola no lee el formato con barras.
 */
export function msDeFecha(fecha: unknown): number {
  const t = String(fecha ?? '').trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime();
  return Date.parse(t);
}

/** ¿`fecha` es anterior a `inicio`? (ISO o dd/MM/yyyy HH:mm:ss). Fechas ilegibles no se descartan. */
export function esAnteriorA(fecha: unknown, inicio: string): boolean {
  const f = msDeFecha(fecha);
  const i = msDeFecha(inicio);
  return Number.isFinite(f) && Number.isFinite(i) && f < i;
}

/**
 * ¿El trabajador ya firmó los documentos de ESTE contrato? Solo entonces sale el aviso
 * "tiene un contrato activo" y se bloquea el pipeline: entre contratar y firmar todavía
 * se corrigen datos y documentos sin tener que dar de baja.
 *
 * - Procesos anteriores a PRIMER_PROCESO_FECHA_FIABLE (cargas masivas / Django): firmaron en
 *   papel, cuentan como firmados.
 * - Si no: la última solicitud de firma por correo (ms-templates `/plantillas/firma/estado`)
 *   está FIRMADA y no es anterior al arranque del proceso (una firma del contrato anterior no vale).
 */
export function contratoFirmado(
  proceso: any,
  firma: { estado?: string | null; firmada_en?: string | null } | null | undefined,
): boolean {
  if (!proceso) return false;
  if (Number(proceso?.id) < PRIMER_PROCESO_FECHA_FIABLE) return true;
  if (firma?.estado !== 'FIRMADA') return false;
  const inicio = proceso?.created_at;
  return !(inicio && esAnteriorA(firma.firmada_en, String(inicio)));
}

/**
 * Tipos documentales de la PERSONA, no del contrato: hoja de vida (15 y 28), cédula (29 y
 * sus caras 237/238), firma (87), huella (88) y foto (89). Valen para todos sus contratos.
 * Todo lo demás (contrato, examen, ARL, EPS, ficha, carné, antecedentes…) es de UN contrato.
 */
export const TIPOS_DOC_DE_LA_PERSONA: ReadonlySet<number> = new Set([15, 28, 29, 87, 88, 89, 237, 238]);

/**
 * Primer proceso con `created_at` fiable. Los anteriores llegaron en cargas masivas
 * (HIST_BASES_20261011 termina en el 319134; los CRUCE-*-LEGACY del 05-oct son de agosto
 * y septiembre): su `created_at` es el día de la carga, no el del proceso. Con esos no se
 * puede decir por fecha qué documento es de qué contrato.
 */
export const PRIMER_PROCESO_FECHA_FIABLE = 319135;

/**
 * Tipos que ms-documents guarda a nivel PERSONA (`use_contract_folder = 0`): antecedentes y
 * consultas de robots (2-12), hoja de vida y referencias (15-17), traslados (18, 127, 128),
 * formularios (231-233), soportes de hijos (234)… Pueden existir ANTES de que arranque el
 * proceso (el robot consulta al crear la cuenta; el formulario sube soportes), así que cuando
 * no se ve el proceso anterior no se esconden por fecha.
 */
const TIPOS_DOC_PREVIOS_AL_PROCESO: ReadonlySet<number> = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 127, 128, 231, 232, 233, 234, 239, 240,
]);

/** Proceso en curso y desde cuándo; ver `contratoEnCurso`. */
export interface ContratoEnCurso {
  procesoId: string;
  /** Arranque del proceso en curso; null si su fecha no es fiable (PRIMER_PROCESO_FECHA_FIABLE). */
  inicio: string | null;
  /** ¿Se ve en el sobre un proceso anterior con contrato (vigente o dado de baja)? */
  anterior: boolean;
}

/**
 * Proceso en curso, para no mezclar lo de un contrato anterior con el actual.
 *
 * Al recontratar (o tras dar de baja) se trabaja sobre un proceso nuevo y lo del contrato
 * anterior —documentos, borradores, solicitudes de firma— no debe verse ni contarse.
 *
 * NO basta con buscar el proceso anterior en el sobre: ms-hr lo cuelga de SU entrevista y un
 * proceso sin entrevista (`entrevista_id` NULL) no llega (caso CC 1122415324: proceso 319595
 * dado de baja sin entrevista, contrato y ficha suyos salían en verde en el 319720). Por eso
 * también vale la fecha: lo de contrato subido antes de que arrancara el proceso en curso no
 * es suyo. `anterior` dice si además se vio el proceso anterior (ver esDocumentoDeOtroContrato).
 *
 * `inicio` = creación del proceso (o de su entrevista, si el sobre no trae la del proceso).
 * null cuando no hay proceso vigente, o cuando su fecha no es fiable y no hay anterior a la vista.
 */
export function contratoEnCurso(candidato: any): ContratoEnCurso | null {
  const vigente = procesoVigente(candidato);
  if (vigente?.id == null) return null;
  const entrevistas: any[] = Array.isArray(candidato?.entrevistas) ? candidato.entrevistas : [];
  const anteriorEnEntrevistas = entrevistas.some(e => {
    const p = e?.proceso;
    return p?.id != null && String(p.id) !== String(vigente.id)
      && Number(p.id) < Number(vigente.id)
      && (esContratoReal(p) || p?.contrato?.contrato_activo === false);
  });
  // ms-hr manda además el proceso anterior aparte (`proceso_anterior`), tenga o no entrevista.
  const previo = candidato?.proceso_anterior;
  const anterior = anteriorEnEntrevistas || (previo?.id != null && String(previo.id) !== String(vigente.id)
    && (esContratoReal(previo) || previo?.contrato?.contrato_activo === false));
  const fiable = Number(vigente.id) >= PRIMER_PROCESO_FECHA_FIABLE;
  const creada = vigente?.created_at
    ?? entrevistas.find(e => String(e?.proceso?.id) === String(vigente.id))?.created_at;
  const inicio = fiable && creada ? String(creada) : null;
  if (!anterior && inicio == null) return null;
  return { procesoId: String(vigente.id), inicio, anterior };
}

/**
 * ¿El documento (fila de /gestion_documental/documentos) es de OTRO contrato que el en curso?
 *
 * - Los de la persona nunca.
 * - Etiquetado con proceso (V21 de ms-documents): es de otro si el proceso no coincide.
 * - Sin etiqueta (todo lo subido antes de V21): es de otro si se subió antes de que
 *   arrancara el proceso en curso, siempre que esa fecha sea fiable. Si no se vio el proceso
 *   anterior, los tipos que pueden ser previos al proceso (TIPOS_DOC_PREVIOS_AL_PROCESO) no
 *   se esconden por fecha.
 */
export function esDocumentoDeOtroContrato(doc: any, curso: ContratoEnCurso | null): boolean {
  if (!curso || !doc) return false;
  const t = doc?.type;
  const tipo = Number(t && typeof t === 'object' ? t.id : t);
  if (TIPOS_DOC_DE_LA_PERSONA.has(tipo)) return false;
  const proceso = doc?.proceso_id;
  if (proceso != null && proceso !== '') return String(proceso) !== curso.procesoId;
  if (curso.inicio == null) return false;
  if (!curso.anterior && TIPOS_DOC_PREVIOS_AL_PROCESO.has(tipo)) return false;
  return esAnteriorA(doc?.created_at ?? doc?.uploaded_at, curso.inicio);
}

/**
 * Filtro "¿es de otro contrato?" para una lista de documentos de la persona.
 *
 * Igual que esDocumentoDeOtroContrato, pero mira primero la lista entera: si trae algo de
 * contrato (contrato, ficha, examen, ARL…) anterior al proceso en curso o etiquetado con otro
 * proceso, la persona YA tuvo otro proceso aunque el sobre no lo muestre. Entonces también se
 * esconden los antecedentes y demás consultas de ese proceso: se vuelven a consultar con la
 * fecha más reciente. A quien llega por primera vez no le pasa: no puede tener documentos de
 * contrato de antes de su proceso, y sus antecedentes (consultados al crear la cuenta) se ven.
 */
export function filtroOtroContrato(curso: ContratoEnCurso | null, docs: readonly any[] | null | undefined): (doc: any) => boolean {
  if (!curso) return () => false;
  let c = curso;
  if (!c.anterior && (docs ?? []).some(d => esDocumentoDeOtroContrato(d, c))) c = { ...c, anterior: true };
  return (doc: any) => esDocumentoDeOtroContrato(doc, c);
}
