import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import type { ResultadoAsignacionRadicado } from '../../../../models/incapacidad-salud.model';
import { resultadoPrueba } from '../../radicacion.datos-prueba';
import { ResultadoRadicadoComponent } from './resultado-radicado.component';

describe('ResultadoRadicadoComponent', () => {
  let fixture: ComponentFixture<ResultadoRadicadoComponent>;
  let componente: ResultadoRadicadoComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResultadoRadicadoComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(ResultadoRadicadoComponent);
    componente = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  it('pone primero las que fallaron y dice cuantas quedaron', () => {
    fixture.componentRef.setInput('resultado', resultadoPrueba([{ id: 1, ok: true }, { id: 2, ok: false, mensaje: 'Cancelada' }]));
    fixture.componentRef.setInput('numero', 'RAD-9');
    fixture.detectChanges();
    expect(componente.ordenados().map((f) => f.incapacidadId)).toEqual([2, 1]);
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('1 de 2 guardada(s)');
    expect(texto).toContain('RAD-9');
    expect(texto).toContain('Cancelada');
  });

  it('un cuerpo sin "resultados" (p. ej. el 200 falso de la cola offline) no revienta la plantilla', () => {
    const raro = { incapacidadIds: [1], _isOfflineMock: true } as unknown as ResultadoAsignacionRadicado;
    fixture.componentRef.setInput('resultado', raro);
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(componente.ordenados()).toEqual([]);
  });
});
