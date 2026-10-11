import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { TareaDetalleComponent } from '../../components/tarea-detalle/tarea-detalle.component';

/**
 * Página propia de una tarea: es a donde llevan las notificaciones y los enlaces
 * copiados ("/dashboard/tareas/tarea/123"). Vive bajo la raíz del módulo y no dentro de un
 * tablero, para que quien recibe una tarea pueda abrirla aunque no tenga el menú de
 * Tableros.
 */
@Component({
  selector: 'app-tarea-page',
  standalone: true,
  imports: [TareaDetalleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tp">
      @if (id(); as id) {
        <app-tarea-detalle [tareaId]="+id" [enPanel]="false" (cerrar)="volver()" />
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .tp { max-width: 900px; margin: 0 auto; background: var(--surface); border: 1px solid var(--border); border-radius: 22px; box-shadow: var(--shadow-sm); }
  `],
})
export class TareaPageComponent {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  readonly id = input<string>();

  volver(): void {
    if (typeof history !== 'undefined' && history.length > 1) this.location.back();
    else this.router.navigate(['/dashboard/tareas/mis-tareas']);
  }
}
