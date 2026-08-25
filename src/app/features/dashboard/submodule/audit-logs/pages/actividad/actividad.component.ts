import {
  Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, inject, DestroyRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';

import { AuditLogsService } from '../../services/audit-logs.service';
import {
  AuditLogEntry, ChangeLogEntry, AuditStats, ACTION_LABELS, ACTION_COLORS
} from '../../models/audit-logs.models';

const AUTH_ACTIONS = [
  'LOGIN','LOGOUT','USER_REGISTER','PASSWORD_CHANGE',
  'PASSWORD_RESET_OTP','REFRESH','OTP_SOLICITAR','OTP_VERIFICAR'
];

const MODULOS_LIST = [
  'CONTRATACION','AFILIACIONES','TESORERIA','DOCUMENTOS','SELECCION',
  'NOMINA','ROBOTS','IA','LEGAL','AUDITORIA','ADMIN','HR',
  'COMERCIALIZADORA','METRICAS','MATDER','SOPORTE','HOME'
];

@Component({
  selector: 'app-actividad',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatTableModule, MatPaginatorModule, MatButtonModule, MatIconModule,
    MatSelectModule, MatFormFieldModule, MatInputModule, MatTooltipModule,
    MatChipsModule, MatProgressSpinnerModule, MatTabsModule, MatCardModule
  ],
  templateUrl: './actividad.component.html',
  styleUrl: './actividad.component.css'
})
export class ActividadComponent implements OnInit {
  private svc = inject(AuditLogsService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  private bp = inject(BreakpointObserver);

  isMobile = false;
  stats: AuditStats | null = null;

  // ── Tab 1: Navegación (change_log accion=VIEW) ─────────────────────────────
  navegacion: ChangeLogEntry[] = [];
  navTotal = 0;
  navLoading = false;
  navPage = 0;
  navSize = 50;
  readonly navCols = ['occurredAt', 'actor', 'modulo', 'pagina', 'ip'];

  filtroModulo    = new FormControl<string | null>(null);
  filtroBusqueda  = new FormControl('');

  // ── Tab 2: Acciones (change_log accion != VIEW) ───────────────────────────
  acciones: ChangeLogEntry[] = [];
  accionTotal = 0;
  accionLoading = false;
  accionPage = 0;
  accionSize = 50;
  readonly accionCols = ['occurredAt', 'actor', 'modulo', 'entidad', 'accion', 'descripcion'];

  filtroAccionTipo = new FormControl<string | null>(null);
  filtroModuloAccion = new FormControl<string | null>(null);

  // ── Tab 3: Autenticación (audit_log) ─────────────────────────────────────
  auth: AuditLogEntry[] = [];
  authTotal = 0;
  authLoading = false;
  authPage = 0;
  authSize = 50;
  readonly authCols = ['occurredAt', 'actorEmail', 'action', 'ip', 'success'];

  readonly modulosList = MODULOS_LIST;
  readonly authAcciones = AUTH_ACTIONS;
  readonly actionLabels = ACTION_LABELS;
  readonly actionColors = ACTION_COLORS;

  readonly accionesList = ['CREATE', 'UPDATE', 'DELETE'];

  ngOnInit() {
    this.bp.observe('(max-width: 768px)').pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(r => { this.isMobile = r.matches; this.cdr.markForCheck(); });

    this.cargarStats();
    this.cargarNavegacion();
    this.cargarAcciones();
    this.cargarAuth();

    this.filtroModulo.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.navPage = 0; this.cargarNavegacion(); });

    this.filtroBusqueda.valueChanges.pipe(debounceTime(400), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.navPage = 0; this.cargarNavegacion(); });

    this.filtroAccionTipo.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.accionPage = 0; this.cargarAcciones(); });

    this.filtroModuloAccion.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.accionPage = 0; this.cargarAcciones(); });
  }

  cargarStats() {
    this.svc.getStats().subscribe(s => { this.stats = s; this.cdr.markForCheck(); });
  }

  cargarNavegacion() {
    this.navLoading = true;
    this.svc.getCambios({
      accion: 'VIEW',
      modulo: this.filtroModulo.value ?? undefined,
      page: this.navPage, size: this.navSize
    }).subscribe({
      next: r => {
        let rows = r.content;
        const q = this.filtroBusqueda.value?.toLowerCase();
        if (q) {
          rows = rows.filter(c =>
            c.actor_email?.toLowerCase().includes(q) ||
            c.actor_nombre?.toLowerCase().includes(q) ||
            c.descripcion?.toLowerCase().includes(q)
          );
        }
        this.navegacion = rows;
        this.navTotal = r.total_elements;
        this.navLoading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.navLoading = false; this.cdr.markForCheck(); }
    });
  }

  cargarAcciones() {
    this.accionLoading = true;
    this.svc.getCambios({
      accion: this.filtroAccionTipo.value ?? undefined,
      modulo: this.filtroModuloAccion.value ?? undefined,
      page: this.accionPage, size: this.accionSize
    }).subscribe({
      next: r => {
        // Excluir VIEW de la vista de acciones
        this.acciones = r.content.filter(c => c.accion !== 'VIEW');
        this.accionTotal = r.total_elements;
        this.accionLoading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.accionLoading = false; this.cdr.markForCheck(); }
    });
  }

  cargarAuth() {
    this.authLoading = true;
    this.svc.getSeguridad({ page: this.authPage, size: this.authSize }).subscribe({
      next: r => {
        this.auth = r.content;
        this.authTotal = r.total_elements;
        this.authLoading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.authLoading = false; this.cdr.markForCheck(); }
    });
  }

  onNavPage(e: PageEvent) { this.navPage = e.pageIndex; this.navSize = e.pageSize; this.cargarNavegacion(); }
  onAccionPage(e: PageEvent) { this.accionPage = e.pageIndex; this.accionSize = e.pageSize; this.cargarAcciones(); }
  onAuthPage(e: PageEvent) { this.authPage = e.pageIndex; this.authSize = e.pageSize; this.cargarAuth(); }

  limpiarNav() {
    this.filtroModulo.setValue(null);
    this.filtroBusqueda.setValue('');
    this.navPage = 0;
    this.cargarNavegacion();
  }

  limpiarAcciones() {
    this.filtroAccionTipo.setValue(null);
    this.filtroModuloAccion.setValue(null);
    this.accionPage = 0;
    this.cargarAcciones();
  }

  labelAccion(a: string) { return this.actionLabels[a] ?? a; }
  colorAccion(a: string) { return this.actionColors[a] ?? '#9e9e9e'; }
  formatDate(epoch: number | string): string {
    if (epoch == null) return '—';
    const d = typeof epoch === 'string'
      ? new Date(epoch)
      : new Date(epoch > 3e10 ? epoch : epoch * 1000);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO');
  }
  paginaDesdeDesc(desc: string | null): string {
    if (!desc) return '—';
    const m = desc.match(/^Visitó "([^"]+)"/);
    return m ? m[1] : desc;
  }
  nombreActor(c: ChangeLogEntry): string {
    return c.actor_nombre || c.actor_email || '—';
  }
}
