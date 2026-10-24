/** Utilidades de fechas y textos de la vista de actividad. */

/** Las fechas del servidor vienen en hora de Bogotá sin zona: se leen como -05:00 aunque el equipo tenga otra zona. */
export function fecha(iso: string | null | undefined): Date {
  if (!iso) return new Date(NaN);
  const s = String(iso);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) || !s.includes('T') ? s : s + '-05:00');
}

export function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isoDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 'hoy' | '7' | '30' | '90' → rango de fechas (incluye hoy). */
export function rangoDe(clave: string): { desde: string; hasta: string } {
  const hasta = new Date();
  const dias = clave === 'hoy' ? 0 : Number(clave) - 1;
  const desde = new Date(hasta.getTime() - dias * 86400000);
  return { desde: isoDe(desde), hasta: isoDe(hasta) };
}

export function hace(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = fecha(iso);
  if (isNaN(d.getTime())) return '—';
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dias = Math.round(h / 24);
  if (dias < 30) return `hace ${dias} d`;
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = fecha(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function hora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = fecha(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function duracion(min: number | null | undefined): string {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60 ? (min % 60) + ' min' : ''}`.trim();
}

export const TIPOS_ACCION: Record<string, { texto: string; icono: string; tono: string }> = {
  ACCESO: { texto: 'Acceso', icono: 'login', tono: 'info' },
  CONSULTA: { texto: 'Consulta', icono: 'visibility', tono: 'neutro' },
  CREACION: { texto: 'Creación', icono: 'add_circle', tono: 'ok' },
  EDICION: { texto: 'Edición', icono: 'edit', tono: 'aviso' },
  BORRADO: { texto: 'Borrado', icono: 'delete', tono: 'peligro' },
  NAVEGACION: { texto: 'Pantalla', icono: 'web', tono: 'neutro' },
  COMUNICACION: { texto: 'Comunicación', icono: 'forum', tono: 'violeta' },
  OTRO: { texto: 'Otro', icono: 'bolt', tono: 'neutro' },
};
