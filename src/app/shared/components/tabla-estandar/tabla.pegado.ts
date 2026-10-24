/**
 * Pegado masivo de la tabla estándar.
 *
 * El operador copia una columna de Excel (cédulas, códigos, números de
 * documento…) y la pega tal cual. Aquí se limpia esa basura y se casa contra
 * lo que la tabla ya tiene, para poder marcar esas filas y hacerles una acción
 * masiva. No se adivina QUÉ columna pegó: se prueba cada celda de la línea
 * contra el índice de la tabla y gana la que exista.
 */

/**
 * Deja la clave comparable: sin espacios, sin separadores de miles, sin el
 * `.0` que Excel añade a los números y en mayúsculas.
 */
export function normalizarClave(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  let t = String(valor).trim();
  if (!t) return '';
  t = t.replace(/^["']+|["']+$/g, '').trim();
  // 1.234.567 / 1,234,567 / 1234567.00 → 1234567
  if (/^-?[\d.,\s]+$/.test(t)) {
    const soloDigitos = t.replace(/[.,\s]/g, '');
    const conDecimalCero = /^-?[\d.,\s]+[.,]0+$/.test(t);
    t = conDecimalCero ? soloDigitos.replace(/0+$/, '') : soloDigitos;
  }
  return t.replace(/\s+/g, ' ').toUpperCase();
}

/** Una línea pegada: lo que escribió el operador y sus celdas ya limpias. */
export interface LineaPegada {
  entrada: string;
  celdas: string[];
}

/**
 * Parte el bloque pegado en líneas y celdas (tabulador o `;`). Se descartan
 * las líneas vacías; el resto se conserva aunque no case con nada, porque el
 * operador necesita ver qué NO se encontró.
 */
export function partirBloque(texto: string): LineaPegada[] {
  const lineas: LineaPegada[] = [];
  for (const cruda of texto.split(/\r?\n/)) {
    const entrada = cruda.trim();
    if (!entrada) continue;
    const celdas = entrada.split(/\t|;/).map((c) => normalizarClave(c)).filter(Boolean);
    if (!celdas.length) continue;
    lineas.push({ entrada, celdas });
  }
  return lineas;
}

/** Resultado de casar lo pegado contra el índice de la tabla. */
export interface ResultadoPegado {
  /** Claves que sí existen en la tabla, sin repetir. */
  encontradas: string[];
  /** Lo que el operador pegó y no está (tal como lo escribió). */
  noEncontradas: string[];
  /** Líneas repetidas dentro del propio pegado. */
  duplicadas: number;
  /** Líneas con contenido que se pudieron leer. */
  leidas: number;
  /** Columna de la tabla con la que se casó (la que más aciertos dio). */
  columna?: string;
}

/** Casa las líneas pegadas contra las claves que tiene la tabla. */
export function casarPegado(lineas: LineaPegada[], claves: Set<string>): ResultadoPegado {
  const encontradas: string[] = [];
  const noEncontradas: string[] = [];
  const vistas = new Set<string>();
  let duplicadas = 0;
  for (const linea of lineas) {
    const acierto = linea.celdas.find((c) => claves.has(c));
    const clave = acierto ?? linea.celdas[0];
    if (vistas.has(clave)) { duplicadas++; continue; }
    vistas.add(clave);
    if (acierto) encontradas.push(acierto);
    else noEncontradas.push(linea.entrada);
  }
  return { encontradas, noEncontradas, duplicadas, leidas: lineas.length };
}
