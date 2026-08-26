import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom, Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '@/environments/environment';
import { UtilityServiceService } from '@/app/shared/services/utilityService/utility-service.service';

@Injectable({
  providedIn: 'root',
})
export class ComercializadoraService {
  private apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object,
    private utilityService: UtilityServiceService
  ) { }

  private handleError(error: any): Observable<never> {
    throw error;
  }

  // Traer estado de PersonaTesoreria por documento
  getPersonaTesoreriaStatus(numeroDocumento: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/gestion_tesoreria/personas/${encodeURIComponent(numeroDocumento)}/status/`).pipe(
      catchError(this.handleError)
    );
  }

  // Traer datos de la comercializadora por codigo
  // Actualizar inventario con la cantidad vendida
  async ActualizarInventario(
    cantidadTotalVendida: string,
    codigo: string
  ): Promise<string> {

    const urlcompleta = `${this.apiUrl}/Comercio/jefedearea/ActualizarCantidadVendida/${codigo}`;


    const requestBody = {
      cantidadTotalVendida,
    };

    try {
      const response = await firstValueFrom(
        this.http
          .post<string>(urlcompleta, requestBody)
          .pipe(catchError(this.handleError))
      );
      return response;
    } catch (error) {
      throw error;
    }
  }

  // Traer datos de la comercializadora por codigo
  // Realizar envio de mercancia
  async enviarMercancia(
    codigo: string,
    destino: string,
    concepto: string,
    cantidadEnvio: string,
    valorUnidad: string,
    personaQueLleva: string,
    comentariosEnvio: string
  ): Promise<string> {


    const urlcompleta = `${this.apiUrl}/Comercio/Comercializadora/realizarenvio`;

    const requestBody = {
      cantidadEnvio,
      valorUnidad,
      concepto,
      codigo,
      destino,
      personaQueLleva,
      comentariosEnvio,
      PersonaEnvia: this.utilityService.getUser().datos_basicos.nombres + ' ' + this.utilityService.getUser().datos_basicos.apellidos,
    };

    try {
      const response = await firstValueFrom(
        this.http
          .post<{ message: string }>(urlcompleta, requestBody)
          .pipe(catchError(this.handleError))
      );
      return response.message;
    } catch (error_1) {
      throw error_1;
    }
  }

  // Editar envio de mercancia
  async EditarEnvio(
    codigo: string,
    destino: string,
    concepto: string,
    cantidadEnvio: string,
    valorUnidad: string
  ): Promise<string> {

    const urlcompleta = `${this.apiUrl}/Comercio/Comercializadora/editarEnvio/${codigo}`;


    const requestBody = {
      cantidadEnvio,
      valorUnidad,
      concepto,
      codigo,
      destino,
    };

    try {
      const response = await firstValueFrom(
        this.http
          .post<{ message: string }>(urlcompleta, requestBody)
          .pipe(catchError(this.handleError))
      );
      return response.message;
    } catch (error_1) {
      throw error_1;
    }
  }

  // Recibir envio
  async RecibirEnvio(
    cantidadRecibida: string,
    PersonaRecibe: string,
    comentariosRecibido: string,
    codigo: string
  ): Promise<string> {


    const urlcompleta = `${this.apiUrl}/Comercio/jefedearea/recibirenvio/${codigo}`;


    const requestBody = {
      cantidadRecibida,
      PersonaRecibe,
      comentariosRecibido,
    };

    try {
      const response = await firstValueFrom(
        this.http
          .post<{ message: string }>(urlcompleta, requestBody)
          .pipe(catchError(this.handleError))
      );
      return response.message;
    } catch (error_1) {
      throw error_1;
    }
  }

  // recibir mercancia
  async recibirMercancia(
    cod: any,
    cantidadRecibida: any,
    comentariosRecibido: any
  ): Promise<any> {

    const urlcompleta = `${this.apiUrl}/Comercio/jefedearea/recibirenvio/${cod}`;

    const PersonaRecibe =
      this.utilityService.getUser().datos_basicos.nombres + ' ' + this.utilityService.getUser().datos_basicos.apellidos;
    const dataToSend = {
      cod,
      cantidadRecibida,
      PersonaRecibe,
      comentariosRecibido,
    };

    try {
      const response = await firstValueFrom(
        this.http
          .post<string>(urlcompleta, dataToSend)
          .pipe(catchError(this.handleError))
      );
      return response;
    } catch (error) {
      throw error;
    }
  }

  // categorias/<int:id>
  async traerCategorias(int: number): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.http
          .get(`${this.apiUrl}/opciones_formulario/categorias/${int}`)
          .pipe(catchError(this.handleError))
      );
      return response;
    } catch (error) {
      throw error;
    }
  }

  // --- NUEVOS MÉTODOS TESORERÍA --- 

  async enviarMercanciaNuevo(data: any): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.http.post(`${this.apiUrl}/gestion_tesoreria/movimientos/enviar/`, data)
          .pipe(catchError(this.handleError))
      );
      return response;
    } catch (error) {
      throw error;
    }
  }

  async editarEnvioNuevo(id: number, data: any): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.http.patch(`${this.apiUrl}/gestion_tesoreria/movimientos/${id}/editar-envio/`, data)
          .pipe(catchError(this.handleError))
      );
      return response;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Envíos pendientes de recibir. `sede` admite una oficina o VARIAS (multi-sede): el
   * backend acepta el parámetro repetido, así que quien recibe en dos oficinas los ve
   * todos en una sola llamada. Sin sede devuelve los de todas (contaduría).
   */
  async listarPendientesRecepcion(sede: string | string[] = ''): Promise<any> {
    try {
      let params = new HttpParams();
      const destinos = (Array.isArray(sede) ? sede : [sede])
        .map((s) => String(s ?? '').trim())
        .filter((s) => !!s);
      for (const destino of destinos) {
        params = params.append('sede', destino);
      }
      const response = await firstValueFrom(
        this.http.get(`${this.apiUrl}/gestion_tesoreria/movimientos/pendientes-recepcion/`, { params })
          .pipe(catchError(this.handleError))
      );
      return response;
    } catch (error) {
      throw error;
    }
  }

  async recibirMercanciaNuevo(data: any): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.http.post(`${this.apiUrl}/gestion_tesoreria/movimientos/recibir/`, data)
          .pipe(catchError(this.handleError))
      );
      return response;
    } catch (error) {
      throw error;
    }
  }

  async listarInventarioLotes(sede: string): Promise<any> {
    try {
      let params = new HttpParams();
      if (sede) {
        params = params.set('sede', sede);
      }
      const response = await firstValueFrom(
        this.http.get(`${this.apiUrl}/gestion_tesoreria/movimientos/inventario-lotes/`, { params })
          .pipe(catchError(this.handleError))
      );
      return response;
    } catch (error) {
      throw error;
    }
  }
}
