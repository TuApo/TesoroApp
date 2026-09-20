import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KpiSummary } from '../../models/tesoreria-metricas.models';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-kpi-strip',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    @if (kpis) {
      <div class="kpi-strip">
        <!-- Saldos Pendientes -->
        <div class="kpi-card danger">
          <div class="kpi-icon-wrapper">
            <mat-icon>account_balance_wallet</mat-icon>
          </div>
          <div class="kpi-data">
            <p class="kpi-label">Saldos Pendientes</p>
            <h3 class="kpi-value">{{ kpis.saldosPendientes | currency:'COP':'symbol-narrow':'1.0-0' }}</h3>
          </div>
        </div>
        <!-- Ejecutadas (Monto) -->
        <div class="kpi-card success">
          <div class="kpi-icon-wrapper">
            <mat-icon>check_circle</mat-icon>
          </div>
          <div class="kpi-data">
            <p class="kpi-label">Monto Ejecutado</p>
            <h3 class="kpi-value">{{ kpis.transaccionesEjecutadasMonto | currency:'COP':'symbol-narrow':'1.0-0' }}</h3>
            <p class="kpi-sub">{{ kpis.transaccionesEjecutadasCount }} transacciones</p>
          </div>
        </div>
        <!-- Pendientes por ejecutar -->
        <div class="kpi-card warning">
          <div class="kpi-icon-wrapper">
            <mat-icon>pending_actions</mat-icon>
          </div>
          <div class="kpi-data">
            <p class="kpi-label">Autorizado sin Ejecutar</p>
            <h3 class="kpi-value">{{ kpis.transaccionesPendientesMonto | currency:'COP':'symbol-narrow':'1.0-0' }}</h3>
            <p class="kpi-sub">pendientes de ejecucion</p>
          </div>
        </div>
        <!-- Anuladas -->
        <div class="kpi-card info">
          <div class="kpi-icon-wrapper">
            <mat-icon>block</mat-icon>
          </div>
          <div class="kpi-data">
            <p class="kpi-label">Monto Anulado</p>
            <h3 class="kpi-value">{{ kpis.transaccionesAutorizadasMonto | currency:'COP':'symbol-narrow':'1.0-0' }}</h3>
            <p class="kpi-sub">transacciones canceladas</p>
          </div>
        </div>
      </div>
    }
    `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }
    .kpi-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .kpi-card {
      background: var(--surface);
      border-radius: 16px;
      padding: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.25rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
      border: 1px solid var(--border);
      transition: all 0.3s ease;
      overflow: hidden;
    }
    .kpi-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
    }
    .kpi-icon-wrapper {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .kpi-icon-wrapper mat-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
    }
    .kpi-data {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      overflow: hidden;
      flex: 1;
    }
    .kpi-label {
      margin: 0;
      font-size: 0.875rem;
      color: var(--muted);
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }
    .kpi-value {
      margin: 0;
      font-size: 2.25rem;
      font-weight: 700;
      line-height: 1.2;
      color: var(--text);
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }
    .kpi-sub {
      margin: 0;
      font-size: 0.75rem;
      color: var(--text-faint);
    }

    /* Colors */
    .danger .kpi-icon-wrapper { background: #fee2e2; background: light-dark(#fee2e2, #371725); color: #ef4444; }
    .danger .kpi-value { color: #ef4444; }

    .success .kpi-icon-wrapper { background: #d1fae5; background: light-dark(#d1fae5, #133b38); color: #10b981; color: light-dark(#10b981, #98f6d7); }
    .success .kpi-value { color: #10b981; color: light-dark(#10b981, #98f6d7); }

    .warning .kpi-icon-wrapper { background: #fef3c7; background: light-dark(#fef3c7, #373625); color: #f59e0b; }
    .warning .kpi-value { color: #f59e0b; color: light-dark(#f59e0b, #f7d397); }

    .info .kpi-icon-wrapper { background: #e0f2fe; background: light-dark(#e0f2fe, #102e4c); color: #0ea5e9; }
    .info .kpi-value { color: #0ea5e9; color: light-dark(#0ea5e9, #97d9f7); }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class KpiStripComponent {
  @Input() kpis: KpiSummary | null = null;
}
