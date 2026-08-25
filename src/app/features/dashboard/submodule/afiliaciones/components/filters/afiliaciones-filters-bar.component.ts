import { Component, Input, Output, EventEmitter, OnInit, ChangeDetectionStrategy } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import * as _moment from 'moment';
// @ts-ignore
const moment = _moment.default || _moment;

import { AfiliacionesDateRange, EmpresaUsuariaOpcion } from '../../models/afiliaciones-dashboard.models';
import { BaseFecha } from '../../services/afiliaciones-dashboard.service';

@Component({
  selector: 'app-afiliaciones-filters-bar',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    FormsModule
  ],
  template: `
    <mat-card class="filters-card">
      <mat-card-content class="filters-content">
        <div class="filters-group">
          <mat-icon class="filters-icon">assignment</mat-icon>
          <span class="filters-title">Consolidado Contrataci\u00f3n 2.0</span>
        </div>

        <div class="filters-actions">
          <mat-form-field appearance="outline" class="base-field">
            <mat-label>Filtrar por</mat-label>
            <mat-select [(ngModel)]="baseSel" name="base"
                        (selectionChange)="onBaseChange($event.value)">
              <mat-option value="firma">Fecha de firma de contrato</mat-option>
              <mat-option value="ingreso">Fecha de ingreso</mat-option>
              <mat-option value="registro">Fecha de registro</mat-option>
            </mat-select>
          </mat-form-field>

          <div class="quick-ranges">
            <button mat-stroked-button color="primary" [class.active-range]="activeRange === 'hoy'" (click)="setRange('hoy')">Hoy</button>
            <button mat-stroked-button color="primary" [class.active-range]="activeRange === 'ayer'" (click)="setRange('ayer')">Ayer</button>
            <button mat-stroked-button color="primary" [class.active-range]="activeRange === 'semana'" (click)="setRange('semana')">Esta Semana</button>
            <button mat-stroked-button color="primary" [class.active-range]="activeRange === 'estemes'" (click)="setRange('estemes')">Este Mes</button>
          </div>

          <form class="date-range-form" #f="ngForm" (ngSubmit)="applyCustomRange()">
            <mat-form-field appearance="outline" class="date-field">
              <mat-label>Fecha Inicio</mat-label>
              <input matInput [matDatepicker]="pickerStart" [(ngModel)]="customStart" name="start" required>
              <mat-datepicker-toggle matIconSuffix [for]="pickerStart"></mat-datepicker-toggle>
              <mat-datepicker #pickerStart></mat-datepicker>
            </mat-form-field>

            <span class="date-separator">a</span>

            <mat-form-field appearance="outline" class="date-field">
              <mat-label>Fecha Fin</mat-label>
              <input matInput [matDatepicker]="pickerEnd" [(ngModel)]="customEnd" name="end" required>
              <mat-datepicker-toggle matIconSuffix [for]="pickerEnd"></mat-datepicker-toggle>
              <mat-datepicker #pickerEnd></mat-datepicker>
            </mat-form-field>

            <button mat-flat-button color="primary" type="submit" [disabled]="!f.valid" class="apply-btn">
              Aplicar
            </button>
          </form>

          <mat-form-field appearance="outline" class="empresa-field">
            <mat-label>Empresa</mat-label>
            <mat-select [(ngModel)]="empresaSel" name="empresa"
                        (selectionChange)="onEmpresaChange($event.value)">
              <mat-option value="">Todas</mat-option>
              <mat-option value="APOYO_LABORAL">Apoyo Laboral</mat-option>
              <mat-option value="TU_ALIANZA">Tu Alianza</mat-option>
            </mat-select>
          </mat-form-field>

          <!--
            Empresa USUARIA (el cliente donde trabaja la persona), distinta de la temporal
            que contrata. Solo aparece si quien usa la barra pasó opciones: el tablero
            analítico no la filtra y no debe verle un selector vacío.
            El conteo al lado separa las empresas reales del ruido del formulario, donde hay
            entradas sueltas con una sola contratación.
          -->
          @if (empresasUsuarias.length) {
            <mat-form-field appearance="outline" class="empresa-usuaria-field">
              <mat-label>Empresa usuaria</mat-label>
              <mat-select [(ngModel)]="empresaUsuariaSel" name="empresaUsuaria"
                          (selectionChange)="onEmpresaUsuariaChange($event.value)">
                <mat-option value="">Todas</mat-option>
                @for (e of empresasUsuarias; track e.clave) {
                  <mat-option [value]="e.clave">{{ e.etiqueta }} ({{ e.total }})</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }

          <mat-form-field appearance="outline" class="oficina-field">
            <mat-label>Oficina</mat-label>
            <mat-select [(ngModel)]="oficinaSel" name="oficina"
                        (selectionChange)="onOficinaChange($event.value)">
              <mat-option value="">Todas</mat-option>
              @for (o of oficinas; track o) {
                <mat-option [value]="o">{{ o }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="responsable-field">
            <mat-label>Responsable</mat-label>
            <mat-select [(ngModel)]="responsableSel" name="responsable"
                        (selectionChange)="onResponsableChange($event.value)">
              <mat-option value="">Todos</mat-option>
              @for (r of responsables; track r) {
                <mat-option [value]="r">{{ r }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="search-field">
            <mat-label>Buscar</mat-label>
            <input matInput [(ngModel)]="searchTerm" (ngModelChange)="onSearchChange($event)"
                   placeholder="Nombre, documento, empresa...">
            <mat-icon matSuffix>search</mat-icon>
          </mat-form-field>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: [`
    .filters-card {
      margin-bottom: 2rem;
      border-radius: 16px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05) !important;
      border: 1px solid #f1f5f9;
      background: #ffffff;
    }

    .filters-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.25rem 1.5rem !important;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .filters-group {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .filters-icon { color: #64748b; }

    .filters-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: #1e293b;
    }

    .filters-actions {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      flex-wrap: wrap;
    }

    .quick-ranges {
      display: flex;
      gap: 0.5rem;
    }

    .quick-ranges button { border-radius: 8px; }

    .active-range {
      background-color: #eff6ff !important;
      border-color: #3b82f6 !important;
      color: #1d4ed8 !important;
      font-weight: 500;
    }

    .date-range-form {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .date-field { width: 140px; }

    ::ng-deep .date-field .mat-mdc-text-field-wrapper {
      background-color: transparent !important;
    }

    ::ng-deep .date-field .mat-mdc-form-field-subscript-wrapper,
    ::ng-deep .search-field .mat-mdc-form-field-subscript-wrapper,
    ::ng-deep .empresa-field .mat-mdc-form-field-subscript-wrapper,
    ::ng-deep .empresa-usuaria-field .mat-mdc-form-field-subscript-wrapper,
    ::ng-deep .oficina-field .mat-mdc-form-field-subscript-wrapper,
    ::ng-deep .base-field .mat-mdc-form-field-subscript-wrapper,
    ::ng-deep .responsable-field .mat-mdc-form-field-subscript-wrapper {
      display: none;
    }

    .date-separator {
      color: #64748b;
      font-weight: 500;
      font-size: 0.875rem;
    }

    .apply-btn {
      border-radius: 8px;
      height: 40px;
      padding: 0 1.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    .search-field { width: 240px; }
    .empresa-field { width: 170px; }
    /* Más ancha que las otras: las razones sociales son largas ("THE ELITE FLOWER S.A.S C.I"). */
    .empresa-usuaria-field { width: 250px; }
    .oficina-field { width: 180px; }
    .responsable-field { width: 200px; }
    .base-field { width: 230px; }

    @media (max-width: 900px) {
      .filters-content { flex-direction: column; align-items: flex-start; }
      .filters-actions { flex-direction: column; align-items: stretch; width: 100%; }
      .date-range-form { flex-direction: column; align-items: stretch; }
      .date-field, .search-field, .empresa-field, .empresa-usuaria-field, .oficina-field,
      .responsable-field, .base-field { width: 100%; }
      .date-separator { text-align: center; }
      .apply-btn { width: 100%; }
      .quick-ranges { width: 100%; display: grid; grid-template-columns: repeat(4, 1fr); }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AfiliacionesFiltersBarComponent implements OnInit {
  @Output() rangeChanged = new EventEmitter<AfiliacionesDateRange>();
  @Output() searchChanged = new EventEmitter<string>();
  @Output() empresaChanged = new EventEmitter<string>();
  /** Empresa usuaria (cliente): emite la CLAVE normalizada, no la etiqueta. */
  @Output() empresaUsuariaChanged = new EventEmitter<string>();
  @Output() oficinaChanged = new EventEmitter<string>();
  @Output() responsableChanged = new EventEmitter<string>();
  /** Anclaje del rango: gobierna KPIs, resúmenes, catálogos y tabla a la vez. */
  @Output() baseChanged = new EventEmitter<BaseFecha>();

  /** Opciones dinámicas (derivadas de los datos cargados). */
  @Input() oficinas: string[] = [];
  @Input() responsables: string[] = [];
  /** Vacío = el selector de empresa usuaria no se muestra. */
  @Input() empresasUsuarias: EmpresaUsuariaOpcion[] = [];

  activeRange = 'estemes';
  customStart: Date | null = null;
  customEnd: Date | null = null;
  searchTerm = '';
  empresaSel = '';
  empresaUsuariaSel = '';
  oficinaSel = '';
  responsableSel = '';
  /** Debe coincidir con el default del servicio (BaseFecha = 'firma'). */
  baseSel: BaseFecha = 'firma';

  ngOnInit() {
    // Arranca en "Este Mes" para que las gráficas temporales tengan varios días.
    this.setRange('estemes');
  }

  setRange(type: string) {
    this.activeRange = type;
    const today = moment().startOf('day');
    let start: Date;
    let end: Date;

    if (type === 'hoy') {
      start = today.toDate();
      end = moment().endOf('day').toDate();
    } else if (type === 'ayer') {
      start = today.clone().subtract(1, 'days').toDate();
      end = today.clone().subtract(1, 'days').endOf('day').toDate();
    } else if (type === 'semana') {
      start = today.clone().startOf('isoWeek').toDate();
      end = moment().endOf('day').toDate();
    } else if (type === 'estemes') {
      start = today.clone().startOf('month').toDate();
      end = moment().endOf('day').toDate();
    } else {
      return;
    }

    this.customStart = start;
    this.customEnd = end;
    this.emitRange(start, end);
  }

  applyCustomRange() {
    if (this.customStart && this.customEnd) {
      this.activeRange = 'custom';
      this.emitRange(this.customStart, this.customEnd);
    }
  }

  onSearchChange(term: string) {
    this.searchChanged.emit(term);
  }

  onEmpresaChange(empresa: string) {
    this.empresaSel = empresa;
    this.empresaChanged.emit(empresa);
  }

  onEmpresaUsuariaChange(clave: string) {
    this.empresaUsuariaSel = clave;
    this.empresaUsuariaChanged.emit(clave);
  }

  onOficinaChange(oficina: string) {
    this.oficinaSel = oficina;
    this.oficinaChanged.emit(oficina);
  }

  onResponsableChange(responsable: string) {
    this.responsableSel = responsable;
    this.responsableChanged.emit(responsable);
  }

  onBaseChange(base: BaseFecha) {
    this.baseSel = base;
    this.baseChanged.emit(base);
  }

  private emitRange(start: Date, end: Date) {
    this.rangeChanged.emit({
      start: moment(start).startOf('day').toDate(),
      end: moment(end).endOf('day').toDate()
    });
  }
}
