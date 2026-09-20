/**
 * Deja los PDF generados con las imágenes "quemadas" en la página y el
 * formulario aplanado.
 *
 * POR QUÉ EXISTE
 * --------------
 * Las plantillas de contratación traen foto, huella, firma y logo como
 * *botones de formulario* (`*_af_image`). Rellenarlos con
 * `form.getButton(x).setImage(img)` deja la imagen como **apariencia del
 * widget**, no como contenido de la página. Mientras el PDF se abre entero se
 * ve bien, pero al copiar sus páginas a otro documento (Nitro, Acrobat, o el
 * propio `copyPages` de pdf-lib) el AcroForm se queda atrás, los widgets
 * quedan huérfanos y **la foto, la huella y la firma desaparecen**.
 *
 * EL ORDEN IMPORTA
 * ----------------
 * No basta con dibujar la imagen sobre la página: `form.flatten()` recorre los
 * campos del AcroForm — NO las anotaciones de la página — y por cada widget
 * hace `page.pushOperators(...)` con su apariencia, que se añade AL FINAL del
 * content stream. Como la apariencia de un botón de imagen es su fondo, el
 * aplanado **pinta encima de la imagen** y la tapa.
 *
 * Por eso `dibujarImagenPlana()` no dibuja en el acto: mide el recuadro (hay
 * que hacerlo antes, porque `flatten()` borra los campos) y **aplaza** el
 * dibujo. `aplanarFormulario()` aplana primero y ejecuta los dibujos después,
 * que es el mismo orden que ya usaba a mano la Ficha Social.
 *
 * Consecuencia práctica: si un generador llama a `dibujarImagenPlana()` DEBE
 * llamar después a `aplanarFormulario()`, o las imágenes no se dibujan.
 */

import {
  PDFDocument, PDFForm, PDFImage,
  pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, clip, endPath, rgb,
} from 'pdf-lib';

/**
 * `contener`: la imagen entra completa dentro del recuadro (firmas, huellas,
 * logos). `cubrir`: la imagen llena el recuadro y se recorta el sobrante, sin
 * aire alrededor (fotos tipo carné).
 */
export type ModoImagen = 'contener' | 'cubrir';

/** Dibujo aplazado hasta después del `flatten()`. */
interface DibujoPendiente {
  dibujar: () => void;
  /** Saca el widget de la página. Solo hace falta si el flatten falla. */
  quitarWidget: () => void;
}

const pendientes = new WeakMap<PDFForm, DibujoPendiente[]>();

/**
 * Programa el dibujo de `img` dentro del recuadro del campo `campo`, como
 * contenido de la página. El dibujo se ejecuta en `aplanarFormulario()`.
 *
 * Recorre TODOS los widgets del campo: en Ficha Social las dos cajas de firma
 * son dos widgets del mismo `firma_af_image`, y con solo el primero una de las
 * dos salía vacía.
 *
 * @returns true si encontró al menos un recuadro donde dibujar.
 */
export function dibujarImagenPlana(
  pdfDoc: PDFDocument,
  form: PDFForm,
  campo: string,
  img: PDFImage,
  modo: ModoImagen = 'contener',
): boolean {
  let field: any;
  try {
    field = form.getField(campo);
  } catch {
    return false; // el campo no existe en esta plantilla
  }

  const widgets: any[] = field?.acroField?.getWidgets?.() ?? [];
  if (!widgets.length) return false;

  const ctx: any = (pdfDoc as any).context;
  const paginas = pdfDoc.getPages();
  const cola = pendientes.get(form) ?? [];
  let encolados = 0;

  for (const widget of widgets) {
    try {
      const rect = widget.getRectangle();
      // `NaN <= 0` es false, así que un rect corrupto pasaría el filtro y
      // reventaría después en los operadores de recorte.
      if (!rect ||
          ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
          rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      // Página del widget: primero por su /P, si no buscando su referencia en
      // los /Annots. OJO: Annots guarda PDFRef, hay que resolver con lookup —
      // comparar contra el dict directamente nunca encuentra nada.
      const refPagina = widget.P?.();
      const pagina =
        paginas.find((pg: any) => refPagina && pg.ref === refPagina) ??
        paginas.find((pg: any) => {
          const arr: any[] = (pg as any).node?.Annots?.()?.asArray?.() ?? [];
          return arr.some((a: any) => a === widget.dict || ctx?.lookup?.(a) === widget.dict);
        }) ??
        paginas[0];

      const dims = img.scale(1);
      const escala = modo === 'cubrir'
        ? Math.max(rect.width / dims.width, rect.height / dims.height)
        : Math.min(rect.width / dims.width, rect.height / dims.height) * 0.95;
      const w = dims.width * escala;
      const h = dims.height * escala;
      const x = rect.x + (rect.width - w) / 2;
      const y = rect.y + (rect.height - h) / 2;

      cola.push({
        dibujar: () => {
          if (modo === 'cubrir') {
            // Fondo blanco: tapa el texto impreso del recuadro antes de la foto.
            pagina.drawRectangle({
              x: rect.x, y: rect.y, width: rect.width, height: rect.height, color: rgb(1, 1, 1),
            });
            pagina.pushOperators(
              pushGraphicsState(),
              moveTo(rect.x, rect.y),
              lineTo(rect.x + rect.width, rect.y),
              lineTo(rect.x + rect.width, rect.y + rect.height),
              lineTo(rect.x, rect.y + rect.height),
              closePath(),
              clip(),
              endPath(),
            );
            pagina.drawImage(img, { x, y, width: w, height: h });
            pagina.pushOperators(popGraphicsState());
          } else {
            pagina.drawImage(img, { x, y, width: w, height: h });
          }
        },
        quitarWidget: () => {
          const annots = (pagina as any).node?.Annots?.();
          const arr: any[] = annots?.asArray?.() ?? [];
          const i = arr.findIndex((a: any) => a === widget.dict || ctx?.lookup?.(a) === widget.dict);
          if (i >= 0) annots.remove(i);
        },
      });
      encolados++;
    } catch (e) {
      console.error(`[pdf-aplanado] no se pudo preparar la imagen de "${campo}":`, e);
    }
  }

  pendientes.set(form, cola);
  return encolados > 0;
}

/**
 * Aplana el formulario y dibuja las imágenes que quedaron pendientes.
 *
 * El orden es deliberado: primero `flatten()` (que además saca de las páginas
 * los widgets ya aplanados) y después las imágenes, para que nada las tape.
 *
 * Si `flatten()` falla (plantilla con campos sin apariencia), se deja el
 * formulario en solo lectura y se quitan a mano los widgets de las imágenes:
 * siguen siendo anotaciones, y una anotación se pinta SIEMPRE por encima del
 * contenido de la página. Se pierde el aplanado, pero no el documento ni las
 * imágenes — que es el comportamiento que había antes de este cambio.
 */
export function aplanarFormulario(form: PDFForm): void {
  let aplanado = true;
  try {
    form.flatten();
  } catch (e) {
    aplanado = false;
    console.warn('[pdf-aplanado] flatten() falló, se deja el formulario en solo lectura:', e);
    try {
      form.getFields().forEach((f: any) => { try { f.enableReadOnly(); } catch { /* noop */ } });
    } catch { /* noop */ }
  }

  const cola = pendientes.get(form);
  if (!cola) return;
  pendientes.delete(form);

  for (const p of cola) {
    if (!aplanado) {
      try { p.quitarWidget(); } catch { /* si no se puede, la imagen igual se dibuja */ }
    }
    try { p.dibujar(); } catch (e) {
      console.error('[pdf-aplanado] no se pudo dibujar una imagen pendiente:', e);
    }
  }
}

/**
 * Deja el PDF listo para DILIGENCIAR a mano: dibuja las imágenes pendientes y
 * quita sus widgets, pero NO aplana los campos de texto, que siguen editables
 * en el visor (ficha técnica: "completar lo que falta").
 *
 * Las imágenes se dibujan igual que en `aplanarFormulario()` sin flatten: el
 * widget de la imagen se saca de la página para que su fondo no las tape.
 */
export function prepararParaDiligenciar(form: PDFForm): void {
  const cola = pendientes.get(form);
  if (!cola) return;
  pendientes.delete(form);
  for (const p of cola) {
    try { p.quitarWidget(); } catch { /* la imagen igual se dibuja */ }
    try { p.dibujar(); } catch (e) {
      console.error('[pdf-aplanado] no se pudo dibujar una imagen pendiente:', e);
    }
  }
}

/**
 * Aplana un PDF ya diligenciado en el visor, para guardarlo bloqueado en el
 * expediente. Lo que escribió la persona queda como contenido de la página.
 */
export async function aplanarPdfDiligenciado(bytes: Uint8Array): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(bytes);
  aplanarFormulario(pdfDoc.getForm());
  return pdfDoc.save();
}
