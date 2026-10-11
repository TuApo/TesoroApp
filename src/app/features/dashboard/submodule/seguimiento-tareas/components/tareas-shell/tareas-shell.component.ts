import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TareasDialogosService } from '../../services/tareas-dialogos.service';
import { DirectorioService } from '../../services/directorio.service';
import { TareasEventosService } from '../../services/tareas-eventos.service';

interface Seccion { ruta: string; etiqueta: string; icono: string }

/**
 * Marco común de Seguimiento Tareas: título, navegación entre vistas y "Nueva tarea"
 * siempre a mano. Las vistas viven en el router-outlet.
 */
@Component({
  selector: 'app-tareas-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ts">
      <header class="ts-cab" data-acciones="propias">
        <div class="ts-marca">
          <span class="ts-logo" aria-hidden="true"><mat-icon>task_alt</mat-icon></span>
          <div>
            <h1>Seguimiento Tareas</h1>
            <p>Asigna, sigue y cierra el trabajo con tu equipo. Los avisos llegan a Notificaciones.</p>
          </div>
        </div>
        <button mat-flat-button class="ts-nueva" (click)="nueva()"><mat-icon>add_task</mat-icon>Nueva<span class="ts-largo">&nbsp;tarea</span></button>
      </header>

      <nav class="ts-nav" aria-label="Secciones de Seguimiento Tareas">
        @for (s of secciones; track s.ruta) {
          <a [routerLink]="s.ruta" routerLinkActive="ts-nav--on" [routerLinkActiveOptions]="{ exact: false }" class="ts-tab">
            <mat-icon>{{ s.icono }}</mat-icon><span>{{ s.etiqueta }}</span>
          </a>
        }
      </nav>

      <main class="ts-vista"><router-outlet /></main>
    </div>
  `,
  styles: [`
    :host { display: block; font-family: var(--font-sans); color: var(--text); }
    .ts { max-width: 1480px; margin: 0 auto; padding: 18px 22px 40px; box-sizing: border-box; }
    .ts-cab { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
              padding: 18px 22px; border-radius: var(--r-xl); background: var(--mt-hero); color: #fff;
              position: relative; overflow: hidden; box-shadow: var(--shadow-md); }
    .ts-cab::after { content: ''; position: absolute; inset: 0; background: var(--mt-hero-ring); pointer-events: none; }
    .ts-marca { display: flex; align-items: center; gap: 14px; position: relative; z-index: 1; min-width: 0; }
    .ts-logo { width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; flex: none;
               background: var(--lime); color: var(--navy-deep); }
    .ts-logo mat-icon { font-size: 28px; width: 28px; height: 28px; }
    h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -.01em; }
    .ts-marca p { margin: 2px 0 0; color: rgb(255 255 255 / .78); font-size: 13.5px; }
    .ts-nueva { position: relative; z-index: 1; background: var(--lime) !important; color: var(--navy-deep) !important;
                min-height: 44px !important; }
    .ts-nav { display: flex; gap: 4px; margin: 14px 0 18px; padding: 5px; border-radius: 16px; background: var(--surface);
              border: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; position: sticky; top: 0; z-index: 4; }
    .ts-nav::-webkit-scrollbar { display: none; }
    .ts-tab { display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 12px; text-decoration: none;
              color: var(--text-2); font-weight: 700; font-size: 14px; white-space: nowrap; transition: background .15s, color .15s; }
    .ts-tab mat-icon { font-size: 19px; width: 19px; height: 19px; }
    .ts-tab:hover { background: var(--surface-3); color: var(--text); }
    .ts-nav--on { background: var(--navy) !important; color: #fff !important; }
    :host-context(html[data-theme='dark']) .ts-nav--on { background: var(--primary) !important; }
    .ts-vista { display: block; min-width: 0; }
    @media (max-width: 900px) { .ts { padding: 12px 12px 32px; } .ts-cab { padding: 14px 16px; } }
    @media (max-width: 600px) {
      .ts { padding: 8px 8px 28px; }
      .ts-cab { flex-wrap: nowrap; padding: 10px 12px; border-radius: var(--r-lg); }
      .ts-logo { width: 38px; height: 38px; border-radius: 11px; }
      .ts-logo mat-icon { font-size: 22px; width: 22px; height: 22px; }
      h1 { font-size: 18px; }
      .ts-marca p { display: none; }
      .ts-largo { display: none; }
      .ts-nueva { min-height: 40px !important; padding: 0 12px !important; }
      .ts-nav { margin: 10px 0 12px; }
      .ts-tab span { font-size: 13px; }
      .ts-tab { padding: 8px 11px; }
    }
  `],
})
export class TareasShellComponent {
  private readonly dialogos = inject(TareasDialogosService);
  private readonly eventos = inject(TareasEventosService);
  private readonly router = inject(Router);

  readonly secciones: Seccion[] = [
    { ruta: 'mis-tareas', etiqueta: 'Mis tareas', icono: 'checklist' },
    { ruta: 'tableros', etiqueta: 'Tableros', icono: 'view_kanban' },
    { ruta: 'espacios', etiqueta: 'Espacios y equipos', icono: 'groups' },
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
