import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';

import { environment } from '@/environments/environment';

/**
 * Plantillas de disposición de tabla, respaldadas por ms-auth-admin.
 *
 * Antes esto vivía en localStorage (`storageKey` de standard-filter-table): se perdía al
 * cambiar de equipo, no se podía compartir y en un PC compartido todos los usuarios veían
 * la disposición del último que hubiera entrado. El backend resuelve las tres cosas y
 * además permite publicar una plantilla para el resto del equipo.
 */

export type VisibilidadPlantilla = 'PRIVADA' | 'PUBLICA';

/** Una columna dentro de una plantilla. */
export interface ColumnaPlantilla {
  /** Nombre de la columna original. En las columnas vacías es el id generado. */
  name: string;
  visible: boolean;
  width?: string;
  /**
   * Columna VACÍA añadida por el usuario para armar un formato (una casilla que se
   * rellenará a mano tras exportar). No existe en los datos: se pinta vacía y al copiar
   * sale como celda en blanco, que es justo su utilidad.
   */
  vacia?: boolean;
  /** Encabezado propio. Sólo lo llevan las columnas vacías y las renombradas. */
  header?: string;
}

export interface ConfigPlantilla {
  /** Versión del formato, para poder migrar plantillas viejas sin romperlas. */
  v: 1;
  columnas: ColumnaPlantilla[];
}

export interface PlantillaTabla {
  id: string;
  table_key: string;
  nombre: string;
  propietario_id: string;
  visibilidad: VisibilidadPlantilla;
  es_base: boolean;
  /** true si el usuario actual puede editarla o borrarla (es suya). */
  editable: boolean;
  config: string;
  creado_en: string;
  actualizado_en: string;
}

@Injectable({ providedIn: 'root' })
export class TableTemplateService {
  private readonly http = inject(HttpClient);
  private readonly base = `${(environment.apiUrl || '').replace(/\/$/, '')}/gestion_admin/plantillas-tabla`;

  /**
   * Caché por tabla. Varias rejillas de la misma pantalla comparten table_key y no tiene
   * sentido que cada una repita la petición; `shareReplay(1)` la hace una sola vez.
   */
  private cache = new Map<string, Observable<PlantillaTabla[]>>();

  listar(tableKey: string): Observable<PlantillaTabla[]> {
    const cacheada = this.cache.get(tableKey);
    if (cacheada) return cacheada;

    const peticion = this.http
      .get<PlantillaTabla[]>(this.base, { params: new HttpParams().set('table_key', tableKey) })
      .pipe(
        // Que falle el catálogo de plantillas NO puede dejar la tabla sin pintar: se cae
        // a "sin plantillas" y el usuario sigue trabajando con la disposición por defecto.
        catchError(() => of([] as PlantillaTabla[])),
        shareReplay(1),
      );

    this.cache.set(tableKey, peticion);
    return peticion;
  }

  /** Crea o actualiza (el backend hace upsert por nombre dentro de la tabla). */
  guardar(payload: {
    tableKey: string;
    nombre: string;
    config: ConfigPlantilla;
    visibilidad: VisibilidadPlantilla;
    esBase?: boolean;
  }): Observable<PlantillaTabla> {
    return this.http.post<PlantillaTabla>(this.base, {
      table_key: payload.tableKey,
      nombre: payload.nombre,
      visibilidad: payload.visibilidad,
      es_base: !!payload.esBase,
      config: JSON.stringify(payload.config),
    }).pipe(tap(() => this.invalidar(payload.tableKey)));
  }

  marcarBase(tableKey: string, id: string): Observable<PlantillaTabla> {
    return this.http.post<PlantillaTabla>(`${this.base}/${id}/base`, {})
      .pipe(tap(() => this.invalidar(tableKey)));
  }

  eliminar(tableKey: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`)
      .pipe(tap(() => this.invalidar(tableKey)));
  }

  /** La plantilla que debe aplicarse sola al abrir la tabla, si el usuario tiene una. */
  base$(tableKey: string): Observable<PlantillaTabla | null> {
    return this.listar(tableKey).pipe(map(ps => ps.find(p => p.es_base) ?? null));
  }

  /**
   * Deserializa el config. Se hace aquí y con tolerancia porque el config lo escribió una
   * versión anterior del front: una plantilla corrupta o de un formato futuro debe
   * ignorarse, no tumbar la tabla que la iba a aplicar.
   */
  parseConfig(plantilla: PlantillaTabla): ConfigPlantilla | null {
    try {
      const c = JSON.parse(plantilla.config);
      if (!c || c.v !== 1 || !Array.isArray(c.columnas)) return null;
      return c as ConfigPlantilla;
    } catch {
      return null;
    }
  }

  private invalidar(tableKey: string): void {
    this.cache.delete(tableKey);
  }
}
