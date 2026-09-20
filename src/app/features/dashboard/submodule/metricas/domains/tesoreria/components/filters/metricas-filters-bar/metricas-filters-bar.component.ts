import { Component, Output, EventEmitter, ChangeDetectionStrategy, inject } from '@angular/core';

import { FormsModule, ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { SharedModule } from '@/app/shared/shared.module';
import { MatMomentDateModule } from '@angular/material-moment-adapter';
import * as _moment from 'moment';
// @ts-ignore
const moment = _moment.default || _moment;
import { MetricasDateRange } from '../../../models/tesoreria-metricas.models';

@Component({
  selector: 'app-metricas-filters-bar',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatDatepickerModule,
    MatMomentDateModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    SharedModule
],
  template: `
    <div class="filters-bar" [formGroup]="dateForm">
      
      <div class="filter-group">
        <mat-icon class="filter-icon">filter_list</mat-icon>
        <span class="filter-title">Filtros:</span>
      </div>

      <mat-form-field appearance="outline" class="dense-form-field date-range-field">
        <mat-label>Rango de Fechas</mat-label>
        <mat-date-range-input [rangePicker]="picker" [max]="today">
          <input matStartDate formControlName="start" placeholder="Inicio">
          <input matEndDate formControlName="end" placeholder="Fin" (dateChange)="onDateChange()">
        </mat-date-range-input>
        <mat-datepicker-toggle matIconSuffix [for]="picker"></mat-datepicker-toggle>
        <mat-date-range-picker #picker></mat-date-range-picker>
      </mat-form-field>

      <div class="spacer"></div>

      <div class="quick-ranges">
        <button mat-button class="quick-btn active-btn" (click)="setThisWeek()">Esta semana</button>
        <button mat-button class="quick-btn" (click)="setQuickRange(7)">7 dias</button>
        <button mat-button class="quick-btn" (click)="setQuickRange(30)">30 dias</button>
        <button mat-button class="quick-btn" (click)="setQuickRange(90)">90 dias</button>
      </div>

    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }
    .filters-bar {
      display: flex;
      align-items: center;
      gap: 1rem;
      background: var(--surface);
      padding: 0.75rem 1.25rem;
      border-radius: 12px;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      border: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .filter-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--text-2);
    }
    .filter-icon {
      font-size: 1.25rem;
      width: 1.25rem;
      height: 1.25rem;
    }
    .filter-title {
      font-weight: 600;
      font-size: 0.875rem;
    }
    .dense-form-field {
      margin-bottom: -1.25em; /* Compensate for mat-form-field bottom padding */
    }
    .date-range-field {
      width: 250px;
    }
    .spacer {
      flex: 1;
    }
    .quick-ranges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .quick-btn {
      color: #3b82f6;
      font-weight: 500;
      border-radius: 20px;
      font-size: 0.8125rem;
      padding: 0 16px;
      height: 32px;
      line-height: 32px;
      background: var(--surface-3);
    }
    .quick-btn:hover {
      background: var(--surface-4);
    }
    .active-btn {
      background: var(--surface-4);
      color: #1d4ed8; color: light-dark(#1d4ed8, #9cb3f2);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MetricasFiltersBarComponent {
  @Output() rangeChanged = new EventEmitter<MetricasDateRange>();

  today = moment().toDate();

  // Default: semana actual (lunes a hoy)
  dateForm = new FormGroup({
    start: new FormControl<Date>(moment().startOf('isoWeek').toDate()),
    end: new FormControl<Date>(moment().toDate())
  });

  onDateChange() {
    if (this.dateForm.valid && this.dateForm.value.start && this.dateForm.value.end) {
      this.rangeChanged.emit({
        start: this.dateForm.value.start,
        end: this.dateForm.value.end
      });
    }
  }

  setThisWeek() {
    const start = moment().startOf('isoWeek').toDate();
    const end = moment().toDate();
    this.dateForm.setValue({ start, end });
    this.rangeChanged.emit({ start, end });
  }

  setQuickRange(days: number) {
    const end = moment().toDate();
    const start = moment().subtract(days, 'days').toDate();
    this.dateForm.setValue({ start, end });
    this.rangeChanged.emit({ start, end });
  }
}
