import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { esNativo } from './nativo';

/**
 * Red y ciclo de vida del teléfono con los plugins nativos (`@capacitor/network`,
 * `@capacitor/app`): el sistema avisa al instante cuando vuelve la señal o cuando la app vuelve
 * a primer plano, que es justo cuando hay que sincronizar lo pendiente. En web usa los eventos
 * `online`/`offline` y `visibilitychange`.
 */
@Injectable({ providedIn: 'root' })
export class CicloNativoService {
  private readonly zona = inject(NgZone);

  /** Hay red según el SISTEMA (no garantiza que el servidor responda). */
  readonly conRed = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly tipoRed = signal<string>('desconocida');
  /** Se emite al volver la red y al volver la app a primer plano. */
  readonly momentoDeSincronizar$ = new Subject<'red' | 'reanudar'>();

  private iniciado = false;

  iniciar(): void {
    if (this.iniciado || typeof window === 'undefined') return;
    this.iniciado = true;
    if (esNativo()) {
      void import('@capacitor/network').then(async ({ Network }) => {
        const s = await Network.getStatus();
        this.zona.run(() => { this.conRed.set(s.connected); this.tipoRed.set(s.connectionType); });
        await Network.addListener('networkStatusChange', e => this.zona.run(() => {
          const antes = this.conRed();
          this.conRed.set(e.connected);
          this.tipoRed.set(e.connectionType);
          if (e.connected && !antes) this.momentoDeSincronizar$.next('red');
        }));
      }).catch(() => undefined);
      void import('@capacitor/app').then(({ App }) => App.addListener('appStateChange', e => {
        if (e.isActive) this.zona.run(() => this.momentoDeSincronizar$.next('reanudar'));
      })).catch(() => undefined);
      return;
    }
    window.addEventListener('online', () => { this.conRed.set(true); this.momentoDeSincronizar$.next('red'); });
    window.addEventListener('offline', () => this.conRed.set(false));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.momentoDeSincronizar$.next('reanudar');
    });
  }
}
