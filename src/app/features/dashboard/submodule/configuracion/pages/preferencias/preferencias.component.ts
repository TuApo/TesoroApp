import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';

import { PreferenciaTema, ThemeService } from '../../../../../../core/services/theme.service';
import { puenteOffline } from '@/app/core/offline/puente-offline';

const CACHE_KEYS = ['sidebar.sedes.cache.v1'];
const UI_STATE_KEYS = ['sidebarHidden', 'sidebarPin', 'tuapo.ui.menu', 'tuapo.ui.acciones'];

/**
 * Página "Preferencias": apariencia (tema claro/oscuro), gestión de datos
 * locales y mantenimiento de la app en este dispositivo. Todo lo que hace es real y auto-contenido (no hay toggles
 * decorativos): mide el almacenamiento local, limpia el caché de datos y
 * restablece el estado de la interfaz.
 */
@Component({
  selector: 'app-preferencias-config',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './preferencias.component.html',
  styleUrl: './preferencias.component.css',
})
export class PreferenciasConfigComponent implements OnInit {
  readonly theme = inject(ThemeService);
  readonly opcionesTema: { valor: PreferenciaTema; titulo: string; desc: string; icono: string }[] = [
    { valor: 'claro', titulo: 'Claro', desc: 'El de siempre', icono: 'light_mode' },
    { valor: 'oscuro', titulo: 'Oscuro', desc: 'Descansa la vista', icono: 'dark_mode' },
    { valor: 'sistema', titulo: 'Automático', desc: 'Igual que el dispositivo', icono: 'contrast' },
  ];

  private readonly isBrowser: boolean;
  itemsCount = 0;
  sizeLabel = '—';

  constructor(
    @Inject(PLATFORM_ID) platformId: object,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    this.medirAlmacenamiento();
  }

  private medirAlmacenamiento(): void {
    if (!this.isBrowser) return;
    try {
      let bytes = 0;
      let count = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key == null) continue;
        const val = localStorage.getItem(key) ?? '';
        // Aproximación: cada carácter UTF-16 ~ 2 bytes.
        bytes += (key.length + val.length) * 2;
        count++;
      }
      this.itemsCount = count;
      this.sizeLabel = this.formatBytes(bytes);
    } catch {
      this.sizeLabel = 'No disponible';
    }
    this.cdr.markForCheck();
  }

  private formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 KB';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  }

  private get electronDb(): any {
    if (!this.isBrowser) return null;
    // El mismo puente que la cola offline: en navegador y APK es IndexedDB.
    return puenteOffline()?.db ?? null;
  }

  async limpiarCache(): Promise<void> {
    const confirm = await Swal.fire({
      icon: 'question',
      title: 'Limpiar caché de datos',
      html:
        'Se borrarán los datos consultados que quedaron guardados en este ' +
        'dispositivo para acelerar la carga.<br><br>' +
        '<b>No</b> afecta tu sesión ni los envíos pendientes de subir.',
      showCancelButton: true,
      confirmButtonText: 'Limpiar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2563eb',
    });
    if (!confirm.isConfirmed) return;

    // 1) Caché de GETs en Electron (SQLite), si existe.
    try {
      if (this.electronDb?.clearCache) {
        await Promise.resolve(this.electronDb.clearCache()).catch(() => null);
      }
    } catch {
      // no crítico
    }

    // 2) Cachés conocidos en localStorage (web / Android).
    if (this.isBrowser) {
      for (const k of CACHE_KEYS) {
        try { localStorage.removeItem(k); } catch { /* noop */ }
      }
    }

    this.medirAlmacenamiento();
    Swal.fire({
      icon: 'success',
      title: 'Caché limpiado',
      timer: 1400,
      showConfirmButton: false,
    });
  }

  async restablecerVista(): Promise<void> {
    const confirm = await Swal.fire({
      icon: 'question',
      title: 'Restablecer vista del menú',
      text: 'El menú de navegación volverá a su estado por defecto. Se recargará la app.',
      showCancelButton: true,
      confirmButtonText: 'Restablecer',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2563eb',
    });
    if (!confirm.isConfirmed) return;

    if (this.isBrowser) {
      for (const k of UI_STATE_KEYS) {
        try { localStorage.removeItem(k); } catch { /* noop */ }
      }
      // Recargamos para que la barra de navegación re-lea el estado por defecto.
      window.location.reload();
    }
  }

  recargar(): void {
    if (this.isBrowser) window.location.reload();
  }
}
