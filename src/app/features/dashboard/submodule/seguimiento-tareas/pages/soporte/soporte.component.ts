import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { DirectorioService, sinTildes } from '../../services/directorio.service';
import { ESTADOS_TICKET, MesaSoporteService, PRIORIDADES_TICKET, TicketMesa, prioridadTicket } from '../../services/mesa-soporte.service';
import { hace, mensajeError } from '../../utils/tareas-ui';

const DIA = 86_400_000;

/**
 * Mesa de soporte: los tickets de "Reportar un problema" como un tablero de trabajo.
 * Se arrastran entre estados, se asignan, se convierten en tareas de seguimiento y se
 * resuelven con IA o con el enjambre de agentes desde el detalle.
 */
@Component({
  selector: 'app-soporte-tareas',
  standalone: true,
  imports: [FormsModule, DragDropModule, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressSpinnerModule, MatSnackBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './soporte.component.html',
  styleUrls: ['./soporte.component.css'],
})
export class SoporteComponent implements OnInit {
  private readonly mesa = inject(MesaSoporteService);
  private readonly dir = inject(DirectorioService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly estados = ESTADOS_TICKET;
  readonly prioridades = PRIORIDADES_TICKET;
  readonly prioridadTicket = prioridadTicket;
  readonly hace = hace;

  readonly tickets = signal<TicketMesa[]>([]);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);

  readonly busqueda = signal('');
  readonly prioridad = signal<string | null>(null);
  readonly categoria = signal<string | null>(null);
  readonly sede = signal<string | null>(null);
  readonly mios = signal(false);
  readonly verCerrados = signal(false);

  readonly categorias = computed(() => [...new Set(this.tickets().map(t => t.categoria).filter(Boolean))].sort());
  readonly sedes = computed(() => [...new Set(this.tickets().map(t => t.sede).filter(Boolean))].sort());

  readonly filtrados = computed(() => {
    const q = sinTildes(this.busqueda().trim());
    const p = this.prioridad(), c = this.categoria(), s = this.sede(), mios = this.mios();
    const yo = sinTildes(this.dir.yo.nombre);
    return this.tickets().filter(t =>
      (!q || sinTildes(`${t.titulo} ${t.descripcion} ${t.usuario} ${t.documento} ${t.sede} ${t.categoria} ${t.id.slice(0, 8)}`).includes(q)) &&
      (!p || prioridadTicket(t.prioridad).clave === p) &&
      (!c || t.categoria === c) && (!s || t.sede === s) &&
      (!mios || sinTildes(t.asignado_a ?? '') === yo));
  });

  readonly columnas = computed(() => {
    const vis = this.verCerrados() ? this.estados : this.estados.filter(e => e.clave !== 'Cerrado');
    return vis.map(e => ({
      ...e,
      tickets: this.filtrados().filter(t => t.estado === e.clave)
        .sort((a, b) => prioridadTicket(b.prioridad).peso - prioridadTicket(a.prioridad).peso
          || (b.fecha_reporte ?? '').localeCompare(a.fecha_reporte ?? '')),
    }));
  });

  readonly kpis = computed(() => {
    const ts = this.tickets();
    const abiertos = ts.filter(t => t.estado === 'Abierto' || t.estado === 'En Progreso');
    const hace7 = Date.now() - 7 * DIA;
    return {
      abiertos: ts.filter(t => t.estado === 'Abierto').length,
      progreso: ts.filter(t => t.estado === 'En Progreso').length,
      sinAsignar: abiertos.filter(t => !t.asignado_a).length,
      criticos: abiertos.filter(t => prioridadTicket(t.prioridad).peso >= 3).length,
      resueltos7: ts.filter(t => t.estado === 'Resuelto' && t.fecha_actualizacion && new Date(t.fecha_actualizacion).getTime() >= hace7).length,
    };
  });

  readonly hayFiltros = computed(() => !!(this.busqueda() || this.prioridad() || this.categoria() || this.sede() || this.mios()));

  async ngOnInit(): Promise<void> {
    this.dir.cargar();
    await this.cargar();
    const id = this.route.snapshot.queryParamMap.get('ticket');
    if (id) this.abrir(id);
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.tickets.set(await this.mesa.listar());
    } catch (e) {
      this.error.set(mensajeError(e, 'No se pudieron cargar los tickets.'));
    } finally {
      this.cargando.set(false);
    }
  }

  limpiar(): void {
    this.busqueda.set(''); this.prioridad.set(null); this.categoria.set(null); this.sede.set(null); this.mios.set(false);
  }

  /** Arrastrar a otra columna cambia el estado (queda en el historial con el nombre de quien lo movió). */
  async soltar(ev: CdkDragDrop<string>): Promise<void> {
    const t = ev.item.data as TicketMesa;
    const destino = ev.container.data;
    if (!t || t.estado === destino) return;
    const antes = t.estado;
    this.tickets.update(l => l.map(x => x.id === t.id ? { ...x, estado: destino } : x));
    try {
      await this.mesa.actualizar(t.id, { estado: destino });
      this.snack.open(`«${t.titulo}» pasó a ${destino}`, undefined, { duration: 2500 });
    } catch (e) {
      this.tickets.update(l => l.map(x => x.id === t.id ? { ...x, estado: antes } : x));
      this.snack.open(mensajeError(e, 'No se pudo cambiar el estado.'), 'Cerrar', { duration: 4500 });
    }
  }

  async abrir(id: string): Promise<void> {
    this.router.navigate([], { relativeTo: this.route, queryParams: { ticket: id }, replaceUrl: true });
    const { TicketDetalleDialogComponent } = await import('../../components/ticket-detalle/ticket-detalle-dialog.component');
    const ref = this.dialog.open(TicketDetalleDialogComponent, {
      data: { id },
      position: { right: '0', top: '0' },
      height: '100dvh',
      width: 'min(820px, 100vw)',
      maxWidth: '100vw',
      maxHeight: '100dvh',
      panelClass: 'tt-drawer',
      autoFocus: false,
    });
    const cambio = await firstValueFrom(ref.afterClosed());
    this.router.navigate([], { relativeTo: this.route, queryParams: { ticket: null }, replaceUrl: true });
    if (cambio) this.cargar();
  }

  iniciales(nombre: string | null | undefined): string {
    return (nombre ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '?';
  }
}
