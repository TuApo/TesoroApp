import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { take } from 'rxjs';

import { environment } from '@/environments/environment';

/**
 * LOS ARCHIVOS QUE VIVEN DETRÁS DE LA API.
 *
 * El backend no devuelve URLs que un `<img>` pueda pintar: devuelve RUTAS
 * —`/gestion_contratacion/biometria/file/{cedula}/firma`,
 * `/api/v1/documents/{id}/download?versionId=…`— y encima protegidas. Dos
 * problemas encadenados:
 *
 * 1. Relativas. Puestas en un `<img>` o un `<iframe>` el navegador las resuelve
 *    contra `tesoro.tuapo.co`, donde no hay proxy a la API: nginx contesta el
 *    `index.html` de la propia aplicación. La imagen sale rota y la descarga
 *    baja un HTML.
 * 2. Protegidas. Aunque se les ponga delante `api.tuapo.co`, un `<img>` no
 *    manda cabeceras: el gateway responde **401**.
 *
 * Por eso la firma quedaba guardada en el servidor y en pantalla decía "Sin
 * registrar", y la foto del candidato caía siempre a las iniciales.
 *
 * Aquí se resuelve una sola vez: la ruta se completa contra `apiUrl` y se pide
 * con `HttpClient` —que sí lleva el token por el interceptor— para servirla
 * como `blob:` local. Lo ya descargado se guarda en una señal, así que el
 * `<img>` se pinta solo en cuanto llega, sin que el llamador orqueste nada.
 */
@Injectable({ providedIn: 'root' })
export class ArchivosBackendService {
  private readonly http = inject(HttpClient);
  private readonly base = (environment.apiUrl || '').replace(/\/$/, '');

  /** Ruta absoluta del backend → `blob:` local ya descargado. */
  private readonly listos = signal<ReadonlyMap<string, string>>(new Map());
  /** Descargas en vuelo, para no pedir dos veces el mismo archivo. */
  private readonly enCurso = new Set<string>();
  /** Rutas que fallaron: sin esto el `<img>` reintentaría en cada repintado. */
  private readonly fallidas = new Set<string>();

  /** `data:` y `blob:` ya son pintables; no hay nada que resolver. */
  private esDirecta(u: string): boolean {
    return /^(data:|blob:)/i.test(u);
  }

  /** URL absoluta que NO es de nuestra API. */
  private esAjena(u: string): boolean {
    return /^https?:\/\//i.test(u) && !!this.base && !u.startsWith(this.base);
  }

  /** La ruta del backend, completa. `null` si no hay nada que completar. */
  absoluta(u: string | null | undefined): string | null {
    const s = (u ?? '').toString().trim();
    if (!s) return null;
    if (this.esDirecta(s) || /^https?:\/\//i.test(s)) return s;
    return `${this.base}/${s.replace(/^\//, '')}`;
  }

  /**
   * URL que el navegador SÍ puede pintar, o `null` mientras llega.
   *
   * Devolver `null` en vez de esperar es a propósito: quien llama es una
   * plantilla o un `computed`, y en cuanto la descarga termina la señal
   * `listos` los vuelve a evaluar con la URL buena.
   */
  visible(u: string | null | undefined): string | null {
    const s = (u ?? '').toString().trim();
    if (!s) return null;
    if (this.esDirecta(s)) return s;
    // Servidor ajeno (el media legacy del formulario, por ejemplo): ahí no hay
    // token que poner y pedirlo por HttpClient solo añadiría un problema de
    // CORS. Se pinta tal cual, que es como funcionaba.
    if (this.esAjena(s)) return s;
    const abs = this.absoluta(s)!;
    const ya = this.listos().get(abs);
    if (ya) return ya;
    if (!this.fallidas.has(abs)) this.descargar(abs);
    return null;
  }

  private descargar(abs: string): void {
    if (this.enCurso.has(abs)) return;
    this.enCurso.add(abs);
    this.http.get(abs, { responseType: 'blob' }).pipe(take(1)).subscribe({
      next: (b) => {
        this.enCurso.delete(abs);
        if (!b || b.size === 0) { this.fallidas.add(abs); return; }
        this.listos.update((m) => new Map(m).set(abs, URL.createObjectURL(b)));
      },
      error: () => {
        this.enCurso.delete(abs);
        this.fallidas.add(abs);
      },
    });
  }

  /** El archivo en crudo, para quien necesita los bytes (unir PDFs). */
  blob(u: string | null | undefined) {
    const abs = this.absoluta(u);
    return this.http.get(abs ?? '', { responseType: 'blob' });
  }

  /**
   * Guardarlo en el disco del usuario.
   *
   * No vale un `<a href>` a la ruta del backend: sin token baja un 401, y
   * contra el origen del front baja el `index.html` de la aplicación.
   */
  descargarComo(u: string | null | undefined, nombre: string): void {
    this.blob(u).pipe(take(1)).subscribe({
      next: (b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombre || 'documento';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      },
      error: () => { /* el llamador ya avisa; aquí no hay nada que reintentar */ },
    });
  }

  /**
   * Olvida lo descargado de una ruta (o todo).
   *
   * Se llama cuando el archivo CAMBIA en el servidor —volver a firmar, retomar
   * la foto—: sin esto seguiría pintándose el `blob:` de la versión anterior,
   * que es exactamente la queja de "firmé otra vez y sigue igual".
   */
  invalidar(u?: string | null): void {
    const abs = u ? this.absoluta(u) : null;
    const mapa = this.listos();
    if (!abs) {
      for (const url of mapa.values()) URL.revokeObjectURL(url);
      this.listos.set(new Map());
      this.fallidas.clear();
      return;
    }
    const url = mapa.get(abs);
    if (url) URL.revokeObjectURL(url);
    const nuevo = new Map(mapa);
    nuevo.delete(abs);
    this.listos.set(nuevo);
    this.fallidas.delete(abs);
  }
}
