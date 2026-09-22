import { Injectable, inject } from '@angular/core';
import { ApplicationRef } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { concat, interval } from 'rxjs';
import { filter, first } from 'rxjs/operators';

import { detectarPlataforma } from '../security/plataforma.util';

/** Cada cuánto se le pregunta al servidor si hay versión nueva (30 min). */
const INTERVALO_CHEQUEO_MS = 30 * 60 * 1000;
/** Al navegar también se pregunta, pero no más de una vez cada 2 min. */
const CHEQUEO_ENTRE_NAVEGACIONES_MS = 2 * 60 * 1000;
/** Cómo se ve, en el error de navegación, un bundle que ya no existe en el servidor. */
const PATRON_CHUNK_PERDIDO = /Loading chunk|ChunkLoadError|dynamically imported module|Failed to fetch|Importing a module script failed|error loading/i;
const CLAVE_RECARGA = 'tuapo.recarga-por-chunk';

/**
 * Gobierna las actualizaciones cuando la app corre con service worker.
 *
 * Sin service worker el despliegue se veía al recargar y punto. Con él, el
 * navegador sigue sirviendo la versión cacheada aunque el servidor ya tenga
 * otra: si nadie avisa, la gente se queda semanas en una versión vieja sin
 * enterarse. Aquí se detecta la versión nueva, se ofrece recargar, y si el
 * estado local queda corrupto (caché borrada a medias) se fuerza la recarga.
 *
 * LO QUE PASABA TRAS UN DESPLIEGUE. El shell viejo (el que el service worker
 * tenía cacheado) no conoce las pantallas nuevas: la ruta cae al comodín de
 * formularios dinámicos y la persona ve "no se pudo abrir el formulario", que
 * lee como "acceso denegado". Y una pantalla que sí existía pedía un chunk
 * con hash viejo que el servidor ya no tiene (404). Por eso ahora:
 *  1. al navegar se pregunta por versión nueva (acotado a una vez cada 2 min);
 *  2. con versión lista y nada a medio escribir, se activa y recarga sola; si
 *     hay un formulario sucio, se recarga en la siguiente navegación;
 *  3. un error de navegación por chunk perdido recarga en la ruta destino
 *     (una sola vez por ruta, para no entrar en bucle).
 */
@Injectable({ providedIn: 'root' })
export class ActualizacionAppService {
  private readonly updates = inject(SwUpdate);
  private readonly snack = inject(MatSnackBar);
  private readonly appRef = inject(ApplicationRef);
  private readonly router = inject(Router);

  private iniciado = false;
  private versionLista = false;
  private ultimoChequeo = 0;

  iniciar(): void {
    if (this.iniciado) return;
    this.iniciado = true;

    // Con o sin service worker: un chunk perdido se cura recargando en la ruta destino.
    this.router.events.pipe(filter((e): e is NavigationError => e instanceof NavigationError))
      .subscribe(e => this.alFallarNavegacion(e));
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => { try { if (sessionStorage.getItem(CLAVE_RECARGA) === e.urlAfterRedirects) sessionStorage.removeItem(CLAVE_RECARGA); } catch { /* sin storage */ } });

    if (!this.updates.isEnabled) return;

    this.updates.versionUpdates.subscribe(evento => {
      if (evento.type === 'VERSION_READY') {
        this.versionLista = true;
        if (this.nadaAMedioEscribir()) this.activarYRecargar(this.router.url);
        else this.ofrecerRecarga();
      }
    });

    // Caché inconsistente: el service worker ya no puede servir la app. Recargar
    // es la única salida, y hacerlo en silencio es peor que avisar.
    this.updates.unrecoverable.subscribe(() => {
      this.snack
        .open('La aplicación necesita recargarse para continuar.', 'Recargar', { duration: 0 })
        .onAction()
        .subscribe(() => this.recargar());
    });

    // Al navegar: si ya hay versión lista, se estrena en la ruta destino; si no,
    // se pregunta por una (acotado).
    this.router.events.pipe(filter((e): e is NavigationStart => e instanceof NavigationStart)).subscribe(e => {
      if (this.versionLista) { this.activarYRecargar(e.url); return; }
      const ahora = Date.now();
      if (ahora - this.ultimoChequeo > CHEQUEO_ENTRE_NAVEGACIONES_MS) {
        this.ultimoChequeo = ahora;
        this.updates.checkForUpdate().catch(() => { /* sin red: se reintenta luego */ });
      }
    });

    // Sondeo periódico, pero solo cuando la app ya está estable: preguntar
    // durante el arranque compite con la carga inicial y la hace más lenta.
    const estable$ = this.appRef.isStable.pipe(first(estable => estable === true));
    concat(estable$, interval(INTERVALO_CHEQUEO_MS)).subscribe(() => {
      this.updates.checkForUpdate().catch(() => { /* sin red: se reintenta luego */ });
    });
  }

  /** Verdadero si no hay ningún control de formulario modificado sin guardar. */
  private nadaAMedioEscribir(): boolean {
    if (typeof document === 'undefined') return true;
    const activo = document.activeElement;
    if (activo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activo.tagName) && (activo as HTMLInputElement).value) return false;
    return !document.querySelector('.ng-dirty');
  }

  private alFallarNavegacion(e: NavigationError): void {
    const mensaje = String((e.error as { message?: string } | undefined)?.message ?? e.error ?? '');
    if (!PATRON_CHUNK_PERDIDO.test(mensaje)) return;
    try {
      if (sessionStorage.getItem(CLAVE_RECARGA) === e.url) return; // ya se recargó por esta ruta: no insistir
      sessionStorage.setItem(CLAVE_RECARGA, e.url);
    } catch { /* sin storage: se recarga igual, una vez */ }
    this.activarYRecargar(e.url);
  }

  /** Activa la versión nueva (si la hay) y recarga la página en la ruta pedida. */
  private async activarYRecargar(url: string): Promise<void> {
    this.versionLista = false;
    try { if (this.updates.isEnabled) await this.updates.activateUpdate(); } catch { /* la recarga normal también trae la versión nueva */ }
    try {
      // La app enruta por hash: cambiar el hash no recarga, así que se fija y luego se recarga.
      if (url && url.startsWith('/')) window.location.hash = url;
    } catch { /* sin location: la recarga basta */ }
    this.recargar();
  }

  /** Única costura hacia la recarga real: los specs la reemplazan y nunca recargan la página de Karma. */
  protected recargar(): void {
    document.location.reload();
  }

  private ofrecerRecarga(): void {
    this.snack
      .open('Hay una versión nueva de Tu Apo.', 'Actualizar', { duration: 0 })
      .onAction()
      .subscribe(() => this.activarYRecargar(this.router.url));
  }
}

/**
 * Dónde tiene sentido registrar el service worker.
 *
 * - Electron carga con `file://`: ahí no hay registro posible.
 * - En el APK los assets YA viajan dentro del paquete; meter otra capa de caché
 *   solo añade la posibilidad de servir la versión anterior tras actualizar.
 * - SSR no tiene navegador.
 */
export function serviceWorkerHabilitado(produccion: boolean): boolean {
  if (!produccion) return false;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (detectarPlataforma() !== 'web') return false;
  // isSecureContext cubre https y también localhost/127.0.0.1, que es donde se
  // verifica la imagen antes de publicarla.
  return location.protocol === 'https:' || window.isSecureContext === true;
}
