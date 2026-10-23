/** Formatos pequeños que usan varias piezas del módulo. */

const PALETA = ['#2563EB', '#0B6B58', '#B4459E', '#B4720E', '#6D28D9', '#0E7490', '#A33328', '#4D7C0F', '#1E44C8', '#9A3412'];

export function colorDe(id: string | null | undefined): string {
  if (!id) return PALETA[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return PALETA[Math.abs(h) % PALETA.length];
}

export function iniciales(nombre: string | null | undefined): string {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  const a = partes[0][0] ?? '';
  const b = partes.length > 2 ? partes[2][0] : partes.length > 1 ? partes[1][0] : '';
  return (a + b).toUpperCase();
}

export function primerNombre(nombre: string | null | undefined): string {
  return (nombre ?? '').trim().split(/\s+/)[0] ?? '';
}

/** "10:42", "ayer", "lun", "12/09" según qué tan lejos está. */
export function horaCorta(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  if (mismoDia) return d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === ayer.toDateString()) return 'ayer';
  const dias = (hoy.getTime() - d.getTime()) / 86_400_000;
  if (dias < 6) return d.toLocaleDateString('es-CO', { weekday: 'short' });
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' });
}

export function hora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
}

/** Encabezado de día en la lista de mensajes. */
export function etiquetaDia(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return 'Hoy';
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === ayer.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === hoy.getFullYear() ? undefined : 'numeric' });
}

export function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function mmss(ms: number | null | undefined): string {
  const s = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const dd = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dd(m)}:${dd(r)}` : `${dd(m)}:${dd(r)}`;
}

export function duracionLarga(seg: number | null | undefined): string {
  const s = seg ?? 0;
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function iconoAdjunto(clase: string, mime: string): string {
  if (clase === 'ESCANEO') return 'document_scanner';
  if (clase === 'IMAGEN') return 'image';
  if (clase === 'VIDEO') return 'movie';
  if (clase === 'AUDIO') return 'graphic_eq';
  if (mime === 'application/pdf') return 'picture_as_pdf';
  if (/sheet|excel|csv/.test(mime)) return 'table_chart';
  if (/word|document/.test(mime)) return 'description';
  if (/presentation|powerpoint/.test(mime)) return 'slideshow';
  if (/zip|compressed/.test(mime)) return 'folder_zip';
  return 'attach_file';
}

export function idCliente(): string {
  try { return crypto.randomUUID(); } catch { return `c-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

/** Convierte URLs del texto en enlaces, escapando todo lo demás. */
export function textoConEnlaces(texto: string | null | undefined): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const t = esc(texto ?? '');
  return t.replace(/(https?:\/\/[^\s<]+)/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`)
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

/** Autor de los mensajes del asistente de soporte (mismo id que en ms-comunicaciones). */
export const SOPORTE_BOT = '00000000-0000-4000-8000-00000000a51a';

/** Ícono de una conversación que no es una persona: grupos por rango y la línea de soporte. */
export function iconoConversacion(c: { tipo: string; alcance_tipo?: string | null; otro_usuario_id?: string | null }): string | null {
  if (c.tipo === 'SOPORTE') return c.otro_usuario_id === SOPORTE_BOT ? 'support_agent' : 'contact_support';
  switch (c.alcance_tipo) {
    case 'FINCA': return 'agriculture';
    case 'SEDE': return 'apartment';
    case 'EMPRESA': return 'business';
    default: return null;
  }
}

export function etiquetaAlcance(tipo: string | null | undefined): string {
  return ({ FINCA: 'Grupo de la finca', SEDE: 'Grupo de la sede', EMPRESA: 'Grupo de la empresa' } as Record<string, string>)[tipo ?? ''] ?? '';
}

/** "Operaria de cultivo · Finca El Hato": lo que identifica a alguien en el chat. */
export function cargoYLugar(cargo: string | null | undefined, lugar: string | null | undefined): string {
  return [cargo, lugar].filter(x => !!x && x.trim()).join(' · ');
}

/**
 * Texto del asistente con un markdown mínimo y seguro: se escapa todo y solo se
 * reconocen **negritas**, listas con "-" o "1." y enlaces https.
 */
export function textoAsistente(texto: string | null | undefined): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const enLinea = (s: string) => esc(s)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(https:\/\/[^\s<]+)/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  const out: string[] = [];
  let lista: 'ul' | 'ol' | null = null;
  const cerrar = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  for (const linea of (texto ?? '').split('\n')) {
    const vineta = /^\s*[-•*]\s+(.*)$/.exec(linea);
    const numero = /^\s*\d+[.)]\s+(.*)$/.exec(linea);
    if (vineta || numero) {
      const tipo = vineta ? 'ul' : 'ol';
      if (lista !== tipo) { cerrar(); out.push(`<${tipo}>`); lista = tipo; }
      out.push(`<li>${enLinea((vineta ?? numero)![1])}</li>`);
    } else {
      cerrar();
      if (linea.trim()) out.push(`<p>${enLinea(linea)}</p>`);
    }
  }
  cerrar();
  return out.join('');
}

export type NivelActividad = 'en-linea' | 'hoy' | 'semana' | 'antes' | 'nunca';

/**
 * Qué tan activa está una persona en la plataforma, en palabras:
 * "En línea", "Activo hace 5 min", "Activo ayer", "No ha entrado a la plataforma".
 */
export function actividad(enLinea: boolean | null | undefined, ultimaVezMs: number | null | undefined,
                          ahora = Date.now()): { texto: string; corto: string; nivel: NivelActividad } {
  if (enLinea) return { texto: 'En línea', corto: 'En línea', nivel: 'en-linea' };
  if (!ultimaVezMs) return { texto: 'No ha entrado a la plataforma', corto: 'Nunca ha entrado', nivel: 'nunca' };
  const min = Math.max(0, Math.round((ahora - ultimaVezMs) / 60_000));
  const d = new Date(ultimaVezMs);
  const hoy = new Date(ahora);
  const ayer = new Date(ahora); ayer.setDate(hoy.getDate() - 1);
  let hace: string;
  if (min < 1) hace = 'hace un momento';
  else if (min < 60) hace = `hace ${min} min`;
  else if (d.toDateString() === hoy.toDateString()) hace = `hace ${Math.round(min / 60)} h`;
  else if (d.toDateString() === ayer.toDateString()) hace = 'ayer';
  else if (min < 7 * 24 * 60) hace = `el ${d.toLocaleDateString('es-CO', { weekday: 'long' })}`;
  else hace = `el ${d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: d.getFullYear() === hoy.getFullYear() ? undefined : 'numeric' })}`;
  const nivel: NivelActividad = d.toDateString() === hoy.toDateString() ? 'hoy' : min < 7 * 24 * 60 ? 'semana' : 'antes';
  return { texto: `Activo ${hace}`, corto: hace.charAt(0).toUpperCase() + hace.slice(1), nivel };
}
