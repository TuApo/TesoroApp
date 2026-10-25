import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { ColumnaTabla, TABLA_ESTANDAR } from '@/app/shared/components/tabla-estandar';
import { GpuFicha } from '../../components/gpu-ficha/gpu-ficha';
import { GraficaSerie } from '../../components/grafica-serie/grafica-serie';
import { DetalleCluster, Host, NodoK8s, Pod } from '../../models/infra.models';
import { InfraService } from '../../services/infra.service';
import { InfraVivoService } from '../../services/infra-vivo.service';
import { bps, bytes, duracion, num, pct } from '../../utils/formato';

/**
 * El clúster K3s: nodos (cada equipo que se una aparece solo) con su almacenamiento,
 * temperatura y gráficas, pods, despliegues, servicios y eventos. Incluye la receta
 * para sumar un nodo.
 */
@Component({
  selector: 'app-infra-cluster',
  standalone: true,
  imports: [...TABLA_ESTANDAR, MatIconModule, GraficaSerie, GpuFicha],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cluster.html',
  styleUrls: ['../../styles/infra-comun.css', './cluster.css'],
})
export class InfraCluster {
  private readonly api = inject(InfraService);
  private readonly vivo = inject(InfraVivoService);
  readonly f = { bps, bytes, duracion, num, pct };
  readonly datos = signal<DetalleCluster | null>(null);
  readonly recetaAbierta = signal(false);
  /** Nodos con las gráficas abiertas (se piden solo al abrirlas). */
  readonly graficasAbiertas = signal<ReadonlySet<string>>(new Set());

  /** Nodos y pods del canal en vivo (cambian solos); el resto, de la consulta. */
  readonly nodos = computed(() => this.vivo.snapshot()?.nodos ?? this.datos()?.nodos ?? []);
  readonly pods = computed(() => this.vivo.snapshot()?.pods ?? this.datos()?.pods ?? []);

  /**
   * El equipo de cada nodo, con lo que da su node-exporter (discos, temperatura, red).
   * El servidor viene como "servidor"; los demás nodos, como "nodo-k3s" con su nombre.
   */
  readonly equipos = computed(() => {
    const hosts = this.vivo.snapshot()?.hosts ?? [];
    const m = new Map<string, Host>();
    for (const n of this.nodos()) {
      const h = hosts.find((x) => (x.tipo === 'servidor' || x.tipo === 'nodo-k3s') && (x.id === n.nombre || (!!n.ip && x.ip === n.ip)));
      if (h) m.set(n.nombre, h);
    }
    return m;
  });

  /** Lo que suma el clúster entero: núcleos, memoria y discos locales de todos los equipos. */
  readonly totales = computed(() => {
    const nodos = this.nodos();
    let nucleos = 0, mem = 0, disco = 0, libre = 0, discos = 0, gpus = 0;
    for (const n of nodos) {
      const h = this.equipos().get(n.nombre);
      gpus += h?.gpus?.length ?? 0;
      nucleos += h?.nucleos ?? n.cpu_capacidad ?? 0;
      mem += h?.mem_total ?? n.mem_capacidad ?? 0;
      for (const d of this.discosLocales(h)) { disco += d.total; libre += d.libre; discos++; }
    }
    return { equipos: nodos.length, listos: nodos.filter((n) => n.listo).length, nucleos, mem, disco, libre, discos, gpus };
  });

  readonly columnas: ColumnaTabla<Pod>[] = [
    { id: 'nombre', header: 'Pod', valor: (p) => p.nombre, tarjeta: 'titulo' },
    { id: 'ns', header: 'Namespace', valor: (p) => p.ns, tarjeta: 'subtitulo' },
    { id: 'nodo', header: 'Nodo', valor: (p) => p.nodo ?? '—', prioridad: 2 },
    {
      id: 'fase', header: 'Estado', align: 'center', valor: (p) => p.fase, tarjeta: 'badge',
      badge: (p) => ({ texto: p.fase, tono: p.fase === 'Running' && p.listos >= p.total ? 'ok' : p.fase === 'Succeeded' ? 'neutro' : 'danger' }),
    },
    { id: 'listos', header: 'Listos', align: 'center', valor: (p) => `${p.listos}/${p.total}` },
    { id: 'reinicios', header: 'Reinicios', align: 'right', valor: (p) => p.reinicios },
    { id: 'cpu', header: 'CPU', align: 'right', prioridad: 2, valor: (p) => p.cpu_milli ?? null, formato: (p) => (p.cpu_milli == null ? '—' : `${num(p.cpu_milli)} m`) },
    { id: 'mem', header: 'RAM', align: 'right', prioridad: 2, valor: (p) => p.mem_bytes ?? null, formato: (p) => bytes(p.mem_bytes) },
    { id: 'edad', header: 'Edad', align: 'right', prioridad: 3, valor: (p) => p.inicio ?? null,
      formato: (p) => (p.inicio ? duracion(Date.now() / 1000 - p.inicio) : '—') },
  ];
  readonly idPod = (p: Pod) => `${p.ns}/${p.nombre}`;
  readonly ahoraSeg = () => Date.now() / 1000;

  constructor() {
    const cargar = () => this.api.cluster().subscribe({ next: (d) => this.datos.set(d) });
    cargar();
    const t = setInterval(cargar, 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  /** Con node-exporter, la CPU del equipo entero; si no, la que mide metrics-server para Kubernetes. */
  usoCpu(n: NodoK8s): number | null {
    const h = this.equipos().get(n.nombre);
    if (h?.cpu_pct != null) return h.cpu_pct;
    return n.cpu_uso_milli != null && n.cpu_capacidad ? n.cpu_uso_milli / (n.cpu_capacidad * 10) : null;
  }

  usoMem(n: NodoK8s): number | null {
    const h = this.equipos().get(n.nombre);
    if (h?.mem_pct != null) return h.mem_pct;
    return n.mem_uso != null && n.mem_capacidad ? (100 * n.mem_uso) / n.mem_capacidad : null;
  }

  memUsada(n: NodoK8s): number | undefined {
    return this.equipos().get(n.nombre)?.mem_usada ?? n.mem_uso;
  }

  memTotal(n: NodoK8s): number | undefined {
    return this.equipos().get(n.nombre)?.mem_total ?? n.mem_capacidad;
  }

  /** Discos propios del equipo: fuera las carpetas de red (cifs/nfs), que son de otro equipo. */
  discosLocales(h: Host | undefined) {
    return (h?.discos ?? []).filter((d) => !/^(cifs|nfs)/.test(d.tipo));
  }

  discosRed(h: Host | undefined) {
    return (h?.discos ?? []).filter((d) => /^(cifs|nfs)/.test(d.tipo));
  }

  conTempGpu(h: Host): boolean {
    return (h.gpus ?? []).some((g) => g.temp_c != null);
  }

  conUsoGpu(h: Host): boolean {
    return (h.gpus ?? []).some((g) => g.uso_pct != null);
  }

  tonoDisco(p: number): string {
    return p >= 95 ? 'danger' : p >= 85 ? 'warn' : 'ok';
  }

  tonoTemp(t: number | undefined): string {
    return t == null ? '' : t >= 90 ? 'malo' : t >= 80 ? 'aviso' : '';
  }

  alternarGraficas(nombre: string) {
    this.graficasAbiertas.update((s) => {
      const n = new Set(s);
      n.has(nombre) ? n.delete(nombre) : n.add(nombre);
      return n;
    });
  }
}
