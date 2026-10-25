import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom, Observable, Subject, throwError } from 'rxjs';
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
   * Nombre, ubicación y veredictos que dejó el robot para varias cédulas
   * (POST /Robots/resultados-antecedentes/lote, máx. 500). Sirve para cédulas
   * que todavía NO son candidatos: el nombre sale de ADRES, no de ms-hr.
   * Una cédula sin resultados no viene en el mapa.
   */
  getResultadosLote(cedulas: string[]): Observable<Record<string, ResultadoAntecedentesLote>> {
    return this.http
      .post<Record<string, ResultadoAntecedentesLote>>(
        `${this.apiUrl}/Robots/resultados-antecedentes/lote/`, { cedulas })
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

  /* ------------------------------------------------------------------
   * Consultas FORZADAS en espera de robot, por cédula.
   *
   * Forzar solo encola: el robot tarda de segundos (contraloría) a varios
   * minutos (ADRES). Quien forzó (el pipeline o la tarjeta) no es quien pinta
   * los PDF y los datos (Antecedentes), así que la espera se deja anotada aquí
   * —servicio raíz— y Antecedentes la vigila: cuando cada fuente vuelve
   * FINALIZADO recarga el PDF nuevo y pone el dato de HOY en la tarjeta,
   * aunque ya hubiera uno de la consulta anterior.
   * ------------------------------------------------------------------ */
  private readonly forzadas = new Map<string, Set<string>>();
  private readonly forzado$ = new Subject<string>();
  /** Emite la cédula cada vez que se registra una consulta forzada. */
  readonly forzadoCambio$ = this.forzado$.asObservable();

  registrarForzado(cedula: string, fuentes: string[]): void {
    const ced = String(cedula ?? '').trim();
    if (!ced || !fuentes.length) return;
    const set = this.forzadas.get(ced) ?? new Set<string>();
    fuentes.forEach((f) => set.add(f));
    this.forzadas.set(ced, set);
    this.forzado$.next(ced);
  }

  fuentesForzadas(cedula: string | null | undefined): string[] {
    return [...(this.forzadas.get(String(cedula ?? '').trim()) ?? [])];
  }

  atenderForzado(cedula: string, fuentes: string[]): void {
    const ced = String(cedula ?? '').trim();
    const set = this.forzadas.get(ced);
    if (!set) return;
    fuentes.forEach((f) => set.delete(f));
    if (!set.size) this.forzadas.delete(ced);
  }

  // EstadosRobots/pendientes_por_oficina
  // EstadosRobots/pendientes_generales
}

/** Lo que dejó el robot de una cédula (POST /Robots/resultados-antecedentes/lote). */
export interface ResultadoAntecedentesLote {
  tipo_documento?: string | null;
  /** Nombres tal como los reporta ADRES ("IVAN DAVID"). */
  nombre?: string | null;
  /** Apellidos tal como los reporta ADRES ("BERMUDEZ CASTAÑEDA"). */
  apellido?: string | null;
  departamento?: string | null;
  municipio?: string | null;
  fecha_ultima_modificacion?: string | null;
  /** Veredicto normalizado por fuente (CUMPLE / NO CUMPLE / entidad / categoría) o null. */
  veredictos?: Record<string, string | number | null>;
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
  /** ADRES reporta régimen especial o de excepción; null si no. */
  regimen_excepcion?: RegimenExcepcionAdres | null;
  /**
   * ADRES no encontró afiliación (estado, régimen o entidad = SIN REGISTRO). Solo pide
   * verificar: alguien de régimen especial suele salir así (ms-automation).
   */
  adres_sin_registro?: boolean | null;
}

/** Lo que dejó el robot de ADRES cuando la persona está en régimen especial/de excepción. */
export interface RegimenExcepcionAdres {
  regimen: string | null;
  entidad: string | null;
  estado: string | null;
  fecha: string | null;
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
