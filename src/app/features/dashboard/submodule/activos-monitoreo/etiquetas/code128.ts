/**
 * Codificador Code 128 (subconjunto B) a SVG, sin dependencias. Suficiente para códigos y placas
 * de activos (ASCII 32–126). Devuelve un `<svg>` como string para pintar en la etiqueta junto al QR.
 *
 * El QR lo dibuja la librería `qrcode`; el código de barras lo hace esto para no sumar otra dependencia.
 */

/** Las 107 tramas de anchos del estándar Code 128 (cada dígito = ancho de barra/espacio). */
const PATRONES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const INICIO_B = 104;
const STOP = 106;

export interface Code128Opts {
  /** Ancho de un módulo (la barra más fina), en px. */
  moduloPx?: number;
  /** Alto de las barras, en px. */
  altoPx?: number;
  color?: string;
}

/** Devuelve un SVG (string) con el Code 128-B del texto, o un SVG vacío si el texto no es imprimible. */
export function code128Svg(texto: string, opts: Code128Opts = {}): string {
  const moduloPx = opts.moduloPx ?? 1.6;
  const altoPx = opts.altoPx ?? 44;
  const color = opts.color ?? '#0f172a';
  const limpio = (texto ?? '').replace(/[^\x20-\x7E]/g, '');
  if (!limpio) return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="${altoPx}"></svg>`;

  const valores: number[] = [INICIO_B];
  for (const ch of limpio) valores.push(ch.charCodeAt(0) - 32);
  // Dígito de control: (inicio + Σ valor_k · k) mod 103, k desde 1 en el primer dato.
  let suma = INICIO_B;
  for (let k = 1; k < valores.length; k++) suma += valores[k] * k;
  valores.push(suma % 103);
  valores.push(STOP);

  // Cadena de módulos: por cada trama, alternar barra/espacio empezando por barra.
  let modulos = '';
  for (const v of valores) {
    const trama = PATRONES[v];
    for (let i = 0; i < trama.length; i++) {
      const ancho = Number(trama[i]);
      modulos += (i % 2 === 0 ? '1' : '0').repeat(ancho);
    }
  }

  const totalMod = modulos.length;
  const ancho = totalMod * moduloPx;
  let rects = '';
  let x = 0;
  let i = 0;
  while (i < totalMod) {
    if (modulos[i] === '1') {
      let j = i;
      while (j < totalMod && modulos[j] === '1') j++;
      const w = (j - i) * moduloPx;
      rects += `<rect x="${(x).toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${altoPx}" fill="${color}"/>`;
      x += w;
      i = j;
    } else {
      x += moduloPx;
      i++;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho.toFixed(2)} ${altoPx}" ` +
         `width="100%" height="${altoPx}" preserveAspectRatio="none" role="img" aria-label="código de barras ${limpio}">${rects}</svg>`;
}
