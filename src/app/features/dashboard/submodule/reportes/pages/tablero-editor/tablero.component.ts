import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDropList, CdkDrag, CdkDragHandle, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import Swal from 'sweetalert2';
import { ReportesApiService } from '../../services/reportes-api.service';
import { mensajeDeError } from '../../services/constructor.store';
import { GraficaReporteComponent } from '../../components/grafica-reporte.component';
import { KpiCardComponent } from '../../components/kpi-card.component';
import { TablaResultadosComponent } from '../../components/tabla-resultados.component';
import { CompartirDialogComponent } from '../../components/compartir-dialog.component';
import {
  CampoCatalogo, ConfigVisualizacion, DatosWidget, FieldSpec, FilterNode,
  FiltroGlobalTablero, ReporteDetalle, ReporteResumen, TableroDetalle, WidgetTablero,
} from '../../models/reportes.models';

/**
 * Tablero: visor y editor en la misma pantalla (§18, §19).
 *
 * No hay dos pantallas porque no hacen falta: el tablero se ve igual en ambos
 * modos y editar es mover, redimensionar o cambiar un componente. Separarlo
 * obligaría a duplicar el render y a saltar de una URL a otra para un ajuste.
 *
 * FILTROS GLOBALES: se definen una vez y se aplican a todos los componentes. El
 * servidor los PODA por componente — un filtro por empresa solo llega a los
 * reportes que incluyen esa tabla —, así que un filtro nunca rompe un widget al
 * que no le corresponde.
 */
@Component({
  selector: 'app-tablero',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, CdkDropList, CdkDrag, CdkDragHandle,
    MatIconModule, MatButtonModule, MatMenuModule, MatTooltipModule,
    MatFormFieldModule, MatSelectModule, MatInputModule, MatProgressBarModule,
    MatDatepickerModule, MatNativeDateModule,
    GraficaReporteComponent, KpiCardComponent, TablaResultadosComponent],
  templateUrl: './tablero.component.html',
  styleUrls: ['./tablero.component.css'],
})
export class TableroComponent implements OnInit {

  readonly api = inject(ReportesApiService);
  private ruta = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  readonly cargando = signal(true);
  readonly cargandoDatos = signal(false);
  readonly guardando = signal(false);
  readonly editando = signal(false);
  readonly sucio = signal(false);

  readonly tablero = signal<TableroDetalle | null>(null);
  readonly widgets = signal<WidgetTablero[]>([]);
  readonly filtrosGlobales = signal<FiltroGlobalTablero[]>([]);
  readonly datos = signal<Record<string, DatosWidget>>({});
  readonly reportesDisponibles = signal<ReporteResumen[]>([]);
  /**
   * Definición completa de cada reporte usado, cacheada por id.
   *
   * Para configurar la dimensión y la métrica de un componente hay que saber qué
   * columnas devuelve su reporte, y el listado solo trae la cabecera. Se pide al
   * abrir el menú de configuración, no al cargar el tablero: con diez componentes
   * serían diez peticiones que casi nunca se usan.
   */
  readonly detallesReporte = signal<Record<string, ReporteDetalle>>({});
  readonly valoresFiltro = signal<Record<string, string[]>>({});

  nombre = 'Tablero sin título';
  descripcion = '';

  readonly esNuevo = computed(() => !this.tablero()?.id);

  ngOnInit(): void {
    this.api.cargarCatalogo().subscribe();
    this.api.listarReportes({ size: 100, estado: '' }).subscribe({
      next: p => this.reportesDisponibles.set(p.items),
      error: () => {},
    });

    const id = this.ruta.snapshot.paramMap.get('id');
    if (!id || id === 'nuevo') {
      this.cargando.set(false);
      this.editando.set(true);
      return;
    }
    this.api.abrirTablero(id).subscribe({
      next: t => {
        this.tablero.set(t);
        this.nombre = t.nombre;
        this.descripcion = t.descripcion ?? '';
        this.widgets.set([...t.widgets]);
        this.filtrosGlobales.set(t.filtros_globales ?? []);
        this.cargando.set(false);
        this.refrescarDatos();
      },
      error: e => {
        this.cargando.set(false);
        Swal.fire({ icon: 'error', title: 'No se pudo abrir el tablero', text: mensajeDeError(e) });
        this.router.navigate(['/dashboard/reportes']);
      },
    });
  }

  // ─────────────────────────── datos ───────────────────────────

  refrescarDatos(): void {
    const t = this.tablero();
    if (!t?.id) return;
    this.cargandoDatos.set(true);
    this.api.datosTablero(t.id, this.filtroCombinado(), 50).subscribe({
      next: res => {
        const mapa: Record<string, DatosWidget> = {};
        for (const w of res.widgets as DatosWidget[]) mapa[w.widget_id] = w;
        this.datos.set(mapa);
        this.cargandoDatos.set(false);
      },
      error: e => {
        this.cargandoDatos.set(false);
        Swal.fire({ icon: 'error', title: 'No se pudieron cargar los datos', text: mensajeDeError(e) });
      },
    });
  }

  /** Convierte los filtros globales con valor en un árbol AND para el servidor. */
  private filtroCombinado(): FilterNode | null {
    const activos = this.filtrosGlobales().filter(f => this.tieneValor(f));
    if (!activos.length) return null;
    return {
      tipo: 'GRUPO',
      union: 'AND',
      hijos: activos.map(f => ({
        tipo: 'CONDICION' as const,
        campo: f.campo,
        operador: f.operador,
        valores: f.valores,
      })),
    };
  }

  private tieneValor(f: FiltroGlobalTablero): boolean {
    const op = this.api.metadatos()?.operadores.find(o => o.nombre === f.operador);
    if (op && op.aridad === 0) return true;   // «este mes», «hoy»… no llevan valor
    return (f.valores ?? []).some(v => v !== null && v !== undefined && v !== '');
  }

  datosDe(w: WidgetTablero): DatosWidget | null {
    return w.id ? this.datos()[w.id] ?? null : null;
  }

  // ─────────────────────────── filtros globales ───────────────────────────

  agregarFiltroGlobal(campo: CampoCatalogo): void {
    if (this.filtrosGlobales().some(f => f.campo === campo.clave)) return;
    this.filtrosGlobales.update(l => [...l, {
      id: `fg${l.length}${Date.now().toString(36)}`,
      campo: campo.clave,
      etiqueta: campo.nombre,
      tipo: campo.tipo,
      operador: campo.tipo === 'FECHA' || campo.tipo === 'FECHA_HORA' ? 'ENTRE' : 'EN',
      valores: [],
    }]);
    this.sucio.set(true);
  }

  quitarFiltroGlobal(id: string): void {
    this.filtrosGlobales.update(l => l.filter(f => f.id !== id));
    this.sucio.set(true);
    this.refrescarDatos();
  }

  fijarValorFiltro(id: string, pos: number, valor: unknown): void {
    this.filtrosGlobales.update(l => l.map(f => {
      if (f.id !== id) return f;
      const valores = [...(f.valores ?? [])];
      while (valores.length <= pos) valores.push(null);
      valores[pos] = valor === '' ? null : valor;
      return { ...f, valores };
    }));
  }

  limpiarFiltros(): void {
    this.filtrosGlobales.update(l => l.map(f => ({ ...f, valores: [] })));
    this.refrescarDatos();
  }

  /**
   * Valores reales de un campo, para que el filtro global sea un desplegable y no
   * una caja de texto donde hay que adivinar cómo está escrita cada empresa.
   */
  cargarValores(f: FiltroGlobalTablero): void {
    if (this.valoresFiltro()[f.campo]) return;
    this.api.valoresDeCampo(f.campo, undefined, 200).subscribe({
      next: v => this.valoresFiltro.update(m => ({ ...m, [f.campo]: v.map(x => String(x)) })),
      error: () => this.valoresFiltro.update(m => ({ ...m, [f.campo]: [] })),
    });
  }

  opcionesDe(f: FiltroGlobalTablero): string[] {
    return this.valoresFiltro()[f.campo] ?? [];
  }

  fijarValoresMultiples(id: string, valores: string[]): void {
    this.filtrosGlobales.update(l => l.map(f => f.id === id ? { ...f, valores } : f));
    this.refrescarDatos();
  }

  /** Campos que se pueden usar como filtro global: los de los reportes del tablero. */
  readonly camposParaFiltro = computed<CampoCatalogo[]>(() => {
    const usados = new Set<string>();
    const reportes = this.reportesDisponibles();
    const idsEnTablero = new Set(this.widgets().map(w => w.report_id).filter(Boolean));
    for (const r of reportes) {
      if (!idsEnTablero.has(r.id)) continue;
      for (const d of r.datasets) usados.add(d);
    }
    const mapa = this.api.datasetsPorClave();
    const salida: CampoCatalogo[] = [];
    for (const clave of usados) {
      const d = mapa.get(clave);
      if (d) salida.push(...d.campos.filter(c => c.filtrable));
    }
    return salida;
  });

  isoDe(d: Date | null): string | null {
    if (!d) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  fechaDe(f: FiltroGlobalTablero, pos: number): Date | null {
    const v = (f.valores ?? [])[pos];
    if (!v) return null;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d;
  }

  // ─────────────────────────── widgets ───────────────────────────

  agregarWidget(tipo: WidgetTablero['tipo']): void {
    const disponibles = this.reportesDisponibles();
    if (tipo !== 'TEXTO' && !disponibles.length) {
      Swal.fire({ icon: 'info', title: 'No hay reportes todavía',
        text: 'Crea un reporte primero: los componentes de un tablero se alimentan de reportes.' });
      return;
    }
    this.widgets.update(l => [...l, {
      id: `nuevo-${l.length}-${Date.now()}`,
      tipo,
      report_id: tipo === 'TEXTO' ? null : disponibles[0].id,
      titulo: tipo === 'TEXTO' ? 'Nota' : disponibles[0].nombre,
      subtitulo: null,
      pos_x: 0,
      pos_y: l.length,
      ancho: tipo === 'KPI' ? 3 : (tipo === 'TABLA' ? 12 : 6),
      alto: tipo === 'KPI' ? 1 : 2,
      config: { tipo: tipo === 'KPI' ? 'KPI' : (tipo === 'GRAFICA' ? 'BARRAS' : 'TABLA') },
      filtros_extra: null,
      orden: l.length,
    }]);
    this.sucio.set(true);
    if (tipo !== 'TEXTO') this.cargarDetalle(disponibles[0].id, this.widgets().at(-1)?.id);
  }

  actualizarWidget(id: string, cambios: Partial<WidgetTablero>): void {
    this.widgets.update(l => l.map(w => w.id === id ? { ...w, ...cambios } : w));
    this.sucio.set(true);
  }

  cambiarReporte(id: string, reportId: string): void {
    const r = this.reportesDisponibles().find(x => x.id === reportId);
    // Al cambiar de reporte, la dimensión y las métricas anteriores apuntan a
    // columnas que ya no existen: se limpian y se vuelven a proponer.
    this.actualizarWidget(id, {
      report_id: reportId,
      titulo: r?.nombre ?? null,
      config: { ...(this.widgets().find(w => w.id === id)?.config ?? { tipo: 'BARRAS' }),
                dimension: null, metricas: [], serie: null, kpi_metrica: null },
    });
    this.cargarDetalle(reportId, id);
  }

  /** Trae la definición del reporte para poder ofrecer sus columnas. */
  cargarDetalle(reportId: string | null | undefined, widgetId?: string | null): void {
    if (!reportId || this.detallesReporte()[reportId]) {
      if (widgetId) this.proponerCampos(widgetId);
      return;
    }
    this.api.abrirReporte(reportId).subscribe({
      next: d => {
        this.detallesReporte.update(m => ({ ...m, [reportId]: d }));
        if (widgetId) this.proponerCampos(widgetId);
      },
      error: () => { /* el componente sigue usable con lo que trae el reporte por defecto */ },
    });
  }

  /** Columnas del reporte que alimenta un componente. */
  columnasDe(w: WidgetTablero): FieldSpec[] {
    if (!w.report_id) return [];
    return this.detallesReporte()[w.report_id]?.definicion?.fields ?? [];
  }

  dimensionesDe(w: WidgetTablero): FieldSpec[] {
    return this.columnasDe(w).filter(f => !f.agregacion);
  }

  metricasDe(w: WidgetTablero): FieldSpec[] {
    return this.columnasDe(w).filter(f => !!f.agregacion);
  }

  /** Si el componente no tiene dimensión/métrica, se propone la primera razonable. */
  private proponerCampos(widgetId: string): void {
    const w = this.widgets().find(x => x.id === widgetId);
    if (!w || !w.report_id) return;
    const cols = this.columnasDe(w);
    if (!cols.length) return;
    const cfg: ConfigVisualizacion = { ...(w.config ?? { tipo: 'BARRAS' }) };
    let cambio = false;
    if (!cfg.dimension) {
      const d = cols.find(f => !f.agregacion);
      if (d) { cfg.dimension = d.id; cambio = true; }
    }
    if (w.tipo === 'KPI') {
      if (!cfg.kpi_metrica) {
        const m = cols.find(f => !!f.agregacion);
        if (m) { cfg.kpi_metrica = m.id; cambio = true; }
      }
    } else if (!(cfg.metricas ?? []).length) {
      const ms = cols.filter(f => !!f.agregacion).map(f => f.id);
      if (ms.length) { cfg.metricas = ms; cambio = true; }
    }
    if (cambio) this.actualizarWidget(widgetId, { config: cfg });
  }

  /** Cambia una propiedad de la visualización de un componente. */
  ajustarConfig(id: string, cambios: Partial<ConfigVisualizacion>): void {
    const w = this.widgets().find(x => x.id === id);
    if (!w) return;
    this.actualizarWidget(id, { config: { ...(w.config ?? { tipo: 'BARRAS' }), ...cambios } });
  }

  /** ¿El componente ya puede pintar algo? Decide el aviso de "falta configurar". */
  estaCompleto(w: WidgetTablero): boolean {
    if (w.tipo === 'TEXTO') return true;
    if (!w.report_id) return false;
    const cols = this.columnasDe(w);
    // Sin la definición cargada no se puede afirmar que falte nada: el backend
    // resuelve solo la dimensión y la métrica cuando no vienen configuradas.
    if (!cols.length) return true;
    const cfg = w.config ?? { tipo: 'BARRAS' };
    if (w.tipo === 'KPI') return !!(cfg.kpi_metrica ?? cols.find(f => !!f.agregacion));
    if (w.tipo === 'TABLA') return true;
    return !!(cfg.metricas ?? []).length || cols.some(f => !!f.agregacion);
  }

  quitarWidget(id: string): void {
    this.widgets.update(l => l.filter(w => w.id !== id));
    this.sucio.set(true);
  }

  redimensionar(id: string, delta: number): void {
    this.widgets.update(l => l.map(w => {
      if (w.id !== id) return w;
      return { ...w, ancho: Math.max(2, Math.min(12, w.ancho + delta)) };
    }));
    this.sucio.set(true);
  }

  cambiarAlto(id: string, delta: number): void {
    this.widgets.update(l => l.map(w => {
      if (w.id !== id) return w;
      return { ...w, alto: Math.max(1, Math.min(6, w.alto + delta)) };
    }));
    this.sucio.set(true);
  }

  soltarWidget(ev: CdkDragDrop<WidgetTablero[]>): void {
    if (ev.previousIndex === ev.currentIndex) return;
    this.widgets.update(l => {
      const copia = [...l];
      moveItemInArray(copia, ev.previousIndex, ev.currentIndex);
      return copia.map((w, i) => ({ ...w, orden: i, pos_y: i }));
    });
    this.sucio.set(true);
  }

  // ─────────────────────────── guardar / compartir ───────────────────────────

  guardar(): void {
    if (!this.nombre.trim()) {
      Swal.fire({ icon: 'info', title: 'El tablero necesita un nombre' });
      return;
    }
    this.guardando.set(true);
    const cuerpo = {
      nombre: this.nombre.trim(),
      descripcion: this.descripcion.trim() || null,
      categoria: this.tablero()?.categoria ?? null,
      estado: this.tablero()?.estado ?? 'BORRADOR',
      visibilidad: this.tablero()?.visibilidad ?? 'PRIVADO',
      filtros_globales: this.filtrosGlobales(),
      layout_config: this.tablero()?.layout_config ?? null,
      // Los ids temporales de los widgets nuevos no se mandan: los asigna el servidor.
      widgets: this.widgets().map(w => ({
        ...w,
        id: w.id?.startsWith('nuevo-') ? null : w.id,
      })),
      comparticiones: this.tablero()?.comparticiones ?? [],
    };
    const id = this.tablero()?.id;
    const peticion = id ? this.api.actualizarTablero(id, cuerpo) : this.api.crearTablero(cuerpo);

    peticion.subscribe({
      next: t => {
        this.guardando.set(false);
        this.sucio.set(false);
        this.tablero.set(t);
        this.widgets.set([...t.widgets]);
        this.filtrosGlobales.set(t.filtros_globales ?? []);
        Swal.fire({ icon: 'success', title: id ? 'Tablero guardado' : 'Tablero creado',
          toast: true, position: 'top-end', timer: 1800, showConfirmButton: false });
        if (!id) this.router.navigate(['/dashboard/reportes/tableros', t.id], { replaceUrl: true });
        else this.refrescarDatos();
      },
      error: e => {
        this.guardando.set(false);
        Swal.fire({ icon: 'error', title: 'No se pudo guardar', text: mensajeDeError(e) });
      },
    });
  }

  compartir(): void {
    const t = this.tablero();
    if (!t?.id) { Swal.fire({ icon: 'info', title: 'Guarda el tablero primero' }); return; }
    this.dialog.open(CompartirDialogComponent, {
      width: '600px', maxWidth: '95vw',
      data: {
        nombre: t.nombre, visibilidad: t.visibilidad,
        comparticiones: t.comparticiones, roles: [], esTablero: true,
      },
    }).afterClosed().subscribe(res => {
      if (!res) return;
      this.api.compartirTablero(t.id, res.visibilidad, res.comparticiones).subscribe({
        next: c => this.tablero.update(x => x ? { ...x, visibilidad: res.visibilidad, comparticiones: c } : x),
        error: e => Swal.fire({ icon: 'error', title: 'No se pudo compartir', text: mensajeDeError(e) }),
      });
    });
  }

  eliminar(): void {
    const t = this.tablero();
    if (!t?.id) return;
    Swal.fire({
      icon: 'warning', title: '¿Eliminar el tablero?',
      html: `Se eliminará <b>${t.nombre}</b>. Los reportes que lo alimentan no se tocan.`,
      showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc2626',
    }).then(r => {
      if (!r.isConfirmed) return;
      this.api.eliminarTablero(t.id).subscribe({
        next: () => this.router.navigate(['/dashboard/reportes']),
        error: e => Swal.fire({ icon: 'error', title: 'No se pudo eliminar', text: mensajeDeError(e) }),
      });
    });
  }

  volver(): void {
    if (!this.sucio()) { this.router.navigate(['/dashboard/reportes']); return; }
    Swal.fire({
      icon: 'warning', title: 'Tienes cambios sin guardar',
      showCancelButton: true, confirmButtonText: 'Salir sin guardar',
      cancelButtonText: 'Seguir editando', confirmButtonColor: '#dc2626',
    }).then(r => { if (r.isConfirmed) this.router.navigate(['/dashboard/reportes']); });
  }

  irAlReporte(w: WidgetTablero): void {
    if (w.report_id) this.router.navigate(['/dashboard/reportes/constructor', w.report_id]);
  }

  nombreReporte(id: string | null): string {
    if (!id) return '';
    return this.reportesDisponibles().find(r => r.id === id)?.nombre ?? 'Reporte';
  }
}
