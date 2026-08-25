import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

interface ConfigSection {
  ruta: string;
  titulo: string;
  descripcion: string;
  icono: string;
}

/**
 * Contenedor de la sección Configuración: cabecera + navegación lateral
 * (rail en escritorio, tira horizontal en móvil) + <router-outlet> con la
 * página activa.
 */
@Component({
  selector: 'app-configuracion-shell',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './configuracion-shell.component.html',
  styleUrl: './configuracion-shell.component.css',
})
export class ConfiguracionShellComponent {
  readonly sections: ConfigSection[] = [
    {
      ruta: 'cuenta',
      titulo: 'Cuenta',
      descripcion: 'Tus datos y contraseña',
      icono: 'account_circle',
    },
    {
      ruta: 'sede',
      titulo: 'Sede',
      descripcion: 'Sede de trabajo activa',
      icono: 'location_city',
    },
    {
      ruta: 'preferencias',
      titulo: 'Preferencias',
      descripcion: 'Interfaz y datos locales',
      icono: 'tune',
    },
    {
      ruta: 'acerca',
      titulo: 'Acerca de',
      descripcion: 'Versión y dispositivo',
      icono: 'info',
    },
  ];

  trackByRuta = (_: number, s: ConfigSection) => s.ruta;
}
