import {  Component , ChangeDetectionStrategy, DestroyRef, ElementRef, afterNextRender, effect, inject } from '@angular/core';
import { NavbarComponent } from "../../components/navbar/navbar.component";
import { SidebarComponent } from "../../components/sidebar/sidebar.component";
import { RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AiTutor } from "../../components/ai-tutor/ai-tutor";
import { AccionesPaginaService } from '../../../../core/services/acciones-pagina.service';
import { NavegacionService } from '../../../../core/services/navegacion.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-dashboard',
  imports: [
    NavbarComponent,
    SidebarComponent,
    RouterOutlet,
    MatIconModule,
    AiTutor
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
} )
export class DashboardComponent {
  isSidebarHidden = false;

  constructor() {
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
  }

  toggleSidebar() {
    this.isSidebarHidden = !this.isSidebarHidden;
  }

}
