import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { LowerCasePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';

import { GpuFicha } from '../../components/gpu-ficha/gpu-ficha';
import { GraficaSerie } from '../../components/grafica-serie/grafica-serie';
import { RackLeds } from '../../components/rack-leds/rack-leds';
import { Contenedor, Hallazgo, NOMBRE_GRUPO, NOMBRE_SEVERIDAD, ResumenUbicaciones, Severidad, Sitio } from '../../models/infra.models';
import { InfraService } from '../../services/infra.service';
import { InfraVivoService } from '../../services/infra-vivo.service';
import { bps, bytes, duracion, duracionCorta, estadoContenedor, hace, hora, ms, num, pct } from '../../utils/formato';

const ICONO_SEV: Record<Severidad, string> = { critico: 'error', serio: 'warning', atencion: 'info', info: 'check_circle' };

/**
 * La primera pantalla: ¿está todo bien ahora y, si no, qué se arregla primero?
 * Arriba las lecturas del servidor; en el centro la lista de hallazgos ordenada por
 * gravedad; al lado los contenedores como luces de rack y la bitácora en vivo.
 */
@Component({
  selector: 'app-infra-resumen',
  standalone: true,
  imports: [LowerCasePipe, MatIconModule, MatTooltipModule, RouterLink, RackLeds, GraficaSerie, GpuFicha],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './resumen.html',
  styleUrls: ['../../styles/infra-comun.css', './resumen.css'],
})
export class InfraResumen {
  readonly vivo = inject(InfraVivoService);
  private readonly api = inject(InfraService);

  readonly f = { bps, bytes, duracion, duracionCorta, hace, hora, ms, num, pct };
  readonly iconoSev = ICONO_SEV;
  readonly nombreSev = NOMBRE_SEVERIDAD;
  readonly nombreGrupo = NOMBRE_GRUPO;

  readonly s = computed(() => this.vivo.snapshot());
  readonly k = computed(() => this.s()?.kpis ?? null);
  readonly host = computed(() => this.s()?.hosts.find((h) => h.tipo === 'servidor' && h.origen === 'prometheus') ?? null);
  readonly equipos = computed(() => (this.s()?.hosts ?? []).filter((h) => h.origen !== 'prometheus'));
  /** Equipos (servidor y nodos del clúster) con al menos una tarjeta gráfica, el servidor primero. */
  readonly conGpu = computed(() => (this.s()?.hosts ?? [])
    .filter((h) => (h.tipo === 'servidor' || h.tipo === 'nodo-k3s') && (h.gpus?.length ?? 0) > 0)
    .sort((a, b) => (a.tipo === 'servidor' ? -1 : b.tipo === 'servidor' ? 1 : a.nombre.localeCompare(b.nombre))));
  /** Cada equipo con discos (el servidor y los nodos del clúster con node-exporter), el servidor primero. */
  readonly almacenamiento = computed(() => (this.s()?.hosts ?? [])
    .filter((h) => (h.tipo === 'servidor' || h.tipo === 'nodo-k3s') && (h.discos?.length ?? 0) > 0)
    .sort((a, b) => (a.tipo === 'servidor' ? -1 : b.tipo === 'servidor' ? 1 : a.nombre.localeCompare(b.nombre))));
  readonly fuentesCaidas = computed(() => (this.s()?.fuentes ?? []).filter((f) => !f.ok));

  readonly severidades: Severidad[] = ['critico', 'serio', 'atencion'];
  readonly filtroSev = signal<Severidad | null>(null);
  readonly hallazgos = computed(() => {
    const h = this.s()?.salud.hallazgos ?? [];
    const f = this.filtroSev();
    return f ? h.filter((x) => x.severidad === f) : h;
  });
  readonly conteoSev = computed(() => {
    const c: Record<string, number> = { critico: 0, serio: 0, atencion: 0 };
    for (const h of this.s()?.salud.hallazgos ?? []) c[h.severidad] = (c[h.severidad] ?? 0) + 1;
    return c;
  });
  readonly abiertos = signal<Set<string>>(new Set());

  readonly elegido = signal<Contenedor | null>(null);
  /** El contenedor elegido, siempre con sus datos de la última foto. */
  readonly detalle = computed(() => {
    const e = this.elegido();
    if (!e) return null;
    return this.s()?.contenedores.find((c) => c.nombre === e.nombre) ?? e;
  });

  readonly sitios = signal<Sitio[]>([]);
  readonly ubicaciones = signal<ResumenUbicaciones | null>(null);
  /** Respaldos de todas las ubicaciones que no están al día (los primeros 5). */
  readonly respaldosMalos = computed(() =>
    (this.ubicaciones()?.lista ?? []).flatMap((u) => u.respaldos.filter((r) => r.estado !== 'al-dia').map((r) => ({ ...r, ubicacion: u.ubicacion.nombre }))).slice(0, 5));

  constructor() {
    const cargar = () => {
      this.api.sitios('24h').subscribe({ next: (d) => this.sitios.set(d.sitios.filter((x) => x.origen !== 'logs')) });
      this.api.ubicaciones().subscribe({ next: (u) => this.ubicaciones.set(u), error: () => this.ubicaciones.set(null) });
    };
    cargar();
    const t = setInterval(cargar, 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  tonoUbicacion(estado: string): string {
    return estado === 'ok' ? 'ok' : estado === 'critico' ? 'danger' : estado === 'atencion' ? 'warn' : 'neutro';
  }

  alternar(h: Hallazgo) {
    this.abiertos.update((s) => {
      const n = new Set(s);
      n.has(h.id) ? n.delete(h.id) : n.add(h.id);
      return n;
    });
  }

  filtrar(sev: Severidad) {
    this.filtroSev.update((f) => (f === sev ? null : sev));
  }

  /** Polilínea SVG de la historia corta del canal (0..100 de alto). */
  pulso(campo: 'cpu' | 'mem' | 'req' | 'rx'): string {
    const p = this.vivo.pulso();
    if (p.length < 2) return '';
    const vals = p.map((x) => x[campo]);
    const max = campo === 'cpu' || campo === 'mem' ? 100 : Math.max(...vals, 0.0001);
    return vals.map((v, i) => `${((i / (vals.length - 1)) * 100).toFixed(1)},${(22 - (v / max) * 20).toFixed(1)}`).join(' ');
  }

  estado(c: Contenedor) {
    return estadoContenedor(c.estado, c.salud);
  }

  tonoDisco(pct: number): string {
    return pct >= 95 ? 'danger' : pct >= 85 ? 'warn' : 'ok';
  }

  tonoSitio(s: Sitio): string {
    return s.estado === 'ok' ? (s.dns === 'sin DNS' ? 'warn' : 'ok') : s.estado === 'caido' ? 'danger' : 'neutro';
  }
}
