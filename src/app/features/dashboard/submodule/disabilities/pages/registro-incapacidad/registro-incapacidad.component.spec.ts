/**
 * Pruebas de la vista de REGISTRO DE INCAPACIDAD.
 *
 * Cubren lo exigido por el enunciado:
 *  - autocompletado tras seleccionar al empleado (incluido el bug historico
 *    del fondo de pensiones: debe salir de `afp.afp`, NUNCA de `afp.afc`);
 *  - calculo de la edad desde `fecha_nacimiento` (en sus DOS formatos
 *    reales) y descarte de la basura conocida;
 *  - disparo de la validacion con debounce de 400 ms y cancelacion;
 *  - visibilidad condicional de los soportes (la dicta el backend);
 *  - bloqueo del boton "Guardar y validar".
 */

import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { RegistroIncapacidadComponent, cargoDeContratacion } from './registro-incapacidad.component';
import {
  CatalogosIncapacidad,
  DatosContratacionResponse,
  EmpleadoBusqueda,
  SoporteIncapacidad,
  TipoSoporte,
  ValidacionResponse,
} from '../../models/incapacidad-v2.model';

// ─────────────────────────────────────────────────────────────────────────
// Datos de apoyo
// ─────────────────────────────────────────────────────────────────────────

const CATALOGOS: CatalogosIncapacidad = {
  tiposIncapacidad: [
    { codigo: 'ENFERMEDAD_GENERAL', etiqueta: 'Enfermedad general' },
    { codigo: 'ACCIDENTE_TRABAJO', etiqueta: 'Accidente de trabajo' },
    { codigo: 'ENFERMEDAD_LABORAL', etiqueta: 'Enfermedad laboral' },
    { codigo: 'ACCIDENTE_TRANSITO', etiqueta: 'Accidente de transito' },
    { codigo: 'LICENCIA_MATERNIDAD', etiqueta: 'Licencia de maternidad' },
    { codigo: 'LICENCIA_PATERNIDAD', etiqueta: 'Licencia de paternidad' },
  ],
  estados: [{ codigo: 'RECIBIDA', etiqueta: 'Recibida' }],
  estadosDocumento: [
    { codigo: 'OK', etiqueta: 'Completa' },
    { codigo: 'INCOMPLETA', etiqueta: 'Incompleta' },
    { codigo: 'PRESCRITA', etiqueta: 'Prescrita', automatico: true },
    { codigo: 'NO_CUMPLE', etiqueta: 'No cumple', automatico: true },
  ],
  responsablesPago: [
    { codigo: 'EPS_Y_EMPLEADOR', etiqueta: 'EPS y empleador' },
    { codigo: 'NO_PAGAR', etiqueta: 'No pagar' },
  ],
  tiposSoporte: [{ codigo: 'INCAPACIDAD_MEDICA', etiqueta: 'Incapacidad' }],
};

const EMPLEADO: EmpleadoBusqueda = {
  cedula: '1001',
  nombreCompleto: 'JUAN CARLOS PEREZ GOMEZ',
  tipoDocumento: 'CC',
  empresa: 'APOYO LABORAL TS SAS',
  centroCosto: 'CC-100',
  temporal: 'AL',
  numeroContrato: 'K-9',
  fechaIngreso: '2020-03-01',
  // Llega con espacio final, como en produccion.
  eps: 'NUEVA EPS ',
  afp: 'PORVENIR',
  oficina: 'CHIA',
};

const DATOS_CONTRATACION: DatosContratacionResponse = {
  datos_basicos: {
    numerodeceduladepersona: '1001',
    tipodedocumento: 'CC',
    primer_apellido: 'PEREZ',
    segundo_apellido: 'GOMEZ',
    primer_nombre: 'JUAN',
    segundo_nombre: 'CARLOS',
    genero: 'MASCULINO',
    primercorreoelectronico: 'juan@correo.com',
    celular: '3001234567',
    whatsapp: '3001234567',
    fecha_nacimiento: '1990-05-12',
    oficina: 'CHIA',
    // Solo esta poblado en el 41% de los casos: la vista NO debe usarlo.
    edadTrabajador: 99,
  },
  contratacion: {
    codigo_contrato: 'K-9',
    fecha_contratacion: '2020-03-01',
    temporal: 'AL',
    cargo: 'OPERARIO',
    fechaIngreso: '2020-03-01',
    centro_de_costos: 'CC-100',
    nombre_eps_afiliada: 'NUEVA EPS ',
    nombre_afp: 'PORVENIR',
    empresaUsuaraYCCentrodeCosto: 'APOYO LABORAL TS SAS',
  },
  afp: {
    eps: 'NUEVA EPS ',
    // `afp` = pension obligatoria. `afc` = CESANTIAS (bug del form viejo).
    afp: 'PORVENIR',
    afc: 'PROTECCION CESANTIAS',
  },
};

function validacionBase(cambios: Partial<ValidacionResponse> = {}): ValidacionResponse {
  return {
    dias: 3,
    diasEmpresa: 2,
    diasEntidad: 1,
    entidadResponsable: 'EPS',
    responsablePago: 'EPS_Y_EMPLEADOR',
    esProrroga: false,
    prorrogaDeId: null,
    tieneTraslape: false,
    idsTraslapados: [],
    cumpleCotizacion: true,
    diasDesdeIngreso: 1800,
    estaPrescrita: false,
    diasHabilesTranscurridos: 2,
    diasAcumuladosDiagnostico: 3,
    superado180: false,
    superado540: false,
    proximoA180: false,
    estadoDocumentoResultante: 'OK',
    estadoSugerido: 'RECIBIDA',
    puedeValidar: true,
    motivosBloqueo: [],
    soportes: [
      {
        tipo: 'INCAPACIDAD_MEDICA',
        etiqueta: 'Incapacidad',
        visible: true,
        obligatorio: true,
        cargado: false,
      },
      {
        tipo: 'HISTORIAL_CLINICO',
        etiqueta: 'Historia clinica',
        visible: true,
        obligatorio: false,
        cargado: false,
      },
      {
        tipo: 'FURAT',
        etiqueta: 'FURAT',
        visible: false,
        obligatorio: false,
        cargado: false,
      },
      {
        tipo: 'REGISTRO_CIVIL',
        etiqueta: 'Registro civil',
        visible: false,
        obligatorio: false,
        cargado: false,
      },
    ],
    alertas: [{ nivel: 'INFO', codigo: 'R1_DIAS', mensaje: 'Incapacidad de 3 dias.' }],
    ...cambios,
  };
}

// ─────────────────────────────────────────────────────────────────────────

describe('RegistroIncapacidadComponent', () => {
  let fixture: ComponentFixture<RegistroIncapacidadComponent>;
  let comp: RegistroIncapacidadComponent;
  let http: HttpTestingController;

  /** Matriz de EPS minima (V43): la lista CERRADA que puebla el selector. */
  const EPS_MATRIZ = [
    {
      nombre: 'NUEVA EPS',
      formaCargue: 'UN_SOLO_PDF',
      formaCargueEtiqueta: 'Un solo PDF',
      requiereSoporteEps: false,
      orden: 90,
    },
    {
      nombre: 'SALUD TOTAL EPS',
      formaCargue: 'PDF_POR_DOCUMENTO',
      formaCargueEtiqueta: 'PDF por cada documento',
      requiereSoporteEps: true,
      orden: 100,
    },
    {
      nombre: 'SURA EPS',
      formaCargue: 'UN_SOLO_PDF',
      formaCargueEtiqueta: 'Un solo PDF',
      requiereSoporteEps: false,
      orden: 110,
    },
  ];

  /** Resuelve las peticiones que el componente dispara al construirse. */
  function resolverCargaInicial(): void {
    http
      .expectOne((r) => r.url.endsWith('/Incapacidades/v2/catalogos'))
      .flush(CATALOGOS);
    http
      .expectOne((r) => r.url.endsWith('/Incapacidades/v2/eps-matriz'))
      .flush(EPS_MATRIZ);
  }

  /** Selecciona al empleado y responde la consulta de contratacion. */
  function seleccionarEmpleado(datos: DatosContratacionResponse = DATOS_CONTRATACION): void {
    comp.alSeleccionarEmpleado(EMPLEADO);
    http
      .expectOne((r) => r.url.includes('/contratacion/datosIncapacidadContratacion/1001'))
      .flush(datos);
  }

  /** Elige un PDF valido para un tipo de soporte, como haria el usuario. */
  function elegirPdf(tipo: TipoSoporte, nombre = 'inc.pdf'): void {
    comp.alElegirArchivo(
      eventoDeArchivo(new File(['x'], nombre, { type: 'application/pdf' })),
      tipo,
    );
  }

  /**
   * Dispara el guardado y atiende la validacion FRESCA que `guardar()` pide antes de
   * evaluar los gates (soporte minimo, aviso NO PAGAR) — asi los gates nunca corren
   * sobre el resultado viejo del debounce de 400 ms.
   */
  function guardarYFlushValidar(
    conValidacion: boolean,
    respuesta: ValidacionResponse = validacionBase(),
  ): void {
    comp.guardar(conValidacion);
    http.expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar')).flush(respuesta);
  }

  /** Deja el formulario con el nucleo minimo que dispara la validacion. */
  function completarIncapacidad(): void {
    comp.form.controls.incapacidad.patchValue({
      tipoIncapacidad: 'ENFERMEDAD_GENERAL',
      fechaInicio: new Date(2025, 0, 10),
      fechaFin: new Date(2025, 0, 12),
      codigoDiagnostico: 'J00',
      eps: 'NUEVA EPS',
    });
  }

  beforeEach(async () => {
    // El usuario logueado con sede evita el GET de oficinas y deja
    // Oficina / Nombre de quien recibe en solo lectura.
    localStorage.setItem(
      'user',
      JSON.stringify({
        id: 'u-1',
        email: 'admin@nova-col.com',
        datos_basicos: { nombres: 'ANA', apellidos: 'RUIZ' },
        sede: { id: 3, nombre: 'CHIA' },
        rol: { id: 1, nombre: 'ADMIN' },
      }),
    );
    localStorage.setItem('token', 'Bearer token-de-prueba');

    await TestBed.configureTestingModule({
      imports: [RegistroIncapacidadComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        // La ruta hermana `registro/:id` reutiliza esta pantalla: el
        // componente lee `paramMap`, asi que el router debe existir.
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RegistroIncapacidadComponent);
    comp = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
  });

  // ── Arranque ────────────────────────────────────────────────────────

  it('se crea y pide los catalogos una sola vez', () => {
    expect(comp).toBeTruthy();
    resolverCargaInicial();
    http.verify();
  });

  it('el selector de EPS ofrece la matriz de cartera EN SU ORDEN, no alfabetico', () => {
    resolverCargaInicial();
    expect(comp.opcionesEps()).toEqual(['NUEVA EPS', 'SALUD TOTAL EPS', 'SURA EPS']);
    http.verify();
  });

  it('si la matriz de EPS falla, degrada a la lista del endpoint legacy', () => {
    http.expectOne((r) => r.url.endsWith('/Incapacidades/v2/catalogos')).flush(CATALOGOS);
    http
      .expectOne((r) => r.url.endsWith('/Incapacidades/v2/eps-matriz'))
      .flush({ error: 'sin matriz' }, { status: 503, statusText: 'Service Unavailable' });
    http
      .expectOne((r) => r.url.endsWith('/Incapacidades/traerTodaslistas'))
      .flush({ codigos: [], eps: [{ nombreeps: 'NUEVA EPS ' }, { nombreeps: 'SURA ' }], IPSNames: [] });
    expect(comp.opcionesEps()).toEqual(['NUEVA EPS', 'SURA']);
    http.verify();
  });

  it('la ARL nace fija en ARL SURA (la funcional: nunca cambia)', () => {
    resolverCargaInicial();
    expect(comp.form.controls.personal.controls.arl.value).toBe('ARL SURA');
    http.verify();
  });

  it('sin :id en la ruta arranca en modo alta y no consulta ninguna incapacidad', () => {
    resolverCargaInicial();
    expect(comp.esEdicion()).toBe(false);
    expect(comp.idEdicion()).toBeNull();
    expect(comp.etiquetaGuardar()).toBe('Guardar como Recibida');
    http.verify();
  });

  it('autocompleta Oficina y Nombre de quien recibe desde el usuario logueado', () => {
    resolverCargaInicial();
    expect(comp.form.controls.oficina.controls.oficina.value).toBe('CHIA');
    expect(comp.form.controls.oficina.controls.nombreQuienRecibe.value).toBe('ANA RUIZ');
    // Con sede asignada ambos van bloqueados y NO se piden las sedes.
    expect(comp.oficinaBloqueada()).toBe(true);
    expect(comp.nombreBloqueado()).toBe(true);
    http.verify();
  });

  // ── A) Autocompletado tras seleccionar al empleado ───────────────────

  describe('autocompletado del trabajador', () => {
    beforeEach(() => {
      resolverCargaInicial();
    });

    it('rellena la informacion personal en el orden pedido (apellidos y nombres)', () => {
      seleccionarEmpleado();
      const p = comp.form.controls.personal.getRawValue();

      expect(p.tipoDocumento).toBe('CC');
      expect(p.numeroDocumento).toBe('1001');
      expect(p.primerApellido).toBe('PEREZ');
      expect(p.segundoApellido).toBe('GOMEZ');
      expect(p.primerNombre).toBe('JUAN');
      expect(p.segundoNombre).toBe('CARLOS');
      expect(p.sexo).toBe('MASCULINO');
      expect(p.celular).toBe('3001234567');
      expect(p.correo).toBe('juan@correo.com');
      expect(p.empresa).toBe('APOYO LABORAL TS SAS');
      expect(p.centroCosto).toBe('CC-100');
    });

    it('usa afp.afp como fondo de pensiones y NUNCA afp.afc (cesantias)', () => {
      seleccionarEmpleado();
      expect(comp.form.controls.personal.controls.fondoPension.value).toBe('PORVENIR');
      expect(comp.form.controls.personal.controls.fondoPension.value).not.toBe(
        'PROTECCION CESANTIAS',
      );
    });

    it('normaliza la EPS con espacios finales y la copia a la incapacidad', () => {
      seleccionarEmpleado();
      expect(comp.form.controls.personal.controls.epsAfiliacion.value).toBe('NUEVA EPS');
      expect(comp.form.controls.incapacidad.controls.eps.value).toBe('NUEVA EPS');
    });

    it('traduce el codigo crudo de temporal (AL -> Apoyo Laboral)', () => {
      seleccionarEmpleado();
      expect(comp.form.controls.personal.controls.temporal.value).toBe('Apoyo Laboral');
    });

    it('marca como editables solo los campos que contratacion no trajo', () => {
      seleccionarEmpleado({
        ...DATOS_CONTRATACION,
        datos_basicos: { ...DATOS_CONTRATACION.datos_basicos, celular: '' },
      });

      expect(comp.completarManual('celular')).toBe(true);
      expect(comp.soloLectura('celular')).toBe(false);
      expect(comp.soloLectura('primerApellido')).toBe(true);
      expect(comp.completarManual('primerApellido')).toBe(false);
    });

    it('cancela la consulta anterior si se elige otro trabajador (switchMap)', () => {
      comp.alSeleccionarEmpleado(EMPLEADO);
      const primera = http.expectOne((r) =>
        r.url.includes('/contratacion/datosIncapacidadContratacion/1001'),
      );

      comp.alSeleccionarEmpleado({ ...EMPLEADO, cedula: '2002' });
      expect(primera.cancelled).toBe(true);

      http
        .expectOne((r) => r.url.includes('/contratacion/datosIncapacidadContratacion/2002'))
        .flush(DATOS_CONTRATACION);
      expect(comp.cargandoPersona()).toBe(false);
    });

    it('ante un 404 muestra un mensaje accionable y permite el modo manual', () => {
      comp.alSeleccionarEmpleado(EMPLEADO);
      http
        .expectOne((r) => r.url.includes('/contratacion/datosIncapacidadContratacion/1001'))
        .flush({}, { status: 404, statusText: 'Not Found' });

      expect(comp.errorPersona()).toContain('1001');
      expect(comp.cargandoPersona()).toBe(false);

      comp.activarModoManual();
      expect(comp.modoManual()).toBe(true);
      expect(comp.errorPersona()).toBe('');
      expect(comp.soloLectura('primerApellido')).toBe(false);
    });
  });

  // ── Tipo de documento antes de buscar y cargo (reunion 2026-10-05) ──

  describe('tipo de documento antes de buscar', () => {
    const esBusqueda = (r: { url: string }) => r.url.endsWith('/Incapacidades/v2/empleados/buscar');

    beforeEach(() => {
      resolverCargaInicial();
    });

    it('sin tipo el buscador esta deshabilitado y no busca', async () => {
      expect(comp.tipoBusqueda()).toBe('');
      let resultado: EmpleadoBusqueda[] | undefined;
      comp.buscarEmpleado('1001').subscribe((r) => (resultado = r));
      expect(resultado).toEqual([]);
      http.expectNone(esBusqueda);
      http.expectNone((r) => r.url.includes('/contratacion/empleados/buscar'));

      fixture.detectChanges();
      await fixture.whenStable();
      const input = (fixture.nativeElement as HTMLElement).querySelector(
        '.reg-buscador-persona input',
      ) as HTMLInputElement;
      expect(input.disabled).toBeTrue();

      comp.alCambiarTipoBusqueda('CC');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(input.disabled).toBeFalse();
    });

    it('ofrece la lista canonica (CC, CE, PPT, TI, PA) y ya no NIT', () => {
      expect(comp.tiposDocumento.map((t) => t.valor)).toEqual(['CC', 'CE', 'PPT', 'TI', 'PA']);
    });

    it('con numero busca por documento ENVIANDO el tipo y deja solo las fichas de ese tipo', () => {
      comp.alCambiarTipoBusqueda('CC');
      let resultado: EmpleadoBusqueda[] = [];
      comp.buscarEmpleado('1001').subscribe((r) => (resultado = r));

      const req = http.expectOne(esBusqueda);
      expect(req.request.params.get('q')).toBe('1001');
      expect(req.request.params.get('tipo')).toBe('CC');
      expect(req.request.params.get('limit')).toBe('15');
      req.flush([
        { ...EMPLEADO, tipoDocumentoCanonico: 'CC' },
        { ...EMPLEADO, tipoDocumento: 'PET', tipoDocumentoCanonico: 'PPT' },
      ]);

      expect(resultado.length).toBe(1);
      expect(resultado[0].tipoDocumentoCanonico).toBe('CC');
      http.expectNone((r) => r.url.includes('/contratacion/empleados/buscar'));
    });

    it('una X inicial buscada como CC cambia el tipo a PPT y avisa', () => {
      comp.alCambiarTipoBusqueda('CC');
      comp.buscarEmpleado('X1234567').subscribe();

      const req = http.expectOne(esBusqueda);
      expect(req.request.params.get('tipo')).toBe('PPT');
      req.flush([]);
      expect(comp.tipoBusqueda()).toBe('PPT');
      expect(comp.avisoTipoBusqueda()).toContain('PPT');
    });

    it('por nombre no manda el tipo (el servidor no lo admite) pero filtra por el elegido', () => {
      comp.alCambiarTipoBusqueda('PPT');
      let resultado: EmpleadoBusqueda[] = [];
      comp.buscarEmpleado('perez').subscribe((r) => (resultado = r));

      const req = http.expectOne(esBusqueda);
      expect(req.request.params.has('tipo')).toBeFalse();
      // Backend anterior (sin tipoDocumentoCanonico): se canoniza el crudo en el navegador.
      req.flush([
        { ...EMPLEADO, tipoDocumento: 'C.C' },
        { ...EMPLEADO, cedula: '2002', tipoDocumento: 'P.P.T' },
      ]);
      expect(resultado.map((e) => e.cedula)).toEqual(['2002']);
    });

    it('cambiar el tipo limpia el buscador y suelta a la persona elegida', () => {
      comp.alCambiarTipoBusqueda('CC');
      seleccionarEmpleado();
      expect(comp.personaCargada()).toBeTrue();

      comp.alCambiarTipoBusqueda('PPT');

      expect(comp.empleado()).toBeNull();
      expect(comp.form.controls.personal.controls.numeroDocumento.value).toBe('');
      expect(comp.form.controls.personal.controls.cargo.value).toBe('');
      expect(comp.tipoBusqueda()).toBe('PPT');
    });

    it('escribe el tipo CANONICO en personal.tipoDocumento, no el crudo de contratacion', () => {
      comp.alCambiarTipoBusqueda('PPT');
      comp.alSeleccionarEmpleado({ ...EMPLEADO, tipoDocumento: 'PET', tipoDocumentoCanonico: 'PPT' });
      http
        .expectOne((r) => r.url.includes('/contratacion/datosIncapacidadContratacion/1001'))
        .flush({
          ...DATOS_CONTRATACION,
          datos_basicos: { ...DATOS_CONTRATACION.datos_basicos, tipodedocumento: 'P.P.T' },
        });
      expect(comp.form.controls.personal.controls.tipoDocumento.value).toBe('PPT');
    });

    it('en modo manual el tipo arranca con el escogido para buscar', () => {
      comp.alCambiarTipoBusqueda('CE');
      comp.alSeleccionarEmpleado({ ...EMPLEADO, tipoDocumento: '' });
      http
        .expectOne((r) => r.url.includes('/contratacion/datosIncapacidadContratacion/1001'))
        .flush({}, { status: 404, statusText: 'Not Found' });
      comp.activarModoManual();
      expect(comp.form.controls.personal.controls.tipoDocumento.value).toBe('CE');
    });

    it('al editar, el selector arranca con el canonico del tipo guardado y manda el cargo guardado', () => {
      comp['aplicarIncapacidadExistente']({
        id: 9,
        cedula: '1001',
        tipoDocumento: 'C.C',
        nombreCompleto: 'PEREZ GOMEZ JUAN CARLOS',
        cargo: 'SUPERVISOR DE CAMPO',
      });
      expect(comp.tipoBusqueda()).toBe('CC');

      http
        .expectOne((r) => r.url.includes('/contratacion/datosIncapacidadContratacion/1001'))
        .flush(DATOS_CONTRATACION);
      // Contratacion dice OPERARIO, pero el cargo corregido y guardado manda.
      expect(comp.form.controls.personal.controls.cargo.value).toBe('SUPERVISOR DE CAMPO');
      expect(comp.form.controls.personal.controls.tipoDocumento.value).toBe('CC');
    });
  });

  describe('cargo', () => {
    beforeEach(() => {
      resolverCargaInicial();
    });

    it('se llena desde contratacion.cargo y queda editable', async () => {
      seleccionarEmpleado();
      expect(comp.form.controls.personal.controls.cargo.value).toBe('OPERARIO');

      fixture.detectChanges();
      await fixture.whenStable();
      const input = (fixture.nativeElement as HTMLElement).querySelector(
        'input[formcontrolname="cargo"]',
      ) as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.readOnly).toBeFalse();
    });

    it('descarta lo que no es un cargo (tipo de proceso) y deja el campo vacio', () => {
      seleccionarEmpleado({
        ...DATOS_CONTRATACION,
        contratacion: { ...DATOS_CONTRATACION.contratacion, cargo: 'Autorización de ingreso' },
      });
      expect(comp.form.controls.personal.controls.cargo.value).toBe('');
    });

    it('cargoDeContratacion filtra la basura conocida y recorta a 160', () => {
      expect(cargoDeContratacion('  OPERARIO   DE CAMPO ')).toBe('OPERARIO DE CAMPO');
      expect(cargoDeContratacion('PRUEBA TECNICA')).toBe('');
      expect(cargoDeContratacion('Prueba técnica')).toBe('');
      expect(cargoDeContratacion('autorizacion de ingreso')).toBe('');
      expect(cargoDeContratacion('')).toBe('');
      expect(cargoDeContratacion(null)).toBe('');
      expect(cargoDeContratacion('A'.repeat(200)).length).toBe(160);
    });

    it('el formulario de Salud Total recibe el cargo (antes iba vacio fijo)', () => {
      seleccionarEmpleado();
      comp.form.controls.personal.controls.cargo.setValue('AUXILIAR DE CAMPO');
      const dialogo = fixture.debugElement.injector.get(MatDialog);
      const abrir = spyOn(dialogo, 'open').and.returnValue({
        afterClosed: () => of(undefined),
      } as never);

      comp.abrirFormularioSaludTotal();

      const config = abrir.calls.mostRecent().args[1] as { data: { cargo: string } };
      expect(config.data.cargo).toBe('AUXILIAR DE CAMPO');
    });
  });

  // ── C) Calculo de la edad ───────────────────────────────────────────

  describe('calculo de la edad', () => {
    beforeEach(() => {
      resolverCargaInicial();
    });

    it('la calcula desde fecha_nacimiento en formato ISO', () => {
      seleccionarEmpleado();
      const esperada = new Date().getFullYear() - 1990 - (esAntesDelCumple(4, 12) ? 1 : 0);
      expect(comp.edad()).toBe(esperada);
    });

    it('la calcula igual con el formato dd/MM/yyyy (los dos conviven en la base)', () => {
      seleccionarEmpleado({
        ...DATOS_CONTRATACION,
        datos_basicos: { ...DATOS_CONTRATACION.datos_basicos, fecha_nacimiento: '12/05/1990' },
      });
      const esperada = new Date().getFullYear() - 1990 - (esAntesDelCumple(4, 12) ? 1 : 0);
      expect(comp.edad()).toBe(esperada);
    });

    it('descarta la basura real de la tabla y NO cae en edadTrabajador', () => {
      seleccionarEmpleado({
        ...DATOS_CONTRATACION,
        datos_basicos: { ...DATOS_CONTRATACION.datos_basicos, fecha_nacimiento: '0001-01-01' },
      });
      expect(comp.edad()).toBeNull();
      // `edadTrabajador` valia 99 y sigue sin usarse.
      expect(comp.edad()).not.toBe(99);
      expect(comp.completarManual('fechaNacimiento')).toBe(true);
    });
  });

  // ── E) Validacion en vivo con debounce ──────────────────────────────

  describe('validacion en vivo', () => {
    beforeEach(() => {
      resolverCargaInicial();
      seleccionarEmpleado();
    });

    it('NO llama a validar antes de los 400 ms y llama una sola vez despues', fakeAsync(() => {
      completarIncapacidad();

      tick(399);
      http.expectNone((r) => r.url.endsWith('/Incapacidades/v2/validar'));

      tick(1);
      const req = http.expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar'));
      expect(req.request.method).toBe('POST');
      req.flush(validacionBase());

      expect(comp.validacion()?.dias).toBe(3);
      expect(comp.validando()).toBe(false);
      flush();
    }));

    it('envia las fechas en yyyy-MM-dd sin desfase de zona horaria', fakeAsync(() => {
      completarIncapacidad();
      tick(400);

      const req = http.expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar'));
      const cuerpo = req.request.body as Record<string, unknown>;
      expect(cuerpo['fechaInicio']).toBe('2025-01-10');
      expect(cuerpo['fechaFin']).toBe('2025-01-12');
      expect(cuerpo['fechaIngreso']).toBe('2020-03-01');
      expect(cuerpo['cedula']).toBe('1001');
      req.flush(validacionBase());
      flush();
    }));

    it('agrupa varios cambios seguidos en UNA sola peticion', fakeAsync(() => {
      completarIncapacidad();
      tick(200);
      comp.form.controls.incapacidad.controls.fechaFin.setValue(new Date(2025, 0, 15));
      tick(200);
      comp.form.controls.incapacidad.controls.fechaFin.setValue(new Date(2025, 0, 20));
      tick(400);

      const peticiones = http.match((r) => r.url.endsWith('/Incapacidades/v2/validar'));
      expect(peticiones.length).toBe(1);
      expect((peticiones[0].request.body as Record<string, unknown>)['fechaFin']).toBe(
        '2025-01-20',
      );
      peticiones[0].flush(validacionBase());
      flush();
    }));

    it('no llama a validar mientras falte el nucleo minimo', fakeAsync(() => {
      comp.form.controls.incapacidad.controls.tipoIncapacidad.setValue('ENFERMEDAD_GENERAL');
      tick(600);
      http.expectNone((r) => r.url.endsWith('/Incapacidades/v2/validar'));
      expect(comp.validacion()).toBeNull();
      flush();
    }));

    it('no llama a validar si la fecha final es anterior a la de inicio', fakeAsync(() => {
      comp.form.controls.incapacidad.patchValue({
        tipoIncapacidad: 'ENFERMEDAD_GENERAL',
        fechaInicio: new Date(2025, 0, 20),
        fechaFin: new Date(2025, 0, 10),
      });
      tick(600);
      http.expectNone((r) => r.url.endsWith('/Incapacidades/v2/validar'));
      expect(comp.camposFaltantes()).toContain(
        'La fecha final no puede ser anterior a la de inicio',
      );
      flush();
    }));

    it('muestra un mensaje si la validacion falla y no deja el panel a medias', fakeAsync(() => {
      completarIncapacidad();
      tick(400);
      http
        .expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar'))
        .flush({}, { status: 500, statusText: 'Server Error' });

      expect(comp.errorValidacion()).toBeTruthy();
      expect(comp.validando()).toBe(false);
      expect(comp.validacion()).toBeNull();
      flush();
    }));

    it('pinta el reparto de dias empresa vs entidad', fakeAsync(() => {
      completarIncapacidad();
      tick(400);
      http
        .expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar'))
        .flush(validacionBase({ dias: 10, diasEmpresa: 2, diasEntidad: 8 }));

      const reparto = comp.repartoDias();
      expect(reparto?.total).toBe(10);
      expect(reparto?.pctEmpresa).toBe(20);
      expect(reparto?.pctEntidad).toBe(80);
      flush();
    }));
  });

  // ── F) Visibilidad condicional de los soportes ──────────────────────

  describe('soportes', () => {
    beforeEach(() => {
      resolverCargaInicial();
      seleccionarEmpleado();
    });

    it('no muestra ningun cargador antes de validar', () => {
      expect(comp.soportesVisibles().length).toBe(0);
      expect(comp.soportesVista().length).toBe(0);
    });

    it('muestra SOLO los soportes que el backend marca visibles y en el orden pedido', fakeAsync(() => {
      completarIncapacidad();
      tick(400);
      http
        .expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar'))
        .flush(validacionBase());

      const tipos = comp.soportesVista().map((s) => s.tipo);
      expect(tipos).toEqual(['INCAPACIDAD_MEDICA', 'HISTORIAL_CLINICO']);
      expect(comp.soportesVista()[0].obligatorio).toBe(true);
      expect(comp.soportesVista()[1].obligatorio).toBe(false);
      flush();
    }));

    it('cambia la visibilidad cuando el backend cambia de opinion (accidente de trabajo)', fakeAsync(() => {
      completarIncapacidad();
      tick(400);
      http
        .expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar'))
        .flush(validacionBase());
      expect(comp.soportesVista().map((s) => s.tipo)).toEqual([
        'INCAPACIDAD_MEDICA',
        'HISTORIAL_CLINICO',
      ]);

      comp.form.controls.incapacidad.controls.tipoIncapacidad.setValue('ACCIDENTE_TRABAJO');
      tick(400);
      http.expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar')).flush(
        validacionBase({
          soportes: [
            {
              tipo: 'INCAPACIDAD_MEDICA',
              etiqueta: 'Incapacidad',
              visible: true,
              obligatorio: true,
              cargado: false,
            },
            {
              tipo: 'FURAT',
              etiqueta: 'FURAT',
              visible: true,
              obligatorio: true,
              cargado: false,
            },
            {
              tipo: 'HISTORIAL_CLINICO',
              etiqueta: 'Historia clinica',
              visible: false,
              obligatorio: false,
              cargado: false,
            },
          ],
        }),
      );

      expect(comp.soportesVista().map((s) => s.tipo)).toEqual(['INCAPACIDAD_MEDICA', 'FURAT']);
      expect(comp.soportesFaltantes()).toEqual(['Incapacidad', 'FURAT']);
      flush();
    }));

    it('rechaza un archivo que no sea PDF, JPG o PNG', fakeAsync(() => {
      completarIncapacidad();
      tick(400);
      http
        .expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar'))
        .flush(validacionBase());

      const evento = eventoDeArchivo(new File(['x'], 'malo.docx', { type: 'application/msword' }));
      comp.alElegirArchivo(evento, 'INCAPACIDAD_MEDICA');

      expect(comp.errorArchivo()).toContain('malo.docx');
      expect(comp.tiposCargados()).toEqual([]);
      flush();
    }));

    it('rechaza un archivo de mas de 10 MB', fakeAsync(() => {
      completarIncapacidad();
      tick(400);
      http
        .expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar'))
        .flush(validacionBase());

      const grande = new File(['x'], 'enorme.pdf', { type: 'application/pdf' });
      Object.defineProperty(grande, 'size', { value: 11 * 1024 * 1024 });
      comp.alElegirArchivo(eventoDeArchivo(grande), 'INCAPACIDAD_MEDICA');

      expect(comp.errorArchivo()).toContain('10 MB');
      expect(comp.tiposCargados()).toEqual([]);
      flush();
    }));

    it('acepta un PDF valido y lo cuenta como soporte cargado', fakeAsync(() => {
      completarIncapacidad();
      tick(400);
      http
        .expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar'))
        .flush(validacionBase());

      comp.alElegirArchivo(
        eventoDeArchivo(new File(['x'], 'incapacidad.pdf', { type: 'application/pdf' })),
        'INCAPACIDAD_MEDICA',
      );

      expect(comp.errorArchivo()).toBe('');
      expect(comp.tiposCargados()).toEqual(['INCAPACIDAD_MEDICA']);
      expect(comp.soportesFaltantes()).toEqual([]);

      // El cambio de soportes vuelve a disparar la validacion.
      tick(400);
      const revalidacion = http.match((r) => r.url.endsWith('/Incapacidades/v2/validar'));
      for (const req of revalidacion) req.flush(validacionBase());
      flush();
    }));
  });

  // ── G) Bloqueo del boton "Guardar y validar" ────────────────────────

  describe('boton Guardar y validar', () => {
    beforeEach(() => {
      resolverCargaInicial();
      seleccionarEmpleado();
    });

    /** Devuelve el boton verde de la barra de acciones. */
    function botonValidar(): HTMLButtonElement {
      return fixture.nativeElement.querySelector('.reg-btn--validar') as HTMLButtonElement;
    }

    it('arranca bloqueado porque todavia no hay validacion', async () => {
      expect(comp.puedeValidar()).toBe(false);
      await fixture.whenStable();
      expect(botonValidar().disabled).toBe(true);
      expect(comp.tooltipValidar()).toContain('Faltan datos');
    });

    it('sigue bloqueado si el backend dice puedeValidar = false', fakeAsync(() => {
      completarIncapacidad();
      tick(400);
      http.expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar')).flush(
        validacionBase({
          puedeValidar: false,
          motivosBloqueo: ['Falta la historia clinica', 'La incapacidad esta prescrita'],
        }),
      );

      expect(comp.puedeValidar()).toBe(false);
      expect(comp.motivosBloqueo()).toContain('La incapacidad esta prescrita');
      expect(comp.tooltipValidar()).toContain('prescrita');
      flush();
    }));

    it('se habilita cuando el backend dice puedeValidar = true y no falta nada', fakeAsync(() => {
      completarIncapacidad();
      tick(400);
      http
        .expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar'))
        .flush(validacionBase({ puedeValidar: true, motivosBloqueo: [] }));

      expect(comp.camposFaltantes()).toEqual([]);
      expect(comp.puedeValidar()).toBe(true);
      flush();
    }));

    it('sigue bloqueado si el backend valida pero falta un campo obligatorio del formulario', fakeAsync(() => {
      completarIncapacidad();
      tick(400);
      http
        .expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar'))
        .flush(validacionBase({ puedeValidar: true }));
      expect(comp.puedeValidar()).toBe(true);

      // La oficina NUNCA puede guardarse vacia.
      comp.form.controls.oficina.controls.oficina.setValue('');
      expect(comp.camposFaltantes()).toContain('Oficina');
      expect(comp.puedeValidar()).toBe(false);
      flush();
    }));

    it('"Guardar como Recibida" nunca esta atado a form.invalid: dice QUE falta', () => {
      // Sin fechas ni tipo el formulario es invalido, pero el boton sigue vivo.
      expect(comp.puedeGuardar()).toBe(true);

      comp.guardar(false);

      expect(comp.intentoGuardar()).toBe(true);
      expect(comp.camposFaltantes().length).toBeGreaterThan(0);
      expect(comp.camposFaltantes()).toContain('Tipo de incapacidad');
      // Y no se envio nada al backend.
      http.expectNone((r) => r.url.endsWith('/Incapacidades/v2'));
    });
  });

  // ── Guardado completo ───────────────────────────────────────────────

  describe('guardado', () => {
    beforeEach(fakeAsync(() => {
      resolverCargaInicial();
      seleccionarEmpleado();
      completarIncapacidad();
      tick(400);
      http
        .expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar'))
        .flush(validacionBase());
      flush();
    }));

    it('crea la incapacidad y sube los soportes por el endpoint v2 anclado en el id', fakeAsync(() => {
      elegirPdf('INCAPACIDAD_MEDICA');
      tick(400);
      for (const req of http.match((r) => r.url.endsWith('/Incapacidades/v2/validar'))) {
        req.flush(validacionBase());
      }

      guardarYFlushValidar(false);

      const creacion = http.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2'),
      );
      const cuerpo = creacion.request.body as Record<string, unknown>;
      expect(cuerpo['oficina']).toBe('CHIA');
      // El backend lo llama `recibidoPor`: cualquier otro nombre es un 400.
      expect(cuerpo['recibidoPor']).toBe('ANA RUIZ');
      expect(cuerpo['afp']).toBe('PORVENIR');
      // Reunion 2026-10-05: el cargo viaja en el request (y el tipo, canonico).
      expect(cuerpo['cargo']).toBe('OPERARIO');
      expect(cuerpo['tipoDocumento']).toBe('CC');
      creacion.flush({ id: 55, codigoUnico: '1001_20250110' });

      // La subida ancla en el ID NUMERICO (el multipart legacy respondia 404
      // porque resolvia el consecutivo contra la tabla vieja).
      const subida = http.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2/55/soportes'),
      );
      const formData = subida.request.body as FormData;
      expect(formData.get('tipoSoporte')).toBe('INCAPACIDAD_MEDICA');
      expect((formData.get('file') as File).name).toBe('inc.pdf');
      // El navegador pone el boundary: no se fuerza Content-Type.
      expect(subida.request.headers.has('Content-Type')).toBe(false);
      http.expectNone((r) => r.url.includes('/documentos/upload'));
      subida.flush(soporteSubido('INCAPACIDAD_MEDICA'), { status: 201, statusText: 'Created' });

      // Tras subir se RELEE: `soportesCargados` lo recalcula el servidor.
      const relectura = http.expectOne(
        (r) => r.method === 'GET' && r.url.endsWith('/Incapacidades/v2/55'),
      );
      relectura.flush({ id: 55, soportesCargados: ['INCAPACIDAD_MEDICA'] });

      expect(comp.resultado()?.incapacidad.id).toBe(55);
      expect(comp.resultado()?.incapacidad.soportesCargados).toEqual(['INCAPACIDAD_MEDICA']);
      expect(comp.resultado()?.validada).toBe(false);
      expect(comp.guardando()).toBe(false);
      flush();
    }));

    it('con "Guardar y validar" promueve DESPUES de que los soportes esten arriba', fakeAsync(() => {
      elegirPdf('INCAPACIDAD_MEDICA');
      tick(400);
      for (const req of http.match((r) => r.url.endsWith('/Incapacidades/v2/validar'))) {
        req.flush(validacionBase());
      }

      guardarYFlushValidar(true);

      http
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2'))
        .flush({ id: 55 });

      // Todavia NO se promueve: primero el archivo.
      http.expectNone((r) => r.url.endsWith('/Incapacidades/v2/55/validar'));

      http
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2/55/soportes'))
        .flush(soporteSubido('INCAPACIDAD_MEDICA'), { status: 201, statusText: 'Created' });
      http
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/Incapacidades/v2/55'))
        .flush({ id: 55, soportesCargados: ['INCAPACIDAD_MEDICA'] });

      // Y solo ahora la promocion.
      const promocion = http.expectOne((r) => r.url.endsWith('/Incapacidades/v2/55/validar'));
      expect(promocion.request.method).toBe('POST');
      promocion.flush({ id: 55, estado: 'VALIDADA', soportesCargados: ['INCAPACIDAD_MEDICA'] });

      expect(comp.resultado()?.validada).toBe(true);
      expect(comp.resultado()?.incapacidad.estado).toBe('VALIDADA');
      flush();
    }));

    it('un soporte rechazado con 400 no tumba el guardado y deja mensaje de reintento', fakeAsync(() => {
      elegirPdf('INCAPACIDAD_MEDICA');
      tick(400);
      for (const req of http.match((r) => r.url.endsWith('/Incapacidades/v2/validar'))) {
        req.flush(validacionBase());
      }

      guardarYFlushValidar(false);
      http
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2'))
        .flush({ id: 55 });

      http.expectOne((r) => r.url.endsWith('/Incapacidades/v2/55/soportes')).flush(
        { message: 'El archivo debe ser PDF, JPG o PNG.' },
        { status: 400, statusText: 'Bad Request' },
      );
      // Aun asi se relee: el servidor manda sobre soportesCargados.
      http
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/Incapacidades/v2/55'))
        .flush({ id: 55, soportesCargados: [] });

      const archivo = comp.archivos()['INCAPACIDAD_MEDICA'];
      expect(archivo?.estado).toBe('error');
      // Mensaje del backend, en espanol, tal cual.
      expect(archivo?.mensajeError).toBe('El archivo debe ser PDF, JPG o PNG.');
      // La incapacidad SI quedo guardada.
      expect(comp.resultado()?.incapacidad.id).toBe(55);
      flush();
    }));

    it('distingue el fallo de red y el reintento vuelve a pegarle al endpoint v2', fakeAsync(() => {
      elegirPdf('INCAPACIDAD_MEDICA');
      tick(400);
      for (const req of http.match((r) => r.url.endsWith('/Incapacidades/v2/validar'))) {
        req.flush(validacionBase());
      }

      guardarYFlushValidar(false);
      http
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2'))
        .flush({ id: 55 });
      http
        .expectOne((r) => r.url.endsWith('/Incapacidades/v2/55/soportes'))
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
      http
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/Incapacidades/v2/55'))
        .flush({ id: 55, soportesCargados: [] });

      expect(comp.archivos()['INCAPACIDAD_MEDICA']?.mensajeError).toContain('Sin conexion');

      comp.reintentarSoporte('INCAPACIDAD_MEDICA');
      const reintento = http.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2/55/soportes'),
      );
      reintento.flush(soporteSubido('INCAPACIDAD_MEDICA'), { status: 201, statusText: 'Created' });
      http
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/Incapacidades/v2/55'))
        .flush({ id: 55, soportesCargados: ['INCAPACIDAD_MEDICA'] });

      expect(comp.archivos()['INCAPACIDAD_MEDICA']?.estado).toBe('cargado');
      expect(comp.resultado()?.incapacidad.soportesCargados).toEqual(['INCAPACIDAD_MEDICA']);
      flush();
    }));

    it('quitar un soporte ya subido borra tambien el vinculo en el servidor', fakeAsync(() => {
      elegirPdf('INCAPACIDAD_MEDICA');
      tick(400);
      for (const req of http.match((r) => r.url.endsWith('/Incapacidades/v2/validar'))) {
        req.flush(validacionBase());
      }

      guardarYFlushValidar(false);
      http
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2'))
        .flush({ id: 55 });
      http
        .expectOne((r) => r.url.endsWith('/Incapacidades/v2/55/soportes'))
        .flush(soporteSubido('INCAPACIDAD_MEDICA'), { status: 201, statusText: 'Created' });
      http
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/Incapacidades/v2/55'))
        .flush({ id: 55, soportesCargados: ['INCAPACIDAD_MEDICA'] });

      comp.quitarArchivo('INCAPACIDAD_MEDICA');

      const borrado = http.expectOne(
        (r) => r.url.endsWith('/Incapacidades/v2/55/soportes/INCAPACIDAD_MEDICA'),
      );
      expect(borrado.request.method).toBe('DELETE');
      borrado.flush(null, { status: 204, statusText: 'No Content' });

      http
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/Incapacidades/v2/55'))
        .flush({ id: 55, soportesCargados: [] });

      expect(comp.tiposCargados()).toEqual([]);
      // El cambio de soportes revalida.
      tick(400);
      for (const req of http.match((r) => r.url.endsWith('/Incapacidades/v2/validar'))) {
        req.flush(validacionBase());
      }
      flush();
    }));

    it('un segundo guardado ACTUALIZA y no crea un duplicado', fakeAsync(() => {
      elegirPdf('INCAPACIDAD_MEDICA');
      tick(400);
      for (const req of http.match((r) => r.url.endsWith('/Incapacidades/v2/validar'))) {
        req.flush(validacionBase());
      }

      guardarYFlushValidar(false);
      http
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2'))
        .flush({ id: 55, consecutivoSistema: 'INC-55' });
      http
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2/55/soportes'))
        .flush(soporteSubido('INCAPACIDAD_MEDICA'), { status: 201, statusText: 'Created' });
      http
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/Incapacidades/v2/55'))
        .flush({ id: 55, soportesCargados: ['INCAPACIDAD_MEDICA'] });
      expect(comp.idEfectivo()).toBe(55);
      expect(comp.etiquetaGuardar()).toBe('Guardar cambios');

      guardarYFlushValidar(false);
      const segunda = http.expectOne((r) => r.url.endsWith('/Incapacidades/v2/55'));
      expect(segunda.request.method).toBe('PUT');
      segunda.flush({ id: 55, consecutivoSistema: 'INC-55' });
      // El archivo local sigue elegido: se re-sube (reemplaza) y se relee.
      http
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2/55/soportes'))
        .flush(soporteSubido('INCAPACIDAD_MEDICA'), { status: 201, statusText: 'Created' });
      http
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/Incapacidades/v2/55'))
        .flush({ id: 55, soportesCargados: ['INCAPACIDAD_MEDICA'] });
      flush();
    }));

    it('traduce el 409 de la promocion a motivos y deja la incapacidad en RECIBIDA', fakeAsync(() => {
      elegirPdf('INCAPACIDAD_MEDICA');
      tick(400);
      for (const req of http.match((r) => r.url.endsWith('/Incapacidades/v2/validar'))) {
        req.flush(validacionBase());
      }

      guardarYFlushValidar(true);

      http
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2'))
        .flush({ id: 77, consecutivoSistema: 'INC-77' });
      http
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2/77/soportes'))
        .flush(soporteSubido('INCAPACIDAD_MEDICA'), { status: 201, statusText: 'Created' });
      http
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/Incapacidades/v2/77'))
        .flush({ id: 77, soportesCargados: ['INCAPACIDAD_MEDICA'] });

      http
        .expectOne((r) => r.url.endsWith('/Incapacidades/v2/77/validar'))
        .flush({ motivosBloqueo: ['Falta el FURAT'] }, { status: 409, statusText: 'Conflict' });

      expect(comp.resultado()?.validada).toBe(false);
      expect(comp.motivosDialogo()).toEqual(['Falta el FURAT']);
      flush();
    }));

    // ── Reunion 2026-08-20: minimo de soportes para RECIBIR ─────────────

    it('sin el soporte de la incapacidad NO se guarda: mensaje claro y cero peticiones', fakeAsync(() => {
      guardarYFlushValidar(false);

      http.expectNone((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2'));
      expect(comp.errorGuardado()).toContain('Incapacidad');
      expect(comp.soportesBloqueantesGuardar()).toContain('Incapacidad');
      flush();
    }));

  });

  // ── Reunion 2026-08-20: aviso prominente cuando el motor dice NO PAGAR ──

  describe('aviso NO PAGAR al guardar', () => {
    beforeEach(fakeAsync(() => {
      resolverCargaInicial();
      seleccionarEmpleado();
      completarIncapacidad();
      tick(400);
      // La validacion en vivo dice NO PAGAR desde el arranque de este escenario.
      http.expectOne((r) => r.url.endsWith('/Incapacidades/v2/validar')).flush(
        validacionBase({
          responsablePago: 'NO_PAGAR',
          cumpleCotizacion: false,
          alertas: [
            {
              nivel: 'CRITICA',
              codigo: 'NO_CUMPLE_COTIZACION',
              mensaje: 'No cumple el tiempo minimo de cotizacion: no se paga.',
            },
          ],
        }),
      );
      flush();
    }));

    it('abre el aviso con el motivo critico y solo guarda si el usuario confirma', fakeAsync(() => {
      elegirPdf('INCAPACIDAD_MEDICA');
      tick(400);
      for (const req of http.match((r) => r.url.endsWith('/Incapacidades/v2/validar'))) {
        req.flush(
          validacionBase({
            responsablePago: 'NO_PAGAR',
            cumpleCotizacion: false,
            alertas: [
              {
                nivel: 'CRITICA',
                codigo: 'NO_CUMPLE_COTIZACION',
                mensaje: 'No cumple el tiempo minimo de cotizacion: no se paga.',
              },
            ],
          }),
        );
      }

      expect(comp.motivosNoPagar()).toEqual([
        'No cumple el tiempo minimo de cotizacion: no se paga.',
      ]);

      // El dialogo se confirma: el guardado debe continuar.
      const dialogo = comp['dialogo'] as MatDialog;
      const abrir = spyOn(dialogo, 'open').and.returnValue({
        afterClosed: () => of(true),
      } as unknown as ReturnType<MatDialog['open']>);

      guardarYFlushValidar(
        false,
        validacionBase({
          responsablePago: 'NO_PAGAR',
          cumpleCotizacion: false,
          alertas: [
            {
              nivel: 'CRITICA',
              codigo: 'NO_CUMPLE_COTIZACION',
              mensaje: 'No cumple el tiempo minimo de cotizacion: no se paga.',
            },
          ],
        }),
      );

      expect(abrir).toHaveBeenCalled();
      http
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2'))
        .flush({ id: 91, consecutivoSistema: 'INC-91' });
      http
        .expectOne((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2/91/soportes'))
        .flush(soporteSubido('INCAPACIDAD_MEDICA'), { status: 201, statusText: 'Created' });
      http
        .expectOne((r) => r.method === 'GET' && r.url.endsWith('/Incapacidades/v2/91'))
        .flush({ id: 91, soportesCargados: ['INCAPACIDAD_MEDICA'] });
      flush();
    }));

    it('si el usuario cancela el aviso, no se envia nada', fakeAsync(() => {
      elegirPdf('INCAPACIDAD_MEDICA');
      tick(400);
      for (const req of http.match((r) => r.url.endsWith('/Incapacidades/v2/validar'))) {
        req.flush(validacionBase({ responsablePago: 'NO_PAGAR', cumpleCotizacion: false }));
      }

      const dialogo = comp['dialogo'] as MatDialog;
      spyOn(dialogo, 'open').and.returnValue({
        afterClosed: () => of(false),
      } as unknown as ReturnType<MatDialog['open']>);

      guardarYFlushValidar(
        false,
        validacionBase({ responsablePago: 'NO_PAGAR', cumpleCotizacion: false }),
      );

      http.expectNone((r) => r.method === 'POST' && r.url.endsWith('/Incapacidades/v2'));
      flush();
    }));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** `true` si hoy es anterior al cumpleanos del ano en curso. */
function esAntesDelCumple(mesCero: number, dia: number): boolean {
  const hoy = new Date();
  if (hoy.getMonth() < mesCero) return true;
  return hoy.getMonth() === mesCero && hoy.getDate() < dia;
}

/** `SoporteResponse` que devuelve `POST /Incapacidades/v2/{id}/soportes`. */
function soporteSubido(tipo: TipoSoporte): SoporteIncapacidad {
  return {
    id: 1,
    incapacidadId: 55,
    tipo,
    tipoEtiqueta: 'Incapacidad',
    nombreArchivo: 'inc.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 12,
    sha256: 'a'.repeat(64),
    documentId: 900,
    fileUrl: '/media/incapacidades/inc.pdf',
    versionNumber: 1,
    subidoPor: 'admin@nova-col.com',
    subidoEn: '2026-08-04T10:00:00Z',
    estado: 'SINCRONIZADO',
  };
}

/** Simula el `(change)` de un `<input type="file">`. */
function eventoDeArchivo(archivo: File): Event {
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', { value: [archivo], configurable: true });
  return { target: input } as unknown as Event;
}
