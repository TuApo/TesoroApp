import { ChangeDetectionStrategy, Component, LOCALE_ID, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule, formatCurrency, formatNumber, getCurrencySymbol } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { provideEchartsTema } from '../../../../../../shared/utils/echarts-tema';
import { BadgeCelda, ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';

import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { TiendaService } from '../../service/tienda.service';
import { ARCHIVOS_EXPORT_LOGIS, ArchivoExport } from './logis-export';

type Fila = Record<string, any>;
type Pestana = 'resumen' | 'productos' | 'categorias' | 'clientes' | 'fincas' | 'patrones' | 'canasta' | 'proyeccion' | 'operacion' | 'datos';
type Criterio = 'vendido' | 'unidades' | 'compradores' | 'margen' | 'tendencia';

const VERDE = '#0b6b58', VERDE_2 = '#3f9c86', OCRE = '#b4720e', OCRE_2 = '#8a5c10', GRIS = '#6b7280', ROJO = '#9c3123', AZUL = '#2f5f98', VIOLETA = '#6d4aa8';
const PALETA = [VERDE, OCRE, AZUL, VERDE_2, VIOLETA, OCRE_2, ROJO, GRIS, '#4d7c0f', '#0e7490', '#a21caf', '#b45309'];
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/**
 * Tienda › Logis: el análisis a fondo de las ventas.
 *
 * <p>Junta el histórico importado de Logis (mar-2025 → oct-2026) con lo que venda la caja nueva,
 * y responde las preguntas de quien compra y surte la tienda: qué se lleva la gente, quién compra
 * y quién se está yendo, a qué hora y en qué días, qué va junto en la canasta, cuánto se va a
 * vender y qué hay que pedir. Todo llega agregado del servidor (endpoints `/store/logis/*`); el
 * navegador solo ordena y pinta. Cada pestaña pide lo suyo la primera vez que se abre.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tienda-logis',
  imports: [CommonModule, FormsModule, MatIconModule, NgxEchartsDirective, SelectorTienda, ...TABLA_ESTANDAR],
  providers: [provideEchartsTema()],
  templateUrl: './logis.html',
  styleUrls: ['../../styles/tienda-comun.css', './logis.css'],
})
export class Logis implements OnInit {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  private readonly locale = inject(LOCALE_ID);
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly pestanas: Array<{ id: Pestana; titulo: string; icono: string }> = [
    { id: 'resumen', titulo: 'Resumen', icono: 'dashboard' },
    { id: 'productos', titulo: 'Productos', icono: 'shopping_basket' },
    { id: 'categorias', titulo: 'Categorías y marcas', icono: 'category' },
    { id: 'clientes', titulo: 'Clientes', icono: 'groups' },
    { id: 'fincas', titulo: 'Fincas y temporales', icono: 'agriculture' },
    { id: 'patrones', titulo: 'Cuándo compran', icono: 'schedule' },
    { id: 'canasta', titulo: 'Canasta', icono: 'hub' },
    { id: 'proyeccion', titulo: 'Proyección y compras', icono: 'trending_up' },
    { id: 'operacion', titulo: 'Pagos y operación', icono: 'payments' },
    { id: 'datos', titulo: 'Datos del export', icono: 'fact_check' },
  ];

  readonly pestana = signal<Pestana>('resumen');
  readonly desde = signal('');
  readonly hasta = signal('');
  readonly atajo = signal<string>('todo');
  readonly todasLasTiendas = signal(false);
  readonly criterio = signal<Criterio>('vendido');
  readonly diasCobertura = signal(30);
  readonly archivos: ArchivoExport[] = ARCHIVOS_EXPORT_LOGIS;

  /** Respuestas del servidor por clave; se vacía al cambiar tienda o fechas. */
  readonly datos = signal<Record<string, any>>({});
  readonly cargando = signal<ReadonlySet<string>>(new Set());
  readonly errores = signal<Record<string, string>>({});
  readonly fotos = signal<Record<string, string>>({});
  readonly recalculando = signal(false);
  private version = 0;

  constructor() {
    // Cambió el ámbito (tienda, todas, fechas): se descarta lo cargado y se pide la pestaña abierta.
    effect(() => {
      this.ctx.tiendaId();
      this.todasLasTiendas();
      this.desde();
      this.hasta();
      untracked(() => {
        this.version++;
        this.datos.set({});
        this.errores.set({});
        this.cargarPestana();
      });
    });
    effect(() => {
      this.pestana();
      this.diasCobertura();
      untracked(() => this.cargarPestana());
    });
  }

  ngOnInit(): void {
    this.ctx.cargar();
    const vista = this.ruta.snapshot.queryParamMap.get('vista') as Pestana | null;
    if (vista && this.pestanas.some(p => p.id === vista)) this.pestana.set(vista);
  }

  // ── Filtros ──────────────────────────────────────────────────────────────

  irA(p: Pestana): void {
    this.pestana.set(p);
    this.router.navigate([], { relativeTo: this.ruta, queryParams: { vista: p }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  usarAtajo(clave: string): void {
    const hoy = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const menos = (dias: number) => { const d = new Date(hoy); d.setDate(d.getDate() - dias); return iso(d); };
    this.atajo.set(clave);
    switch (clave) {
      case '30': this.desde.set(menos(29)); this.hasta.set(''); break;
      case '90': this.desde.set(menos(89)); this.hasta.set(''); break;
      case '12m': this.desde.set(menos(364)); this.hasta.set(''); break;
      case 'anio': this.desde.set(`${hoy.getFullYear()}-01-01`); this.hasta.set(''); break;
      default: this.desde.set(''); this.hasta.set('');
    }
  }

  cambiarFecha(campo: 'desde' | 'hasta', valor: string): void {
    this.atajo.set('');
    (campo === 'desde' ? this.desde : this.hasta).set(valor || '');
  }

  readonly puedeCompararTiendas = computed(() => this.ctx.esSuperAdmin() || this.ctx.tiendas().length > 1);

  private filtros() {
    return {
      tienda: this.todasLasTiendas() ? undefined : (this.ctx.tiendaId() ?? undefined),
      desde: this.desde() || undefined,
      hasta: this.hasta() || undefined,
    };
  }

  // ── Carga ────────────────────────────────────────────────────────────────

  private cargarPestana(): void {
    if (!this.todasLasTiendas() && !this.ctx.tiendaId() && !this.ctx.esSuperAdmin()) return;
    switch (this.pestana()) {
      case 'resumen': this.pedir('resumen', 'resumen'); this.pedir('serie', 'serie', { grano: 'mes' }); this.pedir('proyeccion', 'proyeccion', { meses: 6 }); break;
      case 'productos': this.pedir('productos', 'productos', { limite: 5000 }); break;
      case 'categorias': this.pedir('categorias', 'categorias'); break;
      case 'clientes': this.pedir('clientes', 'clientes'); break;
      case 'fincas': this.pedir('fincas', 'fincas'); break;
      case 'patrones': this.pedir('patrones', 'patrones'); break;
      case 'canasta': this.pedir('canasta', 'canasta', { limite: 60 }); break;
      case 'proyeccion':
        this.pedir('proyeccion', 'proyeccion', { meses: 6 });
        this.pedir('reabastecimiento-' + this.diasCobertura(), 'reabastecimiento', { dias: this.diasCobertura() });
        break;
      case 'operacion': this.pedir('operacion', 'operacion'); break;
      case 'datos': this.pedir('datos', 'datos'); this.pedir('resumen', 'resumen'); break;
    }
  }

  private pedir(clave: string, recurso: string, extra: Record<string, string | number> = {}): void {
    if (this.datos()[clave] !== undefined || this.cargando().has(clave)) return;
    const version = this.version;
    this.cargando.update(s => new Set(s).add(clave));
    this.api.logis(recurso, this.filtros(), extra).subscribe({
      next: d => {
        this.quitarCarga(clave);
        if (version !== this.version) return;
        this.datos.update(x => ({ ...x, [clave]: d }));
        if (clave === 'productos') this.pedirFotos(d as Fila[]);
      },
      error: e => {
        this.quitarCarga(clave);
        if (version !== this.version) return;
        this.errores.update(x => ({ ...x, [clave]: e?.error?.message || e?.error?.mensaje || 'No se pudo cargar' }));
      },
    });
  }

  private quitarCarga(clave: string): void {
    this.cargando.update(s => { const n = new Set(s); n.delete(clave); return n; });
  }

  private pedirFotos(filas: Fila[]): void {
    const ids = filas.slice(0, 500).map(f => f['producto_id']).filter(Boolean) as string[];
    this.api.imagenesPrincipales(ids).subscribe({ next: m => this.fotos.update(f => ({ ...f, ...m })), error: () => {} });
  }

  reintentar(): void {
    this.errores.set({});
    this.cargarPestana();
  }

  estaCargando(...claves: string[]): boolean {
    const s = this.cargando();
    return claves.some(c => s.has(c));
  }

  recalcularCostos(): void {
    const tienda = this.ctx.tiendaId();
    if (!tienda || this.recalculando()) return;
    this.recalculando.set(true);
    this.api.recalcularCostosLogis(tienda).subscribe({
      next: () => { this.recalculando.set(false); this.version++; this.datos.set({}); this.cargarPestana(); },
      error: () => this.recalculando.set(false),
    });
  }

  // ── Atajos a los datos ───────────────────────────────────────────────────

  readonly resumen = computed<Fila | null>(() => this.datos()['resumen'] ?? null);
  readonly serie = computed<Fila[]>(() => this.datos()['serie'] ?? []);
  readonly productos = computed<Fila[]>(() => this.datos()['productos'] ?? []);
  readonly categorias = computed<Fila | null>(() => this.datos()['categorias'] ?? null);
  readonly clientes = computed<Fila | null>(() => this.datos()['clientes'] ?? null);
  readonly fincas = computed<Fila | null>(() => this.datos()['fincas'] ?? null);
  readonly patrones = computed<Fila | null>(() => this.datos()['patrones'] ?? null);
  readonly canasta = computed<Fila | null>(() => this.datos()['canasta'] ?? null);
  readonly proyeccion = computed<Fila | null>(() => this.datos()['proyeccion'] ?? null);
  readonly reabastecimiento = computed<Fila | null>(() => this.datos()['reabastecimiento-' + this.diasCobertura()] ?? null);
  readonly operacion = computed<Fila | null>(() => this.datos()['operacion'] ?? null);
  readonly calidad = computed<Fila | null>(() => this.datos()['datos'] ?? null);

  readonly sinDatos = computed(() => {
    const r = this.resumen();
    return !!r && (r['sin_datos'] || Number(r['documentos'] ?? 0) === 0);
  });

  /** Lo que dicen los datos, en frases: lo primero que se lee del resumen. */
  readonly hallazgos = computed<string[]>(() => {
    const r = this.resumen();
    const p = this.proyeccion();
    if (!r || r['sin_datos']) return [];
    const out: string[] = [];
    const v = r['variacion_pct'] ?? {};
    if (v['venta'] != null) {
      out.push(`La venta ${Number(v['venta']) >= 0 ? 'subió' : 'bajó'} ${this.num(Math.abs(v['venta']), 1)} % frente a los ${this.num(this.diasRango(r))} días anteriores.`);
    }
    out.push(`Cada ticket lleva en promedio ${this.num(r['lineas_por_ticket'], 1)} productos distintos y ${this.num(r['unidades_por_ticket'], 1)} unidades, por ${this.pesos(r['ticket_promedio'])}.`);
    if (Number(r['clientes']) > 0) {
      out.push(`${this.num(r['clientes'])} personas distintas compraron; cada una vino ${this.num(r['compras_por_cliente'], 1)} veces y gastó ${this.pesos(r['gasto_por_cliente'])} en el período.`);
    }
    if (Number(r['nomina_pct']) > 0) out.push(`El ${this.num(r['nomina_pct'], 1)} % de lo vendido se cobró por nómina: no entra en caja, se descuenta en la quincena.`);
    const mr = Number(r['margen_real_pct']), mp = Number(r['margen_pct']);
    if (Number(r['venta_con_costo_real_pct']) < 99) {
      out.push(`Margen: ${this.num(mp, 1)} % con el costo reconstruido. Donde Logis sí guardó el costo (${this.num(r['venta_con_costo_real_pct'], 0)} % de la venta) el margen es ${this.num(mr, 1)} %.`);
    }
    if (p && p['mes_en_curso']?.['proyeccion_cierre']) {
      out.push(`Si el mes sigue como los anteriores, ${this.mesLargo(p['mes_en_curso']['mes'])} cerraría en ${this.pesos(p['mes_en_curso']['proyeccion_cierre'])}.`);
    }
    if (p && p['dias_sin_venta'] > 3) {
      out.push(`Ojo: la última venta registrada es del ${this.fechaLarga(p['ultima_venta'])} (${p['dias_sin_venta']} días sin ventas). Si la tienda ya vende por la caja nueva, esas ventas aparecerán aquí al confirmarse.`);
    }
    return out;
  });

  private diasRango(r: Fila): number {
    const a = new Date(r['desde']), b = new Date(r['hasta']);
    return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  }

  variacion(clave: string): { texto: string; clase: string } | null {
    const v = this.resumen()?.['variacion_pct']?.[clave];
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return { texto: `${n >= 0 ? '▲' : '▼'} ${this.num(Math.abs(n), 1)} %`, clase: n >= 0 ? 'sube' : 'baja' };
  }

  // ── Gráficas ─────────────────────────────────────────────────────────────

  private ejeValor(nombre?: string): any {
    return {
      type: 'value', name: nombre, nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 10, formatter: (v: number) => this.corto(v) },
      splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } },
    };
  }

  readonly graficaMensual = computed<EChartsOption>(() => {
    const s = this.serie();
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: any) => typeof v === 'number' && v > 1000 ? this.pesos(v) : String(v) },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 50, top: 24, bottom: 50 },
      xAxis: { type: 'category', data: s.map(x => this.mesCorto(x['periodo'])), axisLabel: { fontSize: 10 } },
      yAxis: [this.ejeValor(), { type: 'value', name: 'Clientes', nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 }, splitLine: { show: false } }],
      series: [
        { name: 'Venta', type: 'bar', data: s.map(x => Math.round(x['venta'])), itemStyle: { color: VERDE, borderRadius: [4, 4, 0, 0] } },
        { name: 'Margen', type: 'bar', data: s.map(x => Math.round(x['margen'])), itemStyle: { color: OCRE, borderRadius: [4, 4, 0, 0] } },
        { name: 'Clientes', type: 'line', yAxisIndex: 1, smooth: true, data: s.map(x => x['clientes']), itemStyle: { color: AZUL } },
      ],
    };
  });

  readonly productosOrdenados = computed<Fila[]>(() => {
    const c = this.criterio();
    const campo = c === 'tendencia' ? 'tendencia_pct' : c;
    const filas = [...this.productos()];
    if (c === 'tendencia') {
      return filas.filter(f => f['tendencia_pct'] != null && Number(f['unidades_60d']) >= 10)
        .sort((a, b) => Number(b['tendencia_pct']) - Number(a['tendencia_pct']));
    }
    return filas.sort((a, b) => Number(b[campo] ?? 0) - Number(a[campo] ?? 0));
  });

  readonly graficaTop = computed<EChartsOption>(() => {
    const c = this.criterio();
    const top = this.productosOrdenados().slice(0, 15).reverse();
    const campo = c === 'tendencia' ? 'tendencia_pct' : c;
    const dinero = c === 'vendido' || c === 'margen';
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
        valueFormatter: (v: any) => dinero ? this.pesos(v) : c === 'tendencia' ? `${this.num(v, 1)} %` : this.num(v) },
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: (v: number) => this.corto(v) }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
      yAxis: { type: 'category', data: top.map(f => this.recortar(f['nombre'], 34)), axisLabel: { fontSize: 10 } },
      series: [{ type: 'bar', data: top.map(f => Number(f[campo] ?? 0)), itemStyle: { color: c === 'margen' ? OCRE : c === 'tendencia' ? AZUL : VERDE, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', fontSize: 10, formatter: (p: any) => dinero ? this.corto(p.value) : c === 'tendencia' ? `${this.num(p.value, 0)}%` : this.num(p.value) } }],
    };
  });

  readonly abc = computed(() => {
    const filas = this.productos();
    const cuenta = (c: string) => filas.filter(f => f['clase_abc'] === c).length;
    return { a: cuenta('A'), b: cuenta('B'), c: cuenta('C'), total: filas.length };
  });

  readonly graficaPareto = computed<EChartsOption>(() => {
    const filas = this.productos();
    const paso = Math.max(1, Math.floor(filas.length / 300));
    const puntos = filas.filter((_, i) => i % paso === 0 || i === filas.length - 1)
      .map(f => [Number(f['posicion']), Number(f['participacion_acum_pct'])]);
    return {
      tooltip: { trigger: 'axis', formatter: (p: any) => `Los primeros ${p[0].value[0]} productos hacen el ${this.num(p[0].value[1], 1)} % de la venta` },
      grid: { left: 48, right: 16, top: 16, bottom: 36 },
      xAxis: { type: 'value', name: 'Productos (del que más vende al que menos)', nameLocation: 'middle', nameGap: 24, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 }, max: filas.length || undefined },
      yAxis: { type: 'value', max: 100, axisLabel: { fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
      series: [{
        type: 'line', showSymbol: false, data: puntos, lineStyle: { color: VERDE, width: 2 }, areaStyle: { color: 'rgba(11,107,88,.10)' },
        markLine: { silent: true, symbol: 'none', lineStyle: { color: OCRE, type: 'dashed' }, label: { fontSize: 10 }, data: [{ yAxis: 80, name: '80 %' }, { yAxis: 95, name: '95 %' }] },
      }],
    };
  });

  /** Árbol departamento › familia: el tamaño es la venta; la etiqueta dice además cuánto deja (utilidad %). */
  readonly graficaTreemap = computed<EChartsOption>(() => {
    const deps: Fila[] = this.categorias()?.['departamentos'] ?? [];
    const util = (d: any) => d?.margen_pct == null ? '' : ` · ${this.num(d.margen_pct, 1)} %`;
    return {
      tooltip: {
        formatter: (p: any) => {
          const d = p.data ?? {};
          const ruta = p.treePathInfo?.map((x: any) => x.name).filter(Boolean).join(' › ');
          return `<b>${ruta}</b><br>Venta: ${this.pesos(p.value)} (${this.num(d.participacion_pct, 1)} %)`
            + `<br>Utilidad: ${this.num(d.margen_pct, 1)} % de la venta`
            + (d.utilidad_promedio_pct != null ? `<br>Utilidad promedio por producto: ${this.num(d.utilidad_promedio_pct, 1)} %` : '')
            + (d.productos != null ? `<br>${this.num(d.productos)} productos · ${this.num(d.compradores)} compradores` : '');
        },
      },
      series: [{
        type: 'treemap', roam: false, nodeClick: 'zoomToNode', breadcrumb: { show: true, bottom: 0, itemStyle: { textStyle: { fontSize: 11 } } },
        top: 4, left: 4, right: 4, bottom: 30,
        label: { show: true, fontSize: 11, formatter: (p: any) => `${p.name}\n${this.corto(p.value)}${util(p.data)}` },
        // El encabezado de cada departamento toma el color del borde: va del mismo color que el
        // departamento (con borde blanco el texto blanco no se veía).
        upperLabel: { show: true, height: 22, fontSize: 11, color: '#fff', fontWeight: 600,
          formatter: (p: any) => `${p.name} · ${this.corto(p.value)}${util(p.data)}` },
        data: deps.map((d, i) => {
          const color = PALETA[i % PALETA.length];
          return {
            name: d['departamento'], value: Math.round(d['venta']), margen_pct: d['margen_pct'], utilidad_promedio_pct: d['utilidad_promedio_pct'],
            participacion_pct: d['participacion_pct'], productos: d['productos'], compradores: d['compradores'],
            itemStyle: { color, borderColor: color, borderWidth: 2, gapWidth: 1 },
            children: (d['familias'] as Fila[]).map(f => ({
              name: f['familia'], value: Math.round(f['venta']), margen_pct: f['margen_pct'], utilidad_promedio_pct: f['utilidad_promedio_pct'],
              participacion_pct: f['participacion_pct'], productos: f['productos'], compradores: f['compradores'],
            })),
          };
        }),
      }],
    } as EChartsOption;
  });

  /** Cuánto deja cada departamento: utilidad sobre la venta y el promedio de sus productos. */
  readonly graficaUtilidadDepartamentos = computed<EChartsOption>(() => {
    const deps: Fila[] = [...(this.categorias()?.['departamentos'] ?? [])]
      .filter(d => Number(d['venta']) > 0).sort((a, b) => Number(a['margen_pct']) - Number(b['margen_pct']));
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => v == null ? '—' : `${this.num(v, 1)} %` },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 8, right: 40, top: 8, bottom: 36, containLabel: true },
      xAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
      yAxis: { type: 'category', data: deps.map(d => this.recortar(d['departamento'], 24)), axisLabel: { fontSize: 10 } },
      series: [
        { name: 'Utilidad sobre la venta', type: 'bar', data: deps.map(d => d['margen_pct']), itemStyle: { color: OCRE, borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10, formatter: (p: any) => `${this.num(p.value, 1)}%` } },
        { name: 'Promedio por producto', type: 'scatter', data: deps.map(d => d['utilidad_promedio_pct']), symbolSize: 9, itemStyle: { color: VERDE } },
      ],
    } as EChartsOption;
  });

  readonly graficaMarcas = computed<EChartsOption>(() => {
    const m: Fila[] = (this.categorias()?.['marcas'] ?? []).filter((x: Fila) => x['marca'] !== 'Sin marca').slice(0, 15).reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => this.pesos(v) },
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: (v: number) => this.corto(v) }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
      yAxis: { type: 'category', data: m.map(x => this.recortar(x['marca'], 24)), axisLabel: { fontSize: 10 } },
      series: [{ type: 'bar', data: m.map(x => Math.round(x['venta'])), itemStyle: { color: AZUL, borderRadius: [0, 4, 4, 0] } }],
    };
  });

  readonly graficaClientesMes = computed<EChartsOption>(() => {
    const m: Fila[] = this.clientes()?.['mensual'] ?? [];
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 48, right: 48, top: 20, bottom: 50 },
      xAxis: { type: 'category', data: m.map(x => this.mesCorto(x['mes'])), axisLabel: { fontSize: 10 } },
      yAxis: [{ type: 'value', name: 'Clientes', nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
        { type: 'value', max: 100, axisLabel: { fontSize: 10, formatter: '{value}%' }, splitLine: { show: false } }],
      series: [
        { name: 'Recurrentes', type: 'bar', stack: 'c', data: m.map(x => x['recurrentes']), itemStyle: { color: VERDE } },
        { name: 'Nuevos', type: 'bar', stack: 'c', data: m.map(x => x['nuevos']), itemStyle: { color: OCRE } },
        { name: 'Volvieron del mes anterior', type: 'line', yAxisIndex: 1, smooth: true, data: m.map(x => x['retencion_pct'] ?? null), itemStyle: { color: AZUL } },
      ],
    };
  });

  readonly graficaFrecuencia = computed<EChartsOption>(() => {
    const f: Fila[] = this.clientes()?.['frecuencia'] ?? [];
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 44, right: 12, top: 16, bottom: 30 },
      xAxis: { type: 'category', data: f.map(x => x['rango']), axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
      series: [{ type: 'bar', data: f.map(x => x['clientes']), itemStyle: { color: VERDE_2, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', fontSize: 10, formatter: (p: any) => `${this.num(f[p.dataIndex]['clientes_pct'], 0)}%` } }],
    };
  });

  readonly graficaCalor = computed<EChartsOption>(() => {
    const c: Fila[] = this.patrones()?.['calor'] ?? [];
    const horas = c.map(x => Number(x['hora']));
    const hMin = Math.min(7, ...(horas.length ? horas : [7])), hMax = Math.max(20, ...(horas.length ? horas : [20]));
    const ejeX: number[] = [];
    for (let h = hMin; h <= hMax; h++) ejeX.push(h);
    // DAYOFWEEK de MySQL: 1 = domingo … 7 = sábado. En el eje: lunes arriba.
    const fila = (dow: number) => (dow + 5) % 7;
    const datos = c.map(x => [ejeX.indexOf(Number(x['hora'])), fila(Number(x['dow'])), Math.round(x['venta'])]);
    const max = Math.max(1, ...datos.map(d => d[2]));
    return {
      tooltip: { formatter: (p: any) => `${DIAS_CORTOS[p.value[1]]} ${ejeX[p.value[0]]}:00 – ${ejeX[p.value[0]] + 1}:00<br>${this.pesos(p.value[2])}` },
      grid: { left: 44, right: 16, top: 10, bottom: 60 },
      xAxis: { type: 'category', data: ejeX.map(h => `${h}h`), axisLabel: { fontSize: 10 }, splitArea: { show: true } },
      yAxis: { type: 'category', data: DIAS_CORTOS, inverse: true, axisLabel: { fontSize: 10 }, splitArea: { show: true } },
      visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120, textStyle: { fontSize: 10 },
        inRange: { color: ['#f1f7f5', '#9fd1c3', VERDE, '#063f34'] }, formatter: (v: any) => this.corto(Number(v)) },
      series: [{ type: 'heatmap', data: datos, emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,.3)' } } }],
    } as EChartsOption;
  });

  private barras(datos: Fila[], etiqueta: (x: Fila) => string, valor: (x: Fila) => number, color: (x: Fila) => string): EChartsOption {
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => this.pesos(v) },
      grid: { left: 52, right: 12, top: 16, bottom: 28 },
      xAxis: { type: 'category', data: datos.map(etiqueta), axisLabel: { fontSize: 10 } },
      yAxis: this.ejeValor(),
      series: [{ type: 'bar', data: datos.map(x => ({ value: Math.round(valor(x)), itemStyle: { color: color(x), borderRadius: [4, 4, 0, 0] } })) }],
    };
  }

  readonly graficaDiaSemana = computed<EChartsOption>(() => {
    const d: Fila[] = [...(this.patrones()?.['por_dia_semana'] ?? [])].sort((a, b) => ((a['dow'] + 5) % 7) - ((b['dow'] + 5) % 7));
    return this.barras(d, x => DIAS_CORTOS[(x['dow'] + 5) % 7], x => Number(x['venta_promedio']), () => VERDE);
  });

  readonly graficaDiaMes = computed<EChartsOption>(() => {
    const d: Fila[] = this.patrones()?.['por_dia_mes'] ?? [];
    const media = d.reduce((s, x) => s + Number(x['venta_promedio']), 0) / Math.max(1, d.length);
    return this.barras(d, x => String(x['dia']), x => Number(x['venta_promedio']), x => Number(x['venta_promedio']) > media * 1.25 ? OCRE : VERDE_2);
  });

  readonly graficaHora = computed<EChartsOption>(() => {
    const d: Fila[] = this.patrones()?.['por_hora'] ?? [];
    return this.barras(d, x => `${x['hora']}h`, x => Number(x['venta']), () => AZUL);
  });

  readonly graficaCanasta = computed<EChartsOption>(() => {
    const pares: Fila[] = (this.canasta()?.['frecuentes'] ?? []).slice(0, 40);
    const nodos = new Map<string, { name: string; value: number }>();
    for (const p of pares) {
      for (const [id, nombre] of [[p['producto_a'], p['nombre_a']], [p['producto_b'], p['nombre_b']]]) {
        const n = nodos.get(id) ?? { name: nombre, value: 0 };
        n.value += Number(p['juntos']);
        nodos.set(id, n);
      }
    }
    const max = Math.max(1, ...[...nodos.values()].map(n => n.value));
    const maxJ = Math.max(1, ...pares.map(p => Number(p['juntos'])));
    return {
      tooltip: { formatter: (p: any) => p.dataType === 'edge' ? `${p.data.a} + ${p.data.b}<br>${this.num(p.data.juntos)} tickets juntos · lift ${p.data.lift}` : p.name },
      series: [{
        type: 'graph', layout: 'force', roam: true, draggable: true,
        force: { repulsion: 220, edgeLength: [60, 160], gravity: 0.08 },
        label: { show: true, fontSize: 9, formatter: (p: any) => this.recortar(p.name, 22) },
        data: [...nodos.entries()].map(([id, n], i) => ({ id, name: n.name, symbolSize: 10 + 30 * Math.sqrt(n.value / max), itemStyle: { color: PALETA[i % PALETA.length] } })),
        links: pares.map(p => ({ source: p['producto_a'], target: p['producto_b'], a: p['nombre_a'], b: p['nombre_b'], juntos: p['juntos'], lift: p['lift'],
          lineStyle: { width: 1 + 6 * Number(p['juntos']) / maxJ, opacity: 0.45, color: GRIS } })),
      }],
    } as EChartsOption;
  });

  readonly graficaProyeccion = computed<EChartsOption>(() => {
    const p = this.proyeccion();
    const hist: Fila[] = p?.['historico'] ?? [];
    const pron: Fila[] = p?.['pronostico'] ?? [];
    const meses = [...hist.map(h => h['mes'])];
    for (const f of pron) if (!meses.includes(f['mes'])) meses.push(f['mes']);
    const en = (lista: Fila[], campo: string) => meses.map(m => { const x = lista.find(y => y['mes'] === m); return x && x[campo] != null ? Number(x[campo]) : null; });
    const real = meses.map(m => { const x = hist.find(y => y['mes'] === m); return x ? { value: Number(x['venta']), itemStyle: { color: x['completo'] ? VERDE : 'rgba(11,107,88,.45)' } } : null; });
    const min = en(pron, 'minimo'), max = en(pron, 'maximo');
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: any) => v == null ? '—' : this.pesos(v) },
      legend: { bottom: 0, textStyle: { fontSize: 11 }, data: ['Venta real', 'Ajuste del modelo', 'Pronóstico', 'Rango probable (80 %)'] },
      grid: { left: 60, right: 16, top: 20, bottom: 50 },
      xAxis: { type: 'category', data: meses.map(m => this.mesCorto(m)), axisLabel: { fontSize: 10 } },
      yAxis: this.ejeValor(),
      series: [
        { name: 'Venta real', type: 'bar', data: real as any, itemStyle: { color: VERDE }, barMaxWidth: 26 },
        { name: 'Ajuste del modelo', type: 'line', data: en(hist, 'ajuste'), smooth: true, showSymbol: false, lineStyle: { color: GRIS, type: 'dotted' }, itemStyle: { color: GRIS } },
        { name: 'banda-base', type: 'line', data: min, stack: 'banda', lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } } as any,
        { name: 'Rango probable (80 %)', type: 'line', data: max.map((v, i) => v == null || min[i] == null ? null : v - (min[i] as number)), stack: 'banda',
          lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: 'rgba(180,114,14,.18)' }, itemStyle: { color: 'rgba(180,114,14,.4)' },
          tooltip: { valueFormatter: () => '' } },
        { name: 'Pronóstico', type: 'line', data: en(pron, 'venta'), lineStyle: { color: OCRE, width: 3 }, itemStyle: { color: OCRE }, symbolSize: 7 },
      ],
    } as EChartsOption;
  });

  readonly proximos = computed(() => {
    const pron: Fila[] = this.proyeccion()?.['pronostico'] ?? [];
    const enCurso = this.proyeccion()?.['mes_en_curso']?.['mes'];
    const futuros = pron.filter(x => x['mes'] !== enCurso);
    return {
      siguiente: futuros[0] ?? null,
      tres: futuros.slice(0, 3).reduce((s, x) => s + Number(x['venta']), 0),
      tresMin: futuros.slice(0, 3).reduce((s, x) => s + Number(x['minimo']), 0),
      tresMax: futuros.slice(0, 3).reduce((s, x) => s + Number(x['maximo']), 0),
    };
  });

  readonly graficaEstacional = computed<EChartsOption>(() => {
    const e: Fila[] = this.proyeccion()?.['estacionalidad'] ?? [];
    return {
      tooltip: { trigger: 'axis', formatter: (p: any) => `${e[p[0].dataIndex]['nombre']}: ${this.num(p[0].value * 100, 0)} % de un mes típico (${e[p[0].dataIndex]['observaciones']} año(s) de datos)` },
      grid: { left: 40, right: 12, top: 12, bottom: 28 },
      xAxis: { type: 'category', data: e.map(x => String(x['nombre']).slice(0, 3)), axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', min: 0.5, axisLabel: { fontSize: 10, formatter: (v: number) => `${Math.round(v * 100)}%` }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
      series: [{ type: 'bar', data: e.map(x => ({ value: x['indice'], itemStyle: { color: Number(x['indice']) >= 1 ? VERDE : OCRE, opacity: x['observaciones'] ? 1 : 0.35 } })),
        markLine: { silent: true, symbol: 'none', data: [{ yAxis: 1 }], lineStyle: { color: GRIS, type: 'dashed' }, label: { show: false } } }],
    } as EChartsOption;
  });

  readonly graficaPagosMes = computed<EChartsOption>(() => {
    const filas: Fila[] = this.operacion()?.['pagos_por_mes'] ?? [];
    const meses = [...new Set(filas.map(f => f['mes']))].sort();
    const metodos = [...new Set(filas.map(f => f['metodo']))];
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: any) => this.pesos(v) },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 12, top: 16, bottom: 50 },
      xAxis: { type: 'category', data: meses.map(m => this.mesCorto(m)), axisLabel: { fontSize: 10 } },
      yAxis: this.ejeValor(),
      series: metodos.map((m, i) => ({ name: this.nombreMetodo(m), type: 'bar', stack: 'p',
        data: meses.map(mes => Math.round(filas.find(f => f['mes'] === mes && f['metodo'] === m)?.['valor'] ?? 0)),
        itemStyle: { color: PALETA[i % PALETA.length] } })),
    } as EChartsOption;
  });

  readonly graficaCostoMes = computed<EChartsOption>(() => {
    const filas: Fila[] = this.calidad()?.['costo_por_mes'] ?? [];
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 44, top: 16, bottom: 50 },
      xAxis: { type: 'category', data: filas.map(f => this.mesCorto(f['mes'])), axisLabel: { fontSize: 10 } },
      yAxis: [this.ejeValor(), { type: 'value', max: 100, axisLabel: { fontSize: 10, formatter: '{value}%' }, splitLine: { show: false } }],
      series: [
        { name: 'Costo que traía Logis', type: 'bar', data: filas.map(f => Math.round(f['costo_origen'])), itemStyle: { color: GRIS } },
        { name: 'Costo reconstruido', type: 'bar', data: filas.map(f => Math.round(f['costo_estimado'])), itemStyle: { color: OCRE } },
        { name: '% de líneas con costo en Logis', type: 'line', yAxisIndex: 1, data: filas.map(f => f['lineas_con_costo_pct']), itemStyle: { color: ROJO } },
      ],
    } as EChartsOption;
  });

  private serieMultiple(datos: Fila | null | undefined, campo: 'venta' | 'compradores', apilada: boolean): EChartsOption {
    const meses: string[] = datos?.['meses'] ?? [];
    const series: Fila[] = datos?.['series'] ?? [];
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: any) => campo === 'venta' ? this.pesos(v) : this.num(v) },
      legend: { bottom: 0, type: 'scroll', textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 16, top: 16, bottom: 56 },
      xAxis: { type: 'category', data: meses.map(m => this.mesCorto(m)), axisLabel: { fontSize: 10 } },
      yAxis: campo === 'venta' ? this.ejeValor() : { type: 'value', axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
      series: series.map((s, i) => ({
        name: s['nombre'], type: apilada ? 'bar' : 'line', stack: apilada ? 'f' : undefined, smooth: !apilada, showSymbol: false,
        data: s[campo], itemStyle: { color: s['nombre'] === 'Otras' ? GRIS : PALETA[i % PALETA.length] },
      })),
    } as EChartsOption;
  }

  readonly graficaFincasVenta = computed<EChartsOption>(() => this.serieMultiple(this.fincas()?.['serie_fincas'], 'venta', true));
  readonly graficaFincasCompradores = computed<EChartsOption>(() => this.serieMultiple(this.fincas()?.['serie_fincas'], 'compradores', false));
  readonly graficaTemporalesVenta = computed<EChartsOption>(() => this.serieMultiple(this.fincas()?.['serie_temporales'], 'venta', false));

  /** Penetración entre los activos de las fincas atendidas: barras de cuántos hay y cuántos compraron. */
  readonly graficaPenetracionFincas = computed<EChartsOption>(() => {
    const f: Fila[] = (this.fincas()?.['por_finca'] ?? []).filter((x: Fila) => x['atendida']).slice(0, 15);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 8, right: 44, top: 8, bottom: 40, containLabel: true },
      xAxis: { type: 'category', data: f.map(x => this.recortar(x['finca'], 14)), axisLabel: { fontSize: 10, rotate: 30 } },
      yAxis: [{ type: 'value', axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
        { type: 'value', max: 100, axisLabel: { fontSize: 10, formatter: '{value}%' }, splitLine: { show: false } }],
      series: [
        { name: 'Activos hoy', type: 'bar', data: f.map(x => x['activos_hoy']), itemStyle: { color: 'rgba(107,114,128,.45)' } },
        { name: 'Compradores activos', type: 'bar', data: f.map(x => x['compradores_activos']), itemStyle: { color: VERDE } },
        { name: 'Penetración', type: 'line', yAxisIndex: 1, data: f.map(x => x['penetracion_pct']), itemStyle: { color: OCRE } },
      ],
    } as EChartsOption;
  });

  readonly graficaAntiguedad = computed<EChartsOption>(() => {
    const a: Fila[] = (this.fincas()?.['antiguedad'] ?? []).filter((x: Fila) => Number(x['activos']) > 0);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 44, right: 44, top: 12, bottom: 40 },
      xAxis: { type: 'category', data: a.map(x => x['rango']), axisLabel: { fontSize: 10 } },
      yAxis: [{ type: 'value', axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
        { type: 'value', max: 100, axisLabel: { fontSize: 10, formatter: '{value}%' }, splitLine: { show: false } }],
      series: [
        { name: 'Activos', type: 'bar', data: a.map(x => x['activos']), itemStyle: { color: 'rgba(107,114,128,.45)' } },
        { name: 'Compraron', type: 'bar', data: a.map(x => x['compraron']), itemStyle: { color: VERDE } },
        { name: '% que compró', type: 'line', yAxisIndex: 1, data: a.map(x => x['penetracion_pct']), itemStyle: { color: OCRE } },
      ],
    } as EChartsOption;
  });

  readonly graficaPrimeraCompra = computed<EChartsOption>(() => {
    const c: Fila[] = this.fincas()?.['primera_compra']?.['cubetas'] ?? [];
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 44, right: 12, top: 16, bottom: 30 },
      xAxis: { type: 'category', data: c.map(x => x['rango']), axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
      series: [{ type: 'bar', data: c.map(x => x['personas']), itemStyle: { color: AZUL, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', fontSize: 10, formatter: (p: any) => `${this.num(c[p.dataIndex]['personas_pct'], 0)}%` } }],
    };
  });

  // ── Tablas ───────────────────────────────────────────────────────────────

  readonly idProducto = (f: Fila) => f['producto_id'] ?? f['codigo'] ?? f['nombre'];
  readonly idCliente = (f: Fila) => f['documento'];
  readonly idPar = (f: Fila) => `${f['producto_a']}|${f['producto_b']}`;
  readonly idFamilia = (f: Fila) => `${f['departamento']}|${f['familia']}`;
  readonly idMarca = (f: Fila) => f['marca'];
  readonly idVendedor = (f: Fila) => f['vendedor'];
  readonly idCartera = (f: Fila) => `${f['tipo']}|${f['numero']}`;
  readonly idEstadoDoc = (f: Fila) => `${f['tipo']}|${f['estado']}`;

  private colPesos(id: string, header: string, campo: string, extra: Partial<ColumnaTabla<Fila>> = {}): ColumnaTabla<Fila> {
    return { id, header, align: 'right', tarjeta: 'meta', valor: f => Number(f[campo] ?? 0), formato: f => this.pesos(f[campo]),
      copiaTexto: f => String(Math.round(Number(f[campo] ?? 0))), ...extra };
  }
  private colNum(id: string, header: string, campo: string, dec = 0, extra: Partial<ColumnaTabla<Fila>> = {}): ColumnaTabla<Fila> {
    return { id, header, align: 'right', tarjeta: 'meta', valor: f => f[campo] == null ? null : Number(f[campo]),
      formato: f => f[campo] == null ? '—' : this.num(f[campo], dec), ...extra };
  }
  private colPct(id: string, header: string, campo: string, extra: Partial<ColumnaTabla<Fila>> = {}): ColumnaTabla<Fila> {
    return { id, header, align: 'right', tarjeta: 'meta', valor: f => f[campo] == null ? null : Number(f[campo]),
      formato: f => f[campo] == null ? '—' : `${this.num(f[campo], 1)} %`, ...extra };
  }

  readonly columnasProductos: ColumnaTabla<Fila>[] = [
    { id: 'pos', header: '#', align: 'right', valor: f => f['posicion'], tarjeta: 'oculto', ancho: '56px' },
    { id: 'producto', header: 'Producto', valor: f => f['nombre'], tarjeta: 'titulo', minAncho: '220px',
      imagen: f => this.fotos()[f['producto_id']] },
    { id: 'departamento', header: 'Departamento', valor: f => f['departamento'], prioridad: 2, tarjeta: 'subtitulo' },
    { id: 'familia', header: 'Familia', valor: f => f['familia'], prioridad: 3 },
    { id: 'marca', header: 'Marca', valor: f => f['marca'], prioridad: 3 },
    { id: 'abc', header: 'ABC', align: 'center', valor: f => f['clase_abc'], tarjeta: 'badge',
      badge: f => ({ texto: f['clase_abc'], tono: f['clase_abc'] === 'A' ? 'ok' : f['clase_abc'] === 'B' ? 'info' : 'neutro' }) },
    this.colNum('unidades', 'Unidades', 'unidades', 0),
    this.colPesos('vendido', 'Vendido', 'vendido'),
    this.colPct('participacion', '% venta', 'participacion_pct', { prioridad: 2 }),
    this.colPesos('margen', 'Utilidad', 'margen'),
    this.colPct('margen_pct', 'Utilidad %', 'margen_pct', { prioridad: 2 }),
    this.colNum('compradores', 'Compradores', 'compradores'),
    this.colPct('penetracion', 'Penetración', 'penetracion_pct', { prioridad: 2 }),
    this.colNum('documentos', 'Tickets', 'documentos', 0, { prioridad: 3 }),
    this.colPesos('precio', 'Precio prom.', 'precio_promedio', { prioridad: 3 }),
    { id: 'tendencia', header: 'Tendencia 60 d', align: 'center', valor: f => f['tendencia_pct'], tarjeta: 'badge',
      badge: f => this.badgeTendencia(f), copiaTexto: f => f['tendencia_pct'] == null ? f['tendencia'] : String(f['tendencia_pct']) },
    this.colNum('stock', 'Existencia', 'stock', 0, { prioridad: 2 }),
    this.colNum('cobertura', 'Días de cobertura', 'cobertura_dias', 0, { prioridad: 3 }),
    { id: 'ultima', header: 'Última venta', valor: f => f['ultima_venta'], prioridad: 3, tarjeta: 'meta' },
  ];

  readonly columnasFamilias: ColumnaTabla<Fila>[] = [
    { id: 'departamento', header: 'Departamento', valor: f => f['departamento'], tarjeta: 'subtitulo' },
    { id: 'familia', header: 'Familia', valor: f => f['familia'], tarjeta: 'titulo' },
    this.colPesos('venta', 'Venta', 'venta'),
    this.colPct('participacion', '% venta', 'participacion_pct'),
    this.colPesos('margen', 'Utilidad', 'margen', { prioridad: 2 }),
    this.colPct('margen_pct', 'Utilidad %', 'margen_pct'),
    this.colPct('util_prom', 'Utilidad prom. por producto', 'utilidad_promedio_pct'),
    this.colNum('unidades', 'Unidades', 'unidades', 0, { prioridad: 2 }),
    this.colNum('compradores', 'Compradores', 'compradores', 0, { prioridad: 2 }),
    this.colPct('penetracion', 'Penetración', 'penetracion_pct', { prioridad: 2 }),
    this.colNum('productos', 'Productos', 'productos', 0, { prioridad: 3 }),
  ];

  readonly columnasMarcas: ColumnaTabla<Fila>[] = [
    { id: 'marca', header: 'Marca', valor: f => f['marca'], tarjeta: 'titulo' },
    this.colPesos('venta', 'Venta', 'venta'),
    this.colPct('participacion', '% venta', 'participacion_pct'),
    this.colPct('margen_pct', 'Utilidad %', 'margen_pct'),
    this.colNum('compradores', 'Compradores', 'compradores', 0, { prioridad: 2 }),
    this.colNum('productos', 'Productos', 'productos', 0, { prioridad: 2 }),
  ];

  readonly idDepartamento = (f: Fila) => f['departamento'];

  readonly columnasDepartamentos: ColumnaTabla<Fila>[] = [
    { id: 'departamento', header: 'Departamento', valor: f => f['departamento'], tarjeta: 'titulo' },
    this.colPesos('venta', 'Venta', 'venta'),
    this.colPct('participacion', '% venta', 'participacion_pct'),
    this.colPesos('margen', 'Utilidad', 'margen', { prioridad: 2 }),
    this.colPct('margen_pct', 'Utilidad %', 'margen_pct'),
    this.colPct('util_prom', 'Utilidad prom. por producto', 'utilidad_promedio_pct'),
    this.colNum('familias', 'Familias', 'n_familias', 0, { prioridad: 3 }),
    this.colNum('productos', 'Productos', 'productos', 0, { prioridad: 2 }),
    this.colNum('compradores', 'Compradores', 'compradores', 0, { prioridad: 2 }),
    this.colPct('penetracion', 'Penetración', 'penetracion_pct', { prioridad: 3 }),
  ];

  readonly departamentosTabla = computed<Fila[]>(() =>
    (this.categorias()?.['departamentos'] ?? []).map((d: Fila) => ({ ...d, n_familias: (d['familias'] ?? []).length })));

  readonly columnasClientes: ColumnaTabla<Fila>[] = [
    { id: 'nombre', header: 'Cliente', valor: f => f['nombre'], tarjeta: 'titulo', minAncho: '180px' },
    { id: 'documento', header: 'Documento', valor: f => f['documento'], tarjeta: 'subtitulo' },
    { id: 'segmento', header: 'Segmento', valor: f => f['segmento'], tarjeta: 'badge', badge: f => this.badgeSegmento(f['segmento']) },
    { id: 'laboral', header: 'En la empresa', valor: f => this.textoLaboral(f['estado_laboral']), badge: f => this.badgeLaboral(f) },
    { id: 'celular', header: 'Celular', valor: f => f['celular'], interactiva: true, minAncho: '120px' },
    { id: 'whatsapp', header: 'WhatsApp', valor: f => f['whatsapp'], interactiva: true, prioridad: 2 },
    { id: 'correo', header: 'Correo', valor: f => f['correo'], interactiva: true, prioridad: 2, minAncho: '180px' },
    { id: 'finca', header: 'Finca', valor: f => f['finca'], prioridad: 2 },
    { id: 'temporal', header: 'Temporal', valor: f => f['temporal'], prioridad: 3 },
    this.colNum('compras', 'Compras', 'compras'),
    this.colPesos('total', 'Total', 'total'),
    this.colPesos('ticket', 'Ticket', 'ticket_promedio', { prioridad: 2 }),
    this.colNum('cada', 'Compra cada (días)', 'cada_cuantos_dias', 0, { prioridad: 2 }),
    this.colNum('sin', 'Días sin comprar', 'dias_sin_comprar'),
    { id: 'ultima', header: 'Última compra', valor: f => f['ultima_compra'], tarjeta: 'meta', prioridad: 2 },
    { id: 'primera', header: 'Cliente desde', valor: f => f['primera_compra'], tarjeta: 'meta', prioridad: 3 },
  ];

  /** Activos de tesorería en fincas atendidas que nunca le han comprado a la tienda. */
  readonly columnasSinCompra: ColumnaTabla<Fila>[] = [
    { id: 'nombre', header: 'Nombre', valor: f => f['nombre'], tarjeta: 'titulo', minAncho: '180px' },
    { id: 'documento', header: 'Documento', valor: f => f['documento'], tarjeta: 'subtitulo' },
    { id: 'finca', header: 'Finca', valor: f => f['finca'] },
    { id: 'temporal', header: 'Temporal', valor: f => f['temporal'], prioridad: 2 },
    { id: 'ingreso', header: 'Ingresó', valor: f => f['ingreso'], prioridad: 2, tarjeta: 'meta' },
    { id: 'celular', header: 'Celular', valor: f => f['celular'], interactiva: true, minAncho: '120px' },
    { id: 'whatsapp', header: 'WhatsApp', valor: f => f['whatsapp'], interactiva: true, prioridad: 2 },
    { id: 'correo', header: 'Correo', valor: f => f['correo'], interactiva: true, prioridad: 2, minAncho: '180px' },
    { id: 'bloqueado', header: 'Cupo', valor: f => f['bloqueado_tesoreria'] ? 'Bloqueado' : 'Disponible', prioridad: 3,
      badge: f => f['bloqueado_tesoreria'] ? { texto: 'Bloqueado', tono: 'danger' } : { texto: 'Disponible', tono: 'ok' } },
  ];

  readonly idFinca = (f: Fila) => f['finca'];
  readonly idTemporal = (f: Fila) => f['temporal'];

  readonly columnasFincas: ColumnaTabla<Fila>[] = [
    { id: 'finca', header: 'Finca', valor: f => f['finca'], tarjeta: 'titulo', minAncho: '160px' },
    { id: 'temporal', header: 'Temporal', valor: f => f['temporal'], prioridad: 3, tarjeta: 'subtitulo' },
    this.colPesos('venta', 'Venta', 'venta'),
    this.colPct('participacion', '% venta', 'participacion_pct'),
    this.colNum('compradores', 'Compradores', 'compradores'),
    this.colNum('activos', 'Activos hoy', 'activos_hoy'),
    this.colNum('comp_activos', 'Compradores activos', 'compradores_activos', 0, { prioridad: 2 }),
    this.colPct('penetracion', 'Penetración', 'penetracion_pct'),
    this.colNum('comp90', 'Compraron 90 d', 'compradores_90d', 0, { prioridad: 2 }),
    { id: 'tendencia', header: 'Venta 90 d vs anteriores', align: 'center', valor: f => f['tendencia_pct'],
      badge: f => f['tendencia_pct'] == null ? { texto: 'Sin base', tono: 'neutro' }
        : Number(f['tendencia_pct']) >= 10 ? { texto: `+${this.num(f['tendencia_pct'], 0)}%`, tono: 'ok', icono: 'trending_up' }
        : Number(f['tendencia_pct']) <= -10 ? { texto: `${this.num(f['tendencia_pct'], 0)}%`, tono: 'warn', icono: 'trending_down' }
        : { texto: `${this.num(f['tendencia_pct'], 0)}%`, tono: 'info' } },
    this.colPesos('ticket', 'Ticket', 'ticket_promedio', { prioridad: 2 }),
    this.colNum('compras_c', 'Compras c/u', 'compras_por_comprador', 1, { prioridad: 3 }),
    this.colPesos('gasto_c', 'Gasto c/u', 'gasto_por_comprador', { prioridad: 2 }),
    this.colNum('retirados', 'Ya no están', 'compradores_retirados', 0, { prioridad: 3 }),
    { id: 'ultima', header: 'Última compra', valor: f => f['ultima_compra'], prioridad: 3, tarjeta: 'meta' },
  ];

  readonly columnasTemporales: ColumnaTabla<Fila>[] = [
    { id: 'temporal', header: 'Temporal', valor: f => f['temporal'], tarjeta: 'titulo' },
    this.colPesos('venta', 'Venta', 'venta'),
    this.colPct('participacion', '% venta', 'participacion_pct'),
    this.colNum('compradores', 'Compradores', 'compradores'),
    this.colNum('activos', 'Activos hoy', 'activos_hoy'),
    this.colPct('penetracion', 'Penetración', 'penetracion_pct'),
    this.colPesos('gasto_c', 'Gasto c/u', 'gasto_por_comprador', { prioridad: 2 }),
    this.colNum('fincas', 'Fincas', 'fincas', 0, { prioridad: 2 }),
  ];

  readonly columnasPares: ColumnaTabla<Fila>[] = [
    { id: 'a', header: 'Producto', valor: f => f['nombre_a'], tarjeta: 'titulo', minAncho: '180px' },
    { id: 'b', header: 'Se lleva con', valor: f => f['nombre_b'], tarjeta: 'subtitulo', minAncho: '180px' },
    this.colNum('juntos', 'Tickets juntos', 'juntos'),
    this.colPct('soporte', '% de tickets', 'soporte_pct'),
    this.colPct('conf_ab', 'Quien lleva A, lleva B', 'confianza_a_b_pct', { prioridad: 2 }),
    this.colPct('conf_ba', 'Quien lleva B, lleva A', 'confianza_b_a_pct', { prioridad: 2 }),
    this.colNum('lift', 'Lift', 'lift', 2),
  ];

  readonly columnasReabastecimiento: ColumnaTabla<Fila>[] = [
    { id: 'estado', header: 'Estado', valor: f => f['estado'], tarjeta: 'badge', badge: f => this.badgeEstado(f['estado']) },
    { id: 'producto', header: 'Producto', valor: f => f['nombre'], tarjeta: 'titulo', minAncho: '200px', imagen: f => this.fotos()[f['producto_id']] },
    { id: 'abc', header: 'ABC', align: 'center', valor: f => f['clase_abc'], prioridad: 2 },
    { id: 'departamento', header: 'Departamento', valor: f => f['departamento'], prioridad: 3, tarjeta: 'subtitulo' },
    this.colNum('demanda', 'Venta diaria', 'demanda_diaria', 2),
    this.colNum('u30', 'Uds. 30 d', 'unidades_30d', 0, { prioridad: 2 }),
    this.colNum('stock', 'Existencia', 'stock', 0),
    this.colNum('cobertura', 'Alcanza para (días)', 'cobertura_dias', 0),
    this.colNum('sugerido', 'Pedir', 'sugerido', 0),
    this.colPesos('valor', 'Valor a costo', 'valor_sugerido'),
    this.colPesos('quieto', 'Plata quieta', 'valor_quieto', { prioridad: 2 }),
  ];

  readonly columnasVendedores: ColumnaTabla<Fila>[] = [
    { id: 'vendedor', header: 'Cajero / usuario', valor: f => f['vendedor'], tarjeta: 'titulo' },
    this.colNum('documentos', 'Tickets', 'documentos'),
    this.colPesos('venta', 'Venta', 'venta'),
    this.colPesos('ticket', 'Ticket promedio', 'ticket_promedio'),
    this.colNum('clientes', 'Clientes', 'clientes', 0, { prioridad: 2 }),
    { id: 'primera', header: 'Desde', valor: f => f['primera'], prioridad: 2, tarjeta: 'meta' },
    { id: 'ultima', header: 'Hasta', valor: f => f['ultima'], prioridad: 2, tarjeta: 'meta' },
  ];

  readonly columnasCartera: ColumnaTabla<Fila>[] = [
    { id: 'cliente', header: 'Cliente', valor: f => f['cliente'], tarjeta: 'titulo' },
    { id: 'documento', header: 'Documento', valor: f => f['documento'], tarjeta: 'subtitulo', prioridad: 2 },
    { id: 'numero', header: 'Factura', valor: f => `${f['tipo'] === 'Venta POS' ? 'POS' : 'FV'} ${f['numero']}`, prioridad: 2 },
    { id: 'fecha', header: 'Fecha', valor: f => f['fecha'], tarjeta: 'meta' },
    this.colNum('dias', 'Días', 'dias'),
    this.colPesos('total', 'Total', 'total', { prioridad: 2 }),
    this.colPesos('saldo', 'Saldo', 'saldo'),
  ];

  readonly columnasEstados: ColumnaTabla<Fila>[] = [
    { id: 'tipo', header: 'Tipo', valor: f => f['tipo'], tarjeta: 'titulo' },
    { id: 'estado', header: 'Estado', valor: f => f['estado'], tarjeta: 'badge',
      badge: f => ({ texto: f['estado'], tono: f['estado'] === 'Contabilizado' ? 'ok' : f['estado'] === 'Anulado' ? 'danger' : 'warn' }) },
    this.colNum('documentos', 'Documentos', 'documentos'),
    this.colPesos('total', 'Total', 'total'),
  ];

  // ── Insignias ────────────────────────────────────────────────────────────

  badgeTendencia(f: Fila): BadgeCelda {
    const t = f['tendencia'];
    if (t === 'NUEVO') return { texto: 'Nuevo', tono: 'violet' };
    if (t === 'SE_DEJO_DE_VENDER') return { texto: 'Dejó de venderse', tono: 'danger' };
    if (t === 'SIN_VENTA') return { texto: 'Sin venta', tono: 'neutro' };
    const pct = f['tendencia_pct'] == null ? '' : ` ${Number(f['tendencia_pct']) > 0 ? '+' : ''}${this.num(f['tendencia_pct'], 0)}%`;
    if (t === 'SUBE') return { texto: `Sube${pct}`, tono: 'ok', icono: 'trending_up' };
    if (t === 'BAJA') return { texto: `Baja${pct}`, tono: 'warn', icono: 'trending_down' };
    return { texto: `Estable${pct}`, tono: 'info' };
  }

  textoLaboral(e: string): string {
    return e === 'ACTIVO' ? 'Activo' : e === 'RETIRADO' ? 'Ya no está' : 'Sin dato';
  }

  badgeLaboral(f: Fila): BadgeCelda {
    const e = f['estado_laboral'];
    if (e === 'ACTIVO') return f['bloqueado_tesoreria'] ? { texto: 'Activo · cupo bloqueado', tono: 'warn' } : { texto: 'Activo', tono: 'ok' };
    if (e === 'RETIRADO') return { texto: 'Ya no está', tono: 'neutro' };
    return { texto: 'Sin dato', tono: 'neutro' };
  }

  /** Enlace de WhatsApp: números colombianos de 10 dígitos llevan el 57 delante. */
  enlaceWhatsapp(numero: unknown): string | null {
    const d = String(numero ?? '').replace(/\D/g, '');
    if (d.length < 7) return null;
    return `https://wa.me/${d.length === 10 ? '57' + d : d}`;
  }

  badgeSegmento(s: string): BadgeCelda {
    const tono: Record<string, BadgeCelda['tono']> = {
      'Campeones': 'ok', 'Leales': 'ok', 'Nuevos': 'violet', 'Ocasionales': 'info',
      'En riesgo': 'danger', 'Enfriándose': 'warn', 'Perdidos': 'neutro',
    };
    return { texto: s, tono: tono[s] ?? 'neutro' };
  }

  badgeEstado(e: string): BadgeCelda {
    const m: Record<string, BadgeCelda> = {
      AGOTADO: { texto: 'Agotado', tono: 'danger' }, CRITICO: { texto: 'Menos de 7 días', tono: 'danger' },
      BAJO: { texto: 'Menos de 15 días', tono: 'warn' }, OK: { texto: 'Bien', tono: 'ok' },
      EXCESO: { texto: 'Sobra (>90 días)', tono: 'info' }, DORMIDO: { texto: 'Sin venta', tono: 'neutro' },
      SIN_CONTROL: { texto: 'Sin control de existencia', tono: 'violet' },
    };
    return m[e] ?? { texto: e, tono: 'neutro' };
  }

  readonly estadosReab = [
    { id: 'agotado', titulo: 'Agotados', ayuda: 'Se venden y no hay', clase: 'peligro' },
    { id: 'critico', titulo: 'Menos de 7 días', ayuda: 'Pedir ya', clase: 'peligro' },
    { id: 'bajo', titulo: 'Menos de 15 días', ayuda: 'Pedir en el próximo pedido', clase: 'aviso' },
    { id: 'sin_control', titulo: 'Sin control de existencia', ayuda: 'Logis los vendía en negativo: la cifra sale de la venta', clase: 'info' },
    { id: 'exceso', titulo: 'Sobran', ayuda: 'Más de 90 días de existencia', clase: 'info' },
    { id: 'dormido', titulo: 'Sin venta', ayuda: 'Hay existencia y nadie los compra', clase: 'neutra' },
  ];

  readonly filtroEstado = signal<string>('');
  readonly reabFiltrado = computed<Fila[]>(() => {
    const filas: Fila[] = this.reabastecimiento()?.['productos'] ?? [];
    const f = this.filtroEstado();
    return f ? filas.filter(x => String(x['estado']).toLowerCase() === f) : filas;
  });

  // ── Formato ──────────────────────────────────────────────────────────────

  pesos(valor: unknown): string {
    if (valor === null || valor === undefined || valor === '') return '—';
    const n = Number(valor);
    if (isNaN(n)) return '—';
    return formatCurrency(n, this.locale, getCurrencySymbol('COP', 'narrow', this.locale), 'COP', '1.0-0');
  }

  num(valor: unknown, decimales = 0): string {
    if (valor === null || valor === undefined || valor === '') return '—';
    const n = Number(valor);
    if (isNaN(n)) return '—';
    return formatNumber(n, this.locale, `1.${decimales}-${decimales}`);
  }

  corto(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e9) return `${this.num(v / 1e9, 1)} mil M`;
    if (a >= 1e6) return `${this.num(v / 1e6, 1)} M`;
    if (a >= 1e3) return `${this.num(v / 1e3, 0)} k`;
    return this.num(v, 0);
  }

  recortar(t: unknown, n: number): string {
    const s = String(t ?? '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  private readonly MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  private readonly MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  mesCorto(ym: string): string {
    const [a, m] = String(ym).split('-');
    return m ? `${this.MESES[Number(m) - 1]} ${a.slice(2)}` : ym;
  }

  mesLargo(ym: string): string {
    const [a, m] = String(ym ?? '').split('-');
    return m ? `${this.MESES_LARGOS[Number(m) - 1]} de ${a}` : String(ym ?? '');
  }

  fechaLarga(iso: string): string {
    const [a, m, d] = String(iso ?? '').split('-');
    return d ? `${Number(d)} de ${this.MESES_LARGOS[Number(m) - 1]} de ${a}` : String(iso ?? '');
  }

  nombreMetodo(m: string): string {
    const n: Record<string, string> = { NOMINA: 'Nómina', EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', NEQUI: 'Nequi',
      DAVIPLATA: 'Daviplata', TARJETA: 'Tarjeta', BONO: 'Bono', OTRO: 'Otro' };
    return n[m] ?? m;
  }

  nombreFuente(f: string): string {
    const n: Record<string, string> = {
      REAL: 'Costo que guardó Logis', MOVIMIENTO: 'Costo de compra del movimiento de inventario',
      PRODUCTO: 'Proporción del mismo producto', CATEGORIA: 'Proporción de su categoría',
      GLOBAL: 'Proporción de toda la tienda', 'SIN CALCULAR': 'Aún sin calcular',
    };
    return n[f] ?? f;
  }

  pagosLista(r: Fila | null): Array<{ metodo: string; valor: number; pct: number }> {
    const p: Record<string, number> = r?.['pagos_por_metodo'] ?? {};
    const total = Object.values(p).reduce((s, v) => s + Number(v), 0) || 1;
    return Object.entries(p).map(([metodo, valor]) => ({ metodo, valor: Number(valor), pct: Number(valor) * 100 / total }));
  }

  fuentesLista(lista: Fila[] | null | undefined): Array<Fila & { pct: number }> {
    const filas = lista ?? [];
    const total = filas.reduce((s, f) => s + Number(f['venta'] ?? 0), 0) || 1;
    return filas.map(f => ({ ...f, pct: Number(f['venta'] ?? 0) * 100 / total }));
  }

  colorCohorte(v: number | null): string {
    if (v == null) return 'transparent';
    const a = Math.min(1, Number(v) / 60);
    return `rgba(11,107,88,${(0.08 + a * 0.75).toFixed(2)})`;
  }

  numeroCodigo(lista: Fila[] | null | undefined, tipo: string): number {
    return Number((lista ?? []).find(x => x['tipo'] === tipo)?.['codigos'] ?? 0);
  }
}
