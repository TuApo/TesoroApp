/** Formatos compartidos del módulo Infraestructura (es-CO, cifras cortas y legibles). */

const NUM = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
const NUM0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

export function num(v: number | null | undefined, decimales = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  return decimales === 0 ? NUM0.format(v) : new Intl.NumberFormat('es-CO', { maximumFractionDigits: decimales }).format(v);
}

/** 1.234 → "1,2 mil", 2.300.000 → "2,3 M". */
export function compacto(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${NUM.format(v / 1e9)} mil M`;
  if (a >= 1e6) return `${NUM.format(v / 1e6)} M`;
  if (a >= 1e4) return `${NUM.format(v / 1e3)} mil`;
  return NUM0.format(v);
}

export function bytes(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${x >= 100 || i === 0 ? NUM0.format(x) : NUM.format(x)} ${u[i]}`;
}

export function bps(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${bytes(v)}/s`;
}

export function pct(v: number | null | undefined, decimales = 0): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${num(v, decimales)} %`;
}

export function ms(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (v >= 1000) return `${NUM.format(v / 1000)} s`;
  return `${NUM0.format(v)} ms`;
}

/** Duración en segundos → "3 d 4 h", "5 h 10 min", "45 s". */
export function duracion(seg: number | null | undefined): string {
  if (seg == null || Number.isNaN(seg)) return '—';
  const s = Math.max(0, Math.round(seg));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d${h ? ` ${h} h` : ''}`;
  if (h > 0) return `${h} h${m ? ` ${m} min` : ''}`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

/** Como duracion() pero con una sola unidad grande: "3 d 4 h", "19 h", "12 min". */
export function duracionCorta(seg: number | null | undefined): string {
  if (seg == null || Number.isNaN(seg)) return '—';
  const s = Math.max(0, Math.round(seg));
  if (s >= 86400) { const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); return h ? `${d} d ${h} h` : `${d} d`; }
  if (s >= 3600) return `${Math.floor(s / 3600)} h`;
  if (s >= 60) return `${Math.floor(s / 60)} min`;
  return `${s} s`;
}

/** Epoch en ms → "hace 3 min" / "hace 2 h" / fecha. */
export function hace(tsMs: number | null | undefined): string {
  if (!tsMs) return '—';
  const s = Math.round((Date.now() - tsMs) / 1000);
  if (s < 10) return 'ahora';
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return fecha(tsMs);
}

export function fecha(tsMs: number | null | undefined, conHora = true): string {
  if (!tsMs) return '—';
  return new Date(tsMs).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', year: conHora ? undefined : 'numeric',
    hour: conHora ? '2-digit' : undefined, minute: conHora ? '2-digit' : undefined,
  });
}

export function hora(tsMs: number): string {
  return new Date(tsMs).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Tono de chip de la tabla estándar para una severidad. */
export function tonoSeveridad(s: string | null | undefined): 'danger' | 'warn' | 'info' | 'ok' | 'neutro' {
  switch (s) {
    case 'critico': return 'danger';
    case 'serio': return 'warn';
    case 'atencion': return 'info';
    case 'ok': return 'ok';
    default: return 'neutro';
  }
}

/** Estado legible de un contenedor (Docker + healthcheck). */
export function estadoContenedor(estado: string, salud?: string | null): { texto: string; tono: 'ok' | 'warn' | 'danger' | 'neutro' | 'info' } {
  if (estado === 'running') {
    if (salud === 'unhealthy') return { texto: 'Enfermo', tono: 'danger' };
    if (salud === 'starting') return { texto: 'Arrancando', tono: 'info' };
    return { texto: 'Activo', tono: 'ok' };
  }
  if (estado === 'restarting') return { texto: 'Reiniciando', tono: 'danger' };
  if (estado === 'exited') return { texto: 'Detenido', tono: 'warn' };
  if (estado === 'dead') return { texto: 'Muerto', tono: 'danger' };
  if (estado === 'paused') return { texto: 'En pausa', tono: 'neutro' };
  return { texto: estado, tono: 'neutro' };
}

export const NOMBRE_CHIP: Record<string, string> = {
  coretemp: 'CPU',
  nvme: 'Disco NVMe',
  jc42: 'Memoria RAM',
  acpitz: 'Placa',
  nouveau: 'GPU',
};
