import {
  CONFIANZA_AUTOMATICA,
  analizarTexto,
  cedulasEnTexto,
  esDuplicadoExacto,
  estadoDeFicha,
  extraerDatos,
  leerNombreArchivo,
  normalizar,
  pareceFactura,
  puedeRegistrarse,
  resumirTexto,
  sugerirTipo,
  tamanoLegible,
  vigenteDelTipo,
} from './ingesta.util';
import { ContextoPersona, FichaIngesta } from './ingesta.model';

const TIPOS = [
  { id: 1, name: 'CONTRATO DE TRABAJO' },
  { id: 2, name: 'EXAMEN MEDICO DE INGRESO' },
  { id: 3, name: 'ARL CERTIFICADO DE AFILIACION' },
  { id: 4, name: 'ARL' },
];

function ficha(over: Partial<FichaIngesta> = {}): FichaIngesta {
  return {
    id: 'x', file: new File([''], 'x.pdf'), nombre: 'x.pdf', tamano: 10,
    origen: 'archivos', procedencia: '', cedula: '1032456789', typeId: 1,
    contrato: '', titulo: 'x.pdf', estado: 'listo', motivo: '',
    sugerencia: null, lectura: null, reemplazaA: null,
    documentId: null, enColaIa: false, enColaOffline: false,
    ...over,
  };
}

function contexto(over: Partial<ContextoPersona> = {}): ContextoPersona {
  return {
    cedula: '1032456789', existe: true, nombre: 'JUAN PEREZ', finca: '', fechaIngreso: '',
    contratos: [], documentos: [], faltantes: [], aviso: '', cargando: false,
    ...over,
  };
}

describe('normalizar', () => {
  it('quita acentos y unifica separadores', () => {
    expect(normalizar('Exámen_Médico-Ingreso.PDF')).toBe('exámen médico ingreso pdf'
      .normalize('NFD').replace(/[̀-ͯ]/g, ''));
  });
});

describe('leerNombreArchivo', () => {
  it('lee la convención cedula_tipo.pdf', () => {
    const r = leerNombreArchivo('1032456789_contrato.pdf');
    expect(r.cedula).toBe('1032456789');
    expect(r.pista).toBe('contrato');
  });

  it('tolera prefijo CC y separadores con espacios', () => {
    expect(leerNombreArchivo('CC1032456789 - ARL.PDF').cedula).toBe('1032456789');
  });

  it('usa la carpeta como pista de categoría', () => {
    const r = leerNombreArchivo('EXAMENES/1032456789.pdf');
    expect(r.cedula).toBe('1032456789');
    expect(r.carpeta).toBe('examenes');
  });

  it('no confunde un año con una cédula', () => {
    expect(leerNombreArchivo('contrato_2026.pdf').cedula).toBe('');
  });
});

describe('sugerirTipo', () => {
  it('prefiere el tipo que cubre más palabras del nombre', () => {
    const s = sugerirTipo('arl certificado de afiliacion', '', TIPOS);
    expect(s?.typeId).toBe(3);
    expect(s!.confianza).toBeGreaterThanOrEqual(CONFIANZA_AUTOMATICA);
  });

  it('casa examen de ingreso con el tipo largo', () => {
    expect(sugerirTipo('examen ingreso', '', TIPOS)?.typeId).toBe(2);
  });

  it('devuelve null si no hay nada en común', () => {
    expect(sugerirTipo('foto playa', '', TIPOS)).toBeNull();
  });
});

describe('pareceFactura', () => {
  it('reconoce la palabra factura', () => {
    expect(pareceFactura('FACTURA DE VENTA No 123', 'doc.pdf')).toBeTrue();
  });

  it('exige dos señales cuando no dice factura', () => {
    expect(pareceFactura('NIT 900.123.456-7', 'hoja_vida.pdf')).toBeFalse();
    expect(pareceFactura('NIT 900.123.456-7 IVA 19%', 'x.pdf')).toBeTrue();
  });
});

describe('extraerDatos y cedulasEnTexto', () => {
  it('saca NIT, fecha y valor', () => {
    const d = extraerDatos('NIT 900.123.456-7 del 12/03/2026 por $ 1.250.000');
    expect(d.map(x => x.etiqueta)).toEqual(['NIT', 'Fecha', 'Valor']);
  });

  it('ordena las cédulas por repetición', () => {
    expect(cedulasEnTexto('1032456789 y 5551234 y 1032456789')[0]).toBe('1032456789');
  });
});

describe('resumirTexto', () => {
  it('devuelve frases del propio documento', () => {
    const t = 'El presente contrato se celebra entre las partes aqui mencionadas. '
      + 'El trabajador desempenara el cargo de vigilante en la sede norte.';
    const r = resumirTexto(t);
    expect(r.length).toBe(2);
    expect(t).toContain(r[0]);
  });

  it('descarta fragmentos demasiado cortos', () => {
    expect(resumirTexto('Hoja 1. OK.')).toEqual([]);
  });
});

describe('analizarTexto', () => {
  it('marca requiereOcr cuando casi no hay texto', () => {
    const l = analizarTexto('   .  ', 'escaneado.pdf', 3);
    expect(l.requiereOcr).toBeTrue();
    expect(l.resumen).toEqual([]);
  });

  it('no pide OCR si el PDF trae capa de texto', () => {
    const l = analizarTexto('x'.repeat(200), 'digital.pdf', 1);
    expect(l.requiereOcr).toBeFalse();
  });
});

describe('vigenteDelTipo', () => {
  const docs = [
    { documentId: 10, typeId: 1, typeName: 'CONTRATO', titulo: 'a.pdf', subidoEn: '2026-01-01', fileUrl: null, vigente: true, contrato: null },
    { documentId: 11, typeId: 1, typeName: 'CONTRATO', titulo: 'b.pdf', subidoEn: '2026-05-01', fileUrl: null, vigente: true, contrato: null },
  ];

  it('toma el más reciente del mismo tipo', () => {
    expect(vigenteDelTipo(contexto({ documentos: docs }), 1, '')?.documentId).toBe(11);
  });

  it('devuelve null si no hay del tipo', () => {
    expect(vigenteDelTipo(contexto({ documentos: docs }), 9, '')).toBeNull();
  });
});

describe('estadoDeFicha', () => {
  it('bloquea sin cédula', () => {
    expect(estadoDeFicha(ficha({ cedula: '' }), null).estado).toBe('sin_persona');
  });

  it('bloquea si la cédula no está en contratación', () => {
    const c = contexto({ existe: false });
    expect(estadoDeFicha(ficha(), c).estado).toBe('sin_persona');
  });

  it('bloquea sin tipo', () => {
    expect(estadoDeFicha(ficha({ typeId: null }), contexto()).estado).toBe('sin_tipo');
  });

  it('avisa de duplicado exacto sin bloquear', () => {
    const c = contexto({
      documentos: [{ documentId: 1, typeId: 1, typeName: 'C', titulo: 'x.pdf', subidoEn: null, fileUrl: null, vigente: true, contrato: null }],
    });
    const f = ficha();
    const r = estadoDeFicha(f, c);
    expect(r.estado).toBe('duplicado');
    expect(puedeRegistrarse({ ...f, estado: r.estado })).toBeTrue();
  });

  it('marca reemplazo cuando ya hay vigente del tipo', () => {
    const previo = { documentId: 7, typeId: 1, typeName: 'CONTRATO', titulo: 'viejo.pdf', subidoEn: '2026-01-01', fileUrl: null, vigente: true, contrato: null };
    expect(estadoDeFicha(ficha({ reemplazaA: previo }), contexto()).estado).toBe('reemplaza');
  });

  it('respeta los estados ya resueltos', () => {
    expect(estadoDeFicha(ficha({ estado: 'registrado' }), contexto()).estado).toBe('registrado');
  });
});

describe('esDuplicadoExacto', () => {
  it('ignora la extensión al comparar', () => {
    const c = contexto({
      documentos: [{ documentId: 1, typeId: 1, typeName: 'C', titulo: 'Contrato Firmado', subidoEn: null, fileUrl: null, vigente: true, contrato: null }],
    });
    expect(esDuplicadoExacto(ficha({ nombre: 'contrato_firmado.pdf' }), c)).toBeTrue();
  });
});

describe('tamanoLegible', () => {
  it('usa KB por debajo del mega y coma decimal por encima', () => {
    expect(tamanoLegible(2048)).toBe('2 KB');
    expect(tamanoLegible(1024 * 1024 * 2.5)).toBe('2,5 MB');
  });
});
