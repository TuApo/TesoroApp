import {
  HttpInterceptorFn,
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpErrorResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, EMPTY, from, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { environment } from '../../../environments/environment';
import { caduca, puedeRenovar, renovarToken } from '../security/renovacion-token';

const API_BASE = environment.apiUrl;
const API_ORIGIN = new URL(API_BASE).host;

// 🔓 RUTAS PÚBLICAS (¡con "/" inicial!)
// Rutas del API que se llaman SIN sesión: el login y todo lo que cuelga de /api/v1/public/
// (televisor de sala, tomar turno por QR y seguimiento desde el celular). Sin esto, el
// interceptor descartaba la petición y mandaba al login: la pantalla pública solo servía
// en un navegador con sesión iniciada.
const PUBLIC_PATHS = ['/gestion_admin/auth/login/', '/api/v1/public/'];

// Login, refresh y logout no se renuevan: renovar para cerrar sesión gastaría un refresh en
// balde, y un 401 del propio refresh no debe intentar renovarse con él.
const SIN_RENOVAR = '/gestion_admin/auth/';

// Prefijo del header Authorization. Si tu backend requiere otro esquema,
// cambia a 'Token' o deja '' si NO usa prefijo.
const AUTH_SCHEME = 'Bearer';

function normalizeUrl(url: string): URL | null {
  try {
    // Resolvemos las URLs relativas contra el ORIGEN DEL DOCUMENTO (donde el
    // navegador realmente las envía), NO contra API_BASE. Con API_BASE, una
    // ruta relativa a un estático propio (p.ej. './util/colombia.json') se
    // resolvía a api.tuapo.co → se clasificaba como petición de API → se le
    // adjuntaba el header Authorization (JWT > 8 KB) y el nginx del frontend
    // respondía 400 (large_client_header_buffers). Las URLs absolutas de la
    // API no se ven afectadas: una URL absoluta ignora la base.
    const base = (typeof window !== 'undefined' && window.location)
      ? window.location.origin
      : API_BASE;
    return new URL(url, base);
  } catch { return null; }
}

function isPublicPath(pathname: string): boolean {
  // Acepta exacto o con/ sin slash final
  return PUBLIC_PATHS.some(p => pathname === p || pathname === p.replace(/\/$/, '') || pathname.startsWith(p));
}

function getTokenSafe(): string | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
  try {
    let raw = localStorage.getItem('token') || localStorage.getItem('Authorization');
    if (!raw) {
      const u = localStorage.getItem('user');
      if (u) {
        const user = JSON.parse(u);
        raw = user?.token || user?.jwt || user?.access_token || user?.accessToken || null;
      }
    }
    if (!raw) return null;
    // Añade el esquema si hace falta. El back Spring (commons JwtAuthenticationFilter)
    // exige "Bearer "; sin prefix devuelve 403.
    return AUTH_SCHEME ? (raw.startsWith(`${AUTH_SCHEME} `) ? raw : `${AUTH_SCHEME} ${raw}`) : raw;
  } catch {
    return null;
  }
}

export const interceptor: HttpInterceptorFn = (
  req: HttpRequest<any>,
  next: HttpHandlerFn
): Observable<HttpEvent<any>> => {

  const router = inject(Router);
  const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

  const u = normalizeUrl(req.url);
  if (!u) return next(req);

  const isApiRequest = u.host === API_ORIGIN || u.href.startsWith(API_BASE);
  const isPublic = isPublicPath(u.pathname);

  // 🚫 SSR: no dispares peticiones protegidas
  if (!isBrowser && isApiRequest && !isPublic) {
    return EMPTY;
  }

  let working = req;
  const protegida = isBrowser && isApiRequest && !isPublic;
  let token: string | null = null;

  // 🔐 Protegidas: requieren token
  if (protegida) {
    token = getTokenSafe();
    if (!token) {
      // No envíes la solicitud; redirige al login
      router.navigateByUrl('/');
      return EMPTY;
    }
    // Solo forzar Accept: application/json cuando el caller espera JSON.
    // Para blob/arraybuffer/text, dejar que el caller decida (o el server negocie).
    if (working.responseType === 'json' && !working.headers.has('Accept')) {
      working = working.clone({ setHeaders: { Accept: 'application/json' } });
    }
  }

  // Content-Type JSON solo cuando aplica (no multipart/binario)
  const method = working.method.toUpperCase();
  const hasBodyMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const hasCT = working.headers.has('Content-Type');
  const body = working.body;

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const isBlob = typeof Blob !== 'undefined' && body instanceof Blob;
  const isArrayBuffer = typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer;

  if (isApiRequest && hasBodyMethod && !hasCT && !isFormData && !isBlob && !isArrayBuffer) {
    working = working.clone({ setHeaders: { 'Content-Type': 'application/json' } });
  }

  const conToken = (t: string | null) =>
    t ? working.clone({ setHeaders: { Authorization: conEsquema(t) } }) : working;
  const renovable = protegida && !u.pathname.startsWith(SIN_RENOVAR);

  // Manejo centralizado de 401 → limpiar y mandar al login
  // 403 = autenticado pero sin permisos (NO desloguear)
  const manejar401 = (err: any): Observable<never> => {
      // Las rutas públicas (/api/v1/public/: parlante en quiosco, acuse de alarma, televisor de
      // turnos) traen su propio token: un 401 ahí es un enlace vencido, no una sesión vencida,
      // y no debe borrar la sesión ni mandar al login.
      if (isApiRequest && !isPublic && err instanceof HttpErrorResponse && err.status === 401) {
        try { localStorage.removeItem('token'); } catch { }
        // La caché se borra aquí abajo: sin quitar esta marca, los catálogos se darían por
        // "al día" al volver a entrar y faltarían offline hasta 6 h (catalog-preload).
        try { localStorage.removeItem('catalogPreload:lastRun'); } catch { }
        // En 401 limpiamos SOLO el cache de GETs (puede contener PII de la
        // sesión anterior). La cola de mutaciones pendientes NO se borra:
        // pertenece al usuario y debe sobrevivir al re-login del mismo
        // usuario. El sync service filtra por user_id al reproducir, así que
        // si entra un usuario distinto sus mutaciones no se ejecutarán con
        // el token equivocado. Antes este 401 borraba la cola entera y
        // causaba pérdida de datos cada vez que el token expiraba.
        const electronApi = (typeof window !== 'undefined' ? (window as any).electron : null);
        const clearPromise: Promise<any> = electronApi?.db?.clearCache
          ? electronApi.db.clearCache().catch(() => null)
          : Promise.resolve();
        clearPromise.finally(() => router.navigateByUrl('/'));
      }
      return throwError(() => err);
  };

  // Envío con renovación: un 401 con refresh disponible se renueva UNA vez y se reintenta con el
  // token nuevo. El 401 por token lo da el filtro de seguridad (gateway o MS) antes de ejecutar
  // nada, así que reintentar un POST no lo duplica. Solo si la renovación falla (o el reintento
  // vuelve a dar 401) se cierra la sesión.
  const enviar = (t: string | null): Observable<HttpEvent<any>> =>
    next(conToken(t)).pipe(
      catchError((err: any) => {
        if (renovable && err instanceof HttpErrorResponse && err.status === 401 && puedeRenovar()) {
          return from(renovarToken()).pipe(
            switchMap((nuevo) => nuevo
              ? next(conToken(nuevo)).pipe(catchError(manejar401))
              : manejar401(err)),
          );
        }
        return manejar401(err);
      }),
    );

  // Token vencido (o a punto) y se puede renovar: se renueva ANTES de enviar, en vez de gastar
  // una petición en un 401 seguro.
  if (renovable && caduca(token) && puedeRenovar()) {
    return from(renovarToken()).pipe(switchMap((nuevo) => enviar(nuevo ?? token)));
  }
  return enviar(token);
};

function conEsquema(t: string): string {
  return AUTH_SCHEME ? (t.startsWith(`${AUTH_SCHEME} `) ? t : `${AUTH_SCHEME} ${t}`) : t;
}
