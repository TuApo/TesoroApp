import { encontradoPrueba, refPrueba, swalEspiable } from './radicacion.datos-prueba';
import {
  codigoVisible,
  confirmarRadicado,
  esFechaFutura,
  etiquetaDonde,
  fechaCorta,
  fusionarEncontrados,
  listaCorta,
  marcadaPorDefecto,
  mensajeError,
  periodo,
  quedoEnCola,
  recobroDudoso,
  separarCodigos,
  tonoEstado,
} from './radicacion.utils';

describe('radicacion.utils', () => {
  describe('separarCodigos (busqueda colectiva)', () => {
    it('acepta uno por linea, comas, punto y coma, espacios y tabulaciones', () => {
      expect(separarCodigos('111\n222, 333;444\t555  666')).toEqual(['111', '222', '333', '444', '555', '666']);
    });

    it('pasa a mayusculas, quita comillas de Excel y descarta vacios y repetidos', () => {
      expect(separarCodigos(' "tasb018"\r\n\r\nTASB018\n\'777\'\n')).toEqual(['TASB018', '777']);
    });

    it('el codigo general con y sin guion bajo es el mismo', () => {
      expect(separarCodigos('1005851505_20260131\n100585150520260131')).toEqual(['1005851505_20260131']);
    });

    it('conserva el sufijo -n del codigo', () => {
      expect(separarCodigos('100585150520260131-2')).toEqual(['100585150520260131-2']);
    });

    it('nada o null devuelve lista vacia', () => {
      expect(separarCodigos('')).toEqual([]);
      expect(separarCodigos(null)).toEqual([]);
      expect(separarCodigos(' ,; \n')).toEqual([]);
    });
  });

  describe('fechas', () => {
    const hoy = new Date(2026, 9, 6); // 6 de octubre de 2026, hora local

    it('una fecha posterior a hoy es futura; hoy y antes no', () => {
      expect(esFechaFutura('2026-10-07', hoy)).toBeTrue();
      expect(esFechaFutura('2026-10-06', hoy)).toBeFalse();
      expect(esFechaFutura('2026-09-30', hoy)).toBeFalse();
      expect(esFechaFutura('', hoy)).toBeFalse();
    });

    it('fechaCorta no resta un dia por zona horaria', () => {
      expect(fechaCorta('2026-01-31')).toBe('31/01/2026');
      expect(fechaCorta(null)).toBe('');
    });

    it('periodo arma inicio – fin', () => {
      expect(periodo(refPrueba())).toBe('31/01/2026 – 04/02/2026');
    });
  });

  it('etiquetaDonde usa las palabras de la funcional', () => {
    expect(etiquetaDonde('PAGINA')).toBe('Página web');
    expect(etiquetaDonde('CORREO')).toBe('Correo');
    expect(etiquetaDonde('PUNTO_FISICO')).toBe('Presencial');
    expect(etiquetaDonde(null)).toBe('');
  });

  it('codigoVisible prefiere el de oficina y si no el general sin guion bajo', () => {
    expect(codigoVisible(refPrueba())).toBe('TASB018');
    expect(codigoVisible(refPrueba({ codigoOficina: null, codigoUnico: '123_20260101' }))).toBe('12320260101');
  });

  it('tonoEstado colorea los estados de radicacion y liquidacion', () => {
    expect(tonoEstado('VALIDADA')).toBe('ok');
    expect(tonoEstado('PENDIENTE_RADICACION')).toBe('warn');
    expect(tonoEstado('RADICADA')).toBe('info');
    expect(tonoEstado('NEGADA')).toBe('danger');
    expect(tonoEstado('RECOBRO')).toBe('violet');
    expect(tonoEstado('CANCELADA')).toBe('neutro');
  });

  it('solo se marca por defecto lo que se puede radicar y no es ambiguo', () => {
    expect(marcadaPorDefecto(encontradoPrueba())).toBeTrue();
    expect(marcadaPorDefecto(encontradoPrueba({ ambiguo: true }))).toBeFalse();
    expect(marcadaPorDefecto(encontradoPrueba({ puedeRadicar: false }))).toBeFalse();
    expect(marcadaPorDefecto(encontradoPrueba({ yaRadicada: true }))).toBeTrue();
  });

  it('en RECOBRO una pagada o finalizada no se marca sola (en RADICACION no aplica)', () => {
    const pagada = encontradoPrueba({ yaRadicada: true }, { estado: 'PAGADA' });
    expect(recobroDudoso(pagada, 'RECOBRO')).toBeTrue();
    expect(marcadaPorDefecto(pagada, 'RECOBRO')).toBeFalse();
    expect(marcadaPorDefecto(encontradoPrueba({ yaRadicada: true }, { estado: 'FINALIZADA' }), 'RECOBRO')).toBeFalse();
    expect(marcadaPorDefecto(encontradoPrueba({ yaRadicada: true }, { estado: 'RECOBRO' }), 'RECOBRO')).toBeTrue();
    // Historicas negadas en el Excel del area: siguen en RADICADA y el recobro es lo normal.
    expect(marcadaPorDefecto(encontradoPrueba({ yaRadicada: true }, { estado: 'RADICADA' }), 'RECOBRO')).toBeTrue();
    expect(recobroDudoso(pagada, 'RADICACION')).toBeFalse();
    expect(recobroDudoso(encontradoPrueba({ puedeRadicar: false }, { estado: 'PAGADA' }), 'RECOBRO')).toBeFalse();
  });

  it('quedoEnCola reconoce el 200 falso de la cola offline y nada mas', () => {
    expect(quedoEnCola({ incapacidadIds: [1], id: -3, _isOfflineMock: true })).toBeTrue();
    expect(quedoEnCola({ success: true, offlineQueue: true })).toBeTrue();
    expect(quedoEnCola({ lote: null, total: 1, exitosos: 1, fallidos: 0, resultados: [] })).toBeFalse();
    expect(quedoEnCola(null)).toBeFalse();
  });

  it('fusionarEncontrados no duplica: refresca lo que estaba y agrega lo nuevo al final', () => {
    const a = encontradoPrueba({}, { id: 1, nombreCompleto: 'A VIEJO' });
    const b = encontradoPrueba({}, { id: 2, nombreCompleto: 'B' });
    const aFresco = encontradoPrueba({ yaRadicada: true }, { id: 1, nombreCompleto: 'A FRESCO' });
    const c = encontradoPrueba({}, { id: 3, nombreCompleto: 'C' });
    const r = fusionarEncontrados([a, b], [c, aFresco]);
    expect(r.map((e) => e.incapacidad.nombreCompleto)).toEqual(['A FRESCO', 'B', 'C']);
  });

  it('mensajeError toma el {error} de ms-hr o el texto por defecto', () => {
    expect(mensajeError({ status: 409, error: { error: 'Ya tiene respuesta' } }, 'x')).toBe('Ya tiene respuesta');
    expect(mensajeError({ status: 500, error: 'texto plano' }, 'Por defecto')).toBe('Por defecto');
    expect(mensajeError({ status: 0 }, 'x')).toContain('conexión');
  });

  it('listaCorta resume listas largas', () => {
    expect(listaCorta(['a', 'b'])).toBe('a, b');
    expect(listaCorta(['a', 'b', 'c'], 2)).toBe('a, b y 1 más');
  });

  describe('confirmarRadicado', () => {
    const datos = { numeroRadicado: 'RAD-77', fechaRadicado: '2026-10-05', dondeRadicado: 'PAGINA' as const, observaciones: null };

    it('advierte las correcciones y devuelve lo que elige el usuario', async () => {
      const fire = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));
      const ok = await confirmarRadicado({ modo: 'RADICACION', datos, cantidad: 3, correcciones: ['TASB018'] });
      expect(ok).toBeTrue();
      const opciones = fire.calls.mostRecent().args[0] as { html: string; icon: string; title: string };
      expect(opciones.title).toBe('¿Guardar el radicado?');
      expect(opciones.icon).toBe('warning');
      expect(opciones.html).toContain('RAD-77');
      expect(opciones.html).toContain('05/10/2026');
      expect(opciones.html).toContain('Página web');
      expect(opciones.html).toContain('TASB018');
      expect(opciones.html).toContain('ya tenía radicado');
    });

    it('en recobro aclara que no cambia el radicado inicial; cancelar devuelve false', async () => {
      const fire = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: false }));
      const ok = await confirmarRadicado({ modo: 'RECOBRO', datos, cantidad: 1 });
      expect(ok).toBeFalse();
      const opciones = fire.calls.mostRecent().args[0] as { html: string; icon: string; title: string };
      expect(opciones.title).toBe('¿Registrar el recobro?');
      expect(opciones.icon).toBe('question');
      expect(opciones.html).toContain('no cambia el radicado inicial');
    });

    it('escapa el HTML del numero digitado', async () => {
      const fire = spyOn(swalEspiable(), 'fire').and.returnValue(Promise.resolve({ isConfirmed: true }));
      await confirmarRadicado({ modo: 'RADICACION', datos: { ...datos, numeroRadicado: '<b>x</b>' }, cantidad: 1 });
      const opciones = fire.calls.mostRecent().args[0] as { html: string };
      expect(opciones.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    });
  });
});
