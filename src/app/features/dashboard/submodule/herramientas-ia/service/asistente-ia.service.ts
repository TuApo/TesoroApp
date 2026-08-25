import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

// ── DTOs (mirror de AsistenteDtos.java) ──────────────────────────────────────

export interface ModuloDisponible {
  clave: string; nombre: string; descripcion: string; icono: string;
}

export interface FolderAst {
  id: number; nombre: string; color: string | null; orden: number | null; conversaciones: number;
}

export interface ConvAst {
  id: number; folderId: number | null; titulo: string; modelo: string | null;
  modulos: string[]; archivada: boolean; createdAt: number | string; updatedAt: number | string;
}

export interface MensajeAst {
  id: number; rol: 'user' | 'assistant' | 'system'; contenido: string;
  adjuntosJson: string | null; createdAt: number | string;
}

export interface ConvDetalleAst { conversacion: ConvAst; mensajes: MensajeAst[]; }

export interface RespuestaAst { conversacionId: number; mensaje: MensajeAst; modeloUsado: string; }

export interface AdjuntoAst { nombre: string; tipo: string; tamano: number; textoExtraido?: string | null; }

export interface Capacidades { transcripcion: boolean; webSearch: boolean; }

export interface EnviarMensajeAstReq {
  contenido: string;
  modulos?: string[];
  adjuntos?: AdjuntoAst[];
  webSearch?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AsistenteIaService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/ia/asistente`;

  capacidades(): Observable<Capacidades> {
    return this.http.get<Capacidades>(`${this.base}/capacidades`);
  }

  transcribir(file: Blob, filename = 'audio.webm'): Observable<{ texto: string }> {
    const fd = new FormData();
    fd.append('file', file, filename);
    return this.http.post<{ texto: string }>(`${this.base}/transcribir`, fd);
  }

  modulosDisponibles(): Observable<ModuloDisponible[]> {
    return this.http.get<ModuloDisponible[]>(`${this.base}/modulos`);
  }

  // ── Carpetas ────────────────────────────────────────────────────────────────
  listarFolders(): Observable<FolderAst[]> {
    return this.http.get<FolderAst[]>(`${this.base}/folders`);
  }
  crearFolder(nombre: string, color?: string): Observable<FolderAst> {
    return this.http.post<FolderAst>(`${this.base}/folders`, { nombre, color });
  }
  actualizarFolder(id: number, body: { nombre?: string; color?: string; orden?: number }): Observable<FolderAst> {
    return this.http.put<FolderAst>(`${this.base}/folders/${id}`, body);
  }
  eliminarFolder(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/folders/${id}`);
  }

  // ── Conversaciones ──────────────────────────────────────────────────────────
  listarConversaciones(folderId?: number | null): Observable<ConvAst[]> {
    const params: any = {};
    if (folderId != null) params.folderId = folderId;
    return this.http.get<ConvAst[]>(`${this.base}/conversaciones`, { params });
  }
  obtenerConversacion(id: number): Observable<ConvDetalleAst> {
    return this.http.get<ConvDetalleAst>(`${this.base}/conversaciones/${id}`);
  }
  crearConversacion(body: { titulo?: string; folderId?: number | null; modulos?: string[] }): Observable<ConvAst> {
    return this.http.post<ConvAst>(`${this.base}/conversaciones`, body);
  }
  actualizarModulos(id: number, modulos: string[]): Observable<ConvAst> {
    return this.http.put<ConvAst>(`${this.base}/conversaciones/${id}/modulos`, { modulos });
  }
  moverConversacion(id: number, folderId: number | null): Observable<ConvAst> {
    return this.http.put<ConvAst>(`${this.base}/conversaciones/${id}/mover`, { folderId });
  }
  renombrarConversacion(id: number, titulo: string): Observable<ConvAst> {
    return this.http.put<ConvAst>(`${this.base}/conversaciones/${id}/renombrar`, { titulo });
  }
  eliminarConversacion(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/conversaciones/${id}`);
  }

  // ── Mensajes ────────────────────────────────────────────────────────────────
  enviarMensaje(conversacionId: number, body: EnviarMensajeAstReq): Observable<RespuestaAst> {
    return this.http.post<RespuestaAst>(`${this.base}/conversaciones/${conversacionId}/mensajes`, body);
  }
  enviarMensajeNuevo(body: EnviarMensajeAstReq): Observable<RespuestaAst> {
    return this.http.post<RespuestaAst>(`${this.base}/mensajes`, body);
  }
}
