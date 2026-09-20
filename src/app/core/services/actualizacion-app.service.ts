import { Injectable, inject } from '@angular/core';
import { ApplicationRef } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate } from '@angular/service-worker';
import { concat, interval } from 'rxjs';
import { first } from 'rxjs/operators';

import { detectarPlataforma } from '../security/plataforma.util';

/** Cada cuánto se le pregunta al servidor si hay versión nueva (30 min). */
const INTERVALO_CHEQUEO_MS = 30 * 60 * 1000;

/**
 * Gobierna las actualizaciones cuando la app corre con service worker.
 *
 * Sin service worker el despliegue se veía al recargar y punto. Con él, el
 * navegador sigue sirviendo la versión cacheada aunque el servidor ya tenga
 * otra: si nadie avisa, la gente se queda semanas en una versión vieja sin
 * enterarse. Aquí se detecta la versión nueva, se ofrece recargar, y si el
 * estado local queda corrupto (caché borrada a medias) se fuerza la recarga.
 */
@Injectable({ providedIn: 'root' })
export class ActualizacionAppService {
  private readonly updates = inject(SwUpdate);
  private readonly snack = inject(MatSnackBar);
  private readonly appRef = inject(ApplicationRef);

  private iniciado = false;

  iniciar(): void {
    if (this.iniciado || !this.updates.isEnabled) return;
    this.iniciado = true;

    this.updates.versionUpdates.subscribe(evento => {
      if (evento.type === 'VERSION_READY') {
        this.ofrecerRecarga();
      }
    });

    // Caché inconsistente: el service worker ya no puede servir la app. Recargar
    // es la única salida, y hacerlo en silencio es peor que avisar.
    this.updates.unrecoverable.subscribe(() => {
      this.snack
        .open('La aplicación necesita recargarse para continuar.', 'Recargar', { duration: 0 })
        .onAction()
        .subscribe(() => document.location.reload());
    });

    // Sondeo periódico, pero solo cuando la app ya está estable: preguntar
    // durante el arranque compite con la carga inicial y la hace más lenta.
    const estable$ = this.appRef.isStable.pipe(first(estable => estable === true));
    concat(estable$, interval(INTERVALO_CHEQUEO_MS)).subscribe(() => {
      this.updates.checkForUpdate().catch(() => { /* sin red: se reintenta luego */ });
    });
  }

  private ofrecerRecarga(): void {
    this.snack
      .open('Hay una versión nueva de Tu Apo.', 'Actualizar', { duration: 0 })
      .onAction()
      .subscribe(async () => {
        try {
          await this.updates.activateUpdate();
        } catch { /* si falla, la recarga normal también trae la versión nueva */ }
        document.location.reload();
      });
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
