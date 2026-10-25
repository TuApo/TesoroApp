import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * Archivo histórico de afiliaciones (certificados EPS / caja / pensión de jul-2023 a oct-2026)
 * que vive cifrado en el servidor y ms-hr expone en /gestion_afiliaciones/archivo (V68).
 * ms-hr responde en snake_case: las interfaces lo respetan tal cual.
 */

export interface FiltrosArchivo {
  empresa?: string | null;
  anio?: number | null;
  mes?: number | null;
  tramite?: string | null;
  entidad?: string | null;
  estado?: string | null;
  ubicacion?: string | null;
  cedula?: string | null;
}

export interface GrupoArchivo { clave: string; documentos: number; cedulas: number; }

export interface KpisArchivo {
  archivos: number;
  documentos: number;
  cedulas: number;
  bytes: number;
  duplicados: number;
  por_revisar: number;
  eps: number;
  extemporaneas: number;
  caja: number;
  pension: number;
  desde: string | null;
  hasta: string | null;
  importado_at: string | null;
}

export interface PuntoSerieArchivo {
  periodo: string;           // aaaa-mm
  empresa: string | null;
  tramite: string | null;
  documentos: number;
  cedulas: number;
}

export interface CoberturaMes {
  periodo: string;           // aaaa-mm de fecha_ingreso
  empresa: string;
  contratos: number;
  con_eps: number;
  con_caja: number;
  con_pension: number;
  con_alguno: number;
  calculado_at: string;
}

export interface ResumenArchivo {
  kpis: KpisArchivo;
  por_empresa: GrupoArchivo[];
  por_anio: GrupoArchivo[];
  por_tramite: GrupoArchivo[];
  por_entidad: GrupoArchivo[];
  por_estado: GrupoArchivo[];
  por_ubicacion: GrupoArchivo[];
  serie_mensual: PuntoSerieArchivo[];
  por_dia_semana: { dia_semana: number; documentos: number }[];
  cobertura: CoberturaMes[];
}

export interface DocumentoArchivo {
  id: number;
  cedula: string | null;
  empresa: string | null;
  anio: number | null;
  mes: number | null;
  fecha: string | null;
  tramite: string | null;
  entidad: string | null;
  estado: string | null;
  ubicacion: string;
  ruta: string | null;
  ruta_original: string;
  duplicado_de: string | null;
  extension: string | null;
  tamano_bytes: number;
}

export interface PaginaDocumentos { total: number; page: number; size: number; rows: DocumentoArchivo[]; }

export interface ContratoPersona {
  proceso_id: number;
  codigo_contrato: string | null;
  fecha_ingreso: string | null;
  empresa: string | null;
  eps: string | null;
}

export interface FichaPersona {
  cedula: string;
  persona: { candidato_id: number; tipo_doc: string | null; nombre: string | null } | null;
  contratos: ContratoPersona[];
  documentos: DocumentoArchivo[];
}

@Injectable({ providedIn: 'root' })
export class ArchivoHistoricoService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/gestion_afiliaciones/archivo`;

  resumen(f: FiltrosArchivo): Observable<ResumenArchivo> {
    return this.http.get<ResumenArchivo>(`${this.api}/resumen`, { params: parametros(f) });
  }

  documentos(f: FiltrosArchivo, page: number, size: number, orden = 'recientes'): Observable<PaginaDocumentos> {
    const params = parametros(f).set('page', page).set('size', size).set('orden', orden);
    return this.http.get<PaginaDocumentos>(`${this.api}/documentos`, { params });
  }

  persona(cedula: string): Observable<FichaPersona> {
    return this.http.get<FichaPersona>(`${this.api}/persona/${encodeURIComponent(cedula.trim())}`);
  }

  /** El PDF va por blob autenticado: un <a href> plano no lleva el JWT y el gateway responde 401. */
  archivo(id: number, descargar = false): Observable<Blob> {
    return this.http.get(`${this.api}/documentos/${id}/archivo`, {
      params: new HttpParams().set('descargar', descargar),
      responseType: 'blob',
    });
  }
}

function parametros(f: FiltrosArchivo): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== null && v !== undefined && `${v}`.trim() !== '') p = p.set(k, `${v}`.trim());
  }
  return p;
}
