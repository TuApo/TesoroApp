/**
 * Reglas puras del botón "Tomar con cámara" del documento de identidad.
 *
 * El flujo: el escáner entrega las dos caras en JPEG → se sube cada una a
 * `documentosPruebas` con el `typeName` que ms-documents reconoce como cara → se
 * pide la hoja carta al 150 % (`POST /gestion_documental/cedula-ampliada/{owner}`),
 * que queda en el tipo 29 CEDULA (código CEDULA_150).
 */

/** Nombres EXACTOS de los tipos de cara en ms-documents (ids 237 y 238 en producción). */
export const TIPO_CARA = {
  frente: 'DOCUMENTO_IDENTIDAD_FRENTE',
  reverso: 'DOCUMENTO_IDENTIDAD_REVERSO',
} as const;

export type Cara = keyof typeof TIPO_CARA;

/** En qué va el proceso. `abriendo` = cargando el escáner. */
export type PasoCedula = 'inactivo' | 'abriendo' | 'frente' | 'reverso' | 'armando';

/** La hoja al 150 % ya está en el expediente. */
export interface CedulaArmada {
  /** Documento (owner_id) al que pertenece: la tarjeta que la reciba lo compara. */
  cedula: string;
  /** Id del documento en el tipo 29, para verlo y pintar la miniatura. */
  id: number;
  /** CREADA (se armó ahora) o YA_ESTABA (la armó el servidor al subir el reverso). */
  estado: string;
}

/** Texto del botón mientras trabaja. */
export function etiquetaPaso(paso: PasoCedula): string {
  switch (paso) {
    case 'abriendo': return 'Abriendo la cámara…';
    case 'frente': return 'Subiendo el frente (1/3)…';
    case 'reverso': return 'Subiendo el reverso (2/3)…';
    case 'armando': return 'Armando la hoja al 150 % (3/3)…';
    default: return 'Tomar con cámara';
  }
}

/** Avance aproximado para la barrita de progreso. */
export function porcentajePaso(paso: PasoCedula): number {
  switch (paso) {
    case 'abriendo': return 5;
    case 'frente': return 20;
    case 'reverso': return 55;
    case 'armando': return 85;
    default: return 0;
  }
}

/**
 * Qué respondió `cedula-ampliada`. Solo CREADA o YA_ESTABA con un id sirven: con
 * SIN_CARAS el servidor no vio las dos caras que se acaban de subir.
 */
export function interpretarArmado(r: unknown): { ok: boolean; id: number | null; estado: string; mensaje: string } {
  const obj = (r && typeof r === 'object') ? r as Record<string, unknown> : {};
  const estado = String(obj['estado'] ?? '').trim().toUpperCase();
  const n = Number(obj['id']);
  const id = Number.isFinite(n) && n > 0 ? n : null;
  if ((estado === 'CREADA' || estado === 'YA_ESTABA') && id !== null) {
    return { ok: true, id, estado, mensaje: '' };
  }
  if (estado === 'SIN_CARAS') {
    return {
      ok: false, id: null, estado,
      mensaje: 'El servidor no encontró las dos caras recién subidas. Vuelve a intentarlo.',
    };
  }
  return {
    ok: false, id: null, estado,
    mensaje: 'El servidor no devolvió la hoja al 150 %. Vuelve a abrir a la persona para reintentarlo.',
  };
}

/**
 * Mensaje de error según el paso en el que se cayó: dice qué quedó guardado y
 * qué no, para que nadie vuelva a tomar las fotos si ya estaban arriba.
 */
export function mensajeFallo(paso: PasoCedula, detalle: string): string {
  const d = (detalle ?? '').trim();
  const cola = d ? ` Detalle: ${d}` : '';
  switch (paso) {
    case 'frente':
      return `No se pudo subir el FRENTE; no quedó nada guardado.${cola}`;
    case 'reverso':
      return `El frente quedó guardado, pero no se pudo subir el REVERSO. Vuelve a tomar las fotos.${cola}`;
    case 'armando':
      return 'Las dos caras quedaron guardadas, pero no se pudo armar la hoja al 150 %. '
        + 'Vuelve a abrir a la persona (se reintenta sola) o usa "Subir documento".' + cola;
    default:
      return `No se pudo abrir el escáner.${cola}`;
  }
}
