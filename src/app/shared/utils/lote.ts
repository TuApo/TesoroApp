import { firstValueFrom, isObservable, type Observable } from 'rxjs';

/**
 * ACCIONES MASIVAS SOBRE LO MARCADO.
 *
 * Casi ningún endpoint de la plataforma acepta una lista: se manda uno por uno.
 * Hacerlo así a propósito tiene dos ventajas — un registro que falle no arrastra
 * a los demás, y al final se puede decir exactamente con cuáles no se pudo.
 */

export interface ResultadoLote<T = unknown> {
  hechos: number;
  /** Etiqueta (cédula, correo, código…) de los que fallaron. */
  fallidos: string[];
  /** Los elementos que salieron bien y los que no, para volver sobre ellos. */
  elementosHechos: T[];
  elementosFallidos: T[];
  /** Se paró antes de terminar (los que no se alcanzaron no cuentan como fallo). */
  cancelado: boolean;
}

export interface OpcionesLote<T> {
  /** Se llama después de cada elemento: para pintar «3 de 12». */
  alAvanzar?: (avance: { hechos: number; fallidos: number; total: number; ultimo: T; fallo: boolean }) => void;
  /** Se consulta antes de cada elemento: true para parar. */
  cancelado?: () => boolean;
}

/** Ejecuta la acción sobre cada elemento, en orden, sin cortar por un fallo. */
export async function ejecutarEnLote<T>(
  items: readonly T[],
  accion: (item: T) => Promise<unknown> | Observable<unknown>,
  etiqueta: (item: T) => string,
  opciones: OpcionesLote<T> = {},
): Promise<ResultadoLote<T>> {
  const fallidos: string[] = [];
  const elementosHechos: T[] = [];
  const elementosFallidos: T[] = [];
  let cancelado = false;
  for (const item of items) {
    if (opciones.cancelado?.()) { cancelado = true; break; }
    let fallo = false;
    try {
      const r = accion(item);
      await (isObservable(r) ? firstValueFrom(r) : r);
      elementosHechos.push(item);
    } catch {
      fallo = true;
      fallidos.push(etiqueta(item));
      elementosFallidos.push(item);
    }
    opciones.alAvanzar?.({
      hechos: elementosHechos.length, fallidos: elementosFallidos.length,
      total: items.length, ultimo: item, fallo,
    });
  }
  return { hechos: elementosHechos.length, fallidos, elementosHechos, elementosFallidos, cancelado };
}

/** Frase de cierre para el snackbar o el Swal: «12 desactivadas. No se pudo con: …». */
export function mensajeDeLote(r: ResultadoLote<unknown>, verbo: string, maximo = 5): string {
  const parada = r.cancelado ? ' Se detuvo antes de terminar.' : '';
  if (!r.fallidos.length) return `${r.hechos} ${verbo}.${parada}`;
  const lista = r.fallidos.slice(0, maximo).join(', ');
  const resto = r.fallidos.length > maximo ? '…' : '';
  return `${r.hechos} ${verbo}. No se pudo con: ${lista}${resto}${parada}`;
}
