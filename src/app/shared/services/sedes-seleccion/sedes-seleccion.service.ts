import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';

import { environment } from '@/environments/environment';
import { UtilityServiceService } from '../utilityService/utility-service.service';
import { clavesFueraDeSeleccion, nombresSedesSeleccion } from '../../utils/sedes-seleccion';

/**
 * Oficinas que Selección ofrece para registros y filtros NUEVOS (pedido #3).
 *
 * `nombres()` pide `GET /gestion_admin/sedes/?seleccion=1` (ms-auth-admin V129: solo
 * `activa = 1 AND opera_seleccion = 1`). Si ese pedido falla, cae al catálogo completo
 * cacheado del utility service y filtra aquí con el mismo flag, para que un formulario
 * no se quede sin oficinas por un error de red.
 */
@Injectable({ providedIn: 'root' })
export class SedesSeleccionService {
  private readonly http = inject(HttpClient);
  private readonly util = inject(UtilityServiceService);
  private readonly url = `${environment.apiUrl.replace(/\/$/, '')}/gestion_admin/sedes/`;

  private cache: Observable<string[]> | null = null;
  private cacheTs = 0;
  private static readonly TTL_MS = 5 * 60_000;

  /** Nombres (tal cual en `db_admin.sede`) de las sedes que Selección ofrece, ordenados. */
  nombres(): Observable<string[]> {
    const ahora = Date.now();
    if (!this.cache || ahora - this.cacheTs > SedesSeleccionService.TTL_MS) {
      this.cacheTs = ahora;
      this.cache = this.http.get<unknown>(this.url, { params: { seleccion: '1' } }).pipe(
        // Se vuelve a filtrar por si responde un backend anterior a V129 (ignora el parámetro).
        map((data) => nombresSedesSeleccion(data)),
        catchError(() =>
          this.util.traerSucursales().pipe(
            map((data) => nombresSedesSeleccion(data)),
            catchError(() => {
              this.cache = null; // un error no se cachea: el próximo interesado reintenta
              return of([] as string[]);
            }),
          ),
        ),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.cache;
  }

  /**
   * Claves normalizadas (`claveOficina`) de las sedes marcadas FUERA de Selección, para
   * esconder filas de listas que no salen del catálogo. Vacío si el catálogo falla.
   */
  clavesFuera(): Observable<Set<string>> {
    return this.util.traerSucursales().pipe(
      map((data) => clavesFueraDeSeleccion(data)),
      catchError(() => of(new Set<string>())),
    );
  }
}
