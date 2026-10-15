import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom, shareReplay } from 'rxjs';

import { environment } from '@/environments/environment';
import {
  ArchivoChat, ConversacionChat, EstadoChatIa, FacetasBandeja, FiltrosBandeja, MensajeChat, ModuloChatIa, PaginaBandeja,
} from './chat-ia.modelos';

/**
 * Cliente del chat de IA estándar (ms-ai `/api/v1/ai/chat`). Todas las llamadas responden al
 * instante: la respuesta de la IA, leer un archivo y generar la voz ocurren en el servidor en
 * segundo plano y aquí se consultan hasta que terminan.
 */
@Injectable({ providedIn: 'root' })
export class ChatIaService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/v1/ai/chat`;
  private estado$?: Observable<EstadoChatIa>;

  estado(): Observable<EstadoChatIa> {
    this.estado$ ??= this.http.get<EstadoChatIa>(`${this.base}/estado`).pipe(shareReplay({ bufferSize: 1, refCount: false }));
    return this.estado$;
  }

  modulo(clave: string, nombre?: string): Observable<ModuloChatIa> {
    let p = new HttpParams();
    if (nombre) p = p.set('nombre', nombre);
    return this.http.get<ModuloChatIa>(`${this.base}/modulos/${encodeURIComponent(clave)}`, { params: p });
  }

  modulos(): Observable<ModuloChatIa[]> {
    return this.http.get<ModuloChatIa[]>(`${this.base}/modulos`);
  }

  // ── Conversaciones ──

  bandeja(f: FiltrosBandeja): Observable<PaginaBandeja> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
    return this.http.get<PaginaBandeja>(`${this.base}/conversaciones`, { params: p });
  }

  facetas(todas = false): Observable<FacetasBandeja> {
    return this.http.get<FacetasBandeja>(`${this.base}/conversaciones/facetas`, { params: { todas } });
  }

  delModulo(modulo: string, tienda?: string | null): Observable<ConversacionChat[]> {
    let p = new HttpParams().set('modulo', modulo);
    if (tienda) p = p.set('tienda', tienda);
    return this.http.get<ConversacionChat[]>(`${this.base}/conversaciones/del-modulo`, { params: p });
  }

  conversacion(id: number): Observable<{ conversacion: ConversacionChat; mensajes: MensajeChat[] }> {
    return this.http.get<{ conversacion: ConversacionChat; mensajes: MensajeChat[] }>(`${this.base}/conversaciones/${id}`);
  }

  actualizar(id: number, cambios: Partial<Pick<ConversacionChat, 'titulo' | 'archivada' | 'fijada'>>): Observable<ConversacionChat> {
    return this.http.patch<ConversacionChat>(`${this.base}/conversaciones/${id}`, cambios);
  }

  // ── Mensajes ──

  enviar(cuerpo: {
    conversacionId?: number | null; texto: string; adjuntos: string[]; viaVoz: boolean; usuarioNombre?: string | null;
    contexto: Record<string, unknown>;
  }): Observable<{ conversacion: ConversacionChat; mensajes: MensajeChat[] }> {
    return this.http.post<{ conversacion: ConversacionChat; mensajes: MensajeChat[] }>(`${this.base}/mensajes`, cuerpo);
  }

  mensaje(id: number): Observable<MensajeChat> {
    return this.http.get<MensajeChat>(`${this.base}/mensajes/${id}`);
  }

  voz(mensajeId: number): Observable<ArchivoChat> {
    return this.http.post<ArchivoChat>(`${this.base}/mensajes/${mensajeId}/voz`, {});
  }

  // ── Archivos ──

  subir(archivo: Blob, nombre: string, conversacionId?: number | null): Observable<ArchivoChat> {
    const fd = new FormData();
    fd.append('archivo', archivo, nombre);
    let p = new HttpParams();
    if (conversacionId) p = p.set('conversacionId', conversacionId);
    return this.http.post<ArchivoChat>(`${this.base}/archivos`, fd, { params: p });
  }

  archivo(id: string): Observable<ArchivoChat> {
    return this.http.get<ArchivoChat>(`${this.base}/archivos/${id}`);
  }

  contenido(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/archivos/${id}/contenido`, { responseType: 'blob' });
  }

  texto(id: string): Observable<{ texto: string }> {
    return this.http.get<{ texto: string }>(`${this.base}/archivos/${id}/texto`);
  }

  diapositivas(id: string): Observable<{ total: number }> {
    return this.http.get<{ total: number }>(`${this.base}/archivos/${id}/diapositivas`);
  }

  diapositiva(id: string, n: number): Observable<Blob> {
    return this.http.get(`${this.base}/archivos/${id}/diapositivas/${n}`, { responseType: 'blob' });
  }

  /** Espera a que un archivo deje de estar PENDIENTE (lectura de adjunto o voz). */
  async esperarArchivo(id: string, topeMs = 120_000, cada = 900): Promise<ArchivoChat> {
    const fin = Date.now() + topeMs;
    let a = await firstValueFrom(this.archivo(id));
    while (a.estado === 'PENDIENTE' && Date.now() < fin) {
      await new Promise(r => setTimeout(r, cada));
      a = await firstValueFrom(this.archivo(id));
    }
    return a;
  }

  /** Descarga con su nombre (el JWT lo pone el interceptor; un <a href> directo no lo llevaría). */
  async descargar(a: Pick<ArchivoChat, 'id' | 'nombre'>): Promise<void> {
    const blob = await firstValueFrom(this.contenido(a.id));
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = a.nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
