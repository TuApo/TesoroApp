import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ColumnaTabla, TABLA_ESTANDAR } from '../../../../../../shared/components/tabla-estandar';
import { OfficeFormsService } from '../../services/office-forms.service';
import { DashboardData, FormSummary, OfficeImportedForm } from '../../models/office-forms.models';
import { OfficeExcelImportDialogComponent } from '../../components/excel-import-dialog/excel-import-dialog.component';

/** Dashboard de Gestión de Oficina: KPIs + todos los formularios registrados. */
@Component({
  selector: 'app-office-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, RouterLink, MatButtonModule, MatIconModule, MatTooltipModule,
    OfficeExcelImportDialogComponent, ...TABLA_ESTANDAR,
  ],
  template: `
  <div class="dash">
    <header class="dash__head">
      <div>
        <h1>Gestión de Oficina</h1>
        <p>Formularios dinámicos, respuestas y archivos de tus oficinas.</p>
      </div>
      <div class="dash__actions">
        <button mat-stroked-button (click)="importarAbierto.set(true)"
                matTooltip="Descargar la plantilla parametrizada o cargar formularios desde un Excel">
          <mat-icon>table_view</mat-icon> Desde Excel
        </button>
        <button mat-flat-button color="primary" routerLink="builder">
          <mat-icon>add</mat-icon> Nuevo formulario
        </button>
      </div>
    </header>

    @if (!loading() && !data()) {
      <div class="dash__error">No se pudo cargar el dashboard. <button mat-button (click)="load()">Reintentar</button></div>
    } @else {
      @if (data(); as d) {
        <div class="kpis">
          <div class="kpi"><div class="kpi__n">{{ d.total_forms }}</div><div class="kpi__l">Formularios</div></div>
          <div class="kpi"><div class="kpi__n">{{ d.published_forms }}</div><div class="kpi__l">Publicados</div></div>
          <div class="kpi"><div class="kpi__n">{{ d.draft_forms }}</div><div class="kpi__l">Borradores</div></div>
          <div class="kpi kpi--accent"><div class="kpi__n">{{ d.total_responses }}</div><div class="kpi__l">Respuestas</div></div>
        </div>
      }

      <app-tabla-estandar
        class="dash__tabla"
        id="gestion-oficina-formularios"
        titulo="Formularios de oficina"
        modulo="Gestión de Oficina"
        vacio="Aún no hay formularios. Crea el primero con “Nuevo formulario”."
        [datos]="formularios()"
        [columnas]="columnas"
        [filaId]="idFormulario"
        [cargando]="loading()">
        <ng-template tablaAcciones let-f>
          <button mat-icon-button matTooltip="Ver respuestas" (click)="goResponses(f)"><mat-icon>table_rows</mat-icon></button>
          <button mat-icon-button matTooltip="Llenar" (click)="goFill(f)"><mat-icon>edit_note</mat-icon></button>
          <button mat-icon-button matTooltip="Editar" (click)="goEdit(f)"><mat-icon>tune</mat-icon></button>
        </ng-template>
      </app-tabla-estandar>
    }
  </div>

  <!-- Carga por Excel: plantilla ya parametrizada + carga individual o masiva. -->
  @if (importarAbierto()) {
    <app-office-excel-import-dialog
        (abrir)="abrirImportado($event)"
        (creados)="trasCrearMasivo()"
        (cerrar)="importarAbierto.set(false)">
    </app-office-excel-import-dialog>
  }
  `,
  styles: [`
    .dash { padding: 8px 4px 40px; }
    .dash__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .dash__actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .dash__head h1 { font-size: 26px; font-weight: 800; margin: 0; color: var(--text); }
    .dash__head p { color: var(--muted); margin: 4px 0 0; }
    .dash__error { padding: 40px 0; color: var(--muted); }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 20px 0; }
    @media (max-width: 800px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
    .kpi { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 16px 18px; }
    .kpi--accent { background: #1e293b; border-color: #1e293b; }
    .kpi--accent .kpi__n, .kpi--accent .kpi__l { color: #fff; }
    .kpi__n { font-size: 30px; font-weight: 800; color: var(--text); }
    .kpi__l { color: var(--muted); font-size: 13px; }
    .dash__tabla { margin-top: 20px; }
  `],
})
export class OfficeDashboardComponent implements OnInit {
  private api = inject(OfficeFormsService);
  private router = inject(Router);

  data = signal<DashboardData | null>(null);
  loading = signal(true);
  /** Diálogo de carga por Excel (plantilla parametrizada + carga individual o masiva). */
  importarAbierto = signal(false);

  readonly formularios = computed<FormSummary[]>(() => this.data()?.forms ?? []);

  readonly columnas: ColumnaTabla<FormSummary>[] = [
    { id: 'titulo', header: 'Formulario', valor: f => f.title, tarjeta: 'titulo', minAncho: '180px' },
    { id: 'ubicacion', header: 'Ubicación', valor: f => f.parent_module ?? '', formato: f => f.parent_module || '—',
      prioridad: 2, tarjeta: 'subtitulo' },
    { id: 'estado', header: 'Estado', valor: f => this.statusLabel(f.status), tarjeta: 'badge',
      badge: f => ({ texto: this.statusLabel(f.status), tono: f.status === 'PUBLISHED' ? 'ok' : 'neutro' }) },
    { id: 'visibilidad', header: 'Visibilidad', valor: f => (f.visibility === 'PUBLIC' ? 'Público' : 'Privado'),
      prioridad: 2, tarjeta: 'meta' },
    { id: 'campos', header: 'Campos', valor: f => f.field_count, align: 'center', prioridad: 3, tarjeta: 'meta' },
    { id: 'respuestas', header: 'Respuestas', valor: f => f.response_count, align: 'center', tarjeta: 'meta' },
  ];

  readonly idFormulario = (f: FormSummary) => f.id;

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.api.dashboard().subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      error: () => { this.data.set(null); this.loading.set(false); },
    });
  }

  statusLabel(s: string): string {
    return s === 'PUBLISHED' ? 'Publicado' : s === 'ARCHIVED' ? 'Archivado' : 'Borrador';
  }

  goResponses(f: FormSummary): void { this.router.navigate(['/dashboard/office-management/forms', f.id, 'responses']); }
  goFill(f: FormSummary): void { this.router.navigate(['/dashboard/office-management/forms', f.id, 'fill']); }
  goEdit(f: FormSummary): void { this.router.navigate(['/dashboard/office-management/builder', f.id]); }

  /**
   * Un formulario leído del Excel se abre en el CONSTRUCTOR con todo cargado: es ahí donde
   * se revisa y se guarda. Como /builder no admite un objeto por parámetro de ruta, viaja
   * por el buzón del servicio y el constructor lo recoge al montarse.
   */
  abrirImportado(f: OfficeImportedForm): void {
    this.api.dejarPendiente(f);
    this.importarAbierto.set(false);
    this.router.navigate(['/dashboard/office-management/builder']);
  }

  /** La carga masiva ya creó formularios: el dashboard tiene que reflejarlos. */
  trasCrearMasivo(): void {
    this.importarAbierto.set(false);
    this.load();
  }
}
