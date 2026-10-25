import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { DirectorioService } from '../../services/directorio.service';
import { TareasEventosService } from '../../services/tareas-eventos.service';
import { PermissionsService } from '@/app/core/services/permissions.service';
import { RUTA_TICKETS } from '../../utils/tareas-ui';

interface Seccion { ruta: string; etiqueta: string; icono: string }

/**
 * Marco común de Seguimiento Tareas: navegación entre vistas y "Nueva tarea" siempre a mano.
 * Sin franja de título propia (como el resto de módulos): el nombre ya va en la barra superior.
 * Las vistas viven en el router-outlet.
 */
@Component({
  selector: 'app-tareas-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ts">
      <!-- Sin franja de título: el nombre del módulo ya está en la barra superior. -->
      <div class="ts-barra">
        <nav class="ts-nav" aria-label="Secciones de Seguimiento Tareas">
          @for (s of secciones; track s.ruta) {
            <a [routerLink]="s.ruta" routerLinkActive="ts-nav--on" [routerLinkActiveOptions]="{ exact: false }" class="ts-tab">
              <mat-icon>{{ s.icono }}</mat-icon><span>{{ s.etiqueta }}</span>
            </a>
          }
        </nav>
        <button mat-flat-button class="ts-nueva" (click)="nueva()" aria-label="Nueva tarea">
          <mat-icon>add_task</mat-icon><span class="ts-largo">Nueva tarea</span>
        </button>
      </div>

      <main class="ts-vista"><router-outlet /></main>
    </div>
  `,
  styles: [`
    :host { display: block; font-family: var(--font-sans); color: var(--text); }
    .ts { max-width: 1480px; margin: 0 auto; padding: 14px 22px 40px; box-sizing: border-box; }
    .ts-barra { display: flex; align-items: center; gap: 10px; margin: 0 0 16px; padding: 5px; border-radius: 16px; background: var(--surface);
                border: 1px solid var(--border); position: sticky; top: 0; z-index: 4; }
    .ts-nav { flex: 1; min-width: 0; display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
    .ts-nav::-webkit-scrollbar { display: none; }
    .ts-tab { display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 12px; text-decoration: none;
              color: var(--text-2); font-weight: 700; font-size: 14px; white-space: nowrap; transition: background .15s, color .15s; }
    .ts-tab mat-icon { font-size: 19px; width: 19px; height: 19px; }
    .ts-tab:hover { background: var(--surface-3); color: var(--text); }
    .ts-nav--on { background: var(--navy) !important; color: #fff !important; }
    :host-context(html[data-theme='dark']) .ts-nav--on { background: var(--primary) !important; }
    .ts-nueva { flex: none; min-height: 42px !important; border-radius: 12px !important; }
    .ts-vista { display: block; min-width: 0; }
    @media (max-width: 900px) { .ts { padding: 10px 12px 32px; } }
    @media (max-width: 600px) {
      .ts { padding: 8px 8px 28px; }
      .ts-barra { margin-bottom: 12px; padding: 4px; gap: 6px; border-radius: 14px; }
      .ts-tab { padding: 8px 11px; font-size: 13px; }
      .ts-largo { display: none; }
      .ts-nueva { min-width: 42px !important; width: 42px; padding: 0 !important; }
      .ts-nueva mat-icon { margin: 0 !important; }
    }
  `],
})
export class TareasShellComponent {
  private readonly dialogos = inject(TareasDialogosService);
  private readonly eventos = inject(TareasEventosService);
  private readonly router = inject(Router);

  readonly secciones: Seccion[] = [
    { ruta: 'mis-tareas', etiqueta: 'Mis tareas', icono: 'checklist' },
    { ruta: 'bandeja', etiqueta: 'Bandeja', icono: 'forum' },
    { ruta: 'tableros', etiqueta: 'Tableros', icono: 'view_kanban' },
    // La mesa de soporte solo para quien puede leer el módulo de tickets.
    ...(inject(PermissionsService).canReadRoute(RUTA_TICKETS) ? [{ ruta: 'soporte', etiqueta: 'Mesa de soporte', icono: 'support_agent' }] : []),
    { ruta: 'solicitudes', etiqueta: 'Solicitudes', icono: 'move_to_inbox' },
    { ruta: 'espacios', etiqueta: 'Espacios y equipos', icono: 'groups' },
    { ruta: 'cronograma', etiqueta: 'Cronograma', icono: 'view_timeline' },
    { ruta: 'calendario', etiqueta: 'Calendario', icono: 'calendar_month' },
    { ruta: 'indicadores', etiqueta: 'Indicadores', icono: 'insights' },
    { ruta: 'configuracion', etiqueta: 'Configuración', icono: 'tune' },
  ];

  constructor() {
    // El directorio se pide una vez al entrar al módulo y lo comparten todas las vistas.
    inject(DirectorioService).cargar();
  }

  async nueva(): Promise<void> {
    // Si se está viendo un tablero, la tarea nace ahí por defecto.
    const m = /\/tareas\/tableros\/(\d+)/.exec(this.router.url);
    const t = await this.dialogos.nuevaTarea(m ? { tableroId: Number(m[1]) } : {});
    if (t) this.eventos.avisarCambio();
  }
}
