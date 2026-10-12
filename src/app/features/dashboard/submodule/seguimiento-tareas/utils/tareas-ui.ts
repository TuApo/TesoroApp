import { Estado, Prioridad, Tarea, TipoLista } from '../models/tareas.models';

/** Catálogo visual de estados: una sola fuente para chips, columnas y filtros. */
export const ESTADOS: { clave: Estado; etiqueta: string; icono: string; tono: string }[] = [
  { clave: 'TODO', etiqueta: 'Por hacer', icono: 'radio_button_unchecked', tono: 'todo' },
  { clave: 'IN_PROGRESS', etiqueta: 'En progreso', icono: 'timelapse', tono: 'prog' },
  { clave: 'BLOCKED', etiqueta: 'Bloqueada', icono: 'block', tono: 'block' },
  { clave: 'DONE', etiqueta: 'Completada', icono: 'check_circle', tono: 'done' },
];

export const PRIORIDADES: { clave: Prioridad; etiqueta: string; icono: string; tono: string; peso: number }[] = [
  { clave: 'URGENT', etiqueta: 'Urgente', icono: 'priority_high', tono: 'urgente', peso: 4 },
  { clave: 'HIGH', etiqueta: 'Alta', icono: 'keyboard_double_arrow_up', tono: 'alta', peso: 3 },
  { clave: 'MEDIUM', etiqueta: 'Media', icono: 'drag_handle', tono: 'media', peso: 2 },
  { clave: 'LOW', etiqueta: 'Baja', icono: 'keyboard_arrow_down', tono: 'baja', peso: 1 },
];

export const TIPOS_LISTA: { clave: TipoLista; etiqueta: string }[] = [
  { clave: 'TODO', etiqueta: 'Por hacer' },
  { clave: 'IN_PROGRESS', etiqueta: 'En progreso' },
  { clave: 'BLOCKED', etiqueta: 'Bloqueadas' },
  { clave: 'DONE', etiqueta: 'Completadas' },
  { clave: 'UNASSIGNED', etiqueta: 'Libre (no cambia el estado)' },
];

/** Módulo de tickets: quien lo puede leer ve la Mesa de soporte de Seguimiento Tareas. */
export const RUTA_TICKETS = '/dashboard/bug-tickets/tickets';

/** Áreas de la empresa para plantillas y propuestas de la IA. */
export const AREAS_TAREAS = ['General', 'Selección', 'Contratación', 'Afiliaciones', 'Nómina', 'Tesorería', 'Jurídico', 'SST', 'Salud',
  'Marketing', 'Soporte', 'Tecnología', 'Comercial', 'Capacitaciones', 'Gestión de oficinas'];

export const COLORES_TABLERO = ['#2B59F0', '#0d9488', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#475569'];
export const COLORES_ETIQUETA = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];

export function estadoInfo(e: Estado | string | null | undefined) {
  return ESTADOS.find(x => x.clave === e) ?? ESTADOS[0];
}

export function prioridadInfo(p: Prioridad | string | null | undefined) {
  return PRIORIDADES.find(x => x.clave === p) ?? PRIORIDADES[2];
}

const DIA_MS = 86_400_000;

function inicioDia(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export type TonoVencimiento = 'vencida' | 'hoy' | 'pronto' | 'futuro' | 'sin' | 'hecha';

/**
 * Cómo se lee el vencimiento de una tarea, en días calendario de quien mira:
 * "Venció hace 3 días", "Vence hoy", "Mañana", "vie 17 oct".
 */
export function vencimiento(t: Pick<Tarea, 'due_at' | 'status'>, ahora = new Date()): { tono: TonoVencimiento; texto: string; dias: number | null } {
  if (!t.due_at) return { tono: 'sin', texto: 'Sin fecha', dias: null };
  const d = new Date(t.due_at);
  const dias = Math.round((inicioDia(d) - inicioDia(ahora)) / DIA_MS);
  const corto = d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
  if (t.status === 'DONE') return { tono: 'hecha', texto: corto, dias };
  if (dias < 0) return { tono: 'vencida', texto: dias === -1 ? 'Venció ayer' : `Venció hace ${-dias} días`, dias };
  if (dias === 0) return { tono: 'hoy', texto: 'Vence hoy', dias };
  if (dias === 1) return { tono: 'pronto', texto: 'Mañana', dias };
  if (dias <= 7) return { tono: 'pronto', texto: corto, dias };
  return { tono: 'futuro', texto: corto, dias };
}

export type Grupo = 'vencidas' | 'hoy' | 'semana' | 'despues' | 'sin-fecha' | 'hechas';

export const GRUPOS_VENCIMIENTO: { clave: Grupo; titulo: string; icono: string }[] = [
  { clave: 'vencidas', titulo: 'Vencidas', icono: 'running_with_errors' },
  { clave: 'hoy', titulo: 'Para hoy', icono: 'today' },
  { clave: 'semana', titulo: 'Próximos 7 días', icono: 'date_range' },
  { clave: 'despues', titulo: 'Más adelante', icono: 'event' },
  { clave: 'sin-fecha', titulo: 'Sin fecha', icono: 'event_busy' },
  { clave: 'hechas', titulo: 'Completadas recientemente', icono: 'task_alt' },
];

export function grupoVencimiento(t: Tarea, ahora = new Date()): Grupo {
  if (t.status === 'DONE') return 'hechas';
  const v = vencimiento(t, ahora);
  if (v.dias === null) return 'sin-fecha';
  if (v.dias < 0) return 'vencidas';
  if (v.dias === 0) return 'hoy';
  if (v.dias <= 7) return 'semana';
  return 'despues';
}

/** Orden natural dentro de un grupo: lo que vence primero y, a igual fecha, lo más urgente. */
export function compararTareas(a: Tarea, b: Tarea): number {
  const da = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
  const db = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;
  if (da !== db) return da - db;
  return prioridadInfo(b.priority).peso - prioridadInfo(a.priority).peso;
}

/** Fecha del datepicker → ISO a las 17:00 locales (fin de jornada): "vence hoy" no amanece vencida. */
export function aIsoFinDeJornada(d: Date | null | undefined): string | null {
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 17, 0, 0).toISOString();
}

/** Atajos de fecha del formulario: hoy, mañana, viernes, en una semana. */
export function atajosFecha(ahora = new Date()): { etiqueta: string; fecha: Date }[] {
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const sumar = (n: number) => new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + n);
  const hastaViernes = (5 - hoy.getDay() + 7) % 7 || 7;
  return [
    { etiqueta: 'Hoy', fecha: hoy },
    { etiqueta: 'Mañana', fecha: sumar(1) },
    { etiqueta: 'Viernes', fecha: sumar(hastaViernes) },
    { etiqueta: 'En una semana', fecha: sumar(7) },
  ];
}

export function hace(iso: string | null | undefined, ahora = Date.now()): string {
  if (!iso) return '';
  const min = Math.floor((ahora - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function tamano(bytes: number): string {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** Mensaje legible de un error HTTP del backend. */
export function mensajeError(e: any, porDefecto = 'No se pudo completar la acción.'): string {
  const m = e?.error?.error ?? e?.error?.message ?? e?.error?.detail;
  if (typeof m === 'string' && m.trim()) return m;
  if (e?.status === 403) return 'No tienes permiso para esta acción.';
  if (e?.status === 404) return 'El elemento ya no existe.';
  if (e?.status === 409) return 'Otra persona cambió esto al mismo tiempo. Recarga e inténtalo de nuevo.';
  if (e?.status === 0) return 'Sin conexión con el servidor.';
  return porDefecto;
}

/** Nombre legible del módulo de origen de una tarea creada desde otro módulo. */
export function etiquetaOrigen(tipo: string | null | undefined): string {
  const m: Record<string, string> = {
    REUNION: 'Compromiso de reunión',
    COMPROMISO: 'Compromiso',
    TICKET: 'Ticket de soporte',
    SOPORTE: 'Soporte',
    TAREA: 'Subtarea de otra tarea',
  };
  return tipo ? (m[tipo.toUpperCase()] ?? tipo) : '';
}

/**
 * A dónde lleva "Ir al caso" de una tarea que nace de otro módulo. Los tickets abren la Mesa
 * de soporte con ese ticket; el resto usa origen_url, que los módulos guardan relativa a
 * /dashboard (p.ej. `reuniones/12`). Devuelve una URL externa tal cual.
 */
export function rutaDeCaso(t: { origen_tipo?: string | null; origen_ref?: string | null; origen_url?: string | null }): string | null {
  if ((t.origen_tipo ?? '').toUpperCase() === 'TICKET' && /^[0-9a-f-]{36}$/i.test(t.origen_ref ?? '')) {
    return `/dashboard/tareas/soporte?ticket=${t.origen_ref}`;
  }
  const url = t.origen_url;
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith('/') ? url : `/dashboard/${url}`;
}

/** Ícono de Material para un archivo según su tipo. */
export function iconoArchivo(nombre: string | null | undefined, mime?: string | null): string {
  const m = (mime ?? '').toLowerCase();
  const ext = (nombre ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic'].includes(ext)) return 'image';
  if (m.includes('pdf') || ext === 'pdf') return 'picture_as_pdf';
  if (m.startsWith('video/') || ['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return 'movie';
  if (m.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'opus'].includes(ext)) return 'audiotrack';
  if (['xlsx', 'xls', 'xlsm', 'csv', 'ods'].includes(ext) || m.includes('sheet') || m.includes('excel')) return 'table_chart';
  if (['docx', 'doc', 'odt', 'rtf'].includes(ext) || m.includes('word')) return 'description';
  if (['pptx', 'ppt', 'odp'].includes(ext) || m.includes('presentation')) return 'slideshow';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'folder_zip';
  if (['txt', 'md', 'json', 'xml', 'log', 'sql', 'yml', 'yaml', 'html', 'js', 'ts', 'java', 'py'].includes(ext)) return 'article';
  return 'insert_drive_file';
}

/** Cómo se previsualiza un archivo en el visor. */
export type ModoVista = 'imagen' | 'pdf' | 'video' | 'audio' | 'hoja' | 'csv' | 'html' | 'texto' | 'documento' | 'ninguna';

export function modoVista(nombre: string | null | undefined, mime?: string | null): ModoVista {
  const m = (mime ?? '').toLowerCase();
  const ext = (nombre ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'imagen';
  if (m.includes('pdf') || ext === 'pdf') return 'pdf';
  if (m.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (m.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'opus'].includes(ext)) return 'audio';
  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) return 'hoja';
  if (ext === 'csv' || ext === 'tsv' || m.includes('csv')) return 'csv';
  if (['docx', 'pptx'].includes(ext)) return 'documento';
  if (['html', 'htm'].includes(ext) || m.includes('text/html')) return 'html';
  if (m.startsWith('text/') || m.includes('json') || m.includes('xml') ||
      ['txt', 'md', 'json', 'xml', 'log', 'sql', 'yml', 'yaml', 'html', 'htm', 'js', 'ts', 'java', 'py', 'css', 'ini', 'sh'].includes(ext)) return 'texto';
  return 'ninguna';
}
