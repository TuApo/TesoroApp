import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-chart-card',
  standalone: true,
  imports: [MatCardModule, MatProgressSpinnerModule],
  template: `
    <mat-card class="chart-card">
      @if (title) {
        <mat-card-header class="chart-header">
          <div class="header-titles">
            <mat-card-title class="card-title">{{ title }}</mat-card-title>
            @if (subtitle) {
              <mat-card-subtitle class="card-subtitle">{{ subtitle }}</mat-card-subtitle>
            }
          </div>
          <div class="header-actions">
            <ng-content select="[actions]"></ng-content>
          </div>
        </mat-card-header>
      }
    
      <mat-card-content class="chart-content">
        <!-- Overlay Loading -->
        @if (loading) {
          <div class="loading-overlay">
            <mat-spinner diameter="40" color="primary"></mat-spinner>
          </div>
        }
    
        <!-- Contenido principal (ECharts component) -->
        <ng-content></ng-content>
      </mat-card-content>
    </mat-card>
    `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      min-width: 0;
    }
    .chart-card {
      height: 100%;
      display: flex;
      flex-direction: column;
      border-radius: 16px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
      border: 1px solid rgba(226, 232, 240, 0.8);
      background: #ffffff;
      overflow: hidden;
      transition: box-shadow 0.3s ease, transform 0.3s ease;
    }
    .chart-card:hover {
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      transform: translateY(-2px);
    }
    ::ng-deep .chart-card > .mat-mdc-card-header {
      padding: 1.5rem 1.5rem 0.5rem 1.5rem;
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.5rem 1rem;
      position: relative;
    }
    .header-titles {
      flex: 1 1 240px;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .card-title {
      font-size: 1.125rem;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 0.25rem;
      letter-spacing: -0.015em;
    }
    .card-subtitle {
      font-size: 0.85rem;
      color: #64748b;
      font-weight: 400;
    }
    .header-actions {
      flex: 0 0 auto;
      max-width: 100%;
    }
    .chart-content {
      flex: 1;
      position: relative;
      padding: 1rem 1.5rem 1.5rem 1.5rem !important;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 280px;
    }
    .loading-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(255, 255, 255, 0.6);
      backdrop-filter: blur(4px);
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: inherit;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChartCardComponent {
  @Input() title?: string;
  @Input() subtitle?: string;
  @Input() loading: boolean = false;
}
