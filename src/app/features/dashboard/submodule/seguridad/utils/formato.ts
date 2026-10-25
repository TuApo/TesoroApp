/**
 * Formatos del módulo Seguridad (es-CO). Las fechas del backend llegan ISO sin zona y
 * en hora de Bogotá: `new Date('2026-10-11T15:30:00')` las lee como hora local, que es
 * lo correcto en los equipos de la operación (todos en Colombia).
 */
import { Severidad } from '../models/seguridad.models';

export function fecha(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

const F_HORA = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const F_HORA_CORTA = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
const F_FECHA_HORA = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const F_FECHA = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

export function hora(v: string | Date | null | undefined): string { const d = fecha(v); return d ? F_HORA.format(d) : '—'; }
export function horaCorta(v: string | Date | null | undefined): string { const d = fecha(v); return d ? F_HORA_CORTA.format(d) : '—'; }
export function fechaHora(v: string | Date | null | undefined): string { const d = fecha(v); return d ? F_FECHA_HORA.format(d) : '—'; }
export function soloFecha(v: string | Date | null | undefined): string { const d = fecha(v); return d ? F_FECHA.format(d) : '—'; }

/** Segundos → "1:05", "12:30", "1 h 05 min". */
export function cronometro(seg: number): string {
  const s = Math.max(0, Math.floor(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** "hace 3 min", "hace 2 h", "hace 4 d". */
export function hace(v: string | Date | null | undefined, ahora = Date.now()): string {
  const d = fecha(v);
  if (!d) return '—';
  const s = Math.round((ahora - d.getTime()) / 1000);
  if (s < 0) return 'en un momento';
  if (s < 45) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

export function bytes(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: x >= 100 || i === 0 ? 0 : 1 }).format(x)} ${u[i]}`;
}

export function num(v: number | null | undefined, decimales = 0): string {
  if (v == null || Number.isNaN(v)) return '—';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: decimales }).format(v);
}

/** `Date` → valor de `<input type="datetime-local">` (hora local). */
export function aInputFechaHora(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** `Date` → ISO local sin zona (como lo espera el backend: LocalDateTime de Bogotá). */
export function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
/** `<input type="date">` → yyyy-mm-dd de hoy. */
export function hoyInput(): string { return aInputFechaHora(new Date()).slice(0, 10); }

/** Tono de chip por severidad (clases del CSS común: danger, warn, info, neutro). */
export function tonoSeveridad(s: Severidad | null | undefined): 'danger' | 'warn' | 'info' | 'neutro' {
  switch (s) {
    case 'CRITICA': case 'ALTA': return 'danger';
    case 'MEDIA': return 'warn';
    case 'BAJA': return 'info';
    default: return 'neutro';
  }
}

/** Descarga un Blob con un nombre de archivo. */
export function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Copia al portapapeles; devuelve si se pudo. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; }
  catch {
    try {
      const t = document.createElement('textarea');
      t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    } catch { return false; }
  }
}
