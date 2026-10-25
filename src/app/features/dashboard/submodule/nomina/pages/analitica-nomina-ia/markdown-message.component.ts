import { Component, ChangeDetectionStrategy, ViewEncapsulation, input, output, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { NgxEchartsDirective} from 'ngx-echarts';
import { provideEchartsTema } from '../../../../../../shared/utils/echarts-tema';
import type { EChartsOption } from 'echarts';
import { markdownToHtml } from './markdown-lite';

/** Un segmento único (campos opcionales) para no depender del narrowing de
 *  uniones en la plantilla; `kind` decide cuál se pinta. */
interface Segmento {
  kind: 'md' | 'echarts' | 'code' | 'kpis' | 'filtros' | 'formulario';
  html?: string;
  option?: EChartsOption | null;
  raw?: string;
  code?: string;
  kpis?: Kpi[];
  filtros?: BloqueFiltros;
  formulario?: BloqueFormulario;
}

/** Bloque ```filtros (Avatar Agent): chips con opciones para afinar la consulta. */
interface BloqueFiltros { titulo: string; opciones: { campo: string; etiqueta: string; valores: string[] }[]; }

/** Bloque ```formulario (Avatar Agent): un registro prellenado para terminar en su pantalla. */
interface BloqueFormulario { titulo: string; ruta: string | null; nota?: string; campos: { etiqueta: string; valor: string; opciones?: string[] }[]; }

/** Tarjeta de un bloque ```kpis: [{"etiqueta":"Ventas","valor":"$ 12,3 M","detalle":"+8 %"}]. */
interface Kpi { etiqueta: string; valor: string; detalle?: string; }

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
  providers: [provideEchartsTema()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Sin encapsulación: los estilos deben alcanzar el HTML inyectado con
  // [innerHTML] (tablas, títulos…), que NO recibe los atributos de
  // encapsulación de Angular. Todo va namespaced bajo .md-body/.md-table-wrap/
  // .md-code/.chat-echart, así que no colisiona con el resto de la app.
  encapsulation: ViewEncapsulation.None,
  host: { '(click)': 'alClic($event)' },
  styles: [`
    app-markdown-message { display: block; container-type: inline-size; }
    .md-body {
      font-family: var(--font-sans);
      font-size: .93rem; line-height: 1.62; color: var(--text);
      -webkit-font-smoothing: antialiased; word-break: break-word;
    }
    .md-body :first-child { margin-top: 0; }
    .md-body :last-child { margin-bottom: 0; }

    /* Títulos con jerarquía clara */
    .md-body h1, .md-body h2, .md-body h3, .md-body h4 { margin: 1.05em 0 .45em; line-height: 1.25; font-weight: 700; color: var(--text); letter-spacing: -.01em; }
    .md-body h1 { font-size: 1.3rem; }
    .md-body h2 { font-size: 1.14rem; padding-bottom: .28em; border-bottom: 1px solid var(--border); }
    .md-body h3 { font-size: 1.02rem; }
    .md-body h4 { font-size: .94rem; color: var(--text-2); }

    .md-body p { margin: .55em 0; }
    .md-body strong { font-weight: 700; color: var(--text); }
    .md-body em { color: var(--text-2); }
    .md-body ul, .md-body ol { margin: .5em 0 .5em 1.35em; padding: 0; }
    .md-body li { margin: .28em 0; }
    .md-body li::marker { color: #7C3AED; }
    .md-body a { color: #1565C0; color: light-dark(#1565C0, #9ac4f4); text-decoration: none; font-weight: 600; }
    .md-body a:hover { text-decoration: underline; }
    .md-body blockquote { margin: .7em 0; padding: .5em .9em; border-left: 3px solid #c4b5fd; border-left: 3px solid light-dark(#c4b5fd, #211379); color: var(--text-2); background: var(--surface-2); border-radius: 0 8px 8px 0; }
    .md-body hr { border: none; border-top: 1px solid var(--border); margin: 1em 0; }
    .md-body code { background: rgba(124,58,237,.10); color: #6d28d9; color: light-dark(#6d28d9, #bea0ee); padding: .12em .4em; border-radius: 6px; font-size: .86em; font-family: 'SFMono-Regular', ui-monospace, Menlo, monospace; }

    /* Tablas: encabezado marcado, filas cebra, hover, números tabulares */
    .md-table-wrap { overflow-x: auto; margin: .85em 0; border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
    .md-body table { border-collapse: collapse; width: 100%; font-size: .88rem; min-width: 340px; background: var(--surface); }
    .md-body thead th {
      background: var(--surface-3); color: var(--text-2); font-weight: 700; text-align: left;
      font-size: .74rem; text-transform: uppercase; letter-spacing: .04em;
      padding: .6em .8em; border-bottom: 2px solid var(--border); white-space: nowrap;
    }
    .md-body tbody td {
      padding: .55em .8em; border-bottom: 1px solid var(--border); color: var(--text);
      font-variant-numeric: tabular-nums; vertical-align: top;
    }
    .md-body tbody tr:nth-child(even) td { background: var(--surface-2); }
    .md-body tbody tr:hover td { background: #f3efff; background: light-dark(#f3efff, #19164d); }
    .md-body tbody tr:last-child td { border-bottom: none; }
    .md-body tbody td:first-child { font-weight: 600; color: var(--text); }
    /* Columnas numéricas (montos / cantidades): alineadas a la derecha, como el desprendible */
    .md-body th.md-num, .md-body td.md-num { text-align: right; white-space: nowrap; }
    .md-body tbody td.md-num { font-weight: 600; color: var(--text); }

    /* Bloques de código */
    .md-code { background: #0f172a; color: #e2e8f0; padding: .85em 1.05em; border-radius: 12px; overflow-x: auto; margin: .8em 0; font-size: .82rem; line-height: 1.5; }
    .md-code code { font-family: 'SFMono-Regular', ui-monospace, Menlo, monospace; white-space: pre; background: none; color: inherit; padding: 0; }
    .chat-echart { width: 100%; height: 320px; margin: .8em 0; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
    /* En un panel angosto (chat flotante, celular) la gráfica baja de alto para no ocupar toda la vista. */
    @container (max-width: 520px) { .chat-echart { height: 260px; } }

    /* Enlaces a pantallas de la app: los abre el Router. */
    .md-body a.md-int { display: inline-flex; align-items: center; gap: .2em; padding: 0 .35em; border-radius: 6px;
      background: rgba(43,89,240,.08); background: light-dark(rgba(43,89,240,.08), rgba(154,196,244,.12)); }
    .md-body a.md-int::after { content: '→'; font-weight: 700; }

    /* Listas de tareas: - [ ] / - [x] */
    .md-body li.md-task { list-style: none; margin-left: -1.2em; display: flex; gap: .5em; align-items: flex-start; }
    .md-body .md-check { flex: none; width: 1.05em; height: 1.05em; margin-top: .22em; border-radius: 4px; border: 1.5px solid #7C3AED;
      display: inline-grid; place-items: center; font-size: .72em; line-height: 1; color: #fff; }
    .md-body li.md-task.hecha .md-check { background: #7C3AED; }
    .md-body li.md-task.hecha { color: var(--text-2); text-decoration: line-through; }

    /* Bloque de código con botón de copiar */
    .md-code-wrap { position: relative; }
    .md-copiar { position: absolute; top: .45em; right: .45em; min-height: 0 !important; padding: .2em .6em; border: 1px solid rgba(255,255,255,.2);
      border-radius: 6px; background: #1e293b; color: #e2e8f0; font-size: .72rem; cursor: pointer; opacity: .75; }
    .md-copiar:hover { opacity: 1; }

    /* Tarjetas de indicadores (bloque kpis) */
    .md-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr)); gap: .55em; margin: .8em 0; }
    .md-kpi { padding: .7em .85em; border-radius: 12px; background: var(--surface); border: 1px solid var(--border);
      box-shadow: inset 3px 0 0 #7C3AED; display: flex; flex-direction: column; gap: .15em; min-width: 0; }
    .md-kpi-e { font-size: .7rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); }
    .md-kpi-v { font-size: 1.25rem; font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .md-kpi-d { font-size: .78rem; color: var(--text-2); }

    /* Filtros (bloque filtros) */
    .md-filtros { margin: .8em 0 .2em; display: flex; flex-direction: column; gap: .45em; }
    .md-filtros-t { font-size: .74rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--text-2); }
    .md-filtro { display: flex; flex-wrap: wrap; align-items: center; gap: .35em; }
    .md-filtro-e { font-size: .8rem; color: var(--text-2); margin-right: .2em; }
    .md-chip {
      border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px;
      padding: .25em .75em; font: inherit; font-size: .8rem; cursor: pointer; transition: background .15s, border-color .15s;
    }
    .md-chip:hover:not(:disabled) { border-color: var(--primary, #4F46E5); background: color-mix(in srgb, var(--primary, #4F46E5) 8%, var(--surface)); }
    .md-chip:disabled { opacity: .55; cursor: default; }

    /* Registro prellenado (bloque formulario) */
    .md-form { margin: .8em 0; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--surface); }
    .md-form-cab { display: flex; align-items: center; gap: .5em; padding: .6em .85em; font-weight: 700; border-bottom: 1px solid var(--border); }
    .md-form-cab span { flex: 1; min-width: 0; }
    .md-form-campos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: .55em .9em; padding: .75em .85em; }
    .md-form-campo { display: flex; flex-direction: column; gap: .15em; min-width: 0; }
    .md-form-campo small { font-size: .74rem; color: var(--text-2); }
    .md-form-campo b { font-weight: 600; overflow-wrap: anywhere; }
    .md-form-campo em { font-size: .74rem; }
    .md-form-nota { margin: 0; padding: 0 .85em .7em; font-size: .8rem; color: var(--text-2); }
    .md-form-pie { display: flex; flex-wrap: wrap; gap: .5em; justify-content: flex-end; padding: .6em .85em; border-top: 1px solid var(--border); }
    .md-boton {
      border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 8px;
      padding: .4em .85em; font: inherit; font-size: .82rem; font-weight: 600; cursor: pointer;
    }
    .md-boton--primario { background: var(--primary, #4F46E5); border-color: var(--primary, #4F46E5); color: #fff; }
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
        @case ('code') {
          <div class="md-code-wrap">
            <button type="button" class="md-copiar" (click)="copiar(seg.code ?? '', $index)">{{ copiado() === $index ? 'Copiado' : 'Copiar' }}</button>
            <pre class="md-code"><code>{{ seg.code ?? '' }}</code></pre>
          </div>
        }
        @case ('filtros') {
          <div class="md-filtros">
            <span class="md-filtros-t">{{ seg.filtros?.titulo }}</span>
            @for (f of seg.filtros?.opciones ?? []; track f.campo) {
              <div class="md-filtro" role="group" [attr.aria-label]="f.etiqueta">
                <span class="md-filtro-e">{{ f.etiqueta }}:</span>
                @for (v of f.valores; track v) {
                  <button type="button" class="md-chip" [disabled]="!interactivo()" (click)="pregunta.emit('Muéstramelo con ' + f.etiqueta.toLowerCase() + ': ' + v)">{{ v }}</button>
                }
              </div>
            }
          </div>
        }
        @case ('formulario') {
          <div class="md-form">
            <div class="md-form-cab"><span>{{ seg.formulario?.titulo }}</span></div>
            <div class="md-form-campos">
              @for (c of seg.formulario?.campos ?? []; track $index) {
                <div class="md-form-campo">
                  <small>{{ c.etiqueta }}</small>
                  <b>{{ c.valor || '—' }}</b>
                  @if (c.opciones?.length) { <em>Opciones: {{ c.opciones!.join(' · ') }}</em> }
                </div>
              }
            </div>
            @if (seg.formulario?.nota) { <p class="md-form-nota">{{ seg.formulario?.nota }}</p> }
            <div class="md-form-pie">
              <button type="button" class="md-boton" (click)="copiar(textoFormulario(seg.formulario!), $index)">{{ copiado() === $index ? 'Copiado' : 'Copiar datos' }}</button>
              @if (seg.formulario?.ruta) {
                <button type="button" class="md-boton md-boton--primario" (click)="abrirFormulario(seg.formulario!)">Ir a registrarlo</button>
              }
            </div>
          </div>
        }
        @case ('kpis') {
          <div class="md-kpis">
            @for (k of seg.kpis ?? []; track $index) {
              <div class="md-kpi">
                <span class="md-kpi-e">{{ k.etiqueta }}</span>
                <span class="md-kpi-v">{{ k.valor }}</span>
                @if (k.detalle) { <span class="md-kpi-d">{{ k.detalle }}</span> }
              </div>
            }
          </div>
        }
      }
    }
  `,
})
export class MarkdownMessageComponent {
  private router = inject(Router);
  content = input<string>('');
  /** Si los chips de filtros pueden mandar una pregunta nueva (Avatar Agent). */
  interactivo = input(false);
  /** La pregunta que arma un chip de filtros; el chat la envía. */
  readonly pregunta = output<string>();
  /** Bloque de código recién copiado (para el texto del botón). */
  readonly copiado = signal<number | null>(null);

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
      // Un ```json que trae `series` ES una gráfica: el modelo a veces la
      // rotula json en vez de echarts, y se pintaba como código.
      const comoGrafica = lang === 'json' ? this.parseOption(body) : null;
      const kpis = lang === 'kpis' ? this.parseKpis(body) : null;
      const filtros = lang === 'filtros' ? this.parseFiltros(body) : null;
      const formulario = lang === 'formulario' ? this.parseFormulario(body) : null;
      if (filtros) {
        segs.push({ kind: 'filtros', filtros });
      } else if (formulario) {
        segs.push({ kind: 'formulario', formulario });
      } else if (lang === 'filtros' || lang === 'formulario') {
        // Bloque mal formado: no se muestra el JSON crudo.
      } else if (kpis) {
        segs.push({ kind: 'kpis', kpis });
      } else if (lang === 'echarts') {
        segs.push({ kind: 'echarts', option: this.parseOption(body), raw: body });
      } else if (comoGrafica && 'series' in comoGrafica) {
        segs.push({ kind: 'echarts', option: comoGrafica, raw: body });
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

  /** Enlaces a pantallas de la app (class md-int): navegan con el Router, sin recargar. */
  alClic(e: MouseEvent): void {
    const a = (e.target as HTMLElement | null)?.closest?.('a.md-int') as HTMLAnchorElement | null;
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    const ruta = a.getAttribute('href') ?? '';
    if (!ruta.startsWith('/') || ruta.startsWith('//')) return;
    e.preventDefault();
    void this.router.navigateByUrl(ruta);
  }

  copiar(texto: string, i: number): void {
    void navigator.clipboard?.writeText(texto).then(() => {
      this.copiado.set(i);
      setTimeout(() => { if (this.copiado() === i) this.copiado.set(null); }, 1500);
    }).catch(() => undefined);
  }

  /** El formulario prellenado lleva a su pantalla con los datos en el estado de la navegación. */
  abrirFormulario(f: BloqueFormulario): void {
    if (!f.ruta) return;
    const datos = Object.fromEntries(f.campos.map((c) => [c.etiqueta, c.valor]));
    void navigator.clipboard?.writeText(this.textoFormulario(f)).catch(() => undefined);
    void this.router.navigateByUrl(f.ruta, { state: { prellenado: datos, origen: 'avatar-agent' } });
  }

  textoFormulario(f: BloqueFormulario): string {
    return f.campos.map((c) => `${c.etiqueta}: ${c.valor}`).join('\n');
  }

  private parseFiltros(raw: string): BloqueFiltros | null {
    try {
      const v = JSON.parse(raw);
      const opciones = (Array.isArray(v?.opciones) ? v.opciones : Array.isArray(v) ? v : [])
        .map((o: Record<string, unknown>) => ({
          campo: String(o['campo'] ?? o['etiqueta'] ?? ''),
          etiqueta: String(o['etiqueta'] ?? o['campo'] ?? ''),
          valores: (Array.isArray(o['valores']) ? o['valores'] : []).map((x: unknown) => String(x)).filter(Boolean).slice(0, 12),
        }))
        .filter((o: { etiqueta: string; valores: string[] }) => o.etiqueta && o.valores.length)
        .slice(0, 4);
      return opciones.length ? { titulo: String(v?.titulo ?? 'Afinar'), opciones } : null;
    } catch {
      return null;
    }
  }

  private parseFormulario(raw: string): BloqueFormulario | null {
    try {
      const v = JSON.parse(raw);
      const campos = (Array.isArray(v?.campos) ? v.campos : [])
        .map((c: Record<string, unknown>) => ({
          etiqueta: String(c['etiqueta'] ?? c['campo'] ?? ''),
          valor: c['valor'] == null ? '' : String(c['valor']),
          opciones: Array.isArray(c['opciones']) ? c['opciones'].map((x: unknown) => String(x)).slice(0, 12) : undefined,
        }))
        .filter((c: { etiqueta: string }) => c.etiqueta)
        .slice(0, 30);
      if (!campos.length) return null;
      // Solo rutas internas de la app: nada de enlaces externos desde la IA.
      const ruta = typeof v.ruta === 'string' && v.ruta.startsWith('/') && !v.ruta.startsWith('//') ? v.ruta : null;
      return { titulo: String(v.titulo ?? 'Registro'), ruta, nota: v.nota ? String(v.nota) : undefined, campos };
    } catch {
      return null;
    }
  }

  private parseKpis(raw: string): Kpi[] | null {
    try {
      const v = JSON.parse(raw);
      const lista = Array.isArray(v) ? v : Array.isArray(v?.kpis) ? v.kpis : null;
      if (!lista?.length) return null;
      return lista.slice(0, 6).map((k: Record<string, unknown>) => ({
        etiqueta: String(k['etiqueta'] ?? k['label'] ?? ''),
        valor: String(k['valor'] ?? k['value'] ?? ''),
        detalle: k['detalle'] != null ? String(k['detalle']) : undefined,
      }));
    } catch {
      return null;
    }
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
