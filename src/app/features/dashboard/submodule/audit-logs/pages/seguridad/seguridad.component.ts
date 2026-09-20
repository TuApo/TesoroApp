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
import { MatCardModule } from '@angular/material/card';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ColumnaTabla, TABLA_ESTANDAR, TablaEstandarComponent,
} from '../../../../../../shared/components/tabla-estandar';

import { AuditLogsService } from '../../services/audit-logs.service';
import { AuditLogEntry, AuditStats, ACTION_LABELS } from '../../models/audit-logs.models';

/** occurred_at llega en segundos (o milisegundos, o ISO): Date para ordenar/copiar. */
function aFechaEpoch(epoch: number | string): Date | null {
  if (epoch == null) return null;
  const d = typeof epoch === 'string'
    ? new Date(epoch)
    : new Date(epoch > 3e10 ? epoch : epoch * 1000);
  return isNaN(d.getTime()) ? null : d;
}

@Component({
  selector: 'app-seguridad',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatButtonModule, MatIconModule,
    MatSelectModule, MatFormFieldModule, MatInputModule, MatTooltipModule,
    MatChipsModule, MatCardModule,
    ...TABLA_ESTANDAR,
  ],
  templateUrl: './seguridad.component.html',
  styleUrl: './seguridad.component.css'
})
export class SeguridadComponent implements OnInit {
  private svc = inject(AuditLogsService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  eventos: AuditLogEntry[] = [];
  stats: AuditStats | null = null;
  totalElements = 0;
  cargando = false;
  pageSize = 50;
  pageIndex = 0;

  readonly actionLabels = ACTION_LABELS;

  filtroExito = new FormControl<boolean | null>(null);
  filtroActor = new FormControl('');

  // Tabla estándar en modo servidor: el backend pagina y no ordena. El buscador
  // de la tabla alimenta el filtro de usuario/email (se aplica sobre la página).
  readonly columnas: ColumnaTabla<AuditLogEntry>[] = [
    { id: 'occurredAt', header: 'Fecha y hora', valor: (e) => aFechaEpoch(e.occurred_at),
      formato: (e) => this.formatDate(e.occurred_at), copiaTexto: (e) => this.formatDate(e.occurred_at),
      ordenable: false, tarjeta: 'meta', minAncho: '140px' },
    { id: 'actorEmail', header: 'Usuario', valor: (e) => e.actor_email ?? '', formato: (e) => e.actor_email ?? '—',
      ordenable: false, tarjeta: 'titulo' },
    { id: 'action', header: 'Evento', valor: (e) => this.labelAccion(e.action), ordenable: false, tarjeta: 'subtitulo',
      badge: (e) => ({ texto: this.labelAccion(e.action), tono: e.success ? 'ok' : 'danger' }) },
    { id: 'ip', header: 'Dirección IP', valor: (e) => e.ip ?? '', formato: (e) => e.ip ?? '—',
      ordenable: false, prioridad: 2, tarjeta: 'meta' },
    { id: 'userAgent', header: 'Navegador', valor: (e) => this.abreviarUA(e.user_agent),
      ordenable: false, prioridad: 3, tarjeta: 'meta' },
    { id: 'success', header: 'Estado', valor: (e) => (e.success ? 'Exitoso' : 'Fallido'),
      ordenable: false, tarjeta: 'badge' },
  ];

  readonly idEvento = (e: AuditLogEntry) => e.id;
  readonly claseFila = (e: AuditLogEntry) => (e.success ? '' : 'te-fila--peligro');

  /** La tabla estándar recuerda su página y su búsqueda: se reinician al limpiar. */
  private readonly tabla = viewChild(TablaEstandarComponent);

  ngOnInit() {
    this.cargarStats();
    this.cargar();

    this.filtroExito.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { this.irAPrimeraPagina(); this.cargar(); });
    this.filtroActor.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { this.irAPrimeraPagina(); this.cargar(); });
  }

  cargar() {
    this.cargando = true;
    this.cdr.markForCheck();
    const success = this.filtroExito.value;

    this.svc.getSeguridad({
      success: success !== null ? success : undefined,
      page: this.pageIndex,
      size: this.pageSize
    }).subscribe({
      next: r => {
        let content = r.content;
        const actor = this.filtroActor.value?.toLowerCase();
        if (actor) {
          content = content.filter(e => e.actor_email?.toLowerCase().includes(actor));
        }
        this.eventos = content;
        this.totalElements = r.total_elements;
        this.cargando = false;
        this.cdr.markForCheck();
      },
      error: () => { this.cargando = false; this.cdr.markForCheck(); }
    });
  }

  cargarStats() {
    this.svc.getStats().subscribe(s => { this.stats = s; this.cdr.markForCheck(); });
  }

  onPage(e: { pagina: number; porPagina: number }) {
    this.pageIndex = e.pagina;
    this.pageSize = e.porPagina;
    this.cargar();
  }

  limpiar() {
    this.filtroExito.setValue(null);
    this.filtroActor.setValue('');
    this.tabla()?.q.set('');
    this.irAPrimeraPagina();
    this.cargar();
  }

  private irAPrimeraPagina() {
    this.pageIndex = 0;
    this.tabla()?.pagina.set(0);
  }

  labelAccion(a: string) { return this.actionLabels[a] ?? a; }
  formatDate(epoch: number | string): string {
    if (epoch == null) return '—';
    const d = typeof epoch === 'string'
      ? new Date(epoch)
      : new Date(epoch > 3e10 ? epoch : epoch * 1000);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO');
  }
  abreviarUA(ua: string | null): string {
    if (!ua) return '—';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    return ua.substring(0, 30) + '...';
  }
}
