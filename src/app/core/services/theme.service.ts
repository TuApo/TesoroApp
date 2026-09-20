import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';

import { getLocalStorageItem, setLocalStorageItem } from '../utils/safe-storage';

/** Lo que elige el usuario. 'sistema' sigue al modo del sistema operativo. */
export type PreferenciaTema = 'claro' | 'oscuro' | 'sistema';
/** Lo que se pinta de verdad. */
export type TemaAplicado = 'claro' | 'oscuro';

/**
 * Clave en localStorage. Está en la lista de claves de dispositivo de
 * safe-storage, así que el logout no la borra. index.html la lee con un
 * script en línea antes de que arranque Angular para no pintar un fotograma
 * en claro y luego saltar a oscuro: si se cambia aquí, cambiarla allí.
 */
export const CLAVE_TEMA = 'tuapo.ui.tema';

/**
 * Tema claro/oscuro de toda la plataforma.
 *
 * El tema se aplica como `data-theme="dark"` en <html>; los colores salen de
 * los tokens de `src/theme/tokens.css`, que redefinen los semánticos
 * (--surface, --text, --border…) y los `--mat-sys-*` de Material. Por defecto
 * es claro: el modo oscuro es opcional y solo se activa si el usuario lo pide.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly media = this.isBrowser && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  private readonly sistemaOscuro = signal(this.media?.matches ?? false);

  readonly preferencia = signal<PreferenciaTema>(this.leer());
  readonly aplicado = computed<TemaAplicado>(() => {
    const p = this.preferencia();
    if (p === 'sistema') return this.sistemaOscuro() ? 'oscuro' : 'claro';
    return p;
  });
  readonly esOscuro = computed(() => this.aplicado() === 'oscuro');

  constructor() {
    this.media?.addEventListener?.('change', (e) => {
      this.sistemaOscuro.set(e.matches);
      this.aplicar();
    });
    this.aplicar();
  }

  establecer(pref: PreferenciaTema): void {
    this.preferencia.set(pref);
    setLocalStorageItem(CLAVE_TEMA, pref);
    this.aplicar();
  }

  /** Atajo del navbar: pasa de lo que se ve ahora a lo contrario. */
  alternar(): void {
    this.establecer(this.esOscuro() ? 'claro' : 'oscuro');
  }

  private leer(): PreferenciaTema {
    const v = getLocalStorageItem(CLAVE_TEMA);
    return v === 'oscuro' || v === 'sistema' ? v : 'claro';
  }

  private aplicar(): void {
    const html = this.doc?.documentElement;
    if (!html) return;
    const oscuro = this.aplicado() === 'oscuro';
    if (oscuro) html.setAttribute('data-theme', 'dark');
    else html.removeAttribute('data-theme');
    // Reportes (y el diálogo de tabla) traían su propia paleta oscura colgada
    // de `:host-context(.dark-theme)`, esperando una clase que nadie ponía.
    html.classList.toggle('dark-theme', oscuro);
    // La barra del navegador móvil y la de estado de Android toman este color.
    const meta = this.doc.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', this.aplicado() === 'oscuro' ? '#0B1120' : '#21263C');
  }
}
