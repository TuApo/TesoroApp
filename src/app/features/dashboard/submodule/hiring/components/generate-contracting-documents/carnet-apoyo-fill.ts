/**
 * Carnet de Apoyo Laboral TS — 2 páginas CARTA HORIZONTAL, una por cara.
 *
 * La hoja se reparte en una grilla de 3x3 (9 carnets tamaño CR80), pero esa
 * grilla NO se dibuja: solo sirve para posicionar. Se imprime únicamente el
 * carnet que se está generando, y las celdas sin usar quedan totalmente en
 * blanco para poder reusar la hoja. El recorte se guía con las marcas de
 * esquina que lleva cada carnet.
 *
 * Por qué horizontal: 3 carnets de 85,6 mm son 256,8 mm de ancho y la carta
 * vertical solo tiene 215,9 mm. Horizontal (279,4 x 215,9) la grilla entra
 * completa (256,8 x 162 mm) sin tener que rotar el contenido.
 *
 * IMPRESIÓN A DOBLE CARA: el reverso se dibuja con las columnas espejadas —celda
 * de arriba a la DERECHA— porque el volteo base es sobre el eje vertical (como
 * pasar la hoja de un libro). Si la hoja se voltea de arriba a abajo, la página
 * de reversos se gira 180° completa; de eso se encarga `dibujarCaraReverso` con
 * la configuración que elija el operador. Como esta hoja es HORIZONTAL, el
 * volteo de libro se llama "lado CORTO" en la impresora (al revés que en el
 * carnet de Tu Alianza, que es vertical).
 *
 * Se dibuja con jsPDF (texto y vectores reales, no una imagen) para que
 * cualquier editor de PDF lo abra y lo pueda editar.
 */
import jsPDF from 'jspdf';
import { sanitizedString } from './winansi.util';
import {
  ConfigImpresionCarnet,
  dibujarCaraReverso,
  normalizarImpresion,
  normalizarPorHoja,
} from './carnet-impresion';

/** Tamaño del carnet en mm (CR80, el estándar). */
export const CARNET_ANCHO = 85.6;
export const CARNET_ALTO = 54;

/** Celdas en que se reparte cada hoja (solo para posicionar; no se dibujan). */
export const CARNET_COLUMNAS = 3;
export const CARNET_FILAS = 3;

/** Apoyo tiene una sola ARL y una sola caja de compensación para todos. */
export const ARL_FIJA = 'SURA';
export const CCF_FIJA = 'COMPENSAR';

/**
 * Teléfono del coordinador impreso en el reverso cuando no se pudo resolver el
 * del gestor del centro de costo (ver `DatosCarnet.telefonoCoordinador`).
 */
export const TELEFONO_COORDINADOR = '3102518013';

export interface DatosCarnet {
  nombreCompleto: string;
  cedula: string;
  centroCostos: string;
  cargo: string;
  /** Consecutivo del carnet (el "Con." amarillo). */
  consecutivo: string;
  /** Fecha de ingreso, dd/mm/aaaa. */
  fechaIngreso: string;
  eps: string;
  afp: string;
  emergenciaNombre: string;
  emergenciaTelefono: string;
  /**
   * "Contacto Coordinador de la Temporal": el teléfono del GESTOR del centro de
   * costo al que aspira la persona (`centros_costos.telefono_gestor`). Si no se
   * pudo resolver, se imprime el fijo `TELEFONO_COORDINADOR`.
   */
  telefonoCoordinador?: string | null;
  /** DataURL del logo y de la foto; si faltan, se omiten sin romper. */
  logoDataUrl?: string | null;
  fotoDataUrl?: string | null;
}

const s = (v: unknown) => sanitizedString(v);

/**
 * Patrones Code 39. Cada carácter son 9 elementos que alternan barra/espacio
 * empezando y terminando en barra; 1 = ancho, 0 = angosto. Tres de los nueve
 * son anchos, de ahí el nombre.
 */
const CODE39: Record<string, string> = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
  '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
  '8': '100100100', '9': '001100100', '*': '000101101',
};

/**
 * Dibuja la cédula como código de barras Code 39 legible por lector láser.
 *
 * Se dibuja con rectángulos en vez de usar una fuente de barras: así no
 * depende de que la fuente esté instalada en el equipo que imprima, y el PDF
 * se ve igual en cualquier visor.
 */
function dibujarCode39(
  doc: jsPDF, texto: string, x: number, y: number, ancho: number, alto: number,
): void {
  const cadena = `*${texto.replace(/[^0-9]/g, '')}*`;
  const chars = cadena.split('').filter(c => CODE39[c]);
  if (chars.length <= 2) return; // sin dígitos, no se dibuja nada

  // Cada carácter: 3 elementos anchos (3 módulos) + 6 angostos (1) = 15,
  // más 1 módulo de separación entre caracteres.
  const modulosPorChar = 15 + 1;
  const totalModulos = chars.length * modulosPorChar - 1;
  const m = ancho / totalModulos;      // ancho del módulo angosto

  doc.setFillColor(0, 0, 0);
  let cx = x;
  for (const ch of chars) {
    const patron = CODE39[ch];
    for (let i = 0; i < 9; i++) {
      const w = (patron[i] === '1' ? 3 : 1) * m;
      if (i % 2 === 0) doc.rect(cx, y, w, alto, 'F'); // pares = barra
      cx += w;
    }
    cx += m; // separación entre caracteres
  }
}

/** Origen (esquina superior izquierda) de una celda de la grilla, en mm. */
function origenCelda(doc: jsPDF, fila: number, columna: number): { ox: number; oy: number } {
  const hojaW = doc.internal.pageSize.getWidth();
  const hojaH = doc.internal.pageSize.getHeight();
  const gridW = CARNET_ANCHO * CARNET_COLUMNAS;
  const gridH = CARNET_ALTO * CARNET_FILAS;
  return {
    ox: (hojaW - gridW) / 2 + columna * CARNET_ANCHO,
    oy: (hojaH - gridH) / 2 + fila * CARNET_ALTO,
  };
}


/** Marcas de corte en las 4 esquinas de una celda, para recortar sin adivinar. */
function marcasDeCorte(doc: jsPDF, ox: number, oy: number): void {
  const m = 3;
  const W = CARNET_ANCHO, H = CARNET_ALTO;
  doc.setDrawColor(120).setLineWidth(0.15);
  const esquinas: Array<[number, number, number, number]> = [
    [ox, oy, -m, 0], [ox, oy, 0, -m],
    [ox + W, oy, m, 0], [ox + W, oy, 0, -m],
    [ox, oy + H, -m, 0], [ox, oy + H, 0, m],
    [ox + W, oy + H, m, 0], [ox + W, oy + H, 0, m],
  ];
  for (const [px, py, dx, dy] of esquinas) doc.line(px, py, px + dx, py + dy);
}

/** Cara 1 del carnet, dibujada dentro de la celda que arranca en (ox, oy). */
function dibujarFrente(doc: jsPDF, d: DatosCarnet, ox: number, oy: number): void {
  const W = CARNET_ANCHO, H = CARNET_ALTO;
  const X = (v: number) => ox + v;
  const Y = (v: number) => oy + v;

  marcasDeCorte(doc, ox, oy);
  doc.setDrawColor(0).setLineWidth(0.4);
  doc.rect(ox, oy, W, H);

  if (d.logoDataUrl) {
    try { doc.addImage(d.logoDataUrl, 'PNG', X(3.5), Y(3), 28, 10); } catch { }
  }
  doc.setTextColor(0).setFont('helvetica', 'bold').setFontSize(6);
  doc.text('Nit. 900.814.587-1', X(3.5), Y(16.5));

  // Foto a la derecha, proporción 3:4.
  const fotoW = 24, fotoH = 30, fotoX = W - fotoW - 3.5, fotoY = 3;
  if (d.fotoDataUrl) {
    try { doc.addImage(d.fotoDataUrl, 'JPEG', X(fotoX), Y(fotoY), fotoW, fotoH); } catch { }
  } else {
    doc.setDrawColor(150).setLineWidth(0.2);
    doc.rect(X(fotoX), Y(fotoY), fotoW, fotoH);
  }

  const anchoIzq = fotoX - 3.5;
  const centroIzq = 3.5 + anchoIzq / 2;

  doc.setFont('helvetica', 'bold').setFontSize(7);
  const nombre = doc.splitTextToSize(s(d.nombreCompleto).toUpperCase(), anchoIzq) as string[];
  let y = 22;
  doc.text(nombre, X(centroIzq), Y(y), { align: 'center' });
  y += nombre.length * 3.2 + 1;

  // Los asteriscos son el delimitador del código de barras (Code 39).
  doc.setFontSize(8);
  doc.text(`*${s(d.cedula)}*`, X(centroIzq), Y(y), { align: 'center' });
  y += 5;

  doc.setFont('helvetica', 'normal').setFontSize(5.5);
  doc.text('Centro de Costos', X(3.5), Y(y));
  doc.setFont('helvetica', 'bold').setFontSize(6);
  doc.text(s(d.centroCostos).toUpperCase(), X(27), Y(y));
  y += 4.5;

  doc.setFont('helvetica', 'normal').setFontSize(5.5);
  const cargo = doc.splitTextToSize(s(d.cargo).toUpperCase(), anchoIzq) as string[];
  doc.text(cargo, X(centroIzq), Y(y), { align: 'center' });

  // Código de barras de la cédula, en el espacio libre a la izquierda de "Con.".
  //
  // El rótulo "Con." arranca en W-30. Antes el código llegaba justo hasta ahí y
  // la última barra se comía la "C" (se leía "on."). Se deja una zona muda de
  // 4 mm a cada lado: además de que no se sobreponga, Code 39 la necesita para
  // que el lector reconozca el inicio y el fin del símbolo.
  const BC_ZONA_MUDA = 4;
  const bcX = BC_ZONA_MUDA;
  const bcAncho = (W - 30 - BC_ZONA_MUDA) - bcX;
  const bcAlto = 7;
  const bcY = H - 14;
  dibujarCode39(doc, s(d.cedula), X(bcX), Y(bcY), bcAncho, bcAlto);
  doc.setFont('helvetica', 'normal').setFontSize(5);
  doc.text(s(d.cedula), X(bcX + bcAncho / 2), Y(bcY + bcAlto + 2.2), { align: 'center' });

  // Consecutivo y fecha de ingreso, abajo a la derecha.
  const cajaY = H - 11;
  doc.setFont('helvetica', 'normal').setFontSize(5.5);
  doc.text('Con.', X(W - 30), Y(cajaY + 3));
  doc.text('Ing.', X(W - 30), Y(cajaY + 8));

  doc.setFillColor(255, 242, 0);            // amarillo del consecutivo
  doc.rect(X(W - 24), Y(cajaY), 20.5, 4.6, 'F');
  doc.setDrawColor(0).setLineWidth(0.2);
  doc.rect(X(W - 24), Y(cajaY), 20.5, 4.6);
  doc.setFont('helvetica', 'bold').setFontSize(8);
  doc.text(s(d.consecutivo), X(W - 13.75), Y(cajaY + 3.5), { align: 'center' });

  doc.setFontSize(7);
  doc.text(s(d.fechaIngreso), X(W - 13.75), Y(cajaY + 8.5), { align: 'center' });
}

/** Cara 2 del carnet, dibujada dentro de la celda que arranca en (ox, oy). */
function dibujarReverso(doc: jsPDF, d: DatosCarnet, ox: number, oy: number): void {
  const W = CARNET_ANCHO, H = CARNET_ALTO;
  const X = (v: number) => ox + v;
  const Y = (v: number) => oy + v;

  marcasDeCorte(doc, ox, oy);
  doc.setDrawColor(0).setLineWidth(0.4);
  doc.rect(ox, oy, W, H);

  // Consecutivo tenue arriba a la derecha, para casar frente y reverso.
  doc.setTextColor(160).setFont('helvetica', 'bold').setFontSize(6);
  doc.text(s(d.consecutivo), X(W - 3), Y(5), { align: 'right' });
  doc.setTextColor(0);

  const filaY = 9;
  doc.setFontSize(6);
  const par = (rotulo: string, valor: string, x: number, yy: number) => {
    doc.setFont('helvetica', 'bold');
    doc.text(rotulo, X(x), Y(yy));
    doc.setFont('helvetica', 'normal');
    doc.text(s(valor).toUpperCase(), X(x + 10), Y(yy), { maxWidth: 30 });
  };
  par('EPS', d.eps, 4, filaY);
  par('AFP', d.afp, 47, filaY);
  par('ARL', ARL_FIJA, 4, filaY + 4.5);
  par('CCF', CCF_FIJA, 47, filaY + 4.5);

  let y2 = filaY + 11;
  doc.setFont('helvetica', 'bold').setFontSize(6.5);
  doc.text('Familiar en caso de emergencia', X(W / 2), Y(y2), { align: 'center' });
  y2 += 4.5;
  par('Nombre', d.emergenciaNombre, 4, y2);
  y2 += 4.5;
  par('Teléfono', d.emergenciaTelefono, 4, y2);

  y2 += 5.5;
  doc.setFont('helvetica', 'normal').setFontSize(6);
  const legal = doc.splitTextToSize(
    'Este carnet es personal e intransferible, esta prohibido realizar actividades ' +
    'diferentes a su uso. En caso de pérdida de este carnet por favor comunicarse ' +
    'con la empresa APOYO LABORAL TS S.A.S.',
    W - 8,
  ) as string[];
  doc.text(legal, X(W / 2), Y(y2), { align: 'center' });
  y2 += legal.length * 2.8 + 1;

  doc.setFontSize(5.5);
  doc.text('Carrera 2 No 8 -156 Facatativá-Cundinamarca.', X(W / 2), Y(y2), { align: 'center' });
  y2 += 3.5;

  doc.setDrawColor(0).setLineWidth(0.3);
  doc.rect(X(3), Y(y2 - 2.8), W - 6, 4.2);
  doc.setFont('helvetica', 'bold').setFontSize(6);
  doc.text(
    `Contacto Coordinador de la Temporal  ${s(d.telefonoCoordinador) || TELEFONO_COORDINADOR}`,
    X(W / 2), Y(y2), { align: 'center' },
  );
}

/** Carnets por hoja: las 9 celdas de la grilla. */
export const CARNETS_POR_HOJA = CARNET_FILAS * CARNET_COLUMNAS;

/**
 * Lote: llena `porHoja` celdas de cada hoja (1..9, por defecto las 9) y agrega
 * hojas mientras haya gente. Las celdas se ocupan en orden de lectura sobre la
 * MISMA grilla de 3x3, así que con cualquier cantidad el carnet queda en su
 * sitio de siempre y no hay forma de que se salga de la hoja.
 *
 * El reverso se dibuja en la columna espejada (col → COLUMNAS-1-col) por la
 * misma razón que el carnet individual: es lo que pide el volteo sobre el eje
 * vertical. `impresion` decide si además hay que girar la cara 180° (volteo de
 * arriba a abajo) y si lleva corrimiento fino.
 *
 * Las celdas sobrantes de la última hoja quedan en blanco con su contorno.
 */
export function buildCarnetApoyoLotePdf(
  lista: readonly DatosCarnet[], impresion?: Partial<ConfigImpresionCarnet> | null,
  porHoja: number = CARNETS_POR_HOJA,
): Blob {
  const gente = (lista ?? []).filter(Boolean);
  const cfg = normalizarImpresion(impresion);
  const cupo = normalizarPorHoja(porHoja, CARNETS_POR_HOJA);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter', compress: true });
  doc.setProperties({ title: `Carnets_lote_${gente.length}` });

  const hojas = Math.max(1, Math.ceil(gente.length / cupo));
  let primeraPagina = true;

  for (let hoja = 0; hoja < hojas; hoja++) {
    const tanda = gente.slice(hoja * cupo, (hoja + 1) * cupo);

    // Cara 1 (frentes) de la hoja.
    if (!primeraPagina) doc.addPage('letter', 'landscape');
    primeraPagina = false;
    tanda.forEach((d, i) => {
      const fila = Math.floor(i / CARNET_COLUMNAS);
      const col = i % CARNET_COLUMNAS;
      const { ox, oy } = origenCelda(doc, fila, col);
      dibujarFrente(doc, d, ox, oy);
    });

    // Cara 2 (reversos) de la MISMA hoja, en columna espejada.
    doc.addPage('letter', 'landscape');
    dibujarCaraReverso(doc, cfg, () => {
      tanda.forEach((d, i) => {
        const fila = Math.floor(i / CARNET_COLUMNAS);
        const col = i % CARNET_COLUMNAS;
        const { ox, oy } = origenCelda(doc, fila, CARNET_COLUMNAS - 1 - col);
        dibujarReverso(doc, d, ox, oy);
      });
    });
  }

  return doc.output('blob');
}

/**
 * Carnet individual. `posicion` (0..8) elige en cuál de las 9 celdas se imprime,
 * numerando de izquierda a derecha y de arriba a abajo:
 *
 *     0 1 2
 *     3 4 5
 *     6 7 8
 *
 * Sirve para REUTILIZAR una hoja ya recortada: si en la primera impresión se
 * usó la celda 0 y se recortó, el siguiente carnet se manda a la celda 1 y se
 * vuelve a pasar la MISMA hoja por la impresora.
 */
export function buildCarnetApoyoPdf(
  d: DatosCarnet, posicion = 0, impresion?: Partial<ConfigImpresionCarnet> | null,
): Blob {
  const cfg = normalizarImpresion(impresion);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter', compress: true });
  doc.setProperties({ title: `Carnet_${d.cedula}` });

  const celda = Math.min(Math.max(Math.trunc(posicion) || 0, 0), CARNETS_POR_HOJA - 1);
  const fila = Math.floor(celda / CARNET_COLUMNAS);
  const columna = celda % CARNET_COLUMNAS;

  // ─────────────────────── CARA 1 (frente) ───────────────────────
  const frente = origenCelda(doc, fila, columna);
  dibujarFrente(doc, d, frente.ox, frente.oy);

  // ─────────────────────── CARA 2 (reverso) ───────────────────────
  // Espejo horizontal de la celda del frente: misma fila, columna opuesta. Con
  // el volteo de izquierda a derecha, esta celda cae exactamente detrás de la
  // otra; si la hoja se voltea de arriba a abajo, `dibujarCaraReverso` gira la
  // página completa y el resultado físico es el mismo.
  doc.addPage('letter', 'landscape');
  dibujarCaraReverso(doc, cfg, () => {
    const reverso = origenCelda(doc, fila, CARNET_COLUMNAS - 1 - columna);
    dibujarReverso(doc, d, reverso.ox, reverso.oy);
  });

  return doc.output('blob');
}
