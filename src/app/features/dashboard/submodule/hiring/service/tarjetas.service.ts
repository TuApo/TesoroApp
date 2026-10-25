import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

export interface Tarjeta {
    id: number;
    identification_number: string;
    card_number: string;
    created_at?: string;
    updated_at?: string;
    created_by?: string | null;
    updated_by?: string | null;
    imported_at?: string | null;
    imported_by?: string | null;
    import_batch_id?: number | null;
    /** MANUAL | IMPORTACION. Lo calcula el backend a partir del lote. */
    origen?: string;
}

/** Filtros del listado. Se resuelven TODOS en el servidor. */
export interface FiltroTarjetas {
    search?: string | null;
    desde?: string | null;
    hasta?: string | null;
    lote_id?: number | null;
    origen?: string | null;
}

export interface PaginaTarjetas {
    content: Tarjeta[];
    total_elements: number;
    total_pages: number;
    page: number;
    size: number;
}

/** Resumen de la simulacion: es lo que el usuario mira antes de confirmar. */
export interface ResumenImportacion {
    total_filas: number;
    filas_validas: number;
    filas_con_error: number;
    registros_nuevos: number;
    registros_existentes: number;
    registros_actualizables: number;
    sin_cambios: number;
    duplicados_archivo: number;
    alertas_documento_con_otra_tarjeta: number;
    filas_vacias_ignoradas: number;
    columnas_faltantes: string[];
    columnas_desconocidas: string[];
    columnas_detectadas: string[];
    hoja_leida: string;
    hojas_del_archivo: string[];
}

export interface FilaResultado {
    fila: number;
    estado: string;
    accion: string;
    identificacion: string | null;
    numero_tarjeta: string | null;
    mensaje: string | null;
    aplicada: boolean;
}

export interface RespuestaSimulacion {
    lote_id: number;
    estado: string;
    resumen: ResumenImportacion;
    filas: FilaResultado[];
    filas_devueltas: number;
    hay_mas_filas: boolean;
    archivo_ya_cargado: number[];
    mensaje: string;
}

export interface RespuestaAplicacion {
    lote_id: number;
    estado: string;
    total_filas: number;
    creadas: number;
    actualizadas: number;
    sin_cambios: number;
    rechazadas: number;
    mensaje: string;
}

export interface LoteCarga {
    id: number;
    archivo_nombre: string;
    archivo_hash: string;
    archivo_tamano_bytes: number;
    usuario_id: string | null;
    usuario_nombre: string;
    fecha_inicio: string;
    fecha_fin: string | null;
    total_filas: number;
    total_validas: number;
    total_creadas: number;
    total_actualizadas: number;
    total_sin_cambios: number;
    total_rechazadas: number;
    estado: string;
    codigo_error: string | null;
    mensaje_error: string | null;
    simulacion_id: number | null;
}

export interface PaginaLotes {
    content: LoteCarga[];
    total_elements: number;
    total_pages: number;
    page: number;
    size: number;
}

export interface PaginaFilas {
    content: FilaResultado[];
    total_elements: number;
    total_pages: number;
    page: number;
    size: number;
}

/**
 * Resultado de resolver una identificación contra el pool y contra los contratos.
 *
 * `valido` es lo único que decide si se puede guardar; `estado` es para el mensaje.
 */
export interface ResolucionTarjeta {
  estado: 'DISPONIBLE' | 'YA_ES_SUYA' | 'NO_EXISTE' | 'ASIGNADA_A_OTRO'
        | 'VARIAS_DISPONIBLES' | 'POOL_NO_DISPONIBLE';
  identificacion: string | null;
  numero_cuenta: string | null;
  cuentas_disponibles: string[];
  ocupadas: { numero_cuenta: string; documento: string }[];
  mensaje: string;
  valido: boolean;
}

/** Contrato de columnas que publica el backend, para mostrarlo ANTES de subir nada. */
export interface FormatoCarga {
    columnas: { campo: string; encabezado: string; obligatoria: boolean; alias: string[] }[];
    columnas_informativas: string[];
    max_filas: number;
    max_mb: number;
    extensiones: string[];
    longitud_tarjeta: number;
    clave_negocio: string;
    notas: string[];
}

/**
 * Tarjetas: consulta, edicion individual y carga masiva.
 *
 * <p>La carga masiva son DOS llamadas a proposito — `simular` y despues `aplicar` — y
 * entre ellas manda el usuario. La ruta antigua `/tarjetas/import-excel`, que escribia de
 * una sola pasada, ya no existe: el backend responde 409 si alguien la llama.
 */
@Injectable({
    providedIn: 'root'
})
export class TarjetasService {
    private apiUrl = `${environment.apiUrl}/tarjetas`;

    private http = inject(HttpClient);

    /**
     * Listado HISTORICO sin paginar.
     *
     * OJO: sin parametros devuelve las 55.000 filas. Lo sigue usando
     * `hiring-questions` para su autocompletado; la pantalla de Tarjetas usa
     * `consultar()`, que pagina en el servidor.
     */
    list(params: any = {}): Observable<any> {
        return this.http.get<any>(`${this.apiUrl}/`, { params });
    }

    /** Listado de la pantalla: filtra, ordena y pagina contra el backend. */
    consultar(filtro: FiltroTarjetas, page: number, size: number,
              sort = 'id', direction: 'asc' | 'desc' = 'desc'): Observable<PaginaTarjetas> {
        return this.http.get<PaginaTarjetas>(`${this.apiUrl}/consulta`, {
            params: this.parametros(filtro).set('page', page).set('size', size)
                .set('sort', sort).set('direction', direction),
        });
    }

    /**
     * Excel de TODO lo que cumple el filtro (no de la pagina visible).
     *
     * Lo genera el servidor en streaming: con 55.000 filas, montarlo en el navegador es
     * pedirle al navegador que se cuelgue.
     */
    exportarExcel(filtro: FiltroTarjetas): Observable<Blob> {
        return this.http.get(`${this.apiUrl}/export.xlsx`, {
            params: this.parametros(filtro),
            responseType: 'blob',
        });
    }

    create(data: Partial<Tarjeta>): Observable<Tarjeta> {
        return this.http.post<Tarjeta>(`${this.apiUrl}/`, data);
    }

    update(id: number, data: Partial<Tarjeta>): Observable<Tarjeta> {
        return this.http.patch<Tarjeta>(`${this.apiUrl}/${id}/`, data);
    }

    delete(id: number): Observable<any> {
        return this.http.delete(`${this.apiUrl}/${id}/`);
    }

    // ── Carga masiva ────────────────────────────────────────────────────────

    /** Paso 1: no escribe ninguna tarjeta. Devuelve el lote SIMULADO y el veredicto. */
    simular(file: File): Observable<RespuestaSimulacion> {
        const formData = new FormData();
        formData.append('file', file);
        return this.http.post<RespuestaSimulacion>(`${this.apiUrl}/importaciones/simular`, formData);
    }

    /** Paso 2: aplica exactamente lo que se simulo. */
    aplicar(loteId: number): Observable<RespuestaAplicacion> {
        return this.http.post<RespuestaAplicacion>(`${this.apiUrl}/importaciones/${loteId}/aplicar`, {});
    }

    historial(page: number, size: number, estado?: string | null): Observable<PaginaLotes> {
        let params = new HttpParams().set('page', page).set('size', size);
        if (estado) params = params.set('estado', estado);
        return this.http.get<PaginaLotes>(`${this.apiUrl}/importaciones`, { params });
    }

    lote(id: number): Observable<LoteCarga> {
        return this.http.get<LoteCarga>(`${this.apiUrl}/importaciones/${id}`);
    }

    filasDelLote(id: number, page: number, size: number, estado?: string | null): Observable<PaginaFilas> {
        let params = new HttpParams().set('page', page).set('size', size);
        if (estado) params = params.set('estado', estado);
        return this.http.get<PaginaFilas>(`${this.apiUrl}/importaciones/${id}/filas`, { params });
    }

    /** Excel de resultados del lote: datos originales + RESULTADO_CARGA / ACCION / DETALLE_ERROR. */
    resultadoExcel(id: number, soloProblemas: boolean): Observable<Blob> {
        return this.http.get(`${this.apiUrl}/importaciones/${id}/resultado.xlsx`, {
            params: new HttpParams().set('solo_problemas', soloProblemas),
            responseType: 'blob',
        });
    }

    /**
     * ¿Se le puede asignar esta identificación a esta persona?
     *
     * Lo responde **ms-hr**, no ms-payroll: el pool dice qué tarjetas existen, pero quién
     * tiene cada una es el contrato. Devuelve 200 siempre; mira `valido`.
     */
    resolverAsignacion(params: { identificacion?: string; numero_cuenta?: string; documento?: string }):
        Observable<ResolucionTarjeta> {
        let p = new HttpParams();
        if (params.identificacion) p = p.set('identificacion', params.identificacion);
        if (params.numero_cuenta) p = p.set('numero_cuenta', params.numero_cuenta);
        if (params.documento) p = p.set('documento', params.documento);
        return this.http.get<ResolucionTarjeta>(
            `${environment.apiUrl}/gestion_contratacion/tarjetas/resolver`, { params: p });
    }

    formato(): Observable<FormatoCarga> {
        return this.http.get<FormatoCarga>(`${this.apiUrl}/importaciones/formato`);
    }

    // ── internos ────────────────────────────────────────────────────────────

    private parametros(filtro: FiltroTarjetas): HttpParams {
        let params = new HttpParams();
        if (filtro.search) params = params.set('search', filtro.search);
        if (filtro.desde) params = params.set('desde', filtro.desde);
        if (filtro.hasta) params = params.set('hasta', filtro.hasta);
        if (filtro.lote_id != null) params = params.set('lote_id', filtro.lote_id);
        if (filtro.origen) params = params.set('origen', filtro.origen);
        return params;
    }
}
