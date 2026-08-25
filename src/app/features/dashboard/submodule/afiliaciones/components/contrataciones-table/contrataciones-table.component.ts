import {
  Component, Input, Output, EventEmitter, ViewChild, OnChanges, SimpleChanges,
  ChangeDetectionStrategy, ChangeDetectorRef, HostListener, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ContratacionRow } from '../../models/afiliaciones-dashboard.models';

@Component({
  selector: 'app-contrataciones-table',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatIconModule,
    MatChipsModule,
    MatTooltipModule
  ],
  template: `
    <!-- Bajo 900px la tabla de 12 columnas no cabe: la misma fila se pinta como tarjeta. -->
    @if (esAngosto) {
      <div class="cards-list">
        @for (row of dataSource.data; track row.id) {
          <article class="ct-card">
            <header class="ct-card-head">
              <div class="ct-card-id">
                <div class="ct-nombre">{{ row.nombre_completo || 'Sin nombre' }}</div>
                <div class="ct-doc">{{ row.numero_documento || '-' }}</div>
              </div>
              <span class="estado-chip" [ngClass]="getEstadoClass(row.estado)">{{ row.estado }}</span>
            </header>
            <div class="ct-card-body">
              <div class="ct-kv"><span>Empresa</span>{{ row.empresa }}</div>
              <div class="ct-kv"><span>Oficina</span>{{ row.oficina || '-' }}</div>
              <div class="ct-kv"><span>Finca / CC</span>{{ row.finca || row.centro_costo || '-' }}</div>
              <div class="ct-kv"><span>Cargo</span>{{ row.cargo || '-' }}</div>
              <div class="ct-kv"><span>Firma contrato</span>{{ row.fecha_firma_contrato ? (row.fecha_firma_contrato | date:'dd/MM/yyyy') : '-' }}</div>
              <div class="ct-kv"><span>Fecha ingreso</span>{{ row.fecha_ingreso ? (row.fecha_ingreso | date:'dd/MM/yyyy') : '-' }}</div>
              <div class="ct-kv"><span>Responsable</span>{{ row.usuario_responsable || '-' }}</div>
              <div class="ct-kv"><span>Ex. médicos</span>{{ row.examenes_medicos_at ? (row.examenes_medicos_at | date:'dd/MM/yyyy') : '-' }}</div>
            </div>
          </article>
        }
        @if (dataSource.data.length === 0) {
          <div class="no-data">
            <mat-icon>search_off</mat-icon>
            <span>No se encontraron registros de contratación para el rango seleccionado</span>
          </div>
        }
      </div>

      <mat-paginator [length]="total"
                     [pageIndex]="pageIndex"
                     [pageSize]="pageSize"
                     [pageSizeOptions]="[25, 50, 100, 250]"
                     (page)="onPage($event)"
                     showFirstLastButtons>
      </mat-paginator>
    } @else {
    <div class="table-container">
      <table mat-table [dataSource]="dataSource" matSort class="contrataciones-mat-table">

        <!-- Documento -->
        <ng-container matColumnDef="numero_documento">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Documento</th>
          <td mat-cell *matCellDef="let row">{{ row.numero_documento }}</td>
        </ng-container>

        <!-- Nombre Completo -->
        <ng-container matColumnDef="nombre_completo">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Nombre Completo</th>
          <td mat-cell *matCellDef="let row">{{ row.nombre_completo }}</td>
        </ng-container>

        <!-- Empresa -->
        <ng-container matColumnDef="empresa">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Empresa</th>
          <td mat-cell *matCellDef="let row">
            <span class="chip-empresa">{{ row.empresa }}</span>
          </td>
        </ng-container>

        <!-- Oficina -->
        <ng-container matColumnDef="oficina">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Oficina</th>
          <td mat-cell *matCellDef="let row">{{ row.oficina }}</td>
        </ng-container>

        <!-- Finca / Centro de costo -->
        <ng-container matColumnDef="finca">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Finca / CC</th>
          <td mat-cell *matCellDef="let row">{{ row.finca || row.centro_costo || '-' }}</td>
        </ng-container>

        <!-- Cargo -->
        <ng-container matColumnDef="cargo">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Cargo</th>
          <td mat-cell *matCellDef="let row">{{ row.cargo || '-' }}</td>
        </ng-container>

        <!-- Fecha de firma de contrato (anclaje por defecto del rango) -->
        <ng-container matColumnDef="fecha_firma_contrato">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Firma Contrato</th>
          <td mat-cell *matCellDef="let row">
            {{ row.fecha_firma_contrato ? (row.fecha_firma_contrato | date:'dd/MM/yyyy') : '-' }}
          </td>
        </ng-container>

        <!-- Fecha Ingreso -->
        <ng-container matColumnDef="fecha_ingreso">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Fecha Ingreso</th>
          <td mat-cell *matCellDef="let row">
            {{ row.fecha_ingreso ? (row.fecha_ingreso | date:'dd/MM/yyyy') : '-' }}
          </td>
        </ng-container>

        <!-- Estado -->
        <ng-container matColumnDef="estado">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Estado</th>
          <td mat-cell *matCellDef="let row">
            <span class="estado-chip" [ngClass]="getEstadoClass(row.estado)">
              {{ row.estado }}
            </span>
          </td>
        </ng-container>

        <!-- Usuario Responsable -->
        <ng-container matColumnDef="usuario_responsable">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Responsable</th>
          <td mat-cell *matCellDef="let row">{{ row.usuario_responsable || '-' }}</td>
        </ng-container>

        <!-- Contratado -->
        <ng-container matColumnDef="contratado_at">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Contratado</th>
          <td mat-cell *matCellDef="let row">
            {{ row.contratado_at ? (row.contratado_at | date:'dd/MM/yyyy') : '-' }}
          </td>
        </ng-container>

        <!-- Exámenes Médicos -->
        <ng-container matColumnDef="examenes_medicos_at">
          <th mat-header-cell *matHeaderCellDef mat-sort-header>Ex. M\u00e9dicos</th>
          <td mat-cell *matCellDef="let row">
            {{ row.examenes_medicos_at ? (row.examenes_medicos_at | date:'dd/MM/yyyy') : '-' }}
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="displayedColumns; sticky: true"></tr>
        <tr mat-row *matRowDef="let row; columns: displayedColumns;" class="table-row"></tr>

        <tr class="mat-row" *matNoDataRow>
          <td class="mat-cell no-data-cell" [attr.colspan]="displayedColumns.length">
            <div class="no-data">
              <mat-icon>search_off</mat-icon>
              <span>No se encontraron registros de contrataci\u00f3n para el rango seleccionado</span>
            </div>
          </td>
        </tr>
      </table>

      <mat-paginator [length]="total"
                     [pageIndex]="pageIndex"
                     [pageSize]="pageSize"
                     [pageSizeOptions]="[25, 50, 100, 250]"
                     (page)="onPage($event)"
                     showFirstLastButtons>
      </mat-paginator>
    </div>
    }
  `,
  styles: [`
    .table-container {
      overflow: auto;
      max-height: 600px;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
    }

    .contrataciones-mat-table {
      width: 100%;
      min-width: 1200px;
    }

    th.mat-mdc-header-cell {
      background-color: #f8fafc;
      color: #475569;
      font-weight: 600;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      border-bottom: 2px solid #e2e8f0;
      padding: 0.75rem 1rem !important;
      white-space: nowrap;

      /* El StickyStyler del CDK escribe \`z-index: 100\` INLINE en las celdas
         sticky. Sin \`!important\` no hay forma de bajarlo desde CSS, y a 100 la
         cabecera se pintaría por encima del submenú (50) y del navbar (60)
         allí donde se solapen. La escala de contenido de página no pasa de 10. */
      z-index: 3 !important;
    }

    td.mat-mdc-cell {
      padding: 0.6rem 1rem !important;
      font-size: 0.875rem;
      color: #334155;
      border-bottom: 1px solid #f1f5f9;
    }

    .table-row:hover {
      background-color: #f8fafc;
    }

    .chip-empresa {
      background-color: #eff6ff;
      color: #1d4ed8;
      padding: 0.2rem 0.6rem;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 500;
      white-space: nowrap;
    }

    .estado-chip {
      padding: 0.2rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
    }

    .estado-ingreso { background: #d1fae5; color: #065f46; }
    .estado-contratado { background: #dbeafe; color: #1e40af; }
    .estado-examenes { background: #fef3c7; color: #92400e; }
    .estado-proceso { background: #e0e7ff; color: #3730a3; }
    .estado-entrevistado { background: #f3e8ff; color: #6b21a8; }
    .estado-pendiente { background: #ffedd5; color: #9a3412; }
    .estado-rechazado { background: #ffe4e6; color: #9f1239; }

    .no-data-cell { text-align: center; padding: 3rem 1rem !important; }
    .no-data {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      color: #94a3b8;
    }
    .no-data mat-icon { font-size: 48px; width: 48px; height: 48px; }

    ::ng-deep .mat-mdc-paginator {
      border-top: 1px solid #e2e8f0;
      background-color: #f8fafc;
    }

    /* Vista tarjeta (móvil / pantallas angostas) */
    .cards-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 0.6rem;
      max-height: 600px;
      overflow-y: auto;
      padding: 0.1rem;
    }
    .ct-card {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      background: #fff;
      overflow: hidden;
    }
    .ct-card-head {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem;
      padding: 0.6rem 0.7rem 0.5rem; border-bottom: 1px solid #f1f5f9;
    }
    .ct-card-id { min-width: 0; }
    .ct-nombre { font-size: 0.92rem; font-weight: 600; color: #0f172a; overflow-wrap: anywhere; }
    .ct-doc { font-size: 0.78rem; color: #64748b; }
    .ct-card-body {
      display: grid; grid-template-columns: 1fr 1fr; gap: 0.45rem 0.75rem;
      padding: 0.6rem 0.7rem;
    }
    .ct-kv { font-size: 0.82rem; color: #334155; min-width: 0; overflow-wrap: anywhere; }
    .ct-kv > span {
      display: block; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.03em;
      color: #94a3b8;
    }
    .cards-list .no-data { grid-column: 1 / -1; padding: 2.5rem 1rem; }

    @media (max-width: 420px) {
      .ct-card-body { grid-template-columns: 1fr; }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContratacionesTableComponent implements OnChanges {
  /** Filas de la página ACTUAL (la paginación es server-side). */
  @Input() data: ContratacionRow[] | null = [];
  /** Total de filas que coinciden con el filtro (para el paginador). */
  @Input() total = 0;
  /** Índice de página actual (fuente única: el estado del servicio). */
  @Input() pageIndex = 0;
  /** Tamaño de página actual. */
  @Input() pageSize = 50;
  /** Emite cuando el usuario cambia de página o de tamaño. */
  @Output() pageChange = new EventEmitter<{ page: number; size: number }>();

  private cdr = inject(ChangeDetectorRef);

  @ViewChild(MatSort) sort!: MatSort;

  /** Debajo de esto la tabla (min-width 1200px) solo se puede leer con scroll horizontal. */
  private static readonly ANCHO_TARJETAS = 900;

  esAngosto = typeof window !== 'undefined'
    && window.innerWidth < ContratacionesTableComponent.ANCHO_TARJETAS;

  @HostListener('window:resize')
  onResize() {
    const angosto = typeof window !== 'undefined'
      && window.innerWidth < ContratacionesTableComponent.ANCHO_TARJETAS;
    if (angosto !== this.esAngosto) { this.esAngosto = angosto; this.cdr.markForCheck(); }
  }

  displayedColumns = [
    'numero_documento',
    'nombre_completo',
    'empresa',
    'oficina',
    'finca',
    'cargo',
    // Las dos fechas del negocio, juntas: la firma (anclaje del rango) y el ingreso.
    'fecha_firma_contrato',
    'fecha_ingreso',
    'estado',
    'usuario_responsable',
    'contratado_at',
    'examenes_medicos_at'
  ];

  dataSource = new MatTableDataSource<ContratacionRow>([]);

  ngOnChanges(changes: SimpleChanges) {
    if (changes['data']) {
      // Paginación server-side: dataSource.data son SÓLO las filas de la página actual.
      // No se conecta dataSource.paginator (el paginador refleja el total del servidor).
      this.dataSource.data = this.data || [];
      if (this.sort) this.dataSource.sort = this.sort;
    }
  }

  ngAfterViewInit() {
    // El sort ordena únicamente la página visible (la paginación real es server-side).
    // En vista tarjeta la tabla no se renderiza, así que el MatSort puede no existir.
    if (this.sort) this.dataSource.sort = this.sort;
  }

  onPage(e: PageEvent) {
    this.pageChange.emit({ page: e.pageIndex, size: e.pageSize });
  }

  getEstadoClass(estado: string): string {
    const map: Record<string, string> = {
      'Ingreso': 'estado-ingreso',
      'Contratado': 'estado-contratado',
      'Ex\u00e1menes M\u00e9dicos': 'estado-examenes',
      'En Proceso': 'estado-proceso',
      'Entrevistado': 'estado-entrevistado',
      'Pendiente': 'estado-pendiente',
      'Rechazado': 'estado-rechazado'
    };
    return map[estado] || 'estado-pendiente';
  }
}
