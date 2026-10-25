import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';

import { EstadoColaAntecedentes } from '../../service/robots/robots.service';
import { enTandas } from './consulta-antecedentes.util';

/** Respuesta de POST /EstadosRobots/asegurar (y de forzar-consulta-antecedentes). */
export interface RespuestaEncolado {
  ok?: boolean;
  /** created | reset | forced → se volverá a consultar; noop | refreshed | force_ya_abierto → no. */
  accion?: string;
  detail?: string;
}

/** Lo que dejó el robot de una cédula (POST /Robots/resultados-antecedentes/lote). */
export interface ResultadoLote {
  tipo_documento?: string | null;
  nombre?: string | null;
  apellido?: string | null;
  departamento?: string | null;
  municipio?: string | null;
  fecha_ultima_modificacion?: string | null;
  /** Veredicto normalizado por fuente (CUMPLE / NO CUMPLE / entidad / categoría) o null. */
  veredictos?: Record<string, string | number | null>;
}

/**
 * Llamadas de Contratación › Consulta de antecedentes. Todo va directo a
 * ms-automation (el gateway rutea /EstadosRobots/** y /Robots/**): la fachada de
 * ms-hr exige que la cédula ya sea candidato, y aquí justamente todavía no lo es.
 */
@Injectable({ providedIn: 'root' })
export class ConsultaAntecedentesService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  /**
   * Encola respetando la regla de frescura de ms-automation: si la cédula se
   * consultó hace menos de 15 días no se vuelve a pedir (no gasta CAPTCHAs ni deja
   * otro PDF en el expediente).
   */
  asegurar(cedula: string, tipo: string, oficina: string | null): Observable<RespuestaEncolado> {
    return this.http.post<RespuestaEncolado>(`${this.api}/EstadosRobots/asegurar/`, {
      numero_documento: cedula,
      tipo_doc: tipo,
      oficina,
      consulta_tag: 'CONSULTA_ANTECEDENTES',
    });
  }

  /** Re-consulta las 8 fuentes aunque la consulta sea reciente. */
  forzar(cedula: string, tipo: string, oficina: string | null): Observable<RespuestaEncolado> {
    return this.http.post<RespuestaEncolado>(`${this.api}/EstadosRobots/forzar-consulta-antecedentes/`, {
      numero_documento: cedula,
      tipo_doc: tipo,
      oficina,
    });
  }

  /** Estado de la cola de muchas cédulas (en tandas de 500). */
  async estados(cedulas: string[]): Promise<Record<string, EstadoColaAntecedentes>> {
    const out: Record<string, EstadoColaAntecedentes> = {};
    for (const t of enTandas(cedulas, 500)) {
      const r = await firstValueFrom(this.http.post<Record<string, EstadoColaAntecedentes>>(
        `${this.api}/EstadosRobots/estados-por-cedulas`, { cedulas: t }));
      Object.assign(out, r ?? {});
    }
    return out;
  }

  /** Nombre, ubicación y veredictos que dejó el robot (en tandas de 500). */
  async resultados(cedulas: string[]): Promise<Record<string, ResultadoLote>> {
    const out: Record<string, ResultadoLote> = {};
    for (const t of enTandas(cedulas, 500)) {
      const r = await firstValueFrom(this.http.post<Record<string, ResultadoLote>>(
        `${this.api}/Robots/resultados-antecedentes/lote/`, { cedulas: t }));
      Object.assign(out, r ?? {});
    }
    return out;
  }
}
