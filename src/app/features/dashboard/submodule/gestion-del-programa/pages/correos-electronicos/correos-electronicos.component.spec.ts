/**
 * Pruebas de lógica pura de la pantalla Correos electrónicos. Se ejerce el
 * componente sin TestBed (el constructor solo asigna dependencias; ngOnInit no
 * se invoca), mismo patrón que la spec de Centros de Costo.
 *
 * Cubre: buscador client-side, mapeo de filtros a parámetros de servidor,
 * indicadores, verificación (éxito y fallo), estados vacíos y de error HTTP, y
 * que no exista ninguna acción de borrado.
 */
import { of, throwError } from 'rxjs';

import { CorreosElectronicosComponent } from './correos-electronicos.component';
import { CorreoCuenta, CuotaResumen } from '../../models/correo-cuenta.model';

function cuenta(over: Partial<CorreoCuenta> = {}): CorreoCuenta {
  return {
    id: 'id-1',
    direccion: 'nomina@tuapo.co',
    nombre_mostrar: 'Nómina TuApo',
    proveedor: 'GMAIL',
    proposito: 'Nómina',
    smtp_host: 'smtp.gmail.com',
    smtp_port: 465,
    smtp_usuario: 'nomina@tuapo.co',
    cuota_diaria: 500,
    limite_efectivo: 450,
    umbral_corte_pct: 90,
    enviados_hoy: 0,
    disponible_hoy: 450,
    estado_verificacion: 'VERIFICADA',
    ultima_verificacion: '2026-08-03T10:00:00Z',
    mensaje_ultima_verificacion: 'Conexion y autenticacion SMTP correctas.',
    activo: true,
    notas: null,
    credencial_configurada: true,
    aporta_cuota: true,
    creado_por: null,
    creado_en: '2026-08-01T10:00:00Z',
    actualizado_por: null,
    actualizado_en: null,
    ...over,
  };
}

const RESUMEN: CuotaResumen = {
  cuentas_activas: 4,
  cuentas_verificadas: 3,
  cuota_total: 1000,
  limite_efectivo_total: 900,
  umbral_corte_pct: 90,
  enviados_hoy: 120,
  disponible_hoy: 780,
};

function nuevoComponente(svc: any = {}): CorreosElectronicosComponent {
  const dialog: any = {};
  const snackBar: any = { open: () => {} };
  const cdr: any = { markForCheck: () => {} };
  return new CorreosElectronicosComponent(svc, dialog, snackBar, cdr);
}

describe('CorreosElectronicos — filtros y listado', () => {
  it('el buscador filtra por dirección, nombre, propósito, host y usuario', () => {
    const c = nuevoComponente();
    (c as any).all = [
      cuenta({ id: '1', direccion: 'nomina@tuapo.co', proposito: 'Nómina' }),
      cuenta({ id: '2', direccion: 'afiliaciones@tuapo.co', nombre_mostrar: 'Afiliaciones', proposito: 'Afiliaciones' }),
    ];

    c.onSearchChange('afilia');
    expect(c.dataSource.data.map((x) => x.id)).toEqual(['2']);

    c.onSearchChange('smtp.gmail.com');
    expect(c.dataSource.data.length).toBe(2);

    c.onSearchChange('');
    expect(c.dataSource.data.length).toBe(2);
  });

  it('mapea el filtro de estado al parámetro del backend', () => {
    const c = nuevoComponente();
    c.filterEstado = 'activas';
    expect((c as any).estadoParam()).toBeTrue();
    c.filterEstado = 'inactivas';
    expect((c as any).estadoParam()).toBeFalse();
    c.filterEstado = 'todas';
    expect((c as any).estadoParam()).toBeNull();
  });

  it('cargar() envía proveedor, activo y estado de verificación al backend', () => {
    const svc: any = {
      listar: jasmine.createSpy('listar').and.returnValue(of([cuenta()])),
      resumenCuota: () => of(RESUMEN),
    };
    const c = nuevoComponente(svc);
    c.filterProveedor = 'YANDEX';
    c.filterEstado = 'inactivas';
    c.filterVerificacion = 'PENDIENTE';

    c.cargar();

    expect(svc.listar).toHaveBeenCalledWith({
      proveedor: 'YANDEX', activo: false, estadoVerificacion: 'PENDIENTE',
    });
    expect(c.isLoading).toBeFalse();
    expect(c.dataSource.data.length).toBe(1);
  });

  it('limpiarFiltros() vuelve al estado inicial y recarga', () => {
    const svc: any = { listar: () => of([]), resumenCuota: () => of(RESUMEN) };
    const c = nuevoComponente(svc);
    c.filterSearch = 'algo';
    c.filterProveedor = 'GMAIL';
    c.filterVerificacion = 'ERROR_CONEXION';
    c.filterEstado = 'todas';

    c.limpiarFiltros();

    expect(c.filterSearch).toBe('');
    expect(c.filterProveedor).toBe('');
    expect(c.filterVerificacion).toBe('');
    expect(c.filterEstado).toBe('activas');
  });

  it('sin resultados la tabla queda vacía (estado vacío)', () => {
    const svc: any = { listar: () => of([]), resumenCuota: () => of(RESUMEN) };
    const c = nuevoComponente(svc);
    c.cargar();
    expect(c.dataSource.data.length).toBe(0);
    expect(c.cargaFallida).toBeFalse();
  });

  it('un error HTTP marca cargaFallida y deja la tabla vacía', () => {
    const svc: any = {
      listar: () => throwError(() => ({ error: { error: 'boom' } })),
      resumenCuota: () => throwError(() => ({})),
    };
    const c = nuevoComponente(svc);
    c.cargar();
    expect(c.cargaFallida).toBeTrue();
    expect(c.isLoading).toBeFalse();
    expect(c.dataSource.data.length).toBe(0);
    expect(c.resumen).toBeNull();
  });
});

describe('CorreosElectronicos — indicadores', () => {
  it('carga el resumen de cuota junto con el listado', () => {
    const svc: any = { listar: () => of([cuenta()]), resumenCuota: () => of(RESUMEN) };
    const c = nuevoComponente(svc);
    c.cargar();
    expect(c.resumen?.cuota_total).toBe(1000);
    expect(c.resumen?.limite_efectivo_total).toBe(900);
    expect(c.resumen?.disponible_hoy).toBe(780);
    expect(c.resumen?.enviados_hoy).toBe(120);
    expect(c.umbralCorte).toBe(90);
  });
});

describe('CorreosElectronicos — verificación', () => {
  it('una verificación exitosa refresca listado e indicadores', () => {
    const svc: any = {
      verificar: jasmine.createSpy('verificar').and.returnValue(
        of({ verificada: true, estado_verificacion: 'VERIFICADA', mensaje: 'ok', cuenta: cuenta() }),
      ),
      listar: jasmine.createSpy('listar').and.returnValue(of([cuenta()])),
      resumenCuota: jasmine.createSpy('resumenCuota').and.returnValue(of(RESUMEN)),
    };
    const c = nuevoComponente(svc);

    c.verificar(cuenta());

    expect(svc.verificar).toHaveBeenCalledWith('id-1');
    expect(svc.listar).toHaveBeenCalled();
    expect(svc.resumenCuota).toHaveBeenCalled();
    expect(c.verificandoId).toBeNull();
  });

  it('un fallo de verificación no rompe la pantalla y libera el spinner', () => {
    const svc: any = {
      verificar: () => throwError(() => ({ error: { error: 'La cuenta esta desactivada' } })),
      listar: () => of([]),
      resumenCuota: () => of(RESUMEN),
    };
    const c = nuevoComponente(svc);

    c.verificar(cuenta());
    expect(c.verificandoId).toBeNull();
  });
});

describe('CorreosElectronicos — consumo real', () => {
  it('la barra de uso refleja lo enviado contra el tope del día', () => {
    const c = nuevoComponente();
    expect(c.porcentajeUso(cuenta({ enviados_hoy: 0, limite_efectivo: 1350 }))).toBe(0);
    expect(c.porcentajeUso(cuenta({ enviados_hoy: 1350, limite_efectivo: 1350 }))).toBe(100);
    expect(c.porcentajeUso(cuenta({ enviados_hoy: 675, limite_efectivo: 1350 }))).toBe(50);
  });

  it('nunca pasa del 100% ni divide por cero', () => {
    const c = nuevoComponente();
    expect(c.porcentajeUso(cuenta({ enviados_hoy: 5000, limite_efectivo: 1350 }))).toBe(100);
    expect(c.porcentajeUso(cuenta({ enviados_hoy: 10, limite_efectivo: 0 }))).toBe(0);
  });

  it('la tabla muestra consumo y disponible por cuenta', () => {
    const c = nuevoComponente();
    expect(c.displayedColumns).toContain('enviados_hoy');
    expect(c.displayedColumns).toContain('disponible_hoy');
  });
});

describe('CorreosElectronicos — auto-refresco', () => {
  it('un refresco de fondo no muestra el spinner ni vacía la tabla si falla', () => {
    const svc: any = { listar: () => of([cuenta()]), resumenCuota: () => of(RESUMEN) };
    const c = nuevoComponente(svc);
    c.cargar();
    expect(c.dataSource.data.length).toBe(1);

    // Ahora el backend falla, pero en modo silencioso.
    (c as any).correos = {
      listar: () => throwError(() => ({ status: 503 })),
      resumenCuota: () => throwError(() => ({})),
    };
    c.cargar(true);

    expect(c.isLoading).toBeFalse();
    expect(c.cargaFallida).toBeFalse();
    expect(c.dataSource.data.length).toBe(1);
    expect(c.resumen).not.toBeNull();
  });

  it('registra la marca de tiempo tras un refresco exitoso', () => {
    const svc: any = { listar: () => of([cuenta()]), resumenCuota: () => of(RESUMEN) };
    const c = nuevoComponente(svc);
    expect(c.ultimoRefresco).toBeNull();
    c.cargar();
    expect(c.ultimoRefresco).not.toBeNull();
    expect(c.segundosDesdeRefresco).toBe(0);
  });

  it('el texto de frescura se adapta al tiempo transcurrido', () => {
    const c = nuevoComponente();
    expect(c.textoFrescura).toBe('sin datos');

    c.ultimoRefresco = new Date();
    c.segundosDesdeRefresco = 2;
    expect(c.textoFrescura).toBe('actualizado ahora');
    c.segundosDesdeRefresco = 35;
    expect(c.textoFrescura).toBe('actualizado hace 35 s');
    c.segundosDesdeRefresco = 130;
    expect(c.textoFrescura).toBe('actualizado hace 2 min');
  });

  it('se puede pausar y reanudar la actualización automática', () => {
    const svc: any = { listar: () => of([]), resumenCuota: () => of(RESUMEN) };
    const c = nuevoComponente(svc);
    expect(c.autoRefresco).toBeTrue();

    c.toggleAutoRefresco();
    expect(c.autoRefresco).toBeFalse();

    c.toggleAutoRefresco();
    expect(c.autoRefresco).toBeTrue();
  });

  it('ngOnDestroy limpia los temporizadores', () => {
    const svc: any = { listar: () => of([]), resumenCuota: () => of(RESUMEN) };
    const c = nuevoComponente(svc);
    c.ngOnInit();
    expect((c as any).timerRefresco).not.toBeNull();

    c.ngOnDestroy();
    expect((c as any).timerRefresco).toBeNull();
  });
});

describe('CorreosElectronicos — presentación y borrado lógico', () => {
  it('cada estado de verificación tiene etiqueta e ícono propios', () => {
    const c = nuevoComponente();
    expect(c.estadoMeta('VERIFICADA').label).toBe('Verificada');
    expect(c.estadoMeta('PENDIENTE').clase).toBe('estado-pendiente');
    expect(c.estadoMeta('ERROR_AUTENTICACION').clase).toBe('estado-error-auth');
    expect(c.estadoMeta('ERROR_CONEXION').clase).toBe('estado-error-conexion');
    expect(c.estadoMeta('DESHABILITADA').clase).toBe('estado-deshabilitada');
  });

  it('traduce el proveedor a su etiqueta visible', () => {
    const c = nuevoComponente();
    expect(c.proveedorLabel('SMTP_PROPIO')).toBe('SMTP propio');
    expect(c.proveedorLabel('DESCONOCIDO')).toBe('DESCONOCIDO');
  });

  it('no expone ninguna acción de eliminar', () => {
    const c = nuevoComponente();
    expect((c as any).eliminar).toBeUndefined();
    expect(c.displayedColumns).not.toContain('eliminar');
    expect(c.displayedColumns).toContain('acciones');
  });
});
