/**
 * FOTO TIPO DOCUMENTO — la parte que no necesita navegador.
 *
 * Recorte 3:4 alrededor de la cara, medidas de calidad (luz y nitidez) y la
 * composición de la persona sobre fondo blanco. Todo son cuentas sobre
 * arreglos de píxeles: aquí no hay canvas, ni MediaPipe, ni red, y por eso se
 * prueba entero en `foto-documento.util.spec.ts`.
 *
 * Quien pinta y lee los canvas es `FotoDocumentoService`; quien segmenta es
 * `FondoBlancoService`.
 */

/** Tamaño de la foto que se guarda: 3:4, JPEG. */
export const FOTO_ANCHO = 600;
export const FOTO_ALTO = 800;

/**
 * Qué parte del alto de la foto ocupa la cara. La "cara" es la caja de la malla
 * de MediaPipe, que va de la frente a la barbilla (no incluye el pelo): con un
 * 57 % la cabeza entera queda holgada y se ve el inicio de los hombros, que es
 * como se toma una foto 3×4.
 */
export const CARA_SOBRE_ALTO = 0.57;
/** Altura de los ojos medida desde arriba, en fracción del alto de la foto. */
export const OJOS_DESDE_ARRIBA = 0.40;
/**
 * Sin la altura de los ojos: dónde va el centro de la caja de la cara. Sale de
 * la regla anterior (los ojos caen a ~42 % de la caja, empezando por arriba).
 */
export const CENTRO_CARA_DESDE_ARRIBA = 0.445;

/** Caja de la cara en coordenadas NORMALIZADAS (0..1) de la imagen. */
export interface CajaRostro {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Altura media de los ojos (0..1), si el detector la dio. */
  ojosY?: number | null;
}

/** Rectángulo en píxeles de la imagen de origen. */
export interface Rect {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

const acotar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * La caja vista en el espejo. El fotograma que se guarda puede ir volteado
 * (ver `isMirror` en el diálogo) y la lectura del detector viene del fotograma
 * crudo: sin esto el recorte se centraría en el lado equivocado.
 */
export function espejarCaja(c: CajaRostro): CajaRostro {
  return { ...c, minX: 1 - c.maxX, maxX: 1 - c.minX };
}

/** El 3:4 más grande que cabe, centrado. Es el recorte cuando no hay detector. */
export function recorteCentrado34(anchoImg: number, altoImg: number): Rect {
  let alto = altoImg;
  let ancho = (alto * 3) / 4;
  if (ancho > anchoImg) {
    ancho = anchoImg;
    alto = (ancho * 4) / 3;
  }
  return redondear({ x: (anchoImg - ancho) / 2, y: (altoImg - alto) / 2, ancho, alto }, anchoImg, altoImg);
}

/**
 * Recorte 3:4 con la cara al ~57 % del alto y los ojos al ~40 % desde arriba.
 *
 * Si el recorte ideal se sale de la imagen se DESPLAZA hacia dentro (la cara
 * queda un poco descentrada, pero sin franjas inventadas); si ni así cabe —cara
 * muy cerca— se ENCOGE al 3:4 más grande posible y la cara sale más grande.
 * Es preferible a rellenar con blanco: con el fondo sin quitar, una franja
 * blanca pegada a una pared de color se ve peor que una cara algo grande.
 */
export function calcularRecorte34(caja: CajaRostro, anchoImg: number, altoImg: number): Rect {
  const altoCara = (caja.maxY - caja.minY) * altoImg;
  if (!(altoCara > 0) || !(anchoImg > 0) || !(altoImg > 0)) return recorteCentrado34(anchoImg, altoImg);

  let alto = altoCara / CARA_SOBRE_ALTO;
  let ancho = (alto * 3) / 4;
  if (alto > altoImg) {
    alto = altoImg;
    ancho = (alto * 3) / 4;
  }
  if (ancho > anchoImg) {
    ancho = anchoImg;
    alto = (ancho * 4) / 3;
  }

  const centroX = ((caja.minX + caja.maxX) / 2) * anchoImg;
  const y = caja.ojosY != null && caja.ojosY > caja.minY && caja.ojosY < caja.maxY
    ? caja.ojosY * altoImg - OJOS_DESDE_ARRIBA * alto
    : ((caja.minY + caja.maxY) / 2) * altoImg - CENTRO_CARA_DESDE_ARRIBA * alto;

  return redondear({
    x: acotar(centroX - ancho / 2, 0, anchoImg - ancho),
    y: acotar(y, 0, altoImg - alto),
    ancho,
    alto,
  }, anchoImg, altoImg);
}

/**
 * Enteros, 3:4 EXACTO (3k × 4k) y dentro de la imagen. `drawImage` con un
 * origen que se sale de la imagen lo recorta por su cuenta y deja una franja
 * negra en el JPEG; con fracciones interpola el borde y deja una línea gris.
 */
function redondear(r: Rect, anchoImg: number, altoImg: number): Rect {
  const k = Math.max(1, Math.floor(Math.min(r.ancho / 3, r.alto / 4, anchoImg / 3, altoImg / 4)));
  const ancho = 3 * k;
  const alto = 4 * k;
  return {
    x: acotar(Math.round(r.x + (r.ancho - ancho) / 2), 0, Math.max(0, anchoImg - ancho)),
    y: acotar(Math.round(r.y + (r.alto - alto) / 2), 0, Math.max(0, altoImg - alto)),
    ancho,
    alto,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// CALIDAD: luz y nitidez
// ══════════════════════════════════════════════════════════════════════════

export type AvisoCalidad = 'poca-luz' | 'mucha-luz' | 'movida' | 'baja-resolucion';

/** Lo que se le dice a la persona. Corto: va en un chip. */
export const TEXTO_AVISO: Record<AvisoCalidad, string> = {
  'poca-luz': 'Poca luz',
  'mucha-luz': 'Demasiada luz',
  'movida': 'Salió movida',
  'baja-resolucion': 'Se ve pequeña: acércate más',
};

/** Luz media de la cara (0..255) por debajo de la cual la foto sale oscura. */
export const BRILLO_MIN = 75;
/** Por encima, la cara sale quemada. */
export const BRILLO_MAX = 215;
/**
 * Varianza del laplaciano (medida sobre la foto reducida a 300×400) por debajo
 * de la cual se da por movida. Conservador a propósito: la cara tiene poca
 * textura y la cámara de un portátil mete ruido; esto solo avisa, quien decide
 * es la IA.
 */
export const NITIDEZ_MIN = 18;
/**
 * Alto mínimo del recorte en píxeles del fotograma. Por debajo, la foto de
 * 600×800 sale de ampliar muy poca información y se ve borrosa.
 */
export const RECORTE_ALTO_MIN = 320;

export interface Calidad {
  /** Luz media de la zona de la cara, 0..255. */
  brillo: number;
  /** Varianza del laplaciano en la zona de la cara. Más alto = más nítida. */
  nitidez: number;
  avisos: AvisoCalidad[];
}

/** Luminancia (Rec. 601) de cada píxel de un RGBA. */
export function luminancias(rgba: ArrayLike<number>, ancho: number, alto: number): Float32Array {
  const n = ancho * alto;
  const out = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return out;
}

/**
 * La zona donde está la cara en una foto 3:4 ya recortada: el centro, sin los
 * bordes. Medir la foto entera mezclaría el fondo (que pronto será blanco) y
 * falsearía tanto la luz como la nitidez.
 */
export function zonaCara(ancho: number, alto: number): Rect {
  return {
    x: Math.round(ancho * 0.2),
    y: Math.round(alto * 0.12),
    ancho: Math.round(ancho * 0.6),
    alto: Math.round(alto * 0.62),
  };
}

export function brilloMedio(lum: Float32Array, ancho: number, alto: number, zona?: Rect): number {
  const z = zona ?? { x: 0, y: 0, ancho, alto };
  let suma = 0;
  let n = 0;
  for (let y = z.y; y < z.y + z.alto && y < alto; y++) {
    for (let x = z.x; x < z.x + z.ancho && x < ancho; x++) {
      suma += lum[y * ancho + x];
      n++;
    }
  }
  return n ? suma / n : 0;
}

/**
 * Varianza del laplaciano (núcleo de 4 vecinos), la medida clásica de foco:
 * una foto movida no tiene bordes y el laplaciano se queda cerca de cero en
 * todas partes. Sin OpenCV: son cinco lecturas por píxel.
 */
export function varianzaLaplaciano(lum: Float32Array, ancho: number, alto: number, zona?: Rect): number {
  const z = zona ?? { x: 0, y: 0, ancho, alto };
  const x0 = Math.max(1, z.x);
  const y0 = Math.max(1, z.y);
  const x1 = Math.min(ancho - 1, z.x + z.ancho);
  const y1 = Math.min(alto - 1, z.y + z.alto);
  let suma = 0;
  let suma2 = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const fila = y * ancho;
    for (let x = x0; x < x1; x++) {
      const i = fila + x;
      const l = 4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - ancho] - lum[i + ancho];
      suma += l;
      suma2 += l * l;
      n++;
    }
  }
  if (!n) return 0;
  const media = suma / n;
  // max(0, …): en una imagen plana el redondeo puede dejar un -1e-30.
  return Math.max(0, suma2 / n - media * media);
}

/**
 * Luz y nitidez de una foto ya recortada (idealmente reducida a 300×400, que
 * es la escala a la que están calibrados los umbrales). `altoRecorte` es el
 * alto, en píxeles del fotograma original, del recorte del que salió.
 */
export function medirCalidad(
  rgba: ArrayLike<number>,
  ancho: number,
  alto: number,
  altoRecorte?: number,
): Calidad {
  const lum = luminancias(rgba, ancho, alto);
  const zona = zonaCara(ancho, alto);
  const brillo = brilloMedio(lum, ancho, alto, zona);
  const nitidez = varianzaLaplaciano(lum, ancho, alto, zona);

  const avisos: AvisoCalidad[] = [];
  if (brillo < BRILLO_MIN) avisos.push('poca-luz');
  else if (brillo > BRILLO_MAX) avisos.push('mucha-luz');
  if (nitidez < NITIDEZ_MIN) avisos.push('movida');
  if (altoRecorte != null && altoRecorte < RECORTE_ALTO_MIN) avisos.push('baja-resolucion');

  return { brillo: Math.round(brillo), nitidez: Math.round(nitidez * 10) / 10, avisos };
}

// ══════════════════════════════════════════════════════════════════════════
// FONDO BLANCO
// ══════════════════════════════════════════════════════════════════════════

/**
 * Remuestreo bilineal de una máscara. El segmentador puede devolverla a su
 * propia resolución (256×256) y hay que llevarla a la de la foto.
 */
export function redimensionarMascara(
  m: ArrayLike<number>, mAncho: number, mAlto: number, ancho: number, alto: number,
): Float32Array {
  const out = new Float32Array(ancho * alto);
  if (mAncho === ancho && mAlto === alto) {
    for (let i = 0; i < out.length; i++) out[i] = m[i];
    return out;
  }
  const ex = mAncho / ancho;
  const ey = mAlto / alto;
  for (let y = 0; y < alto; y++) {
    const fy = Math.min(mAlto - 1, Math.max(0, (y + 0.5) * ey - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(mAlto - 1, y0 + 1);
    const dy = fy - y0;
    for (let x = 0; x < ancho; x++) {
      const fx = Math.min(mAncho - 1, Math.max(0, (x + 0.5) * ex - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(mAncho - 1, x0 + 1);
      const dx = fx - x0;
      const a = m[y0 * mAncho + x0] * (1 - dx) + m[y0 * mAncho + x1] * dx;
      const b = m[y1 * mAncho + x0] * (1 - dx) + m[y1 * mAncho + x1] * dx;
      out[y * ancho + x] = a * (1 - dy) + b * dy;
    }
  }
  return out;
}

/**
 * Probabilidad → opacidad, con una rampa suave entre `bajo` y `alto`. Un corte
 * en seco al 50 % deja un borde dentado; la rampa conserva la duda del modelo
 * justo donde la tiene: en el pelo.
 */
export function alfaDesdeProbabilidad(p: number, bajo = 0.3, alto = 0.7): number {
  if (p <= bajo) return 0;
  if (p >= alto) return 1;
  const t = (p - bajo) / (alto - bajo);
  return t * t * (3 - 2 * t);
}

/** Desenfoque de caja separable (horizontal y vertical): el "feather" del borde. */
export function suavizarMascara(m: Float32Array, ancho: number, alto: number, radio: number): Float32Array {
  if (radio < 1) return m;
  const tmp = new Float32Array(m.length);
  const out = new Float32Array(m.length);
  for (let y = 0; y < alto; y++) {
    const fila = y * ancho;
    for (let x = 0; x < ancho; x++) {
      let s = 0;
      let n = 0;
      for (let k = -radio; k <= radio; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= ancho) continue;
        s += m[fila + xx];
        n++;
      }
      tmp[fila + x] = s / n;
    }
  }
  for (let x = 0; x < ancho; x++) {
    for (let y = 0; y < alto; y++) {
      let s = 0;
      let n = 0;
      for (let k = -radio; k <= radio; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= alto) continue;
        s += tmp[yy * ancho + x];
        n++;
      }
      out[y * ancho + x] = s / n;
    }
  }
  return out;
}

/** Fracción de la foto que el segmentador ve como persona (p > 0,5). */
export function fraccionPersona(prob: ArrayLike<number>): number {
  if (!prob.length) return 0;
  let n = 0;
  for (let i = 0; i < prob.length; i++) if (prob[i] > 0.5) n++;
  return n / prob.length;
}

/**
 * ¿La máscara es creíble para una foto 3×4? Una persona encuadrada ocupa entre
 * un cuarto y casi toda la foto. Fuera de eso el modelo no encontró a nadie (o
 * lo tomó todo por persona) y poner "fondo blanco" borraría a la persona o no
 * haría nada: mejor dejar la foto como está y que lo juzgue la IA.
 */
export function mascaraCreible(prob: ArrayLike<number>): boolean {
  const f = fraccionPersona(prob);
  return f >= 0.12 && f <= 0.97;
}

/**
 * Pone a la persona sobre #FFFFFF: `salida = color · α + 255 · (1 − α)`, con α
 * la probabilidad de persona pasada por la rampa y desenfocada `radio`
 * píxeles para que el borde no quede recortado a tijera. Modifica `rgba` en
 * el sitio y lo devuelve.
 */
export function componerSobreBlanco(
  rgba: Uint8ClampedArray,
  probPersona: ArrayLike<number>,
  ancho: number,
  alto: number,
  radio = 2,
): Uint8ClampedArray {
  const n = ancho * alto;
  const alfa = new Float32Array(n);
  for (let i = 0; i < n; i++) alfa[i] = alfaDesdeProbabilidad(probPersona[i]);
  const suave = suavizarMascara(alfa, ancho, alto, radio);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const a = suave[i];
    const b = 255 * (1 - a);
    rgba[p] = rgba[p] * a + b;
    rgba[p + 1] = rgba[p + 1] * a + b;
    rgba[p + 2] = rgba[p + 2] * a + b;
    rgba[p + 3] = 255;
  }
  return rgba;
}
