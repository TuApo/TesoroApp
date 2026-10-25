import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';
import { NetworkStatusService } from './network-status.service';
import { PermissionsService } from './permissions.service';
import { tokenVigente } from '../utils/sesion-vigente';

/**
 * Precarga los datos del pipeline de contratación para uso offline.
 *
 * Solo corre para usuarios con permiso de lectura sobre el modulo SELECCION,
 * ya que la info precargada unicamente la consume esa vista.
 *
 * Flujo:
 * 1. Llama a candidatos-tabla/ para obtener la lista de cédulas activas en el pipeline.
 * 2. Para cada candidato NO rechazado y NO contratado, precarga:
 *    - Datos completos del candidato (by-document?full=1)
 *    - Biometría
 *    - Documentos de examen médico (type=32)
 *    - Documentos ARL (type=30)
 *    - Historial de procesos (by-document-min)
 * 3. Cada respuesta se cachea automáticamente por el offlineInterceptor.
 */
@Injectable({ providedIn: 'root' })
export class PipelinePreloadService {
  private isPreloading = false;
  private base = `${(environment.apiUrl || '').replace(/\/$/, '')}/gestion_contratacion`;
  private docBase = `${(environment.apiUrl || '').replace(/\/$/, '')}/gestion_documental`;

  private readonly http = inject(HttpClient);
  private readonly networkService = inject(NetworkStatusService);
  private readonly permissions = inject(PermissionsService);

  constructor() {
    this.networkService.isOnline$.subscribe(isOnline => {
      if (isOnline) {
        // Esperar unos segundos para que el syncQueue() termine primero
        setTimeout(() => this.preloadPipelineData(), 5000);
      }
    });
  }

  async preloadPipelineData(): Promise<void> {
    if (this.isPreloading || !this.networkService.isOnline) return;
    // Sin sesión o con el token vencido no se pide nada: un 401 borraría la caché offline.
    if (!tokenVigente()) return;

    const rol = this.permissions.getNormalizedRoleName() || '(vacio)';
    console.log(`[Preload] Rol detectado: "${rol}".`);

    if (!this.permissions.canUseSeleccionPipeline()) {
      console.log('[Preload] Usuario sin acceso a SELECCION o rol administrativo. Precarga omitida.');
      return;
    }

    const electron = (window as any).electron;
    if (!electron?.db) return;

    this.isPreloading = true;

    try {
      // 1. Obtener lista de todos los candidatos en el pipeline
      const candidatos: any[] = await firstValueFrom(
        this.http.get<any[]>(`${this.base}/contratacion/candidatos-tabla/`)
      );

      if (!candidatos || !Array.isArray(candidatos)) return;

      // 2. Filtrar solo los que están activos en el pipeline (no contratados, no rechazados)
      //    El endpoint retorna "contratado" como boolean
      const activos = candidatos.filter(c => !c.contratado && c.numero);

      // Deduplicar por número de documento
      const seen = new Set<string>();
      const unicos = activos.filter(c => {
        const doc = String(c.numero).trim();
        if (seen.has(doc)) return false;
        seen.add(doc);
        return true;
      });

      console.log(`[Preload] ${unicos.length} candidatos activos en pipeline. Precargando datos...`);

      // 3. Para cada candidato, precargar los endpoints que usa el recruitment-pipeline
      for (let i = 0; i < unicos.length; i += 2) {
        // Si perdimos conexión durante la precarga, parar
        if (!this.networkService.isOnline) {
          console.warn('[Preload] Conexión perdida. Precarga pausada.');
          break;
        }

        const batch = unicos.slice(i, i + 2);

        await Promise.allSettled(
          batch.flatMap(c => this.preloadCandidate(String(c.numero).trim()))
        );
      }

      console.log('[Preload] Precarga del pipeline completada.');
    } catch (e) {
      console.warn('[Preload] Error en precarga del pipeline:', e);
    } finally {
      this.isPreloading = false;
    }
  }

  /**
   * Precarga todos los datos que el recruitment-pipeline necesita para un candidato.
   * Cada GET pasa por el offlineInterceptor que cachea automáticamente la respuesta.
   */
  private preloadCandidate(cedula: string): Promise<any>[] {
    const safe = encodeURIComponent(cedula);

    return [
      // Datos completos del candidato
      firstValueFrom(
        this.http.get(`${this.base}/candidatos/by-document/${safe}/`, {
          params: { full: '1', include_queue: '1' }
        })
      ).catch(() => null),

      // Biometría
      firstValueFrom(
        this.http.get(`${this.base}/biometria/${safe}/`)
      ).catch(() => null),

      // Documentos de examen médico (type 32)
      firstValueFrom(
        this.http.get(`${this.docBase}/documentos/`, {
          params: { cedula, type: '32' }
        })
      ).catch(() => null),

      // Documentos ARL (type 30)
      firstValueFrom(
        this.http.get(`${this.docBase}/documentos/`, {
          params: { cedula, type: '30' }
        })
      ).catch(() => null),

      // Historial de procesos mini
      firstValueFrom(
        this.http.get(`${this.base}/procesos/by-document-min/`, {
          params: { numero_documento: cedula }
        })
      ).catch(() => null),
    ];
  }
}
