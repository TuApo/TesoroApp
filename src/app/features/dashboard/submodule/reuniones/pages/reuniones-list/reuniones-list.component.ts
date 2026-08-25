import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ReunionesService } from '../../services/reuniones.service';
import { CrearReunion, EstadoReunion, ReunionResumen } from '../../models/reunion.model';

/**
 * Listado de reuniones funcionales y alta rápida.
 *
 * El alta pide sólo lo imprescindible (nombre, fecha, tipo, objetivo): el resto de la
 * ficha se completa dentro de la reunión, que es donde el analista ya tiene el contexto
 * delante. Un formulario de veinte campos antes de poder subir el audio sería el camino
 * más corto a que nadie lo use.
 */
@Component({
  selector: 'app-reuniones-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reuniones-list.component.html',
  styleUrl: './reuniones-list.component.css',
})
export class ReunionesListComponent {
  private readonly api = inject(ReunionesService);
  private readonly router = inject(Router);

  readonly reuniones = signal<ReunionResumen[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly total = signal(0);
  readonly pagina = signal(0);

  readonly filtroTexto = signal('');
  readonly filtroEstado = signal<'' | EstadoReunion>('');

  readonly creando = signal(false);
  readonly guardando = signal(false);
  readonly nueva = signal<CrearReunion>(this.reunionVacia());

  readonly hayMas = computed(() => this.reuniones().length < this.total());

  readonly ESTADOS: { valor: '' | EstadoReunion; etiqueta: string }[] = [
    { valor: '', etiqueta: 'Todos los estados' },
    { valor: 'BORRADOR', etiqueta: 'Borrador' },
    { valor: 'PROGRAMADA', etiqueta: 'Programada' },
    { valor: 'PROCESANDO', etiqueta: 'Procesando' },
    { valor: 'EN_REVISION', etiqueta: 'En revisión' },
    { valor: 'CERRADA', etiqueta: 'Cerrada' },
    { valor: 'ERROR', etiqueta: 'Con error' },
  ];

  readonly TIPOS = [
    'LEVANTAMIENTO', 'SEGUIMIENTO', 'VALIDACION', 'REVISION_TECNICA', 'PRUEBAS', 'CIERRE',
  ];

  constructor() {
    this.cargar();
  }

  cargar(pagina = 0): void {
    this.cargando.set(true);
    this.error.set('');
    this.api.listar({
      q: this.filtroTexto() || undefined,
      status: this.filtroEstado() || undefined,
      page: pagina,
      size: 20,
    }).subscribe({
      next: (p) => {
        this.reuniones.set(pagina === 0 ? p.content : [...this.reuniones(), ...p.content]);
        this.total.set(p.totalElements);
        this.pagina.set(p.number);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.error ?? 'No se pudieron cargar las reuniones');
        this.cargando.set(false);
      },
    });
  }

  buscar(): void { this.cargar(0); }

  masResultados(): void { this.cargar(this.pagina() + 1); }

  abrirAlta(): void {
    this.nueva.set(this.reunionVacia());
    this.creando.set(true);
  }

  cerrarAlta(): void { this.creando.set(false); }

  crear(): void {
    const datos = this.nueva();
    if (!datos.name?.trim()) {
      this.error.set('La reunión necesita un nombre');
      return;
    }
    this.guardando.set(true);
    this.api.crear({ ...datos, name: datos.name.trim() }).subscribe({
      next: (detalle) => {
        this.guardando.set(false);
        this.creando.set(false);
        this.router.navigate(['/dashboard/reuniones', detalle.resumen.id]);
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(e?.error?.error ?? 'No se pudo crear la reunión');
      },
    });
  }

  actualizarCampo<K extends keyof CrearReunion>(campo: K, valor: CrearReunion[K]): void {
    this.nueva.update(r => ({ ...r, [campo]: valor }));
  }

  etiquetaEstado(estado: EstadoReunion): string {
    return this.ESTADOS.find(e => e.valor === estado)?.etiqueta ?? estado;
  }

  private reunionVacia(): CrearReunion {
    return {
      name: '',
      meeting_type: 'LEVANTAMIENTO',
      modality: 'VIRTUAL',
      held_on: new Date().toISOString().slice(0, 10),
      objective: '',
      confidentiality: 'INTERNA',
    };
  }
}
