import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { NetworkStatusService } from './network-status.service';
import { PermissionsService } from './permissions.service';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { getLocalStorageItem } from '../utils/safe-storage';
import { entryHostMatchesCurrent, fromCacheKey } from '../utils/cache-key';
import { puenteOffline } from '../offline/puente-offline';

interface SyncQueueItem {
  id: number;
  method: string;
  url: string;
  body: string | null;
  headers: string | null;
  timestamp: string;
  status: string;
  body_type?: 'json' | 'multipart';
  idempotency_key?: string | null;
  user_id?: string | null;
  last_error?: string | null;
  attempt_count?: number;
}

interface StoredFile {
  id: number;
  field_name: string;
  file_name: string;
  mime_type: string | null;
  stored_path: string;
}

@Injectable({
  providedIn: 'root'
})
export class OfflineSyncService {
  private isSyncing = false;
  private isRefreshing = false;
  public pendingCount$ = new BehaviorSubject<number>(0);
  public failedCount$ = new BehaviorSubject<number>(0);
  public syncProgress$ = new BehaviorSubject<{ current: number; total: number; phase: string } | null>(null);

  private get electron(): any {
    // SQLite en Electron, IndexedDB en navegador y APK: misma interfaz.
    return puenteOffline();
  }

  private readonly http = inject(HttpClient);
  private readonly networkService = inject(NetworkStatusService);
  private readonly permissions = inject(PermissionsService);

  constructor() {
    this.networkService.isOnline$.subscribe(async isOnline => {
      if (isOnline) {
        await this.syncQueue();
        this.refreshCache();
      }
    });

    this.updatePendingCount();
    this.updateFailedCount();
  }

  private getCurrentUserId(): string | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = getLocalStorageItem('user');
      if (!raw) return null;
      const u = JSON.parse(raw);
      return String(u?.numero_de_documento ?? u?.id ?? '') || null;
    } catch {
      return null;
    }
  }

  /**
   * Sincroniza la cola de peticiones pendientes cuando vuelve la conexión.
   * Reenvía cada petición al backend en orden cronológico.
   *
   * Filtra por user_id actual: si en el equipo se logueó otro usuario, sus
   * mutaciones NO se reproducen con el token del nuevo (se quedan pendientes
   * hasta que el dueño re-loguee).
   */
  async syncQueue(): Promise<void> {
    if (this.isSyncing || !this.electron?.db) return;
    this.isSyncing = true;

    try {
      const userId = this.getCurrentUserId();
      // Si no hay sesión, no replayemos nada (evita pegar al backend con
      // requests sin token cuando el usuario está en pantalla de login).
      if (!userId) {
        return;
      }

      const pending: SyncQueueItem[] = await this.electron.db.getPendingRequests({ userId });
      if (!pending || pending.length === 0) return;

      const total = pending.length;
      let synced = 0;
      let failed = 0;

      console.log(`[Sync] Iniciando sincronización de ${total} solicitudes pendientes...`);

      for (const item of pending) {
        this.syncProgress$.next({ current: synced + failed + 1, total, phase: 'sync' });

        try {
          let body: any = null;

          if (item.body_type === 'multipart') {
            // Reconstruir el FormData original: campos no-file desde el JSON
            // del body, y cada File leyendo el binario que persistimos en
            // disco al encolarlo. El Content-Type se omite a propósito: el
            // browser lo regenera con el boundary correcto del nuevo FormData.
            const reconstructed = await this.rebuildFormData(item);
            if (!reconstructed) {
              // Algún archivo desapareció (cleanup, antivirus, usuario borró).
              // No tiene sentido reintentar; marcamos failed con motivo claro.
              const reason = 'Archivos adjuntos no disponibles en disco';
              console.warn(`[Sync] ${reason} para request ${item.id}.`);
              await this.electron.db.markRequestStatus({ id: item.id, status: 'failed', error: reason });
              failed++;
              this.notifyFailed(item, reason);
              continue;
            }
            body = reconstructed;
          } else if (item.body_type === 'json') {
            // Estricto: si la fila se marcó como JSON, debe parsear como JSON.
            // Antes el fallback era usar `item.body` como string crudo, lo que
            // permitía a otro proceso del mismo usuario inyectar bodies
            // arbitrarios editando la DB. Ahora si no parsea, marcamos failed.
            try {
              body = item.body ? JSON.parse(item.body) : null;
            } catch (e) {
              const reason = 'Body JSON corrupto en la cola offline';
              console.warn(`[Sync] ${reason} (id=${item.id}):`, e);
              await this.electron.db.markRequestStatus({ id: item.id, status: 'failed', error: reason });
              failed++;
              this.notifyFailed(item, reason);
              continue;
            }
          } else if (item.body) {
            // Filas pre-v3 sin body_type: parse tolerante (lo que había antes).
            try { body = JSON.parse(item.body); } catch { body = item.body; }
          }

          // X-Offline-Sync evita que el interceptor offline re-encole esta petición si falla.
          // X-Idempotency-Key permite al backend deduplicar replays cuando un crash mid-replay
          // deja la fila sin borrar y al siguiente boot se reproduce (ver E6 en el reporte).
          const headers: Record<string, string> = { 'X-Offline-Sync': 'true' };
          if (item.idempotency_key) headers['X-Idempotency-Key'] = item.idempotency_key;

          // Reescritura de URLs legacy: si la fila se guardó cuando el binario
          // apuntaba a otro host (p. ej. 127.0.0.1:8000 en dev → ahora prod),
          // reemplazamos el host por el actual. Sin esto la fila falla cada
          // boot con ERR_CONNECTION_REFUSED porque el host viejo no existe.
          // Mismo criterio que ya aplicamos al cache en cache-key.ts.
          const effectiveUrl = entryHostMatchesCurrent(item.url)
            ? item.url
            : this.rewriteToCurrentHost(item.url);
          if (effectiveUrl !== item.url) {
            console.log(`[Sync] URL legacy reescrita: ${item.url} → ${effectiveUrl}`);
          }

          const response = await firstValueFrom(
            this.http.request(item.method, effectiveUrl, {
              body,
              headers: new HttpHeaders(headers),
              observe: 'response',
            })
          );

          // Borramos la fila ANTES de la reconciliación: si el evento listener
          // crashea, al menos no re-reproducimos.
          await this.electron.db.deleteRequest(item.id);

          // Reconciliación: emitir el response real para que las features
          // puedan reemplazar el id falso (-fakeId) en sus vistas con el id
          // que devolvió el backend. Esto antes se descartaba.
          try {
            window.dispatchEvent(new CustomEvent('offline-request-synced', {
              detail: {
                queueId: item.id,
                tempId: -item.id,
                method: item.method,
                url: item.url,
                response: response?.body ?? null,
              },
            }));
          } catch { /* noop */ }

          // Invalidar cache de listadores que apuntan al recurso padre.
          // Ej: POST /a/b/c/ → invalida URLs que contienen /a/b/c
          // Ej: PUT /a/b/c/123/ → invalida URLs que contienen /a/b/c/
          await this.invalidateRelatedCache(item.url, item.method).catch(() => null);

          synced++;
        } catch (error: any) {
          const status = error?.status || 0;

          if (status >= 400 && status < 500 && status !== 401) {
            // Error del cliente (datos inválidos, validación cambió, etc.).
            // No se puede reintentar automáticamente; queda en 'failed' con
            // motivo y archivos preservados para que el usuario pueda
            // reintentar manualmente desde la UI o descartar.
            const reason = this.summarizeError(error);
            console.warn(`[Sync] Solicitud ${item.id} falló con ${status}. Marcada como fallida.`);
            await this.electron.db.markRequestStatus({ id: item.id, status: 'failed', error: reason });
            failed++;
            this.notifyFailed(item, reason);
          } else if (status === 401) {
            // Token expirado — pausar sync, el usuario debe re-loguearse
            console.warn('[Sync] Token expirado (401). Sync pausado.');
            break;
          } else {
            // Error de servidor (5xx) o sin red (0) — registrar last_error y
            // bumpear attempt_count para diagnóstico, luego parar e intentar
            // después. La fila SIGUE en 'pending' (no marcamos failed); solo
            // dejamos rastro para que la UI de cola pueda mostrar "X reintentos
            // han fallado, último error: Y" y el usuario sepa que algo va mal
            // aunque no tenga toast.
            const reason = this.summarizeError(error);
            console.warn(`[Sync] Error ${status} en solicitud ${item.id} (${reason}). Se reintentará después.`);
            try {
              await this.electron.db.markRequestStatus({ id: item.id, status: 'pending', error: reason });
              window.dispatchEvent(new CustomEvent('offline-request-stalled', {
                detail: { queueId: item.id, method: item.method, url: item.url, reason },
              }));
            } catch { /* noop, no es crítico */ }
            break;
          }
        }
      }

      if (synced > 0 || failed > 0) {
        console.log(`[Sync] Resultado: ${synced} sincronizadas, ${failed} fallidas de ${total} total.`);
      }
    } finally {
      this.isSyncing = false;
      this.syncProgress$.next(null);
      this.updatePendingCount();
      this.updateFailedCount();
      window.dispatchEvent(new CustomEvent('offline-queue-updated'));
    }
  }

  /**
   * Toma una URL absoluta cuyo host ya no coincide con environment.apiUrl y
   * devuelve la misma ruta apuntando al host actual. Si no se puede parsear,
   * devuelve la URL original (mejor falle ruidoso que silenciosamente).
   *
   * Equivalente del `fromCacheKey` para la cola de mutaciones.
   */
  private rewriteToCurrentHost(legacyUrl: string): string {
    try {
      const u = new URL(legacyUrl);
      return fromCacheKey(u.pathname + u.search + u.hash);
    } catch {
      return legacyUrl;
    }
  }

  private summarizeError(error: any): string {
    try {
      const status = error?.status || 0;
      const msg = error?.error?.detail || error?.error?.message || error?.message || 'Error desconocido';
      return `${status}: ${String(msg).slice(0, 500)}`;
    } catch {
      return 'Error desconocido';
    }
  }

  private notifyFailed(item: SyncQueueItem, reason: string): void {
    try {
      window.dispatchEvent(new CustomEvent('offline-request-failed', {
        detail: {
          queueId: item.id,
          method: item.method,
          url: item.url,
          reason,
          attemptCount: (item.attempt_count || 0) + 1,
        },
      }));
    } catch { /* noop */ }
  }

  /**
   * Invalida entradas del cache que el replay acaba de hacer obsoletas.
   *
   * Heurística simple: para una request de mutación a /a/b/c/[id]/, todas las
   * URLs cacheadas que contengan /a/b/c/ se borran. La próxima vez que el
   * cliente las pida, irán al backend (que ya tiene el cambio) y se re-cachean.
   *
   * Es burda pero correcta: el costo es algunos GETs extra al volver a una
   * vista; el beneficio es no mostrar listas viejas tras una creación o
   * edición offline.
   */
  private async invalidateRelatedCache(url: string, method: string): Promise<void> {
    if (!this.electron?.db?.cacheInvalidatePrefix) return;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) return;

    let pathname: string;
    try {
      const u = new URL(url, 'http://placeholder.local'); // base por si url es relativa
      pathname = u.pathname;
    } catch {
      return;
    }

    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return;

    // Si el último segmento parece un id/uuid, descartarlo para apuntar al
    // padre. Si no, usar el path completo (POST /a/b/c/ → /a/b/c/).
    const last = segments[segments.length - 1];
    const looksLikeId = /^[0-9]+$/.test(last) || /^[0-9a-f-]{8,}$/i.test(last);
    const parentSegments = looksLikeId ? segments.slice(0, -1) : segments;
    if (parentSegments.length === 0) return;

    const prefix = '/' + parentSegments.join('/') + '/';
    try {
      await this.electron.db.cacheInvalidatePrefix(prefix);
    } catch (e) {
      console.warn('[Cache] cacheInvalidatePrefix falló:', e);
    }
  }

  /**
   * Refresca todas las URLs previamente cacheadas con datos frescos del backend.
   * Se ejecuta en segundo plano después de sincronizar la cola.
   */
  async refreshCache(): Promise<void> {
    if (this.isRefreshing || !this.electron?.db) return;
    this.isRefreshing = true;

    try {
      const urls: string[] = await this.electron.db.cacheGetAllUrls();
      if (!urls || urls.length === 0) return;

      // Filtrar URLs que no son endpoints de API (ej: auth_login_password,
      // que se guarda con clave sintetica). Aceptamos tanto entradas nuevas
      // path-only ("/foo/bar/") como legacy absolutas ("http://host/foo/").
      let apiUrls = urls.filter(u => u.startsWith('http') || u.startsWith('/'));

      // Purgar entradas heredadas con host distinto al apiUrl actual. Pasaron
      // a este estado cuando el binario se reconstruyo apuntando a otro host
      // (p. ej. dev -> LAN). Sin esta limpieza, refreshCache las re-emite a
      // un host inalcanzable y los logs se llenan de ERR_CONNECTION_REFUSED.
      const stale = apiUrls.filter(u => u.startsWith('http') && !entryHostMatchesCurrent(u));
      if (stale.length > 0) {
        await Promise.allSettled(
          stale.map(u => this.electron.db.cacheInvalidatePrefix(u))
        );
        console.log(`[Cache] ${stale.length} URL(s) con host obsoleto purgadas.`);
        const staleSet = new Set(stale);
        apiUrls = apiUrls.filter(u => !staleSet.has(u));
      }

      // No refrescar URLs del pipeline SELECCION si el usuario no lo consume:
      // roles administrativos o usuarios sin permiso de lectura sobre SELECCION.
      if (!this.permissions.canUseSeleccionPipeline()) {
        const before = apiUrls.length;
        apiUrls = apiUrls.filter(u => !this.permissions.isSeleccionPipelineUrl(u));
        const skipped = before - apiUrls.length;
        if (skipped > 0) {
          console.log(`[Cache] ${skipped} URL(s) del pipeline SELECCION omitidas (usuario sin permiso).`);
        }
      }

      if (apiUrls.length === 0) return;

      // Tope de refresh: refrescar las 50 URLs más recientes (el SELECT del DB
      // ya las devuelve en orden DESC por updated_at). Antes refrescaba TODAS,
      // generando una tormenta de cientos de requests al volver online.
      const REFRESH_LIMIT = 50;
      if (apiUrls.length > REFRESH_LIMIT) {
        apiUrls = apiUrls.slice(0, REFRESH_LIMIT);
      }

      console.log(`[Cache] Refrescando ${apiUrls.length} URLs cacheadas en segundo plano...`);

      const total = apiUrls.length;
      let refreshed = 0;

      // Refrescar en lotes de 3 para no saturar el servidor
      for (let i = 0; i < apiUrls.length; i += 3) {
        // Si perdimos conexión durante el refresh, parar
        if (!this.networkService.isOnline) {
          console.warn('[Cache] Conexión perdida durante refresh. Pausando.');
          break;
        }

        const batch = apiUrls.slice(i, i + 3);
        this.syncProgress$.next({ current: i + 1, total, phase: 'cache' });

        const results = await Promise.allSettled(
          batch.map(url =>
            // Resolver path-only contra el apiUrl actual; entradas legacy con
            // host valido pasan tal cual. Sin fromCacheKey, una entrada "/foo"
            // resolveria al origen del SPA (file://) y no al backend.
            firstValueFrom(this.http.get(fromCacheKey(url))).catch(() => null)
          )
        );

        refreshed += results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
      }

      console.log(`[Cache] Refresh completado: ${refreshed}/${total} URLs actualizadas.`);
    } catch (e) {
      console.warn('[Cache] Error refrescando cache:', e);
    } finally {
      this.isRefreshing = false;
      this.syncProgress$.next(null);
    }
  }

  public async updatePendingCount(): Promise<void> {
    if (this.electron?.db) {
      try {
        const userId = this.getCurrentUserId();
        const pending = await this.electron.db.getPendingRequests({ userId });
        this.pendingCount$.next(pending ? pending.length : 0);
      } catch { }
    }
  }

  public async updateFailedCount(): Promise<void> {
    if (this.electron?.db?.getFailedRequests) {
      try {
        const userId = this.getCurrentUserId();
        const failed = await this.electron.db.getFailedRequests({ userId });
        this.failedCount$.next(failed ? failed.length : 0);
      } catch { }
    }
  }

  /** Permite a la UI listar items fallidos para mostrar al usuario. */
  public async getFailedRequests(): Promise<SyncQueueItem[]> {
    if (!this.electron?.db?.getFailedRequests) return [];
    try {
      const userId = this.getCurrentUserId();
      return await this.electron.db.getFailedRequests({ userId });
    } catch {
      return [];
    }
  }

  /**
   * Lista los envíos en cola que aún NO se han subido (status 'pending') del
   * usuario actual. Lo consume el diálogo "envíos pendientes" para mostrar al
   * usuario QUÉ falta por sincronizar (el badge "9" del chip).
   */
  public async getPendingRequests(): Promise<SyncQueueItem[]> {
    if (!this.electron?.db?.getPendingRequests) return [];
    try {
      const userId = this.getCurrentUserId();
      return await this.electron.db.getPendingRequests({ userId });
    } catch {
      return [];
    }
  }

  /**
   * Devuelve los archivos adjuntos persistidos en disco para una request
   * multipart encolada. La UI lo usa para mostrar los nombres de los archivos
   * que están esperando subir.
   */
  public async getRequestFiles(requestId: number): Promise<StoredFile[]> {
    if (!this.electron?.db?.getRequestFiles) return [];
    try {
      return await this.electron.db.getRequestFiles(requestId);
    } catch {
      return [];
    }
  }

  /**
   * Dispara la sincronización manualmente (botón "Sincronizar ahora").
   * Solo tiene efecto si hay conexión; offline es no-op silencioso.
   */
  public async syncNow(): Promise<void> {
    if (!this.networkService.isOnline) return;
    await this.syncQueue();
    this.refreshCache();
  }

  /**
   * Descarta un envío en cola (pending o failed): borra la fila y sus archivos.
   * Acción destructiva e irreversible — la UI debe confirmar antes de llamar.
   */
  public async discardRequest(id: number): Promise<void> {
    if (!this.electron?.db?.discardRequest) return;
    await this.electron.db.discardRequest(id);
    this.updatePendingCount();
    this.updateFailedCount();
    window.dispatchEvent(new CustomEvent('offline-queue-updated'));
  }

  /** Vuelve a marcar una request fallida como pending y dispara sync si hay red. */
  public async retryFailed(id: number): Promise<void> {
    if (!this.electron?.db?.retryRequest) return;
    await this.electron.db.retryRequest(id);
    this.updateFailedCount();
    this.updatePendingCount();
    if (this.networkService.isOnline) {
      this.syncQueue();
    }
  }

  /** Descarta una request fallida (borra fila + archivos). Acción destructiva. */
  public async discardFailed(id: number): Promise<void> {
    if (!this.electron?.db?.discardRequest) return;
    await this.electron.db.discardRequest(id);
    this.updateFailedCount();
  }

  /**
   * Reconstruye el FormData de una request multipart leyendo los archivos que
   * el interceptor persistió a disco al encolarla. Devuelve null si algún
   * archivo no se puede leer (entonces la request se marca como failed).
   */
  private async rebuildFormData(item: SyncQueueItem): Promise<FormData | null> {
    const fd = new FormData();

    // Campos no-file que se serializaron como JSON.
    if (item.body) {
      try {
        const fields: { name: string; value: string }[] = JSON.parse(item.body);
        if (Array.isArray(fields)) {
          for (const f of fields) fd.append(f.name, f.value);
        }
      } catch (e) {
        console.warn(`[Sync] body JSON corrupto en request ${item.id}:`, e);
      }
    }

    // Files que viven en disco: se leen como base64 y se vuelven a Blob.
    let files: StoredFile[] = [];
    try {
      files = await this.electron.db.getRequestFiles(item.id);
    } catch (e) {
      console.warn(`[Sync] No se pudieron leer files de request ${item.id}:`, e);
      return null;
    }

    for (const f of files) {
      try {
        const res = await this.electron.offline.readUpload(f.stored_path);
        if (!res?.success || !res.base64) {
          console.warn(`[Sync] Archivo perdido para request ${item.id}: ${f.file_name}`);
          return null;
        }
        const blob = this.base64ToBlob(res.base64, f.mime_type || 'application/octet-stream');
        fd.append(f.field_name, blob, f.file_name);
      } catch (e) {
        console.warn(`[Sync] Error leyendo file ${f.file_name}:`, e);
        return null;
      }
    }

    return fd;
  }

  private base64ToBlob(base64: string, mime: string): Blob {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
}
