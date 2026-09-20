import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { take } from 'rxjs/operators';

import { CumplimientoDialogComponent } from '../../components/cumplimiento-dialog/cumplimiento-dialog.component';
import { VacantesDashboardComponent } from '../../components/vacantes-dashboard/vacantes-dashboard.component';
import { VacancyFiltersPanelComponent } from '../../components/vacancy-filters-panel/vacancy-filters-panel.component';
import { VacancyDataService } from '../../service/vacancy-data/vacancy-data.service';
import { VacancyFiltersService } from '../../service/vacancy-filters/vacancy-filters.service';

/**
 * Indicadores de Vacantes — pantalla ANALÍTICA del submódulo.
 *
 * Solo consulta: KPIs, gráficas y el ranking de demoras que antes se pintaban
 * debajo de la tabla. No trae botones de crear / editar / eliminar / inactivar;
 * eso vive en "Listado de Vacantes".
 *
 * Comparte `VacancyDataService` y `VacancyFiltersService` con el listado: son
 * las MISMAS filas pasadas por el MISMO filtro, así que los indicadores siempre
 * describen exactamente lo que la tabla está mostrando.
 *
 * La única navegación permitida es abrir el detalle de cumplimiento desde el
 * ranking de demoras —ya existía y es de solo lectura salvo por "quitar
 * vacante", que es parte del diálogo, no de esta pantalla—.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-vacancy-indicators',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    VacancyFiltersPanelComponent,
    VacantesDashboardComponent,
  ],
  templateUrl: './vacancy-indicators.component.html',
  styleUrl: './vacancy-indicators.component.css',
})
export class VacancyIndicatorsComponent implements OnInit {
  private readonly dialog = inject(MatDialog);
  readonly datos = inject(VacancyDataService);
  readonly f = inject(VacancyFiltersService);

  /** Mismo cálculo que el listado: pestaña + filtros sobre el conjunto cargado. */
  readonly visibleRows = computed<any[]>(() => {
    this.f.cambios();
    return this.f.aplicar(this.datos.rows());
  });

  readonly opcionesFiltro = computed(() => {
    this.f.cambios();
    return this.f.opciones(this.datos.rows());
  });

  readonly loading = this.datos.loading;

  /** Rótulo del contexto que se está analizando. */
  readonly oficina = computed(() => {
    this.f.cambios();
    return this.f.filtros.oficina;
  });

  ngOnInit(): void {
    this.f.init();
    this.datos.cargar(this.f.pideInactivas);
  }

  /** El panel de filtros pidió otro conjunto (activas ↔ inactivas). */
  onRecargarConjunto(): void {
    this.datos.cargar(this.f.pideInactivas);
  }

  /**
   * Detalle de la vacante desde el ranking de demoras. Es el mismo diálogo del
   * listado: se reutiliza tal cual en vez de tener aquí una versión recortada.
   */
  abrirCumplimiento(row: any): void {
    if (!row?.id) return;
    const ref = this.dialog.open(CumplimientoDialogComponent, {
      width: '760px',
      maxWidth: '94vw',
      autoFocus: false,
      panelClass: 'cumpl-dialog-panel',
      data: {
        publicacionId: row.id,
        cargo: row?.cargo,
        finca: row?.finca,
        empresa: row?.empresa_usuaria_solicita,
        area: row?.area,
        auxilio_transporte: row?.auxilio_transporte,
        // La ruta es un booleano por oficina; se resume a Si/No para el formato.
        ruta: (Array.isArray(row?.oficinas_que_contratan) && row.oficinas_que_contratan.some((o: any) => o?.ruta)) ? 'Si' : 'No',
        req: row?.req,
        firm: row?.firm,
        cumpl: this.cumplimientoPct(row),
      },
    });
    ref.afterClosed().pipe(take(1)).subscribe((cambios) => {
      // Si se quitó alguna vacante, los conteos cambian: refrescamos.
      if (cambios) this.datos.recargar();
    });
  }

  private cumplimientoPct(v: any): number {
    const req = Number(v?.req ?? v?.personas_solicitadas) || 0;
    if (!req) return 0;
    const firmados = Number(v?.firm) || 0;
    return Math.max(0, Math.min(100, Math.round((firmados / req) * 100)));
  }
}
