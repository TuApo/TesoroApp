import { DestroyRef, Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { NavegacionService } from './navegacion.service';

/** Plegado/abierto: preferencia del equipo, sobrevive al cierre de sesión (safe-storage). */
export const CLAVE_ACCIONES = 'tuapo.ui.acciones';

/** Cabeceras que theme/acciones-pagina.css ya reconoce sin ayuda de este servicio. */
const CABECERAS = [
  '.card-header-premium:not(.card-header-premium--portada)',
  'app-analisis-nomina .analisis-header',
  'app-manage-workers header.top-bar',
  ':is(app-matder-dashboard, app-workspaces-page, app-boards-page, app-calendar-page, app-analytics-page, ' +
    'app-groups-page, app-notifications-page, app-import-page, app-audit-page, app-favorites-page, app-novedades) header.hero',
  '.barra-acciones',
].join(', ');

const CONTROLES =
  'button, a[href], input:not([type=file]):not([type=hidden]), textarea, mat-form-field, mat-select, ' +
  'mat-slide-toggle, mat-button-toggle-group, mat-checkbox, select';

const ENCABEZADOS =
  'h1, h2, .titulo, mat-card-title, .page-title, .tienda-titulo, .disab-hero-title, ' +
  '.cfg-header__title, .section-title, .rp__title, .pl__titulo';

/** «Dashboard de Soporte» y «Soporte» son el mismo nombre. */
const RELLENO = new Set(['dashboard', 'gestion', 'panel', 'modulo', 'de', 'del', 'la', 'el', 'los',
  'las', 'y', 'e', 'en', 'para', 'a', 'al', 'mi', 'mis', 'tu', 'tus']);

/**
 * Cabecera de página: quitar el nombre repetido y plegar las acciones.
 *
 * Cada pantalla abría con su propio título (y muchas con una franja oscura),
 * el mismo que ya sale en la barra superior. Aquí se hacen dos cosas sobre la
 * pantalla que esté a la vista:
 *
 *  1. Si el título de arriba repite el del menú, se oculta ese bloque (título,
 *     descripción e icono). Si lo que queda de la cabecera son solo acciones,
 *     la cabecera entera pasa a ser una barra de acciones; si no queda nada,
 *     desaparece.
 *  2. A cada barra con acciones se le añade el botón «Acciones», que la pliega:
 *     plegada solo se ve ese botón; abierta, todo lo que la pantalla puso ahí
 *     (botones, buscador, interruptores, rangos).
 *
 * Se hace desde el shell y no en las ~116 pantallas: se observa el contenedor
 * de página y se revisa en cada cambio. Los nodos propios (el botón) van al
 * final de la cabecera; Angular inserta lo suyo antes de sus anclas, así que no
 * se pisan, y si la pantalla rehace la cabecera, el observador lo repone.
 */
@Injectable({ providedIn: 'root' })
export class AccionesPaginaService {
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly navegacion = inject(NavegacionService);
  private abierta = false;
  private cuadro = 0;
  private contenedor: HTMLElement | null = null;

  iniciar(contenedor: HTMLElement, destroyRef: DestroyRef): void {
    if (!this.esNavegador) return;
    this.contenedor = contenedor;
    this.abierta = this.leer() === '1';
    const observador = new MutationObserver(() => this.programar());
    observador.observe(contenedor, { childList: true, subtree: true });
    destroyRef.onDestroy(() => {
      observador.disconnect();
      if (this.cuadro) cancelAnimationFrame(this.cuadro);
      this.contenedor = null;
    });
    this.programar();
  }

  /** Lo llama el shell cuando cambia el título de la barra superior. */
  revisarAhora(): void {
    this.programar();
  }

  /** Una revisión por cuadro aunque la página mute cientos de nodos (tablas). */
  private programar(): void {
    if (this.cuadro || !this.contenedor) return;
    this.cuadro = requestAnimationFrame(() => {
      this.cuadro = 0;
      if (this.contenedor) this.revisar(this.contenedor);
    });
  }

  private revisar(contenedor: HTMLElement): void {
    this.quitarTituloRepetido(contenedor);
    for (const cabecera of Array.from(contenedor.querySelectorAll<HTMLElement>(CABECERAS))) {
      if (cabecera.getAttribute('data-acciones') === 'oculto') continue;
      const boton = cabecera.querySelector<HTMLButtonElement>(':scope > .acciones-pagina__toggle');
      const tieneAcciones = Array.from(cabecera.querySelectorAll(CONTROLES))
        .some((c) => (!boton || (c !== boton && !boton.contains(c))) && !c.closest('[data-acciones="oculto"]'));
      if (!tieneAcciones) {
        boton?.remove();
        cabecera.classList.remove('acciones-pagina', 'acciones-pagina--abierta');
        continue;
      }
      cabecera.classList.add('acciones-pagina');
      cabecera.classList.toggle('acciones-pagina--abierta', this.abierta);
      const pista = this.asegurarPista(cabecera);
      this.sacarMenus(cabecera, pista);
      const actual = boton ?? cabecera.appendChild(this.crearBoton());
      actual.setAttribute('aria-expanded', String(this.abierta));
      this.escribirCuenta(cabecera, actual);
    }
  }

  // ── Pista: una sola fila que se arrastra si no cabe ───────────────────────

  /**
   * Las acciones viven en una pista horizontal: si no caben, se arrastra de
   * lado en vez de apilarse en varias filas. El título (pantallas de contexto)
   * se queda fuera de la pista.
   */
  private asegurarPista(cabecera: HTMLElement): HTMLElement {
    let pista = cabecera.querySelector<HTMLElement>(':scope > .acciones-pagina__pista');
    if (!pista) {
      pista = document.createElement('div');
      pista.className = 'acciones-pagina__pista';
      cabecera.appendChild(pista);
      this.hacerArrastrable(pista);
    }
    for (const nodo of Array.from(cabecera.childNodes)) {
      if (nodo === pista) continue;
      if (nodo instanceof HTMLElement) {
        if (nodo.classList.contains('acciones-pagina__toggle')) continue;
        // Los bloques con título se quedan arriba, no dentro de la pista.
        if (nodo.matches(ENCABEZADOS) || nodo.querySelector(ENCABEZADOS)) continue;
      }
      pista.appendChild(nodo);
    }
    return pista;
  }

  /** Arrastrar con el ratón; en táctil ya desliza solo. */
  private hacerArrastrable(pista: HTMLElement): void {
    let x0 = 0;
    let scroll0 = 0;
    let arrastrando = false;
    pista.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      const destino = e.target as HTMLElement;
      if (destino.closest('button, a, input, select, textarea, mat-form-field, mat-select, mat-slide-toggle, mat-button-toggle-group')) return;
      arrastrando = true;
      x0 = e.clientX;
      scroll0 = pista.scrollLeft;
      pista.classList.add('acciones-pagina__pista--arrastrando');
      pista.setPointerCapture(e.pointerId);
    });
    pista.addEventListener('pointermove', (e) => {
      if (arrastrando) pista.scrollLeft = scroll0 - (e.clientX - x0);
    });
    const soltar = (e: PointerEvent) => {
      if (!arrastrando) return;
      arrastrando = false;
      pista.classList.remove('acciones-pagina__pista--arrastrando');
      try { pista.releasePointerCapture(e.pointerId); } catch { /* ya soltado */ }
    };
    pista.addEventListener('pointerup', soltar);
    pista.addEventListener('pointercancel', soltar);
    pista.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || pista.scrollWidth <= pista.clientWidth) return;
      pista.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }

  // ── Menús de tres puntos: sus opciones, a la vista ────────────────────────

  /**
   * Un menú de Material no existe en el DOM hasta que se abre, así que se abre
   * una vez con el panel oculto, se copian sus opciones como botones normales
   * y se esconde el botón de tres puntos. Al pulsar una copia se vuelve a abrir
   * el menú (oculto) y se pulsa la opción de verdad, para que la pantalla haga
   * exactamente lo que hacía.
   */
  private sacarMenus(cabecera: HTMLElement, pista: HTMLElement): void {
    const disparadores = Array.from(cabecera.querySelectorAll<HTMLElement>('.mat-mdc-menu-trigger'))
      .filter((d) => !d.dataset['accionesMenu']);
    for (const disparador of disparadores) {
      disparador.dataset['accionesMenu'] = 'leyendo';
      void this.copiarOpciones(disparador, pista);
    }
  }

  private async copiarOpciones(disparador: HTMLElement, pista: HTMLElement): Promise<void> {
    const opciones = await this.conMenuAbierto(disparador, (panel) =>
      Array.from(panel.querySelectorAll<HTMLElement>('.mat-mdc-menu-item')).map((i) => ({
        etiqueta: (i.textContent || '').replace(/\s+/g, ' ').trim(),
        icono: (i.querySelector('mat-icon')?.textContent || '').trim(),
        deshabilitado: i.hasAttribute('disabled') || i.getAttribute('aria-disabled') === 'true',
      })).filter((o) => o.etiqueta));
    if (!opciones || !opciones.length) {
      disparador.dataset['accionesMenu'] = 'sin-opciones';
      return;
    }
    disparador.dataset['accionesMenu'] = 'copiado';
    disparador.setAttribute('data-acciones', 'menu-origen');
    for (const opcion of opciones) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'acciones-pagina__item';
      b.disabled = opcion.deshabilitado;
      if (opcion.icono) {
        const ico = document.createElement('span');
        ico.className = 'material-icons';
        ico.setAttribute('aria-hidden', 'true');
        ico.textContent = opcion.icono;
        b.appendChild(ico);
      }
      const txt = document.createElement('span');
      txt.textContent = opcion.etiqueta.replace(opcion.icono, '').trim() || opcion.etiqueta;
      b.appendChild(txt);
      b.addEventListener('click', () => void this.pulsarOpcion(disparador, opcion.etiqueta));
      pista.appendChild(b);
    }
  }

  private async pulsarOpcion(disparador: HTMLElement, etiqueta: string): Promise<void> {
    const item = await this.conMenuAbierto(disparador, (panel) =>
      Array.from(panel.querySelectorAll<HTMLElement>('.mat-mdc-menu-item'))
        .find((i) => (i.textContent || '').replace(/\s+/g, ' ').trim() === etiqueta) || null, true);
    if (item) {
      item.click();
      requestAnimationFrame(() => document.body.classList.remove('acciones-extrayendo'));
    } else {
      // No está: se deja el menú a la vista para que la persona elija.
      document.body.classList.remove('acciones-extrayendo');
    }
  }

  /** Abre el menú con el panel invisible, hace algo con él y lo cierra. */
  private async conMenuAbierto<T>(disparador: HTMLElement, hacer: (panel: HTMLElement) => T,
    dejarAbierto = false): Promise<T | null> {
    document.body.classList.add('acciones-extrayendo');
    disparador.click();
    await this.esperarCuadros(2);
    const panel = document.querySelector<HTMLElement>('.mat-mdc-menu-panel');
    let resultado: T | null = null;
    try {
      resultado = panel ? hacer(panel) : null;
    } catch { resultado = null; }
    if (!dejarAbierto) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.querySelector<HTMLElement>('.cdk-overlay-backdrop')?.click();
      await this.esperarCuadros(1);
      document.body.classList.remove('acciones-extrayendo');
    }
    return resultado;
  }

  private esperarCuadros(n: number): Promise<void> {
    return new Promise((ok) => {
      const paso = (quedan: number) => quedan <= 0 ? ok() : requestAnimationFrame(() => paso(quedan - 1));
      paso(n);
    });
  }

  // ── 1. El nombre del módulo, una sola vez ──────────────────────────────────

  private quitarTituloRepetido(contenedor: HTMLElement): void {
    const titulo = this.navegacion.titulo();
    if (!titulo || titulo === 'Tu Apo') return;
    // Ya resuelto para esta pantalla.
    if (contenedor.querySelector('[data-acciones="oculto"]')) return;

    const limite = contenedor.getBoundingClientRect().top + 230;
    for (const h of Array.from(contenedor.querySelectorAll<HTMLElement>(ENCABEZADOS))) {
      const r = h.getBoundingClientRect();
      if (!r.height || r.top > limite) continue;
      const texto = (h.textContent || '').trim();
      if (!texto || texto.length > 80) continue;
      // Manda el primer título de arriba: si no es el del módulo, la pantalla se queda como está.
      if (!this.coincide(texto, titulo)) return;

      const bloque = this.bloqueDeTitulo(h, contenedor);
      const barra = this.cabeceraDe(bloque, contenedor);
      bloque.setAttribute('data-acciones', 'oculto');
      if (!barra) return;
      const quedanAcciones = Array.from(barra.querySelectorAll(CONTROLES)).some((c) => !bloque.contains(c));
      if (quedanAcciones) barra.classList.add('barra-acciones');
      else barra.setAttribute('data-acciones', 'oculto');
      return;
    }
  }

  /** Sube desde el título hasta abarcar su descripción e icono, sin tragarse controles. */
  private bloqueDeTitulo(h: HTMLElement, contenedor: HTMLElement): HTMLElement {
    let bloque = h;
    while (bloque.parentElement && bloque.parentElement !== contenedor
      && bloque.parentElement.children.length <= 4
      && !this.tieneControles(bloque.parentElement)
      && (bloque.parentElement.textContent || '').trim().length <= 260) {
      bloque = bloque.parentElement;
    }
    return bloque;
  }

  /** La banda de cabecera que envuelve al bloque, si la hay (header, .cabecera, .hero…). */
  private cabeceraDe(bloque: HTMLElement, contenedor: HTMLElement): HTMLElement | null {
    const esCabecera = (e: Element | null): boolean => {
      if (!e || e === contenedor || !(e instanceof HTMLElement)) return false;
      if (/^(header|mat-card-header)$/i.test(e.tagName)) return true;
      const clases = typeof e.className === 'string' ? e.className : '';
      return /(^|[ _-])(header|cabecera|hero|encabezado|top-?bar|toolbar|cab|titlebar)/i.test(clases);
    };
    if (!esCabecera(bloque.parentElement)) return null;
    let barra = bloque.parentElement as HTMLElement;
    while (esCabecera(barra.parentElement)) barra = barra.parentElement as HTMLElement;
    return barra;
  }

  private tieneControles(el: Element): boolean {
    return el.matches(CONTROLES) || !!el.querySelector(CONTROLES);
  }

  private palabras(t: string): string[] {
    return t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !RELLENO.has(w));
  }

  private coincide(a: string, b: string): boolean {
    const A = this.palabras(a);
    const B = this.palabras(b);
    if (!A.length || !B.length) return false;
    const sa = A.join(' ');
    const sb = B.join(' ');
    if (sa === sb || sa.includes(sb) || sb.includes(sa)) return true;
    const comunes = A.filter((w) => B.includes(w)).length;
    return comunes / Math.min(A.length, B.length) >= 0.6;
  }

  // ── 2. Botón «Acciones» ────────────────────────────────────────────────────

  /** Cuántas acciones hay dentro, sin contar las anidadas ni el propio botón. */
  private escribirCuenta(cabecera: HTMLElement, boton: HTMLButtonElement): void {
    const hueco = boton.querySelector('.acciones-pagina__cuenta');
    if (!hueco) return;
    const controles = Array.from(cabecera.querySelectorAll<HTMLElement>(CONTROLES))
      .filter((c) => c !== boton && !boton.contains(c)
        && !c.closest('[data-acciones="oculto"]') && !c.closest('[data-acciones="menu-origen"]'));
    const sueltos = controles.filter((c) => !controles.some((otro) => otro !== c && otro.contains(c)));
    const n = sueltos.length;
    const texto = n === 1 ? '1 acción' : `${n} acciones`;
    if (hueco.textContent !== texto) hueco.textContent = texto;
  }

  private crearBoton(): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'acciones-pagina__toggle';
    b.setAttribute('aria-expanded', String(this.abierta));
    b.title = 'Mostrar u ocultar las acciones de esta pantalla';
    b.innerHTML =
      '<span class="material-symbols-outlined acciones-pagina__icono" aria-hidden="true">bolt</span>' +
      '<span class="acciones-pagina__texto">Acciones</span>' +
      '<span class="acciones-pagina__cuenta"></span>' +
      '<span class="material-symbols-outlined acciones-pagina__chevron" aria-hidden="true">expand_more</span>';
    b.addEventListener('click', () => this.alternar());
    return b;
  }

  private alternar(): void {
    this.abierta = !this.abierta;
    try { localStorage.setItem(CLAVE_ACCIONES, this.abierta ? '1' : '0'); } catch { /* modo privado */ }
    for (const cabecera of Array.from(document.querySelectorAll<HTMLElement>('.acciones-pagina'))) {
      cabecera.classList.toggle('acciones-pagina--abierta', this.abierta);
      cabecera.querySelector(':scope > .acciones-pagina__toggle')?.setAttribute('aria-expanded', String(this.abierta));
    }
  }

  private leer(): string | null {
    try { return localStorage.getItem(CLAVE_ACCIONES); } catch { return null; }
  }
}
