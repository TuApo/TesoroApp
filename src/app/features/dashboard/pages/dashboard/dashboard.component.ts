import {  Component , ChangeDetectionStrategy, DestroyRef, ElementRef, afterNextRender, effect, inject } from '@angular/core';
import { NavbarComponent } from "../../components/navbar/navbar.component";
import { SidebarComponent } from "../../components/sidebar/sidebar.component";
import { RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { AiTutor } from "../../components/ai-tutor/ai-tutor";
import { PanelAtencion } from "../../submodule/turnos/components/panel-atencion/panel-atencion";
import { ChatDock } from "../../submodule/comunicaciones/components/dock/chat-dock";
import { CelebracionLanzadorComponent } from "../../components/celebracion/celebracion-lanzador.component";
import { OperadorComponent } from "../../../../shared/components/operador/operador";
import { AccionesPaginaService } from '../../../../core/services/acciones-pagina.service';
import { NavegacionService } from '../../../../core/services/navegacion.service';
import { SedeScopeService } from '../../../../shared/services/sede-scope/sede-scope.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-dashboard',
  imports: [
    NavbarComponent,
    SidebarComponent,
    RouterOutlet,
    MatIconModule,
    CdkScrollable,
    AiTutor,
    PanelAtencion,
    ChatDock,
    CelebracionLanzadorComponent,
    OperadorComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
} )
export class DashboardComponent {
  isSidebarHidden = false;
  /**
   * Modo embebido: la app corre dentro de un iframe de otra pantalla (las ventanas flotantes
   * de Atención remota). Se decide una vez al arrancar: dentro de la ventana se puede navegar
   * y el `?embebido=1` de la URL se pierde, pero sigue siendo un marco.
   */
  readonly embebido = detectarEmbebido();

  constructor() {
    if (this.embebido && typeof document !== 'undefined') {
      // Sin menú lateral nadie publica su ancho, y styles.css corre el contenido 84 px por defecto.
      document.documentElement.style.setProperty('--app-menu-w', '0px');
      document.documentElement.dataset['embebido'] = '1';
    }
    // Botón «Acciones» que pliega la barra de acciones de cada pantalla.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const acciones = inject(AccionesPaginaService);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const pagina = host.querySelector<HTMLElement>('.dashboard-page-wrapper');
      if (pagina) acciones.iniciar(pagina, destroyRef);
    });
    // Al cambiar de pantalla, el nombre del módulo cambia antes que el DOM: hay
    // que volver a mirar si la pantalla repite ese nombre en su cabecera.
    const navegacion = inject(NavegacionService);
    effect(() => {
      navegacion.titulo();
      acciones.revisarAhora();
    });
    // El alcance de sedes viaja en la sesión: se refresca al entrar para que un cambio
    // (una sede asignada, o pasar a una sede transversal) no exija volver a iniciar sesión.
    const sedes = inject(SedeScopeService);
    afterNextRender(() => void sedes.sincronizar());
  }

  toggleSidebar() {
    this.isSidebarHidden = !this.isSidebarHidden;
  }

}

/**
 * ¿La app está dentro de un marco? Solo entonces se esconde el menú. El `?embebido=1` que
 * llevan las URLs de las ventanas NO basta por sí solo: ese enlace abierto como pestaña normal
 * (copiado, o con clic central) dejaría la app sin menú ni barra y sin forma de salir. Un
 * padre de otro origen que no deja leer `top` también es un marco.
 */
export function detectarEmbebido(w: Pick<Window, 'self' | 'top'> | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!w) return false;
  try { return w.self !== w.top; } catch { return true; }
}
