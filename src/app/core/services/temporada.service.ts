import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { TEMPORADAS, Temporada, temporadaEn } from '../../../theme/temporadas/temporadas';

const CLAVE_FORZAR = 'tuapo.temporada.forzar';
const CLAVE_ADORNOS = 'tuapo.temporada.adornos';

/**
 * Decide la temporada vigente y la marca en `<html data-temporada="…">`: las hojas de
 * `src/theme/temporadas/` cuelgan de ese atributo, así que la paleta cambia en toda la
 * plataforma sin tocar las pantallas. Los adornos animados (murciélagos, calabazas…) se
 * pueden apagar por persona; la paleta se queda.
 */
@Injectable({ providedIn: 'root' })
export class TemporadaService {
  private readonly navegador = isPlatformBrowser(inject(PLATFORM_ID));

  readonly activa = signal<Temporada | null>(null);
  readonly adornos = signal(true);
  readonly clave = computed(() => this.activa()?.clave ?? null);

  iniciar(): void {
    if (!this.navegador) return;
    let forzada: string | null = null;
    try {
      const q = new URLSearchParams(location.search).get('temporada')
        ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get('temporada');
      if (q) localStorage.setItem(CLAVE_FORZAR, q);
      forzada = localStorage.getItem(CLAVE_FORZAR);
      this.adornos.set(localStorage.getItem(CLAVE_ADORNOS) !== 'off');
    } catch { /* sin storage: por fecha */ }
    let t: Temporada | null;
    if (forzada === 'off') t = null;
    else if (forzada && forzada !== 'auto') t = TEMPORADAS.find(x => x.clave === forzada) ?? temporadaEn(new Date());
    else t = temporadaEn(new Date());
    this.activa.set(t);
    const html = document.documentElement;
    if (t) html.setAttribute('data-temporada', t.clave);
    else html.removeAttribute('data-temporada');
    this.marcarAdornos();
  }

  /** `<html data-adornos="off">`: los adornos que viven en las pantallas (banderines…) también se apagan. */
  private marcarAdornos(): void {
    if (!this.navegador) return;
    if (this.adornos()) document.documentElement.removeAttribute('data-adornos');
    else document.documentElement.setAttribute('data-adornos', 'off');
  }

  ponerAdornos(si: boolean): void {
    this.adornos.set(si);
    try { localStorage.setItem(CLAVE_ADORNOS, si ? 'on' : 'off'); } catch { /* opcional */ }
    this.marcarAdornos();
  }
}
