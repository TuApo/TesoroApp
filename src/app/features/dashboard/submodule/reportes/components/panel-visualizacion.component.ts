import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { ConstructorStore, TRANSFORMACIONES_FECHA } from '../services/constructor.store';
import { ReportesApiService } from '../services/reportes-api.service';
import { Agregacion, CampoCatalogo, FieldSpec, TipoVisualizacion } from '../models/reportes.models';

/**
 * Configuración de la visualización (§15, §16).
 *
 * Es un EDITOR, no un selector: aquí se crean la dimensión y las métricas, no solo
 * se eligen entre las que ya existan. Antes el panel solo listaba columnas que ya
 * tuvieran una agregación, así que con un reporte de columnas de texto y fecha no
 * había ninguna métrica posible y la gráfica nunca podía pintarse — te mandaba al
 * explorador a crearla, que es justo lo que no debe pasar estando en este panel.
 *
 * La métrica por defecto es «cantidad de registros» (COUNT(*)), que es lo que pide
 * la mayoría de los reportes y no depende de que haya una columna numérica.
 */
@Component({
  selector: 'app-panel-visualizacion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatMenuModule,
    MatTooltipModule, MatFormFieldModule, MatSelectModule, MatInputModule,
    MatSlideToggleModule, MatButtonToggleModule, MatDividerModule],
  templateUrl: './panel-visualizacion.component.html',
  styleUrls: ['./panel-visualizacion.component.css'],
})
export class PanelVisualizacionComponent {

  readonly store = inject(ConstructorStore);
  private api = inject(ReportesApiService);

  readonly transformaciones = TRANSFORMACIONES_FECHA;

  readonly tipos: { valor: TipoVisualizacion; etiqueta: string; icono: string; ayuda: string }[] = [
    { valor: 'TABLA', etiqueta: 'Tabla', icono: 'table_rows', ayuda: 'El detalle fila por fila' },
    { valor: 'KPI', etiqueta: 'Indicador', icono: 'speed', ayuda: 'Un número grande con su variación' },
    { valor: 'BARRAS', etiqueta: 'Barras', icono: 'bar_chart', ayuda: 'Comparar categorías' },
    { valor: 'BARRAS_HORIZONTAL', etiqueta: 'Barras H.', icono: 'align_horizontal_left', ayuda: 'Mejor con nombres largos' },
    { valor: 'BARRAS_APILADAS', etiqueta: 'Apiladas', icono: 'stacked_bar_chart', ayuda: 'Composición dentro de cada categoría' },
    { valor: 'LINEA', etiqueta: 'Línea', icono: 'show_chart', ayuda: 'Evolución en el tiempo' },
    { valor: 'AREA', etiqueta: 'Área', icono: 'area_chart', ayuda: 'Evolución con volumen' },
    { valor: 'CIRCULAR', etiqueta: 'Circular', icono: 'pie_chart', ayuda: 'Proporción sobre el total' },
    { valor: 'DONA', etiqueta: 'Dona', icono: 'donut_large', ayuda: 'Proporción con el total al centro' },
    { valor: 'DISPERSION', etiqueta: 'Dispersión', icono: 'scatter_plot', ayuda: 'Relación entre dos métricas' },
    { valor: 'FUNNEL', etiqueta: 'Embudo', icono: 'filter_alt', ayuda: 'Etapas de un proceso' },
    { valor: 'TREEMAP', etiqueta: 'Treemap', icono: 'dashboard', ayuda: 'Peso relativo por bloques' },
  ];

  readonly esTabla = computed(() => this.store.visualizacion().tipo === 'TABLA');
  readonly esKpi = computed(() => this.store.visualizacion().tipo === 'KPI');

  readonly admiteOrientacion = computed(() => {
    const t = this.store.visualizacion().tipo;
    return t === 'BARRAS' || t === 'BARRAS_APILADAS' || t === 'COLUMNAS';
  });

  /** Solo estas gráficas saben pintar más de una serie a la vez. */
  readonly admiteSerie = computed(() => {
    const t = this.store.visualizacion().tipo;
    return t === 'BARRAS_APILADAS' || t === 'LINEA' || t === 'AREA' || t === 'BARRAS';
  });

  readonly admiteVariasMetricas = computed(() => {
    const t = this.store.visualizacion().tipo;
    return !['CIRCULAR', 'DONA', 'FUNNEL', 'TREEMAP'].includes(t);
  });

  // ─────────────────────── qué hay puesto ahora ───────────────────────

  readonly dimension = computed<FieldSpec | null>(() => {
    const id = this.store.visualizacion().dimension;
    return this.store.fields().find(f => f.id === id) ?? null;
  });

  readonly serie = computed<FieldSpec | null>(() => {
    const id = this.store.visualizacion().serie;
    return this.store.fields().find(f => f.id === id) ?? null;
  });

  readonly metricas = computed<FieldSpec[]>(() => {
    const ids = this.store.visualizacion().metricas ?? [];
    return ids.map(id => this.store.fields().find(f => f.id === id))
      .filter((f): f is FieldSpec => !!f);
  });

  readonly metricaKpi = computed<FieldSpec | null>(() => {
    const id = this.store.visualizacion().kpi_metrica;
    return this.store.fields().find(f => f.id === id) ?? null;
  });

  /**
   * Columnas que NO usa la gráfica pero sí parten los datos.
   *
   * Con una agregación, toda columna sin cálculo entra al GROUP BY aunque esté
   * oculta. Una columna de más multiplica los grupos y la gráfica sale con decenas
   * de barras minúsculas: es el error más común y el más difícil de diagnosticar
   * mirando el resultado.
   */
  readonly columnasQueSobran = computed<FieldSpec[]>(() => {
    if (this.esTabla()) return [];
    const v = this.store.visualizacion();
    const usados = new Set([v.dimension, v.serie, v.kpi_metrica, v.kpi_comparacion,
      ...(v.metricas ?? [])].filter(Boolean));
    return this.store.fields().filter(f => !f.agregacion && !usados.has(f.id));
  });

  // ─────────────────────── campos disponibles ───────────────────────

  /** Campos del catálogo agrupados por tabla, para los menús de añadir. */
  readonly camposPorTabla = computed(() => {
    const mapa = this.api.datasetsPorClave();
    return this.store.datasetsUsados().map(clave => {
      const d = mapa.get(clave);
      return {
        clave,
        nombre: d?.nombre ?? clave,
        icono: d?.icono ?? 'table_chart',
        campos: d?.campos ?? [],
      };
    }).filter(t => t.campos.length);
  });

  /** Los que pueden agruparse: sirven como dimensión o como serie. */
  camposDimension(campos: CampoCatalogo[]): CampoCatalogo[] {
    return campos.filter(c => c.agrupable);
  }

  /** Los que pueden sumarse o promediarse. COUNT vale sobre cualquiera. */
  camposMetrica(campos: CampoCatalogo[]): CampoCatalogo[] {
    return campos.filter(c => c.agregable);
  }

  // ─────────────────────── acciones ───────────────────────

  fijarTipo(t: TipoVisualizacion): void {
    this.store.fijarVisualizacion({ tipo: t });
    // Al pasar de tabla a gráfica, si ya hay algo obvio que usar se propone solo:
    // llegar a un lienzo vacío con dos desplegables en blanco no ayuda a nadie.
    if (t !== 'TABLA') this.autocompletar();
  }

  /** Rellena dimensión y métrica con lo más razonable que haya en el reporte. */
  private autocompletar(): void {
    const v = this.store.visualizacion();
    const campos = this.store.fields();
    if (!v.dimension) {
      const candidata = campos.find(f => !f.agregacion && f.visible);
      if (candidata) this.store.fijarVisualizacion({ dimension: candidata.id });
    }
    if (this.esKpi()) {
      if (!v.kpi_metrica) {
        const m = campos.find(f => !!f.agregacion);
        if (m) this.store.fijarVisualizacion({ kpi_metrica: m.id });
      }
      return;
    }
    if (!(v.metricas ?? []).length) {
      const existentes = campos.filter(f => !!f.agregacion).map(f => f.id);
      if (existentes.length) this.store.fijarVisualizacion({ metricas: existentes });
    }
  }

  elegirDimension(campo: CampoCatalogo): void {
    const id = this.store.agregarCampo(campo);
    this.store.fijarVisualizacion({ dimension: id });
  }

  usarComoDimension(f: FieldSpec): void {
    this.store.fijarVisualizacion({ dimension: f.id });
  }

  quitarDimension(): void {
    this.store.fijarVisualizacion({ dimension: null });
  }

  elegirSerie(campo: CampoCatalogo): void {
    const id = this.store.agregarCampo(campo);
    this.store.fijarVisualizacion({ serie: id });
  }

  quitarSerie(): void {
    this.store.fijarVisualizacion({ serie: null });
  }

  /** Agrupación temporal de la dimensión cuando es una fecha (por día, mes, año…). */
  cambiarAgrupacionFecha(valor: string): void {
    const d = this.dimension();
    if (!d) return;
    this.store.actualizarCampo(d.id, { transformacion: (valor || null) as never });
  }

  esFecha(f: FieldSpec | null): boolean {
    if (!f?.campo) return false;
    const c = this.api.camposPorClave().get(f.campo);
    return c?.tipo === 'FECHA' || c?.tipo === 'FECHA_HORA';
  }

  agregarConteo(): void {
    const id = this.store.agregarConteoRegistros();
    this.asignarMetrica(id);
  }

  agregarMetrica(campo: CampoCatalogo, agg: Agregacion): void {
    const id = this.store.agregarMetrica(campo, agg);
    this.asignarMetrica(id);
  }

  usarComoMetrica(f: FieldSpec): void {
    this.asignarMetrica(f.id);
  }

  private asignarMetrica(id: string): void {
    if (this.esKpi()) {
      this.store.fijarVisualizacion({ kpi_metrica: id });
      return;
    }
    const actuales = this.store.visualizacion().metricas ?? [];
    if (actuales.includes(id)) return;
    // Circular, dona, embudo y treemap solo pintan UNA métrica: sustituirla es más
    // predecible que añadirla y que la gráfica ignore la segunda en silencio.
    const nuevas = this.admiteVariasMetricas() ? [...actuales, id] : [id];
    this.store.fijarVisualizacion({ metricas: nuevas });
  }

  quitarMetrica(id: string): void {
    if (this.esKpi()) {
      this.store.fijarVisualizacion({ kpi_metrica: null });
      return;
    }
    this.store.fijarVisualizacion({
      metricas: (this.store.visualizacion().metricas ?? []).filter(m => m !== id),
    });
  }

  limpiarParaGrafica(): void {
    this.store.dejarSoloLoDeLaGrafica();
  }

  /** Nombres de las columnas que sobran, para nombrarlas en el aviso. */
  nombresQueSobran(): string {
    const nombres = this.columnasQueSobran().map(f => f.alias);
    if (nombres.length <= 3) return nombres.join(', ');
    return `${nombres.slice(0, 3).join(', ')} y ${nombres.length - 3} más`;
  }

  /** Métricas ya presentes en el reporte que aún no están en la gráfica. */
  readonly metricasDisponibles = computed<FieldSpec[]>(() => {
    const puestas = new Set([...(this.store.visualizacion().metricas ?? []),
      this.store.visualizacion().kpi_metrica].filter(Boolean));
    return this.store.fields().filter(f => !!f.agregacion && !puestas.has(f.id));
  });

  /** Columnas del reporte que podrían servir de dimensión y no están puestas. */
  readonly dimensionesDisponibles = computed<FieldSpec[]>(() => {
    const v = this.store.visualizacion();
    return this.store.fields().filter(f => !f.agregacion && f.id !== v.dimension && f.id !== v.serie);
  });

  rotuloAgregacion(a: string): string {
    const mapa: Record<string, string> = {
      COUNT: 'Contar', COUNT_DISTINCT: 'Contar distintos',
      SUM: 'Sumar', AVG: 'Promedio', MIN: 'Mínimo', MAX: 'Máximo',
    };
    return mapa[a] ?? a;
  }

  iconoTipo(c: CampoCatalogo): string {
    switch (c.tipo) {
      case 'ENTERO': case 'DECIMAL': return 'tag';
      case 'MONEDA': return 'payments';
      case 'FECHA': case 'FECHA_HORA': return 'event';
      case 'BOOLEANO': return 'toggle_on';
      default: return 'text_fields';
    }
  }
}
