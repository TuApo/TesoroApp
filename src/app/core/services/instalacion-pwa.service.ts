import { Injectable, signal } from '@angular/core';

/** El evento que Chrome dispara cuando la app cumple los criterios de instalación. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Guarda la oportunidad de instalar la app.
 *
 * `beforeinstallprompt` se dispara UNA vez, al cargar, y si nadie lo captura se
 * pierde: por eso se escucha desde el arranque y no desde el diálogo, que se
 * abre mucho después. Chrome (Android y escritorio) y Edge lo implementan;
 * Safari nunca lo dispara — en iOS la instalación es manual desde Compartir.
 */
@Injectable({ providedIn: 'root' })
export class InstalacionPwaService {
  private evento: BeforeInstallPromptEvent | null = null;

  /** Hay un instalador nativo que ofrecer en este navegador. */
  readonly disponible = signal(false);
  /** La app ya corre instalada (ventana propia, sin barra del navegador). */
  readonly yaInstalada = signal(false);

  escuchar(): void {
    if (typeof window === 'undefined') return;

    this.yaInstalada.set(this.enModoApp());

    window.addEventListener('beforeinstallprompt', (e: Event) => {
      // Sin preventDefault, Chrome enseña su propio banner y el evento se gasta.
      e.preventDefault();
      this.evento = e as BeforeInstallPromptEvent;
      this.disponible.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.evento = null;
      this.disponible.set(false);
      this.yaInstalada.set(true);
    });
  }

  /** Lanza el diálogo del navegador. Devuelve si la persona aceptó. */
  async instalar(): Promise<boolean> {
    const e = this.evento;
    if (!e) return false;
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      // El evento no se puede reutilizar: una vez consumido, fuera.
      this.evento = null;
      this.disponible.set(false);
      return outcome === 'accepted';
    } catch {
      return false;
    }
  }

  /** display-mode: standalone es la señal fiable; iOS usa navigator.standalone. */
  private enModoApp(): boolean {
    try {
      if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
      if (window.matchMedia?.('(display-mode: minimal-ui)').matches) return true;
      return (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    } catch {
      return false;
    }
  }
}
