import { svgCodigoBarras } from '../../../../../shared/utils/codigo-barras';

export interface Etiqueta { nombre: string; precio: number | null; codigo: string; sku?: string }

/**
 * Imprime etiquetas de góndola (nombre, precio y código de barras) en hoja carta, 3 por fila.
 * Se imprime desde un iframe aislado: window.print de la app imprimiría toda la pantalla.
 */
export function imprimirEtiquetas(etiquetas: Etiqueta[], titulo = 'Etiquetas'): void {
  const pesos = (n: number | null) => n == null ? '' : '$' + Math.round(n).toLocaleString('es-CO');
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
    @page { size: letter; margin: 8mm; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
    .hoja { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
    .et { border: 1px dashed #999; border-radius: 2mm; padding: 2mm 3mm; height: 30mm; box-sizing: border-box; display: flex; flex-direction: column; break-inside: avoid; }
    .n { font-size: 8.5pt; font-weight: bold; line-height: 1.15; max-height: 2.4em; overflow: hidden; }
    .p { font-size: 14pt; font-weight: 800; margin: .5mm 0; }
    .b { flex: 1; min-height: 0; } .b svg { width: 100%; height: 100%; }
  </style></head><body><div class="hoja">${etiquetas.map(e => `<div class="et"><div class="n">${esc(e.nombre)}</div><div class="p">${pesos(e.precio)}</div><div class="b">${svgCodigoBarras(e.codigo, { alto: 40 })}</div></div>`).join('')}</div></body></html>`;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(f);
  const d = f.contentDocument!;
  d.open(); d.write(html); d.close();
  setTimeout(() => { f.contentWindow?.focus(); f.contentWindow?.print(); setTimeout(() => f.remove(), 60000); }, 300);
}
