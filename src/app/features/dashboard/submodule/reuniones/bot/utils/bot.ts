/**
 * Utilidades puras del asistente de reuniones: detectar la plataforma por la URL, estados
 * legibles y fusionar el feed en vivo que llega por cursor.
 */
import { EstadoSesion, Evento, ModoBot, Plataforma } from '../models/bot.model';

export interface PlataformaInfo { etiqueta: string; icono: string; }

export const PLATAFORMAS: Record<Plataforma, PlataformaInfo> = {
  MEET: { etiqueta: 'Google Meet', icono: 'videocam' },
  ZOOM: { etiqueta: 'Zoom', icono: 'video_call' },
  TEAMS: { etiqueta: 'Microsoft Teams', icono: 'groups' },
  WEBEX: { etiqueta: 'Webex', icono: 'duo' },
  JITSI: { etiqueta: 'Jitsi', icono: 'video_chat' },
  WHATSAPP: { etiqueta: 'WhatsApp', icono: 'call' },
  OTRA: { etiqueta: 'Otra', icono: 'public' },
};

export const PLATAFORMAS_CONFIGURABLES: Plataforma[] = ['MEET', 'ZOOM', 'TEAMS', 'WEBEX', 'JITSI', 'OTRA'];

/**
 * Plataforma a partir del enlace. Espejo de la detección del backend: sirve para avisar
 * ANTES de crear la sesión (p. ej. que a WhatsApp el bot no puede entrar).
 * Devuelve null si el texto no parece una URL.
 */
export function detectarPlataforma(url: string | null | undefined): Plataforma | null {
  const t = (url ?? '').trim();
  if (!t) return null;
  let host = '';
  let ruta = '';
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`);
    host = u.hostname.toLowerCase();
    ruta = u.pathname.toLowerCase();
  } catch {
    return null;
  }
  if (!host.includes('.')) return null;
  const es = (d: string) => host === d || host.endsWith(`.${d}`);
  if (es('meet.google.com')) return 'MEET';
  if (es('zoom.us') || es('zoom.com') || es('zoomgov.com')) return 'ZOOM';
  if (es('teams.microsoft.com') || es('teams.live.com') || es('teams.cloud.microsoft')) return 'TEAMS';
  if (es('webex.com')) return 'WEBEX';
  if (es('meet.jit.si') || host.startsWith('jitsi.') || ruta.startsWith('/jitsi')) return 'JITSI';
  if (es('whatsapp.com') || es('wa.me') || es('call.whatsapp.com')) return 'WHATSAPP';
  return 'OTRA';
}

/** Modo sugerido: a WhatsApp (y llamadas) el bot no puede entrar; se captura desde el dispositivo. */
export function modoSugerido(p: Plataforma | null): ModoBot {
  return p === 'WHATSAPP' ? 'CAPTURA' : 'NAVEGADOR';
}

export type Tono = 'neutro' | 'progreso' | 'ok' | 'aviso' | 'error';

export interface EstadoInfo { etiqueta: string; tono: Tono; icono: string; }

export const ESTADOS: Record<EstadoSesion, EstadoInfo> = {
  PENDIENTE_APROBACION: { etiqueta: 'Por aprobar', tono: 'aviso', icono: 'mark_email_unread' },
  PROGRAMADA: { etiqueta: 'Programada', tono: 'neutro', icono: 'event' },
  EN_COLA: { etiqueta: 'En cola', tono: 'progreso', icono: 'autorenew' },
  UNIENDO: { etiqueta: 'Entrando', tono: 'progreso', icono: 'autorenew' },
  SALA_ESPERA: { etiqueta: 'En sala de espera', tono: 'aviso', icono: 'hourglass_top' },
  EN_CURSO: { etiqueta: 'En vivo', tono: 'ok', icono: 'fiber_manual_record' },
  FINALIZANDO: { etiqueta: 'Cerrando', tono: 'progreso', icono: 'autorenew' },
  FINALIZADA: { etiqueta: 'Finalizada', tono: 'neutro', icono: 'check_circle' },
  CANCELADA: { etiqueta: 'Cancelada', tono: 'neutro', icono: 'block' },
  RECHAZADA: { etiqueta: 'No la admitieron', tono: 'error', icono: 'do_not_disturb_on' },
  ERROR: { etiqueta: 'Error', tono: 'error', icono: 'error' },
};

export function estadoInfo(e: EstadoSesion | null | undefined): EstadoInfo {
  return (e && ESTADOS[e]) || { etiqueta: e ?? '—', tono: 'neutro', icono: 'help' };
}

const TERMINALES: ReadonlySet<EstadoSesion> = new Set(['FINALIZADA', 'CANCELADA', 'RECHAZADA', 'ERROR']);
const VIVOS: ReadonlySet<EstadoSesion> = new Set(['EN_COLA', 'UNIENDO', 'SALA_ESPERA', 'EN_CURSO', 'FINALIZANDO']);

export function esTerminal(e: EstadoSesion | null | undefined): boolean { return !!e && TERMINALES.has(e); }
export function esVivo(e: EstadoSesion | null | undefined): boolean { return !!e && VIVOS.has(e); }

/**
 * Fusiona un lote nuevo del feed con lo que ya hay. El cursor (`desde`) evita repetidos,
 * pero un reintento tras un error de red puede traer otra vez el mismo lote: se
 * deduplica por id y se mantiene el orden por id (el orden en que ocurrieron).
 */
export function fusionarEventos(actuales: readonly Evento[], nuevos: readonly Evento[]): Evento[] {
  if (!nuevos.length) return actuales as Evento[];
  const porId = new Map<number, Evento>();
  for (const e of actuales) porId.set(e.id, e);
  // Un evento que vuelve (p. ej. una captura que la IA marcó importante) reemplaza al viejo.
  for (const e of nuevos) porId.set(e.id, e);
  return [...porId.values()].sort((a, b) => a.id - b.id);
}

/** Mayor id visto: el próximo `desde`. */
export function ultimoId(eventos: readonly Evento[], previo = 0): number {
  let max = previo;
  for (const e of eventos) if (e.id > max) max = e.id;
  return max;
}

/** El nombre del bot tiene que decir que es un bot (consentimiento de los asistentes). */
export function nombreDiceBot(nombre: string | null | undefined): boolean {
  return /\bbot\b/i.test(nombre ?? '');
}

/**
 * Markdown mínimo y SEGURO para el resumen de la IA: escapa todo el HTML y solo
 * reconoce títulos `#`, viñetas `-`/`*`, negrita `**` y saltos de línea.
 */
export function markdownSimple(md: string | null | undefined): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const lineas = (md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let enLista = false;
  const cerrar = () => { if (enLista) { out.push('</ul>'); enLista = false; } };
  for (const cruda of lineas) {
    const l = cruda.trimEnd();
    const vin = /^\s*[-*]\s+(.*)$/.exec(l);
    const tit = /^(#{1,3})\s+(.*)$/.exec(l);
    if (vin) {
      if (!enLista) { out.push('<ul>'); enLista = true; }
      out.push(`<li>${inline(vin[1])}</li>`);
    } else if (tit) {
      cerrar();
      out.push(`<h4>${inline(tit[2])}</h4>`);
    } else if (!l.trim()) {
      cerrar();
    } else {
      cerrar();
      out.push(`<p>${inline(l)}</p>`);
    }
  }
  cerrar();
  return out.join('');
}

/** ISO local (sin zona) de un `datetime-local` → ISO con zona del navegador. */
export function isoDesdeLocal(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
