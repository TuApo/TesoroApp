import { Component, ChangeDetectionStrategy, ViewEncapsulation, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { markdownToHtml } from './markdown-lite';

/** Un segmento único (campos opcionales) para no depender del narrowing de
 *  uniones en la plantilla; `kind` decide cuál se pinta. */
interface Segmento {
  kind: 'md' | 'echarts' | 'code';
  html?: string;
  option?: EChartsOption | null;
  raw?: string;
  code?: string;
}

/**
 * Renderiza el contenido de un mensaje: Markdown tipado + bloques de código, y
 * en particular los bloques cercados con la etiqueta `echarts`, que se pintan
 * como gráficas interactivas (ngx-echarts). Así el modelo puede "dibujar"
 * cualquier gráfica emitiendo un JSON de opciones ECharts.
 */
@Component({
  selector: 'app-markdown-message',
  standalone: true,
  imports: [CommonModule, NgxEchartsDirective],
  providers: [provideEchartsCore({ echarts: () => import('echarts') })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Sin encapsulación: los estilos deben alcanzar el HTML inyectado con
  // [innerHTML] (tablas, títulos…), que NO recibe los atributos de
  // encapsulación de Angular. Todo va namespaced bajo .md-body/.md-table-wrap/
  // .md-code/.chat-echart, así que no colisiona con el resto de la app.
  encapsulation: ViewEncapsulation.None,
  styles: [`
    app-markdown-message { display: block; }
    .md-body {
      font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      font-size: .93rem; line-height: 1.62; color: #1e293b;
      -webkit-font-smoothing: antialiased; word-break: break-word;
    }
    .md-body :first-child { margin-top: 0; }
    .md-body :last-child { margin-bottom: 0; }

    /* Títulos con jerarquía clara */
    .md-body h1, .md-body h2, .md-body h3, .md-body h4 { margin: 1.05em 0 .45em; line-height: 1.25; font-weight: 700; color: #0f172a; letter-spacing: -.01em; }
    .md-body h1 { font-size: 1.3rem; }
    .md-body h2 { font-size: 1.14rem; padding-bottom: .28em; border-bottom: 1px solid #eef2f7; }
    .md-body h3 { font-size: 1.02rem; }
    .md-body h4 { font-size: .94rem; color: #334155; }

    .md-body p { margin: .55em 0; }
    .md-body strong { font-weight: 700; color: #0f172a; }
    .md-body em { color: #475569; }
    .md-body ul, .md-body ol { margin: .5em 0 .5em 1.35em; padding: 0; }
    .md-body li { margin: .28em 0; }
    .md-body li::marker { color: #7C3AED; }
    .md-body a { color: #1565C0; text-decoration: none; font-weight: 600; }
    .md-body a:hover { text-decoration: underline; }
    .md-body blockquote { margin: .7em 0; padding: .5em .9em; border-left: 3px solid #c4b5fd; color: #475569; background: #faf7ff; border-radius: 0 8px 8px 0; }
    .md-body hr { border: none; border-top: 1px solid #e5e7eb; margin: 1em 0; }
    .md-body code { background: rgba(124,58,237,.10); color: #6d28d9; padding: .12em .4em; border-radius: 6px; font-size: .86em; font-family: 'SFMono-Regular', ui-monospace, Menlo, monospace; }

    /* Tablas: encabezado marcado, filas cebra, hover, números tabulares */
    .md-table-wrap { overflow-x: auto; margin: .85em 0; border: 1px solid #e6eaf0; border-radius: 12px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
    .md-body table { border-collapse: collapse; width: 100%; font-size: .88rem; min-width: 340px; background: #fff; }
    .md-body thead th {
      background: #f1f5f9; color: #334155; font-weight: 700; text-align: left;
      font-size: .74rem; text-transform: uppercase; letter-spacing: .04em;
      padding: .6em .8em; border-bottom: 2px solid #e2e8f0; white-space: nowrap;
    }
    .md-body tbody td {
      padding: .55em .8em; border-bottom: 1px solid #eef2f7; color: #1e293b;
      font-variant-numeric: tabular-nums; vertical-align: top;
    }
    .md-body tbody tr:nth-child(even) td { background: #f8fafc; }
    .md-body tbody tr:hover td { background: #f3efff; }
    .md-body tbody tr:last-child td { border-bottom: none; }
    .md-body tbody td:first-child { font-weight: 600; color: #0f172a; }
    /* Columnas numéricas (montos / cantidades): alineadas a la derecha, como el desprendible */
    .md-body th.md-num, .md-body td.md-num { text-align: right; white-space: nowrap; }
    .md-body tbody td.md-num { font-weight: 600; color: #0f172a; }

    /* Bloques de código */
    .md-code { background: #0f172a; color: #e2e8f0; padding: .85em 1.05em; border-radius: 12px; overflow-x: auto; margin: .8em 0; font-size: .82rem; line-height: 1.5; }
    .md-code code { font-family: 'SFMono-Regular', ui-monospace, Menlo, monospace; white-space: pre; background: none; color: inherit; padding: 0; }
    .chat-echart { width: 100%; height: 320px; margin: .8em 0; background: #fff; border: 1px solid #eef2f7; border-radius: 12px; }
  `],
  template: `
    @for (seg of segmentos(); track $index) {
      @switch (seg.kind) {
        @case ('md') { <div class="md-body" [innerHTML]="seg.html ?? ''"></div> }
        @case ('echarts') {
          @if (seg.option) {
            <div echarts [options]="seg.option ?? {}" class="chat-echart"></div>
          } @else {
            <pre class="md-code"><code>{{ seg.raw ?? '' }}</code></pre>
          }
        }
        @case ('code') { <pre class="md-code"><code>{{ seg.code ?? '' }}</code></pre> }
      }
    }
  `,
})
export class MarkdownMessageComponent {
  content = input<string>('');

  segmentos = computed<Segmento[]>(() => this.parse(this.content() ?? ''));

  private parse(text: string): Segmento[] {
    const segs: Segmento[] = [];
    const fence = /```([\w-]*)\r?\n([\s\S]*?)```/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = fence.exec(text)) !== null) {
      const pre = text.slice(last, m.index);
      if (pre.trim()) segs.push({ kind: 'md', html: markdownToHtml(pre) });
      const lang = (m[1] || '').toLowerCase();
      const body = m[2];
      if (lang === 'echarts') {
        segs.push({ kind: 'echarts', option: this.parseOption(body), raw: body });
      } else {
        segs.push({ kind: 'code', code: body.replace(/\s+$/, '') });
      }
      last = fence.lastIndex;
    }
    const rest = text.slice(last);
    if (rest.trim()) segs.push({ kind: 'md', html: markdownToHtml(rest) });
    if (!segs.length) segs.push({ kind: 'md', html: markdownToHtml(text) });
    return segs;
  }

  private parseOption(raw: string): EChartsOption | null {
    try {
      const opt = JSON.parse(raw);
      return (opt && typeof opt === 'object') ? opt as EChartsOption : null;
    } catch {
      return null;
    }
  }
}
