import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom, Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '@/environments/environment';


@Injectable({
  providedIn: 'root'
})
export class HiringService {

  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient, @Inject(PLATFORM_ID) private platformId: Object) { }

  private handleError(error: any): Observable<never> {
    return throwError(() => error);
  }

  // Buscar en contratacion por cedula para sacar los numeros
  public buscarEncontratacion(cedula: any): Observable<any> {
    return this.http.get(`${this.apiUrl}/contratacion/buscarCandidato/${cedula}`,).pipe(
      map((response: any) => response),
      catchError(this.handleError)
    );
  }

  /**
   * Consulta de formularios: mismos valores que el Excel de cruce, por cédula(s)
   * y/o rango de fecha de inscripción (YYYY-MM-DD, `hasta` inclusive).
   */
  public consultaFormularios(filtro: { cedula?: string; desde?: string; hasta?: string }): Observable<any> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filtro)) if (v) params = params.set(k, v);
    return this.http.get(`${this.apiUrl}/gestion_contratacion/consulta-formularios/`, { params }).pipe(
      catchError(this.handleError)
    );
  }

  /** Sugerencias del buscador de la consulta de formularios: cédula que empieza o nombre. */
  public sugerenciasFormularios(q: string): Observable<{ cedula: string; nombre: string; fecha_inscripcion: string }[]> {
    return this.http.get<any[]>(`${this.apiUrl}/gestion_contratacion/consulta-formularios/sugerencias/`, {
      params: new HttpParams().set('q', q),
    }).pipe(catchError(this.handleError));
  }

  // Buscar en contratacion 2.0 por cédula (con datos completos)
  public buscarEnContratacion2(cedula: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/gestion_contratacion/candidatos/by-document/${cedula}/?full=1`).pipe(
      map((response: any) => response),
      catchError(this.handleError)
    );
  }

  // Buscar en contratacion por cedula para sacar los datos bio
  // check-contract/<str:codigo_contrato>/
  //
  // Buscar datos seleccion  /Seleccion/traerDatosSeleccion/{cedula}
  // Servicio para traer datos de contratación

  public traerDatosEncontratacion(cedula: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/contratacion/datosIncapacidadContratacion/${cedula}`,).pipe(
      map((response: any) => response),
      catchError(this.handleError)
    );
  }

  // Editar en contratacion el correo y el telefono
  async editarContratacion_Cedula_Correo(
    id: string,
    primercorreoelectronico: string,
    celular: string,
  ): Promise<any> {
    const urlcompleta = `${this.apiUrl}/Ausentismos/editarAusentismosCedCorreo/${id}`;
    const data = {
      celular: celular,
      primercorreoelectronico: primercorreoelectronico,
    };
    try {
      const response = await firstValueFrom(this.http.post<string>(urlcompleta, data,).pipe(
        catchError(this.handleError)
      ));
      return response;
    } catch (error) {
      throw error;
    }
  }

  //
  async subirContratacionAuditoria(
    datos: any
  ): Promise<any> {
    const urlcompleta = `${this.apiUrl}/contratacion/subidadeusuariosarchivoAuditoriaexcel`;
    const data = {
      datos: datos,
      mensaje: "mcuhos",
    };

    try {
      const response = await firstValueFrom(this.http.post<string>(urlcompleta, data,).pipe(
        catchError(this.handleError)
      ));
      return response;
    } catch (error) {
      throw error;
    }
  }

  // Subir archivo de contratacion
  async subirContratacion(
    datos: any
  ): Promise<any> {

    const urlcompleta = `${this.apiUrl}/contratacion/subidadeusuariosarchivoexcel`;

    const data = {
      datos: datos,
      mensaje: "mcuhos",
    };

    try {
      const response = await firstValueFrom(this.http.post<string>(urlcompleta, data,).pipe(
        catchError(this.handleError)
      ));
      return response;
    } catch (error) {
      throw error;
    }
  }

  // Subir archivo de contratacion para validar
  async subirContratacionValidar(
    datos: any
  ): Promise<any> {

    const urlcompleta = `${this.apiUrl}/contratacion/validarExcelContratacion`;

    const data = {
      datos: datos,
      mensaje: "mcuhos",
    };

    try {
      const response = await firstValueFrom(this.http.post<string>(urlcompleta, data,).pipe(
        catchError(this.handleError)
      ));
      return response;
    } catch (error) {
      throw error;
    }
  }

  // Generar el excel de arl
  async generarExcelArl(
    datos: any
  ): Promise<any> {
    const urlcompleta = `${this.apiUrl}/contratacion/validarDatos/`;

    const data = {
      datos: datos,
      mensaje: "mcuhos",
    };

    try {
      const response = await firstValueFrom(this.http.post<string>(urlcompleta, data).pipe(
        catchError(this.handleError)
      ));
      return response;
    } catch (error) {
      throw error;
    }
  }

  // Cargar una única cédula
  // Enviar archivos de traslados
  // actualizarProcesoContratacion (data)
  // --------------------------------------------------------------------------------------------
  // ------------------------- Métodos para el módulo de reportes --------------------------------

  // Subir reporte completo

  public obtenerReportesPorFechasCentroCosto(start: string, end: string): Observable<any> {
    const params = { start, end };  // Parámetros para enviar el rango de fechas
    return this.http.get(`${this.apiUrl}/contratacion/descargarReporteFechaIngresoCentroCosto/`, { params }).pipe(
      map((response: any) => response),  // Mapea la respuesta
      catchError(this.handleError)       // Manejo de errores
    );
  }

  public descargarReporteFechaIngresoCentroCostoFincas(start: string, end: string): Observable<Blob> {
    const params = { start, end };

    return this.http.get(`${this.apiUrl}/contratacion/descargarReporteFechaIngresoCentroCostoFincas/`, {
      params,
      responseType: 'blob'  // Indicar que esperamos un archivo binario
    }).pipe(
      map((response: Blob) => response),  // Mapea la respuesta a un blob
      catchError(this.handleError)        // Manejo de errores
    );
  }

  //--------------------------------------------------------------------------------------------
  // ------------------------- Métodos para el módulo de reportes de errores --------------------------------
  // --------------------------------------------------------------------------------------------

  async enviarErroresValidacion(
    payload: {
      errores: {
        registro: string; errores: any[];
      }[];
      responsable: string;
      oficina?: string;
      tipo: string;
    },

  ): Promise<any> {

    const urlcompleta = `${this.apiUrl}/contratacion/guardarErroresValidacion`;  // Asegúrate de que este sea el endpoint correcto

    const data = {
      errores: payload.errores,
      responsable: payload.responsable,
      oficina: payload.oficina ?? '',
      tipo: payload.tipo,
    };

    try {
      const response = await firstValueFrom(
        this.http.post<string>(urlcompleta, data,).pipe(
          catchError((error) => {
            return throwError(() => new Error('Error en la solicitud al guardar errores de validación'));
          })
        )
      );
      return response;
    } catch (error) {
      throw error;
    }
  }

  // Obtener base contratacion por rango de fechas.
  // `oficina` (opcional) filtra por la oficina del contrato (cierre por sede).
  public obtenerBaseContratacionPorFechas(start: string, end: string, oficina?: string): Observable<Blob> {

    const params: { [k: string]: string } = { start, end };
    if (oficina) params['oficina'] = oficina;

    // Indicamos que el responseType será 'blob' para manejar archivos binarios
    return this.http.get(`${this.apiUrl}/contratacion/descargarReporte/`, {
      params,
      responseType: 'blob'  // Tipo de respuesta como Blob
    }).pipe(
      map((response: Blob) => response),  // Mapea la respuesta a Blob
      catchError(this.handleError)        // Manejo de errores
    );
  }



  //--------------------------------------------------------------------------------------------
  // ------------------------- Métodos para validar informacion contratacion --------------------------------
  // --------------------------------------------------------------------------------------------


  // Validar información de contratación
  async validarInformacionContratacion(payload: {
    numeroCedula: string;
    codigoContrato: string;
    nombreQuienValidoInformacion: string;
    fechaHoraValidacion: string;
    primerApellido: string;
    segundoApellido: string;
    primerNombre: string;
    segundoNombre: string;
    fechaNacimiento: string;
    fechaExpedicionCC: string;
  }): Promise<any> {
    const urlcompleta = `${this.apiUrl}/contratacion/datosCandidatoYProceso/`; // Endpoint correcto de tu API



    try {
      const response = await firstValueFrom(
        this.http.post(urlcompleta, payload,).pipe(
          catchError((error) => {
            return throwError(() => new Error('Error al validar información de contratación'));
          })
        )
      );
      return response;
    } catch (error) {
      throw error;
    }
  }

  // contratacion/traerCompletoContratacion/<str:codigo_contrato>/
  // -------------------------
  // Módulo de Ausentismos
  // -------------------------

  public obtenerAusentismos(): Observable<any> {
    return this.http.get(`${this.apiUrl}/gestion_ausentismios/ausentismos/`,).pipe(
      map((response: any) => response),
      catchError(this.handleError)
    );
  }

  async gestionarAusentismo(id: string | number, data: any): Promise<any> {
    const url = `${this.apiUrl}/gestion_ausentismios/ausentismos/${id}/gestionar/`;
    try {
      const response = await firstValueFrom(this.http.patch<any>(url, data).pipe(
        catchError(this.handleError)
      ));
      return response;
    } catch (error) {
      throw error;
    }
  }

  async enviarNotificacionMasivaAusentismos(ids: (string | number)[], plantilla_id?: number | null): Promise<any> {
    const url = `${this.apiUrl}/gestion_ausentismios/ausentismos/notificar-masivo/`;
    const payload: any = { ids };
    if (plantilla_id) {
      payload.plantilla_id = plantilla_id;
    }
    try {
      const response = await firstValueFrom(this.http.post<any>(url, payload).pipe(
        catchError(this.handleError)
      ));
      return response;
    } catch (error) {
      throw error;
    }
  }

  async subirAusentismosExcel(file: File): Promise<any> {
    const url = `${this.apiUrl}/gestion_ausentismios/ausentismos/importar-excel/`;
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await firstValueFrom(this.http.post<any>(url, formData).pipe(
        catchError(this.handleError)
      ));
      return response;
    } catch (error) {
      throw error;
    }
  }

  // -------------------------
  // Módulo de Ausentismos NUEVOS
  // -------------------------

  public obtenerAusentismosNuevos(): Observable<any> {
    return this.http.get(`${this.apiUrl}/gestion_ausentismios/ausentismos-nuevos/`,).pipe(
      map((response: any) => response),
      catchError(this.handleError)
    );
  }

  async gestionarAusentismoNuevo(id: string | number, data: any): Promise<any> {
    const url = `${this.apiUrl}/gestion_ausentismios/ausentismos-nuevos/${id}/gestionar/`;
    try {
      const response = await firstValueFrom(this.http.patch<any>(url, data).pipe(
        catchError(this.handleError)
      ));
      return response;
    } catch (error) {
      throw error;
    }
  }

  async enviarNotificacionMasivaAusentismosNuevos(ids: (string | number)[], plantilla_id?: number | null): Promise<any> {
    const url = `${this.apiUrl}/gestion_ausentismios/ausentismos-nuevos/notificar-masivo/`;
    const payload: any = { ids };
    if (plantilla_id) {
      payload.plantilla_id = plantilla_id;
    }
    try {
      const response = await firstValueFrom(this.http.post<any>(url, payload).pipe(
        catchError(this.handleError)
      ));
      return response;
    } catch (error) {
      throw error;
    }
  }

  async subirAusentismosNuevosExcel(file: File): Promise<any> {
    const url = `${this.apiUrl}/gestion_ausentismios/ausentismos-nuevos/importar-excel/`;
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await firstValueFrom(this.http.post<any>(url, formData).pipe(
        catchError(this.handleError)
      ));
      return response;
    } catch (error) {
      throw error;
    }
  }

  crearAusentismoNuevo(data: any): Promise<any> {
    const url = `${this.apiUrl}/gestion_ausentismios/ausentismos-nuevos/`;
    return firstValueFrom(
      this.http.post<any>(url, data).pipe(catchError(this.handleError))
    );
  }

  descargarPlantillaAusentismosNuevos(): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/gestion_ausentismios/ausentismos-nuevos/descargar-plantilla/`, {
      responseType: 'blob'
    }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Genera el documento legal (Apertura Proceso / Terminación Contrato) en PDF
   * y lo envía por correo al trabajador, o lo descarga directamente.
   *
   * @param ausentismoId  ID del registro AusentismoNuevo
   * @param payload       Campos del documento (tipo, empresa, fechas, teléfonos, etc.)
   * @param soloPdf       true → descarga el PDF directamente en el navegador
   */
  async generarDocumentoAusentismo(
    ausentismoId: number | string,
    payload: {
      tipo_documento: 'apertura' | 'terminacion';
      empresa: 'APOYO' | 'ALIANZA';
      numero_familiar: string;
      // Apertura
      fecha_citacion?: string;
      hora_citacion?: string;
      lugar_citacion?: string;
      // Terminación
      fecha_envio_correo?: string;
      fecha_citacion_previa?: string;
      hora_citacion_previa?: string;
      lugar_citacion_previa?: string;
      fecha_terminacion?: string;
      fecha_liquidacion?: string;
      // Control
      enviar_correo?: boolean;
      solo_pdf?: boolean;
    }
  ): Promise<any> {
    const solo_pdf = payload.solo_pdf ?? false;
    const url = `${this.apiUrl}/gestion_ausentismios/ausentismos-nuevos/${ausentismoId}/generar-documento/`;

    if (solo_pdf) {
      // Descarga directa del PDF — compatible con navegador y Electron.
      // responseType='blob' hace que los errores HTTP lleguen también como Blob.
      let respBlob: Blob;
      try {
        respBlob = await firstValueFrom(
          this.http.post(url, payload, { responseType: 'blob' })
        ) as Blob;
      } catch (httpError: any) {
        console.error('[HiringService] generarDocumentoAusentismo HTTP error:', httpError);
        if (httpError?.error instanceof Blob) {
          const text = await (httpError.error as Blob).text();
          let detail = 'Error generando el PDF en el servidor.';
          try { detail = JSON.parse(text)?.detail || text; } catch { detail = text || detail; }
          throw { error: { detail } };
        }
        throw httpError;
      }

      // Verificar que la respuesta realmente es un PDF
      if (!respBlob || respBlob.size === 0) {
        throw { error: { detail: 'El servidor devolvió una respuesta vacía.' } };
      }

      console.log('[HiringService] PDF recibido, size:', respBlob.size, 'type:', respBlob.type);

      // Forzar el tipo correcto en caso de que venga sin Content-Type
      const pdfBlob = respBlob.type === 'application/pdf'
        ? respBlob
        : new Blob([respBlob], { type: 'application/pdf' });

      const objectUrl = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `Documento_Ausentismo_${ausentismoId}.pdf`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Esperar un tick antes de revocar para que Electron procese la descarga
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
        document.body.removeChild(a);
      }, 1000);
      return { detail: 'PDF descargado.' };
    }

    // Envío por correo
    return firstValueFrom(
      this.http.post<any>(url, payload).pipe(catchError(this.handleError))
    );
  }

  // -------------------------
  // Módulo de Mensajes Predeterminados
  // -------------------------

  public obtenerMensajes(tipo?: string): Observable<any> {
    let url = `${this.apiUrl}/gestion_ausentismios/mensajes/`;
    if (tipo) {
      // Si el backend permite filtrado por tipo
      url += `?tipo=${tipo}`;
    }
    return this.http.get(url).pipe(
      map((response: any) => response),
      catchError(this.handleError)
    );
  }

  async crearMensaje(data: any): Promise<any> {
    const url = `${this.apiUrl}/gestion_ausentismios/mensajes/`;
    try {
      return await firstValueFrom(this.http.post<any>(url, data).pipe(catchError(this.handleError)));
    } catch (error) { throw error; }
  }

  async eliminarMensaje(id: string | number): Promise<any> {
    const url = `${this.apiUrl}/gestion_ausentismios/mensajes/${id}/`;
    try {
      return await firstValueFrom(this.http.delete<any>(url).pipe(catchError(this.handleError)));
    } catch (error) { throw error; }
  }
}
