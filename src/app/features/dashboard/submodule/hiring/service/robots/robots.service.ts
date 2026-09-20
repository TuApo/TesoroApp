import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom, Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '@/environments/environment';

@Injectable({
  providedIn: 'root'
})
export class RobotsService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient, @Inject(PLATFORM_ID) private platformId: Object) { }

  private handleError(error: any): Observable<never> {
    throw error;
  }

  // EstadosRobots
  // Método para enviar Estados Robots de forma masiva
  enviarEstadosRobots(datos: any[]): Observable<any> {
    const url = `${this.apiUrl}/EstadosRobots/cargar_excel`; // Ajusta según tu endpoint real

    // Construir el body con JWT y los datos
    const body = {
      datos   // Los datos que quieres enviar al backend
    };

    return this.http.post(url, body, {}).pipe(
      map((response: any) => response),
      catchError(this.handleError)
    );
  }




  /**
   * Resultados que YA consultó el robot para una persona, normalizados a los
   * valores que acepta el formulario de antecedentes.
   *
   * `campos[x].valor === null` significa que el robot no dejó un veredicto
   * interpretable (p.ej. procuraduría en "Consultado", que solo indica que la
   * consulta corrió). Ese caso NO se autocompleta: lo decide una persona.
   */
  getResultadosAntecedentes(cedula: string, tipoDocumento?: string | null): Observable<ResultadosAntecedentes> {
    let params = new HttpParams().set('cedula', cedula);
    if (tipoDocumento) params = params.set('tipo_documento', tipoDocumento);

    return this.http
      .get<ResultadosAntecedentes>(`${this.apiUrl}/Robots/resultados-antecedentes/`, { params })
      .pipe(catchError(this.handleError));
  }

  /**
   * Estado de la COLA de antecedentes de una cédula (las 8 fuentes).
   *
   * Es lo que permite decir "en qué quedó" después de forzar, sin recargar la
   * ficha entera: `forzar-consulta-antecedentes` deja las fuentes en
   * SIN_CONSULTAR y el robot las va resolviendo a FINALIZADO o BLOQUEADO en los
   * segundos siguientes. Se consulta directo a ms-automation (el gateway rutea
   * /EstadosRobots/** ) porque la fachada de ms-hr solo la adjunta dentro del
   * sobre del candidato, y aquí no queremos traernos el candidato entero.
   *
   * Devuelve `null` para una cédula sin fila: no es un error, es "nunca se
   * encoló".
   */
  getEstadoColaAntecedentes(cedula: string): Observable<EstadoColaAntecedentes | null> {
    const doc = (cedula || '').trim();
    return this.http
      .post<Record<string, EstadoColaAntecedentes>>(
        `${this.apiUrl}/EstadosRobots/estados-por-cedulas`,
        { cedulas: [doc] },
      )
      .pipe(
        map((resp) => (resp && resp[doc]) || null),
        catchError(this.handleError),
      );
  }

  // EstadosRobots/pendientes_por_oficina
  // EstadosRobots/pendientes_generales
}

/** Una fuente consultada por el robot. */
export interface ResultadoRobotCampo {
  /** Valor listo para el formulario, o null si no es interpretable. */
  valor: string | number | null;
  /** Texto crudo que devolvió la fuente, para mostrar procedencia. */
  crudo: string | null;
  fecha: string | null;
  marca_temporal: string | null;
}

export interface ResultadosAntecedentes {
  cedula: string;
  tipo_documento?: string | null;
  encontrado: boolean;
  fecha_ultima_modificacion?: string | null;
  campos: Partial<Record<
    'policivos' | 'ofac' | 'procuraduria' | 'contraloria'
    | 'eps' | 'afp' | 'sisben' | 'medidas_correctivas',
    ResultadoRobotCampo
  >>;
}

/**
 * Fila de la cola de antecedentes tal como la devuelve
 * `/EstadosRobots/estados-por-cedulas`.
 *
 * Los estados son los del motor de la cola, no los del formulario:
 * SIN_CONSULTAR (encolado), EN_PROGRESO (un robot lo tiene tomado),
 * FINALIZADO (consultado) y BLOQUEADO (el robot lo intentó y no pudo:
 * hay que verificarlo a mano). `null` = esa fuente nunca se tocó.
 */
export interface EstadoColaAntecedentes {
  tipo_documento?: string | null;
  estado_adress?: string | null;
  estado_policivo?: string | null;
  estado_ofac?: string | null;
  estado_contraloria?: string | null;
  estado_sisben?: string | null;
  estado_procuraduria?: string | null;
  estado_fondo_pension?: string | null;
  estado_medidas_correctivas?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
}
