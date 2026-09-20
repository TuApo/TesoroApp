import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

/**
 * Placeholder reutilizable para módulos del menú cuya pantalla todavía no
 * está implementada. El menú referenciado por db_admin.modulo apunta a estos
 * paths; mostramos "En construcción" en lugar de redirect silencioso al home.
 *
 * Uso desde routes:
 *   { path: 'mi-feature', component: FeatureComingSoonComponent,
 *     data: { feature: 'Nombre Mostrable' } }
 */
@Component({
  standalone: true,
  selector: 'app-feature-coming-soon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatIconModule],
  template: `
    <div class="page-wrap">
      <mat-card class="card">
        <div class="head">
          <mat-icon class="icon">construction</mat-icon>
          <h1 class="title">{{ feature }}</h1>
        </div>
        <p class="lead">Esta funcionalidad está en construcción.</p>
        <p class="sub">
          La pantalla aparece en el menú porque está registrada en el catálogo de módulos,
          pero todavía no se implementó en TesoroApp. Estará disponible cuando el equipo
          finalice el desarrollo del módulo.
        </p>
        <p class="hint">
          Si necesitás priorizar esta funcionalidad, abrí un ticket en
          <strong>Soporte → Bugs Reportados</strong>.
        </p>
      </mat-card>
    </div>
  `,
  styles: [`
    .page-wrap { display:flex; align-items:flex-start; justify-content:center; padding:32px 16px; }
    .card { max-width: 720px; width: 100%; padding: 24px 28px; border-left: 4px solid #f59e0b; }
    .head { display:flex; align-items:center; gap:12px; margin-bottom: 8px; }
    .icon { color: #f59e0b; color: light-dark(#f59e0b, #f7d397); font-size: 32px; height: 32px; width: 32px; }
    .title { margin: 0; font-size: 22px; font-weight: 600; color: var(--text); }
    .lead { margin: 12px 0 6px; color: var(--text-2); font-size: 15px; }
    .sub  { margin: 0 0 12px; color: var(--text-2); font-size: 14px; line-height: 1.55; }
    .hint { margin: 0; font-size: 13px; color: var(--muted); }
  `]
})
export class FeatureComingSoonComponent {
  private route = inject(ActivatedRoute);
  feature: string = this.route.snapshot.data?.['feature'] ?? 'Funcionalidad';
}
