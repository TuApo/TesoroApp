/**
 * Códigos de barras en SVG, sin librerías: EAN-13 (supermercado) y Code 128 (cualquier texto).
 * Sirven para imprimir etiquetas de góndola y stickers que el lector de la caja reconoce.
 */

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARIDAD = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function digitoEan13(doce: string): number {
  let suma = 0;
  for (let i = 0; i < 12; i++) suma += Number(doce[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (suma % 10)) % 10;
}

export function esEan13(codigo: string): boolean {
  return /^\d{13}$/.test(codigo) && digitoEan13(codigo.slice(0, 12)) === Number(codigo[12]);
}

function bitsEan13(c: string): string {
  const p = PARIDAD[Number(c[0])];
  let b = '101';
  for (let i = 1; i <= 6; i++) b += (p[i - 1] === 'L' ? EAN_L : EAN_G)[Number(c[i])];
  b += '01010';
  for (let i = 7; i <= 12; i++) b += EAN_R[Number(c[i])];
  return b + '101';
}

// Code 128: patrones de 0 a 106 (anchos de barra/espacio).
const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];

function bitsCode128(texto: string): string {
  const valores = [104]; // Start B
  for (const ch of texto) {
    const v = ch.charCodeAt(0) - 32;
    valores.push(v >= 0 && v < 95 ? v : 0);
  }
  let chk = valores[0];
  for (let i = 1; i < valores.length; i++) chk += valores[i] * i;
  valores.push(chk % 103, 106);
  let bits = '';
  for (const v of valores) {
    const pat = C128[v];
    for (let i = 0; i < pat.length; i++) bits += (i % 2 === 0 ? '1' : '0').repeat(Number(pat[i]));
  }
  return bits;
}

/**
 * SVG del código: EAN-13 si el código lo es (con dígito válido), si no Code 128.
 * `alto` en unidades de módulo; el SVG escala al ancho que le dé la etiqueta.
 */
export function svgCodigoBarras(codigo: string, opciones: { alto?: number; texto?: boolean } = {}): string {
  const ean = esEan13(codigo);
  const bits = ean ? bitsEan13(codigo) : bitsCode128(codigo);
  const alto = opciones.alto ?? 50;
  const margen = 10;
  const ancho = bits.length + margen * 2;
  const conTexto = opciones.texto !== false;
  let rects = '';
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue;
    let j = i;
    while (j < bits.length && bits[j] === '1') j++;
    const guarda = ean && (i < 3 || (i >= 45 && i < 50) || i >= 92);
    rects += `<rect x="${i + margen}" y="0" width="${j - i}" height="${alto + (guarda && conTexto ? 6 : 0)}"/>`;
    i = j - 1;
  }
  const altoTotal = alto + (conTexto ? 14 : 0);
  const texto = conTexto
    ? `<text x="${ancho / 2}" y="${alto + 12}" text-anchor="middle" font-family="monospace" font-size="11">${escapar(codigo)}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${altoTotal}" preserveAspectRatio="none"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g>${texto}</svg>`;
}

function escapar(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
