import {
  HttpInterceptorFn,
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpErrorResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, EMPTY, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { environment } from '../../../environments/environment';

const API_BASE = environment.apiUrl;
const API_ORIGIN = new URL(API_BASE).host;

// 🔓 RUTAS PÚBLICAS (¡con "/" inicial!)
const PUBLIC_PATHS = ['/gestion_admin/auth/login/'];

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

  // 🔐 Protegidas: requieren token
  if (isBrowser && isApiRequest && !isPublic) {
    const token = getTokenSafe();
    if (!token) {
      // No envíes la solicitud; redirige al login
      router.navigateByUrl('/');
      return EMPTY;
    }
    const headers: Record<string, string> = { Authorization: token };
    // Solo forzar Accept: application/json cuando el caller espera JSON.
    // Para blob/arraybuffer/text, dejar que el caller decida (o el server negocie).
    if (working.responseType === 'json' && !working.headers.has('Accept')) {
      headers['Accept'] = 'application/json';
    }
    working = working.clone({ setHeaders: headers });
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

  // Manejo centralizado de 401 → limpiar y mandar al login
  // 403 = autenticado pero sin permisos (NO desloguear)
  return next(working).pipe(
    catchError((err: any) => {
      if (isApiRequest && err instanceof HttpErrorResponse && err.status === 401) {
        try { localStorage.removeItem('token'); } catch { }
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
    })
  );
};
