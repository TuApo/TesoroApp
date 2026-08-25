/**
 * Renderizador Markdown ligero y AUTOCONTENIDO (sin dependencias npm nuevas).
 *
 * Convierte un subconjunto común de Markdown a HTML con etiquetas de una lista
 * blanca (h1-h6, p, strong/em, code/pre, ul/ol/li, a, tabla, blockquote, hr).
 * El HTML resultante se enlaza con [innerHTML], por lo que Angular lo sanitiza
 * de nuevo (defensa en profundidad): todo texto se escapa primero y solo se
 * reintroducen etiquetas seguras.
 *
 * NOTA: los bloques cercados (``` ```) NO los procesa esta función — los separa
 * antes MarkdownMessageComponent (para poder renderizar `echarts` como gráfica).
 */

export function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Transforma marcas en línea sobre texto YA escapado. */
function inline(text: string): string {
  let t = text;
  // código en línea `x`
  t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // enlaces [texto](url)  (solo http/https/mailto)
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    (_m, txt, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>`);
  // negrita **x** o __x__
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // itálica *x* o _x_
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  // tachado ~~x~~
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return t;
}

function isTableSep(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}
function splitRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith('|')) l = l.slice(1);
  if (l.endsWith('|')) l = l.slice(0, -1);
  return l.split('|').map((c) => c.trim());
}

/** Convierte Markdown (sin fences) a HTML seguro. */
export function markdownToHtml(md: string): string {
  const src = (md ?? '').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const out: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    if (!buf.length) return;
    out.push(`<p>${inline(escapeHtml(buf.join(' ')))}</p>`);
    buf.length = 0;
  };

  const para: string[] = [];
  while (i < lines.length) {
    const line = lines[i];

    // línea en blanco → cierra párrafo
    if (!line.trim()) { flushParagraph(para); i++; continue; }

    // encabezados
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushParagraph(para);
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(escapeHtml(h[2].trim()))}</h${lvl}>`);
      i++; continue;
    }

    // regla horizontal
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph(para); out.push('<hr>'); i++; continue;
    }

    // cita
    if (/^\s*>\s?/.test(line)) {
      flushParagraph(para);
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, '')); i++;
      }
      out.push(`<blockquote>${inline(escapeHtml(quote.join(' ')))}</blockquote>`);
      continue;
    }

    // tabla:  | a | b |  +  | --- | --- |
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushParagraph(para);
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i])); i++;
      }
      // Detecta columnas numéricas (montos / cantidades) para alinearlas a la
      // derecha, como CANT./VALOR en el desprendible de pago.
      const esNum = (s: string) => /^\s*-?\$?\s*\d[\d.,\s]*%?\s*$/.test(s.trim());
      const neutro = (s: string) => { const t = s.trim(); return t === '' || t === '—' || t === '-' || t === '–' || /^n\/?a$/i.test(t); };
      const colNum = header.map((_, c) => {
        let num = 0, tot = 0;
        for (const r of rows) { const v = r[c] ?? ''; if (neutro(v)) continue; tot++; if (esNum(v)) num++; }
        return tot > 0 && num / tot >= 0.6;
      });
      const cls = (c: number) => (colNum[c] ? ' class="md-num"' : '');
      let tbl = '<div class="md-table-wrap"><table><thead><tr>';
      for (let c = 0; c < header.length; c++) tbl += `<th${cls(c)}>${inline(escapeHtml(header[c]))}</th>`;
      tbl += '</tr></thead><tbody>';
      for (const r of rows) {
        tbl += '<tr>';
        for (let c = 0; c < header.length; c++) tbl += `<td${cls(c)}>${inline(escapeHtml(r[c] ?? ''))}</td>`;
        tbl += '</tr>';
      }
      tbl += '</tbody></table></div>';
      out.push(tbl);
      continue;
    }

    // lista no ordenada
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph(para);
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++;
      }
      out.push('<ul>' + items.map((it) => `<li>${inline(escapeHtml(it))}</li>`).join('') + '</ul>');
      continue;
    }

    // lista ordenada
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph(para);
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++;
      }
      out.push('<ol>' + items.map((it) => `<li>${inline(escapeHtml(it))}</li>`).join('') + '</ol>');
      continue;
    }

    // texto normal → acumular en párrafo
    para.push(line.trim());
    i++;
  }
  flushParagraph(para);
  return out.join('\n');
}
