import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import Swal from 'sweetalert2';
import { ReportesApiService } from '../../services/reportes-api.service';
import { descargar, nombreArchivo } from '../../services/descargas.util';
import { CompartirDialogComponent } from '../../components/compartir-dialog.component';
import { ReporteResumen, TableroResumen } from '../../models/reportes.models';

/**
 * Pantalla principal de Reportes y Analítica (§3).
 *
 * Reúne en una sola vista lo que el usuario necesita para retomar su trabajo:
 * lo reciente, sus favoritos, sus reportes, los que le compartieron y los
 * tableros. Con buscador y filtros, porque cuando haya cien reportes la lista
 * plana deja de servir.
 */
@Component({
  selector: 'app-reportes-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule, MatButtonModule,
    MatMenuModule, MatTooltipModule, MatFormFieldModule, MatSelectModule,
    MatInputModule, MatProgressBarModule],
  templateUrl: './reportes-home.component.html',
  styleUrls: ['./reportes-home.component.css'],
})
export class ReportesHomeComponent implements OnInit {

  private api = inject(ReportesApiService);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  readonly cargando = signal(true);
  readonly cargandoTableros = signal(false);
  readonly reportes = signal<ReporteResumen[]>([]);
  readonly recientes = signal<ReporteResumen[]>([]);
  readonly tableros = signal<TableroResumen[]>([]);
  readonly categorias = signal<string[]>([]);
  readonly total = signal(0);
  readonly puedeConstruir = signal(false);
  readonly esAdmin = signal(false);

  /** Pestaña activa: define qué se lista y con qué filtro de alcance. */
  readonly pestana = signal<'TODOS' | 'MIOS' | 'COMPARTIDOS' | 'FAVORITOS' | 'TABLEROS'>('TODOS');

  texto = '';
  categoria = '';
  tipo = '';
  estado = '';
  ordenarPor = 'actualizacion';

  private readonly busqueda$ = new Subject<string>();

  readonly pestanas = [
    { id: 'TODOS', etiqueta: 'Todos', icono: 'apps' },
    { id: 'MIOS', etiqueta: 'Mis reportes', icono: 'person' },
    { id: 'COMPARTIDOS', etiqueta: 'Compartidos conmigo', icono: 'group' },
    { id: 'FAVORITOS', etiqueta: 'Favoritos', icono: 'star' },
    { id: 'TABLEROS', etiqueta: 'Tableros', icono: 'dashboard' },
  ] as const;

  readonly hayFiltros = computed(() =>
    !!this.texto || !!this.categoria || !!this.tipo || !!this.estado);

  constructor() {
    this.busqueda$.pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.cargar());
  }

  ngOnInit(): void {
    // El catálogo se pide aquí para saber si el usuario puede construir reportes;
    // además queda cacheado para cuando entre al constructor.
    this.api.cargarCatalogo().subscribe({
      next: c => { this.puedeConstruir.set(c.puede_construir); this.esAdmin.set(c.es_admin); },
      error: () => { /* el listado funciona igual sin el catálogo */ },
    });
    this.api.categorias().subscribe({ next: c => this.categorias.set(c), error: () => {} });
    this.api.reportesRecientes(6).subscribe({ next: r => this.recientes.set(r), error: () => {} });
    this.cargar();
  }

  alEscribir(v: string): void { this.texto = v; this.busqueda$.next(v); }

  cambiarPestana(p: typeof this.pestanas[number]['id']): void {
    this.pestana.set(p);
    this.cargar();
  }

  limpiarFiltros(): void {
    this.texto = ''; this.categoria = ''; this.tipo = ''; this.estado = '';
    this.cargar();
  }

  cargar(): void {
    if (this.pestana() === 'TABLEROS') {
      this.cargandoTableros.set(true);
      this.api.listarTableros({ q: this.texto, size: 48 }).subscribe({
        next: p => { this.tableros.set(p.items); this.total.set(p.total); this.cargandoTableros.set(false); },
        error: () => { this.cargandoTableros.set(false); },
      });
      return;
    }
    this.cargando.set(true);
    const alcance = this.pestana() === 'FAVORITOS' ? 'TODOS' : this.pestana();
    this.api.listarReportes({
      q: this.texto, categoria: this.categoria, tipo: this.tipo, estado: this.estado,
      alcance, favoritos: this.pestana() === 'FAVORITOS',
      size: 48, orden: this.ordenarPor,
    }).subscribe({
      next: p => { this.reportes.set(p.items); this.total.set(p.total); this.cargando.set(false); },
      error: () => { this.cargando.set(false); },
    });
  }

  // ─────────────────────────────── acciones ───────────────────────────────

  abrir(r: ReporteResumen): void {
    this.router.navigate(['/dashboard/reportes/constructor', r.id]);
  }

  nuevoReporte(): void { this.router.navigate(['/dashboard/reportes/constructor']); }

  nuevoTablero(): void { this.router.navigate(['/dashboard/reportes/tableros/nuevo']); }

  abrirTablero(t: TableroResumen): void {
    this.router.navigate(['/dashboard/reportes/tableros', t.id]);
  }

  favorito(r: ReporteResumen, ev: Event): void {
    ev.stopPropagation();
    this.api.alternarFavoritoReporte(r.id).subscribe({
      next: res => this.reportes.update(l =>
        l.map(x => x.id === r.id ? { ...x, es_favorito: res.favorito } : x)),
    });
  }

  favoritoTablero(t: TableroResumen, ev: Event): void {
    ev.stopPropagation();
    this.api.alternarFavoritoTablero(t.id).subscribe({
      next: res => this.tableros.update(l =>
        l.map(x => x.id === t.id ? { ...x, es_favorito: res.favorito } : x)),
    });
  }

  duplicar(r: ReporteResumen): void {
    Swal.fire({
      title: 'Duplicar reporte',
      input: 'text',
      inputValue: `${r.nombre} (copia)`,
      inputLabel: 'Nombre de la copia',
      showCancelButton: true,
      confirmButtonText: 'Duplicar',
      cancelButtonText: 'Cancelar',
    }).then(res => {
      if (!res.isConfirmed) return;
      this.api.duplicarReporte(r.id, res.value).subscribe({
        next: d => this.router.navigate(['/dashboard/reportes/constructor', d.id]),
        error: e => this.errorSwal(e),
      });
    });
  }

  eliminar(r: ReporteResumen): void {
    Swal.fire({
      icon: 'warning',
      title: '¿Eliminar el reporte?',
      html: `Se quitará <b>${r.nombre}</b> de tu lista y de la de quienes lo tengan compartido.`,
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc2626',
    }).then(res => {
      if (!res.isConfirmed) return;
      this.api.eliminarReporte(r.id).subscribe({
        next: () => { this.cargar(); this.api.reportesRecientes(6).subscribe(x => this.recientes.set(x)); },
        error: e => this.errorSwal(e),
      });
    });
  }

  exportar(r: ReporteResumen, formato: 'XLSX' | 'CSV' | 'PDF'): void {
    Swal.fire({ title: 'Generando el archivo…', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
    this.api.exportarReporte(r.id, { formato, completo: true }).subscribe({
      next: blob => { Swal.close(); descargar(blob, nombreArchivo(r.nombre, formato)); },
      error: e => this.errorSwal(e),
    });
  }

  compartir(r: ReporteResumen): void {
    this.api.abrirReporte(r.id).subscribe(detalle => {
      this.dialog.open(CompartirDialogComponent, {
        width: '600px', maxWidth: '95vw',
        data: {
          nombre: detalle.nombre,
          visibilidad: detalle.visibilidad,
          comparticiones: detalle.comparticiones,
          roles: [],
        },
      }).afterClosed().subscribe(res => {
        if (!res) return;
        this.api.compartirReporte(r.id, res.visibilidad, res.comparticiones).subscribe({
          next: () => { this.cargar(); this.toast('Compartido actualizado'); },
          error: e => this.errorSwal(e),
        });
      });
    });
  }

  // ─────────────────────────────── presentación ───────────────────────────────

  iconoTipo(t: string): string {
    switch (t) {
      case 'GRAFICA': return 'bar_chart';
      case 'KPI': return 'speed';
      case 'MIXTO': return 'dashboard_customize';
      default: return 'table_rows';
    }
  }

  colorEstado(e: string): string {
    switch (e) {
      case 'PUBLICADO': return 'chip--ok';
      case 'ARCHIVADO': return 'chip--off';
      default: return 'chip--draft';
    }
  }

  rotuloEstado(e: string): string {
    switch (e) {
      case 'PUBLICADO': return 'Publicado';
      case 'ARCHIVADO': return 'Archivado';
      default: return 'Borrador';
    }
  }

  rotuloVisibilidad(v: string): string {
    switch (v) {
      case 'ORGANIZACION': return 'Toda la organización';
      case 'ROL': return 'Por rol';
      case 'USUARIOS': return 'Personas concretas';
      default: return 'Privado';
    }
  }

  iconoVisibilidad(v: string): string {
    switch (v) {
      case 'ORGANIZACION': return 'public';
      case 'ROL': return 'badge';
      case 'USUARIOS': return 'group';
      default: return 'lock';
    }
  }

  /** «hace 3 días» es más útil que una fecha exacta para ordenar mentalmente. */
  hace(iso: string | null): string {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'hace un momento';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'ayer';
    if (d < 30) return `hace ${d} días`;
    const m = Math.floor(d / 30);
    if (m < 12) return `hace ${m} ${m === 1 ? 'mes' : 'meses'}`;
    return new Date(iso).toLocaleDateString('es-CO');
  }

  nombreTablas(claves: string[]): string {
    const mapa = this.api.datasetsPorClave();
    return claves.map(c => mapa.get(c)?.nombre ?? c).join(' · ');
  }

  private toast(titulo: string): void {
    Swal.fire({ icon: 'success', title: titulo, toast: true, position: 'top-end',
      timer: 1800, showConfirmButton: false });
  }

  private errorSwal(e: unknown): void {
    const err = e as { error?: { message?: string; detail?: string } };
    Swal.fire({
      icon: 'error', title: 'No se pudo completar',
      text: err?.error?.message ?? err?.error?.detail ?? 'Intenta de nuevo.',
    });
  }
}
