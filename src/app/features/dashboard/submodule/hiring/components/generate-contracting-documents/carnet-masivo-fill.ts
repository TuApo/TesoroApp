/**
 * Carnet con el MISMO diseño que la generación masiva del módulo Home
 * (`home.component.ts` → `generarCarnets`), pero para un solo candidato y con
 * los datos ya resueltos desde el proceso, sin pasar por un Excel.
 *
 * Home reparte 9 carnets por hoja CARTA VERTICAL en una grilla 3x3, con dos
 * páginas: frente y reverso. El reverso va espejado en columna (`2 - col`) para
 * que, al voltear la hoja de izquierda a derecha, cada reverso caiga detrás de
 * su frente. Como esta hoja es VERTICAL, ese volteo se llama "lado LARGO" en la
 * impresora —al contrario del carnet de Apoyo, que es horizontal—; el otro
 * volteo (de arriba a abajo) lo resuelve `dibujarCaraReverso` girando la página
 * de reversos 180°.
 *
 * Acá se reusa esa misma grilla: cuando se manda `posicion` (1..9) se dibuja
 * únicamente esa celda y las demás quedan en blanco, así se reaprovecha una
 * hoja ya recortada en vez de gastar una nueva por cada carnet.
 *
 * Las imágenes (logo, foto, QR) llegan ya resueltas como dataURL — igual que en
 * `carnet-apoyo-fill.ts` y `remision-fill.ts` — para que este módulo sea
 * síncrono y no dependa de la red.
 */
import jsPDF from 'jspdf';
import {
  ConfigImpresionCarnet,
  dibujarCaraReverso,
  normalizarImpresion,
  normalizarPorHoja,
} from './carnet-impresion';

/**
 * Datos fijos del carnet de Tu Alianza: son los que imprime la generación
 * masiva de Home. El de Apoyo tiene los suyos en `carnet-apoyo-fill.ts`.
 */
export const TELEFONO_COORDINADOR_ALIANZA = '3152306148';
export const ARL_ALIANZA = 'SURA';

/** Una fila = un carnet. Mismas llaves que arma Home desde el Excel. */
export interface CarnetMasivoRow {
  CEDULA: string;
  CODIGO: string;
  APELLIDOS: string;
  NOMBRES: string;
  FECHA_INGRESO: string;
  CENTRO_COSTO: string;
  FAMILIAR_EMERGENCIA_NOMBRE: string;
  FAMILIAR_EMERGENCIA_TELEFONO: string;
  /**
   * Teléfono del gestor del centro de costo de la vacante. Si viene, gana sobre
   * `opts.telefonoCoordinador` (el fijo de la temporal).
   */
  TELEFONO_COORDINADOR?: string | null;
  /** DataURL de la foto y del QR; si faltan, se omiten sin romper. */
  fotoDataUrl?: string | null;
  qrDataUrl?: string | null;
}

export interface CarnetMasivoOpts {
  /** DataURL del logo de la temporal (Apoyo o Tu Alianza). */
  logoDataUrl?: string | null;
  /** Teléfono del coordinador impreso en el reverso. */
  telefonoCoordinador: string;
  /** ARL impresa en el reverso. */
  arl: string;
  /**
   * 1..9 → dibuja el carnet solo en esa celda de la grilla. Sin valor, se
   * reparten las filas de arriba a abajo como en la generación masiva.
   */
  posicion?: number | null;
  /**
   * Carnets por hoja en el lote (1..9). Se ocupan las primeras celdas de la
   * grilla en orden de lectura; sin valor, la hoja va llena (9).
   */
  porHoja?: number | null;
  /**
   * Cómo se voltea la hoja para el reverso. Sin valor se asume el volteo de
   * izquierda a derecha, que es lo que se hacía siempre.
   */
  impresion?: Partial<ConfigImpresionCarnet> | null;
}

// Geometría: idéntica a la de Home para que el recorte calce igual.
const PAGE_W = 612; // pt (carta 8.5")
const PAGE_H = 792; // pt (carta 11")
const MARGIN = 18;
const GAP = 12;
const CARD_W = Math.floor((PAGE_W - 2 * MARGIN - 2 * GAP) / 3);
const CARD_H = Math.floor((PAGE_H - 2 * MARGIN - 2 * GAP) / 3);
const SLOTS = 9;

const BLUE_CORP = '#1E54C7';
const BLUE_SUBTLE = '#EBF0FA';
const TEXT_MAIN = '#1A1A1A';
const TEXT_MUTED = '#737373';
const BLACK = '#000000';

const LEGAL =
  'ESTE CARNET ES DE USO EXCLUSIVO DEL TRABAJADOR. EN CASO DE PERDIDA, REPORTAR '
  + 'INMEDIATAMENTE AL COORDINADOR DE LA TEMPORAL. EL USO INDEBIDO DE ESTE DOCUMENTO '
  + 'ACARREARA SANCIONES DISCIPLINARIAS.';

/** MAYÚSCULAS sin tildes: helvetica de jsPDF no cubre bien los acentuados. */
const safeTxt = (txt: unknown): string => {
  const s = String(txt ?? '').trim().toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
};

/** Igual que `safeTxt` pero respetando mayúsculas/minúsculas del original. */
const safeTxtMixed = (txt: unknown): string => {
  const s = String(txt ?? '').trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
};

const formatoImagen = (dataUrl: string): 'PNG' | 'JPEG' =>
  dataUrl.includes('image/png') ? 'PNG' : 'JPEG';

/**
 * Escribe un texto que puede no caber en una línea y devuelve el alto REAL que
 * ocupó, en puntos.
 *
 * Antes se hacía `doc.text(texto, x, y, { maxWidth })` y después se avanzaba el
 * cursor una cantidad FIJA. `maxWidth` parte el texto en varias líneas, así que
 * un apellido largo escribía 2 renglones pero el cursor solo bajaba lo de uno:
 * la segunda línea quedaba ENCIMA del siguiente campo. Se veía así:
 *
 *     MONTOYA DE LA ESPRIELLA
 *     MARIA DE LO VILLARREAL CONCEPCION     ← dos textos superpuestos
 *
 * `maxLineas` recorta lo que sobre: en una tarjeta de 184x244 pt es preferible
 * cortar un centro de costo larguísimo a que se desborde sobre lo de abajo.
 */
function escribirTexto(
  doc: jsPDF,
  texto: string,
  x: number,
  y: number,
  opts: { maxWidth: number; altoLinea: number; align?: 'center' | 'left'; maxLineas?: number },
): number {
  const limpio = String(texto ?? '').trim();
  if (!limpio) return 0;

  let lineas: string[] = doc.splitTextToSize(limpio, opts.maxWidth);
  const tope = opts.maxLineas ?? 2;
  if (lineas.length > tope) {
    lineas = lineas.slice(0, tope);
    lineas[tope - 1] = String(lineas[tope - 1]).replace(/\s*\S*$/, '…');
  }

  lineas.forEach((linea, i) => {
    doc.text(linea, x, y + i * opts.altoLinea,
      opts.align === 'center' ? { align: 'center' } : undefined);
  });
  return lineas.length * opts.altoLinea;
}

/** Marco doble de la tarjeta; es la guía de recorte. */
function dibujarMarco(doc: jsPDF, cx: number, cy: number): void {
  doc.setDrawColor(BLACK);
  doc.setLineWidth(1.4);
  doc.rect(cx, cy, CARD_W, CARD_H);
  doc.setLineWidth(0.8);
  doc.rect(cx + 3, cy + 3, CARD_W - 6, CARD_H - 6);
}

function dibujarFrente(
  doc: jsPDF, row: CarnetMasivoRow, opts: CarnetMasivoOpts, cx: number, cy: number,
): void {
  dibujarMarco(doc, cx, cy);

  const innerPad = 10;
  const contentX = cx + innerPad;
  const contentW = CARD_W - 2 * innerPad;
  let cursorY = cy + innerPad;

  // Logo
  const HEADER_H = 30;
  if (opts.logoDataUrl) {
    doc.addImage(opts.logoDataUrl, formatoImagen(opts.logoDataUrl),
      contentX + (contentW - 80) / 2, cursorY, 80, HEADER_H);
  }
  cursorY += HEADER_H + 4;

  // Foto
  const PHOTO_H = CARD_H * 0.36;
  if (row.fotoDataUrl) {
    try {
      doc.addImage(row.fotoDataUrl, formatoImagen(row.fotoDataUrl),
        contentX + (contentW - 60) / 2, cursorY, 60, PHOTO_H);
    } catch {
      // Una foto corrupta no puede tumbar el carnet completo.
    }
  } else {
    doc.setFillColor(BLUE_SUBTLE);
    doc.rect(contentX, cursorY, contentW, PHOTO_H, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(TEXT_MUTED);
    doc.text('SIN FOTO', contentX + contentW / 2, cursorY + PHOTO_H / 2,
      { align: 'center', baseline: 'middle' });
  }
  cursorY += PHOTO_H + 8;

  // Nombre. El cursor avanza lo que de VERDAD ocupó cada bloque: con apellidos
  // largos son dos renglones y antes el segundo se montaba sobre los nombres.
  doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(TEXT_MAIN);
  cursorY += escribirTexto(doc, safeTxt(row.APELLIDOS), contentX + contentW / 2, cursorY,
    { maxWidth: contentW, altoLinea: 10, align: 'center', maxLineas: 2 });

  doc.setFont('helvetica', 'normal').setFontSize(8.5);
  cursorY += escribirTexto(doc, safeTxt(row.NOMBRES), contentX + contentW / 2, cursorY,
    { maxWidth: contentW, altoLinea: 9, align: 'center', maxLineas: 2 });

  cursorY += 4;

  // Dos columnas: QR a la izquierda, datos a la derecha.
  const colQrW = contentW * 0.38;
  const colGap = 5;
  const colDataW = contentW - colQrW - colGap;

  const hAvail = (cy + CARD_H - innerPad) - cursorY;
  const qrSize = Math.min(colQrW, hAvail - 10, 60);
  const qrX = contentX + (colQrW - qrSize) / 2;
  const qrY = cursorY;

  if (row.qrDataUrl) {
    doc.addImage(row.qrDataUrl, formatoImagen(row.qrDataUrl), qrX, qrY, qrSize, qrSize);
  }

  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(TEXT_MAIN);
  doc.text(safeTxt(row.CEDULA), contentX + colQrW / 2, qrY + qrSize + 8,
    { align: 'center', maxWidth: colQrW });

  const dataX = contentX + colQrW + colGap;
  let rowY = cursorY + 6;

  const campos = [
    { l: 'Fecha de Ingreso', v: safeTxtMixed(row.FECHA_INGRESO) },
    { l: 'Código', v: safeTxtMixed(row.CODIGO) },
    { l: 'Centro de Costos', v: safeTxtMixed(row.CENTRO_COSTO) },
  ];

  // Mismo cuidado que con el nombre: el valor puede ocupar 2 renglones (un
  // centro de costo largo), y con un avance fijo se montaba sobre el rótulo
  // del campo siguiente.
  const fondoTarjeta = cy + CARD_H - innerPad;
  for (const f of campos) {
    if (rowY > fondoTarjeta) break;      // no se escribe fuera de la tarjeta

    doc.setFont('helvetica', 'bold').setFontSize(6).setTextColor(TEXT_MUTED);
    doc.text(safeTxt(f.l), dataX, rowY);
    rowY += 8;

    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(TEXT_MAIN);
    const alto = escribirTexto(doc, f.v, dataX, rowY,
      { maxWidth: colDataW, altoLinea: 8, maxLineas: 2 });
    rowY += Math.max(alto, 8) + 4;
  }
}

function dibujarReverso(
  doc: jsPDF, row: CarnetMasivoRow, opts: CarnetMasivoOpts, cx: number, cy: number,
): void {
  dibujarMarco(doc, cx, cy);

  const innerPad = 10;
  const contentX = cx + innerPad;
  const contentW = CARD_W - 2 * innerPad;
  let cursorY = cy + innerPad;

  if (opts.logoDataUrl) {
    doc.addImage(opts.logoDataUrl, formatoImagen(opts.logoDataUrl),
      contentX + (contentW - 60) / 2, cursorY, 60, 20);
  }
  cursorY += 28;

  doc.setFontSize(6.5).setFont('helvetica', 'normal').setTextColor(TEXT_MUTED);
  doc.text('CONTACTO COORDINADOR DE LA', cx + CARD_W / 2, cursorY, { align: 'center' });
  cursorY += 8;
  doc.setFont('helvetica', 'bold').setTextColor(BLUE_CORP);
  doc.text(safeTxt(`TEMPORAL ${String(row.TELEFONO_COORDINADOR ?? '').trim() || opts.telefonoCoordinador}`), cx + CARD_W / 2, cursorY, { align: 'center' });
  cursorY += 14;

  doc.setFontSize(9).setTextColor(TEXT_MAIN);
  doc.text('ARL', contentX, cursorY);
  doc.setTextColor(BLUE_CORP);
  doc.text(safeTxt(opts.arl), contentX + contentW, cursorY, { align: 'right' });
  cursorY += 16;

  doc.setFontSize(6).setTextColor(BLUE_CORP);
  doc.text('FAMILIAR EN CASO DE EMERGENCIA', cx + CARD_W / 2, cursorY, { align: 'center' });
  cursorY += 6;

  const nombre = safeTxt(row.FAMILIAR_EMERGENCIA_NOMBRE);
  const tel = safeTxt(row.FAMILIAR_EMERGENCIA_TELEFONO);
  const emergencia = [nombre, tel].filter(Boolean).join(' - ') || '—';

  doc.setFillColor(BLUE_SUBTLE);
  doc.rect(contentX, cursorY, contentW, 20, 'F');
  doc.setFontSize(7.5).setFont('helvetica', 'bold').setTextColor(TEXT_MAIN);
  doc.text(emergencia, cx + CARD_W / 2, cursorY + 12, { align: 'center', maxWidth: contentW - 4 });
  cursorY += 28;

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.line(contentX, cursorY, contentX + contentW, cursorY);
  cursorY += 8;

  doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(TEXT_MUTED);
  doc.text(safeTxtMixed(LEGAL), contentX, cursorY, { maxWidth: contentW, align: 'justify' });
}

/** Carnets que caben por hoja (grilla 3x3), igual que la masiva de Home. */
export const CARNETS_POR_HOJA_ALIANZA = SLOTS;

/** Dibuja una hoja: página de frentes + página de reversos espejados. */
function dibujarHoja(
  doc: jsPDF, slots: Array<CarnetMasivoRow | null>, opts: CarnetMasivoOpts, primera: boolean,
): void {
  if (!primera) doc.addPage();
  for (let si = 0; si < SLOTS; si++) {
    const row = slots[si];
    if (!row) continue;
    dibujarFrente(doc, row, opts,
      MARGIN + (si % 3) * (CARD_W + GAP),
      MARGIN + Math.floor(si / 3) * (CARD_H + GAP));
  }

  // Reverso: columna espejada para que calce al voltear la hoja de izquierda a
  // derecha. Si el operador la voltea de arriba a abajo, `dibujarCaraReverso`
  // gira esta página 180° y el reverso cae igual de bien.
  doc.addPage();
  dibujarCaraReverso(doc, normalizarImpresion(opts.impresion), () => {
    for (let si = 0; si < SLOTS; si++) {
      const row = slots[si];
      if (!row) continue;
      dibujarReverso(doc, row, opts,
        MARGIN + (2 - (si % 3)) * (CARD_W + GAP),
        MARGIN + Math.floor(si / 3) * (CARD_H + GAP));
    }
  });
}

/**
 * Devuelve el PDF con los carnets de `rows`, dos páginas por hoja (frentes y
 * reversos). Con más filas que `opts.porHoja` (9 si no viene) se agregan hojas.
 *
 * Con `opts.posicion` (1..9) se dibuja SOLO la primera fila, en esa celda, y
 * las otras ocho quedan en blanco para reaprovechar una hoja ya recortada.
 */
export function buildCarnetsMasivoPdf(
  rows: CarnetMasivoRow[], opts: CarnetMasivoOpts,
): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
  const gente = (rows ?? []).filter(Boolean);

  const pos = opts.posicion;
  if (typeof pos === 'number' && pos >= 1 && pos <= SLOTS) {
    const slots: Array<CarnetMasivoRow | null> = Array(SLOTS).fill(null);
    slots[pos - 1] = gente[0] ?? null;
    dibujarHoja(doc, slots, opts, true);
    return doc.output('blob');
  }

  const cupo = normalizarPorHoja(opts.porHoja, SLOTS);
  const hojas = Math.max(1, Math.ceil(gente.length / cupo));
  for (let h = 0; h < hojas; h++) {
    const tanda = gente.slice(h * cupo, (h + 1) * cupo);
    const slots: Array<CarnetMasivoRow | null> = Array(SLOTS).fill(null);
    tanda.forEach((r, i) => { slots[i] = r; });
    dibujarHoja(doc, slots, opts, h === 0);
  }

  return doc.output('blob');
}
