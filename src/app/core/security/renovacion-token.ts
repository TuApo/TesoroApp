import { environment } from '../../../environments/environment';

/**
 * Renovación del access token con el refresh token.
 *
 * El access token pasa de 8 h a minutos (fase C del plan de revocación): sin renovar, la persona
 * tendría que volver a entrar cada cuarto de hora. El login guarda el refresh token (7 días) en
 * `refresh_token`; aquí se cambia por un par nuevo en POST /gestion_admin/auth/refresh/. El backend
 * ROTA el refresh en cada uso y revoca el viejo, así que dos renovaciones a la vez con el mismo
 * refresh dejarían a una de las dos con un token revocado. Por eso:
 *  - una sola renovación en vuelo por pestaña (las peticiones que llegan mientras tanto esperan
 *    la misma promesa);
 *  - entre pestañas, un cerrojo de Web Locks: la segunda pestaña, al obtenerlo, ve que la primera
 *    ya dejó un token nuevo en localStorage y lo usa sin volver a renovar.
 *
 * Va con `fetch` y no con HttpClient a propósito: el interceptor lo usa, y pasar la renovación
 * por el propio interceptor la haría renovarse a sí misma. Lo usan también los canales que no
 * pasan por HttpClient (SSE, visor de documentos).
 *
 * Sin refresh token (backend con JWT_REFRESH_ENABLED=false o sesiones de antes) todo esto no hace
 * nada y el comportamiento es el de siempre: al vencer, 401 y al login.
 */

export const CLAVE_REFRESH = 'refresh_token';
const URL_RENOVAR = `${environment.apiUrl}/gestion_admin/auth/refresh/`;
const NOMBRE_CERROJO = 'tuapo-renovar-token';
const TOPE_MS = 10_000;

/** El access token tal como lo guarda el login, SIN esquema. Misma búsqueda que el interceptor. */
export function leerToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    let raw = localStorage.getItem('token') || localStorage.getItem('Authorization');
    if (!raw) {
      const u = localStorage.getItem('user');
      if (u) {
        const user = JSON.parse(u);
        raw = user?.token || user?.jwt || user?.access_token || user?.accessToken || null;
      }
    }
    return raw ? raw.replace(/^Bearer\s+/i, '') : null;
  } catch {
    return null;
  }
}

export function leerRefresh(): string | null {
  try { return localStorage.getItem(CLAVE_REFRESH); } catch { return null; }
}

/** Lo llama el login: guarda el refresh si el backend lo emitió y borra el de una sesión anterior si no. */
export function guardarRefresh(refresh: string | null | undefined): void {
  try {
    if (refresh) localStorage.setItem(CLAVE_REFRESH, refresh);
    else localStorage.removeItem(CLAVE_REFRESH);
  } catch { /* sin storage: no habrá renovación */ }
}

/**
 * true si el JWT vence dentro de `margenSeg`. Un token que no es JWT o no trae `exp` se da por
 * vigente: decide el backend.
 */
export function caduca(jwt: string | null, margenSeg = 30): boolean {
  if (!jwt) return true;
  try {
    const partes = jwt.replace(/^Bearer\s+/i, '').split('.');
    if (partes.length !== 3) return false;
    const carga = JSON.parse(atob(partes[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof carga?.exp !== 'number') return false;
    return carga.exp * 1000 <= Date.now() + margenSeg * 1000;
  } catch {
    return true;
  }
}

/** ¿Hay un refresh token que todavía sirva para renovar? */
export function puedeRenovar(): boolean {
  const r = leerRefresh();
  return !!r && !caduca(r, 0);
}

let enVuelo: Promise<string | null> | null = null;

/**
 * Cambia el refresh por un par nuevo y devuelve el access token nuevo (sin esquema), o null si no
 * se pudo. Nunca lanza.
 */
export function renovarToken(): Promise<string | null> {
  if (!enVuelo) {
    const tokenAntes = leerToken();
    enVuelo = conCerrojo(() => renovar(tokenAntes)).finally(() => { enVuelo = null; });
  }
  return enVuelo;
}

/**
 * El access token listo para usar: el actual si le queda vida, uno renovado si venció y se puede
 * renovar, o el actual tal cual si no (el backend dirá 401). Para los canales que no pasan por
 * el interceptor.
 */
export async function tokenParaUsar(margenSeg = 30): Promise<string | null> {
  const actual = leerToken();
  if (actual && !caduca(actual, margenSeg)) return actual;
  if (!puedeRenovar()) return actual;
  return (await renovarToken()) ?? actual;
}

async function conCerrojo<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  if (!locks?.request) return fn();
  try {
    return await locks.request(NOMBRE_CERROJO, fn);
  } catch {
    return fn();
  }
}

async function renovar(tokenAntes: string | null): Promise<string | null> {
  // Otra pestaña renovó mientras esperábamos el cerrojo: su token ya está guardado.
  const ahora = leerToken();
  if (ahora && ahora !== tokenAntes && !caduca(ahora)) return ahora;

  const refresh = leerRefresh();
  if (!refresh || caduca(refresh, 0)) return null;

  const corte = new AbortController();
  const tope = setTimeout(() => corte.abort(), TOPE_MS);
  try {
    const res = await fetch(URL_RENOVAR, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
      signal: corte.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      // 400/401/403: el refresh no vale (revocado, vencido o de otra clave). Se quita para no
      // reintentar con él en cada petición. Un 5xx o la red caída lo conservan: sirve después.
      if (res.status >= 400 && res.status < 500 && leerRefresh() === refresh) guardarRefresh(null);
      return null;
    }
    const cuerpo = await res.json().catch(() => null);
    const nuevo: string | undefined = cuerpo?.token;
    if (!nuevo) return null;
    try { localStorage.setItem('token', nuevo); } catch { /* sin storage */ }
    // El backend rota el refresh: si no manda uno nuevo, el viejo ya está revocado.
    guardarRefresh(cuerpo?.refresh_token ?? null);
    return nuevo;
  } catch {
    return null;
  } finally {
    clearTimeout(tope);
  }
}
