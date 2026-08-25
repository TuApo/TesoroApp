import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { FichaCandidatoComponent } from './ficha-candidato.component';

/**
 * El porcentaje de la ficha tiene que significar LO MISMO que el del rail: si
 * está al 100%, la entrevista se guarda sin que salte nada en rojo. Lo que se
 * fija aquí es la aritmética que lo sostiene —por bloque y en total— porque es
 * lo que se rompe en silencio si alguien cambia el reparto de campos.
 */
describe('FichaCandidatoComponent · avance', () => {
  let fixture: ComponentFixture<FichaCandidatoComponent>;
  let comp: FichaCandidatoComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FichaCandidatoComponent, NoopAnimationsModule],
    });
    fixture = TestBed.createComponent(FichaCandidatoComponent);
    comp = fixture.componentInstance;
  });

  function avances(v: Record<string, { hechos: number; total: number }>) {
    fixture.componentRef.setInput('avances', v);
    fixture.detectChanges();
  }

  it('sin datos no muestra porcentaje', () => {
    avances({});
    expect(comp.pctTotal()).toBeNull();
    expect(comp.pct('identificacion')).toBeNull();
  });

  it('un bloque sin nada medible tampoco muestra porcentaje', () => {
    // total 0 no es "0% lleno": es "aquí no hay nada que llenar".
    avances({ familia: { hechos: 0, total: 0 } });
    expect(comp.pct('familia')).toBeNull();
  });

  it('el porcentaje por bloque se redondea sobre sus obligatorios', () => {
    avances({ identificacion: { hechos: 3, total: 5 } });
    expect(comp.pct('identificacion')).toBe(60);
  });

  it('el total suma TODOS los bloques, no promedia sus porcentajes', () => {
    // Promediando daría 75%; lo correcto es 11/20 = 55%.
    avances({
      identificacion: { hechos: 1, total: 10 },
      personales: { hechos: 10, total: 10 },
    });
    expect(comp.pctTotal()).toBe(55);
  });

  it('la ficha está completa solo cuando no falta ningún obligatorio', () => {
    avances({ a: { hechos: 4, total: 5 }, b: { hechos: 5, total: 5 } });
    expect(comp.fichaCompleta()).toBeFalse();

    avances({ a: { hechos: 5, total: 5 }, b: { hechos: 5, total: 5 } });
    expect(comp.fichaCompleta()).toBeTrue();
  });

  it('el detalle dice cuántos faltan', () => {
    avances({ contacto: { hechos: 6, total: 8 } });
    expect(comp.detalle('contacto', 'Contacto')).toBe('Contacto · 6 de 8 · faltan 2');

    avances({ contacto: { hechos: 8, total: 8 } });
    expect(comp.detalle('contacto', 'Contacto')).toBe('Contacto · completo');
  });
});
