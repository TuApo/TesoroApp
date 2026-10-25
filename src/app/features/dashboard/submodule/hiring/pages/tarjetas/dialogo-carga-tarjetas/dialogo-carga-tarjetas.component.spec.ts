import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { environment } from '@/environments/environment';

import { RespuestaSimulacion } from '../../../service/tarjetas.service';
import { DialogoCargaTarjetasComponent } from './dialogo-carga-tarjetas.component';

const BASE = `${environment.apiUrl}/tarjetas`;
const URL_FORMATO = `${BASE}/importaciones/formato`;
const URL_SIMULAR = `${BASE}/importaciones/simular`;

const SIMULACION: RespuestaSimulacion = {
  lote_id: 101,
  estado: 'SIMULADO',
  resumen: {
    total_filas: 3,
    filas_validas: 2,
    filas_con_error: 1,
    registros_nuevos: 1,
    registros_existentes: 1,
    registros_actualizables: 1,
    sin_cambios: 0,
    duplicados_archivo: 0,
    alertas_documento_con_otra_tarjeta: 0,
    filas_vacias_ignoradas: 0,
    columnas_faltantes: [],
    columnas_desconocidas: ['Sucursal Bancaria'],
    columnas_detectadas: ['Numero de Identificacion', 'Numero Tarjeta', 'Sucursal Bancaria'],
    hoja_leida: 'Tarjetas',
    hojas_del_archivo: ['Tarjetas'],
  },
  filas: [
    { fila: 2, estado: 'VALIDO_NUEVO', accion: 'CREAR', identificacion: '9000000874',
      numero_tarjeta: '5555555555554444', mensaje: null, aplicada: false },
    { fila: 3, estado: 'VALIDO_ACTUALIZACION', accion: 'ACTUALIZAR', identificacion: '9000000875',
      numero_tarjeta: '5555555555554445', mensaje: 'La identificación pasa de 111 a 9000000875.', aplicada: false },
    { fila: 4, estado: 'ERROR_VALIDACION', accion: 'NO_PROCESADO', identificacion: null,
      numero_tarjeta: null, mensaje: 'El número de tarjeta es obligatorio.', aplicada: false },
  ],
  filas_devueltas: 3,
  hay_mas_filas: false,
  archivo_ya_cargado: [],
  mensaje: 'Simulación: 2 fila(s) válidas de 3. No se ha modificado ninguna tarjeta.',
};

function archivo(nombre = 'tarjetas.xlsx'): File {
  return new File(['contenido'], nombre, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('DialogoCargaTarjetasComponent', () => {
  let fixture: ComponentFixture<DialogoCargaTarjetasComponent>;
  let componente: DialogoCargaTarjetasComponent;
  let http: HttpTestingController;
  let cerrado: jasmine.Spy;

  beforeEach(async () => {
    cerrado = jasmine.createSpy('close');

    await TestBed.configureTestingModule({
      imports: [DialogoCargaTarjetasComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatDialogRef, useValue: { close: cerrado } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogoCargaTarjetasComponent);
    componente = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    // El contrato de columnas se pide al abrir; se responde vacío para no ensuciar.
    http.expectOne(URL_FORMATO).flush({
      columnas: [], columnas_informativas: [], max_filas: 50000, max_mb: 15,
      extensiones: ['.xls', '.xlsx'], longitud_tarjeta: 16, clave_negocio: 'card_number', notas: [],
    });
  });

  afterEach(() => http.verify());

  it('arranca pidiendo el archivo', () => {
    expect(componente.paso()).toBe('archivo');
  });

  it('rechaza una extensión que el backend no admite, sin llamar a la red', () => {
    componente['aceptar'](archivo('tarjetas.csv'));
    expect(componente.error()).toContain('.xls');
    expect(componente.archivo()).toBeNull();
  });

  it('simular no aplica nada: se queda en la revisión esperando confirmación', () => {
    componente['aceptar'](archivo());
    componente.simular();

    const peticion = http.expectOne(URL_SIMULAR);
    expect(peticion.request.method).toBe('POST');
    expect(peticion.request.body instanceof FormData).toBeTrue();
    peticion.flush(SIMULACION);

    expect(componente.paso()).toBe('revision');
    expect(componente.simulacion()?.lote_id).toBe(101);
    expect(componente.puedeAplicar()).toBeTrue();
    // Lo importante: NO se llamó a aplicar.
    http.expectNone(`${BASE}/importaciones/101/aplicar`);
  });

  it('solo al confirmar se escribe, y el diálogo pide recargar el listado', () => {
    componente['aceptar'](archivo());
    componente.simular();
    http.expectOne(URL_SIMULAR).flush(SIMULACION);

    componente.aplicar();
    const peticion = http.expectOne(`${BASE}/importaciones/101/aplicar`);
    expect(peticion.request.method).toBe('POST');
    peticion.flush({
      lote_id: 102, estado: 'COMPLETADO_CON_ERRORES', total_filas: 3,
      creadas: 1, actualizadas: 1, sin_cambios: 0, rechazadas: 1,
      mensaje: 'Carga aplicada: 1 creadas, 1 actualizadas, 0 sin cambios, 1 rechazadas.',
    });

    expect(componente.paso()).toBe('resultado');
    componente.cerrar();
    expect(cerrado).toHaveBeenCalledWith({ recargar: true });
  });

  it('si no hay ninguna fila válida no ofrece confirmar', () => {
    componente['aceptar'](archivo());
    componente.simular();
    http.expectOne(URL_SIMULAR).flush({
      ...SIMULACION,
      resumen: { ...SIMULACION.resumen, filas_validas: 0, filas_con_error: 3 },
    });

    expect(componente.puedeAplicar()).toBeFalse();
  });

  it('muestra el mensaje y el código estable que manda el backend', () => {
    componente['aceptar'](archivo());
    componente.simular();
    http.expectOne(URL_SIMULAR).flush(
      { error: 'El archivo no tiene las columnas obligatorias: Numero Tarjeta.',
        codigo: 'IMPORTACION_TARJETAS_COLUMNAS_FALTANTES' },
      { status: 400, statusText: 'Bad Request' });

    expect(componente.error()).toContain('columnas obligatorias');
    expect(componente.codigoError()).toBe('IMPORTACION_TARJETAS_COLUMNAS_FALTANTES');
    // No se cierra: el usuario corrige y reintenta.
    expect(cerrado).not.toHaveBeenCalled();
    expect(componente.paso()).toBe('archivo');
  });

  it('cerrar sin aplicar no pide recargar', () => {
    componente.cerrar();
    expect(cerrado).toHaveBeenCalledWith({ recargar: false });
  });
});
