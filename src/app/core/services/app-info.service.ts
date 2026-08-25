import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Capacitor } from '@capacitor/core';
import { environment } from '@/environments/environment';

export type PlatformKey = 'android' | 'ios' | 'electron' | 'web' | 'server';

export interface PlatformInfo {
  /** Identificador estable para lógica condicional. */
  key: PlatformKey;
  /** Texto para el usuario: "Android", "iOS", "Escritorio", "Web". */
  label: string;
  /** Icono Material Symbols asociado. */
  icon: string;
}

/**
 * Fuente única de la versión de la app y de la plataforma en la que corre.
 *
 * La misma base de código se despliega en tres destinos y hasta ahora la
 * versión sólo se resolvía en Electron (vía IPC), quedando vacía en Web y en el
 * APK de Android. Este servicio detecta el destino real y devuelve una versión
 * válida en los tres:
 *   - Electron  → app.getVersion() (fuente de verdad del instalador).
 *   - Android   → Capacitor.getPlatform() + environment.appVersion.
 *   - Web       → environment.appVersion.
 */
@Injectable({ providedIn: 'root' })
export class AppInfoService {
  private readonly isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /** Versión declarada en el build (package.json → environment.appVersion). */
  get buildVersion(): string {
    return (environment as unknown as { appVersion?: string }).appVersion || '';
  }

  private hasElectron(): boolean {
    return this.isBrowser && !!(window as unknown as { electron?: unknown }).electron;
  }

  /** Plataforma real de ejecución. Nunca lanza: en SSR devuelve 'server'. */
  getPlatform(): PlatformInfo {
    if (!this.isBrowser) {
      return { key: 'server', label: 'Servidor', icon: 'dns' };
    }
    if (this.hasElectron()) {
      return { key: 'electron', label: 'Escritorio', icon: 'desktop_windows' };
    }
    try {
      if (Capacitor?.isNativePlatform?.()) {
        const p = Capacitor.getPlatform();
        if (p === 'ios') return { key: 'ios', label: 'iOS', icon: 'phone_iphone' };
        return { key: 'android', label: 'Android', icon: 'android' };
      }
    } catch {
      // Capacitor no disponible (build web puro): tratamos como navegador.
    }
    return { key: 'web', label: 'Web', icon: 'public' };
  }

  /**
   * Versión efectiva. En Electron el proceso main es la fuente de verdad
   * (app.getVersion vía IPC); en Web/Android se usa la versión del build.
   * Siempre resuelve, aunque el IPC falle.
   */
  async getVersion(): Promise<string> {
    if (this.hasElectron()) {
      try {
        const getV = (window as unknown as { electron?: { version?: { get?: () => unknown } } })
          .electron?.version?.get;
        if (typeof getV === 'function') {
          const v = await Promise.resolve(getV());
          if (v) return String(v);
        }
      } catch {
        // Caemos a la versión del build.
      }
    }
    return this.buildVersion;
  }

  /** Etiqueta compacta lista para la UI: "v9.8.2 · Web". */
  async getVersionLabel(): Promise<string> {
    const version = await this.getVersion();
    const platform = this.getPlatform();
    const v = version ? `v${version}` : 'v—';
    return `${v} · ${platform.label}`;
  }
}
