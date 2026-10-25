import { TestBed } from '@angular/core/testing';

import { AperturaVentana, GestorVentanas, MIN_ALTO, MIN_ANCHO, acotarAlViewport, claveVentana, rectInicial } from './gestor-ventanas';
import { CATALOGO_MODULOS, moduloPorClave, rutaModulo, urlModulo } from './modulos';
import { CapaVentanas } from './capa-ventanas';
import { detectarEmbebido } from '../../../../pages/dashboard/dashboard.component';

const CLAVE_STORAGE = 'tuapo.turnos.ventanas';
const AP = (modulo: AperturaVentana['modulo'], temaClave: string | null = null): AperturaVentana => ({
  modulo, temaClave, titulo: moduloPorClave(modulo)!.etiqueta, icono: 'x', url: 'https://prueba.invalid/#/x', urlExterna: 'https://prueba.invalid/#/x', subtitulo: null,
});

describe('Ventanas flotantes · geometría', () => {
  it('acota al viewport: dentro, con margen y tamaño mínimo usable', () => {
    expect(acotarAlViewport({ x: -50, y: -20, w: 400, h: 300 }, 1440, 900)).toEqual({ x: 8, y: 8, w: 400, h: 300 });
    expect(acotarAlViewport({ x: 1300, y: 800, w: 400, h: 300 }, 1440, 900)).toEqual({ x: 1032, y: 592, w: 400, h: 300 });
    expect(acotarAlViewport({ x: 0, y: 0, w: 5000, h: 5000 }, 1440, 900)).toEqual({ x: 8, y: 8, w: 1424, h: 884 });
    expect(acotarAlViewport({ x: 10, y: 10, w: 50, h: 50 }, 1440, 900)).toEqual({ x: 10, y: 10, w: MIN_ANCHO, h: MIN_ALTO });
    // Pantalla más chica que el mínimo: gana el viewport.
    const r = acotarAlViewport({ x: 0, y: 0, w: 400, h: 300 }, 300, 200);
    expect(r.x + r.w).toBeLessThanOrEqual(292);
    expect(r.y + r.h).toBeLessThanOrEqual(192);
  });

  it('las nuevas nacen a la derecha y escalonadas', () => {
    const a = rectInicial(0, 1440, 900);
    const b = rectInicial(1, 1440, 900);
    expect(a.x + a.w).toBeLessThanOrEqual(1440);
    expect(b.x).toBeLessThan(a.x);
    expect(b.y).toBeGreaterThan(a.y);
  });

  it('clave de deduplicación: tema + módulo', () => {
    expect(claveVentana('pipeline', 'cuenta')).toBe('pipeline|cuenta');
    expect(claveVentana('pipeline', null)).toBe('pipeline|manual');
    expect(claveVentana('pipeline', '  ')).toBe('pipeline|manual');
  });
});

describe('Catálogo de módulos → rutas', () => {
  it('las claves del contrato con backend están todas y sin repetir', () => {
    const claves = CATALOGO_MODULOS.map(m => m.clave);
    expect([...claves].sort()).toEqual(['afiliaciones', 'carnet', 'documentos', 'formulario-vacantes', 'incapacidades', 'juridico', 'nomina-desprendibles',
      'nomina-formas-pago', 'pipeline', 'reuniones', 'soporte', 'tesoreria']);
    expect(CATALOGO_MODULOS.every(m => m.ruta.startsWith('/dashboard/'))).toBeTrue();
  });

  it('el pipeline abre a la persona; los demás su página base; siempre en modo embebido', () => {
    const p = moduloPorClave('pipeline')!;
    expect(rutaModulo(p, '1.020.304')).toBe('/dashboard/hiring/recruitment-pipeline?cedula=1020304&embebido=1');
    expect(rutaModulo(p, 'X9999001')).toBe('/dashboard/hiring/recruitment-pipeline?cedula=X9999001&embebido=1');
    expect(rutaModulo(moduloPorClave('nomina-formas-pago')!, '123')).toBe('/dashboard/payments/payments-method?embebido=1');
    expect(urlModulo(p, '55', 'https://tesoro.tuapo.co/')).toBe('https://tesoro.tuapo.co/#/dashboard/hiring/recruitment-pipeline?cedula=55&embebido=1');
    expect(urlModulo(p, '55', 'https://tesoro.tuapo.co/', false)).toBe('https://tesoro.tuapo.co/#/dashboard/hiring/recruitment-pipeline?cedula=55');
    // Escritorio (Electron) sirve la app desde un archivo: la base es el archivo, no un origen.
    expect(urlModulo(p, null, 'file:///C:/TuApo/index.html')).toBe('file:///C:/TuApo/index.html#/dashboard/hiring/recruitment-pipeline?embebido=1');
    expect(moduloPorClave('no-existe')).toBeNull();
  });
});

describe('GestorVentanas', () => {
  let g: GestorVentanas;

  beforeEach(() => {
    try { localStorage.removeItem(CLAVE_STORAGE); } catch { /* sin storage */ }
    TestBed.configureTestingModule({ providers: [GestorVentanas] });
    g = TestBed.inject(GestorVentanas);
    g.alCambiarViewport(1440, 900);
  });

  it('abre, minimiza a pestaña, pone grande, restaura y cierra', () => {
    const v = g.abrir(AP('pipeline'));
    expect(g.ventanas().length).toBe(1);
    expect(v.estado).toBe('normal');
    expect(v.cargada).toBeTrue();
    g.minimizar(v.id);
    expect(g.ventanas()[0].estado).toBe('minimizada');
    expect(g.visibles().length).toBe(0);
    g.restaurar(v.id);
    expect(g.ventanas()[0].estado).toBe('normal');
    g.maximizar(v.id);
    expect(g.ventanas()[0].estado).toBe('maximizada');
    // Minimizar estando grande y volver: vuelve grande.
    g.minimizar(v.id);
    g.restaurar(v.id);
    expect(g.ventanas()[0].estado).toBe('maximizada');
    g.alternarMaximizar(v.id);
    expect(g.ventanas()[0].estado).toBe('normal');
    const cerradas: string[] = [];
    g.cerradas$.subscribe(x => cerradas.push(x.id));
    g.cerrar(v.id);
    expect(g.ventanas().length).toBe(0);
    expect(cerradas).toEqual(['pipeline|manual']);
  });

  it('no duplica: el mismo tema en el mismo módulo es la misma ventana (y la sugerencia no la tapa)', () => {
    const a = g.abrir(AP('nomina-formas-pago', 'cuenta'), { minimizada: true });
    expect(a.estado).toBe('minimizada');
    expect(a.nueva).toBeTrue();
    expect(a.cargada).toBeFalse();
    g.abrir(AP('nomina-formas-pago', 'cuenta'), { minimizada: true });
    expect(g.ventanas().length).toBe(1);
    g.abrir(AP('nomina-formas-pago', 'cuenta'));
    expect(g.ventanas().length).toBe(1);
    expect(g.ventanas()[0].estado).toBe('normal');
    expect(g.ventanas()[0].nueva).toBeFalse();
    expect(g.ventanas()[0].cargada).toBeTrue();
    g.abrir(AP('nomina-formas-pago', 'otro-tema'));
    expect(g.ventanas().length).toBe(2);
    // Una ventana abierta y grande no se achica porque la sugieran otra vez.
    g.maximizar('nomina-formas-pago|cuenta');
    g.abrir(AP('nomina-formas-pago', 'cuenta'), { minimizada: true });
    expect(g.ventanas()[0].estado).toBe('maximizada');
  });

  it('la que se toca pasa al frente; la pestaña alterna mostrar/minimizar', () => {
    const a = g.abrir(AP('pipeline'));
    const b = g.abrir(AP('documentos'));
    expect(g.alFrente()).toBe(b.id);
    g.traerAlFrente(a.id);
    expect(g.alFrente()).toBe(a.id);
    g.alternarDesdePestana(a.id);
    expect(g.ventanas().find(v => v.id === a.id)!.estado).toBe('minimizada');
    expect(g.alFrente()).toBe(b.id);
    g.alternarDesdePestana(a.id);
    expect(g.alFrente()).toBe(a.id);
  });

  it('mover y redimensionar se quedan dentro de la pantalla y se recuerdan por módulo', () => {
    const v = g.abrir(AP('tesoreria'));
    g.mover(v.id, 5000, 5000);
    const r = g.ventanas()[0].rect;
    expect(r.x + r.w).toBeLessThanOrEqual(1432);
    expect(r.y + r.h).toBeLessThanOrEqual(892);
    g.mover(v.id, 100, 120);
    g.redimensionar(v.id, 500, 400);
    expect(g.ventanas()[0].rect).toEqual({ x: 100, y: 120, w: 500, h: 400 });
    g.recordar(v.id);
    expect(JSON.parse(localStorage.getItem(CLAVE_STORAGE)!)['tesoreria']).toEqual({ x: 100, y: 120, w: 500, h: 400 });
    g.cerrar(v.id);
    // La próxima vez nace donde quedó.
    expect(g.abrir(AP('tesoreria')).rect).toEqual({ x: 100, y: 120, w: 500, h: 400 });
    // Grande no se mueve.
    g.maximizar('tesoreria|manual');
    g.mover('tesoreria|manual', 300, 300);
    expect(g.ventanas()[0].rect.x).toBe(100);
  });

  it('si el navegador se achica, todas se pintan dentro; al volver a crecer recuperan su tamaño; en móvil, pantalla completa', () => {
    g.abrir(AP('pipeline'));
    g.mover('pipeline|manual', 400, 100);
    g.redimensionar('pipeline|manual', 700, 500);
    const deseada = { ...g.ventanas()[0].rect };
    g.alCambiarViewport(800, 600);
    const r = g.rectVisible(g.ventanas()[0]);
    expect(r.x + r.w).toBeLessThanOrEqual(792);
    expect(r.y + r.h).toBeLessThanOrEqual(592);
    g.alCambiarViewport(390, 844);
    expect(g.movil()).toBeTrue();
    expect(g.estadoVisible(g.ventanas()[0])).toBe('maximizada');
    const carnet = g.abrir(AP('carnet'));
    expect(g.estadoVisible(carnet)).toBe('maximizada');
    g.minimizar('carnet|manual');
    g.restaurar('carnet|manual');
    expect(g.estadoVisible(g.ventanas().find(v => v.id === 'carnet|manual')!)).toBe('maximizada');
    // De vuelta al escritorio: la ventana vuelve a su tamaño y posición, no queda achicada ni grande.
    g.alCambiarViewport(1440, 900);
    expect(g.estadoVisible(g.ventanas()[0])).toBe('normal');
    expect(g.rectVisible(g.ventanas()[0])).toEqual(deseada);
  });

  it('un tamaño guardado con valores no numéricos no deja la ventana en NaN', () => {
    localStorage.setItem(CLAVE_STORAGE, JSON.stringify({ tesoreria: { x: 'a', y: null, w: 500, h: 400 }, carnet: { x: 10, y: 20, w: 400, h: 300 } }));
    const t = g.abrir(AP('tesoreria'));
    expect([t.rect.x, t.rect.y, t.rect.w, t.rect.h].every(Number.isFinite)).toBeTrue();
    expect(g.abrir(AP('carnet')).rect).toEqual({ x: 10, y: 20, w: 400, h: 300 });
    try { localStorage.removeItem(CLAVE_STORAGE); } catch { /* sin storage */ }
  });

  it('localStorage roto no rompe nada', () => {
    localStorage.setItem(CLAVE_STORAGE, '{no es json');
    expect(() => g.abrir(AP('pipeline'))).not.toThrow();
  });
});

describe('CapaVentanas (render)', () => {
  beforeEach(() => {
    try { localStorage.removeItem(CLAVE_STORAGE); } catch { /* sin storage */ }
    TestBed.configureTestingModule({ imports: [CapaVentanas], providers: [GestorVentanas] });
  });

  it('pinta la ventana con su barra y la pestaña; minimizar la esconde y la pestaña la trae', () => {
    const f = TestBed.createComponent(CapaVentanas);
    const g = TestBed.inject(GestorVentanas);
    g.alCambiarViewport(1440, 900);
    g.abrir(AP('documentos'));
    g.abrir(AP('pipeline', 'celular'), { minimizada: true });
    f.componentRef.setInput('cedula', '1020304');
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    const ventanas = el.querySelectorAll('.vf');
    expect(ventanas.length).toBe(2);
    expect(el.querySelectorAll('.vf--min').length).toBe(1);
    expect(el.querySelector('.vf__titulos strong')!.textContent).toContain('Gestión documental');
    expect(el.querySelector('.vf__cedula')!.textContent).toContain('1020304');
    // Origen distinto: no se enmarca (la ventana muestra el esqueleto de carga, sin iframe).
    expect(el.querySelector('iframe')).toBeNull();
    const pestanas = el.querySelectorAll('.pestana');
    expect(pestanas.length).toBe(2);
    expect(pestanas[1].classList).toContain('pestana--nueva');
    (el.querySelector('.vf__btn[aria-label="Minimizar a pestaña"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelectorAll('.vf--min').length).toBe(2);
    (pestanas[1].querySelector('.pestana__abrir') as HTMLButtonElement).click();
    f.detectChanges();
    expect(g.ventanas().find(v => v.id === 'pipeline|celular')!.estado).toBe('normal');
    (el.querySelector('.pestana .pestana__cerrar') as HTMLButtonElement).click();
    f.detectChanges();
    expect(g.ventanas().length).toBe(1);
  });
});

describe('Shell en modo embebido (la app dentro de una ventana flotante)', () => {
  it('solo dentro de un marco: ?embebido=1 abierto como pestaña normal no deja la app sin menú', () => {
    const w = {} as Window & typeof globalThis;
    expect(detectarEmbebido({ self: w, top: w })).toBeFalse();
    expect(detectarEmbebido({ self: w, top: {} as Window })).toBeTrue();
    // Padre de otro origen que no deja leer `top`: también es un marco.
    const cruzado = { self: w, get top(): Window { throw new DOMException('Blocked a frame', 'SecurityError'); } };
    expect(detectarEmbebido(cruzado)).toBeTrue();
  });
});
