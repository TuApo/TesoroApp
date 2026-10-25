import { EstadoHilo, HiloResumen, TipoCompromiso } from './bandeja.models';

/** Textos y tonos de la Bandeja, en un solo lugar. */

/** Las fechas del servidor vienen en hora de Bogotá sin zona: se leen como -05:00 aunque el equipo tenga otra zona. */
export function fecha(iso: string | null | undefined): Date {
  if (!iso) return new Date(NaN);
  const s = String(iso);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) || !s.includes('T') ? s : s + '-05:00');
}

export const ESTADOS_HILO: Record<EstadoHilo, { texto: string; tono: string; icono: string }> = {
  POR_RESPONDER: { texto: 'Por responder', tono: 'peligro', icono: 'reply' },
  ESPERANDO: { texto: 'Esperando respuesta', tono: 'aviso', icono: 'hourglass_top' },
  AL_DIA: { texto: 'Al día', tono: 'ok', icono: 'check_circle' },
  RESUELTO: { texto: 'Resuelto', tono: 'ok', icono: 'task_alt' },
  ARCHIVADO: { texto: 'Archivado', tono: 'neutro', icono: 'archive' },
};

export const TIPOS_COMPROMISO: Record<TipoCompromiso, { texto: string; corto: string; icono: string }> = {
  SOLICITUD: { texto: 'Me pidieron', corto: 'Le pidieron', icono: 'assignment_late' },
  MIO: { texto: 'Me comprometí', corto: 'Prometió', icono: 'handshake' },
  DEL_CONTACTO: { texto: 'Me prometieron', corto: 'Le deben', icono: 'schedule_send' },
};

export const ESTADOS_TAREA: Record<string, string> = {
  TODO: 'Por hacer', IN_PROGRESS: 'En progreso', BLOCKED: 'Bloqueada', DONE: 'Completada', ELIMINADA: 'Eliminada',
};

export function iconoCanal(canal: string | null | undefined): string {
  return canal === 'WHATSAPP' ? 'chat' : 'mail';
}

export function tituloHilo(h: Pick<HiloResumen, 'titulo' | 'asunto' | 'contacto_nombre'> | null | undefined): string {
  if (!h) return '';
  return h.contacto_nombre || h.titulo || h.asunto || 'Sin asunto';
}

/** "hace 5 min", "ayer 3:20 p. m.", "12 oct" — para listas. */
export function cuando(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = fecha(iso);
  if (isNaN(d.getTime())) return '';
  const ahora = new Date();
  const min = Math.round((ahora.getTime() - d.getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const hoy = ahora.toDateString() === d.toDateString();
  const hora = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
  if (hoy) return hora;
  const ayer = new Date(ahora.getTime() - 86400000).toDateString() === d.toDateString();
  if (ayer) return `ayer ${hora}`;
  const mismoAnio = d.getFullYear() === ahora.getFullYear();
  return d.toLocaleDateString('es-CO', mismoAnio ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = fecha(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Tiempo esperando: "3 h", "2 d 4 h". */
export function espera(iso: string | null | undefined): string {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.now() - fecha(iso).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

export function minutosLegibles(min: number | null | undefined): string {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60 ? (min % 60) + ' min' : ''}`.trim();
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export function venceTexto(fecha: string | null | undefined): { texto: string; tono: string } {
  if (!fecha) return { texto: 'Sin fecha', tono: 'neutro' };
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const [a, m, d] = fecha.split('-').map(Number);
  const f = new Date(a, m - 1, d);
  const dias = Math.round((f.getTime() - hoy.getTime()) / 86400000);
  if (dias < 0) return { texto: `Venció hace ${-dias} d`, tono: 'peligro' };
  if (dias === 0) return { texto: 'Vence hoy', tono: 'aviso' };
  if (dias === 1) return { texto: 'Vence mañana', tono: 'aviso' };
  return { texto: `Vence ${f.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })}`, tono: 'neutro' };
}

export function escapar(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Abrir el chat de WhatsApp o el correo con la respuesta sugerida ya escrita (lo envía la persona desde su app). */
export function enlaceResponder(h: HiloResumen, texto: string, correo: string | null): string | null {
  if (h.canal === 'WHATSAPP') {
    const num = (h.clave_externa ?? '').split('@')[0].replace(/\D/g, '');
    if (!num || h.es_grupo) return null;
    return `https://wa.me/${num}?text=${encodeURIComponent(texto)}`;
  }
  if (!correo) return null;
  const asunto = h.asunto ? (/^re:/i.test(h.asunto) ? h.asunto : `Re: ${h.asunto}`) : '';
  return `mailto:${encodeURIComponent(correo)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(texto)}`;
}
