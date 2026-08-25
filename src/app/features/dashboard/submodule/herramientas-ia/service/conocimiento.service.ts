import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@/environments/environment';

// ── DTOs (mirror de KbDtos.java) ─────────────────────────────────────────────

export interface DocDto {
  id: number; nombre: string; tipoMime: string; modulos: string[];
  longitud: number; preview: string | null; usuarioId: string;
  createdAt: string | number; updatedAt: string | number | null;
}

export interface SubirDocReq {
  nombre: string; tipoMime: string; contenido: string; modulos: string[];
}

@Injectable({ providedIn: 'root' })
export class ConocimientoService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/ia/conocimiento`;

  listarDocumentos(): Observable<DocDto[]> {
    return this.http.get<DocDto[]>(`${this.base}/documentos`);
  }

  subirDocumento(req: SubirDocReq): Observable<DocDto> {
    return this.http.post<DocDto>(`${this.base}/documentos`, req);
  }

  actualizarModulos(id: number, modulos: string[]): Observable<DocDto> {
    return this.http.put<DocDto>(`${this.base}/documentos/${id}/modulos`, { modulos });
  }

  eliminarDocumento(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/documentos/${id}`);
  }

  /** Sube un archivo binario (PDF/DOCX/TXT) procesado server-side. Para la KB jurídica. */
  subirBinario(archivo: File, nombre: string, modulos: string[] = ['legal']): Observable<DocDto> {
    const fd = new FormData();
    fd.append('archivo', archivo, archivo.name);
    fd.append('nombre', nombre);
    fd.append('modulos', JSON.stringify(modulos));
    return this.http.post<DocDto>(`${this.base}/documentos/upload-binario`, fd);
  }
}
