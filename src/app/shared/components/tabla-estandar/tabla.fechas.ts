import type { FormatoFecha, TipoFecha, ValorCelda } from './tabla.tipos';

/**
 * Fechas de la tabla estándar.
 *
 * Las columnas no declaran su tipo: se deduce de lo que traen. Con eso, el
 * embudo de esa columna ofrece un rango con calendario (y hora si la hay) y
 * todas las fechas se escriben con el formato que elija cada quien.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;
const LATINO = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?)?/i;

/** Devuelve la fecha del valor de una celda, o null si no lo es. */
export function aFecha(valor: ValorCelda): Date | null {
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  if (!texto) return null;

  const iso = ISO.exec(texto);
  if (iso) {
    const [, a, m, d, h, mi, s] = iso;
    return new Date(+a, +m - 1, +d, +(h ?? 0), +(mi ?? 0), +(s ?? 0));
  }

  const lat = LATINO.exec(texto);
  if (lat) {
    const [, p1, p2, a, h, mi, s, meridiano] = lat;
    // dd/mm salvo que el primer número no pueda ser día (locale es-CO).
    const dia = +p1 > 12 ? +p1 : +p2 > 12 ? +p2 : +p1;
    const mes = dia === +p1 ? +p2 : +p1;
    let hora = +(h ?? 0);
    if (meridiano) {
      const pm = meridiano.toLowerCase() === 'p';
      if (pm && hora < 12) hora += 12;
      if (!pm && hora === 12) hora = 0;
    }
    const f = new Date(+a, mes - 1, dia, hora, +(mi ?? 0), +(s ?? 0));
    return isNaN(f.getTime()) ? null : f;
  }
  return null;
}

/**
 * Mira una muestra de la columna y dice si es de fechas (y si traen hora).
 * Pide mayoría clara para no convertir en fecha una columna de códigos.
 */
export function tipoDeFechas(valores: ValorCelda[]): TipoFecha | null {
  let conValor = 0;
  let fechas = 0;
  let conHora = 0;
  for (const v of valores) {
    if (v === null || v === undefined || v === '') continue;
    conValor++;
    const f = aFecha(v);
    if (!f) continue;
    fechas++;
    if (f.getHours() || f.getMinutes() || f.getSeconds()) conHora++;
  }
  if (conValor < 2 || fechas / conValor < 0.8) return null;
  return conHora ? 'fecha-hora' : 'fecha';
}

const dos = (n: number) => String(n).padStart(2, '0');

/** Escribe la fecha con el formato elegido (y la hora si la columna la trae). */
export function escribirFecha(f: Date, formato: FormatoFecha, tipo: TipoFecha): string {
  const d = dos(f.getDate());
  const m = dos(f.getMonth() + 1);
  const a = f.getFullYear();
  const dia = formato === 'mm/dd/aaaa' ? `${m}/${d}/${a}`
    : formato === 'aaaa-mm-dd' ? `${a}-${m}-${d}`
      : `${d}/${m}/${a}`;
  return tipo === 'fecha-hora' ? `${dia} ${dos(f.getHours())}:${dos(f.getMinutes())}` : dia;
}

/** Valor para un `<input type="date">` / `datetime-local`. */
export function paraInput(f: Date, tipo: TipoFecha): string {
  const dia = `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`;
  return tipo === 'fecha-hora' ? `${dia}T${dos(f.getHours())}:${dos(f.getMinutes())}` : dia;
}

/**
 * Extremo del rango en milisegundos. Sin hora, «desde» arranca a las 00:00 y
 * «hasta» termina a las 23:59:59.999, que es lo que espera quien filtra por día.
 */
export function limiteDelRango(iso: string | null | undefined, extremo: 'desde' | 'hasta'): number | null {
  if (!iso) return null;
  const m = ISO.exec(iso);
  if (!m) return null;
  const [, a, mes, d, h, mi] = m;
  const conHora = h !== undefined;
  if (extremo === 'desde') return new Date(+a, +mes - 1, +d, conHora ? +h : 0, conHora ? +mi : 0, 0, 0).getTime();
  return new Date(+a, +mes - 1, +d, conHora ? +h : 23, conHora ? +mi : 59, conHora ? 0 : 59, conHora ? 0 : 999).getTime();
}
