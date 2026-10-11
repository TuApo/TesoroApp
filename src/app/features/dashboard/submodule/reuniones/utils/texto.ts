/** Utilidades de texto: normalizar para buscar, resaltar coincidencias, iniciales, errores. */

/** Minúsculas, sin tildes y con los espacios colapsados: así se compara lo que se dijo. */
export function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Iniciales para el avatar. Un hablante sin identificar ("Persona 3") se muestra `P3`:
 * dos personas sin nombre no pueden verse iguales.
 */
export function iniciales(nombre: string | null | undefined): string {
  const limpio = (nombre ?? '').trim();
  const persona = /^persona\s+(\d+)$/i.exec(limpio);
  if (persona) return `P${persona[1]}`;
  const partes = limpio.split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  const a = partes[0][0] ?? '';
  const b = partes.length > 2 ? partes[2][0] : partes.length > 1 ? partes[1][0] : '';
  return (a + b).toUpperCase();
}

export function primerNombre(nombre: string | null | undefined): string {
  return (nombre ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Nombre corto para leyendas: el primer nombre, pero "Persona 3" se queda entero. */
export function nombreCorto(nombre: string | null | undefined): string {
  const limpio = (nombre ?? '').trim();
  return /^persona\s+\d+$/i.test(limpio) ? limpio : primerNombre(limpio);
}

export interface Parte {
  texto: string;
  marca: boolean;
}

/**
 * Parte el texto en trozos marcados y sin marcar según la consulta, sin tener en cuenta
 * tildes ni mayúsculas ("decision" encuentra "Decisión"). Se devuelven trozos del texto
 * ORIGINAL: la plantilla los pinta con interpolación, nunca con innerHTML.
 */
export function partirCoincidencias(texto: string, consulta: string): Parte[] {
  const aguja = normalizar(consulta);
  if (!texto || !aguja) return [{ texto: texto ?? '', marca: false }];

  // Texto normalizado carácter a carácter con el índice original de cada carácter.
  let plano = '';
  const origen: number[] = [];
  for (let i = 0; i < texto.length; i++) {
    const n = texto[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s/g, ' ');
    for (const c of n) { plano += c; origen.push(i); }
  }

  const partes: Parte[] = [];
  let cursor = 0;
  let desde = 0;
  while (desde <= plano.length - aguja.length) {
    const pos = plano.indexOf(aguja, desde);
    if (pos < 0) break;
    const ini = origen[pos];
    const fin = origen[pos + aguja.length - 1] + 1;
    if (ini > cursor) partes.push({ texto: texto.slice(cursor, ini), marca: false });
    partes.push({ texto: texto.slice(ini, fin), marca: true });
    cursor = fin;
    desde = pos + aguja.length;
  }
  if (cursor < texto.length) partes.push({ texto: texto.slice(cursor), marca: false });
  return partes.length ? partes : [{ texto, marca: false }];
}

/** ¿El texto contiene la consulta (sin tildes ni mayúsculas)? */
export function contiene(texto: string | null | undefined, consulta: string): boolean {
  const aguja = normalizar(consulta);
  return !!aguja && normalizar(texto).includes(aguja);
}

/**
 * Recorta un segmento largo alrededor de la primera coincidencia, con puntos suspensivos.
 * Un segmento puede durar 40 s: en un resultado de búsqueda sólo importa la frase.
 */
export function fragmentoAlrededor(texto: string, consulta: string, radio = 90): string {
  if (!texto) return '';
  if (texto.length <= radio * 2) return texto;
  const partes = partirCoincidencias(texto, consulta);
  let pos = 0;
  for (const p of partes) {
    if (p.marca) break;
    pos += p.texto.length;
  }
  if (pos >= texto.length) pos = 0;
  let ini = Math.max(0, pos - radio);
  let fin = Math.min(texto.length, pos + radio);
  // No cortar palabras a la mitad.
  if (ini > 0) { const esp = texto.indexOf(' ', ini); if (esp > 0 && esp < pos) ini = esp + 1; }
  if (fin < texto.length) { const esp = texto.lastIndexOf(' ', fin); if (esp > pos) fin = esp; }
  return `${ini > 0 ? '…' : ''}${texto.slice(ini, fin).trim()}${fin < texto.length ? '…' : ''}`;
}

/**
 * Mensaje de error legible a partir de un HttpErrorResponse (o de lo que llegue).
 * Nunca muestra "Http failure response for…": dice qué pasó y qué hacer.
 */
export function mensajeError(e: unknown, porDefecto: string): string {
  const err = e as { status?: number; error?: { error?: string; message?: string; mensaje?: string } | string; message?: string } | null;
  const cuerpo = err?.error;
  if (cuerpo && typeof cuerpo === 'object') {
    const m = cuerpo.error || cuerpo.mensaje || cuerpo.message;
    if (m && typeof m === 'string') return m;
  }
  switch (err?.status) {
    case 0: return 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.';
    case 401: return 'Tu sesión venció. Vuelve a ingresar.';
    case 403: return 'No tienes permiso para hacer esto en esta reunión.';
    case 404: return `${porDefecto}: no se encontró en el servidor.`;
    case 409: return `${porDefecto}: el dato cambió mientras tanto. Recarga e intenta de nuevo.`;
    case 502:
    case 503: return `${porDefecto}: el servicio no está disponible en este momento.`;
  }
  return porDefecto;
}
