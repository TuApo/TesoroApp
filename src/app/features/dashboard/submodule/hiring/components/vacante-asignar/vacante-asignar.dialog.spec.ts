import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import {
  VacanteAsignarData, VacanteAsignarDialogComponent, VacanteOpcion,
} from './vacante-asignar.dialog';

/**
 * Lo que se prueba es la búsqueda, que es la razón de existir del diálogo: el
 * selector viejo no encontraba una vacante si las palabras tecleadas caían en
 * campos distintos.
 */
describe('VacanteAsignarDialogComponent', () => {
  const V = (id: number, empresa: string, finca: string, cargo: string,
              extra: Partial<VacanteOpcion> = {}): VacanteOpcion => ({
    id, empresa, finca, cargo,
    codigo: null, temporal: null, oficinas: '', publicada: null,
    requeridos: 5, faltantes: 3, cerrada: false, ...extra,
  });

  const OPCIONES: VacanteOpcion[] = [
    V(1, 'JARDINES DE LOS ANDES', 'LA ROSA', 'COSECHA', { codigo: 'JA-11', oficinas: 'SOACHA' }),
    V(2, 'JARDINES DE LOS ANDES', 'EL CLAVEL', 'POSCOSECHA', { codigo: 'JA-12' }),
    V(3, 'FLORES DE LOS ANDES', 'LA ROSA', 'SUPERVISOR', { codigo: 'FA-01' }),
    V(4, 'SAGARO', 'IPANEMA', 'FUMIGADOR', { codigo: 'SG-07', cerrada: true }),
    V(5, 'SAGARO', 'IPANEMA', 'COSECHA', { codigo: 'SG-08', faltantes: 0, cerrada: true }),
  ];

  function crear(actual: number | null = null): ComponentFixture<VacanteAsignarDialogComponent> {
    const data: VacanteAsignarData = { opciones: OPCIONES, actual, candidato: 'ANA GÓMEZ' };
    TestBed.configureTestingModule({
      imports: [VacanteAsignarDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } },
      ],
    });
    const f = TestBed.createComponent(VacanteAsignarDialogComponent);
    f.detectChanges();
    return f;
  }

  const ids = (f: ComponentFixture<VacanteAsignarDialogComponent>) =>
    f.componentInstance.resultados().map((o) => o.id);

  it('sin consulta muestra solo las que tienen cupos', () => {
    const f = crear();
    expect(ids(f)).toEqual([1, 2, 3]);
  });

  it('varias palabras se buscan TODAS, en cualquier campo y en cualquier orden', () => {
    const f = crear();
    // "jardines" está en la empresa, "rosa" en la finca y "cosecha" en el cargo.
    f.componentInstance.consulta.set('jardines rosa cosecha');
    expect(ids(f)).toEqual([1]);

    // El orden da igual.
    f.componentInstance.consulta.set('cosecha rosa jardines');
    expect(ids(f)).toEqual([1]);
  });

  it('si una palabra no está, la vacante no sale', () => {
    const f = crear();
    f.componentInstance.consulta.set('jardines rosa supervisor');
    expect(ids(f)).toEqual([]);
  });

  it('busca sin tildes y sin importar mayúsculas', () => {
    const f = crear();
    f.componentInstance.consulta.set('POSCOSECHA clavel');
    expect(ids(f)).toEqual([2]);
  });

  it('encuentra por código', () => {
    const f = crear();
    f.componentInstance.consulta.set('fa-01');
    expect(ids(f)).toEqual([3]);
  });

  it('la vacante asignada se ve aunque esté cerrada y aunque no coincida', () => {
    // Si no, quitarla obligaría a buscar una vacante que ya no se ofrece.
    const f = crear(4);
    expect(ids(f)).toContain(4);

    f.componentInstance.consulta.set('jardines');
    expect(ids(f)).toContain(4);
  });
});
