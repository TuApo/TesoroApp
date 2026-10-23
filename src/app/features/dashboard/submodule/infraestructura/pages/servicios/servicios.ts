import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { GraficaSerie } from '../../components/grafica-serie/grafica-serie';
import { Eficiencia, Grupo, LineaLog, NOMBRE_GRUPO, Rango, UsoGlobal, UsoRuta, UsoServicio } from '../../models/infra.models';
import { InfraService } from '../../services/infra.service';
import { bytes, compacto, duracion, estadoContenedor, fecha, ms, num, pct } from '../../utils/formato';

const EFICIENCIA: Record<Eficiencia, { texto: string; tono: 'ok' | 'warn' | 'danger' | 'info' | 'neutro' | 'violet' }> = {
  ajustado: { texto: 'Ajustado', tono: 'ok' },
  sobredimensionado: { texto: 'Sobredimensionado', tono: 'info' },
  'al-limite': { texto: 'Al límite', tono: 'danger' },
  ocioso: { texto: 'Casi sin uso', tono: 'violet' },
};

/**
 * Cuánto se usa de verdad cada servicio en el rango elegido: peticiones, errores,
 * latencia, CPU, memoria contra su límite, estrangulamiento, reinicios y ruido de logs,
 * con una recomendación en lenguaje llano por cada cosa que se sale de lo normal.
 */
@Component({
  selector: 'app-infra-servicios',
  standalone: true,
  imports: [...TABLA_ESTANDAR, MatIconModule, MatTooltipModule, GraficaSerie],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './servicios.html',
  styleUrls: ['../../styles/infra-comun.css', './servicios.css'],
})
export class InfraServicios {
  private readonly api = inject(InfraService);

  readonly f = { bytes, compacto, duracion, ms, num, pct, fecha };
  readonly rangos: Rango[] = ['1h', '6h', '24h', '7d', '30d'];
  /** 7 días por defecto: un día suelto (un domingo) hace parecer ocioso lo que no lo es. */
  readonly rango = signal<Rango>('7d');
  readonly cargando = signal(false);
  readonly datos = signal<UsoGlobal | null>(null);
  readonly error = signal<string | null>(null);
  readonly elegido = signal<UsoServicio | null>(null);
  readonly grupoFiltro = signal<Grupo | 'todos'>('todos');

  readonly logs = signal<LineaLog[] | null>(null);
  readonly logsNivel = signal<'error' | 'warn' | 'todo'>('error');
  readonly logsCargando = signal(false);

  readonly grupos = computed(() => {
    const g = new Set<Grupo>();
    for (const s of this.datos()?.servicios ?? []) g.add(s.grupo);
    return [...g];
  });
  readonly nombreGrupo = NOMBRE_GRUPO;

  readonly filas = computed(() => {
    const l = this.datos()?.servicios ?? [];
    const g = this.grupoFiltro();
    return g === 'todos' ? l.filter((x) => x.grupo !== 'pruebas') : l.filter((x) => x.grupo === g);
  });

  private static readonly PESO_EF: Record<string, number> = { 'al-limite': 0, sobredimensionado: 1, ocioso: 2, ajustado: 3 };
  readonly conRecomendacion = computed(() => this.filas()
    .filter((s) => (s.recomendaciones?.length ?? 0) > 0)
    .sort((a, b) => (InfraServicios.PESO_EF[a.eficiencia ?? 'ajustado'] - InfraServicios.PESO_EF[b.eficiencia ?? 'ajustado'])
      || b.peticiones - a.peticiones));
  readonly verTodas = signal(false);
  readonly recsVisibles = computed(() => (this.verTodas() ? this.conRecomendacion() : this.conRecomendacion().slice(0, 8)));

  readonly memoriaRecuperable = computed(() => {
    let b = 0;
    for (const s of this.filas()) {
      if (s.eficiencia === 'sobredimensionado' && s.mem_limite && s.mem_max != null) b += Math.max(0, s.mem_limite - s.mem_max);
    }
    return b;
  });

  readonly rutasMax = computed(() => Math.max(1, ...(this.datos()?.rutas ?? []).map((r) => r.peticiones)));

  readonly columnas: ColumnaTabla<UsoServicio>[] = [
    { id: 'servicio', header: 'Servicio', valor: (s) => s.servicio, tarjeta: 'titulo', minAncho: '150px' },
    { id: 'zona', header: 'Zona', valor: (s) => NOMBRE_GRUPO[s.grupo], prioridad: 3, tarjeta: 'subtitulo' },
    {
      id: 'estado', header: 'Estado', align: 'center', valor: (s) => estadoContenedor(s.estado).texto, tarjeta: 'badge',
      badge: (s) => { const e = estadoContenedor(s.estado); return { texto: e.texto, tono: e.tono }; },
    },
    { id: 'peticiones', header: 'Peticiones', align: 'right', valor: (s) => s.peticiones, formato: (s) => compacto(s.peticiones) },
    { id: 'rps', header: 'req/s máx', align: 'right', prioridad: 3, valor: (s) => s.rps_max ?? null, formato: (s) => num(s.rps_max, 2) },
    {
      id: 'err', header: '5xx', align: 'right', prioridad: 2, valor: (s) => s.err_pct ?? null,
      formato: (s) => (s.err_pct == null ? '—' : `${pct(s.err_pct, 2)} (${compacto(s.err5xx)})`),
    },
    { id: 'lat', header: 'Respuesta media', align: 'right', prioridad: 2, valor: (s) => s.lat_media_ms ?? null, formato: (s) => ms(s.lat_media_ms) },
    { id: 'cpu', header: 'CPU media / pico', align: 'right', prioridad: 2, valor: (s) => s.cpu_medio ?? null,
      formato: (s) => (s.cpu_medio == null ? '—' : `${num(s.cpu_medio)} % / ${num(s.cpu_max)} %`) },
    { id: 'mem', header: 'RAM pico / límite', align: 'right', valor: (s) => s.mem_max ?? null,
      formato: (s) => (s.mem_max == null ? '—' : `${bytes(s.mem_max)} / ${s.mem_limite ? bytes(s.mem_limite) : '∞'}`) },
    {
      id: 'memuso', header: 'Uso RAM', align: 'center', prioridad: 2,
      valor: (s) => (s.mem_max != null && s.mem_limite ? Math.round((100 * s.mem_max) / s.mem_limite) : null),
      badge: (s) => {
        if (s.mem_max == null || !s.mem_limite) return null;
        const p = (100 * s.mem_max) / s.mem_limite;
        return { texto: `${Math.round(p)} %`, tono: p > 85 ? 'danger' : p < 35 ? 'info' : 'ok' };
      },
    },
    { id: 'thr', header: 'CPU frenada', align: 'right', prioridad: 3, valor: (s) => s.cpu_estrangulada_pct ?? null, formato: (s) => pct(s.cpu_estrangulada_pct) },
    { id: 'reinicios', header: 'Reinicios', align: 'right', prioridad: 2, valor: (s) => s.reinicios ?? 0 },
    { id: 'logs', header: 'Avisos en log (24 h)', align: 'right', prioridad: 3, valor: (s) => s.logs_warn ?? null, formato: (s) => compacto(s.logs_warn) },
    { id: 'uptime', header: 'Encendido', align: 'right', prioridad: 3, valor: (s) => s.uptime_seg ?? null, formato: (s) => duracion(s.uptime_seg) },
    {
      id: 'eficiencia', header: 'Uso de recursos', align: 'center', tarjeta: 'badge',
      valor: (s) => (s.eficiencia ? EFICIENCIA[s.eficiencia].texto : ''),
      badge: (s) => (s.eficiencia ? EFICIENCIA[s.eficiencia] : null),
    },
    { id: 'recs', header: 'Sugerencias', align: 'center', valor: (s) => s.recomendaciones?.length ?? 0,
      formato: (s) => (s.recomendaciones?.length ? `${s.recomendaciones.length}` : '—') },
  ];
  readonly idFila = (s: UsoServicio) => s.contenedor;
  readonly claseFila = (s: UsoServicio) =>
    s.estado !== 'running' ? 'te-fila--atenuada' : s.eficiencia === 'al-limite' ? 'te-fila--alerta' : '';

  constructor() {
    effect(() => {
      const r = this.rango();
      untracked(() => this.cargar(r));
    });
  }

  cargar(r: Rango) {
    this.cargando.set(true);
    this.error.set(null);
    this.api.servicios(r).subscribe({
      next: (d) => {
        this.datos.set(d);
        this.cargando.set(false);
        const e = this.elegido();
        if (e) this.elegido.set(d.servicios.find((x) => x.contenedor === e.contenedor) ?? null);
      },
      error: () => { this.cargando.set(false); this.error.set('No se pudo calcular el uso. ¿Prometheus responde?'); },
    });
  }

  abrir(s: UsoServicio) {
    this.elegido.set(s);
    this.logs.set(null);
    setTimeout(() => document.getElementById('infra-detalle-servicio')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  }

  verLogs(nivel: 'error' | 'warn' | 'todo') {
    const s = this.elegido();
    if (!s) return;
    this.logsNivel.set(nivel);
    this.logsCargando.set(true);
    this.api.logs(s.contenedor, nivel, 80).subscribe({
      next: (l) => { this.logs.set(l); this.logsCargando.set(false); },
      error: () => { this.logs.set([]); this.logsCargando.set(false); },
    });
  }

  rangoSerie(): Rango {
    return this.rango();
  }

  anchoRuta(r: UsoRuta): number {
    return (100 * r.peticiones) / this.rutasMax();
  }

  esJava(s: UsoServicio): boolean {
    return s.heap_max_pct != null || s.rutas != null && s.rutas.length > 0 || s.lat_media_ms != null;
  }
}
