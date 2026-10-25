import { utc } from './alerta-nuevos';

/** Hoy en Bogotá como yyyy-MM-dd. */
export function hoyBogota(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function sumarDias(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "jue 16 oct" a partir de yyyy-MM-dd. */
export function diaCorto(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Chip de la fecha de compromiso: vencido, hoy, mañana o el día. */
export function compromiso(fecha: string | null | undefined): { texto: string; tono: 'vencido' | 'hoy' | 'manana' | 'ok' } | null {
  if (!fecha) return null;
  const f = fecha.slice(0, 10), hoy = hoyBogota();
  if (f < hoy) return { texto: 'Vencido: era para el ' + diaCorto(f), tono: 'vencido' };
  if (f === hoy) return { texto: 'Entregar hoy', tono: 'hoy' };
  if (f === sumarDias(hoy, 1)) return { texto: 'Entregar a más tardar mañana', tono: 'manana' };
  return { texto: 'Entregar a más tardar el ' + diaCorto(f), tono: 'ok' };
}

/** "jue 16 oct, 2:00 p. m. a 4:00 p. m." desde programado_en / programado_hasta (UTC sin zona). */
export function franjaAcordada(desde: string | null | undefined, hasta: string | null | undefined): string | null {
  const d = utc(desde), h = utc(hasta);
  if (!d) return null;
  const fd = new Date(d), opts: Intl.DateTimeFormatOptions = { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' };
  const dia = fd.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'short', day: 'numeric', month: 'short' });
  return `${dia}, ${fd.toLocaleTimeString('es-CO', opts)}${h ? ' a ' + new Date(h).toLocaleTimeString('es-CO', opts) : ''}`;
}

/** Los próximos días de entrega (sin domingos) desde hoy, para escoger rápido. */
export function proximosDias(n = 6, conSabado = true): string[] {
  const out: string[] = [];
  let d = hoyBogota();
  while (out.length < n) {
    const dia = new Date(d + 'T12:00:00Z').getUTCDay();
    if (dia !== 0 && (conSabado || dia !== 6)) out.push(d);
    d = sumarDias(d, 1);
  }
  return out;
}

export const FRANJAS: { etiqueta: string; desde: string; hasta: string }[] = [
  { etiqueta: '8 a 10 a. m.', desde: '08:00', hasta: '10:00' },
  { etiqueta: '10 a 12 m.', desde: '10:00', hasta: '12:00' },
  { etiqueta: '12 a 2 p. m.', desde: '12:00', hasta: '14:00' },
  { etiqueta: '2 a 4 p. m.', desde: '14:00', hasta: '16:00' },
  { etiqueta: '4 a 6 p. m.', desde: '16:00', hasta: '18:00' },
];
