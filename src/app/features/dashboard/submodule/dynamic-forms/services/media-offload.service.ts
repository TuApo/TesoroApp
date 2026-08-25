import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '@/environments/environment';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';
import { DocumentRef } from '../models/dynamic-forms.models';

/** Respuesta snake_case de upload-by-owner en ms-documents. */
interface UploadByOwnerResponse {
  document_id: number;
  version_id?: number;
  size_bytes?: number;
  mime_type?: string;
  deduplicated?: boolean;
}

/** Ajustes de una subida concreta; sin ellos se sube como adjunto de respuesta. */
export interface UploadOptions {
  /**
   * Tipo documental de ms-documents. El endpoint lo EXIGE (typeCode o typeId):
   * sin él responde 400 y la subida se pierde entera.
   */
  typeCode?: string;
  /**
   * Dueño del documento. ms-documents deduplica por (ownerId, typeCode): dos subidas
   * del mismo par NO son dos documentos, son dos versiones del mismo. Por eso lo que
   * conceptualmente es un documento distinto —la portada de otro formulario— necesita
   * su propio ownerId.
   */
  ownerId?: string;
}

/** Tipos sembrados por ms-documents V11 para lo que produce este módulo. */
export const TIPO_DOC_ADJUNTO = 'FORMULARIO_ADJUNTO';
export const TIPO_DOC_PORTADA = 'FORMULARIO_PORTADA';

/**
 * Offload de media hacia ms-documents. Parte del CONTRATO de envío (no un flag):
 * el payload solo lleva referencias {source, document_id, ...}; un File nativo jamás
 * se serializa. En modo autenticado el envío es FAIL-CLOSED: si esta subida falla,
 * la página ABORTA el submit completo (no se pierde media en silencio).
 */
@Injectable({ providedIn: 'root' })
export class MediaOffloadService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/v1/documents`;

  /** Sube UN archivo y devuelve la referencia que viaja en el payload. */
  upload(file: File, formId: number, opts: UploadOptions = {}): Observable<DocumentRef> {
    const fd = new FormData();
    fd.append('ownerId', opts.ownerId?.trim() || this.ownerId(formId));
    fd.append('typeCode', opts.typeCode || TIPO_DOC_ADJUNTO);
    fd.append('ownerType', 'DYNAMIC_FORM');
    fd.append('sourceService', 'tesoro-dynamic-forms');
    fd.append('legacyField', `dfform:${formId}`);
    fd.append('file', file, file.name);
    return this.http.post<UploadByOwnerResponse>(`${this.base}/upload-by-owner`, fd).pipe(
      map((r) => {
        if (!r || r.document_id == null) {
          throw new Error('ms-documents no confirmó la subida');
        }
        return {
          source: 'ms-documents' as const,
          document_id: r.document_id,
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          size: file.size,
        };
      }),
    );
  }

  /** URL de descarga (el auth.interceptor agrega el JWT; usar DocViewerService para abrir). */
  downloadUrl(ref: DocumentRef): string {
    return `${this.base}/${ref.document_id}/download`;
  }

  /**
   * Motivo legible de un fallo de subida. ms-documents responde
   * `{ok:false, error:"…"}` con el detalle real (tipo inexistente, 50 MB, I/O);
   * tragárselo dejaba al usuario con un "no se pudo" sin pista de qué arreglar.
   */
  motivoDeFallo(err: unknown, porDefecto: string): string {
    if (!(err instanceof HttpErrorResponse)) return porDefecto;
    const detalle = (err.error as { error?: string } | null)?.error;
    if (detalle) return detalle;
    if (err.status === 413) return 'El archivo pesa demasiado (máximo 50 MB).';
    if (err.status === 401 || err.status === 403) return 'La sesión no tiene permiso para subir archivos.';
    if (err.status === 0) return 'No hubo respuesta del servidor de documentos.';
    return porDefecto;
  }

  /** Owner del documento = usuario autenticado (helper canónico), fallback al formulario. */
  private ownerId(formId: number): string {
    const id = obtenerUsuarioActual().id;
    return id ? id : `dfform-${formId}`;
  }
}
