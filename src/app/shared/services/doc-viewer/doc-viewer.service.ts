import { Injectable } from '@angular/core';
import { environment } from '@/environments/environment';

/**
 * Visor de documentos centralizado. El gateway exige JWT en /api/v1/** y el front usa
 * window.open/iframe/fetch-nativo que NO llevan el token (interceptor solo aplica a HttpClient).
 * Ademas los file_url pueden venir RELATIVOS (se resolverian contra el host del front -> blanco)
 * y la API manda X-Frame-Options: deny (no se puede enmarcar directo). Solucion: descargar con
 * Authorization (fetch) -> blob y usar el blob (abrir/enmarcar). Media legacy (formulario) es
 * publica -> se usa tal cual.
 */
@Injectable({ providedIn: 'root' })
export class DocViewerService {

  private apiBase(): string {
    const b = (environment as any)?.apiUrl || '';
    return b.endsWith('/') ? b.slice(0, -1) : b;
  }

  private authHeader(): Record<string, string> {
    try {
      let raw = localStorage.getItem('token') || localStorage.getItem('Authorization');
      if (!raw) {
        const u = localStorage.getItem('user');
        if (u) {
          const user = JSON.parse(u);
          raw = user?.token || user?.jwt || user?.access_token || user?.accessToken || null;
        }
      }
      if (!raw) return {};
      return { Authorization: raw.startsWith('Bearer ') ? raw : `Bearer ${raw}` };
    } catch {
      return {};
    }
  }

  private toAbsolute(url: string): string {
    if (/^https?:\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:')) return url;
    return this.apiBase() + (url.startsWith('/') ? url : '/' + url);
  }

  /** Resuelve una URL (posiblemente relativa) a absoluta contra la API base. */
  absolute(url: string): string { return this.toAbsolute(url); }

  /** true si la URL apunta al gateway/API (necesita JWT). Media legacy (formulario) = false. */
  isApiUrl(url: string): boolean {
    if (!url) return false;
    const abs = this.toAbsolute(url);
    return abs.startsWith(this.apiBase()) ||
      /\/api\/v1\/documents\//.test(abs) ||
      /\/gestion_documental\//.test(abs);
  }

  /**
   * Descarga el contenido del documento como Blob, poniendo el JWT cuando la URL es de la API.
   *
   * Es el unico camino correcto para bajar un documento fuera de HttpClient: el interceptor de
   * Angular NO toca `fetch` nativo, asi que un `fetch(file_url)` a pelo sale sin Authorization y
   * el gateway lo corta con 401 (X-Auth-Reason: missing_token). Los file_url del media legacy
   * (formulario) son publicos y se bajan sin cabecera.
   *
   * Devuelve null si la descarga falla (incluido el 401), para que quien empaqueta pueda contar
   * los fallidos en vez de romper el lote entero.
   */
  async fetchBlob(url: string | null | undefined): Promise<Blob | null> {
    if (!url) return null;
    const abs = this.toAbsolute(url);
    try {
      const res = await fetch(abs, this.isApiUrl(abs) ? { headers: this.authHeader() } : {});
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const type = DocViewerService.sniffType(buf, res.headers.get('content-type'));
      return new Blob([buf], { type });
    } catch {
      return null;
    }
  }

  /**
   * Descarga el documento y devuelve un blob URL usable en iframe/img/open. Para blob:/data:
   * lo devuelve tal cual; para media legacy (no-API) devuelve la URL absoluta directa (publica);
   * para la API descarga con JWT. Devuelve null si falla.
   */
  async toBlobUrl(url: string | null | undefined): Promise<string | null> {
    if (!url) return null;
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    const abs = this.toAbsolute(url);
    if (!this.isApiUrl(abs)) return abs; // media legacy / otro host publico
    // Muchos docs tienen mime_type 'application/octet-stream' en BD → el navegador los
    // DESCARGA en vez de previsualizarlos. `fetchBlob` detecta el tipo real por magic bytes
    // para que el iframe / la pestaña nueva los MUESTREN (PDF/imagen).
    const blob = await this.fetchBlob(abs);
    return blob ? URL.createObjectURL(blob) : null;
  }

  /** Detecta el content-type real por magic bytes (mime_type en BD suele ser octet-stream). */
  static sniffType(buf: ArrayBuffer, declared: string | null): string {
    const b = new Uint8Array(buf.slice(0, 8));
    if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'; // %PDF
    if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    const d = (declared || '').split(';')[0].trim();
    if (d && d !== 'application/octet-stream') return d;
    return 'application/octet-stream';
  }

  /** Abre el documento en una pestana nueva (reserva la ventana en el gesto de click). */
  async openInNewTab(url: string | null | undefined): Promise<boolean> {
    if (!url) return false;
    const win = window.open('', '_blank');
    const blobUrl = await this.toBlobUrl(url);
    if (blobUrl) {
      if (win) { win.location.href = blobUrl; } else { window.open(blobUrl, '_blank'); }
      if (blobUrl.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
      return true;
    }
    if (win) win.close();
    return false;
  }
}
