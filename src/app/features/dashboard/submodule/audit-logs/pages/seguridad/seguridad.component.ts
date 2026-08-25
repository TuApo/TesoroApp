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
import { MatCardModule } from '@angular/material/card';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';

import { AuditLogsService } from '../../services/audit-logs.service';
import { AuditLogEntry, AuditStats, ACTION_LABELS } from '../../models/audit-logs.models';

@Component({
  selector: 'app-seguridad',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatTableModule, MatPaginatorModule, MatButtonModule, MatIconModule,
    MatSelectModule, MatFormFieldModule, MatInputModule, MatTooltipModule,
    MatChipsModule, MatProgressSpinnerModule, MatCardModule
  ],
  templateUrl: './seguridad.component.html',
  styleUrl: './seguridad.component.css'
})
export class SeguridadComponent implements OnInit {
  private svc = inject(AuditLogsService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  private bp = inject(BreakpointObserver);

  isMobile = false;
  eventos: AuditLogEntry[] = [];
  stats: AuditStats | null = null;
  totalElements = 0;
  cargando = false;
  pageSize = 50;
  pageIndex = 0;

  readonly actionLabels = ACTION_LABELS;

  filtroExito = new FormControl<boolean | null>(null);
  filtroActor = new FormControl('');

  readonly displayedColumns = ['occurredAt', 'actorEmail', 'action', 'ip', 'userAgent', 'success'];

  ngOnInit() {
    this.bp.observe('(max-width: 768px)').pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(r => { this.isMobile = r.matches; this.cdr.markForCheck(); });

    this.cargarStats();
    this.cargar();

    this.filtroExito.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { this.pageIndex = 0; this.cargar(); });
    this.filtroActor.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { this.pageIndex = 0; this.cargar(); });
  }

  cargar() {
    this.cargando = true;
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

  onPage(e: PageEvent) {
    this.pageIndex = e.pageIndex;
    this.pageSize = e.pageSize;
    this.cargar();
  }

  limpiar() {
    this.filtroExito.setValue(null);
    this.filtroActor.setValue('');
    this.pageIndex = 0;
    this.cargar();
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
