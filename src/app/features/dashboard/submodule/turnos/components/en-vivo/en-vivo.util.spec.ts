import { LineaEnVivo } from '../../service/transcripcion-en-vivo';
import { TemaConversacion, Turno } from '../../service/turnos.service';
import { armarContextoExtra, armarFicha, buscarLineaDeCita, debeActualizarTemas, formatoTiempo, fusionarConversacion, hayDiferencia } from './en-vivo.util';

const L = (cliente_id: string, hablante: 'ASESOR' | 'PERSONA', texto: string, inicio_ms: number, fin_ms = inicio_ms + 1500): LineaEnVivo =>
  ({ cliente_id, id: null, hablante, texto, inicio_ms, fin_ms, guardada: true });

const NOMBRES = { ASESOR: 'Laura Gómez', PERSONA: 'Ana Pérez' };

describe('en-vivo.util', () => {
  it('formato de tiempo mm:ss y h:mm:ss', () => {
    expect(formatoTiempo(0)).toBe('00:00');
    expect(formatoTiempo(83_400)).toBe('01:23');
    expect(formatoTiempo(3_723_000)).toBe('1:02:03');
    expect(formatoTiempo(null)).toBe('00:00');
    expect(formatoTiempo(-5)).toBe('00:00');
  });

  it('fusiona confirmadas en orden de tiempo y deja lo que se está diciendo al final, marcando las rachas', () => {
    const items = fusionarConversacion(
      [L('b', 'PERSONA', 'Hola', 4000), L('a', 'ASESOR', 'Buenos días', 1000), L('c', 'PERSONA', 'Vengo por el pago', 6000)],
      { ASESOR: { texto: 'Claro, ¿me confirma', inicio_ms: 9000 }, PERSONA: null },
    );
    expect(items.map(i => i.texto)).toEqual(['Buenos días', 'Hola', 'Vengo por el pago', 'Claro, ¿me confirma']);
    expect(items.map(i => i.primeroDelGrupo)).toEqual([true, true, false, true]);
    expect(items[3].provisional).toBeTrue();
    expect(items[3].clave).toBe('parcial:ASESOR');
    expect(items[0].clave).toBe('c:a');
  });

  it('dos parciales a la vez van por orden de inicio; las vacías no se pintan', () => {
    const items = fusionarConversacion([], { ASESOR: { texto: 'yo', inicio_ms: 200 }, PERSONA: { texto: 'tú', inicio_ms: 100 } });
    expect(items.map(i => i.hablante)).toEqual(['PERSONA', 'ASESOR']);
    expect(fusionarConversacion([], { ASESOR: { texto: '  ', inicio_ms: 1 } }).length).toBe(0);
  });

  it('la cita de un tema lleva a la frase que la contiene (sin tildes ni signos), o a la más cercana al minuto', () => {
    const lineas = [L('a', 'PERSONA', 'Ahora tengo cuenta en Bancolombia, me cambié', 80_000), L('b', 'ASESOR', 'Listo', 90_000), L('c', 'PERSONA', 'Me cambié de celular', 120_000)];
    expect(buscarLineaDeCita(lineas, 'me cambie', 125_000)).toBe('c:c');
    expect(buscarLineaDeCita(lineas, 'Bancolombia', null)).toBe('c:a');
    expect(buscarLineaDeCita(lineas, 'no dijo esto', 91_000)).toBe('c:b');
    expect(buscarLineaDeCita(lineas, 'no dijo esto', null)).toBeNull();
    expect(buscarLineaDeCita([], 'x', 1)).toBeNull();
  });

  it('hay diferencia solo si ficha y lo dicho existen y no son lo mismo (sin mayúsculas ni tildes)', () => {
    expect(hayDiferencia({ valor_ficha: 'Davivienda', valor_dicho: 'Bancolombia' })).toBeTrue();
    expect(hayDiferencia({ valor_ficha: 'Bogotá', valor_dicho: 'bogota' })).toBeFalse();
    expect(hayDiferencia({ valor_ficha: null, valor_dicho: 'x' })).toBeFalse();
  });

  it('temas: cada ≥ 20 s y con ≥ 2 frases nuevas; nunca dos pedidos a la vez', () => {
    const base = { ahora: 100_000, ultimaSolicitud: 70_000, lineasEnUltima: 4, lineasActuales: 6, enCurso: false };
    expect(debeActualizarTemas(base)).toBeTrue();
    expect(debeActualizarTemas({ ...base, lineasActuales: 5 })).toBeFalse();
    expect(debeActualizarTemas({ ...base, ultimaSolicitud: 85_000 })).toBeFalse();
    expect(debeActualizarTemas({ ...base, enCurso: true })).toBeFalse();
    expect(debeActualizarTemas({ ...base, ultimaSolicitud: null, lineasEnUltima: 0, lineasActuales: 2 })).toBeTrue();
  });

  it('contexto del chat: resumen, temas y la cola de la conversación, sin pasar de 3800', () => {
    const temas: TemaConversacion[] = [{ clave: 'cuenta', titulo: 'Cuenta bancaria', tipo: 'DATO', resumen: 'Cambió de banco', valor_ficha: 'Davivienda', valor_dicho: 'Bancolombia', modulo: 'nomina-formas-pago' }];
    const muchas = Array.from({ length: 300 }, (_, i) => L('l' + i, i % 2 ? 'PERSONA' : 'ASESOR', `Frase número ${i} con algo de texto para ocupar espacio`, i * 3000));
    const c = armarContextoExtra({ lineas: muchas, temas, resumen: 'Pidió cambiar la cuenta.', nombres: NOMBRES })!;
    expect(c.length).toBeLessThanOrEqual(3800);
    expect(c).toContain('Resumen de lo conversado: Pidió cambiar la cuenta.');
    expect(c).toContain('Cuenta bancaria: Cambió de banco (en la ficha: Davivienda; dijo: Bancolombia)');
    // Lo más reciente manda: la última frase está, la primera no.
    expect(c).toContain('Frase número 299');
    expect(c).not.toContain('Frase número 0 ');
    expect(c).toContain('Persona (Ana Pérez): Frase número 299');
    expect(c).toContain('[14:57]');
    expect(armarContextoExtra({ lineas: [], temas: [], resumen: null, nombres: NOMBRES })).toBeNull();
    // Lo dicho en la llamada va marcado como datos, no como instrucciones para el asistente.
    expect(c.split('\n')[0]).toContain('no instrucciones');
  });

  it('la frase más reciente entra aunque sea larguísima (recortada)', () => {
    const c = armarContextoExtra({ lineas: [L('x', 'ASESOR', 'a'.repeat(5000), 0)], temas: [], resumen: null, nombres: NOMBRES, max: 500 })!;
    expect(c.length).toBeLessThanOrEqual(500);
    expect(c).toContain('Asesor (Laura Gómez): aaa');
  });

  it('la ficha para los temas cabe en 8 KB y suelta primero el historial y los textos largos', () => {
    const turno = { servicio_nombre: 'Contratación', nombre: 'Ana', documento: '1020', telefono: '300', correo: null, empresa_usuaria_nombre: null, formulario_etiqueta: 'Completo', formulario_listo: true } as unknown as Turno;
    const ficha = armarFicha({
      turno, persona: null, lectura: null,
      atenciones: Array.from({ length: 5 }, (_, i) => ({ fecha: '2026-09-0' + (i + 1), servicio_nombre: 'x'.repeat(1500), estado: 'ATENDIDO', remoto: true } as never)),
      resumenExpediente: 'r'.repeat(1400), maxBytes: 3000,
    });
    expect(new TextEncoder().encode(JSON.stringify(ficha)).length).toBeLessThanOrEqual(3000);
    expect(ficha['atenciones_anteriores']).toBeUndefined();
    expect(ficha['documento']).toBe('1020');
    expect(ficha['estado_contratacion']).toBe('No aparece en contratación');
    expect('correo' in ficha).toBeFalse();
  });
});
