import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { provideEchartsTema } from '@/app/shared/utils/echarts-tema';
import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { obtenerUsuarioActual } from '@/app/core/utils/usuario-actual';
import { ActividadApiService } from '../../actividad-api.service';
import { Ficha, ItemLinea } from '../../actividad.models';
import { TIPOS_ACCION, duracion, fecha, fechaHora, hace, hora, hoyIso, rangoDe } from '../../actividad-ui';

type Pestana = 'linea' | 'sesiones' | 'hizo' | 'pantallas' | 'tareas' | 'comunicaciones';

const DIAS = ['', 'Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/**
 * Todo lo que hizo una persona en la plataforma, a detalle: indicadores, sesiones, módulos,
 * pantallas, tareas, comunicaciones y la línea de tiempo que junta todas las fuentes
 * (acciones en la app, ingresos, cambios, tareas, tickets, chat, afiliaciones, tesorería…).
 */
@Component({
  selector: 'app-actividad-persona',
  standalone: true,
  imports: [RouterLink, FormsModule, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressSpinnerModule, NgxEchartsDirective],
  providers: [provideEchartsTema()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './persona.component.html',
  styleUrls: ['../../actividad-comun.css', './persona.component.css'],
})
export class PersonaComponent implements OnInit {
  private readonly api = inject(ActividadApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly visor = inject(DocViewerService);

  readonly id = input.required<string>();

  readonly periodos = [{ clave: 'hoy', etiqueta: 'Hoy' }, { clave: '7', etiqueta: '7 días' }, { clave: '30', etiqueta: '30 días' }, { clave: '90', etiqueta: '90 días' }];
  readonly periodo = signal('30');
  readonly desde = signal(rangoDe('30').desde);
  readonly hasta = signal(hoyIso());
  readonly f = signal<Ficha | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly pestana = signal<Pestana>('linea');

  // Línea de tiempo
  readonly linea = signal<ItemLinea[]>([]);
  readonly siguiente = signal<string | null>(null);
  readonly cargandoLinea = signal(false);
  readonly fuentesSel = signal<string[]>([]);
  readonly tipoSel = signal('');
  readonly moduloSel = signal('');
  readonly qLinea = signal('');
  readonly ocultarPantallas = signal(false);

  readonly TIPOS = TIPOS_ACCION;
  readonly Math = Math;
  readonly fechaHora = fechaHora;
  readonly hace = hace;
  readonly hora = hora;
  readonly duracion = duracion;
  readonly esSupervisorBandeja = ['ADMIN', 'GERENCIA'].includes((obtenerUsuarioActual().rol || '').toUpperCase());

  /** La línea agrupada por día para leerla como un diario. */
  readonly porDia = computed(() => {
    const grupos: { dia: string; items: ItemLinea[] }[] = [];
    for (const i of this.linea()) {
      const dia = fecha(i.fecha).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const g = grupos[grupos.length - 1];
      if (g && g.dia === dia) g.items.push(i); else grupos.push({ dia, items: [i] });
    }
    return grupos;
  });

  readonly graficaDias = computed<EChartsOption>(() => {
    const d = this.f()?.por_dia ?? [];
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0 },
      grid: { left: 40, right: 16, top: 16, bottom: 44 },
      xAxis: { type: 'category', data: d.map(x => x.dia.slice(5)) },
      yAxis: { type: 'value' },
      series: [
        { name: 'Acciones', type: 'bar', data: d.map(x => x.peticiones), itemStyle: { borderRadius: [4, 4, 0, 0] } },
        { name: 'Cambios', type: 'line', smooth: true, data: d.map(x => x.cambios) },
        { name: 'Pantallas', type: 'line', smooth: true, data: d.map(x => x.pantallas) },
      ],
    };
  });

  readonly graficaHoras = computed<EChartsOption>(() => {
    const h = this.f()?.por_hora ?? [];
    const max = Math.max(1, ...h.map(x => x.total));
    return {
      tooltip: { position: 'top', formatter: (p: any) => `${DIAS[p.value[1] + 1]} ${p.value[0]}:00 — ${p.value[2]} acciones` },
      grid: { left: 44, right: 10, top: 10, bottom: 60 },
      xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, i) => `${i}`), splitArea: { show: true } },
      yAxis: { type: 'category', data: DIAS.slice(1), splitArea: { show: true } },
      visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120 },
      series: [{ type: 'heatmap', data: h.map(x => [x.hora, x.dia_semana - 1, x.total]), emphasis: { itemStyle: { shadowBlur: 6 } } }],
    } as EChartsOption;
  });

  readonly graficaModulos = computed<EChartsOption>(() => {
    const m = [...(this.f()?.por_modulo ?? [])].slice(0, 12).reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0 },
      grid: { left: 130, right: 16, top: 10, bottom: 40 },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: m.map(x => x.modulo) },
      series: [
        { name: 'Consultas', type: 'bar', stack: 't', data: m.map(x => x.total - x.cambios) },
        { name: 'Cambios', type: 'bar', stack: 't', data: m.map(x => x.cambios) },
      ],
    };
  });

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap;
    if (q.get('desde') && q.get('hasta')) {
      this.desde.set(q.get('desde')!);
      this.hasta.set(q.get('hasta')!);
      this.periodo.set('rango');
    }
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.f.set(await this.api.persona(this.id(), this.desde(), this.hasta()));
      await this.cargarLinea(true);
    } catch (e: any) {
      this.error.set(e?.status === 403 ? 'No puedes ver la actividad de esta persona.' : 'No se pudo cargar la actividad.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarLinea(desdeCero: boolean): Promise<void> {
    this.cargandoLinea.set(true);
    try {
      const fuentes = this.fuentesSel().length ? this.fuentesSel()
        : this.ocultarPantallas() ? (this.f()?.fuentes ?? []).map(x => x.clave).filter(x => x !== 'pantallas') : undefined;
      const r = await this.api.linea(this.id(), {
        desde: this.desde(), hasta: this.hasta(), fuentes, tipo: this.tipoSel() || null, modulo: this.moduloSel() || null,
        q: this.qLinea().trim() || null, antes: desdeCero ? null : this.siguiente(), limite: 150,
      });
      this.linea.set(desdeCero ? r.items : [...this.linea(), ...r.items]);
      this.siguiente.set(r.siguiente);
    } catch {
      this.snack.open('No se pudo cargar la línea de tiempo', 'Cerrar', { duration: 3500 });
    } finally {
      this.cargandoLinea.set(false);
    }
  }

  elegirPeriodo(p: string): void {
    const r = rangoDe(p);
    this.periodo.set(p);
    this.desde.set(r.desde);
    this.hasta.set(r.hasta);
    void this.cargar();
  }

  cambiarFechas(): void {
    this.periodo.set('rango');
    void this.cargar();
  }

  alternarFuente(clave: string): void {
    const s = new Set(this.fuentesSel());
    s.has(clave) ? s.delete(clave) : s.add(clave);
    this.fuentesSel.set([...s]);
    void this.cargarLinea(true);
  }

  private t: ReturnType<typeof setTimeout> | null = null;
  buscarLinea(v: string): void {
    this.qLinea.set(v);
    if (this.t) clearTimeout(this.t);
    this.t = setTimeout(() => void this.cargarLinea(true), 400);
  }

  async exportar(): Promise<void> {
    const url = this.api.urlCsv(this.id(), { desde: this.desde(), hasta: this.hasta(), tipo: this.tipoSel() || null, modulo: this.moduloSel() || null, q: this.qLinea() || null });
    const blob = await this.visor.fetchBlob(url);
    if (!blob) { this.snack.open('No se pudo exportar', 'Cerrar', { duration: 3000 }); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `actividad-${(this.f()?.persona.nombre ?? 'persona').replace(/\s+/g, '-')}-${this.desde()}-${this.hasta()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  informe(): void {
    void this.router.navigate(['/dashboard/actividad/informes'], {
      queryParams: { nuevo: 'PERSONA', sujeto: this.id(), nombre: this.f()?.persona.nombre, desde: this.desde(), hasta: this.hasta() },
    });
  }

  verBandeja(): void {
    void this.router.navigate(['/dashboard/tareas/bandeja'], { queryParams: { usuario: this.id(), nombre: this.f()?.persona.nombre, vista: 'todos' } });
  }

  rutaLink(i: ItemLinea): string | null {
    if (!i.link) return null;
    return i.link.startsWith('/') ? i.link : `/dashboard/${i.link}`;
  }

  irA(i: ItemLinea): void {
    const r = this.rutaLink(i);
    if (r) void this.router.navigateByUrl(r);
  }

  estiloTipo(i: ItemLinea): { texto: string; icono: string; tono: string } {
    if (i.estado != null && i.estado >= 400) return { texto: `Error ${i.estado}`, icono: 'error', tono: 'peligro' };
    return this.TIPOS[i.tipo ?? 'OTRO'] ?? this.TIPOS['OTRO'];
  }

  nombreFuente(clave: string): string {
    return this.f()?.fuentes.find(x => x.clave === clave)?.nombre ?? clave;
  }

  numero(v: number | null | undefined): number { return v ?? 0; }
}
