/**
 * Pruebas del llenado del formato oficial de Salud Total (M-GINT-F103).
 *
 * La funcion `llenarFormatoSaludTotal` es pura respecto del DOM: recibe los bytes del PDF
 * y devuelve los bytes diligenciados. Aqui se llena el formato REAL empacado en assets y
 * se relee con pdf-lib para verificar que los nombres de campo del formato oficial siguen
 * siendo los esperados — si Salud Total publica una version con campos renombrados, esto
 * cae aqui y no en la oficina.
 */

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import {
  DatosFormularioSaludTotal,
  DialogoFormularioSaludTotalComponent,
  PREGUNTAS_SALUD_TOTAL,
  RUTA_PDF_SALUD_TOTAL,
  fechaAccidenteLegible,
  huboAccidente,
  llenarFormatoSaludTotal,
} from './dialogo-formulario-salud-total.component';

describe('llenarFormatoSaludTotal', () => {
  const DATOS = {
    nombres: 'JUAN CARLOS',
    apellidos: 'PEREZ GOMEZ',
    telefono: '3001234567',
    arl: 'ARL SURA',
    cargo: 'OPERARIO',
    responsable: 'ANA RUIZ',
    cedula: '1075263514',
  };

  it('define exactamente las 6 preguntas del formato, en su orden impreso', () => {
    expect(PREGUNTAS_SALUD_TOTAL.length).toBe(6);
    expect(PREGUNTAS_SALUD_TOTAL[0]).toContain('sitio de trabajo');
    expect(PREGUNTAS_SALUD_TOTAL[5]).toContain('transporte pagado');
  });

  it('reunion 2026-09-07: fecha legible dd/mm/aaaa y fecha/hora exigidas solo con algun SI', () => {
    expect(fechaAccidenteLegible('2026-09-07')).toBe('07/09/2026');
    expect(fechaAccidenteLegible('')).toBe('');
    expect(fechaAccidenteLegible(undefined)).toBe('');
    expect(huboAccidente(['NO', 'NO', 'NO', 'NO', 'NO', 'NO'])).toBeFalse();
    expect(huboAccidente(['NO', 'NO', 'SI', 'NO', 'NO', 'NO'])).toBeTrue();
  });

  it('llena los campos reales del formato oficial y marca las casillas SI/NO', async () => {
    const respuesta = await fetch(RUTA_PDF_SALUD_TOTAL);
    if (!respuesta.ok) {
      pending(`karma no sirve el asset del formato (${respuesta.status})`);
      return;
    }
    const base = await respuesta.arrayBuffer();

    const bytes = await llenarFormatoSaludTotal(
      base,
      DATOS,
      ['NO', 'NO', 'NO', 'SI', 'NO', 'NO'],
      { relato: 'Sin evento laboral.', fechaAccidente: '07/09/2026', horaAccidente: '14:30' },
    );
    expect(bytes.length).toBeGreaterThan(1000);

    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes as unknown as ArrayBuffer);
    const form = doc.getForm();

    expect(form.getTextField('NOMBRES').getText()).toBe('JUAN CARLOS');
    expect(form.getTextField('APELLIDOS').getText()).toBe('PEREZ GOMEZ');
    expect(form.getTextField('TELEFONO').getText()).toBe('3001234567');
    expect(form.getTextField('ARL').getText()).toBe('ARL SURA');
    expect(form.getTextField('CARGO').getText()).toBe('OPERARIO');
    expect(form.getTextField('FIRMA RESPONSABLE').getText()).toBe('ANA RUIZ');
    expect(form.getTextField('RELATO DEL ACCIDENTE').getText()).toBe('Sin evento laboral.');
    expect(form.getTextField('FECHA ACCIDENTE').getText()).toBe('07/09/2026');
    expect(form.getTextField('HORA ACCIDENTE').getText()).toBe('14:30');

    // Pregunta 4 respondida SI; el resto NO. Nunca ambas casillas de un par.
    expect(form.getCheckBox('4SI').isChecked()).toBeTrue();
    expect(form.getCheckBox('4NO').isChecked()).toBeFalse();
    expect(form.getCheckBox('1NO').isChecked()).toBeTrue();
    expect(form.getCheckBox('1SI').isChecked()).toBeFalse();
    expect(form.getCheckBox('6NO').isChecked()).toBeTrue();
  }, 15000);
});

/**
 * Reunion 2026-10-05: el CARGO llega de contratacion y se corrige a mano en el dialogo. Se
 * genera el PDF REAL y se relee: lo escrito en el campo es lo que queda en la casilla CARGO.
 */
describe('DialogoFormularioSaludTotalComponent (cargo editable)', () => {
  const DATOS: DatosFormularioSaludTotal = {
    nombres: 'JUAN CARLOS',
    apellidos: 'PEREZ GOMEZ',
    telefono: '3001234567',
    arl: 'ARL SURA',
    cargo: 'OPERARIO',
    responsable: 'JUAN CARLOS PEREZ GOMEZ',
    cedula: '1075263514',
  };

  let refFalso: { close: jasmine.Spy };

  function crear(datos: DatosFormularioSaludTotal = DATOS) {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: datos });
    const fixture = TestBed.createComponent(DialogoFormularioSaludTotalComponent);
    fixture.detectChanges();
    return fixture;
  }

  /** Bytes del formato oficial servido por karma, o null si no lo sirve. */
  async function formatoDisponible(): Promise<boolean> {
    const respuesta = await fetch(RUTA_PDF_SALUD_TOTAL);
    return respuesta.ok;
  }

  async function cargoDelPdf(archivo: File): Promise<string | undefined> {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(await archivo.arrayBuffer());
    return doc.getForm().getTextField('CARGO').getText();
  }

  beforeEach(async () => {
    refFalso = { close: jasmine.createSpy('close') };
    await TestBed.configureTestingModule({
      imports: [DialogoFormularioSaludTotalComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: DATOS },
        { provide: MatDialogRef, useValue: refFalso },
      ],
    }).compileComponents();
  });

  it('muestra SIEMPRE el cargo como campo editable, prellenado con el de contratacion', async () => {
    const fixture = crear();
    await fixture.whenStable();
    expect(fixture.componentInstance.form.controls.cargo.value).toBe('OPERARIO');
    const input = fixture.nativeElement.querySelector(
      'input[formcontrolname="cargo"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe('OPERARIO');
    expect(input?.readOnly).toBeFalse();
  });

  it('sin cargo de contratacion el campo sigue ahi, vacio, para escribirlo', async () => {
    const sinCargo = crear({ ...DATOS, cargo: '' });
    await sinCargo.whenStable();
    expect(sinCargo.nativeElement.querySelector('input[formcontrolname="cargo"]')).not.toBeNull();
    expect(sinCargo.componentInstance.form.controls.cargo.value).toBe('');
  });

  it('el cargo corregido a mano es el que queda en la casilla CARGO del PDF', async () => {
    if (!(await formatoDisponible())) {
      pending('karma no sirve el asset del formato');
      return;
    }
    const fixture = crear();
    const comp = fixture.componentInstance;
    comp.form.controls.cargo.setValue('  AUXILIAR DE CAMPO ');

    await comp.generar();

    expect(refFalso.close).toHaveBeenCalledTimes(1);
    const archivo = refFalso.close.calls.mostRecent().args[0] as File;
    expect(archivo instanceof File).toBeTrue();
    expect(archivo.name).toBe('formato-salud-total-1075263514.pdf');
    expect(await cargoDelPdf(archivo)).toBe('AUXILIAR DE CAMPO');
  }, 15000);

  it('sin tocarlo, el PDF lleva el cargo que vino de contratacion', async () => {
    if (!(await formatoDisponible())) {
      pending('karma no sirve el asset del formato');
      return;
    }
    const fixture = crear();
    await fixture.componentInstance.generar();
    const archivo = refFalso.close.calls.mostRecent().args[0] as File;
    expect(await cargoDelPdf(archivo)).toBe('OPERARIO');
  }, 15000);
});
