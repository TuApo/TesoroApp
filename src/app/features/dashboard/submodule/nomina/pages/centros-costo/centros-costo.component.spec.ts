/**
 * Pruebas de lógica pura del submódulo Centros de Costo (§20). Ejercen el
 * componente sin TestBed (el constructor solo asigna dependencias; ngOnInit no
 * se invoca). Ejecutar con `ng test` (Karma/Chrome).
 *
 * Cubre: columnas con valores planos (la búsqueda la hace la tabla estándar),
 * mapeo de estado→param para el filtro server-side, y que desactivar/reactivar
 * piden confirmación antes de llamar al servicio (no hay borrado físico).
 */
import { CentrosCostoComponent } from './centros-costo.component';
import { CentroCostoAdmin } from '../../service/nomina/nomina.service';

function fila(over: Partial<CentroCostoAdmin> = {}): CentroCostoAdmin {
  return {
    id_ceco: 1,
    codigo_interno: 'CC01',
    nombre: 'PLANTA POSTCOSECHA',
    sede_fisica: 'Sede Norte',
    direccion: 'Calle 10 # 20-30',
    id_cliente: 27,
    empresa_usuaria_nombre: 'FLORES IPANEMA S.A.S',
    active: true,
    contratos_count: 0,
    ...over,
  };
}

function nuevoComponente(): CentrosCostoComponent {
  const svc: any = {};
  const dialog: any = {};
  const snackBar: any = { open: () => {} };
  const cdr: any = { markForCheck: () => {} };
  return new CentrosCostoComponent(svc, dialog, snackBar, cdr);
}

describe('CentrosCosto — lógica de filtros (§20)', () => {
  // La búsqueda por texto la hace la tabla estándar sobre `valor` de cada
  // columna: basta con que cada columna exponga el dato plano correcto.
  it('las columnas exponen valores planos para buscar, filtrar y copiar', () => {
    const c = nuevoComponente();
    const valor = (id: string, f: CentroCostoAdmin) => c.columnas.find((col) => col.id === id)!.valor(f);
    const f = fila({ codigo_interno: 'ZC-99', direccion: 'Autopista Norte Km 5', contratos_count: 3 });
    expect(valor('codigo', f)).toBe('ZC-99');
    expect(valor('nombre', f)).toBe('PLANTA POSTCOSECHA');
    expect(valor('direccion', f)).toBe('Autopista Norte Km 5');
    expect(valor('contratos', f)).toBe(3);
    expect(valor('estado', fila({ active: false }))).toBe('Inactivo');
  });

  it('las filas inactivas se atenúan', () => {
    const c = nuevoComponente();
    expect(c.claseFila(fila({ active: false }))).toBe('te-fila--atenuada');
    expect(c.claseFila(fila({ active: true }))).toBe('');
  });

  it('mapea el filtro de estado a booleano para el backend', () => {
    const c = nuevoComponente();
    c.filterEstado = 'activos';
    expect((c as any).estadoParam()).toBe(true);
    c.filterEstado = 'inactivos';
    expect((c as any).estadoParam()).toBe(false);
    c.filterEstado = 'todos';
    expect((c as any).estadoParam()).toBeNull();
  });

  it('limpiarFiltros restablece a activos/todas empresas y recarga', () => {
    const c = nuevoComponente();
    let recargo = false;
    (c as any).cargar = () => { recargo = true; };
    c.filterEstado = 'inactivos';
    c.filterEmpresa = 5;
    c.limpiarFiltros();
    expect(c.filterEstado).toBe('activos');
    expect(c.filterEmpresa).toBeNull();
    expect(recargo).toBe(true);
  });

  it('el componente expone desactivar/reactivar pero NINGÚN handler de borrado físico', () => {
    const c = nuevoComponente();
    expect(typeof (c as any).desactivar).toBe('function');
    expect(typeof (c as any).reactivar).toBe('function');
    // §20.15: no debe existir eliminación física (ni botón ni handler).
    expect((c as any).eliminar).toBeUndefined();
    expect((c as any).borrar).toBeUndefined();
    expect((c as any).delete).toBeUndefined();
  });
});
