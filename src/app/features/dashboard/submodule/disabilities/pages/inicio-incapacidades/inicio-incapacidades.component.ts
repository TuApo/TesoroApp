/**
 * INICIO del modulo Incapacidades (2026-10-23): la pantalla de entrada con todas las cifras, ya
 * recortadas por el servidor a lo que el usuario puede ver (coordinador = sus oficinas; rol
 * SALUD-ALCANCE-* = sus centros de costo; Salud = toda la empresa), y accesos rapidos SOLO a los
 * submodulos que el usuario tiene en su menu.
 *
 * Una sola llamada (`GET /Incapacidades/v2/inicio`); los graficos son ngx-echarts con el mismo
 * tema claro/oscuro y la misma paleta que los Informes. Responsive: los coordinadores la abren en
 * la app Android.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';

import { provideEchartsTema } from '../../../../../../shared/utils/echarts-tema';
import { PermissionsService } from '../../../../../../core/services/permissions.service';
import { IncapacidadV2Service } from '../../services/incapacidad-v2/incapacidad-v2.service';
import {
  DiagnosticoInicio,
  FiltrosInicioIncapacidades,
  InicioIncapacidades,
  MesInicio,
  SerieInicio,
} from '../../models/inicio-incapacidades.model';

/** Paleta categorica (la misma de los Informes, CVD-safe en claro). */
export const PALETA_INICIO: readonly string[] = [
  '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00ACC1', '#E53935', '#5E35B1', '#7CB342', '#F4511E', '#3949AB',
];

/** Color fijo por tipo de incapacidad: el mismo que en los Informes. */
export const COLOR_TIPO_INICIO: Readonly<Record<string, string>> = {
  ENFERMEDAD_GENERAL: '#1E88E5',
  ACCIDENTE_TRABAJO: '#E53935',
  ENFERMEDAD_LABORAL: '#F4511E',
  ACCIDENTE_TRANSITO: '#FB8C00',
  LICENCIA_MATERNIDAD: '#8E24AA',
  LICENCIA_PATERNIDAD: '#5E35B1',
};

/** Base de las rutas del submodulo (igual que en db_admin.modulo). */
export const BASE_SALUD = '/dashboard/disabilities';
export const RUTA_INICIO = `${BASE_SALUD}/inicio`;

/** Un acceso rapido: lo que el menu del usuario trae + una frase de ayuda local. */
export interface AccesoRapido {
  ruta: string;
  nombre: string;
  icono: string;
  descripcion: string;
}

/**
 * Catalogo de submodulos con su orden y su ayuda. El NOMBRE y el ICONO salen del menu del usuario
 * (db_admin.modulo); de aqui solo se toma el orden y la frase. Lo que no este aqui pero si en el
 * menu bajo /dashboard/disabilities tambien sale (al final), para no esconder modulos nuevos.
 */
export const CATALOGO_ACCESOS: readonly { ruta: string; descripcion: string; icono: string }[] = [
  { ruta: `${BASE_SALUD}/registro`, descripcion: 'Registrar una incapacidad y sus soportes', icono: 'post_add' },
  { ruta: `${BASE_SALUD}/consulta`, descripcion: 'Buscar, ver el detalle y exportar', icono: 'fact_check' },
  { ruta: `${BASE_SALUD}/informes`, descripcion: 'Estadisticas, 180/540, recurrencia y top', icono: 'insights' },
  { ruta: `${BASE_SALUD}/alertas`, descripcion: 'Bandeja de alertas por atender', icono: 'notification_important' },
  { ruta: `${BASE_SALUD}/radicacion`, descripcion: 'Radicar ante la EPS / ARL', icono: 'assignment_turned_in' },
  { ruta: `${BASE_SALUD}/radicacion/recobro`, descripcion: 'Recobros de incapacidades negadas', icono: 'replay' },
  { ruta: `${BASE_SALUD}/sevenet`, descripcion: 'Archivo plano y soportes para SEVENET', icono: 'archive' },
  { ruta: `${BASE_SALUD}/liquidacion`, descripcion: 'Cargar la liquidacion de la EPS', icono: 'upload_file' },
  { ruta: `${BASE_SALUD}/liquidacion/pagos`, descripcion: 'Pagos recibidos', icono: 'payments' },
  { ruta: `${BASE_SALUD}/liquidacion/negaciones`, descripcion: 'Negaciones y sus causales', icono: 'block' },
  { ruta: `${BASE_SALUD}/sst`, descripcion: 'Investigaciones de accidentes (ARL)', icono: 'health_and_safety' },
  { ruta: `${BASE_SALUD}/correos`, descripcion: 'Correos a las empresas usuarias', icono: 'forward_to_inbox' },
];

/** Periodos rapidos del filtro. */
export type Periodo = 'ULTIMOS_12' | 'ANIO' | 'MES' | 'MES_ANTERIOR' | 'PERSONALIZADO';

export function isoLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dia}`;
}

/** Rango [desde, hasta] de un periodo rapido; el de 12 meses lo pone el servidor (vacio). */
export function rangoDePeriodo(p: Periodo, hoy = new Date()): { desde?: string; hasta?: string } {
  const y = hoy.getFullYear(), m = hoy.getMonth();
  switch (p) {
    case 'ANIO': return { desde: `${y}-01-01`, hasta: isoLocal(hoy) };
    case 'MES': return { desde: isoLocal(new Date(y, m, 1)), hasta: isoLocal(hoy) };
    case 'MES_ANTERIOR': return { desde: isoLocal(new Date(y, m - 1, 1)), hasta: isoLocal(new Date(y, m, 0)) };
    default: return {};
  }
}

/**
 * Los accesos rapidos: SOLO los modulos del menu del usuario bajo /dashboard/disabilities (sin el
 * propio Inicio), en el orden del catalogo y con su ayuda. Puro: se prueba directo.
 */
export function accesosDelMenu(
  modulos: readonly { ruta: string; nombre: string; icono: string }[],
): AccesoRapido[] {
  const propios = modulos.filter(
    (m) => m.ruta.startsWith(`${BASE_SALUD}/`) && m.ruta !== RUTA_INICIO,
  );
  const porRuta = new Map(propios.map((m) => [m.ruta, m]));
  const out: AccesoRapido[] = [];
  for (const c of CATALOGO_ACCESOS) {
    const m = porRuta.get(c.ruta);
    if (!m) continue;
    out.push({ ruta: m.ruta, nombre: m.nombre, icono: m.icono || c.icono, descripcion: c.descripcion });
    porRuta.delete(c.ruta);
  }
  for (const m of porRuta.values()) {
    out.push({ ruta: m.ruta, nombre: m.nombre, icono: m.icono || 'chevron_right', descripcion: '' });
  }
  return out;
}

/** Tono de la variacion del mes: subir incapacidades es malo. */
export function tonoVariacion(pct: number | null | undefined): 'sube' | 'baja' | 'igual' {
  if (pct === null || pct === undefined || pct === 0) return 'igual';
  return pct > 0 ? 'sube' : 'baja';
}

@Component({
  selector: 'app-inicio-incapacidades',
  standalone: true,
  imports: [
    DecimalPipe,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
    NgxEchartsDirective,
  ],
  providers: [provideEchartsTema()],
  templateUrl: './inicio-incapacidades.component.html',
  styleUrls: ['../gestion-incapacidades.comun.css', './inicio-incapacidades.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InicioIncapacidadesComponent implements OnInit {
  private readonly srv = inject(IncapacidadV2Service);
  private readonly permisos = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Filtros ───────────────────────────────────────────────────────────
  readonly periodo = signal<Periodo>('ULTIMOS_12');
  readonly desde = signal('');
  readonly hasta = signal('');
  readonly temporal = signal('');
  readonly oficina = signal('');

  readonly periodos: readonly { valor: Periodo; texto: string }[] = [
    { valor: 'ULTIMOS_12', texto: 'Ultimos 12 meses' },
    { valor: 'ANIO', texto: 'Este año' },
    { valor: 'MES', texto: 'Este mes' },
    { valor: 'MES_ANTERIOR', texto: 'Mes anterior' },
    { valor: 'PERSONALIZADO', texto: 'Personalizado' },
  ];

  // ── Estado ────────────────────────────────────────────────────────────
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly datos = signal<InicioIncapacidades | null>(null);

  /** Accesos rapidos: solo lo que el usuario tiene en su menu. */
  readonly accesos = signal<AccesoRapido[]>([]);

  readonly kpis = computed(() => this.datos()?.kpis ?? null);
  readonly tono = computed(() => tonoVariacion(this.kpis()?.variacionMesPct));
  readonly hayDatos = computed(() => (this.kpis()?.total ?? 0) > 0);

  ngOnInit(): void {
    this.accesos.set(accesosDelMenu(this.permisos.listReadableModules()));
    this.cargar();
  }

  filtros(): FiltrosInicioIncapacidades {
    const p = this.periodo();
    const rango = p === 'PERSONALIZADO' ? { desde: this.desde(), hasta: this.hasta() } : rangoDePeriodo(p);
    return { ...rango, temporal: this.temporal(), oficina: this.oficina() };
  }

  cambiarPeriodo(p: Periodo): void {
    this.periodo.set(p);
    if (p === 'PERSONALIZADO') {
      // Arranca con el rango que se esta viendo, para editarlo.
      const d = this.datos();
      if (d && !this.desde()) this.desde.set(d.desde);
      if (d && !this.hasta()) this.hasta.set(d.hasta);
    }
    this.cargar();
  }

  cargar(): void {
    const f = this.filtros();
    if (f.desde && f.hasta && f.desde > f.hasta) {
      this.error.set('La fecha inicial no puede ser posterior a la final.');
      return;
    }
    this.cargando.set(true);
    this.error.set('');
    this.srv
      .inicio(f)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => {
          this.datos.set(d);
          this.cargando.set(false);
        },
        error: (e: unknown) => {
          this.cargando.set(false);
          const err = e as { error?: { error?: string; message?: string } } | null;
          this.error.set(err?.error?.error || err?.error?.message || 'No se pudieron cargar las cifras del modulo.');
        },
      });
  }

  limpiarFiltros(): void {
    this.temporal.set('');
    this.oficina.set('');
    this.periodo.set('ULTIMOS_12');
    this.desde.set('');
    this.hasta.set('');
    this.cargar();
  }

  // ── Graficas ──────────────────────────────────────────────────────────

  readonly opcionTendencia = computed<EChartsOption>(() => tendencia(this.datos()?.series.porMes ?? []));
  readonly opcionTipo = computed<EChartsOption>(() =>
    dona(this.datos()?.series.porTipo ?? [], (s) => COLOR_TIPO_INICIO[s.clave]),
  );
  readonly opcionTemporal = computed<EChartsOption>(() => dona(this.datos()?.series.porTemporal ?? []));
  readonly opcionCargo = computed<EChartsOption>(() =>
    dona(this.datos()?.series.diasCargo ?? [], (s) => (s.clave === 'EMPRESA' ? '#FB8C00' : '#43A047'), 'dias'),
  );
  readonly opcionOficina = computed<EChartsOption>(() => barrasH(this.datos()?.series.porOficina ?? [], '#1E88E5'));
  readonly opcionEmpresa = computed<EChartsOption>(() => barrasH(this.datos()?.series.porEmpresa ?? [], '#00ACC1'));
  readonly opcionEps = computed<EChartsOption>(() => barrasH(this.datos()?.series.porEps ?? [], '#8E24AA'));
  readonly opcionDiagnosticos = computed<EChartsOption>(() =>
    barrasH(diagnosticosASerie(this.datos()?.series.diagnosticos ?? []), '#E53935'),
  );

  /** Alto de una grafica de barras horizontales segun cuantas filas tenga (legible en movil). */
  altoBarras(n: number | undefined): string {
    return `${Math.max(180, Math.min(460, 40 + (n ?? 0) * 30))}px`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers puros de graficas (probados en el spec)
// ─────────────────────────────────────────────────────────────────────────

/** Los diagnosticos como serie: "J00 · Rinofaringitis aguda". */
export function diagnosticosASerie(d: DiagnosticoInicio[]): SerieInicio[] {
  return d.map((x) => ({
    clave: x.codigo,
    etiqueta: x.descripcion ? `${x.codigo} · ${x.descripcion}` : x.codigo,
    cantidad: x.cantidad,
    dias: x.dias,
  }));
}

/** Barras (incapacidades) + linea (dias) por mes, con doble eje. */
export function tendencia(meses: MesInicio[]): EChartsOption {
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { bottom: 0, data: ['Incapacidades', 'Dias'] },
    grid: { left: 8, right: 8, top: 24, bottom: 40, containLabel: true },
    xAxis: { type: 'category', data: meses.map((m) => m.etiqueta), axisLabel: { hideOverlap: true } },
    yAxis: [
      { type: 'value', minInterval: 1, name: 'Incap.' },
      { type: 'value', minInterval: 1, name: 'Dias', splitLine: { show: false } },
    ],
    series: [
      {
        name: 'Incapacidades',
        type: 'bar',
        data: meses.map((m) => m.cantidad),
        itemStyle: { color: '#1E88E5', borderRadius: [6, 6, 0, 0] },
        barMaxWidth: 28,
      },
      {
        name: 'Dias',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 6,
        data: meses.map((m) => m.dias),
        itemStyle: { color: '#FB8C00' },
      },
    ],
  };
}

/** Dona con la leyenda abajo (cabe en movil). `valor` = que medida se pinta. */
export function dona(
  series: SerieInicio[],
  color?: (s: SerieInicio) => string | undefined,
  valor: 'cantidad' | 'dias' = 'cantidad',
): EChartsOption {
  const unidad = valor === 'dias' ? 'dias' : 'incapacidades';
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: unknown) => {
        const x = p as { name: string; value: number; percent: number };
        return `${x.name}<br/><b>${x.value.toLocaleString('es-CO')}</b> ${unidad} (${x.percent}%)`;
      },
    },
    legend: { bottom: 0, left: 'center', type: 'scroll' },
    color: [...PALETA_INICIO],
    series: [
      {
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '44%'],
        padAngle: 2,
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' } },
        labelLine: { show: false },
        data: series.map((s) => ({
          name: s.etiqueta,
          value: s[valor],
          ...(color?.(s) ? { itemStyle: { color: color(s) } } : {}),
        })),
      },
    ],
  };
}

/** Barras horizontales de mayor (arriba) a menor; etiquetas truncadas para movil. */
export function barrasH(series: SerieInicio[], color: string): EChartsOption {
  const ordenadas = [...series].sort((a, b) => a.cantidad - b.cantidad);
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (p: unknown) => {
        const filas = p as { dataIndex: number }[];
        const s = ordenadas[filas[0]?.dataIndex ?? 0];
        return s ? `${s.etiqueta}<br/><b>${s.cantidad.toLocaleString('es-CO')}</b> incapacidades · ${s.dias.toLocaleString('es-CO')} dias` : '';
      },
    },
    grid: { left: 8, right: 36, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: {
      type: 'category',
      data: ordenadas.map((s) => s.etiqueta),
      axisLabel: { width: 130, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        data: ordenadas.map((s) => s.cantidad),
        itemStyle: { color, borderRadius: [0, 6, 6, 0] },
        barMaxWidth: 20,
        label: { show: true, position: 'right', fontSize: 11 },
      },
    ],
  };
}
