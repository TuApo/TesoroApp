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
