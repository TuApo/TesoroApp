/**
 * Mejora automática de fotos de producto, hecha en el navegador antes de subirlas.
 *
 * <p>No es IA generativa: es el revelado que haría a mano un editor — niveles por canal
 * (corrige luz y balance de blancos), un poco de color y nitidez — y, si se pide, limpiar
 * el fondo claro y centrar el producto en un cuadro blanco como en las vitrinas. Corre
 * local, sin costo y sin mandar la foto a un tercero. Quitar fondos complejos (un producto
 * sobre una mesa con objetos) sí necesitaría un servicio de IA de imágenes.
 */
export interface OpcionesMejora {
  /** Niveles automáticos por canal: más luz, contraste y blancos neutros. */
  luzYColor: boolean;
  /** Máscara de enfoque suave. */
  nitidez: boolean;
  /** Pasa a blanco el fondo claro y liso que toca los bordes. */
  limpiarFondo: boolean;
  /** Recorta al producto y lo centra en un cuadro blanco con margen. */
  cuadroBlanco: boolean;
}

export const MEJORA_POR_DEFECTO: OpcionesMejora = { luzYColor: true, nitidez: true, limpiarFondo: false, cuadroBlanco: false };

const LADO = 1600;

export async function mejorarFoto(archivo: Blob, op: OpcionesMejora = MEJORA_POR_DEFECTO): Promise<Blob> {
  const bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const escala = Math.min(1, LADO / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * escala));
  const h = Math.max(1, Math.round(bmp.height * escala));
  const c = lienzo(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  let img = ctx.getImageData(0, 0, w, h);
  if (op.luzYColor) niveles(img.data);
  if (op.nitidez) img = enfocar(img, c, ctx);
  let fondo: Uint8Array | null = null;
  if (op.limpiarFondo || op.cuadroBlanco) fondo = mascaraFondo(img);
  if (op.limpiarFondo && fondo) blanquear(img, fondo);
  ctx.putImageData(img, 0, 0);

  let salida = c;
  if (op.cuadroBlanco) salida = encuadrar(c, fondo, w, h);
  return await new Promise<Blob>((ok, mal) => salida.toBlob(b => b ? ok(b) : mal(new Error('sin imagen')), 'image/jpeg', 0.9));
}

function lienzo(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Estira cada canal entre sus percentiles 0,5 y 99,5. Mezcla con el estiramiento por
 * luminancia para no inventar dominantes en fotos de un solo color (una caja roja).
 */
function niveles(d: Uint8ClampedArray): void {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const n = d.length / 4;
  let sumaL = 0;
  for (let i = 0; i < d.length; i += 4) {
    hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++;
    const l = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8;
    hist[3][l]++; sumaL += l;
  }
  const corte = (hs: Uint32Array, p: number) => { let a = 0; const meta = n * p; for (let v = 0; v < 256; v++) { a += hs[v]; if (a >= meta) return v; } return 255; };
  const lBajo = corte(hist[3], 0.005), lAlto = corte(hist[3], 0.995);
  const luts: Uint8ClampedArray[] = [];
  // Si la foto está oscura, sube los medios con un gamma suave.
  const media = sumaL / n / 255;
  const gamma = media < 0.42 ? 0.82 : media < 0.5 ? 0.92 : 1;
  for (let k = 0; k < 3; k++) {
    let bajo = corte(hist[k], 0.005), alto = corte(hist[k], 0.995);
    bajo = Math.round(bajo * 0.6 + lBajo * 0.4);
    alto = Math.round(alto * 0.6 + lAlto * 0.4);
    if (alto - bajo < 40) { bajo = Math.max(0, bajo - 20); alto = Math.min(255, alto + 20); }
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const t = Math.min(1, Math.max(0, (v - bajo) / (alto - bajo)));
      lut[v] = Math.round(255 * Math.pow(t, gamma));
    }
    luts.push(lut);
  }
  for (let i = 0; i < d.length; i += 4) {
    let r = luts[0][d[i]], g = luts[1][d[i + 1]], b = luts[2][d[i + 2]];
    // Un toque de saturación (×1,1) alrededor de la luminancia.
    const l = (r * 54 + g * 183 + b * 19) >> 8;
    r = l + (r - l) * 1.1; g = l + (g - l) * 1.1; b = l + (b - l) * 1.1;
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
}

/** Máscara de enfoque: original + 0,55 × (original − desenfocado). */
function enfocar(img: ImageData, c: HTMLCanvasElement, ctx: CanvasRenderingContext2D): ImageData {
  ctx.putImageData(img, 0, 0);
  const b = lienzo(c.width, c.height);
  const bctx = b.getContext('2d', { willReadFrequently: true })!;
  bctx.filter = 'blur(1.2px)';
  bctx.drawImage(c, 0, 0);
  const bd = bctx.getImageData(0, 0, c.width, c.height).data;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const o = d[i + k];
      const dif = o - bd[i + k];
      if (dif > 3 || dif < -3) d[i + k] = o + dif * 0.55;
    }
  }
  return img;
}

/**
 * Fondo = píxeles claros y parecidos al color del borde, conectados con el borde (relleno
 * por inundación). Un producto blanco sobre fondo blanco se queda: no toca el borde por
 * dentro de su contorno.
 */
function mascaraFondo(img: ImageData): Uint8Array | null {
  const { width: w, height: h, data: d } = img;
  // Color de referencia: mediana del borde.
  const borde: number[][] = [];
  const paso = Math.max(1, Math.floor((w + h) / 400));
  for (let x = 0; x < w; x += paso) { borde.push(px(d, w, x, 0)); borde.push(px(d, w, x, h - 1)); }
  for (let y = 0; y < h; y += paso) { borde.push(px(d, w, 0, y)); borde.push(px(d, w, w - 1, y)); }
  const med = [0, 1, 2].map(k => borde.map(p => p[k]).sort((a, b) => a - b)[borde.length >> 1]);
  const lumMed = (med[0] * 54 + med[1] * 183 + med[2] * 19) >> 8;
  // Solo fondos claros y razonablemente uniformes: si el borde es variado, no se toca.
  const disperso = borde.filter(p => dist(p, med) > 40).length / borde.length;
  if (lumMed < 150 || disperso > 0.35) return null;

  const m = new Uint8Array(w * h);
  const cola = new Int32Array(w * h);
  let ini = 0, fin = 0;
  const umbral = 34;
  const empujar = (x: number, y: number) => {
    const i = y * w + x;
    if (m[i]) return;
    const o = i * 4;
    if (dist([d[o], d[o + 1], d[o + 2]], med) > umbral) return;
    m[i] = 1; cola[fin++] = i;
  };
  for (let x = 0; x < w; x++) { empujar(x, 0); empujar(x, h - 1); }
  for (let y = 0; y < h; y++) { empujar(0, y); empujar(w - 1, y); }
  while (ini < fin) {
    const i = cola[ini++]; const x = i % w, y = (i / w) | 0;
    if (x > 0) empujar(x - 1, y); if (x < w - 1) empujar(x + 1, y);
    if (y > 0) empujar(x, y - 1); if (y < h - 1) empujar(x, y + 1);
  }
  return m;
}

/** Fondo a blanco, con el borde del producto suavizado para que no quede recortado a tijera. */
function blanquear(img: ImageData, m: Uint8Array): void {
  const { width: w, height: h, data: d } = img;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let vecinos = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx]) vecinos++;
      }
      if (!vecinos) continue;
      const a = m[i] ? 1 : vecinos / 9 * 0.6;
      const o = i * 4;
      d[o] += (255 - d[o]) * a; d[o + 1] += (255 - d[o + 1]) * a; d[o + 2] += (255 - d[o + 2]) * a;
    }
  }
}

/** Recorta a la caja del producto y la centra en un cuadro blanco con 8 % de margen. */
function encuadrar(c: HTMLCanvasElement, m: Uint8Array | null, w: number, h: number): HTMLCanvasElement {
  let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
  if (m) {
    x0 = w; y0 = h; x1 = -1; y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    // Si no se encontró producto o es casi toda la foto, se usa la foto entera.
    if (x1 < 0 || (x1 - x0) * (y1 - y0) < w * h * 0.02) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
  }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const lado = Math.min(LADO, Math.round(Math.max(cw, ch) / 0.84));
  const s = lienzo(lado, lado);
  const sctx = s.getContext('2d')!;
  sctx.fillStyle = '#fff';
  sctx.fillRect(0, 0, lado, lado);
  const k = Math.min((lado * 0.84) / cw, (lado * 0.84) / ch);
  const dw = cw * k, dh = ch * k;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(c, x0, y0, cw, ch, (lado - dw) / 2, (lado - dh) / 2, dw, dh);
  return s;
}

function px(d: Uint8ClampedArray, w: number, x: number, y: number): number[] {
  const o = (y * w + x) * 4;
  return [d[o], d[o + 1], d[o + 2]];
}

function dist(a: number[], b: number[]): number {
  const r = a[0] - b[0], g = a[1] - b[1], bl = a[2] - b[2];
  return Math.sqrt(r * r * 0.3 + g * g * 0.59 + bl * bl * 0.11) * 1.7;
}
