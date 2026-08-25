/**
 * RUTA DE RESPUESTAS en el cliente — espejo EXACTO de `RoutingPlan` del servidor
 * (ms-forms, co.tsservicios.msforms.dynamicforms.validation.RoutingPlan).
 *
 * El recorrido por defecto es lineal, pero una respuesta puede desviarlo:
 *   1. la primera regla `schema.routing` de la sección que case con lo contestado,
 *   2. si ninguna casa, `next_section` de la sección,
 *   3. si tampoco, la siguiente sección por orden.
 * 'END' termina el formulario ahí.
 *
 * Los dos lados DEBEN dar el mismo resultado: el front decide qué pantalla pintar y qué
 * validar; el servidor decide qué obligatorios exigir. Si divergieran, el usuario vería
 * un formulario completo y el envío sería rechazado por un campo que nunca se le mostró.
 *
 * El servidor ya garantiza al publicar que todo destino apunta hacia ADELANTE, así que
 * el recorrido siempre termina; aun así hay guarda anti-ciclo por si llega una versión
 * antigua o manipulada.
 */

import { FIN_DEL_FORMULARIO, FieldValue, DynamicField } from '@/app/shared/components/forms/field.model';
import { FormSection } from './dynamic-forms.models';

export { FIN_DEL_FORMULARIO };

/** Valores del formulario tal como los guarda el runtime: { seccion: { campo: valor } }. */
export type ValoresPorSeccion = Record<string, Record<string, FieldValue>>;

/** Code de la sección en la posición dada (mismo criterio que usa el runtime al enviar). */
export function codigoDeSeccion(sec: FormSection, indice: number): string {
  return sec.code ?? `seccion_${indice + 1}`;
}

/** Campos de la sección con los hijos de un grupo SECTION aplanados. */
function aplanar(campos: DynamicField[]): DynamicField[] {
  const out: DynamicField[] = [];
  for (const f of campos ?? []) {
    out.push(f);
    if (f.children?.length) out.push(...aplanar(f.children));
  }
  return out;
}

/** Destino que dispara ESTE campo con lo respondido, o null si no desvía. */
function destinoDelCampo(campo: DynamicField, valores: Record<string, FieldValue> | undefined): string | null {
  if (campo.type !== 'SINGLE_CHOICE' && campo.type !== 'DROPDOWN') return null;
  const reglas = campo.schema?.routing?.rules;
  if (!reglas?.length) return null;

  const clave = campo.name;
  const respondido = clave ? valores?.[clave] : null;
  if (typeof respondido !== 'string' || respondido.trim() === '') return null;

  // El payload guarda la ETIQUETA; una regla puede citar la etiqueta o el value interno.
  const opcion = (campo.schema?.options ?? [])
    .find(o => o.label === respondido || o.value === respondido);
  for (const regla of reglas) {
    if (regla.option === respondido || (opcion && regla.option === opcion.value)) {
      const destino = (regla.go_to ?? '').trim();
      return destino === '' ? null : destino;
    }
  }
  return null;
}

/**
 * Índices de las secciones que la respuesta recorre de verdad, EN ORDEN.
 * Con valores vacíos devuelve el recorrido que se ve al abrir el formulario.
 */
export function recorrido(secciones: FormSection[], valores: ValoresPorSeccion): number[] {
  const ruta: number[] = [];
  if (!secciones?.length) return ruta;

  const indicePorCodigo = new Map<string, number>();
  secciones.forEach((sec, i) => indicePorCodigo.set(codigoDeSeccion(sec, i), i));

  const vistos = new Set<number>();
  let i = 0;
  while (i >= 0 && i < secciones.length) {
    if (vistos.has(i)) break;                  // guarda anti-ciclo
    vistos.add(i);
    ruta.push(i);

    const sec = secciones[i];
    const deSeccion = valores[codigoDeSeccion(sec, i)];
    let destino: string | null = null;
    for (const campo of aplanar(sec.fields)) {
      destino = destinoDelCampo(campo, deSeccion);
      if (destino) break;
    }
    if (!destino) destino = (sec.next_section ?? '').trim() || null;
    if (!destino) { i++; continue; }
    if (destino.toUpperCase() === FIN_DEL_FORMULARIO) break;

    const j = indicePorCodigo.get(destino);
    if (j == null || j <= i) break;            // destino inválido o hacia atrás
    i = j;
  }
  return ruta;
}

/** ¿El formulario tiene alguna ramificación configurada? */
export function tieneRamificacion(secciones: FormSection[]): boolean {
  return (secciones ?? []).some(sec =>
    !!(sec.next_section ?? '').trim()
    || aplanar(sec.fields).some(f => !!f.schema?.routing?.rules?.length));
}
