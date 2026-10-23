import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { Aforo, AforoSede, AforoZona, Camara, Conteos, Demografia, PuntoConteo, Sede } from '../../models/seguridad.models';
import { SeguridadService } from '../../services/seguridad.service';
import { SeguridadVivoService } from '../../services/seguridad-vivo.service';
import { fechaHora, hace, hoyInput, horaCorta, isoLocal, num, soloFecha } from '../../utils/formato';

type Rango = 'hoy' | 'ayer' | '7d' | '30d' | 'otro';
type Agrupar = 'hora' | 'dia';

/** Medidas del gráfico (viewBox fijo; el SVG escala al ancho disponible). */
const G = { w: 800, h: 260, izq: 44, der: 12, arr: 14, aba: 30 };

interface Barra { x: number; w: number; yE: number; hE: number; yS: number; hS: number; p: PuntoConteo; etiqueta: string; }

/**
 * Analítica IA: aforo en vivo por sede y zona (llega por el canal en vivo), conteos de
 * entradas/salidas por hora o por día con gráfico propio en SVG (sin librerías) y demografía
 * agregada cuando está habilitada (apagada por defecto: ver Configuración → Privacidad).
 */
@Component({
  selector: 'app-seguridad-analitica',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, ...TABLA_ESTANDAR],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './analitica.html',
  styleUrls: ['../../styles/seguridad-comun.css', './analitica.css'],
})
export class SeguridadAnalitica {
  private readonly api = inject(SeguridadService);
  readonly vivo = inject(SeguridadVivoService);

  readonly sedes = signal<Sede[]>([]);
  readonly camaras = signal<Camara[]>([]);
  readonly aforo = signal<Aforo | null>(null);
  readonly errorAforo = signal<string | null>(null);

  // Filtros de conteos
  readonly sedeId = signal<string | null>(null);
  readonly camaraId = signal<string | null>(null);
  readonly rango = signal<Rango>('hoy');
  readonly desde = signal(hoyInput());
  readonly hasta = signal(hoyInput());
  readonly agrupar = signal<Agrupar>('hora');

  readonly conteos = signal<Conteos | null>(null);
  readonly demografia = signal<Demografia | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  readonly f = { num, hace, fechaHora, horaCorta, soloFecha };
  readonly g = G;

  readonly camarasSede = computed(() => {
    const s = this.sedeId();
    return this.camaras().filter((c) => !s || c.sede_id === s);
  });

  /** Aforo leído por HTTP con lo que llegó por el canal en vivo encima. */
  readonly aforoVivo = computed<AforoSede[]>(() => {
    const vivo = this.vivo.aforo();
    return (this.aforo()?.sedes ?? []).map((s) => {
      const zonas: AforoZona[] = s.zonas.map((z) => {
        const c = vivo.get(`${s.sede_id}|${z.zona_id ?? ''}|${z.camara_id ?? ''}`) ?? vivo.get(`${s.sede_id}|${z.zona_id ?? ''}|`);
        return c ? { ...z, ocupacion: c.ocupacion, actualizado_en: isoLocal(new Date()) } : z;
      });
      const total = vivo.get(`${s.sede_id}||`);
      const ocupacion = total ? total.ocupacion : zonas.length ? zonas.reduce((t, z) => t + (z.ocupacion || 0), 0) : s.ocupacion;
      return { ...s, zonas, ocupacion };
    });
  });
  readonly totalPersonas = computed(() => this.aforoVivo().reduce((t, s) => t + (s.ocupacion || 0), 0));

  // ── Gráfico ──────────────────────────────────────────────────────────────
  readonly serie = computed(() => this.conteos()?.serie ?? []);
  readonly maximo = computed(() => {
    const m = Math.max(1, ...this.serie().map((p) => Math.max(p.entradas, p.salidas, p.ocupacion_max)));
    // Redondeo "bonito" del tope del eje.
    const pot = Math.pow(10, Math.floor(Math.log10(m)));
    return Math.ceil(m / pot) * pot;
  });
  readonly marcasY = computed(() => [0, 0.25, 0.5, 0.75, 1].map((k) => ({ v: Math.round(this.maximo() * k), y: this.yDe(this.maximo() * k) })));
  readonly barras = computed<Barra[]>(() => {
    const s = this.serie();
    if (!s.length) return [];
    const ancho = (G.w - G.izq - G.der) / s.length;
    const wb = Math.max(1, Math.min(18, ancho * 0.38));
    return s.map((p, i) => {
      const x0 = G.izq + i * ancho + ancho / 2;
      const yE = this.yDe(p.entradas), yS = this.yDe(p.salidas);
      return {
        x: x0, w: wb, yE, hE: G.h - G.aba - yE, yS, hS: G.h - G.aba - yS, p,
        etiqueta: this.agrupar() === 'hora' && this.dias() <= 1 ? horaCorta(p.t) : soloFecha(p.t),
      };
    });
  });
  readonly lineaOcupacion = computed(() => this.barras().map((b) => `${b.x},${this.yDe(b.p.ocupacion_max)}`).join(' '));
  /** Cada cuántas barras se rotula el eje X para que no se monten. */
  readonly pasoEtiqueta = computed(() => Math.max(1, Math.ceil(this.barras().length / 12)));
  readonly dias = computed(() => {
    const a = new Date(`${this.desde()}T00:00:00`).getTime(), b = new Date(`${this.hasta()}T00:00:00`).getTime();
    return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
  });

  // ── Demografía ───────────────────────────────────────────────────────────
  readonly maxDemo = computed(() => Math.max(1, ...(this.demografia()?.rangos ?? []).map((r) => r.hombres + r.mujeres + r.sin_dato)));

  readonly columnas: ColumnaTabla<PuntoConteo>[] = [
    { id: 't', header: 'Periodo', valor: (p) => p.t, formato: (p) => (this.agrupar() === 'hora' ? fechaHora(p.t) : soloFecha(p.t)), tarjeta: 'titulo' },
    { id: 'entradas', header: 'Entradas', align: 'right', valor: (p) => p.entradas },
    { id: 'salidas', header: 'Salidas', align: 'right', valor: (p) => p.salidas },
    { id: 'ocupacion_max', header: 'Ocupación máx.', align: 'right', valor: (p) => p.ocupacion_max },
    { id: 'personas', header: 'Personas distintas', align: 'right', valor: (p) => p.personas, prioridad: 2 },
  ];
  readonly idPunto = (p: PuntoConteo) => p.t;

  constructor() {
    this.api.sedes().subscribe({ next: (s) => this.sedes.set(s), error: () => {} });
    this.api.camaras().subscribe({ next: (c) => this.camaras.set(c), error: () => {} });
    this.cargarAforo();
    this.cargar();
    // El aforo llega en vivo; la relectura completa cada minuto corrige lo que se haya perdido.
    const t = setInterval(() => this.cargarAforo(), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  private yDe(v: number): number { return G.arr + (1 - v / this.maximo()) * (G.h - G.arr - G.aba); }

  cargarAforo(): void {
    this.api.aforo().subscribe({
      next: (a) => { this.aforo.set(a); this.errorAforo.set(null); },
      error: (e) => this.errorAforo.set(mensajeDeError(e, 'No se pudo leer el aforo.')),
    });
  }

  ponerRango(r: Rango): void {
    this.rango.set(r);
    const hoy = new Date();
    const d = (n: number) => isoLocal(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - n)).slice(0, 10);
    switch (r) {
      case 'hoy': this.desde.set(d(0)); this.hasta.set(d(0)); this.agrupar.set('hora'); break;
      case 'ayer': this.desde.set(d(1)); this.hasta.set(d(1)); this.agrupar.set('hora'); break;
      case '7d': this.desde.set(d(6)); this.hasta.set(d(0)); this.agrupar.set('dia'); break;
      case '30d': this.desde.set(d(29)); this.hasta.set(d(0)); this.agrupar.set('dia'); break;
      default: break;
    }
    if (r !== 'otro') this.cargar();
  }

  ponerSede(id: string | null): void {
    this.sedeId.set(id);
    if (this.camaraId() && !this.camarasSede().some((c) => c.id === this.camaraId())) this.camaraId.set(null);
    this.cargar();
  }

  cargar(): void {
    if (!this.desde() || !this.hasta()) return;
    if (this.hasta() < this.desde()) { this.error.set('La fecha final no puede ser anterior a la inicial.'); return; }
    const desde = `${this.desde()}T00:00:00`, hasta = `${this.hasta()}T23:59:59`;
    this.cargando.set(true);
    this.error.set(null);
    this.api.conteos({ sede_id: this.sedeId(), camara_id: this.camaraId(), desde, hasta, agrupar: this.agrupar() }).subscribe({
      next: (c) => { this.conteos.set(c); this.cargando.set(false); },
      error: (e) => { this.cargando.set(false); this.conteos.set(null); this.error.set(mensajeDeError(e, 'No se pudieron leer los conteos.')); },
    });
    this.api.demografia({ sede_id: this.sedeId(), desde, hasta }).subscribe({
      next: (d) => this.demografia.set(d),
      error: () => this.demografia.set(null),
    });
  }

  porcentaje(z: { ocupacion: number; capacidad: number | null }): number | null {
    return z.capacidad ? Math.min(100, Math.round((z.ocupacion / z.capacidad) * 100)) : null;
  }
  tonoAforo(z: { ocupacion: number; capacidad: number | null }): 'ok' | 'warn' | 'danger' | 'neutro' {
    const p = this.porcentaje(z);
    if (p === null) return 'neutro';
    return p >= 100 ? 'danger' : p >= 80 ? 'warn' : 'ok';
  }
  anchoDemo(n: number): number { return (n / this.maxDemo()) * 100; }
}
