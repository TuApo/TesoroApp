import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

import { SharedModule } from '../../shared.module';
import {
  AppDownloadService, AppRelease, esVersionPosterior,
} from '../../../core/services/app-download.service';
import { AppInfoService, PlatformKey } from '../../../core/services/app-info.service';
import { InstalacionPwaService } from '../../../core/services/instalacion-pwa.service';

/** Destinos que ofrece el diálogo. */
type Destino = 'windows' | 'android' | 'ios';

/**
 * Diálogo "Descargar aplicación" (menú de perfil, justo encima de Cerrar sesión).
 *
 * Antes el instalador sólo se ofrecía dentro de Parametrización, una pantalla de
 * administración: quien necesitaba la app en su equipo o su teléfono no tenía
 * dónde encontrarla. Aquí está a dos clics desde cualquier pantalla.
 *
 * iOS no tiene build propio: se instala como app web desde Safari. Si algún día
 * hay TestFlight / App Store basta con añadir `iosUrl` al latest.json.
 */
@Component({
  selector: 'app-app-download-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  templateUrl: './app-download-dialog.component.html',
  styleUrl: './app-download-dialog.component.css',
})
export class AppDownloadDialogComponent {
  private readonly descargas = inject(AppDownloadService);
  private readonly appInfo = inject(AppInfoService);
  private readonly ref = inject(MatDialogRef<AppDownloadDialogComponent>);
  readonly instalacion = inject(InstalacionPwaService);

  readonly release = signal<AppRelease | null>(null);
  readonly cargando = signal(true);

  /** Destino sugerido según el equipo desde el que se abre (sólo resalta, no oculta). */
  readonly sugerido = signal<Destino | null>(null);

  /** Dónde corre ahora mismo: si ya está en el .exe o en el APK, se lo decimos. */
  readonly plataforma: PlatformKey = this.appInfo.getPlatform().key;

  /** Enlace que se comparte para abrir la web (y para instalarla en iPhone). */
  readonly enlaceWeb = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://tesoro.tuapo.co';

  readonly copiado = signal(false);

  /** Versión que corre AHORA en este equipo (en Electron manda app.getVersion). */
  readonly versionInstalada = signal('');

  constructor() {
    this.sugerido.set(this.detectarDestino());
    this.descargas.release().subscribe(r => {
      this.release.set(r);
      this.cargando.set(false);
    });
    void this.appInfo.getVersion().then(v => this.versionInstalada.set(v));
  }

  /**
   * Un .exe o un APK descargado a mano no se actualiza solo: si no se le avisa
   * a la persona, se queda meses en una versión vieja sin saberlo.
   */
  get hayActualizacion(): boolean {
    if (this.plataforma !== 'electron' && this.plataforma !== 'android') return false;
    const publicada = this.release()?.version;
    const instalada = this.versionInstalada();
    return !!publicada && !!instalada && esVersionPosterior(publicada, instalada);
  }

  /** Lee el user agent sólo para ordenar la ayuda; nada depende de que acierte. */
  private detectarDestino(): Destino | null {
    if (typeof navigator === 'undefined') return null;
    const ua = (navigator.userAgent || '').toLowerCase();
    // iPadOS 13+ se anuncia como Mac: se distingue porque el "Mac" tiene táctil.
    const esIpadOS = ua.includes('macintosh') && (navigator.maxTouchPoints || 0) > 1;
    if (/iphone|ipad|ipod/.test(ua) || esIpadOS) return 'ios';
    if (ua.includes('android')) return 'android';
    if (ua.includes('windows')) return 'windows';
    return null;
  }

  get hayExe(): boolean {
    return !!this.release()?.url;
  }

  get hayApk(): boolean {
    return !!this.release()?.apkUrl;
  }

  get hayIos(): boolean {
    return !!this.release()?.iosUrl;
  }

  get hayAgente(): boolean {
    return !!this.release()?.agenteUrl;
  }

  /** Instalar la versión web como app del sistema (Chrome/Edge en Android y escritorio). */
  async instalarAqui(): Promise<void> {
    await this.instalacion.instalar();
  }

  descargarAgente(): void {
    const r = this.release();
    if (!r?.agenteUrl) return;
    this.descargas.descargar(r.agenteUrl, r.agenteFilename ?? 'agente-huella-tuapo.zip');
  }

  descargarWindows(): void {
    const r = this.release();
    if (!r?.url) return;
    this.descargas.descargar(r.url, r.filename);
  }

  descargarAndroid(): void {
    const r = this.release();
    if (!r?.apkUrl) return;
    this.descargas.descargar(r.apkUrl, r.apkFilename ?? 'GestionTesoreria.apk');
  }

  abrirIos(): void {
    const url = this.release()?.iosUrl;
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  /** Copia la dirección de la web: es lo que se pega en el Safari del iPhone. */
  async copiarEnlace(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.enlaceWeb);
    } catch {
      // Sin permiso de portapapeles (http, navegador viejo): selección manual.
      const input = document.createElement('input');
      input.value = this.enlaceWeb;
      document.body.appendChild(input);
      input.select();
      try { document.execCommand('copy'); } catch { /* el enlace sigue visible en pantalla */ }
      input.remove();
    }
    this.copiado.set(true);
    setTimeout(() => this.copiado.set(false), 2000);
  }

  cerrar(): void {
    this.ref.close();
  }
}
