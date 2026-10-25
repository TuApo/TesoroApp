import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

interface Posicion { ventana: number; contenedores: number[]; }

/**
 * Desplazamiento al navegar, en toda la plataforma.
 *
 * <p>Sin esto, al pasar de una pantalla a otra la nueva aparecía desplazada en el mismo punto
 * de la anterior (el contenedor que desplaza es el mismo y nadie lo devolvía arriba). Reglas:
 * <ul>
 *   <li><b>Pantalla nueva</b> (cambia la ruta): empieza arriba.</li>
 *   <li><b>Atrás / adelante</b>: vuelve al punto donde estaba esa pantalla.</li>
 *   <li><b>Solo cambian los filtros</b> (misma ruta, otros parámetros): se queda donde está;
 *       si no, cada filtro haría saltar la lista.</li>
 *   <li><b>Tocar el enlace de la pantalla en la que ya está</b> (p. ej. «Inicio» estando en
 *       Inicio): sube suave al principio, como en las apps del celular.</li>
 * </ul>
 *
 * <p>Lo que desplaza es la ventana (EconomiAPP, pantallas públicas) o `.dashboard-page-wrapper`
 * (el marco del tablero). Una pantalla con su propio contenedor puede sumarse marcándolo con
 * el atributo `data-desplazamiento-ruta`.
 */
@Injectable({ providedIn: 'root' })
export class DesplazamientoRutasService {
  private readonly router = inject(Router);
  private readonly navegador = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly posiciones = new Map<string, Posicion>();
  private iniciado = false;
  private desde = '';
  private disparo: string = 'imperative';

  iniciar(): void {
    if (!this.navegador || this.iniciado) return;
    this.iniciado = true;
    // El navegador no debe restaurar por su cuenta: lo hace este servicio cuando la pantalla ya pintó.
    try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch { /* opcional */ }

    this.router.events.subscribe(e => {
      if (e instanceof NavigationStart) {
        this.desde = this.router.url;
        this.disparo = e.navigationTrigger ?? 'imperative';
        this.guardar(this.desde);
      } else if (e instanceof NavigationEnd) {
        const hacia = e.urlAfterRedirects;
        if (this.disparo === 'popstate' || this.disparo === 'hashchange') this.restaurar(hacia);
        else if (ruta(hacia) !== ruta(this.desde)) this.arriba(false);
      }
    });

    // Mismo enlace que la pantalla actual: el router ignora esa navegación, así que se
    // detecta el clic (fase de captura, antes de que el router lo procese).
    document.addEventListener('click', ev => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const a = (ev.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank') return;
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('#/')) return;
      if (href.slice(1).split('#')[0] === this.router.url.split('#')[0]) this.arriba(true);
    }, true);
  }

  private contenedores(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.dashboard-page-wrapper, [data-desplazamiento-ruta]'));
  }

  private guardar(url: string): void {
    this.posiciones.set(url, { ventana: window.scrollY, contenedores: this.contenedores().map(c => c.scrollTop) });
    // Solo las últimas pantallas: con eso alcanza para ir atrás varias veces.
    if (this.posiciones.size > 60) this.posiciones.delete(this.posiciones.keys().next().value!);
  }

  private arriba(suave: boolean): void {
    const comportamiento: ScrollBehavior = suave ? 'smooth' : 'auto';
    window.scrollTo({ top: 0, left: 0, behavior: comportamiento });
    for (const c of this.contenedores()) c.scrollTo({ top: 0, behavior: comportamiento });
    // La pantalla nueva puede terminar de pintar un instante después (carga diferida): se repite.
    if (!suave) requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0 });
      for (const c of this.contenedores()) c.scrollTop = 0;
    });
  }

  /** Vuelve al punto guardado; reintenta unos cuadros mientras la pantalla crece lo suficiente. */
  private restaurar(url: string): void {
    const p = this.posiciones.get(url);
    if (!p) { this.arriba(false); return; }
    let intentos = 0;
    const aplicar = () => {
      window.scrollTo({ top: p.ventana, left: 0 });
      const cs = this.contenedores();
      cs.forEach((c, i) => { if (p.contenedores[i] != null) c.scrollTop = p.contenedores[i]; });
      const listo = Math.abs(window.scrollY - p.ventana) < 2 && cs.every((c, i) => p.contenedores[i] == null || Math.abs(c.scrollTop - p.contenedores[i]) < 2);
      if (!listo && ++intentos < 40) requestAnimationFrame(aplicar);
    };
    requestAnimationFrame(aplicar);
  }
}

/** La ruta sin parámetros ni ancla: «/economiapp/explorar?categoria=…» → «/economiapp/explorar». */
function ruta(url: string): string {
  return (url || '').split('#')[0].split('?')[0];
}
