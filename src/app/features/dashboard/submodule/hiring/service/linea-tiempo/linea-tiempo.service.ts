import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/** Grupo del filtro. Mismo orden en que el backend devuelve `por_tipo`. */
export type TipoEventoLinea =
  | 'SELECCION' | 'PRUEBA' | 'EXAMEN' | 'CONTRATO' | 'VETO' | 'INCAPACIDAD' | 'DATOS';

/** Tono del punto de la línea. */
export type NivelEventoLinea = 'POSITIVO' | 'NEGATIVO' | 'ADVERTENCIA' | 'NEUTRO';

/**
 * Un hito, tal cual lo manda ms-hr (snake_case, nombres fijados en el record
 * `EventoLineaTiempo`).
 *
 * `fecha` llega ya formateada: ISO con offset de Bogotá si tiene hora
 * (`2026-09-24T10:30:00-05:00`) o `yyyy-MM-dd` si es solo un día
 * (`solo_fecha: true`: ingreso, retiro, incapacidad). Un día sin hora NO se
 * pasa por `new Date()`: lo leería como medianoche UTC y lo correría al día
 * anterior.
 */
export interface EventoLineaTiempo {
  fecha: string | null;
  solo_fecha: boolean;
  tipo: TipoEventoLinea;
  /** Hito concreto (ENTREVISTA, NO_APLICA, RETIRO…): decide el ícono. */
  subtipo: string;
  nivel: NivelEventoLinea;
  titulo: string;
  detalle: string | null;
  oficina: string | null;
  usuario: string | null;
  proceso_id: number | null;
  contrato: string | null;
  /** Tabla de la que sale el dato. */
  fuente: string;
}

/** Respuesta de `GET /gestion_contratacion/personas/{cedula}/linea-tiempo`. */
export interface LineaTiempoPagina {
  numero_documento: string;
  nombre: string | null;
  /** false = la cédula no tiene ficha (puede tener vetos o incapacidades igual). */
  encontrado: boolean;
  results: EventoLineaTiempo[];
  /** Hitos que cumplen el filtro. */
  count: number;
  /** Hitos de la persona, sin filtrar. */
  total: number;
  page: number;
  size: number;
  hay_mas: boolean;
  tipos: TipoEventoLinea[];
  /** Conteo por tipo SIN filtrar: alimenta los chips. */
  por_tipo: Partial<Record<TipoEventoLinea, number>>;
  /** Fuentes que no se pudieron leer: el resto sale igual. */
  avisos: string[];
  /** Lo que se deja fuera a propósito (datos de salud, bajas de vetos). */
  notas: string[];
}

/**
 * Línea de tiempo de una persona (pedido #13, Fase 1: solo lectura).
 *
 * Junta en el servidor lo que antes estaba suelto: procesos (un hito por
 * etapa), contratos, vetos, incapacidades, cambios del formulario y ediciones
 * de afiliación.
 */
@Injectable({ providedIn: 'root' })
export class LineaTiempoService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/gestion_contratacion/personas`;

  /**
   * @param tipos vacío = todos
   */
  obtener(
    cedula: string,
    opciones: { page?: number; size?: number; tipos?: readonly TipoEventoLinea[] } = {},
  ): Observable<LineaTiempoPagina> {
    let params = new HttpParams()
      .set('page', String(opciones.page ?? 0))
      .set('size', String(opciones.size ?? 30));
    if (opciones.tipos?.length) params = params.set('tipos', opciones.tipos.join(','));
    const doc = encodeURIComponent(String(cedula ?? '').trim());
    return this.http.get<LineaTiempoPagina>(`${this.base}/${doc}/linea-tiempo`, { params });
  }
}
