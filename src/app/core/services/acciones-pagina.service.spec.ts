import { DestroyRef, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AccionesPaginaService } from './acciones-pagina.service';
import { NavegacionService } from './navegacion.service';

/** Espera a que corra la revisión programada con requestAnimationFrame. */
function cuadros(n = 2): Promise<void> {
  return new Promise((ok) => {
    const paso = (quedan: number) => (quedan <= 0 ? ok() : requestAnimationFrame(() => paso(quedan - 1)));
    paso(n);
  });
}

/** Cabecera de Salud tal como la pintan las pantallas de disabilities. */
function heroSalud(propias: boolean): string {
  return `
    <div class="disab-card">
      <div class="disab-hero disab-hero-radicacion"${propias ? ' data-acciones="propias"' : ''}>
        <div class="disab-hero-icon"><span>icono</span></div>
        <div class="disab-hero-texts">
          <h1 class="disab-hero-title">Radicación</h1>
          <p class="disab-hero-sub">Anote el número de radicado que entrega cada EPS.</p>
        </div>
        <div class="hero-acciones">
          <a href="/recobro" class="hero-btn">Recobro</a>
          <button type="button" class="hero-btn">Carga masiva (Excel)</button>
        </div>
      </div>
      <div class="ges-cuerpo"><p>Contenido</p></div>
    </div>`;
}

describe('AccionesPaginaService', () => {
  let servicio: AccionesPaginaService;
  let contenedor: HTMLElement;
  let destruir: (() => void) | null;

  /** DestroyRef mínimo: guarda la limpieza para llamarla al final de cada prueba. */
  const destroyRef = {
    onDestroy: (fn: () => void) => {
      destruir = fn;
      return () => (destruir = null);
    },
  } as unknown as DestroyRef;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    servicio = TestBed.inject(AccionesPaginaService);
    TestBed.inject(NavegacionService).publicar('Radicación', 'Salud');

    // Fijo arriba y con ancho: el servicio solo mira títulos visibles en los primeros 230 px.
    contenedor = document.createElement('div');
    contenedor.className = 'dashboard-page-wrapper';
    contenedor.style.cssText = 'position: fixed; top: 0; left: 0; width: 900px;';
    document.body.appendChild(contenedor);
    destruir = null;
  });

  afterEach(() => {
    destruir?.();
    contenedor.remove();
  });

  async function revisar(html: string): Promise<HTMLElement> {
    contenedor.innerHTML = html;
    servicio.iniciar(contenedor, destroyRef);
    await cuadros();
    return contenedor.querySelector<HTMLElement>('.disab-hero')!;
  }

  it('una .disab-hero con data-acciones="propias" y el título del menú se queda como está', async () => {
    const hero = await revisar(heroSalud(true));

    // El título no se oculta…
    expect(contenedor.querySelector('[data-acciones="oculto"]')).toBeNull();
    expect(hero.querySelector('.disab-hero-title')?.textContent).toBe('Radicación');
    // …y la franja no se convierte en barra de acciones ni recibe el botón «Acciones».
    expect(hero.classList.contains('barra-acciones')).toBeFalse();
    expect(hero.classList.contains('acciones-pagina')).toBeFalse();
    expect(contenedor.querySelector('.acciones-pagina__toggle')).toBeNull();
    expect(contenedor.querySelector('.acciones-pagina__pista')).toBeNull();
    // Sus botones siguen en su sitio.
    expect(hero.querySelector('.hero-acciones')?.children.length).toBe(2);
  });

  it('la misma cabecera SIN el atributo se comporta como antes: oculta el título y pasa a barra de acciones', async () => {
    const hero = await revisar(heroSalud(false));

    expect(hero.querySelector('.disab-hero-texts')?.getAttribute('data-acciones')).toBe('oculto');
    expect(hero.classList.contains('barra-acciones')).toBeTrue();
    expect(hero.classList.contains('acciones-pagina')).toBeTrue();
    const boton = hero.querySelector(':scope > .acciones-pagina__toggle');
    expect(boton).not.toBeNull();
    expect(boton?.querySelector('.acciones-pagina__cuenta')?.textContent).toBe('2 acciones');
    // Las acciones van a la pista; el bloque del título se queda fuera.
    const pista = hero.querySelector(':scope > .acciones-pagina__pista');
    expect(pista?.querySelector('.hero-acciones')).not.toBeNull();
    expect(pista?.querySelector('.disab-hero-texts')).toBeNull();
  });

  it('una cabecera que el servicio ya reconoce no recibe el botón si lleva data-acciones="propias"', async () => {
    await revisar(`
      <div class="card-header-premium" data-acciones="propias">
        <span>Otra cosa</span>
        <button type="button">Guardar</button>
      </div>
      <div class="card-header-premium otra">
        <span>Otra cosa</span>
        <button type="button">Guardar</button>
      </div>`);

    const [propia, normal] = Array.from(contenedor.querySelectorAll<HTMLElement>('.card-header-premium'));
    expect(propia.classList.contains('acciones-pagina')).toBeFalse();
    expect(propia.querySelector('.acciones-pagina__toggle')).toBeNull();
    expect(normal.classList.contains('acciones-pagina')).toBeTrue();
    expect(normal.querySelector(':scope > .acciones-pagina__toggle')).not.toBeNull();
  });
});
