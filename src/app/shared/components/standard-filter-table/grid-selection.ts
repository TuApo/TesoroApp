/**
 * Selección rectangular tipo hoja de cálculo para standard-filter-table.
 *
 * Vive fuera del componente porque éste ya ronda las 1.100 líneas y esto es una máquina de
 * estados completa con su propia semántica de teclado y portapapeles.
 *
 * MODELO: un único rectángulo (ancla → foco). Excel admite varios rangos con Ctrl, pero eso
 * multiplica el coste de "¿está seleccionada esta celda?" —que se evalúa por celda pintada,
 * en cada ciclo de detección— y no aporta a lo que se pidió: seleccionar un trozo, una fila
 * o una columna para copiar. Fila y columna completas son ese mismo rectángulo extendido a
 * todo el ancho o todo el alto, así que hay UN solo camino que mantener.
 *
 * COORDENADAS: índices sobre lo que se está VIENDO (filas de la página actual, columnas
 * visibles en su orden actual), no sobre el dataset. Copiar tiene que dar lo que el usuario
 * ve; si el índice fuera del dataset, ocultar una columna o reordenarla desalinearía la
 * selección de la pantalla.
 */

export type ModoSeleccion = 'celda' | 'fila' | 'columna';

export interface Celda {
  fila: number;
  col: number;
}

export interface RangoSeleccion {
  filaIni: number;
  filaFin: number;
  colIni: number;
  colFin: number;
}

export class GridSelection {
  /** Celda desde la que se extiende (la que no se mueve al arrastrar o al usar Shift). */
  private ancla: Celda | null = null;
  /** Celda que sigue al puntero/cursor. Es la que se pinta como "activa". */
  private foco: Celda | null = null;

  private _modo: ModoSeleccion = 'celda';
  /** true mientras el usuario arrastra con el botón pulsado. */
  private arrastrando = false;

  /** Dimensiones de la rejilla visible; las fija el componente en cada render. */
  private filas = 0;
  private cols = 0;

  get modo(): ModoSeleccion { return this._modo; }
  get hayseleccion(): boolean { return this.ancla !== null && this.foco !== null; }
  get celdaActiva(): Celda | null { return this.foco; }

  /**
   * Actualiza el tamaño de la rejilla. Si encoge (cambio de página, filtro que deja menos
   * filas, columna oculta), la selección se recorta en vez de quedar apuntando a celdas que
   * ya no existen — que es como se cuelan los "copié y salió vacío".
   */
  redimensionar(filas: number, cols: number): void {
    this.filas = Math.max(0, filas);
    this.cols = Math.max(0, cols);
    if (!this.hayseleccion) return;

    if (this.filas === 0 || this.cols === 0) { this.limpiar(); return; }

    this.ancla = this.acotar(this.ancla!);
    this.foco = this.acotar(this.foco!);
  }

  private acotar(c: Celda): Celda {
    return {
      fila: Math.min(Math.max(0, c.fila), this.filas - 1),
      col: Math.min(Math.max(0, c.col), this.cols - 1),
    };
  }

  limpiar(): void {
    this.ancla = null;
    this.foco = null;
    this.arrastrando = false;
    this._modo = 'celda';
  }

  // ── Gestos ────────────────────────────────────────────────────────────────

  /** Clic simple en una celda: empieza una selección nueva y abre un posible arrastre. */
  iniciarEn(fila: number, col: number, extender = false): void {
    if (extender && this.ancla) {
      this.foco = this.acotar({ fila, col });
    } else {
      this.ancla = this.acotar({ fila, col });
      this.foco = { ...this.ancla };
    }
    this._modo = 'celda';
    this.arrastrando = true;
  }

  /** Movimiento del puntero: sólo extiende si venimos de un clic sostenido. */
  arrastrarHasta(fila: number, col: number): void {
    if (!this.arrastrando || !this.ancla) return;
    this.foco = this.acotar({ fila, col });
  }

  terminarArrastre(): void {
    this.arrastrando = false;
  }

  /** Encabezado de fila (el número de la izquierda). Shift extiende el bloque de filas. */
  seleccionarFila(fila: number, extender = false): void {
    if (this.cols === 0) return;
    if (extender && this.ancla) {
      this.foco = { fila: this.acotar({ fila, col: 0 }).fila, col: this.cols - 1 };
    } else {
      this.ancla = { fila: this.acotar({ fila, col: 0 }).fila, col: 0 };
      this.foco = { fila: this.ancla.fila, col: this.cols - 1 };
    }
    this._modo = 'fila';
    this.arrastrando = false;
  }

  /** Encabezado de columna. Shift extiende el bloque de columnas. */
  seleccionarColumna(col: number, extender = false): void {
    if (this.filas === 0) return;
    if (extender && this.ancla) {
      this.foco = { fila: this.filas - 1, col: this.acotar({ fila: 0, col }).col };
    } else {
      this.ancla = { fila: 0, col: this.acotar({ fila: 0, col }).col };
      this.foco = { fila: this.filas - 1, col: this.ancla.col };
    }
    this._modo = 'columna';
    this.arrastrando = false;
  }

  seleccionarTodo(): void {
    if (this.filas === 0 || this.cols === 0) return;
    this.ancla = { fila: 0, col: 0 };
    this.foco = { fila: this.filas - 1, col: this.cols - 1 };
    this._modo = 'celda';
  }

  /**
   * Teclado. `extender` = Shift (crece el rango); sin él, la selección salta y se colapsa
   * a una celda, igual que en una hoja de cálculo.
   */
  mover(dFila: number, dCol: number, extender: boolean): void {
    if (!this.foco) {
      if (this.filas > 0 && this.cols > 0) this.iniciarEn(0, 0);
      this.arrastrando = false;
      return;
    }
    const destino = this.acotar({ fila: this.foco.fila + dFila, col: this.foco.col + dCol });
    this.foco = destino;
    if (!extender) this.ancla = { ...destino };
    this.arrastrando = false;
  }

  /** Ctrl+Inicio / Ctrl+Fin y equivalentes: salto al borde de la rejilla. */
  irABorde(borde: 'inicio' | 'fin', extender: boolean): void {
    if (this.filas === 0 || this.cols === 0) return;
    const destino: Celda = borde === 'inicio'
      ? { fila: 0, col: 0 }
      : { fila: this.filas - 1, col: this.cols - 1 };
    this.foco = destino;
    if (!extender) this.ancla = { ...destino };
  }

  // ── Consulta ──────────────────────────────────────────────────────────────

  /** Rectángulo normalizado (ancla y foco pueden venir en cualquier orden). */
  rango(): RangoSeleccion | null {
    if (!this.ancla || !this.foco) return null;
    return {
      filaIni: Math.min(this.ancla.fila, this.foco.fila),
      filaFin: Math.max(this.ancla.fila, this.foco.fila),
      colIni: Math.min(this.ancla.col, this.foco.col),
      colFin: Math.max(this.ancla.col, this.foco.col),
    };
  }

  /**
   * Se evalúa una vez por celda pintada, así que es aritmética pura: sin objetos nuevos,
   * sin recorrer listas. Con 50 filas × 20 columnas son 1.000 llamadas por ciclo.
   */
  estaSeleccionada(fila: number, col: number): boolean {
    if (!this.ancla || !this.foco) return false;
    const f1 = this.ancla.fila, f2 = this.foco.fila;
    const c1 = this.ancla.col, c2 = this.foco.col;
    return fila >= Math.min(f1, f2) && fila <= Math.max(f1, f2)
        && col >= Math.min(c1, c2) && col <= Math.max(c1, c2);
  }

  esCeldaActiva(fila: number, col: number): boolean {
    return !!this.foco && this.foco.fila === fila && this.foco.col === col;
  }

  /** Para resaltar el encabezado de una columna cuyo bloque está dentro del rango. */
  columnaEnRango(col: number): boolean {
    const r = this.rango();
    return !!r && col >= r.colIni && col <= r.colFin;
  }

  filaEnRango(fila: number): boolean {
    const r = this.rango();
    return !!r && fila >= r.filaIni && fila <= r.filaFin;
  }

  /**
   * El rango va de la primera a la última fila visible: es lo que producen "seleccionar
   * todo", el clic en el encabezado de una columna, o un arrastre que abarcó la tabla
   * entera. Copiar eso es copiar COLUMNAS, y una columna sin su encabezado no se entiende
   * al pegarla, así que el llamador antepone la fila de títulos cuando esto es cierto.
   */
  cubreTodasLasFilas(): boolean {
    const r = this.rango();
    return !!r && this.filas > 0 && r.filaIni === 0 && r.filaFin === this.filas - 1;
  }

  /** Cuántas celdas hay seleccionadas — para el contador de la barra. */
  conteo(): number {
    const r = this.rango();
    if (!r) return 0;
    return (r.filaFin - r.filaIni + 1) * (r.colFin - r.colIni + 1);
  }
}

/**
 * Convierte una matriz de textos al formato que entienden Excel, Google Sheets y Calc:
 * TSV (tabulador entre celdas, salto de línea entre filas).
 *
 * Un valor que contenga tabulador, salto de línea o comilla rompería la rejilla al pegar,
 * así que se entrecomilla y las comillas internas se duplican — la misma convención que
 * usan esas hojas de cálculo al leer.
 */
export function aTsv(matriz: string[][]): string {
  return matriz
    .map(fila => fila.map(escaparTsv).join('\t'))
    .join('\n');
}

function escaparTsv(valor: string): string {
  const v = valor ?? '';
  if (!/[\t\n\r"]/.test(v)) return v;
  return `"${v.replace(/"/g, '""')}"`;
}
