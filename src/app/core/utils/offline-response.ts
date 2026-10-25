/**
 * Utilidades compartidas para razonar sobre respuestas / requests que pasaron
 * por la cola offline (offline.interceptor.ts + offline-sync.service.ts).
 *
 * Un envío hecho SIN conexión NO llega al servidor: el interceptor lo persiste
 * en SQLite y devuelve un HttpResponse "mock" 200 con marcas `_isOfflineMock` /
 * `offlineQueue`. Los componentes deben distinguir ese caso para no afirmar
 * "subido al servidor" cuando en realidad quedó en cola local.
 */

/**
 * Devuelve true si el body de una respuesta corresponde a un envío que se
 * encoló localmente (no se confirmó contra el backend). Tolerante a null /
 * tipos raros: cualquier cosa que no sea un objeto con las marcas → false.
 */
export function isOfflineQueued(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return b['_isOfflineMock'] === true || b['offlineQueue'] === true;
}

export interface QueuedRequestLabel {
  /** Nombre de icono Material que representa el tipo de operación. */
  icon: string;
  /** Etiqueta legible en español para mostrar al usuario. */
  label: string;
}

/**
 * Traduce (método HTTP + URL) a una etiqueta legible para la UI de la cola.
 * Pensado para el diálogo de "envíos pendientes": el usuario no debería ver
 * `POST /gestion_documental/documentos/` sino "Documento".
 *
 * El match es por substring de la ruta para sobrevivir a query params, ids y
 * a que la URL sea absoluta o relativa.
 */
export function describeQueuedRequest(method: string, url: string): QueuedRequestLabel {
  const u = (url || '').toLowerCase();
  const m = (method || '').toUpperCase();

  if (u.includes('/biometria/upload')) {
    return { icon: 'fingerprint', label: 'Registro biométrico' };
  }
  if (u.includes('/gestion_documental/documentos') || u.includes('/plantillas/excel/documentos/cargar')) {
    return { icon: 'description', label: 'Documento' };
  }
  if (u.includes('/gestion_documental')) {
    return { icon: 'folder', label: 'Gestión documental' };
  }
  if (u.includes('/reportes')) {
    return { icon: 'assessment', label: 'Reporte de contratación' };
  }
  if (u.includes('/seleccion') || u.includes('/preguntas')) {
    return { icon: 'quiz', label: 'Selección / preguntas' };
  }
  if (u.includes('/contratacion') || u.includes('/registro')) {
    return { icon: 'how_to_reg', label: 'Proceso de contratación' };
  }

  // Fallback: verbo + último segmento significativo de la ruta.
  const verbo = m === 'DELETE' ? 'Eliminación' : m === 'PUT' || m === 'PATCH' ? 'Actualización' : 'Envío';
  let segmento = '';
  try {
    const path = u.startsWith('http') ? new URL(u).pathname : u.split('?')[0];
    const parts = path.split('/').filter(Boolean).filter(p => !/^[0-9a-f-]{6,}$/i.test(p));
    segmento = parts.length ? parts[parts.length - 1].replace(/[_-]/g, ' ') : '';
  } catch {
    segmento = '';
  }
  return { icon: 'cloud_upload', label: segmento ? `${verbo}: ${segmento}` : verbo };
}

/**
 * Formatea una antigüedad relativa ("hace 5 min") a partir del timestamp que
 * guarda SQLite (`CURRENT_TIMESTAMP`, en UTC, forma "YYYY-MM-DD HH:MM:SS").
 * Devuelve cadena vacía si no se puede parsear.
 */
export function formatRelativeAge(timestamp: string | null | undefined): string {
  if (!timestamp) return '';
  // SQLite devuelve "2026-06-10 14:30:00" (UTC, sin zona). Normalizamos a ISO.
  const iso = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(timestamp)
    ? timestamp.replace(' ', 'T') + 'Z'
    : timestamp;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'hace un momento';

  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
}
