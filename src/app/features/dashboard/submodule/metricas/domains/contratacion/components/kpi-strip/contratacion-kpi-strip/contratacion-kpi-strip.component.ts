import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { ContratacionKpiSummary } from '../../../models/contratacion-metricas.models';

@Component({
    selector: 'app-contratacion-kpi-strip',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatIconModule],
    template: `
    <div class="kpi-grid">
      <!-- Llenaron Formulario -->
      <mat-card class="kpi-card hover-lift">
        <mat-card-content>
          <div class="kpi-content">
            <div class="kpi-text">
              <span class="kpi-label">Llenaron Formulario</span>
              <h2 class="kpi-value text-blue">
                {{ kpis?.totalLlenaronFormulario | number:'1.0-0' }}
              </h2>
              <span class="kpi-subtext">De {{ kpis?.totalCandidatos }} total</span>
            </div>
            <div class="kpi-icon-bg bg-blue-100">
              <mat-icon class="text-blue">description</mat-icon>
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- Con Correo Electrónico -->
      <mat-card class="kpi-card hover-lift">
        <mat-card-content>
          <div class="kpi-content">
            <div class="kpi-text">
              <span class="kpi-label">Con Correo</span>
              <h2 class="kpi-value text-emerald">
                {{ kpis?.totalConEmail | number:'1.0-0' }}
              </h2>
            </div>
            <div class="kpi-icon-bg bg-emerald-100">
              <mat-icon class="text-emerald">email</mat-icon>
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- Con Celular Útil -->
      <mat-card class="kpi-card hover-lift">
        <mat-card-content>
          <div class="kpi-content">
            <div class="kpi-text">
              <span class="kpi-label">Celular Integrable</span>
              <h2 class="kpi-value text-amber">
                {{ kpis?.totalConCelular | number:'1.0-0' }}
              </h2>
            </div>
            <div class="kpi-icon-bg bg-amber-100">
              <mat-icon class="text-amber">smartphone</mat-icon>
            </div>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
    styles: [`
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .kpi-card {
      border-radius: 16px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03) !important;
      transition: all 0.3s ease;
      background: var(--surface);
      border: 1px solid var(--border);
      overflow: hidden;
    }

    .hover-lift:hover {
      transform: translateY(-4px);
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05) !important;
    }

    mat-card-content {
      padding: 1.5rem !important;
    }

    .kpi-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .kpi-text {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .kpi-label {
      color: var(--muted);
      font-size: 0.875rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .kpi-value {
      margin: 0;
      font-size: 2.25rem;
      font-weight: 700;
      line-height: 1.2;
    }

    .kpi-subtext {
      font-size: 0.75rem;
      color: var(--text-faint);
    }

    .kpi-icon-bg {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .kpi-icon-bg mat-icon {
      width: 32px;
      height: 32px;
      font-size: 32px;
    }

    /* Colors */
    .text-blue { color: #3b82f6; }
    .bg-blue-100 { background-color: var(--surface-4); }

    .text-emerald { color: #10b981; color: light-dark(#10b981, #98f6d7); }
    .bg-emerald-100 { background-color: #d1fae5; background-color: light-dark(#d1fae5, #133b38); }

    .text-amber { color: #f59e0b; color: light-dark(#f59e0b, #f7d397); }
    .bg-amber-100 { background-color: #fef3c7; background-color: light-dark(#fef3c7, #373625); }
  `],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContratacionKpiStripComponent {
    @Input() kpis: ContratacionKpiSummary | null = null;
}
