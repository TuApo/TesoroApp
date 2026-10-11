/**
 * Formatos de tiempo del módulo. Funciones puras: la transcripción, la línea de tiempo,
 * el acta y las tarjetas cuentan el tiempo igual en todas partes.
 */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const dos = (n: number) => `${n}`.padStart(2, '0');

/**
 * Código de tiempo de la transcripción: `04:12`, o `1:02:03` si pasa de la hora.
 * Negativos y nulos no rompen: `--:--` para "sin dato".
 */
export function reloj(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '--:--';
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${dos(m)}:${dos(s)}`;
}

/**
 * Duración contada como la diría una persona: `38 s`, `12 min`, `1 h 5 min`, `2 h`.
 * Por debajo del minuto se cuentan segundos; por encima, minutos redondeados.
 */
export function duracionHumana(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '0 min';
  const segundos = Math.round(ms / 1000);
  if (segundos < 60) return `${segundos} s`;
  const minutos = Math.round(ms / 60000);
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * `2026-09-12` → `12 sep 2026`. Una fecha sin hora se lee como fecha LOCAL: con
 * `new Date('2026-09-12')` el navegador la toma en UTC y en Colombia sale el día 11.
 */
export function fechaCorta(iso: FechaApi): string {
  const d = aFecha(iso);
  if (!d) return '';
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Fecha LOCAL de un Date en `YYYY-MM-DD` (toISOString la daría en UTC: de noche, mañana). */
export function fechaLocalIso(d: Date): string {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** `12 sep 2026, 10:42` para marcas de generación. */
export function fechaHora(iso: FechaApi): string {
  const d = aFecha(iso);
  if (!d) return '';
  return `${fechaCorta(iso)}, ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/**
 * Una fecha tal como la manda ms-meetings. NO siempre es texto ISO: el `ObjectMapper`
 * que commons declara para Kafka desplaza al de Spring Boot, así que `LocalDate` sale
 * como `[2026, 9, 27]`, `LocalDateTime` como `[2026, 9, 27, 14, 5, 0, 0]` e `Instant`
 * como segundos de época con decimales (`1790554319.021`). Se aceptan las tres formas.
 */
export type FechaApi = string | number | readonly number[] | null | undefined;

/** Milisegundos de época de una FechaApi (0 si no se puede leer): para ordenar. */
export function marcaDeTiempo(valor: FechaApi): number {
  return aFecha(valor)?.getTime() ?? 0;
}

function aFecha(valor: FechaApi): Date | null {
  if (valor == null || valor === '') return null;
  let d: Date;
  if (Array.isArray(valor)) {
    const [a, m = 1, dia = 1, h = 0, mi = 0, s = 0, nanos = 0] = valor as number[];
    if (!Number.isFinite(a)) return null;
    d = new Date(a, m - 1, dia, h, mi, s, Math.floor(nanos / 1e6));
  } else if (typeof valor === 'number') {
    // Por debajo de 1e11 son segundos (Jackson con nanosegundos); si no, milisegundos.
    d = new Date(valor < 1e11 ? valor * 1000 : valor);
  } else if (typeof valor === 'string') {
    const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
    d = soloFecha
      ? new Date(+soloFecha[1], +soloFecha[2] - 1, +soloFecha[3])
      : new Date(valor);
  } else {
    return null;
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Porcentaje legible: `31 %`, `4,5 %` por debajo de 10. */
export function porcentaje(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return '';
  const v = Math.max(0, valor);
  const texto = v < 10 && v % 1 !== 0 ? v.toFixed(1).replace('.', ',') : `${Math.round(v)}`;
  return `${texto} %`;
}
