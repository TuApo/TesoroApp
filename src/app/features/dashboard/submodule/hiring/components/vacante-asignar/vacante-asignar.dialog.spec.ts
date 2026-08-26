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
    publicadaEn: null, diasAbierta: null, salario: null,
    municipios: null, tipo_contratacion: null,
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
    expect(ids(f).sort()).toEqual([1, 2, 3]);
  });

  describe('orden por urgencia', () => {
    const POR_URGENCIA: VacanteOpcion[] = [
      V(10, 'A', 'A', 'POCO',    { faltantes: 1,  diasAbierta: 2 }),
      V(11, 'B', 'B', 'MUCHO',   { faltantes: 20, diasAbierta: 1 }),
      V(12, 'C', 'C', 'MEDIO',   { faltantes: 5,  diasAbierta: 90 }),
      V(13, 'D', 'D', 'EMPATE',  { faltantes: 5,  diasAbierta: 3 }),
    ];

    function crearCon(ops: VacanteOpcion[], actual: number | null = null) {
      const data: VacanteAsignarData = { opciones: ops, actual, candidato: null };
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

    it('primero la que más gente necesita', () => {
      const f = crearCon(POR_URGENCIA);
      expect(f.componentInstance.resultados().map((o) => o.cargo))
        .toEqual(['MUCHO', 'MEDIO', 'EMPATE', 'POCO']);
    });

    it('a igualdad de faltantes, primero la que lleva más tiempo abierta', () => {
      const f = crearCon([POR_URGENCIA[3], POR_URGENCIA[2]]);
      expect(f.componentInstance.resultados().map((o) => o.cargo)).toEqual(['MEDIO', 'EMPATE']);
    });

    it('la asignada va siempre arriba, aunque necesite menos gente', () => {
      const f = crearCon(POR_URGENCIA, 10);
      expect(f.componentInstance.resultados()[0].cargo).toBe('POCO');
    });

    it('el nivel se deduce de cuánta gente falta', () => {
      const f = crearCon(POR_URGENCIA);
      const c = f.componentInstance;
      expect(c.nivel(POR_URGENCIA[1])).toBe('alta');
      expect(c.nivel(POR_URGENCIA[2])).toBe('media');
      expect(c.nivel(POR_URGENCIA[0])).toBe('baja');
    });
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
