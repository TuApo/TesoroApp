import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { MonoTypeOperatorFunction, Observable, retry, throwError, timer } from 'rxjs';
import { environment } from '@/environments/environment';

/**
 * Submódulo Nómina → Envío de correos → **Cumpleaños**.
 *
 * Habla solo con ms-payroll (`/api/nomina/envio-correos/cumpleanos/**`).
 *
 * ⚠️ El backend responde en snake_case (`@JsonProperty` explícito en los DTO):
 * las interfaces de abajo reflejan el JSON REAL, no camelCase.
 */

// ── Padrón ───────────────────────────────────────────────────────────────────

export interface PersonaCumpleanos {
  id: number;
  cedula: string;
  nombre: string | null;
  fecha_ingreso: string | null;
  finca: string | null;
  correo: string | null;
  /** APOYO_LABORAL | ALIANZA | null. Decide con qué plantilla se le saluda. */
  empresa: string | null;
  empresa_nombre: string | null;
  fecha_nacimiento: string | null;
  /** "MM-DD" que calcula la base de datos. */
  cumple_dia: string | null;
  edad: number | null;
  anios_empresa: number | null;
  activo: boolean;
  inactivado_en: string | null;
}

export interface PadronPage {
  content: PersonaCumpleanos[];
  page: number;
  size: number;
  total: number;
  total_activos: number;
  total_inactivos: number;
  /** Activos sin empresa: los que recibirían la plantilla por defecto. */
  total_sin_empresa: number;
}

/**
 * Resultado de subir el Excel.
 *
 * Los contadores son el mensaje de vuelta al operador: sin ellos, subir un
 * archivo recortado y dejar medio padrón inactivo se ve igual que una carga
 * correcta.
 */
export interface CargaPadron {
  id: number;
  nombre_archivo: string | null;
  total_filas: number;
  nuevos: number;
  actualizados: number;
  reactivados: number;
  inactivados: number;
  invalidos: number;
  sin_empresa: number;
  cargado_por: string | null;
  creado_en: string;
  /** Filas que no entraron limpias, con el número de fila del Excel. */
  avisos: string[];
}

// ── Configuración ────────────────────────────────────────────────────────────

export interface ConfigCumpleanos {
  auto_activo: boolean;
  hora_envio: number;
  minuto_envio: number;
  max_por_dia: number;
  /** Zona en la que se interpretan `hora_envio` y "hoy". */
  zona: string;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

// ── Envío ────────────────────────────────────────────────────────────────────

/** La plantilla elegida para una temporal. `empresa` = APOYO_LABORAL | ALIANZA | DEFECTO. */
export interface PlantillaEmpresa {
  empresa: string;
  empresa_nombre: string;
  plantilla_id: string | null;
  plantilla_nombre: string | null;
  /** Cuántas personas activas del padrón caen en esta empresa. */
  personas: number;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

/** Una plantilla publicada en el módulo de Plantillas de correo. */
export interface PlantillaOpcion {
  id: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  asunto: string | null;
}

/**
 * Todo lo de la pestaña Configuración en una sola respuesta.
 *
 * Llega junto a propósito: pedirlo en tres llamadas dejaba la pestaña en blanco
 * cuando una fallaba, sin decir por qué.
 */
export interface ConfiguracionCumpleanos {
  config: ConfigCumpleanos;
  plantillas: PlantillaEmpresa[];
  opciones: PlantillaOpcion[];
  aviso_opciones: string | null;
}

export type EstadoEnvioCumple =
  | 'EN_CURSO' | 'COMPLETADO' | 'CON_ERRORES' | 'SIN_DESTINATARIOS' | 'FALLIDO';

export type EstadoItemCumple =
  | 'PENDIENTE' | 'ENVIADO' | 'FALLIDO' | 'SIN_CORREO' | 'SIN_PLANTILLA' | 'OMITIDO';

export interface EnvioCumpleanos {
  id: number;
  fecha: string;
  origen: 'AUTOMATICO' | 'MANUAL';
  estado: EstadoEnvioCumple;
  total: number;
  total_enviados: number;
  total_fallidos: number;
  total_omitidos: number;
  detalle: string | null;
  creado_por: string | null;
  creado_en: string;
}

export interface ItemEnvioCumpleanos {
  id: number;
  cedula: string;
  nombre: string | null;
  correo: string | null;
  finca: string | null;
  empresa: string | null;
  plantilla_nombre: string | null;
  estado: EstadoItemCumple;
  motivo: string | null;
  asunto: string | null;
  enviado_en: string | null;
}

export interface DetalleEnvioCumpleanos {
  envio: EnvioCumpleanos;
  items: ItemEnvioCumpleanos[];
}

export interface CumpleanosDelDia {
  fecha: string;
  total: number;
  sin_correo: number;
  /** Si ese día ya salió el saludo. La pantalla lo dice antes de ofrecer el botón. */
  ya_enviado: boolean;
  envio: EnvioCumpleanos | null;
  personas: PersonaCumpleanos[];
}

export interface PreviewCumpleanos {
  asunto: string;
  cuerpo_html: string;
  muestra: string;
  plantilla_nombre: string | null;
}

/** Un día del mes con gente que cumple. Los días vacíos NO vienen. */
export interface DiaCalendario {
  fecha: string;
  dia: number;
  total: number;
  sin_correo: number;
  enviado: boolean;
}

export interface CalendarioCumpleanos {
  anio: number;
  mes: number;
  total: number;
  dias: DiaCalendario[];
  /** Personas que casan con el buscador, ya filtradas. */
  coincidencias: PersonaCumpleanos[];
}

export interface ResultadoPrueba {
  enviado: boolean;
  destinatario: string;
  asunto: string;
  mensaje: string | null;
}

@Injectable({ providedIn: 'root' })
export class CumpleanosService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  private get base() { return `${this.api}/api/nomina/envio-correos/cumpleanos`; }

  /**
   * Reintenta ante un 429 con espera creciente.
   *
   * El gateway limita por usuario y el refresco en segundo plano de la app se
   * come parte de la ráfaga; sin esto, abrir la pantalla justo entonces la deja
   * vacía. Un 429 se rechaza EN EL GATEWAY —la petición nunca llega al
   * microservicio—, así que reintentar no tiene efectos secundarios.
   */
  private reintentarSi429<T>(): MonoTypeOperatorFunction<T> {
    return retry<T>({
      count: 4,
      delay: (error: any, intento: number) => {
        if (error?.status !== 429) return throwError(() => error);
        return timer(400 * Math.pow(2, intento - 1));
      },
    });
  }

  // ── Padrón ─────────────────────────────────────────────────────────────────

  padron(opts: {
    activo?: boolean | null; empresa?: string | null; q?: string | null;
    page?: number; size?: number;
  } = {}): Observable<PadronPage> {
    let params = new HttpParams()
      .set('page', opts.page ?? 0)
      .set('size', opts.size ?? 50);
    if (opts.activo !== null && opts.activo !== undefined) params = params.set('activo', opts.activo);
    if (opts.empresa) params = params.set('empresa', opts.empresa);
    if (opts.q) params = params.set('q', opts.q);
    return this.http.get<PadronPage>(`${this.base}/padron`, { params })
      .pipe(this.reintentarSi429());
  }

  /** El padrón activo como Excel: se corrige y se vuelve a subir. */
  descargarPadron(): Observable<Blob> {
    return this.http.get(`${this.base}/padron/plantilla-excel`, { responseType: 'blob' });
  }

  /** Sube el Excel. Quien viene queda activo; quien no viene, inactivo. */
  cargarPadron(archivo: File): Observable<CargaPadron> {
    const form = new FormData();
    form.append('archivo', archivo, archivo.name);
    return this.http.post<CargaPadron>(`${this.base}/padron/plantilla-excel`, form);
  }

  cargas(page = 0, size = 20): Observable<{ content: CargaPadron[] }> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<{ content: CargaPadron[] }>(`${this.base}/padron/cargas`, { params })
      .pipe(this.reintentarSi429());
  }

  cambiarActivo(id: number, activo: boolean): Observable<PersonaCumpleanos> {
    const params = new HttpParams().set('activo', activo);
    return this.http.patch<PersonaCumpleanos>(`${this.base}/padron/${id}/activo`, null, { params });
  }

  // ── Configuración ──────────────────────────────────────────────────────────

  /** Horario, plantillas por empresa y opciones del motor, en una sola llamada. */
  configuracion(): Observable<ConfiguracionCumpleanos> {
    return this.http.get<ConfiguracionCumpleanos>(`${this.base}/configuracion`)
      .pipe(this.reintentarSi429());
  }

  guardarConfig(body: Partial<ConfigCumpleanos>): Observable<ConfigCumpleanos> {
    return this.http.put<ConfigCumpleanos>(`${this.base}/config`, body);
  }

  /** Fija la plantilla de una temporal. `plantillaId` vacío la quita. */
  guardarPlantilla(empresa: string, plantillaId: string | null): Observable<PlantillaEmpresa> {
    return this.http.put<PlantillaEmpresa>(`${this.base}/plantillas/${empresa}`,
      { plantilla_id: plantillaId });
  }

  // ── Envío ──────────────────────────────────────────────────────────────────

  delDia(fecha?: string | null, q?: string | null): Observable<CumpleanosDelDia> {
    let params = new HttpParams();
    if (fecha) params = params.set('fecha', fecha);
    if (q) params = params.set('q', q);
    return this.http.get<CumpleanosDelDia>(`${this.base}/hoy`, { params })
      .pipe(this.reintentarSi429());
  }

  /**
   * El mes entero para el calendario.
   *
   * `q` filtra ANTES de contar por día: buscar "Maria" deja el calendario
   * mostrando solo los días en que cumple alguna Maria, no solo la lista.
   */
  calendario(anio: number, mes: number, q?: string | null): Observable<CalendarioCumpleanos> {
    let params = new HttpParams().set('anio', anio).set('mes', mes);
    if (q) params = params.set('q', q);
    return this.http.get<CalendarioCumpleanos>(`${this.base}/calendario`, { params })
      .pipe(this.reintentarSi429());
  }

  /** Dispara el envío a mano. Responde 409 si ese día ya salió. */
  enviar(fecha?: string | null): Observable<DetalleEnvioCumpleanos> {
    let params = new HttpParams();
    if (fecha) params = params.set('fecha', fecha);
    return this.http.post<DetalleEnvioCumpleanos>(`${this.base}/enviar`, null, { params });
  }

  /** Reintenta los fallidos SIN repetir a quien ya recibió el saludo. */
  reintentar(envioId: number): Observable<DetalleEnvioCumpleanos> {
    return this.http.post<DetalleEnvioCumpleanos>(`${this.base}/envios/${envioId}/reintentar`, null);
  }

  /** Manda una muestra a una dirección. No consume el hueco del día. */
  probar(correo: string, empresa?: string | null, cedula?: string | null):
    Observable<ResultadoPrueba> {
    return this.http.post<ResultadoPrueba>(`${this.base}/probar`, {
      correo, empresa: empresa ?? null, cedula: cedula ?? null,
    });
  }

  preview(empresa?: string | null, cedula?: string | null): Observable<PreviewCumpleanos> {
    let params = new HttpParams();
    if (empresa) params = params.set('empresa', empresa);
    if (cedula) params = params.set('cedula', cedula);
    return this.http.get<PreviewCumpleanos>(`${this.base}/preview`, { params })
      .pipe(this.reintentarSi429());
  }

  envios(page = 0, size = 30): Observable<{ content: EnvioCumpleanos[] }> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<{ content: EnvioCumpleanos[] }>(`${this.base}/envios`, { params })
      .pipe(this.reintentarSi429());
  }

  detalleEnvio(envioId: number): Observable<DetalleEnvioCumpleanos> {
    return this.http.get<DetalleEnvioCumpleanos>(`${this.base}/envios/${envioId}`)
      .pipe(this.reintentarSi429());
  }

  historicoPersona(cedula: string): Observable<{ content: ItemEnvioCumpleanos[] }> {
    return this.http.get<{ content: ItemEnvioCumpleanos[] }>(`${this.base}/historico/${cedula}`)
      .pipe(this.reintentarSi429());
  }
}
