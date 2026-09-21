import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { Publicidad, idYoutube } from './publicidad';
import { Media, TurnosService } from '../../service/turnos.service';

describe('Publicidad', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Publicidad], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  function crear() {
    const f = TestBed.createComponent(Publicidad);
    f.detectChanges();
    return f;
  }

  it('reconoce el enlace pegado', () => {
    const c = crear().componentInstance;
    c.nuevaPieza();
    c.recibirEnlace('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(c.pieza().tipo).toBe('YOUTUBE');
    expect(c.pieza().titulo).toBe('Video de YouTube');
    c.recibirEnlace('https://vimeo.com/123456');
    expect(c.pieza().tipo).toBe('VIMEO');
    c.recibirEnlace('https://cdn.ejemplo.co/banner.png?x=1');
    expect(c.pieza().tipo).toBe('IMAGEN');
    c.recibirEnlace('https://cdn.ejemplo.co/spot.mp4');
    expect(c.pieza().tipo).toBe('VIDEO');
    c.recibirEnlace('https://cdn.ejemplo.co/jingle.mp3');
    expect(c.pieza().tipo).toBe('AUDIO');
    c.recibirEnlace('https://tuapo.co/promo');
    expect(c.pieza().tipo).toBe('HTML');
    expect(idYoutube('https://youtu.be/abcdefgh')).toBe('abcdefgh');
    expect(idYoutube('https://otro.com')).toBeNull();
  });

  it('reconoce el archivo soltado y propone el título', () => {
    const c = crear().componentInstance;
    c.nuevaPieza();
    c.recibirArchivos([new File(['x'], 'campana_seguridad-2026.png', { type: 'image/png' })]);
    expect(c.pieza().tipo).toBe('IMAGEN');
    expect(c.pieza().titulo).toBe('campana seguridad 2026');
    expect(c.archivoUrlLocal()).toContain('blob:');
    c.recibirArchivos([new File(['x'], 'spot.mp4', { type: 'video/mp4' })]);
    expect(c.pieza().tipo).toBe('VIDEO');
    c.recibirArchivos([new File(['x'], 'aviso.mp3', { type: 'audio/mpeg' })]);
    expect(c.pieza().tipo).toBe('AUDIO');
    c.recibirArchivos([new File(['x'], 'hoja.pdf', { type: 'application/pdf' })]);
    expect(c.error()).toContain('hoja.pdf');
    expect(c.pieza().tipo).toBe('AUDIO');
  });

  it('el borrador para la vista previa refleja el tipo, el archivo local y el audio generado', () => {
    const c = crear().componentInstance;
    c.nuevaPieza('AUDIO');
    c.set('titulo', 'Aviso');
    c.set('voz_texto', 'Hola');
    expect(c.esLocucion()).toBeTrue();
    c.audioVoz.set({ id: 'a1', url: '/api/v1/public/turnos/voz/audio/a1' } as never);
    expect(c.borrador().url).toBe('/api/v1/public/turnos/voz/audio/a1');
    expect(c.borrador().tipo).toBe('AUDIO');
    expect(c.borrador().titulo).toBe('Aviso');
    expect(c.vistaPreviaForm().bloques[0].tipo).toBe('PUBLICIDAD');
    expect(c.datosPreviaForm().piezas.length).toBe(1);
  });

  it('el alcance se traduce a filas: todas = ninguna, una oficina = una fila, avanzado = las que haya', () => {
    const f = crear();
    const c = f.componentInstance;
    const api = TestBed.inject(TurnosService);
    const crearMedia = spyOn(api, 'crearMedia').and.returnValue(of({ id: 'm1' } as unknown as Media));
    c.ctx.oficinas.set([{ id: 'of1', nombre: 'Suba' } as never]);
    c.nuevaPieza('TEXTO');
    c.set('titulo', 'Aviso');
    c.set('descripcion', 'Texto');
    c.guardarPieza();
    expect(crearMedia.calls.mostRecent().args[0].alcances).toEqual([]);

    c.nuevaPieza('TEXTO');
    c.set('titulo', 'Aviso');
    c.modoAlcance.set('OFICINA');
    c.oficinaAlcance.set('of1');
    c.guardarPieza();
    expect(crearMedia.calls.mostRecent().args[0].alcances).toEqual([{ tipo: 'OFICINA', valor_ref: 'of1', valor_nombre: 'Suba' }]);

    c.nuevaPieza('AUDIO');
    c.set('titulo', 'Perifoneo');
    c.set('voz_texto', 'Cierra a las cinco');
    c.set('intervalo_min', 30);
    c.set('dias', [1, 2, 3]);
    c.modoAlcance.set('AVANZADO');
    c.agregarAlcance();
    c.alcanceSet(0, { tipo: 'CIUDAD' });
    c.alcanceSet(0, { valor_ref: 'Facatativá' });
    c.guardarPieza();
    const cuerpo = crearMedia.calls.mostRecent().args[0];
    expect(cuerpo.alcances).toEqual([{ tipo: 'CIUDAD', valor_ref: 'Facatativá', valor_nombre: 'Facatativá' }]);
    expect(cuerpo.intervalo_min).toBe(30);
    expect(JSON.parse(cuerpo.horario_json!)).toEqual({ dias: [1, 2, 3], desde: '08:00', hasta: '17:00' });
    expect(cuerpo.silenciado).toBeFalse();
    expect(cuerpo.voz_texto).toBe('Cierra a las cinco');
  });

  it('un audio sin archivo, texto ni enlace no se guarda', () => {
    const c = crear().componentInstance;
    const api = TestBed.inject(TurnosService);
    const crearMedia = spyOn(api, 'crearMedia');
    c.nuevaPieza('AUDIO');
    c.set('titulo', 'Vacío');
    c.guardarPieza();
    expect(crearMedia).not.toHaveBeenCalled();
    expect(c.error()).toContain('audio');
  });

  // La página arranca cargando piezas, listas y voces: esas peticiones quedan abiertas a propósito.
  afterEach(() => { http.match(() => true); });
});
