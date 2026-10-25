/**
 * Preguntas SI/NO de las plantillas HTML (Entrega de documentos, AL CO-RE-6).
 *
 * ms-templates marca las dos casillas de cada pregunta con
 * `span.ph-edit[data-control="si_no"][data-campo][data-opcion="SI|NO"]`. En pantalla se
 * contestan como un radio: marcar una desmarca la otra; son obligatorias salvo las que
 * `/vista` manda con `obligatorio: false` (Referenciación). La respuesta
 * viaja a `/generar` con el CAMPO como clave (`{"Autoriza Descuento Casino": "SI"}`) y el PDF
 * pone la X en el paréntesis elegido.
 */
export type RespuestaSiNo = 'SI' | 'NO';

export interface PreguntaSiNo {
  campo: string;
  valor: RespuestaSiNo | null;
  /** false = se puede dejar sin responder (Referenciación: la referencia puede no contestar). */
  obligatorio?: boolean;
  /** true = la contesta el dato (Entrega 4: plan funeral de Contratación): no se cambia en pantalla. */
  fijo?: boolean;
}

/** Lo que devuelve `/vista` por cada pregunta (`controles`). */
export interface ControlPlantilla {
  campo: string;
  tipo: string;
  opciones: string[];
  valor: string | null;
  obligatorio: boolean;
  /** La respuesta es la de la base y no se puede cambiar (ms-templates `data-fijo="si"` con dato). */
  fijo?: boolean;
}

export const SELECTOR_SI_NO = 'span.ph-edit[data-control="si_no"][data-campo]';

export function normalizarSiNo(v: string | null | undefined): RespuestaSiNo | null {
  const t = (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  return t === 'SI' || t === 'NO' ? t : null;
}

/**
 * Preguntas del documento en orden de aparición. La respuesta inicial es la casilla que ya
 * viene con X (el dato la trae, p. ej. NO cuando el grupo no tiene casino) o la de `controles`.
 */
export function leerPreguntas(doc: Document, controles: readonly ControlPlantilla[] = []): PreguntaSiNo[] {
  const porDefecto = new Map(controles.map((c) => [c.campo, normalizarSiNo(c.valor)]));
  const opcionales = new Set(controles.filter((c) => c.obligatorio === false).map((c) => c.campo));
  const fijos = new Set(controles.filter((c) => c.fijo === true && normalizarSiNo(c.valor)).map((c) => c.campo));
  const out = new Map<string, PreguntaSiNo>();
  for (const s of Array.from(doc.querySelectorAll<HTMLElement>(SELECTOR_SI_NO))) {
    const campo = s.dataset['campo'] ?? '';
    if (!out.has(campo)) {
      out.set(campo, { campo, valor: porDefecto.get(campo) ?? null, obligatorio: !opcionales.has(campo), fijo: fijos.has(campo) });
    }
    const opcion = normalizarSiNo(s.dataset['opcion']);
    if (opcion && (s.textContent ?? '').trim() && !fijos.has(campo)) out.get(campo)!.valor = opcion;
  }
  return Array.from(out.values());
}

/** Pone la X en la casilla elegida y vacía la otra (todas las apariciones del campo). */
export function marcarRespuesta(doc: Document, campo: string, valor: RespuestaSiNo): void {
  for (const s of Array.from(doc.querySelectorAll<HTMLElement>(SELECTOR_SI_NO))) {
    if (s.dataset['campo'] !== campo) continue;
    const elegida = normalizarSiNo(s.dataset['opcion']) === valor;
    s.textContent = elegida ? 'X' : '';
    s.classList.toggle('ph-editado', elegida);
  }
}

/**
 * Pinta cada paréntesis como un radio dentro del documento: los de una pregunta sin responder
 * quedan resaltados (también las opcionales: si no, la casilla no se ve hasta pasar el cursor);
 * el elegido lleva la X (lo mismo que sale impreso).
 */
export function pintarPendientes(doc: Document, preguntas: readonly PreguntaSiNo[]): void {
  const sin = new Set(preguntas.filter((p) => !p.valor).map((p) => p.campo));
  const fijos = new Set(preguntas.filter((p) => p.fijo).map((p) => p.campo));
  for (const s of Array.from(doc.querySelectorAll<HTMLElement>(SELECTOR_SI_NO))) {
    const caja = (s.closest('.mk') as HTMLElement | null) ?? s;
    caja.classList.add('ph-radio');
    caja.classList.toggle('ph-radio-fijo', fijos.has(s.dataset['campo'] ?? ''));
    caja.classList.toggle('ph-radio-falta', sin.has(s.dataset['campo'] ?? ''));
    caja.classList.toggle('ph-radio-elegido', !!(s.textContent ?? '').trim());
  }
}

/** Campos obligatorios que aún no tienen respuesta (las opcionales pueden quedar en blanco). */
export function sinResponder(preguntas: readonly PreguntaSiNo[]): string[] {
  return preguntas.filter((p) => !p.valor && p.obligatorio !== false).map((p) => p.campo);
}
