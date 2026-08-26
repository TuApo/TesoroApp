import { centroDeCostosDe } from '../../shared/contrato-campos';

/**
 * Regla: qué falta de "Pago y Transporte" para poder generar la documentación.
 *
 * Se valida contra lo GUARDADO en el backend (`entrevistas[0].proceso.contrato`),
 * no contra el form del sub-tab: `generate-contracting-documents` es otra ruta que
 * recarga el candidato por cédula y arma los documentos desde ahí, así que lo que
 * esté escrito pero sin guardar no llegaría y saldrían documentos con campos vacíos.
 *
 * Vive aparte del componente para poder probarse sin levantar la página entera.
 */

/**
 * Campos exigidos, con el nombre que usa `ContratoCandidatoSerializer`.
 *
 * No entran:
 * - `seguro_funerario` / `horas_extras`: son booleanos, `false` es un valor válido.
 * - `salario` / `auxilio_transporte`: van deshabilitados en el form y ni siquiera
 *   se mandan en el payload.
 * - `contrasenia_asignada`: el form la exige, pero en el serializer es `write_only`
 *   y la API NUNCA la devuelve. Exigirla contra el backend dejaría bloqueado para
 *   siempre a todo candidato que no sea Daviplata.
 */
export const CAMPOS_PAGO_TRANSPORTE: ReadonlyArray<{ campo: string; etiqueta: string }> = [
  { campo: 'forma_de_pago', etiqueta: 'Forma de pago' },
  { campo: 'numero_para_pagos', etiqueta: 'Número para pagos' },
  // OJO: la API responde `ccentro_de_costos` (minúscula) y el guardado acepta
  // `Ccentro_de_costos`. Se comprueba con `centroDeCostosDe`, más abajo; aquí
  // queda la etiqueta para el mensaje.
  { campo: 'Ccentro_de_costos', etiqueta: 'Centro de costos' },
  { campo: 'subcentro_de_costos', etiqueta: 'Subcentro de costos' },
  { campo: 'porcentaje_arl', etiqueta: 'Porcentaje ARL' },
  { campo: 'cesantias', etiqueta: 'Cesantías' },
  { campo: 'grupo', etiqueta: 'Grupo' },
  { campo: 'categoria', etiqueta: 'Categoría' },
  { campo: 'operacion', etiqueta: 'Operación' },
  { campo: 'fecha_ingreso', etiqueta: 'Fecha de ingreso' },
  { campo: 'fecha_contrato', etiqueta: 'Fecha de contrato' },
];

export const FALTA_GUARDAR = 'Guardar el sub-tab "Pago y Transporte" de Contratación.';

/** Ojo: no vale `!valor`. `porcentaje_arl` puede ser 0 y sigue siendo un dato. */
function vacio(valor: any): boolean {
  return valor === null || valor === undefined || String(valor).trim() === '';
}

/** Etiquetas de lo que falta. Vacío = se puede generar la documentación. */
export function faltantesDePagoTransporte(contrato: any): string[] {
  if (!contrato) return [FALTA_GUARDAR];

  const faltan = CAMPOS_PAGO_TRANSPORTE
    .filter(({ campo }) => campo === 'Ccentro_de_costos'
      // Se guarda con C mayúscula y se lee con minúscula: sin esto, el centro
      // de costos salía como "falta" con el dato ya guardado, y la generación
      // quedaba bloqueada para siempre. Ver `shared/contrato-campos`.
      ? !centroDeCostosDe(contrato)
      : vacio(contrato[campo]))
    .map(({ etiqueta }) => etiqueta);

  // Daviplata no pide tarjeta (misma regla que setupFormaPagoValidation en
  // hiring-questions).
  const formaPago = String(contrato['forma_de_pago'] ?? '').trim();
  if (formaPago && formaPago !== 'Daviplata' && vacio(contrato['identification_number_tarjeta'])) {
    faltan.push('Número de tarjeta');
  }

  return faltan;
}
