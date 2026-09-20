import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * TEMPORALES (Apoyo Laboral, Tu Alianza, ...) — ms-hr, `db_hr.afiliacion_temporal_config`.
 *
 * Primer eslabón de la cadena de creación de vacantes.
 *
 * IMPORTANTE: este servicio NO define endpoints nuevos. La API ya existía, creada para
 * la parametrización de plantillas EPS (`PlantillaEpsController`), y aquí simplemente se
 * reutiliza. Se comprobó que `PUT /temporales/{key}` es un UPSERT
 * (`findByTemporalKey().orElseGet(new)`), así que la misma llamada sirve para crear y
 * para editar; no hace falta un POST.
 *
 * OJO con dos cosas del contrato heredado:
 *   1. ms-hr serializa en SNAKE_CASE → los campos llegan como `temporal_key`,
 *      `nombre_display`, `tiene_firma`. No "arreglar" a camelCase.
 *   2. La clave del recurso es `temporal_key` (texto), NO el id numérico.
 *   3. El listado devuelve SOLO LAS ACTIVAS (`findAllByActivaTrue`). Una temporal
 *      desactivada desaparece del listado y no se puede reactivar desde aquí; por eso
 *      esta pantalla no ofrece el toggle de baja.
 */

export interface Temporal {
  id?: number;
  temporal_key: string;
  nombre_display: string;
  nit?: string | null;
  direccion?: string | null;
  email?: string | null;
  /** true si ya tiene imagen cargada; el base64 no viaja en el listado. */
  tiene_firma?: boolean;
  tiene_sello?: boolean;
  activa?: boolean;
  // Datos documentales (ms-hr V60): los imprimen las plantillas de contratación.
  representante_legal_nombre?: string | null;
  representante_legal_tipo_doc?: string | null;
  representante_legal_documento?: string | null;
  direccion_coordinador?: string | null;
  telefono_coordinador?: string | null;
  arl_por_defecto?: string | null;
  ccf_por_defecto?: string | null;
  /** Igual que firma/sello: el data URI no viaja en el listado, solo si existe. */
  tiene_logo_principal?: boolean;
  tiene_logo_carne?: boolean;
  tiene_logo_borde?: boolean;
  tiene_logo_referenciacion?: boolean;
}

/** Cuerpo de `PUT /temporales/{key}`. Las imágenes en null = no tocar. */
export interface TemporalRequest {
  temporal_key: string;
  nombre_display: string;
  nit?: string | null;
  direccion?: string | null;
  email?: string | null;
  firma_imagen?: string | null;
  sello_imagen?: string | null;
  activa?: boolean | null;
  // Datos documentales (V60). OJO, semántica distinta a nit/direccion/email: aquí
  // null u omitido = NO TOCAR y '' = BORRAR. Mandar '' sin querer borra el dato.
  representante_legal_nombre?: string | null;
  representante_legal_tipo_doc?: string | null;
  representante_legal_documento?: string | null;
  direccion_coordinador?: string | null;
  telefono_coordinador?: string | null;
  arl_por_defecto?: string | null;
  ccf_por_defecto?: string | null;
  /** Data URI de cada logo; null = no tocar; '' = quitar. */
  logo_principal?: string | null;
  logo_carne?: string | null;
  logo_borde?: string | null;
  logo_referenciacion?: string | null;
}

@Injectable({ providedIn: 'root' })
export class TemporalesService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl.replace(/\/$/, '')}/gestion_afiliaciones/temporales`;

  /**
   * Por defecto solo las ACTIVAS, que es lo que hace el endpoint heredado y lo que
   * necesitan el selector de Crear Vacante y las plantillas EPS.
   *
   * `incluirInactivas` es para la pantalla de parametrización: sin él, una temporal
   * retirada desaparecía de la tabla y ya no había forma de devolverla, porque el
   * alta y la baja pasan por el mismo PUT.
   */
  listar(incluirInactivas = false): Observable<Temporal[]> {
    const params = incluirInactivas ? { incluirInactivas: true } : {};
    return this.http.get<Temporal[]>(this.base, { params: params as any });
  }

  detalle(key: string): Observable<Temporal> {
    return this.http.get<Temporal>(`${this.base}/${encodeURIComponent(key)}`);
  }

  /**
   * Crea o actualiza. El backend hace upsert por `temporal_key`, así que una clave nueva
   * da de alta y una existente edita. La clave viaja en la URL y en el cuerpo porque el
   * servicio la lee del cuerpo (`req.temporalKey()`).
   */
  guardar(key: string, body: TemporalRequest): Observable<Temporal> {
    return this.http.put<Temporal>(`${this.base}/${encodeURIComponent(key)}`, body);
  }

  /**
   * Clave canónica, replicando lo que se espera del backend: mayúsculas, sin tildes,
   * sin sufijos societarios y separada por guion bajo. Evita que "Tu Alianza S.A.S" y
   * "TU ALIANZA SAS" creen dos temporales distintas — que es exactamente el desorden que
   * ya existe en los datos históricos (83 variantes para 2 temporales reales).
   */
  static normalizarKey(raw: string): string {
    return (raw ?? '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/\b(S\.?A\.?S\.?|S\.?A\.?|LTDA\.?|C\.?I\.?)\b/g, ' ')
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
}
