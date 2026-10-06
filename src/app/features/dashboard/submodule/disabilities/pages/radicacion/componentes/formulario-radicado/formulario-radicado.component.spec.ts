import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import type { DatosRadicado } from '../../radicacion.utils';
import { hoyIso } from '../../radicacion.utils';
import { FormularioRadicadoComponent } from './formulario-radicado.component';

/** Fecha local de manana en yyyy-MM-dd (sin toISOString). */
function mananaIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return hoyIso(d);
}

describe('FormularioRadicadoComponent', () => {
  let fixture: ComponentFixture<FormularioRadicadoComponent>;
  let componente: FormularioRadicadoComponent;
  let emitidos: DatosRadicado[];

  beforeEach(async () => {
    localStorage.setItem('user', JSON.stringify({ email: 'luis.carlos@tuapo.co', rol: { nombre: 'INCAPACIDADES' } }));
    await TestBed.configureTestingModule({
      imports: [FormularioRadicadoComponent],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(FormularioRadicadoComponent);
    componente = fixture.componentInstance;
    fixture.componentRef.setInput('cantidad', 3);
    emitidos = [];
    componente.enviar.subscribe((d) => emitidos.push(d));
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('user');
    fixture.destroy();
  });

  const llenar = (v: Partial<{ numeroRadicado: string; fechaRadicado: string; dondeRadicado: 'PAGINA' | 'CORREO' | 'PUNTO_FISICO' | null; observaciones: string }>) =>
    componente.formulario.patchValue(v);

  it('arranca con la fecha de hoy y sin canal elegido', () => {
    expect(componente.formulario.controls.fechaRadicado.value).toBe(hoyIso());
    expect(componente.formulario.controls.dondeRadicado.value).toBeNull();
  });

  it('muestra a nombre de quien queda el radicado (usuario de la sesion, no se digita)', () => {
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('luis.carlos@tuapo.co');
    expect(componente.formulario.contains('radicadoPor')).toBeFalse();
  });

  it('el numero de radicado es obligatorio (tampoco valen solo espacios)', () => {
    llenar({ numeroRadicado: '', dondeRadicado: 'PAGINA' });
    componente.guardar();
    expect(emitidos.length).toBe(0);
    expect(componente.errorNumero()).toContain('Escriba el número');

    llenar({ numeroRadicado: '    ' });
    componente.guardar();
    expect(emitidos.length).toBe(0);
    expect(componente.formulario.controls.numeroRadicado.invalid).toBeTrue();
  });

  it('el numero no pasa de 80 caracteres', () => {
    llenar({ numeroRadicado: 'X'.repeat(81), dondeRadicado: 'CORREO' });
    componente.guardar();
    expect(emitidos.length).toBe(0);
    expect(componente.errorNumero()).toContain('80');
  });

  it('la fecha no puede ser futura ni faltar', () => {
    llenar({ numeroRadicado: 'RAD-1', dondeRadicado: 'PAGINA', fechaRadicado: mananaIso() });
    componente.guardar();
    expect(emitidos.length).toBe(0);
    expect(componente.errorFecha()).toBe('La fecha no puede ser posterior a hoy.');

    llenar({ fechaRadicado: '' });
    componente.guardar();
    expect(emitidos.length).toBe(0);
    expect(componente.errorFecha()).toBe('Indique la fecha del radicado.');
  });

  it('donde se radico es obligatorio y su error se ve al intentar guardar', () => {
    llenar({ numeroRadicado: 'RAD-1' });
    expect(componente.dondeConError()).toBeFalse();
    componente.guardar();
    fixture.detectChanges();
    expect(emitidos.length).toBe(0);
    expect(componente.dondeConError()).toBeTrue();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Indique dónde se radicó');
  });

  it('con todo valido emite los datos limpios (observaciones vacias = null)', () => {
    llenar({ numeroRadicado: '  RAD-2026-001  ', dondeRadicado: 'PUNTO_FISICO', fechaRadicado: '2026-10-01', observaciones: '   ' });
    componente.guardar();
    expect(emitidos).toEqual([
      { numeroRadicado: 'RAD-2026-001', fechaRadicado: '2026-10-01', dondeRadicado: 'PUNTO_FISICO', observaciones: null },
    ]);
  });

  it('no emite sin incapacidades marcadas, guardando o con un bloqueo', () => {
    llenar({ numeroRadicado: 'RAD-1', dondeRadicado: 'PAGINA' });
    fixture.componentRef.setInput('cantidad', 0);
    componente.guardar();
    fixture.componentRef.setInput('cantidad', 2);
    fixture.componentRef.setInput('guardando', true);
    componente.guardar();
    fixture.componentRef.setInput('guardando', false);
    fixture.componentRef.setInput('bloqueo', 'Máximo 500');
    componente.guardar();
    expect(emitidos.length).toBe(0);
  });

  it('el boton dice cuantas se van a guardar y se deshabilita con cero', () => {
    fixture.componentRef.setInput('textoBoton', 'Registrar recobro');
    fixture.detectChanges();
    const boton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(boton.textContent).toContain('Registrar recobro (3)');
    expect(boton.disabled).toBeFalse();
    fixture.componentRef.setInput('cantidad', 0);
    fixture.detectChanges();
    expect(boton.disabled).toBeTrue();
  });

  it('reiniciar limpia numero y observaciones pero conserva fecha y canal', () => {
    llenar({ numeroRadicado: 'RAD-1', dondeRadicado: 'CORREO', fechaRadicado: '2026-10-02', observaciones: 'nota' });
    componente.reiniciar();
    const v = componente.formulario.getRawValue();
    expect(v.numeroRadicado).toBe('');
    expect(v.observaciones).toBe('');
    expect(v.fechaRadicado).toBe('2026-10-02');
    expect(v.dondeRadicado).toBe('CORREO');
    expect(componente.dondeConError()).toBeFalse();
  });

  it('el tope de la fecha sigue al reloj (la pantalla puede quedar abierta de un dia para otro)', () => {
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date(2026, 9, 6, 23, 59));
      expect(componente.hoy).toBe('2026-10-06');
      jasmine.clock().mockDate(new Date(2026, 9, 7, 0, 1));
      expect(componente.hoy).toBe('2026-10-07');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('dos formularios a la vez no repiten el id que nombra el grupo de canales', () => {
    const otro = TestBed.createComponent(FormularioRadicadoComponent);
    otro.detectChanges();
    const grupo = (f: ComponentFixture<FormularioRadicadoComponent>) =>
      (f.nativeElement as HTMLElement).querySelector('mat-button-toggle-group')!.getAttribute('aria-labelledby');
    expect(grupo(fixture)).toBeTruthy();
    expect(grupo(fixture)).not.toBe(grupo(otro));
    expect((fixture.nativeElement as HTMLElement).querySelector(`#${grupo(fixture)}`)).not.toBeNull();
    otro.destroy();
  });
});
