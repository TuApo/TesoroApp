import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { AppInfoService, PlatformInfo } from '../../../../../../core/services/app-info.service';
import { environment } from '@/environments/environment';

/**
 * Página "Acerca de": muestra la versión de la app y en qué dispositivo /
 * plataforma se está ejecutando (Web, Android o Escritorio). Resuelve la
 * versión en las tres plataformas vía AppInfoService.
 */
@Component({
  selector: 'app-acerca-config',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './acerca.component.html',
  styleUrl: './acerca.component.css',
})
export class AcercaConfigComponent implements OnInit {
  version = '—';
  platform: PlatformInfo = { key: 'web', label: 'Web', icon: 'public' };
  servidor = '';

  constructor(
    @Inject(PLATFORM_ID) private readonly platformId: object,
    private readonly appInfo: AppInfoService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    this.platform = this.appInfo.getPlatform();
    this.servidor = this.hostFromUrl(environment.apiUrl);
    const v = await this.appInfo.getVersion();
    this.version = v || '—';
    this.cdr.markForCheck();
  }

  private hostFromUrl(url: string): string {
    if (!url) return '';
    if (!isPlatformBrowser(this.platformId)) {
      return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    }
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }
}
