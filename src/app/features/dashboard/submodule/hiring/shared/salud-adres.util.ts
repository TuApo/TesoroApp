import type { RegimenExcepcionAdres, ResultadosAntecedentes } from '../service/robots/robots.service';

/**
 * Lo que la ficha muestra de la afiliación a salud según ADRES (pedido #6).
 *
 * Sale de `GET /Robots/resultados-antecedentes` (ms-automation), el MISMO dato que usa
 * el aviso ámbar del pipeline:
 *  - `regimen_excepcion`: ADRES reporta régimen especial o de excepción (por el
 *    régimen/entidad que transcribió el robot, o por la observación del PDF).
 *  - `adres_sin_registro`: ADRES no encontró afiliación. No es un veredicto: alguien de
 *    régimen especial (Fuerzas Militares, Magisterio…) suele salir así, por eso solo
 *    se pide verificar.
 */
export interface SaludAdres {
  excepcion: RegimenExcepcionAdres | null;
  sinRegistro: boolean;
}

/** Resume la respuesta del robot; `null` si no hay nada que mostrar. */
export function saludAdresDe(res: ResultadosAntecedentes | null | undefined): SaludAdres | null {
  if (!res) return null;
  const excepcion = res.regimen_excepcion ?? null;
  const sinRegistro = !excepcion && res.adres_sin_registro === true;
  return excepcion || sinRegistro ? { excepcion, sinRegistro } : null;
}

/** Texto del detalle del chip: "Régimen: X · Entidad: Y · Estado: Z" (lo que haya). */
export function detalleExcepcion(rx: RegimenExcepcionAdres | null | undefined): string {
  if (!rx) return '';
  return [
    rx.regimen ? `Régimen: ${rx.regimen}` : '',
    rx.entidad ? `Entidad: ${rx.entidad}` : '',
    rx.estado ? `Estado: ${rx.estado}` : '',
  ].filter(Boolean).join(' · ');
}

/**
 * ¿El PDF de ADRES trae, en el recuadro "Observaciones", la nota de régimen de
 * excepción o especial? Es lo único que ADRES pone para esas personas (no hay
 * tabla de afiliación), así que hay que leerlo del documento:
 *
 *   "…presentan a la fecha inconsistencia con una entidad del Regimen de
 *    Excepcion o Especial, se sugiere dirigirse a la entidad…"
 *
 * Se busca solo entre "Observaciones" y el pie ("La información registrada…"):
 * el pie habla de "Régimen Subsidiado y Régimen Contributivo" en TODOS los PDFs.
 * Sin el título (texto partido raro) se busca en todo el texto: el pie no dice
 * "excepción", así que no da falsos positivos.
 */
export function observacionExcepcionAdres(texto: string | null | undefined): boolean {
  const t = (texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ');
  if (!t) return false;
  const ini = t.indexOf('OBSERVACIONES');
  let zona = t;
  if (ini >= 0) {
    const fin = t.indexOf('LA INFORMACION REGISTRADA', ini);
    zona = t.slice(ini, fin > ini ? fin : ini + 1200);
  }
  return /REGIMEN ?DE ?EXCEPCION|EXCEPCION ?O ?ESPECIAL/.test(zona);
}
