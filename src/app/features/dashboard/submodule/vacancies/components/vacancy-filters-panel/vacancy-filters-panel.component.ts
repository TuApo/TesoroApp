import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { SmartSelectComponent } from '../smart-select/smart-select.component';
import { MatTooltipModule } from '@angular/material/tooltip';

import { VacancyFiltersService } from '../../service/vacancy-filters/vacancy-filters.service';
import { OPC_ANTIGUEDAD, OpcionesFiltro, ViewMode } from '../../models/vacante.model';

/**
 * Cabecera de filtros del submódulo Vacantes.
 *
 * Es el MISMO componente en "Listado de Vacantes" y en "Indicadores de
 * Vacantes": el estado vive en `VacancyFiltersService`, así que lo que se
 * filtre en una pantalla es exactamente lo que ve la otra.
 *
 * Incluye el selector de pestaña (Todos / Faltantes / Completados / Inactivas)
 * porque también acota el universo: separarlo del resto de filtros dejaba a
 * indicadores sin forma de mirar las inactivas.
 */
@Component({
  selector: 'app-vacancy-filters-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatNativeDateModule,
    MatSelectModule,
    MatTooltipModule,
    SmartSelectComponent,
  ],
  templateUrl: './vacancy-filters-panel.component.html',
  styleUrl: './vacancy-filters-panel.component.css',
})
export class VacancyFiltersPanelComponent {
  readonly f = inject(VacancyFiltersService);

  /** Cuántas vacantes quedan tras filtrar (lo calcula la pantalla). */
  @Input() resultado = 0;
  /** Opciones vivas de los desplegables, derivadas del conjunto cargado. */
  @Input() opciones: OpcionesFiltro = { fincas: [], empresas: [], cargos: [], municipios: [], tipos: [] };

  /**
   * Cambió de pestaña y hay que pedir OTRO conjunto al backend
   * (activas ↔ inactivas). El resto de cambios NO necesita evento: mueven la
   * señal `cambios` del servicio y las dos pantallas recalculan solas.
   */
  @Output() recargar = new EventEmitter<void>();

  readonly opcAntiguedad = OPC_ANTIGUEDAD;

  // ── Accesores de `app-smart-select` ──────────────────────────────────────
  // Los filtros usan '' como "todos", así que cada lista lleva esa opción
  // delante en vez de un `<mat-option>` suelto: el selector solo conoce
  // opciones, no casos especiales.
  valorOpcion = (o: { valor: any; label: string }) => o.valor;
  etiquetaOpcion = (o: { valor: any; label: string }) => o.label;
  valorAntiguedad = (o: { valor: number; label: string }) => o.valor;

  opcionesOficina = () => [
    { valor: '', label: this.f.sinLimiteSede ? 'Todas las oficinas' : 'Todas mis oficinas' },
    ...this.f.oficinas().map((o) => ({ valor: o, label: o })),
  ];

  conFincas = () => this.conTodos(this.opciones.fincas, 'Todos');
  conEmpresas = () => this.conTodos(this.opciones.empresas, 'Todas');
  conCargos = () => this.conTodos(this.opciones.cargos, 'Todos');
  conMunicipios = () => this.conTodos(this.opciones.municipios, 'Todos');
  conTipos = () => this.conTodos(this.opciones.tipos, 'Todos');

  private conTodos(lista: readonly string[], rotulo: string) {
    return [{ valor: '', label: rotulo }, ...lista.map((v) => ({ valor: v, label: v }))];
  }

  onToggleView(mode: ViewMode): void {
    if (this.f.setViewMode(mode)) this.recargar.emit();
  }

  onFiltroChange(): void {
    this.f.notificar();
  }

  onOficinaChange(): void {
    this.f.onOficinaChange();
  }

  limpiarFiltros(): void {
    this.f.limpiarFiltros();
  }

  toggleFiltros(): void {
    this.f.toggleFiltros();
  }
}
