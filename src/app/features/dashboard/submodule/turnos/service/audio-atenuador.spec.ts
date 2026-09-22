import { AudioAtenuador } from './audio-atenuador';

describe('AudioAtenuador', () => {
  let a: HTMLAudioElement; let v: HTMLVideoElement; let fondo: HTMLAudioElement;
  beforeEach(() => {
    a = document.createElement('audio'); a.volume = 0.8; document.body.appendChild(a);
    v = document.createElement('video'); v.volume = 1; document.body.appendChild(v);
    fondo = document.createElement('audio'); fondo.volume = 0.2; // fuera del DOM, como la música de fondo
  });
  afterEach(() => { a.remove(); v.remove(); });

  it('baja al porcentaje pedido y restaura al terminar la última voz', () => {
    const at = new AudioAtenuador();
    at.registrar(fondo);
    at.bajar(25);
    expect(a.volume).toBeCloseTo(0.2, 5);
    expect(v.volume).toBeCloseTo(0.25, 5);
    expect(fondo.volume).toBeCloseTo(0.05, 5);
    // Dos voces superpuestas: no se restaura hasta que termine la segunda.
    at.bajar(25);
    at.subir();
    expect(a.volume).toBeCloseTo(0.2, 5);
    at.subir();
    expect(a.volume).toBeCloseTo(0.8, 5);
    expect(v.volume).toBeCloseTo(1, 5);
    expect(fondo.volume).toBeCloseTo(0.2, 5);
  });

  it('subir sin bajar no rompe nada y olvidar saca el elemento', () => {
    const at = new AudioAtenuador();
    at.subir();
    at.registrar(fondo); at.olvidar(fondo);
    at.bajar(0);
    expect(fondo.volume).toBeCloseTo(0.2, 5);
    expect(a.volume).toBe(0);
    at.subir();
    expect(a.volume).toBeCloseTo(0.8, 5);
  });
});
