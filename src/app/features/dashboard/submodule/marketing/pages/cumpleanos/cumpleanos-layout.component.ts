import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';

/**
 * Marketing › Cumpleaños: el módulo entero bajo una sola cabecera, con su navegación propia
 * (la misma que trae el menú, para moverse sin volver a abrirlo). En celular las secciones
 * se deslizan de lado.
 */
@Component({
  selector: 'app-cumpleanos-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cm">
      <header class="cm-cab">
        <span class="cm-icono" aria-hidden="true">🎂</span>
        <div>
          <h2>Cumpleaños</h2>
          <p class="cm-sub">Todo el cumpleaños en un solo lugar: la celebración que ve la plataforma al entrar (foto, animación, lo que
            dice su equipo y su jefe, su fondo con IA) y el correo de felicitación que sale del padrón.</p>
        </div>
      </header>
      <nav class="cm-nav" aria-label="Secciones de Cumpleaños">
        @for (s of secciones; track s.ruta) {
          <a class="cm-tab" [routerLink]="s.ruta" routerLinkActive="cm-tab--on" [routerLinkActiveOptions]="{ exact: false }">
            <mat-icon>{{ s.icono }}</mat-icon><span>{{ s.nombre }}</span></a>
        }
      </nav>
      <router-outlet />
    </section>
  `,
  styles: [`
    :host { display: block; }
    .cm { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
    .cm-cab { display: flex; align-items: center; gap: 14px; }
    .cm-icono {
      flex: none; width: 52px; height: 52px; border-radius: 16px; display: grid; place-items: center; font-size: 28px;
      background: linear-gradient(135deg, #ff4f8b, #ffb13d); box-shadow: 0 10px 24px -12px rgb(224 36 94 / .7);
    }
    .cm-cab h2 { margin: 0; font-size: 1.35rem; }
    .cm-sub { margin: 2px 0 0; color: var(--muted); font-size: .86rem; line-height: 1.45; max-width: 80ch; }
    .cm-nav {
      position: relative; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 4px; border-radius: 14px;
      background: var(--surface-2, rgb(0 0 0 / .03)); border: 1px solid var(--border);
    }
    .cm-nav::-webkit-scrollbar { display: none; }
    .cm-tab {
      flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; white-space: nowrap;
      font-size: .86rem; font-weight: 700; color: var(--muted); text-decoration: none; transition: background .15s, color .15s;
    }
    .cm-tab .mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .cm-tab:hover { color: var(--text); background: var(--surface); }
    .cm-tab--on { background: var(--surface); color: #e0245e; box-shadow: 0 1px 3px rgb(0 0 0 / .08); }
    @media (max-width: 600px) {
      .cm-cab { align-items: flex-start; }
      .cm-icono { width: 44px; height: 44px; font-size: 24px; border-radius: 13px; }
      .cm-sub { font-size: .8rem; }
    }
  `],
})
export class CumpleanosLayoutComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // En celular la barra se desliza: la sección abierta se trae al centro al entrar y al cambiar.
    const centrar = () => setTimeout(() => {
      const nav = this.host.nativeElement.querySelector<HTMLElement>('.cm-nav');
      const on = nav?.querySelector<HTMLElement>('.cm-tab--on');
      if (nav && on) nav.scrollTo({ left: on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
    });
    afterNextRender(centrar);
    inject(Router).events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe(centrar);
  }

  readonly secciones = [
    { ruta: 'tablero', nombre: 'Tablero', icono: 'dashboard' },
    { ruta: 'calendario', nombre: 'Calendario', icono: 'calendar_month' },
    { ruta: 'ia', nombre: 'Personalización con IA', icono: 'auto_awesome' },
    { ruta: 'etiquetas', nombre: 'Etiquetas del equipo', icono: 'sell' },
    { ruta: 'plantillas', nombre: 'Plantillas de animación', icono: 'animation' },
    { ruta: 'correos', nombre: 'Correos de cumpleaños', icono: 'mail' },
  ];
}
