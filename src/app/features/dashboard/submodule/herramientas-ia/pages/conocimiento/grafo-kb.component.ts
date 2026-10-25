import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';

import { provideEchartsTema } from '../../../../../../shared/utils/echarts-tema';
import { GrafoDto, NodoDto } from '../../service/conocimiento.service';

/**
 * Red semántica de la base de conocimiento pintada con el grafo de fuerzas de ECharts.
 * Las categorías vienen del backend con prefijo: modulo, base, base-relacionada, seccion y
 * concepto:<tipo>. Los conceptos se agrupan por tipo con colores fijos (no se reciclan), así
 * «proceso» o «norma» se reconocen igual en la vista de una base y en la global.
 */
const CATEGORIAS: { clave: string; nombre: string; color: string }[] = [
  { clave: 'modulo', nombre: 'Módulo', color: '#2B59F0' },
  { clave: 'base', nombre: 'Base', color: '#7C3AED' },
  { clave: 'base-relacionada', nombre: 'Base relacionada', color: '#C4B5FD' },
  { clave: 'seccion', nombre: 'Sección', color: '#94A3B8' },
  { clave: 'concepto:proceso', nombre: 'Proceso', color: '#0EA5A4' },
  { clave: 'concepto:norma', nombre: 'Norma', color: '#E11D48' },
  { clave: 'concepto:rol', nombre: 'Rol', color: '#F59E0B' },
  { clave: 'concepto:sistema', nombre: 'Sistema', color: '#0284C7' },
  { clave: 'concepto:documento', nombre: 'Documento', color: '#65A30D' },
  { clave: 'concepto:regla', nombre: 'Regla', color: '#DB2777' },
  { clave: 'concepto:dato', nombre: 'Dato', color: '#64748B' },
  { clave: 'concepto:indicador', nombre: 'Indicador', color: '#EA580C' },
  { clave: 'concepto:organizacion', nombre: 'Organización', color: '#4F46E5' },
  { clave: 'concepto:concepto', nombre: 'Concepto', color: '#14B8A6' },
];

export function colorCategoria(cat: string): string {
  return CATEGORIAS.find((c) => c.clave === cat)?.color ?? '#14B8A6';
}

export function nombreCategoria(cat: string): string {
  return CATEGORIAS.find((c) => c.clave === cat)?.nombre ?? cat.replace('concepto:', '');
}

@Component({
  selector: 'app-grafo-kb',
  standalone: true,
  imports: [NgxEchartsDirective, MatIconModule],
  providers: [provideEchartsTema()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (vacio()) {
      <div class="vacio">
        <mat-icon>hub</mat-icon>
        <p>{{ mensajeVacio() }}</p>
      </div>
    } @else {
      <div echarts class="lienzo" [options]="opciones()" [style.height.px]="alto()"
           (chartClick)="alClic($event)" role="img" aria-label="Red semántica de la base de conocimiento"></div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .lienzo { width: 100%; }
    .vacio { display: grid; place-items: center; text-align: center; gap: 6px; min-height: 220px; color: var(--muted); padding: 24px; }
    .vacio mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
    .vacio p { margin: 0; font-size: .86rem; max-width: 420px; }
  `],
})
export class GrafoKbComponent {
  readonly grafo = input<GrafoDto | null>(null);
  readonly alto = input<number>(520);
  /** Nombre visible de un nodo de módulo (m:clave → «Nómina»). */
  readonly nombresModulo = input<Record<string, string>>({});
  readonly mensajeVacio = input<string>('Todavía no hay red semántica para mostrar.');
  readonly nodo = output<NodoDto>();

  readonly vacio = computed(() => !this.grafo() || this.grafo()!.nodos.length === 0);

  readonly opciones = computed<EChartsOption>(() => {
    const g = this.grafo();
    if (!g) return {};
    const usadas = new Set(g.nodos.map((n) => n.categoria));
    const cats = CATEGORIAS.filter((c) => usadas.has(c.clave));
    // Categorías que el backend mande y no estén en la lista fija, al final.
    for (const u of usadas) if (!cats.some((c) => c.clave === u)) cats.push({ clave: u, nombre: nombreCategoria(u), color: '#14B8A6' });
    const indice = new Map(cats.map((c, i) => [c.clave, i]));
    const nombres = this.nombresModulo();
    const muchos = g.nodos.length > 140;

    return {
      tooltip: {
        confine: true,
        formatter: (p: any) => {
          if (p.dataType === 'edge') return `${p.data.sourceName} <b>${p.data.tipo}</b> ${p.data.targetName}`;
          const d = p.data as any;
          const detalle = d.detalle ? `<div style="max-width:320px;white-space:normal;margin-top:4px;opacity:.85">${escapar(d.detalle).slice(0, 280)}</div>` : '';
          return `<b>${escapar(d.name)}</b><div style="opacity:.7">${nombreCategoria(d.categoria)}</div>${detalle}`;
        },
      },
      legend: [{ data: cats.map((c) => c.nombre), type: 'scroll', bottom: 0, textStyle: { fontSize: 11 } }],
      animationDuration: 600,
      series: [{
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        categories: cats.map((c) => ({ name: c.nombre, itemStyle: { color: c.color } })),
        force: { repulsion: muchos ? 90 : 180, edgeLength: [40, 140], gravity: 0.08, friction: 0.2 },
        label: { show: true, position: 'right', fontSize: 11, formatter: (p: any) => recortar(p.name, 28) },
        labelLayout: { hideOverlap: true },
        emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
        lineStyle: { color: 'source', opacity: 0.35, curveness: 0.12 },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 5,
        data: g.nodos.map((n) => ({
          id: n.id,
          name: n.categoria === 'modulo' ? (nombres[n.id.slice(2)] ?? n.nombre) : n.nombre,
          value: n.valor,
          symbolSize: Math.max(6, Math.min(70, n.valor)),
          category: indice.get(n.categoria) ?? 0,
          categoria: n.categoria,
          detalle: n.detalle,
          documentoId: n.documentoId,
          symbol: n.categoria === 'modulo' ? 'roundRect' : n.categoria === 'seccion' ? 'diamond' : 'circle',
          label: { show: n.valor >= (muchos ? 30 : 14) || n.categoria === 'modulo' },
        })),
        links: g.enlaces.map((e) => ({
          source: e.origen,
          target: e.destino,
          tipo: e.tipo,
          sourceName: nombreNodo(g, e.origen),
          targetName: nombreNodo(g, e.destino),
          lineStyle: { width: Math.min(4, 0.6 + e.peso * 0.5) },
        })),
      }],
    } as EChartsOption;
  });

  alClic(ev: any): void {
    if (ev?.dataType !== 'node') return;
    const d = ev.data;
    this.nodo.emit({ id: d.id, nombre: d.name, categoria: d.categoria, valor: d.value, detalle: d.detalle, documentoId: d.documentoId });
  }
}

function nombreNodo(g: GrafoDto, id: string): string {
  return g.nodos.find((n) => n.id === id)?.nombre ?? id;
}

function recortar(s: string, n: number): string {
  return s && s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapar(s: string): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
