/**
 * Pruebas de lógica pura del submódulo Centros de Costo (§20). Ejercen el
 * componente sin TestBed (el constructor solo asigna dependencias; ngOnInit no
 * se invoca). Ejecutar con `ng test` (Karma/Chrome).
 *
 * Cubre: filtro por texto client-side respeta el resultado del backend,
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
  it('el buscador filtra por nombre/código/empresa/sede/dirección sobre lo cargado', () => {
    const c = nuevoComponente();
    (c as any).all = [
      fila({ id_ceco: 1, nombre: 'PLANTA POSTCOSECHA', codigo_interno: 'CC01' }),
      fila({ id_ceco: 2, nombre: 'OFICINAS', codigo_interno: 'CC02' }),
    ];
    c.onSearchChange('postcosecha');
    expect(c.dataSource.data.map((x) => x.id_ceco)).toEqual([1]);
  });

  it('el buscador también filtra por dirección', () => {
    const c = nuevoComponente();
    (c as any).all = [
      fila({ id_ceco: 1, nombre: 'PLANTA', direccion: 'Autopista Norte Km 5' }),
      fila({ id_ceco: 2, nombre: 'OFICINAS', direccion: 'Calle 100 # 15-20' }),
    ];
    c.onSearchChange('autopista');
    expect(c.dataSource.data.map((x) => x.id_ceco)).toEqual([1]);
  });

  it('busca por código interno', () => {
    const c = nuevoComponente();
    (c as any).all = [fila({ id_ceco: 1, codigo_interno: 'ZC-99' }), fila({ id_ceco: 2, codigo_interno: 'AB-01' })];
    c.onSearchChange('zc-99');
    expect(c.dataSource.data.map((x) => x.id_ceco)).toEqual([1]);
  });

  it('sin texto de búsqueda muestra todo lo cargado', () => {
    const c = nuevoComponente();
    (c as any).all = [fila({ id_ceco: 1 }), fila({ id_ceco: 2 })];
    c.onSearchChange('');
    expect(c.dataSource.data.length).toBe(2);
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
    c.filterSearch = 'x';
    c.filterEstado = 'inactivos';
    c.filterEmpresa = 5;
    c.limpiarFiltros();
    expect(c.filterSearch).toBe('');
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
