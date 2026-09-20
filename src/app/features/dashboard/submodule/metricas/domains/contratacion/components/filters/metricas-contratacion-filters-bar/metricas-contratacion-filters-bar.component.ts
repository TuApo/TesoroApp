import { Component, Output, EventEmitter, OnInit, ChangeDetectionStrategy } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import * as _moment from 'moment';
// @ts-ignore
const moment = _moment.default || _moment;

import { MetricasContratacionDateRange } from '../../../models/contratacion-metricas.models';

@Component({
    selector: 'app-metricas-contratacion-filters-bar',
    standalone: true,
    imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule
],
    template: `
    <mat-card class="filters-card">
      <mat-card-content class="filters-content">
        <div class="filters-group">
          <mat-icon class="filters-icon">filter_list</mat-icon>
          <span class="filters-title">Filtros de Contratación</span>
        </div>

        <div class="filters-actions">
          <div class="quick-ranges">
            <button mat-stroked-button color="primary" [class.active-range]="activeRange === 'hoy'" (click)="setRange('hoy')">Hoy</button>
            <button mat-stroked-button color="primary" [class.active-range]="activeRange === 'ayer'" (click)="setRange('ayer')">Ayer</button>
            <button mat-stroked-button color="primary" [class.active-range]="activeRange === 'estemes'" (click)="setRange('estemes')">Este Mes</button>
          </div>

          <form class="date-range-form" #f="ngForm" (ngSubmit)="applyCustomRange()">
            <mat-form-field appearance="outline" class="date-field">
              <mat-label>Día Inicial</mat-label>
              <input matInput [matDatepicker]="pickerStart" [(ngModel)]="customStart" name="start" required>
              <mat-datepicker-toggle matIconSuffix [for]="pickerStart"></mat-datepicker-toggle>
              <mat-datepicker #pickerStart></mat-datepicker>
            </mat-form-field>
            
            <span class="date-separator">a</span>

            <mat-form-field appearance="outline" class="date-field">
              <mat-label>Día Final</mat-label>
              <input matInput [matDatepicker]="pickerEnd" [(ngModel)]="customEnd" name="end" required>
              <mat-datepicker-toggle matIconSuffix [for]="pickerEnd"></mat-datepicker-toggle>
              <mat-datepicker #pickerEnd></mat-datepicker>
            </mat-form-field>

            <button mat-flat-button color="primary" type="submit" [disabled]="!f.valid" class="apply-btn">
              Aplicar Rango
            </button>
          </form>
        </div>
      </mat-card-content>
    </mat-card>
  `,
    styles: [`
    .filters-card {
      margin-bottom: 2rem;
      border-radius: 16px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05) !important;
      border: 1px solid var(--border);
      background: var(--surface);
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

    .filters-icon {
      color: var(--muted);
    }

    .filters-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--text);
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

    .quick-ranges button {
      border-radius: 8px;
    }

    .active-range {
      background-color: #eff6ff !important; background-color: light-dark(#eff6ff, #0f284d) !important;
      border-color: #3b82f6 !important;
      color: #1d4ed8 !important;
      font-weight: 500;
    }

    .date-range-form {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .date-field {
      width: 140px;
    }

    ::ng-deep .date-field .mat-mdc-text-field-wrapper {
      background-color: transparent !important;
    }

    ::ng-deep .date-field .mat-mdc-form-field-subscript-wrapper {
      display: none;
    }

    .date-separator {
      color: var(--muted);
      font-weight: 500;
      font-size: 0.875rem;
    }

    .apply-btn {
      border-radius: 8px;
      height: 40px;
      padding: 0 1.5rem;
      margin-left: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }
    
    @media (max-width: 900px) {
      .filters-content { flex-direction: column; align-items: flex-start; }
      .filters-actions { flex-direction: column; align-items: stretch; width: 100%; }
      .date-range-form { flex-direction: column; align-items: stretch; }
      .date-field { width: 100%; }
      .date-separator { text-align: center; }
      .apply-btn { margin-left: 0; width: 100%; }
      .quick-ranges { width: 100%; display: grid; grid-template-columns: repeat(3, 1fr); }
    }
  `],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class MetricasContratacionFiltersBarComponent implements OnInit {
    @Output() rangeChanged = new EventEmitter<MetricasContratacionDateRange>();

    activeRange: string = 'hoy';
    customStart: Date | null = null;
    customEnd: Date | null = null;

    ngOnInit() {
        this.setRange('hoy');
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

    private emitRange(start: Date, end: Date) {
        this.rangeChanged.emit({ start: moment(start).startOf('day').toDate(), end: moment(end).endOf('day').toDate() });
    }
}
