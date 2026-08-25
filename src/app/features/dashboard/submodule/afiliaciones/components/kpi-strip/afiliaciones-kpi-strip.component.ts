import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { AfiliacionesKpiSummary } from '../../models/afiliaciones-dashboard.models';

@Component({
  selector: 'app-afiliaciones-kpi-strip',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule],
  template: `
    <div class="kpi-grid">
      <mat-card class="kpi-card hover-lift">
        <mat-card-content>
          <div class="kpi-content">
            <div class="kpi-text">
              <span class="kpi-label">Total Ingresos</span>
              <h2 class="kpi-value text-blue">
                {{ kpis?.totalIngresos | number:'1.0-0' }}
              </h2>
              <span class="kpi-subtext">En el rango seleccionado</span>
            </div>
            <div class="kpi-icon-bg bg-blue-100">
              <mat-icon class="text-blue">groups</mat-icon>
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card class="kpi-card hover-lift">
        <mat-card-content>
          <div class="kpi-content">
            <div class="kpi-text">
              <span class="kpi-label">Ingresos Hoy</span>
              <h2 class="kpi-value text-emerald">
                {{ kpis?.ingresosHoy | number:'1.0-0' }}
              </h2>
              <span class="kpi-subtext">Fecha de ingreso hoy</span>
            </div>
            <div class="kpi-icon-bg bg-emerald-100">
              <mat-icon class="text-emerald">today</mat-icon>
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card class="kpi-card hover-lift">
        <mat-card-content>
          <div class="kpi-content">
            <div class="kpi-text">
              <span class="kpi-label">Contratados</span>
              <h2 class="kpi-value text-violet">
                {{ kpis?.totalContratados | number:'1.0-0' }}
              </h2>
            </div>
            <div class="kpi-icon-bg bg-violet-100">
              <mat-icon class="text-violet">how_to_reg</mat-icon>
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card class="kpi-card hover-lift">
        <mat-card-content>
          <div class="kpi-content">
            <div class="kpi-text">
              <span class="kpi-label">Oficinas</span>
              <h2 class="kpi-value text-amber">
                {{ kpis?.totalOficinas | number:'1.0-0' }}
              </h2>
            </div>
            <div class="kpi-icon-bg bg-amber-100">
              <mat-icon class="text-amber">business</mat-icon>
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card class="kpi-card hover-lift">
        <mat-card-content>
          <div class="kpi-content">
            <div class="kpi-text">
              <span class="kpi-label">Empresas</span>
              <h2 class="kpi-value text-rose">
                {{ kpis?.totalEmpresas | number:'1.0-0' }}
              </h2>
            </div>
            <div class="kpi-icon-bg bg-rose-100">
              <mat-icon class="text-rose">apartment</mat-icon>
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card class="kpi-card hover-lift">
        <mat-card-content>
          <div class="kpi-content">
            <div class="kpi-text">
              <span class="kpi-label">Pendientes</span>
              <h2 class="kpi-value text-orange">
                {{ kpis?.totalPendientes | number:'1.0-0' }}
              </h2>
            </div>
            <div class="kpi-icon-bg bg-orange-100">
              <mat-icon class="text-orange">pending_actions</mat-icon>
            </div>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2rem;
    }

    /* En el celular, 6 tarjetas apiladas dejan el resto del tablero fuera de la
       primera pantalla: se compactan a dos por fila. */
    @media (max-width: 640px) {
      .kpi-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.6rem;
        margin-bottom: 1.25rem;
      }
    }

    .kpi-card {
      border-radius: 16px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03) !important;
      transition: all 0.3s ease;
      background: #ffffff;
      border: 1px solid #f1f5f9;
      overflow: hidden;
    }

    .hover-lift:hover {
      transform: translateY(-4px);
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05) !important;
    }

    mat-card-content { padding: 1.25rem !important; }

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
      color: #64748b;
      font-size: 0.8rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .kpi-value {
      margin: 0;
      font-size: 2rem;
      font-weight: 700;
      line-height: 1.2;
    }

    .kpi-subtext {
      font-size: 0.7rem;
      color: #94a3b8;
    }

    .kpi-icon-bg {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .kpi-icon-bg mat-icon {
      width: 28px;
      height: 28px;
      font-size: 28px;
    }

    .text-blue { color: #3b82f6; }
    .bg-blue-100 { background-color: #dbeafe; }
    .text-emerald { color: #10b981; }
    .bg-emerald-100 { background-color: #d1fae5; }
    .text-violet { color: #8b5cf6; }
    .bg-violet-100 { background-color: #ede9fe; }
    .text-amber { color: #f59e0b; }
    .bg-amber-100 { background-color: #fef3c7; }
    .text-rose { color: #f43f5e; }
    .bg-rose-100 { background-color: #ffe4e6; }
    .text-orange { color: #f97316; }
    .bg-orange-100 { background-color: #ffedd5; }

    /* Tarjeta compacta en móvil: el icono estorba más de lo que aporta cuando
       el ancho disponible es la mitad de la pantalla. */
    @media (max-width: 640px) {
      mat-card-content { padding: 0.75rem !important; }
      .kpi-label { font-size: 0.66rem; letter-spacing: 0.03em; }
      .kpi-value { font-size: 1.5rem; }
      .kpi-icon-bg { width: 34px; height: 34px; border-radius: 10px; }
      .kpi-icon-bg mat-icon { width: 20px; height: 20px; font-size: 20px; }
      .hover-lift:hover { transform: none; }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AfiliacionesKpiStripComponent {
  @Input() kpis: AfiliacionesKpiSummary | null = null;
}
