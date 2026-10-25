import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@/environments/environment';
import {
  AccesoSupervision, Aviso, Compromiso, Contacto, ContactoDetalle, Cuenta, HiloDetalle, HiloResumen, MensajeVista,
  MiembroEquipo, Pagina, ParametroSeguimiento, ResumenBandeja, Vinculacion,
} from './bandeja.models';

type Params = Record<string, string | number | boolean | null | undefined>;

/** Bandeja de ms-seguimiento: cuentas vinculadas, hilos, compromisos, contactos y supervisión. */
@Injectable({ providedIn: 'root' })
export class BandejaApiService {
  private readonly http = inject(HttpClient);
  readonly base = `${environment.apiUrl}/api/v1/seguimiento`;

  private get<T>(ruta: string, params?: Params): Promise<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
    return firstValueFrom(this.http.get<T>(`${this.base}${ruta}`, { params: p }));
  }
  private post<T>(ruta: string, body: unknown = {}): Promise<T> { return firstValueFrom(this.http.post<T>(`${this.base}${ruta}`, body)); }
  private patch<T>(ruta: string, body: unknown): Promise<T> { return firstValueFrom(this.http.patch<T>(`${this.base}${ruta}`, body)); }

  // Resumen
  resumen(usuario?: string | null) { return this.get<ResumenBandeja>('/bandeja/resumen', { usuario }); }

  // Cuentas
  aviso() { return this.get<Aviso>('/bandeja/aviso'); }
  cuentas(usuario?: string | null) { return this.get<Cuenta[]>('/bandeja/cuentas', { usuario }); }
  vincularCorreo(b: Record<string, unknown>) { return this.post<Cuenta>('/bandeja/cuentas/correo', b); }
  vincularWhatsapp(b: Record<string, unknown>) { return this.post<Cuenta>('/bandeja/cuentas/whatsapp', b); }
  vinculacion(id: string) { return this.get<Vinculacion>(`/bandeja/cuentas/${id}/vinculacion`); }
  codigoVinculacion(id: string, telefono: string) { return this.post<{ codigo: string }>(`/bandeja/cuentas/${id}/codigo`, { telefono }); }
  ajustarCuenta(id: string, b: Record<string, unknown>) { return this.patch<Cuenta>(`/bandeja/cuentas/${id}`, b); }
  reintentar(id: string) { return this.post<Cuenta & { nuevos?: number }>(`/bandeja/cuentas/${id}/reintentar`); }
  desvincular(id: string, borrarHistorial: boolean) {
    return firstValueFrom(this.http.delete<{ ok: boolean }>(`${this.base}/bandeja/cuentas/${id}`, { params: { borrar_historial: String(borrarHistorial), borrarHistorial: String(borrarHistorial) } }));
  }

  // Hilos
  hilos(f: { usuario?: string | null; vista?: string; canal?: string | null; cuenta?: string | null; contacto?: string | null; prioridad?: string | null; q?: string | null; pagina?: number; tamano?: number }) {
    return this.get<Pagina<HiloResumen>>('/bandeja/hilos', f);
  }
  hilo(id: string) { return this.get<HiloDetalle>(`/bandeja/hilos/${id}`); }
  masMensajes(id: string, antesDe: number) { return this.get<{ mensajes: MensajeVista[]; hay_mas: boolean }>(`/bandeja/hilos/${id}/mensajes`, { antesDe }); }
  leido(id: string) { return this.post<{ ok: boolean }>(`/bandeja/hilos/${id}/leido`); }
  estado(id: string, estado: 'RESUELTO' | 'ARCHIVADO' | 'ABIERTO', nota?: string) { return this.post<{ estado: string }>(`/bandeja/hilos/${id}/estado`, { estado, nota }); }
  marcar(id: string, b: { ignorado?: boolean; fijado?: boolean; prioridad?: string }) { return this.patch<{ ok: boolean; estado: string }>(`/bandeja/hilos/${id}`, b); }
  analizar(id: string) { return this.post<{ ok: boolean; compromisos_nuevos?: number }>(`/bandeja/hilos/${id}/analizar`); }
  htmlMensaje(id: number) { return firstValueFrom(this.http.get(`${this.base}/bandeja/mensajes/${id}/html`, { responseType: 'text' })); }
  urlAdjunto(id: string) { return `${this.base}/bandeja/adjuntos/${id}`; }

  // Compromisos
  compromisos(f: { usuario?: string | null; vista?: string; tipo?: string | null; contacto?: string | null; hilo?: string | null }) {
    return this.get<Compromiso[]>('/bandeja/compromisos', f);
  }
  crearCompromiso(b: { hilo_id?: string | null; contacto_id?: string | null; tipo: string; descripcion: string; quien?: string | null; vence_en?: string | null }) {
    return this.post<Compromiso>('/bandeja/compromisos', b);
  }
  actualizarCompromiso(id: string, b: { estado?: string; descripcion?: string; tipo?: string; vence_en?: string | null; quitar_vencimiento?: boolean; nota?: string }) {
    return this.patch<Compromiso>(`/bandeja/compromisos/${id}`, b);
  }
  historialCompromiso(id: string) { return this.get<{ tipo: string; descripcion: string; actor_nombre: string | null; creado_en: string }[]>(`/bandeja/compromisos/${id}/historial`); }

  // Contactos
  contactos(f: { usuario?: string | null; q?: string | null; etapa?: string | null; orden?: string | null; pagina?: number; tamano?: number }) {
    return this.get<Pagina<Contacto>>('/bandeja/contactos', f);
  }
  contacto(id: string) { return this.get<ContactoDetalle>(`/bandeja/contactos/${id}`); }
  actualizarContacto(id: string, b: Partial<Pick<Contacto, 'nombre' | 'organizacion' | 'cargo' | 'etapa'>> & { etiquetas?: string[] }) {
    return this.patch<Contacto>(`/bandeja/contactos/${id}`, b);
  }
  nota(id: string, texto: string) { return this.post<{ ok: boolean }>(`/bandeja/contactos/${id}/notas`, { texto }); }
  fusionar(id: string, otro: string) { return this.post<Contacto>(`/bandeja/contactos/${id}/fusionar/${otro}`); }

  // Tareas, equipo, accesos y parámetros
  sincronizarTareas() { return this.post<{ cambios: number }>('/bandeja/tareas/sincronizar'); }
  equipo() { return this.get<MiembroEquipo[]>('/bandeja/equipo'); }
  accesos(usuario?: string | null) { return this.get<AccesoSupervision[]>('/bandeja/accesos', { usuario }); }
  parametros() { return this.get<ParametroSeguimiento[]>('/config'); }
  guardarParametro(clave: string, valor: string) { return firstValueFrom(this.http.put<{ ok: boolean }>(`${this.base}/config/${clave}`, { valor })); }
}
