/**
 * Utilidades puras del escáner en modo cédula con `salida: 'imagenes'`.
 *
 * El diálogo, en ese modo, no arma un PDF: entrega las dos caras sueltas en JPEG
 * para que el servidor (ms-documents `CedulaAmpliadaService`) las ponga en la hoja
 * carta al 150 %. Aquí vive lo que se puede probar sin cámara ni lienzo.
 */

/** Lo que devuelve `DocumentScanDialogComponent` con `modo:'cedula', salida:'imagenes'`. */
export interface CarasCedula {
  frente: File;
  reverso: File;
}

/**
 * Lado mayor de cada cara, en píxeles. A 128,4 mm de ancho (la cédula al 150 %)
 * 1800 px son ~356 ppp: sobra para imprimir y cada JPEG queda en unos cientos de KB
 * en vez de los 1–2 MB del recorte a 2400 px.
 */
export const LADO_MAX_CARA = 1800;

/** Calidad JPEG de cada cara. */
export const CALIDAD_CARA = 0.9;

/**
 * Medidas para reducir una imagen sin deformarla: el lado mayor no pasa de `max`.
 * Nunca agranda y nunca devuelve 0 (una imagen de 1 px sigue siendo de 1 px).
 */
export function medidasAcotadas(ancho: number, alto: number, max: number): { ancho: number; alto: number } {
  const w = Math.max(1, Math.round(Number(ancho) || 0));
  const h = Math.max(1, Math.round(Number(alto) || 0));
  const tope = Math.max(1, Math.round(Number(max) || 0));
  const mayor = Math.max(w, h);
  if (mayor <= tope) return { ancho: w, alto: h };
  const escala = tope / mayor;
  return {
    ancho: Math.max(1, Math.round(w * escala)),
    alto: Math.max(1, Math.round(h * escala)),
  };
}

/**
 * Nombre del archivo de una cara: `cedula_frente.jpg`, `cedula_de_extranjeria_reverso.jpg`.
 * Sin tildes ni símbolos (gestión documental guarda el nombre tal cual) y corto: el
 * backend de documentos rechaza nombres de más de 100 caracteres.
 */
export function nombreArchivoCara(docName: string | null | undefined, cara: 'frente' | 'reverso'): string {
  const base = String(docName ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'documento';
  return `${base}_${cara}.jpg`;
}

/** ¿Lo que cerró el diálogo son las dos caras? (y no un arreglo de PDFs ni `undefined`). */
export function esCarasCedula(valor: unknown): valor is CarasCedula {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const v = valor as Record<string, unknown>;
  const esArchivo = (x: unknown) => typeof Blob !== 'undefined' && x instanceof Blob && x.size > 0;
  return esArchivo(v['frente']) && esArchivo(v['reverso']);
}
