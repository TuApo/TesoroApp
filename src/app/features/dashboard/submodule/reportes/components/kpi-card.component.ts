import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConfigVisualizacion, ResultadoConsulta } from '../models/reportes.models';

/**
 * Tarjeta de indicador (§17).
 *
 * Toma el resultado de un reporte y muestra UN número grande. Si el reporte trae
 * una segunda métrica comparable (el periodo anterior), calcula la variación y la
 * pinta con su tendencia — que es lo que convierte un número en información.
 */
@Component({
  selector: 'app-kpi-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  template: `
  <div class="kpi" [class.kpi--cargando]="cargando()">
    <div class="kpi__top">
      @if (icono()) { <mat-icon class="kpi__ico">{{ icono() }}</mat-icon> }
      <span class="kpi__lbl">{{ etiqueta() }}</span>
    </div>

    @if (cargando()) {
      <div class="kpi__skel"></div>
    } @else {
      <div class="kpi__valor" [matTooltip]="valorExacto()">
        {{ valorTexto() }}<small>{{ sufijo() }}</small>
      </div>

      @if (variacion() !== null) {
        <div class="kpi__delta" [class.kpi__delta--sube]="(variacion() ?? 0) >= 0"
             [class.kpi__delta--baja]="(variacion() ?? 0) < 0">
          <mat-icon>{{ (variacion() ?? 0) >= 0 ? 'trending_up' : 'trending_down' }}</mat-icon>
          <span>{{ variacionTexto() }}</span>
          <em>vs. anterior</em>
        </div>
      } @else if (subtitulo()) {
        <div class="kpi__sub">{{ subtitulo() }}</div>
      }
    }
  </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .kpi {
      height: 100%; display: flex; flex-direction: column; gap: .3rem;
      padding: 1rem 1.1rem; border-radius: 16px;
      background: var(--rp-kpi-bg, #fff);
      border: 1px solid var(--rp-borde, #e2e8f0);
      box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
      transition: box-shadow .2s ease, transform .2s ease;
    }
    .kpi:hover { box-shadow: 0 8px 20px -8px rgba(15, 23, 42, .18); transform: translateY(-1px); }
    @media (prefers-reduced-motion: reduce) { .kpi { transition: none; } .kpi:hover { transform: none; } }

    .kpi__top { display: flex; align-items: center; gap: .35rem; }
    .kpi__ico { font-size: 18px; width: 18px; height: 18px; color: #0284c7; }
    .kpi__lbl {
      font-size: .74rem; font-weight: 600; color: var(--rp-texto-suave, #64748b);
      text-transform: uppercase; letter-spacing: .03em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    .kpi__valor {
      font-size: clamp(1.6rem, 3.2vw, 2.15rem); font-weight: 800; line-height: 1.1;
      color: var(--rp-texto, #0f172a); font-variant-numeric: tabular-nums;
      letter-spacing: -.02em;
    }
    .kpi__valor small { font-size: .5em; font-weight: 600; color: #94a3b8; margin-left: .2rem; }

    .kpi__delta {
      display: inline-flex; align-items: center; gap: .2rem; font-size: .76rem; font-weight: 600;
    }
    .kpi__delta mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .kpi__delta em { font-style: normal; font-weight: 400; color: #94a3b8; margin-left: .15rem; }
    .kpi__delta--sube { color: #059669; }
    .kpi__delta--baja { color: #dc2626; }
    .kpi__sub { font-size: .76rem; color: #94a3b8; }

    .kpi__skel {
      height: 34px; width: 60%; border-radius: 8px;
      background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%);
      background-size: 400% 100%; animation: brillo 1.3s ease-in-out infinite;
    }
    @keyframes brillo { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
    @media (prefers-reduced-motion: reduce) { .kpi__skel { animation: none; } }

    :host-context(.dark-theme) {
      --rp-kpi-bg: #1e293b; --rp-borde: #334155; --rp-texto: #f1f5f9; --rp-texto-suave: #94a3b8;
    }
  `],
})
export class KpiCardComponent {

  readonly resultado = input<ResultadoConsulta | null>(null);
  readonly config = input<ConfigVisualizacion>({ tipo: 'KPI' });
  readonly cargando = input(false);
  readonly titulo = input<string | null>(null);

  readonly etiqueta = computed(() =>
    this.config().titulo || this.titulo() || this.columnaMetrica()?.alias || 'Indicador');

  readonly subtitulo = computed(() => this.config().subtitulo ?? '');
  readonly sufijo = computed(() => this.config().kpi_sufijo ?? '');
  readonly icono = computed(() => this.config().kpi_icono ?? 'insights');

  private readonly columnaMetrica = computed(() => {
    const r = this.resultado();
    if (!r) return null;
    const id = this.config().kpi_metrica ?? this.config().metricas?.[0];
    if (id) return r.columnas.find(c => c.id === id) ?? null;
    // Sin configurar: la primera agregación, y si no hay, la primera numérica.
    return r.columnas.find(c => c.es_agregacion)
        ?? r.columnas.find(c => ['currency', 'decimal', 'integer', 'percent'].includes(c.formato ?? ''))
        ?? null;
  });

  /**
   * Valor del indicador.
   *
   * Con una sola fila (un total general) es ese número. Con varias, se SUMAN: un
   * KPI construido sobre "contrataciones por empresa" debe mostrar el total de
   * contrataciones, no el de la primera empresa de la lista.
   */
  private readonly valor = computed<number | null>(() => {
    const r = this.resultado();
    const col = this.columnaMetrica();
    if (!r || !col) return null;
    if (!r.filas.length) return 0;
    if (r.filas.length === 1) return Number(r.filas[0][col.id] ?? 0);
    return r.filas.reduce((acc, f) => acc + (Number(f[col.id]) || 0), 0);
  });

  private readonly valorAnterior = computed<number | null>(() => {
    const r = this.resultado();
    const id = this.config().kpi_comparacion;
    if (!r || !id || !r.filas.length) return null;
    if (r.filas.length === 1) return Number(r.filas[0][id] ?? 0);
    return r.filas.reduce((acc, f) => acc + (Number(f[id]) || 0), 0);
  });

  readonly variacion = computed<number | null>(() => {
    const actual = this.valor();
    const anterior = this.valorAnterior();
    if (actual === null || anterior === null || anterior === 0) return null;
    return ((actual - anterior) / Math.abs(anterior)) * 100;
  });

  readonly variacionTexto = computed(() => {
    const v = this.variacion();
    if (v === null) return '';
    const signo = v >= 0 ? '+' : '';
    return `${signo}${v.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
  });

  readonly valorTexto = computed(() => {
    const v = this.valor();
    if (v === null) return '—';
    const formato = this.config().formato_numero ?? this.columnaMetrica()?.formato ?? 'integer';
    if (formato === 'currency') {
      return v.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
    }
    if (formato === 'percent') return `${v.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
    if (formato === 'decimal') return v.toLocaleString('es-CO', { maximumFractionDigits: 2 });
    return v.toLocaleString('es-CO', { maximumFractionDigits: 0 });
  });

  readonly valorExacto = computed(() => {
    const v = this.valor();
    return v === null ? '' : v.toLocaleString('es-CO', { maximumFractionDigits: 4 });
  });
}
