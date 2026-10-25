import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';

import { environment } from '@/environments/environment';
import { isOfflineQueued } from '@/app/core/utils/offline-response';

/** Los ocho checks que devuelve la IA (contrato de ms-hr). */
export type CheckFoto =
  | 'un_rostro'
  | 'rostro_centrado'
  | 'de_frente'
  | 'ojos_abiertos'
  | 'fondo_blanco'
  | 'iluminacion'
  | 'nitidez'
  | 'sin_gafas_oscuras_ni_gorra';

export const CHECKS_FOTO: readonly CheckFoto[] = [
  'un_rostro', 'rostro_centrado', 'de_frente', 'ojos_abiertos',
  'fondo_blanco', 'iluminacion', 'nitidez', 'sin_gafas_oscuras_ni_gorra',
];

/**
 * Respuesta de `POST /gestion_contratacion/biometria/foto/validar`.
 *
 * `disponible=false` = la IA no respondió (caída, sin configurar, timeout, sin
 * red): NO es un rechazo, y la foto se puede usar igual.
 */
export interface ValidacionFotoIa {
  disponible: boolean;
  apta: boolean | null;
  puntaje: number | null;
  motivos: string[];
  checks: Partial<Record<CheckFoto, boolean>>;
  modelo: string | null;
}

export const IA_NO_DISPONIBLE: ValidacionFotoIa = Object.freeze({
  disponible: false,
  apta: null,
  puntaje: null,
  motivos: [],
  checks: {},
  modelo: null,
}) as ValidacionFotoIa;

/**
 * Lee la respuesta sin fiarse de su forma. Cualquier cosa rara —cuerpo vacío,
 * la respuesta simulada de la cola offline, `apta` que no es booleano— se
 * trata como "IA no disponible", que deja continuar: un contrato roto no puede
 * dejar a nadie sin foto.
 */
export function normalizarValidacion(body: unknown): ValidacionFotoIa {
  if (!body || typeof body !== 'object' || isOfflineQueued(body)) return IA_NO_DISPONIBLE;
  const b = body as Record<string, unknown>;
  const apta = b['apta'];
  if (b['disponible'] !== true || typeof apta !== 'boolean') return IA_NO_DISPONIBLE;

  const checks: Partial<Record<CheckFoto, boolean>> = {};
  const crudoChecks = b['checks'];
  const crudos = (crudoChecks && typeof crudoChecks === 'object' ? crudoChecks : {}) as Record<string, unknown>;
  for (const c of CHECKS_FOTO) {
    const v = crudos[c];
    if (typeof v === 'boolean') checks[c] = v;
  }
  const crudoMotivos = b['motivos'];
  const motivos = Array.isArray(crudoMotivos)
    ? crudoMotivos.filter((m): m is string => typeof m === 'string' && !!m.trim()).map((m) => m.trim())
    : [];
  const crudoPuntaje = b['puntaje'];
  const puntaje = typeof crudoPuntaje === 'number' && isFinite(crudoPuntaje) ? Math.round(crudoPuntaje) : null;
  const modelo = b['modelo'];

  return {
    disponible: true,
    apta,
    puntaje,
    // Rechazada sin explicación: al menos una frase, para que la persona sepa qué hacer.
    motivos: !apta && !motivos.length ? ['La foto no cumple las condiciones de una foto tipo documento'] : motivos,
    checks,
    modelo: typeof modelo === 'string' ? modelo : null,
  };
}

/**
 * ¿La foto quedó bien? Se lo pregunta a la IA de visión (ms-ai, a través de
 * ms-hr). El pedido: "que la IA confirme de que quedó bien y ya puede
 * continuar".
 *
 * Nunca falla: pasados 15 s, sin red o con cualquier error, emite
 * `IA_NO_DISPONIBLE` y el diálogo deja continuar con los chequeos locales.
 */
@Injectable({ providedIn: 'root' })
export class ValidacionFotoIaService {
  private http = inject(HttpClient);
  private url = `${(environment.apiUrl || '').replace(/\/$/, '')}/gestion_contratacion/biometria/foto/validar`;

  static readonly TIEMPO_MAX_MS = 15_000;

  validar(imagenDataUrl: string, numeroDocumento?: string | null): Observable<ValidacionFotoIa> {
    const cuerpo: Record<string, string> = { imagen: imagenDataUrl, origen: 'TESORO' };
    if (numeroDocumento) cuerpo['numero_documento'] = String(numeroDocumento);

    return this.http
      .post<unknown>(this.url, cuerpo, {
        // `X-Offline-Sync` saca esta petición de la cola offline (offline.interceptor):
        // sin red, una validación encolada se reproduciría horas después para nadie
        // y aparecería en "envíos pendientes". Sin conexión se responde "no disponible".
        headers: new HttpHeaders({ 'X-Offline-Sync': 'true' }),
      })
      .pipe(
        timeout(ValidacionFotoIaService.TIEMPO_MAX_MS),
        map(normalizarValidacion),
        catchError((e) => {
          console.warn('[foto-ia] No se pudo verificar la foto con IA:', e?.status ?? e?.name ?? e);
          return of(IA_NO_DISPONIBLE);
        }),
      );
  }
}
