import { Injectable, signal } from '@angular/core';

/**
 * Dónde está la persona dentro del menú. Lo escribe el menú lateral (que es
 * quien conoce el árbol de módulos con sus nombres) cada vez que cambia la
 * ruta, y lo lee la barra superior para pintar el título de la pantalla.
 */
@Injectable({ providedIn: 'root' })
export class NavegacionService {
  /** Nombre de la pantalla actual (p. ej. «Centros de costo»). */
  readonly titulo = signal('Inicio');
  /** Módulo raíz que la contiene (p. ej. «Nómina»), o null si es la misma. */
  readonly modulo = signal<string | null>(null);

  publicar(titulo: string, modulo: string | null): void {
    this.titulo.set(titulo);
    this.modulo.set(modulo && modulo !== titulo ? modulo : null);
  }
}
