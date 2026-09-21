import { TestBed } from '@angular/core/testing';
import { AdaptadorVistaCaso, RegistroVistaCaso } from './vista-caso.registro';

function adaptador(): AdaptadorVistaCaso<{ x: number }> {
  return { capturar: () => ({ x: 1 }), restaurar: async () => {} };
}

describe('RegistroVistaCaso', () => {
  let registro: RegistroVistaCaso;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registro = TestBed.inject(RegistroVistaCaso);
  });

  it('la pantalla activa registra su adaptador y lo retira al morir', () => {
    const a = adaptador();
    const retirar = registro.registrar(a);
    expect(registro.adaptador()).toBe(a);
    retirar();
    expect(registro.adaptador()).toBeNull();
  });

  it('retirar un adaptador viejo no pisa al de la pantalla nueva', () => {
    const viejo = adaptador();
    const nuevo = adaptador();
    const retirarViejo = registro.registrar(viejo);
    registro.registrar(nuevo);
    retirarViejo();
    expect(registro.adaptador()).toBe(nuevo);
  });

  it('los cambios solo cuentan con una pantalla registrada', () => {
    registro.notificarCambio();
    expect(registro.cambios()).toBe(0);
    registro.registrar(adaptador());
    registro.notificarCambio();
    registro.notificarCambio();
    expect(registro.cambios()).toBe(2);
  });
});
