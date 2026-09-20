/**
 * La observación del evaluador: el veredicto de la entrevista.
 *
 * Son TRES estados excluyentes y cada uno tiene su consecuencia:
 *
 *  · `APLICA`     — sigue el proceso. No pide motivo.
 *  · `NO_APLICA`  — no se puede contratar; hay que decir POR QUÉ.
 *  · `EN_ESPERA`  — sirve, pero no para las vacantes de ahora; hay que dejar
 *                   la observación que lo explique.
 *
 * Vive aparte del componente por lo de siempre en este módulo: la regla estaba
 * escrita DOS veces —en `applyAplicaObservacionRules`, que pone los validadores,
 * y en el validador del paso, que calcula el avance— y dos copias de una regla
 * se despegan a la primera corrección. Además así se puede probar sin levantar
 * la pantalla entera.
 *
 * Ojo con `EN_ESPERA`: el requisito dice "debe PERMITIR registrar una
 * observación". Aquí se exige, no solo se permite, y es a propósito: el estado
 * existe justamente para dejar dicho por qué se aparta a alguien que sí sirve, y
 * sin el texto la fila no le dice nada a quien la lea después.
 */

export type EstadoObservacion = 'APLICA' | 'NO_APLICA' | 'EN_ESPERA';

export const ESTADOS_OBSERVACION: ReadonlyArray<{ valor: EstadoObservacion; label: string }> = [
  { valor: 'APLICA', label: 'APLICA' },
  { valor: 'NO_APLICA', label: 'NO APLICA' },
  { valor: 'EN_ESPERA', label: 'EN ESPERA' },
];

/** Tope del texto. Es el mismo que valida el control y el que corta el textarea. */
export const MAX_MOTIVO = 300;

/**
 * Qué control lleva el motivo de cada estado, o `null` si ese estado no pide
 * ninguno. Es el reparto que usan LOS DOS sitios: quien pone los validadores y
 * quien mide el avance.
 */
export function campoMotivoDe(estado: unknown): 'motivoEspera' | 'motivoNoAplica' | null {
  switch (estado) {
    case 'EN_ESPERA': return 'motivoEspera';
    case 'NO_APLICA': return 'motivoNoAplica';
    default: return null;
  }
}

/** El control que NO corresponde al estado: se limpia para no dejar dos versiones. */
export function campoMotivoContrario(estado: unknown): 'motivoEspera' | 'motivoNoAplica' | null {
  const propio = campoMotivoDe(estado);
  if (propio === 'motivoEspera') return 'motivoNoAplica';
  if (propio === 'motivoNoAplica') return 'motivoEspera';
  return null;
}

/**
 * ¿La observación está completa?
 *
 * Sin estado elegido NO está completa: es obligatorio, y darla por buena vacía
 * dejaría pasar entrevistas sin veredicto.
 */
export function observacionCompleta(
  estado: unknown,
  motivos: { motivoEspera?: unknown; motivoNoAplica?: unknown },
): boolean {
  if (estado !== 'APLICA' && estado !== 'NO_APLICA' && estado !== 'EN_ESPERA') return false;
  const campo = campoMotivoDe(estado);
  if (!campo) return true;
  const texto = String(motivos[campo] ?? '').trim();
  return texto.length > 0 && texto.length <= MAX_MOTIVO;
}
