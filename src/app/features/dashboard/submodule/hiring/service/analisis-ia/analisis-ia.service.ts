import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/** Un punto del analisis, siempre con el campo del que sale. */
export interface PuntoAnalisis {
  punto: string;
  evidencia?: string;
}

/** Cargo que la IA propone para la persona, con el porque. */
export interface CargoSugerido {
  cargo?: string;
  porque?: string;
}

/** Lectura de la trayectoria: cuánto dura en los trabajos y con qué cifras se dice. */
export interface EstabilidadLaboral {
  nivel?: 'alto' | 'medio' | 'bajo' | 'sin datos';
  porque?: string;
}

/**
 * Con quién vive, quién responde por los hijos y si sostiene sola/o el hogar.
 *
 * Es informacion de DISPONIBILIDAD —turnos, rutas, madrugadas—, no un juicio
 * sobre la persona: el prompt del analisis lo deja escrito y aqui se rotula
 * igual para que nadie lo lea como un criterio de descarte.
 */
export interface RedDeApoyo {
  resumen?: string;
  evidencia?: string;
}

export interface AnalisisCandidato {
  cedula?: string;
  resumen?: string;
  /** Sugerencia de cargo a partir de experiencia, formacion y entrevista. */
  cargoSugerido?: CargoSugerido;
  estabilidadLaboral?: EstabilidadLaboral;
  redDeApoyo?: RedDeApoyo;
  aFavor?: PuntoAnalisis[];
  enContra?: PuntoAnalisis[];
  riesgos?: PuntoAnalisis[];
  ajusteVacante?: { nivel?: 'alto' | 'medio' | 'bajo'; porque?: string };
  datosQueFaltan?: string[];
  preguntasSugeridas?: string[];
  /** El expediente crudo con el que se produjo el analisis. */
  expediente?: unknown;
}

/**
 * IA sobre la persona que se tiene al frente.
 *
 * El expediente lo arma ms-ai juntando ms-hr, ms-documents y ms-payroll: se
 * pide alla y no aqui para no hacer cinco viajes desde el navegador ni pasear
 * el JWT por todos los servicios.
 */
@Injectable({ providedIn: 'root' })
export class AnalisisIaService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ia/candidatos`;

  /**
   * Analiza al candidato frente a la vacante a la que va.
   * @param vacante datos de la obra remitida; el analisis los usa para el ajuste.
   */
  analizar(cedula: string, vacante?: unknown): Observable<AnalisisCandidato> {
    return this.http.post<AnalisisCandidato>(
      `${this.base}/${encodeURIComponent(cedula)}/analisis`,
      { vacante: vacante ?? null },
    );
  }

  /** Expediente crudo, sin pasar por el modelo. */
  expediente(cedula: string): Observable<unknown> {
    return this.http.get(`${this.base}/${encodeURIComponent(cedula)}/expediente`);
  }
}
