import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { AutoGuardado, GuardadoIncompleto } from './auto-guardado';

describe('AutoGuardado', () => {
  let persona: string;
  let guardados: string[];
  let falla: any;
  let auto: AutoGuardado;
  const destroyRef = { onDestroy: (_: () => void) => () => undefined } as any;

  beforeEach(() => {
    persona = 'CC|1';
    guardados = [];
    falla = null;
    auto = new AutoGuardado(async () => {
      if (falla) throw falla;
      guardados.push(persona);
    }, () => persona);
  });

  afterEach(() => (document.activeElement as HTMLElement | null)?.blur?.());

  it('un cambio en una lista se guarda tras la pausa corta', fakeAsync(() => {
    const form = new FormGroup({ tipo: new FormControl('') });
    auto.vigilar(form, destroyRef);
    form.markAsDirty();
    form.get('tipo')!.setValue('APTO');
    expect(auto.estado()).toBe('pendiente');
    tick(300);
    flushMicrotasks();
    expect(guardados).toEqual(['CC|1']);
    expect(auto.estado()).toBe('guardado');
  }));

  it('lo que parchea el código (sin tocar) no se guarda', fakeAsync(() => {
    const form = new FormGroup({ tipo: new FormControl('') });
    auto.vigilar(form, destroyRef);
    form.patchValue({ tipo: 'APTO' });
    tick(1000);
    expect(guardados).toEqual([]);
  }));

  it('escribiendo en un texto espera a salir del campo', fakeAsync(() => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    auto.cambio();
    tick(1000);
    expect(guardados).toEqual([]);
    expect(auto.estado()).toBe('pendiente');
    input.blur();
    auto.alSalirDeCampo();
    flushMicrotasks();
    expect(guardados).toEqual(['CC|1']);
    tick(2000);
    expect(guardados).withContext('salir del campo no deja otro guardado pendiente').toEqual(['CC|1']);
    input.remove();
  }));

  it('escribiendo, una pausa también guarda (F5 sin salir del campo)', fakeAsync(() => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    auto.cambio();
    tick(AutoGuardado.PAUSA_ESCRIBIENDO);
    flushMicrotasks();
    expect(guardados).toEqual(['CC|1']);
    input.remove();
  }));

  it('si se abrió otra persona antes de guardar, se descarta', fakeAsync(() => {
    auto.programar();
    persona = 'CC|2';
    tick(300);
    flushMicrotasks();
    expect(guardados).toEqual([]);
    expect(auto.estado()).toBe('inactivo');
  }));

  it('lo que cambia mientras guarda sale en una segunda escritura', fakeAsync(() => {
    let soltar!: () => void;
    let llamadas = 0;
    const lento = new AutoGuardado(() => {
      llamadas++;
      return llamadas === 1 ? new Promise<void>(r => (soltar = r)) : Promise.resolve();
    }, () => persona);
    void lento.ahora();
    void lento.ahora();
    expect(llamadas).toBe(1);
    soltar();
    flushMicrotasks();
    expect(llamadas).toBe(2);
  }));

  it('un error queda visible y un faltante no cuenta como error', fakeAsync(() => {
    falla = { error: { detail: 'sin proceso' } };
    void auto.ahora();
    flushMicrotasks();
    expect(auto.estado()).toBe('error');
    expect(auto.error()).toBe('sin proceso');

    falla = new GuardadoIncompleto('Elija la vacante');
    void auto.ahora();
    flushMicrotasks();
    expect(auto.estado()).toBe('incompleto');
    expect(auto.error()).toBe('Elija la vacante');
  }));
});
