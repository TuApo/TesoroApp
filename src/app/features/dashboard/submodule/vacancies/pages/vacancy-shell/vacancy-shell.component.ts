import { ChangeDetectionStrategy, Component, OnDestroy, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { VacancyDataService } from '../../service/vacancy-data/vacancy-data.service';
import { VacancyFiltersService } from '../../service/vacancy-filters/vacancy-filters.service';

/**
 * Contenedor del submódulo Vacantes.
 *
 * No pinta nada propio: "Listado de Vacantes" e "Indicadores de Vacantes" son
 * DOS SUBMÓDULOS del menú (Flyway V89 de ms-auth-admin los cuelga de "Vacantes"
 * en `db_admin.modulo`), no dos pestañas de una misma pantalla. Se navega entre
 * ellos por el menú lateral, como con cualquier otro par de módulos hermanos.
 *
 * Entonces, ¿para qué existe este componente? Para dos cosas que no se ven:
 *
 *  1. Las dos vistas cuelgan de la MISMA ruta padre, así que este contenedor
 *     sobrevive al salto entre una y otra. Es lo que hace que los filtros y las
 *     filas ya cargadas se conserven al pasar del listado a los indicadores —de
 *     ahí que los KPIs describan siempre lo que la tabla acaba de mostrar— y
 *     que ese salto no repita la petición al backend.
 *  2. Al salir del módulo sí se destruye, y ahí se limpia el estado compartido:
 *     volver a entrar arranca en limpio, como antes de separar las vistas.
 *
 * El padre "Vacantes" conserva su ruta en `db_admin`: el navbar poda los hijos
 * que el usuario no puede leer, y quien no tenga permiso sobre los submodulos
 * sigue entrando por `/dashboard/vacancies`, que sirve el listado.
 */
@Component({
  selector: 'app-vacancy-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule],
  template: '<router-outlet></router-outlet>',
})
export class VacancyShellComponent implements OnDestroy {
  private readonly datos = inject(VacancyDataService);
  private readonly filtros = inject(VacancyFiltersService);

  ngOnDestroy(): void {
    this.filtros.reiniciar();
    this.datos.limpiar();
  }
}
