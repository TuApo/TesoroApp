import {  ChangeDetectorRef, Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { SharedModule } from '../../../../../../../shared/shared.module';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { HistorialService } from '../../../../history/service/historial/historial.service';

@Component({
  selector: 'app-historial-dialog',
  imports: [SharedModule, StandardFilterTable],
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    .dialog-wrapper {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      border-radius: 4px;
    }
    .dialog-header {
      background: linear-gradient(135deg, var(--navy-deep) 0%, var(--navy) 60%, var(--slate-700) 100%);
      color: #fff;
      padding: 24px 28px;
      display: flex;
      align-items: center;
      gap: 14px;
      flex-shrink: 0;
    }
    .dialog-header mat-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: var(--lime);
      flex-shrink: 0;
    }
    .dialog-header h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
    }
    .dialog-header p {
      margin: 4px 0 0 0;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
    }
    .dialog-body {
      flex: 1;
      overflow: auto;
      padding: 20px 24px;
    }
    .dialog-footer {
      padding: 12px 24px;
      border-top: 1px solid var(--slate-200);
      display: flex;
      justify-content: flex-end;
      flex-shrink: 0;
      background: var(--slate-50);
    }
    .state-block {
      text-align: center;
      padding: 48px 16px;
      color: var(--slate-500);
    }
    .state-block p {
      margin-top: 12px;
      font-size: 15px;
    }
    .state-block mat-spinner {
      margin: 0 auto;
    }
    .state-icon {
      font-size: 56px;
      width: 56px;
      height: 56px;
      color: var(--slate-300);
    }
    .btn-managerial {
      background-color: var(--navy) !important;
      color: var(--lime) !important;
      border-radius: 8px !important;
      font-weight: 600;
      transition: background-color 0.2s ease, color 0.2s ease;
    }
    .btn-managerial:hover {
      background-color: var(--lime) !important;
      color: var(--navy) !important;
    }
    .btn-managerial:focus-visible {
      outline: none;
      box-shadow: var(--ring);
    }
    @media (max-width: 600px) {
      .dialog-header {
        padding: 16px;
      }
      .dialog-header h2 {
        font-size: 17px;
      }
      .dialog-body {
        padding: 12px;
      }
      .dialog-footer {
        padding: 12px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .btn-managerial {
        transition: none;
      }
    }
  `],
  template: `
    <div class="dialog-wrapper">
      <div class="dialog-header">
        <mat-icon>history</mat-icon>
        <div>
          <h2>Historial de Autorizaciones</h2>
          <p>Documento: {{ data.numeroDocumento }}</p>
        </div>
      </div>

      <div class="dialog-body">
        @if (loading) {
          <div class="state-block">
            <mat-spinner diameter="40"></mat-spinner>
            <p>Cargando historial…</p>
          </div>
        }
        @if (!loading && error) {
          <div class="state-block">
            <mat-icon class="state-icon">cloud_off</mat-icon>
            <p>No se pudo cargar el historial. Intente nuevamente.</p>
          </div>
        }
        @if (!loading && !error && dataList.length === 0) {
          <div class="state-block">
            <mat-icon class="state-icon">inbox</mat-icon>
            <p>No se encontraron registros de transacciones.</p>
          </div>
        }
        @if (!loading && !error && dataList.length > 0) {
          <app-standard-filter-table
            [data]="dataList"
            [columnDefinitions]="columns"
            [tableTitle]="''"
            [enableRowClick]="false">
          </app-standard-filter-table>
        }
      </div>

      <div class="dialog-footer">
        <button mat-flat-button mat-dialog-close class="btn-managerial">
          <mat-icon>close</mat-icon> Cerrar
        </button>
      </div>
    </div>
    `
})
export class HistorialDialogComponent implements OnInit {

  columns: ColumnDefinition[] = [
    { name: 'autorizacion_concepto', header: 'Concepto', type: 'text', filterable: true },
    { name: 'autorizacion_monto', header: 'Monto Aut.', type: 'number', format: 'currency', filterable: true, align: 'right' },
    { name: 'autorizacion_cuotas', header: 'Cuotas', type: 'number', filterable: true },
    { name: 'autorizado_por', header: 'Autorizado Por', type: 'text', filterable: true },
    { name: 'sede_autorizacion', header: 'Sede Aut.', type: 'text', filterable: true },
    { name: 'autorizado_en', header: 'Fecha Aut.', type: 'date', filterable: true },
    { name: 'estado', header: 'Estado', type: 'text', filterable: true },
    { name: 'ejecucion_concepto', header: 'Concepto Ejec.', type: 'text', filterable: true },
    { name: 'ejecucion_monto', header: 'Monto Ejec.', type: 'number', format: 'currency', filterable: true, align: 'right' },
    { name: 'ejecutado_por', header: 'Ejecutado Por', type: 'text', filterable: true },
    { name: 'sede_ejecucion', header: 'Sede Ejec.', type: 'text', filterable: true },
    { name: 'ejecutado_en', header: 'Fecha Ejec.', type: 'date', filterable: true },
    { name: 'codigo_ejecucion', header: 'Cód. Ejec.', type: 'text', filterable: true }
  ];

  dataList: any[] = [];
  loading = true;
  error = false;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { numeroDocumento: string },
    private historialService: HistorialService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.historialService.getHistorialTransaccionesPorDocumento(this.data.numeroDocumento).subscribe({
      next: (res: any) => {
        const rawList = Array.isArray(res) ? res : (res.results || res.data || []);
        rawList.sort((a: any, b: any) => {
          const dateA = new Date(a.autorizado_en || a.created_at || 0).getTime();
          const dateB = new Date(b.autorizado_en || b.created_at || 0).getTime();
          return dateB - dateA;
        });
        // Los montos van crudos: la tabla los pinta con format:'currency' y así
        // ordena y filtra por número en vez de por el texto "1.300.000".
        this.dataList = rawList.map((item: any) => ({
          ...item,
          autorizacion_monto: this.toNum(item.autorizacion_monto),
          ejecucion_monto: this.toNum(item.ejecucion_monto)
        }));
        this.loading = false;
        // Zoneless: sin esto el diálogo se queda en "Cargando historial…"
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = true;
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private toNum(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
}
