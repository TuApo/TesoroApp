import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { PermissionsService } from '@/app/core/services/permissions.service';

interface ConfigSection {
  ruta: string;
  titulo: string;
  descripcion: string;
  icono: string;
  /** Solo para administradores. Sin esto, la seccion la ve todo el mundo. */
  soloAdmin?: boolean;
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
  private readonly permisos = inject(PermissionsService);

  /**
   * Las secciones que este usuario puede ver.
   *
   * <p>Esconder una entrada del menu NO es seguridad: quien conozca la URL entra igual.
   * Lo que de verdad cierra la puerta son los `@PreAuthorize("hasAuthority('ADMIN')")` de
   * los endpoints, que devuelven 403 sin importar lo que pinte el front. Esto es para que
   * nadie vea una pantalla que no le sirve.
   */
  readonly visibles = computed(() =>
    this.sections.filter((s) => !s.soloAdmin || this.permisos.isAdmin()));

  private readonly sections: ConfigSection[] = [
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
      ruta: 'conectores',
      titulo: 'Conectores',
      descripcion: 'Herramientas externas conectadas',
      icono: 'hub',
      soloAdmin: true,
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
