import { GridSelection, aTsv } from './grid-selection';

/**
 * La selección es aritmética pura sin dependencias de Angular, así que se prueba
 * directamente. Lo que se cubre es lo que rompe en uso real: rangos invertidos
 * (arrastrar hacia arriba/izquierda), recorte al cambiar de página, y el escapado
 * del portapapeles.
 */
describe('GridSelection', () => {
  let sel: GridSelection;

  beforeEach(() => {
    sel = new GridSelection();
    sel.redimensionar(10, 5);
  });

  it('empieza sin selección', () => {
    expect(sel.hayseleccion).toBe(false);
    expect(sel.rango()).toBeNull();
    expect(sel.conteo()).toBe(0);
  });

  it('un clic selecciona una sola celda', () => {
    sel.iniciarEn(2, 3);
    expect(sel.conteo()).toBe(1);
    expect(sel.estaSeleccionada(2, 3)).toBe(true);
    expect(sel.estaSeleccionada(2, 4)).toBe(false);
    expect(sel.esCeldaActiva(2, 3)).toBe(true);
  });

  it('arrastrar extiende el rectángulo', () => {
    sel.iniciarEn(1, 1);
    sel.arrastrarHasta(3, 2);
    expect(sel.rango()).toEqual({ filaIni: 1, filaFin: 3, colIni: 1, colFin: 2 });
    expect(sel.conteo()).toBe(6);
  });

  it('normaliza el rango al arrastrar hacia arriba y a la izquierda', () => {
    sel.iniciarEn(4, 4);
    sel.arrastrarHasta(1, 1);
    expect(sel.rango()).toEqual({ filaIni: 1, filaFin: 4, colIni: 1, colFin: 4 });
    expect(sel.estaSeleccionada(2, 2)).toBe(true);
  });

  it('no extiende si no se venía de un clic sostenido', () => {
    sel.iniciarEn(0, 0);
    sel.terminarArrastre();
    sel.arrastrarHasta(5, 4);
    expect(sel.conteo()).toBe(1);
  });

  it('shift+clic extiende desde el ancla', () => {
    sel.iniciarEn(1, 1);
    sel.terminarArrastre();
    sel.iniciarEn(3, 3, true);
    expect(sel.rango()).toEqual({ filaIni: 1, filaFin: 3, colIni: 1, colFin: 3 });
  });

  it('selecciona una fila entera', () => {
    sel.seleccionarFila(4);
    expect(sel.modo).toBe('fila');
    expect(sel.rango()).toEqual({ filaIni: 4, filaFin: 4, colIni: 0, colFin: 4 });
    expect(sel.conteo()).toBe(5);
  });

  it('selecciona una columna entera', () => {
    sel.seleccionarColumna(2);
    expect(sel.modo).toBe('columna');
    expect(sel.rango()).toEqual({ filaIni: 0, filaFin: 9, colIni: 2, colFin: 2 });
    expect(sel.columnaEnRango(2)).toBe(true);
    expect(sel.columnaEnRango(1)).toBe(false);
  });

  it('selecciona toda la rejilla', () => {
    sel.seleccionarTodo();
    expect(sel.conteo()).toBe(50);
  });

  it('las flechas mueven y colapsan; con shift extienden', () => {
    sel.iniciarEn(2, 2);
    sel.mover(1, 0, false);
    expect(sel.conteo()).toBe(1);
    expect(sel.esCeldaActiva(3, 2)).toBe(true);

    sel.mover(0, 1, true);
    expect(sel.rango()).toEqual({ filaIni: 3, filaFin: 3, colIni: 2, colFin: 3 });
  });

  it('el movimiento no se sale de la rejilla', () => {
    sel.iniciarEn(0, 0);
    sel.mover(-5, -5, false);
    expect(sel.esCeldaActiva(0, 0)).toBe(true);

    sel.mover(99, 99, false);
    expect(sel.esCeldaActiva(9, 4)).toBe(true);
  });

  it('recorta la selección cuando la rejilla encoge', () => {
    sel.iniciarEn(9, 4);
    sel.arrastrarHasta(9, 4);
    // Cambio de página: quedan 3 filas y 2 columnas visibles.
    sel.redimensionar(3, 2);
    const r = sel.rango()!;
    expect(r.filaFin).toBeLessThanOrEqual(2);
    expect(r.colFin).toBeLessThanOrEqual(1);
  });

  it('limpia la selección si la rejilla se queda vacía', () => {
    sel.iniciarEn(1, 1);
    sel.redimensionar(0, 0);
    expect(sel.hayseleccion).toBe(false);
  });

  it('sabe cuándo el rango toma las columnas enteras (para copiar con encabezados)', () => {
    sel.seleccionarTodo();
    expect(sel.cubreTodasLasFilas()).toBe(true);

    sel.seleccionarColumna(2);
    expect(sel.cubreTodasLasFilas()).toBe(true);

    // Un arrastre de la primera a la última fila cuenta igual: son columnas completas.
    sel.iniciarEn(9, 1);
    sel.arrastrarHasta(0, 3);
    expect(sel.cubreTodasLasFilas()).toBe(true);
  });

  it('un trozo suelto de celdas no cubre las columnas enteras', () => {
    sel.iniciarEn(1, 1);
    sel.arrastrarHasta(3, 2);
    expect(sel.cubreTodasLasFilas()).toBe(false);

    sel.seleccionarFila(4);
    expect(sel.cubreTodasLasFilas()).toBe(false);
  });

  it('sin selección no cubre nada', () => {
    expect(sel.cubreTodasLasFilas()).toBe(false);
  });

  it('no selecciona nada sobre una rejilla vacía', () => {
    const vacia = new GridSelection();
    vacia.redimensionar(0, 0);
    vacia.seleccionarTodo();
    vacia.seleccionarFila(0);
    vacia.seleccionarColumna(0);
    expect(vacia.hayseleccion).toBe(false);
  });
});

describe('aTsv', () => {
  it('separa celdas por tabulador y filas por salto de línea', () => {
    expect(aTsv([['a', 'b'], ['c', 'd']])).toBe('a\tb\nc\td');
  });

  it('entrecomilla los valores que romperían la rejilla al pegar', () => {
    expect(aTsv([['con\ttab']])).toBe('"con\ttab"');
    expect(aTsv([['con\nsalto']])).toBe('"con\nsalto"');
  });

  it('duplica las comillas internas, como hacen las hojas de cálculo', () => {
    expect(aTsv([['dijo "hola"']])).toBe('"dijo ""hola"""');
  });

  it('deja intactos los valores normales', () => {
    expect(aTsv([['Tagcat', '11/10/2025', '$1.300.000']]))
      .toBe('Tagcat\t11/10/2025\t$1.300.000');
  });
});
