import { buildRemisionPdf, DatosRemision, textoCargoRemision } from './remision-fill';

describe('remision-fill', () => {
  describe('textoCargoRemision (pedido #12)', () => {
    it('sin cargo específico queda el cargo solo, como siempre', () => {
      expect(textoCargoRemision('OPERARIO', '')).toBe('OPERARIO');
      expect(textoCargoRemision('OPERARIO', null)).toBe('OPERARIO');
    });

    it('con cargo específico: "Cargo — Cargo específico: Detalle"', () => {
      expect(textoCargoRemision('OPERARIO', 'Operario de corte'))
        .toBe('OPERARIO — Cargo específico: Operario de corte');
    });

    it('si el específico repite el cargo no se duplica', () => {
      expect(textoCargoRemision('Operario', 'OPERARIO ')).toBe('Operario');
    });

    it('sin cargo pero con específico, se imprime el específico', () => {
      expect(textoCargoRemision('', 'Poscosecha')).toBe('Cargo específico: Poscosecha');
    });
  });

  it('arma el PDF aunque el cargo con su específico sea largo', () => {
    const d: DatosRemision = {
      temporal: 'apoyo', fecha: '27/09/2026', empresaUsuaria: 'FLORES DE PRUEBA SAS',
      cargo: 'OPERARIO DE CULTIVO Y POSCOSECHA',
      cargoEspecifico: 'Operario de corte y clasificación de tallos para exportación',
      experienciaSector: 'SI', tiempoExperiencia: '2 año(s)', nombreCandidato: 'ANA GÓMEZ',
      cedula: '1004803288', area: '', dia: '', hora: '', preguntarPor: '', direccionEmpresa: '',
      gestionHumana: '',
    };
    const blob = buildRemisionPdf(d);
    expect(blob instanceof Blob).toBeTrue();
    expect(blob.size).toBeGreaterThan(0);
  });
});
