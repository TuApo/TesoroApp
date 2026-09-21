import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ReproductorGuion } from './reproductor-guion';
import { DatosVista } from '../vista-render/vista-render';
import { DisenoResuelto, Vista } from '../../service/turnos.service';

function vista(id: string, nombre: string): Vista {
  return { id, oficina_id: null, nombre, descripcion: null, orientacion: 'HORIZONTAL', fondo: { tipo: 'COLOR', color: '#000' },
    bloques: [{ id: 'b', tipo: 'OFICINA', x: 0, y: 0, w: 50, h: 10, z: 1, estilo: {}, props: { texto: nombre } }], activa: true, creado_en: '', actualizado_en: '', usada_por: [] };
}

function diseno(al_llamar: string | null = null): DisenoResuelto {
  return {
    origen: 'OFICINA', vistas: [vista('a', 'Vista A'), vista('b', 'Vista B'), vista('ll', 'Llamado')], playlists: {}, url_turno: null, firma: 'f1',
    guion: { id: 'g', oficina_id: null, nombre: 'G', descripcion: null, alcance: 'OFICINA', activo: true, pantallas: [], duracion_total_seg: 8, creado_en: '', actualizado_en: '',
      pasos: [{ vista_id: 'a', duracion_seg: 3, transicion: 'NINGUNA', transicion_ms: 0 }, { vista_id: 'b', duracion_seg: 5, transicion: 'FUNDIDO', transicion_ms: 200 }],
      al_llamar_vista_id: al_llamar, al_llamar_seg: 4 },
  };
}

function datos(llamado: unknown = null): DatosVista {
  return { oficina_nombre: 'Suba', ahora: new Date(), llamado: llamado as never, en_curso: [], en_espera: [], piezas: [], playlists: {}, croquis: null, url_turno: null };
}

describe('ReproductorGuion', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ReproductorGuion], providers: [provideHttpClient(), provideHttpClientTesting()] });
  });

  function crear(d: DisenoResuelto) {
    const f = TestBed.createComponent(ReproductorGuion);
    f.componentRef.setInput('diseno', d);
    f.componentRef.setInput('datos', datos());
    f.detectChanges();
    return f;
  }

  it('recorre los pasos con su duración y vuelve al primero', fakeAsync(() => {
    const f = crear(diseno());
    const c = f.componentInstance;
    expect(c.paso()).toBe(0);
    expect(c.capas().map(x => x.vista.id)).toEqual(['a']);
    tick(3000);
    expect(c.paso()).toBe(1);
    // Durante la transición conviven la saliente y la entrante.
    expect(c.capas().map(x => x.vista.id)).toEqual(['a', 'b']);
    expect(c.capas()[0].sale).toBeTrue();
    tick(250);
    expect(c.capas().map(x => x.vista.id)).toEqual(['b']);
    tick(5000);
    expect(c.paso()).toBe(0);
    discardPeriodicTasks();
  }));

  it('al cantar un turno salta a la vista de llamado y vuelve', fakeAsync(() => {
    const f = crear(diseno('ll'));
    const c = f.componentInstance;
    tick(1000);
    f.componentRef.setInput('datos', datos({ id: 't1', codigo: 'A-014' }));
    f.detectChanges();
    tick(450);
    expect(c.enLlamado()).toBeTrue();
    expect(c.capas().map(x => x.vista.id)).toEqual(['ll']);
    tick(4000 + 450);
    expect(c.enLlamado()).toBeFalse();
    expect(c.capas().map(x => x.vista.id)).toEqual(['a']);
    discardPeriodicTasks();
  }));

  it('sin vista de llamado un turno no interrumpe la secuencia', fakeAsync(() => {
    const f = crear(diseno(null));
    const c = f.componentInstance;
    f.componentRef.setInput('datos', datos({ id: 't1', codigo: 'A-014' }));
    f.detectChanges();
    tick(100);
    expect(c.enLlamado()).toBeFalse();
    expect(c.capas().map(x => x.vista.id)).toEqual(['a']);
    discardPeriodicTasks();
  }));

  it('un diseño con otra firma arranca de nuevo desde el primer paso', fakeAsync(() => {
    const f = crear(diseno());
    const c = f.componentInstance;
    tick(3000);
    expect(c.paso()).toBe(1);
    f.componentRef.setInput('diseno', { ...diseno(), firma: 'f2' });
    f.detectChanges();
    tick(300);
    expect(c.paso()).toBe(0);
    discardPeriodicTasks();
  }));
});
