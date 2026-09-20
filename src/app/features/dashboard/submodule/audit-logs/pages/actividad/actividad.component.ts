import {
  Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, inject, DestroyRef, viewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ColumnaTabla, TABLA_ESTANDAR, TablaEstandarComponent,
} from '../../../../../../shared/components/tabla-estandar';

import { AuditLogsService } from '../../services/audit-logs.service';
import {
  AuditLogEntry, ChangeLogEntry, AuditStats, ACTION_LABELS, ACTION_COLORS
} from '../../models/audit-logs.models';

const AUTH_ACTIONS = [
  'LOGIN','LOGOUT','USER_REGISTER','PASSWORD_CHANGE',
  'PASSWORD_RESET_OTP','REFRESH','OTP_SOLICITAR','OTP_VERIFICAR'
];

/** occurred_at llega en segundos (o milisegundos, o ISO): Date para ordenar/copiar. */
function aFechaEpoch(epoch: number | string): Date | null {
  if (epoch == null) return null;
  const d = typeof epoch === 'string'
    ? new Date(epoch)
    : new Date(epoch > 3e10 ? epoch : epoch * 1000);
  return isNaN(d.getTime()) ? null : d;
}

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
    MatButtonModule, MatIconModule,
    MatSelectModule, MatFormFieldModule, MatInputModule, MatTooltipModule,
    MatChipsModule, MatTabsModule, MatCardModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './actividad.component.html',
  styleUrl: './actividad.component.css'
})
export class ActividadComponent implements OnInit {
  private svc = inject(AuditLogsService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  stats: AuditStats | null = null;

  // ── Tab 1: Navegación (change_log accion=VIEW) ─────────────────────────────
  navegacion: ChangeLogEntry[] = [];
  navTotal = 0;
  navLoading = false;
  navPage = 0;
  navSize = 50;

  filtroModulo    = new FormControl<string | null>(null);
  filtroBusqueda  = new FormControl('');

  // ── Tab 2: Acciones (change_log accion != VIEW) ───────────────────────────
  acciones: ChangeLogEntry[] = [];
  accionTotal = 0;
  accionLoading = false;
  accionPage = 0;
  accionSize = 50;

  filtroAccionTipo = new FormControl<string | null>(null);
  filtroModuloAccion = new FormControl<string | null>(null);

  // ── Tab 3: Autenticación (audit_log) ─────────────────────────────────────
  auth: AuditLogEntry[] = [];
  authTotal = 0;
  authLoading = false;
  authPage = 0;
  authSize = 50;

  readonly modulosList = MODULOS_LIST;
  readonly authAcciones = AUTH_ACTIONS;
  readonly actionLabels = ACTION_LABELS;
  readonly actionColors = ACTION_COLORS;

  readonly accionesList = ['CREATE', 'UPDATE', 'DELETE'];

  // ── Tablas estándar (modo servidor: el backend pagina y no ordena) ─────────
  private readonly colFecha = <T extends { occurred_at: number }>(): ColumnaTabla<T> => ({
    id: 'occurredAt', header: 'Fecha y hora', valor: (c) => aFechaEpoch(c.occurred_at),
    formato: (c) => this.formatDate(c.occurred_at), copiaTexto: (c) => this.formatDate(c.occurred_at),
    ordenable: false, tarjeta: 'meta', minAncho: '140px',
  });

  readonly columnasNav: ColumnaTabla<ChangeLogEntry>[] = [
    this.colFecha<ChangeLogEntry>(),
    { id: 'actor', header: 'Usuario', valor: (c) => this.nombreActor(c), ordenable: false, tarjeta: 'titulo' },
    { id: 'modulo', header: 'Módulo', valor: (c) => c.modulo, ordenable: false, tarjeta: 'meta' },
    { id: 'pagina', header: 'Página visitada', valor: (c) => this.paginaDesdeDesc(c.descripcion),
      ordenable: false, tarjeta: 'subtitulo' },
    { id: 'ip', header: 'IP', valor: (c) => c.ip ?? '', formato: (c) => c.ip ?? '—',
      ordenable: false, prioridad: 3, tarjeta: 'meta' },
  ];

  readonly columnasAcciones: ColumnaTabla<ChangeLogEntry>[] = [
    this.colFecha<ChangeLogEntry>(),
    { id: 'actor', header: 'Usuario', valor: (c) => this.nombreActor(c), ordenable: false, tarjeta: 'titulo' },
    { id: 'modulo', header: 'Módulo', valor: (c) => c.modulo, ordenable: false, tarjeta: 'meta' },
    { id: 'entidad', header: 'Entidad', ordenable: false, prioridad: 2, tarjeta: 'subtitulo',
      valor: (c) => (c.entidad_id ? `${c.entidad} · ${c.entidad_id}` : c.entidad) },
    { id: 'accion', header: 'Acción', valor: (c) => this.labelAccion(c.accion), ordenable: false, tarjeta: 'badge',
      badge: (c) => ({ texto: this.labelAccion(c.accion), color: this.colorAccion(c.accion),
        fondo: this.colorAccion(c.accion) + '22' }) },
    { id: 'descripcion', header: 'Descripción', valor: (c) => c.descripcion ?? '',
      formato: (c) => c.descripcion ?? '—', ordenable: false, prioridad: 3, tarjeta: 'cuerpo', minAncho: '200px' },
  ];

  readonly columnasAuth: ColumnaTabla<AuditLogEntry>[] = [
    this.colFecha<AuditLogEntry>(),
    { id: 'actorEmail', header: 'Usuario', valor: (e) => e.actor_email ?? '', formato: (e) => e.actor_email ?? '—',
      ordenable: false, tarjeta: 'titulo' },
    { id: 'action', header: 'Evento', valor: (e) => this.labelAccion(e.action), ordenable: false, tarjeta: 'subtitulo',
      badge: (e) => ({ texto: this.labelAccion(e.action), color: this.colorAccion(e.action),
        fondo: this.colorAccion(e.action) + '22' }) },
    { id: 'ip', header: 'IP', valor: (e) => e.ip ?? '', formato: (e) => e.ip ?? '—',
      ordenable: false, prioridad: 2, tarjeta: 'meta' },
    { id: 'success', header: 'Estado', valor: (e) => (e.success ? 'Exitoso' : 'Fallido'),
      ordenable: false, tarjeta: 'badge' },
  ];

  readonly idRegistro = (r: { id: number }) => r.id;
  readonly claseFilaAuth = (e: AuditLogEntry) => (e.success ? '' : 'te-fila--peligro');

  /** Cada tabla recuerda su página (y la de navegación su búsqueda): se reinician
   *  cuando un filtro de negocio devuelve el backend a la página 1. */
  private readonly tablaNav = viewChild('tablaNav', { read: TablaEstandarComponent });
  private readonly tablaAcc = viewChild('tablaAcc', { read: TablaEstandarComponent });

  ngOnInit() {
    this.cargarStats();
    this.cargarNavegacion();
    this.cargarAcciones();
    this.cargarAuth();

    this.filtroModulo.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.navPage = 0; this.tablaNav()?.pagina.set(0); this.cargarNavegacion(); });

    this.filtroAccionTipo.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.accionPage = 0; this.tablaAcc()?.pagina.set(0); this.cargarAcciones(); });

    this.filtroModuloAccion.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.accionPage = 0; this.tablaAcc()?.pagina.set(0); this.cargarAcciones(); });
  }

  cargarStats() {
    this.svc.getStats().subscribe(s => { this.stats = s; this.cdr.markForCheck(); });
  }

  cargarNavegacion() {
    this.navLoading = true;
    this.cdr.markForCheck();
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
    this.cdr.markForCheck();
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
    this.cdr.markForCheck();
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

  onNavPage(e: { pagina: number; porPagina: number }) { this.navPage = e.pagina; this.navSize = e.porPagina; this.cargarNavegacion(); }
  onAccionPage(e: { pagina: number; porPagina: number }) { this.accionPage = e.pagina; this.accionSize = e.porPagina; this.cargarAcciones(); }
  onAuthPage(e: { pagina: number; porPagina: number }) { this.authPage = e.pagina; this.authSize = e.porPagina; this.cargarAuth(); }

  /** Buscador de la tabla de navegación: filtra usuario/página sobre la página traída. */
  buscarNav(q: string) {
    this.filtroBusqueda.setValue(q, { emitEvent: false });
    this.navPage = 0;
    this.cargarNavegacion();
  }

  limpiarNav() {
    this.filtroModulo.setValue(null);
    this.filtroBusqueda.setValue('');
    this.navPage = 0;
    this.tablaNav()?.pagina.set(0);
    this.tablaNav()?.q.set('');
    this.cargarNavegacion();
  }

  limpiarAcciones() {
    this.filtroAccionTipo.setValue(null);
    this.filtroModuloAccion.setValue(null);
    this.accionPage = 0;
    this.tablaAcc()?.pagina.set(0);
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
