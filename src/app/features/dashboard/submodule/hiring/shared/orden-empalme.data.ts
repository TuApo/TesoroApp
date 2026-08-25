/**
 * EL ORDEN DEL EMPALME
 *
 * Un expediente empalmado es un solo PDF con TODO lo de la persona, y el orden
 * en que van los documentos no es decorativo: es el orden en que lo revisa
 * quien lo recibe. Vivía dentro del diálogo de "buscar documentos"
 * (`orden-union-dialog`), que es donde se empalma en lote; al sacarlo aquí, el
 * empalme de UNA persona —el del pipeline— usa exactamente el mismo orden, y
 * cambiarlo se hace en un único sitio.
 *
 * Son IDs de tipo documental de gestión documental, no títulos: el título con
 * el que se guardó cada archivo varía (viene sin tildes, a veces con el nombre
 * del robot), pero el tipo es el contrato con el backend.
 */

import { TYPE_ID_POR_TITULO } from './paquete-documental.data';

/** Paquete completo de contratación, en el orden en que se revisa. */
export const ORDEN_PAQUETE_COMPLETO: readonly number[] = [
  111,  // FICHA_COMPLETA (el usuario decide si la deja o usa la técnica)
  34,   // FICHA_TECNICA
  29,   // CEDULA
  6,    // POLICIVOS
  3,    // PROCURADURIA
  4,    // CONTRALORIA
  5,    // OFAC
  103,  // ENTREVISTA_INGRESO
  32,   // EXAMENES_MEDICOS
  107,  // COLINESTERASA
  112,  // AUTORIZACION_INGRESO
  25,   // CONTRATO
  104,  // CONTRATOS_OTROS_SI
  30,   // ARL
  27,   // ENTREGA_DE_DOCUMENTOS
  113,  // BONIFICACION_IPANEMA
  114,  // PRUEBA_PSICOTECNICA
  7,    // ADRES
  11,   // AFP
  28,   // HOJA_DE_VIDA_M
  16,   // REFERENCIA_PERSONAL
  17,   // REFERENCIA_FAMILIAR
  86,   // REFERENCIA_LABORAL
  101,  // CERTIFICADOS_ESTUDIOS
  20,   // PRUEBA_LECTRO_ESCRITURA
  31,   // FIGURA_HUMANA
  91,   // SST
  115,  // OTRAS_PRUEBAS
  36,   // EPS
  37,   // CAJA
  38,   // PAGO_SEGURIDAD_SOCIAL
];

/** Paquete por finca: solo los documentos esenciales. */
export const ORDEN_PAQUETE_FINCA: readonly number[] = [
  111,  // FICHA_COMPLETA (el usuario decide si la deja o usa la técnica)
  34,   // FICHA_TECNICA
  29,   // CEDULA
  6,    // POLICIVOS
  3,    // PROCURADURIA
  4,    // CONTRALORIA
  5,    // OFAC
  103,  // ENTREVISTA_INGRESO
  32,   // EXAMENES_MEDICOS
  107,  // COLINESTERASA
  25,   // CONTRATO
  104,  // CONTRATOS_OTROS_SI
  30,   // ARL
];

/**
 * Tipos que NO salen del paquete documental de contratación —los cargan los
 * robots (antecedentes, ADRES, AFP) o son referencias— y que por tanto no
 * están en `TYPE_ID_POR_TITULO`. Sin ellos, media docena de documentos del
 * expediente se listarían como "Tipo 6".
 */
const NOMBRES_EXTRA: Readonly<Record<number, string>> = {
  3:   'Procuraduría',
  4:   'Contraloría',
  5:   'OFAC',
  6:   'Antecedentes policivos',
  7:   'ADRES',
  11:  'AFP',
  16:  'Referencia personal',
  17:  'Referencia familiar',
  32:  'Exámenes médicos',
  86:  'Referencia laboral',
  111: 'Ficha completa',
};

/**
 * Nombre con el que se presenta cada tipo.
 *
 * Varios títulos comparten tipo (las once inducciones son el 27, los dos
 * otrosí el 104): gana el PRIMERO declarado en `TYPE_ID_POR_TITULO`, que es el
 * genérico, porque aquí se nombra el tipo, no el documento concreto.
 */
const NOMBRE_POR_TYPE_ID: ReadonlyMap<number, string> = (() => {
  const m = new Map<number, string>();
  for (const [titulo, id] of Object.entries(TYPE_ID_POR_TITULO)) {
    if (!m.has(id)) m.set(id, titulo);
  }
  for (const [id, nombre] of Object.entries(NOMBRES_EXTRA)) {
    m.set(Number(id), nombre);
  }
  return m;
})();

/**
 * Cómo se llama este tipo documental.
 *
 * `fallback` es el título con el que se guardó el archivo: sirve para los
 * tipos que no conoce el front (los crea Parametrización) y evita que salga
 * un número donde debería ir un nombre.
 */
export function tituloDeTipo(id: number, fallback?: string | null): string {
  const conocido = NOMBRE_POR_TYPE_ID.get(id);
  if (conocido) return conocido;
  const suyo = (fallback ?? '').toString().trim();
  return suyo || `Tipo ${id}`;
}

/** Posición de un tipo dentro de un orden; los que no están, al final. */
export function indiceEnOrden(orden: readonly number[], typeId: number): number {
  const i = orden.indexOf(typeId);
  return i === -1 ? orden.length : i;
}
