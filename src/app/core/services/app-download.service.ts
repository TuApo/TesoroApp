import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';

/**
 * Manifiesto de la última versión publicada. Lo escriben los scripts de build:
 * build-electron.sh (version/filename/url/sizeMB) y build-android.sh (apk*).
 * Caddy lo sirve desde /srv/downloads → https://tesoro.tuapo.co/downloads/latest.json
 */
export interface AppRelease {
  version: string;
  filename: string;
  url: string;
  releaseDate: string;
  sizeMB: number;
  apkFilename?: string;
  apkUrl?: string;
  apkSizeMB?: number;
  /** Enlace de instalación para iOS (App Store / TestFlight) cuando exista build. */
  iosUrl?: string;
  /** Paquete del agente de huella para navegador (publicar-agente-huella.sh). */
  agenteFilename?: string;
  agenteUrl?: string;
  agenteSizeMB?: number;
  agenteVersion?: string;
}

/** Sitio público donde Caddy sirve /downloads (ver infrastructure/caddy/Caddyfile). */
const ORIGEN_PUBLICO = 'https://tesoro.tuapo.co';

/**
 * Fuente única de las descargas de la app.
 *
 * El manifiesto se pedía por separado en el login y en Parametrización; ahora que
 * la descarga vive en el menú de perfil (se abre muchas veces por sesión) se
 * cachea: una sola petición por carga de la aplicación.
 */
@Injectable({ providedIn: 'root' })
export class AppDownloadService {
  private readonly http = inject(HttpClient);
  private cache?: Observable<AppRelease | null>;

  /**
   * Dónde vive el manifiesto según el envoltorio.
   *
   * En el navegador la app y los instaladores comparten origen, así que basta
   * la ruta relativa. Dentro del .exe el origen es `file://` y dentro del APK
   * es `https://localhost`: ahí la ruta relativa apunta a la nada y hay que ir
   * al sitio público (por eso el Caddyfile manda CORS en /downloads y la CSP
   * de index.html lista tesoro.tuapo.co en connect-src).
   */
  private get urlManifiesto(): string {
    if (typeof location === 'undefined') return `${ORIGEN_PUBLICO}/downloads/latest.json`;
    const esWeb = /^https?:$/.test(location.protocol) && location.hostname !== 'localhost';
    return esWeb ? '/downloads/latest.json' : `${ORIGEN_PUBLICO}/downloads/latest.json`;
  }

  /** Una URL de /downloads lista para abrir desde cualquier envoltorio. */
  urlAbsoluta(ruta: string): string {
    if (/^https?:\/\//.test(ruta)) return ruta;
    if (this.urlManifiesto.startsWith('/')) return ruta;
    return `${ORIGEN_PUBLICO}${ruta.startsWith('/') ? '' : '/'}${ruta}`;
  }

  /** Última versión publicada, o null si aún no hay instaladores en /downloads. */
  release(): Observable<AppRelease | null> {
    this.cache ??= this.http.get<AppRelease>(this.urlManifiesto).pipe(
      catchError(() => of(null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.cache;
  }

  /** Dispara la descarga de un archivo publicado en /downloads. */
  descargar(url: string, filename?: string): void {
    if (typeof document === 'undefined') return;
    const a = document.createElement('a');
    a.href = this.urlAbsoluta(url);
    if (filename) a.download = filename;
    a.rel = 'noopener';
    a.click();
  }
}

/**
 * Compara dos versiones «10.1.0» sin traerse una librería.
 * Devuelve true si `candidata` es posterior a `actual`.
 */
export function esVersionPosterior(candidata: string, actual: string): boolean {
  const partes = (v: string) => (v || '').split('.').map(n => parseInt(n, 10) || 0);
  const a = partes(candidata);
  const b = partes(actual);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
