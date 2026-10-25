/**
 * Cómo se voltea la hoja para que el REVERSO caiga justo detrás del frente.
 *
 * Todos los carnets salen en dos páginas: una de frentes y otra de reversos.
 * Para que al recortar la tarjeta el reverso quede parejo, la página de
 * reversos tiene que dibujarse "al revés" de la misma forma en que la hoja se
 * va a voltear. Solo hay DOS formas físicas de voltear una hoja:
 *
 *   izq-der       la hoja gira sobre su eje VERTICAL (como pasar la hoja de un
 *                 libro). El reverso se dibuja con las columnas espejadas.
 *   arriba-abajo  la hoja gira sobre su eje HORIZONTAL (como un calendario de
 *                 pared). El reverso es la misma cara anterior GIRADA 180°.
 *
 * Cualquier otra manera de meter la hoja (de una impresora automática o a mano)
 * termina siendo una de esas dos, así que con estas dos opciones se cubre tanto
 * la doble cara automática como imprimir una cara, voltear a mano y volver a
 * pasar la hoja.
 *
 * OJO con el nombre que usa la impresora: "lado corto" / "lado largo" se
 * refieren al borde FÍSICO de la hoja, así que el mismo volteo se llama distinto
 * según la orientación del PDF —el carnet de Apoyo es horizontal y el de Tu
 * Alianza vertical—. Eso está en `VOLTEO_EN_IMPRESORA` y es la causa típica de
 * que un formato salga bien y el otro corrido con la misma configuración.
 *
 * El giro de 180° se aplica a la página completa con una matriz `cm` de PDF, no
 * recolocando cada elemento: así los dos volteos producen EXACTAMENTE la misma
 * tarjeta física (el reverso se lee al derecho volteando la tarjeta de izquierda
 * a derecha), y el código de dibujo no se entera.
 */
import jsPDF from 'jspdf';

/** Eje sobre el que se voltea la hoja. */
export type VolteoHoja = 'izq-der' | 'arriba-abajo';

/** Formato de carnet; cada uno usa una orientación de hoja distinta. */
export type FormatoCarnet = 'apoyo' | 'alianza';

export interface ConfigImpresionCarnet {
  volteo: VolteoHoja;
  /**
   * Corrimiento fino del reverso en mm, para impresoras cuya doble cara no
   * registra exacto. Se lee tal como se ve la cara del reverso ya volteada:
   * positivo = mover a la derecha / hacia abajo.
   */
  ajusteX: number;
  ajusteY: number;
}

/** Lo de siempre: volteo como libro y sin corrimiento. */
export const IMPRESION_POR_DEFECTO: Readonly<ConfigImpresionCarnet> = Object.freeze({
  volteo: 'izq-der' as VolteoHoja,
  ajusteX: 0,
  ajusteY: 0,
});

/** Orientación de la hoja de cada formato (define cómo lo llama la impresora). */
export const ORIENTACION_CARNET: Record<FormatoCarnet, 'horizontal' | 'vertical'> = {
  apoyo: 'horizontal',    // carta horizontal: 3 carnets CR80 de 85,6 mm no caben vertical
  alianza: 'vertical',    // carta vertical
};

/**
 * Cómo se llama cada volteo en el driver de la impresora. El mismo giro cambia
 * de nombre según la orientación de la hoja, porque "lado largo" y "lado corto"
 * hablan del borde del papel, no del contenido.
 */
export const VOLTEO_EN_IMPRESORA: Record<'horizontal' | 'vertical', Record<VolteoHoja, string>> = {
  horizontal: { 'izq-der': 'lado corto', 'arriba-abajo': 'lado largo' },
  vertical: { 'izq-der': 'lado largo', 'arriba-abajo': 'lado corto' },
};

/** Qué hace el operador con la hoja, en cristiano. */
export const VOLTEO_A_MANO: Record<VolteoHoja, string> = {
  'izq-der': 'voltéala de izquierda a derecha, como la hoja de un libro',
  'arriba-abajo': 'voltéala de arriba a abajo, como un calendario de pared',
};

const CLAVE = 'carnet.impresion';

/** Tope del ajuste fino: más de esto ya no es registro, es otro problema. */
const AJUSTE_MAX_MM = 10;

const numero = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.round(n * 10) / 10, -AJUSTE_MAX_MM), AJUSTE_MAX_MM);
};

/** Rellena y acota lo que venga de afuera (localStorage, un caller viejo, etc.). */
export function normalizarImpresion(
  cfg?: Partial<ConfigImpresionCarnet> | null,
): ConfigImpresionCarnet {
  return {
    volteo: cfg?.volteo === 'arriba-abajo' ? 'arriba-abajo' : 'izq-der',
    ajusteX: numero(cfg?.ajusteX),
    ajusteY: numero(cfg?.ajusteY),
  };
}

/**
 * Preferencia guardada. Va en `localStorage` porque es un dato de LA IMPRESORA
 * de ese puesto, no del candidato ni del proceso: cada equipo la ajusta una vez
 * y no se vuelve a tocar.
 */
export function leerImpresion(): ConfigImpresionCarnet {
  try {
    const crudo = localStorage.getItem(CLAVE);
    return normalizarImpresion(crudo ? JSON.parse(crudo) : null);
  } catch {
    return normalizarImpresion(null);
  }
}

export function guardarImpresion(cfg: ConfigImpresionCarnet): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(normalizarImpresion(cfg)));
  } catch {
    /* sin localStorage (modo privado): se pierde la preferencia, no es crítico */
  }
}

const MM_A_PT = 72 / 25.4;

/**
 * Dibuja la cara de REVERSOS aplicándole el volteo y el ajuste fino.
 *
 * `dibujar` siempre pinta igual —con las columnas espejadas, que es lo que pide
 * el volteo de izquierda a derecha—; acá se le agrega el giro de 180° cuando la
 * hoja se voltea de arriba a abajo. Girar la página completa equivale
 * exactamente a espejar las FILAS y dejar la tarjeta al derecho, que es lo que
 * se necesita.
 *
 * La matriz se escribe directo al PDF (`q … cm … Q`) sobre el flujo de la página
 * actual, así que hay que llamar esto ANTES de dibujar nada en esa página.
 */
export function dibujarCaraReverso(
  doc: jsPDF, cfg: ConfigImpresionCarnet, dibujar: () => void,
): void {
  const c = normalizarImpresion(cfg);
  const girar = c.volteo === 'arriba-abajo';
  if (!girar && !c.ajusteX && !c.ajusteY) { dibujar(); return; }

  const interno = doc.internal as unknown as {
    write: (...partes: string[]) => void; scaleFactor: number;
  };
  const k = interno.scaleFactor || 1;                       // unidades del doc → pt
  const W = doc.internal.pageSize.getWidth() * k;
  const H = doc.internal.pageSize.getHeight() * k;
  const ax = c.ajusteX * MM_A_PT;
  const ay = c.ajusteY * MM_A_PT;
  const n = (v: number) => v.toFixed(3);

  // Espacio PDF: origen abajo-izquierda y la Y crece hacia arriba, por eso el
  // ajuste vertical va con el signo cambiado.
  const matriz = girar
    ? `-1 0 0 -1 ${n(W + ax)} ${n(H - ay)}`
    : `1 0 0 1 ${n(ax)} ${n(-ay)}`;

  interno.write('q', `${matriz} cm`);
  try {
    dibujar();
  } finally {
    interno.write('Q');
  }
}

// ───────── Carnets por hoja ─────────

/** Lo que cabe en la grilla de 3x3 de los dos formatos: más se desborda. */
export const CARNETS_POR_HOJA_MAX = 9;

const CLAVE_POR_HOJA = 'carnet.impresion.por_hoja';

/**
 * Cuántos carnets van en cada hoja del lote, acotado a 1..`max`. Lo que no sea
 * un entero válido vuelve al máximo (la hoja llena, que es lo de siempre).
 */
export function normalizarPorHoja(n: unknown, max = CARNETS_POR_HOJA_MAX): number {
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v) || v < 1) return max;
  return Math.min(v, max);
}

/** Preferencia del puesto, igual que el volteo: se elige una vez y se recuerda. */
export function leerPorHoja(): number {
  try {
    const crudo = localStorage.getItem(CLAVE_POR_HOJA);
    return normalizarPorHoja(crudo === null ? null : Number(crudo));
  } catch {
    return CARNETS_POR_HOJA_MAX;
  }
}

export function guardarPorHoja(n: number): void {
  try {
    localStorage.setItem(CLAVE_POR_HOJA, String(normalizarPorHoja(n)));
  } catch {
    /* sin localStorage (modo privado): se pierde la preferencia, no es crítico */
  }
}
