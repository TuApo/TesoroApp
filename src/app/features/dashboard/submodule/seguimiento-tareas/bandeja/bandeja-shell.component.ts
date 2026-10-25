import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BandejaEstadoService } from './bandeja-estado.service';
import { minutosLegibles } from './bandeja-ui';

/**
 * Bandeja: el correo y el WhatsApp de cada persona llevados como un CRM y atados a
 * Seguimiento Tareas. Sub-navegación + indicadores; las vistas viven en el router-outlet.
 * Con `?usuario=` un supervisor (ADMIN/GERENCIA) mira la de otra persona, en solo lectura.
 */
@Component({
  selector: 'app-bandeja-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatTooltipModule],
  providers: [BandejaEstadoService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (estado.supervisando()) {
      <div class="bj-super" role="status">
        <mat-icon>visibility</mat-icon>
        <span>Estás viendo la bandeja de <b>{{ estado.nombreSupervisado() || 'otra persona' }}</b> en <b>solo lectura</b>.
          Cada apertura queda registrada y la persona la ve en «Accesos a mi bandeja».</span>
        <a routerLink="/dashboard/tareas/bandeja/equipo" class="bj-super-salir">Volver al equipo</a>
      </div>
    }

    @let r = estado.resumen();
    <section class="bj-kpis" aria-label="Indicadores de la bandeja">
      <a class="bj-kpi" data-tono="peligro" [routerLink]="['./']" [queryParams]="qp({ vista: 'pendientes' })">
        <mat-icon>reply</mat-icon><div><strong>{{ r?.por_responder ?? '—' }}</strong><span>Por responder</span></div>
      </a>
      <a class="bj-kpi" [attr.data-tono]="(r?.vencidos ?? 0) > 0 ? 'peligro' : null" [routerLink]="['./']" [queryParams]="qp({ vista: 'vencidos' })"
         [matTooltip]="'Sin respuesta hace más de ' + (r?.sla_horas ?? 24) + ' h'">
        <mat-icon>alarm</mat-icon><div><strong>{{ r?.vencidos ?? '—' }}</strong><span>Vencidos</span></div>
      </a>
      <a class="bj-kpi" data-tono="aviso" [routerLink]="['./']" [queryParams]="qp({ vista: 'esperando' })">
        <mat-icon>hourglass_top</mat-icon><div><strong>{{ r?.esperando ?? '—' }}</strong><span>Esperando respuesta</span></div>
      </a>
      <a class="bj-kpi" [attr.data-tono]="(r?.compromisos_vencidos ?? 0) > 0 ? 'peligro' : 'info'" routerLink="compromisos" [queryParams]="qp({})">
        <mat-icon>handshake</mat-icon>
        <div><strong>{{ r?.compromisos_abiertos ?? '—' }}</strong>
          <span>Compromisos{{ (r?.compromisos_vencidos ?? 0) > 0 ? ' · ' + r!.compromisos_vencidos + ' vencidos' : '' }}</span></div>
      </a>
      <div class="bj-kpi" data-tono="ok" matTooltip="Mediana de lo que tardas en responder (últimos 30 días)">
        <mat-icon>speed</mat-icon><div><strong>{{ mediana() }}</strong><span>Tiempo de respuesta</span></div>
      </div>
      <div class="bj-kpi">
        <mat-icon>forward_to_inbox</mat-icon>
        <div><strong>{{ r?.mensajes_recibidos ?? '—' }} / {{ r?.mensajes_enviados ?? '—' }}</strong><span>Recibidos / enviados (30 d)</span></div>
      </div>
    </section>

    @if (r && r.cuentas_con_error > 0 && !estado.supervisando()) {
      <a class="bj-alerta" routerLink="cuentas"><mat-icon>link_off</mat-icon>
        {{ r.cuentas_con_error === 1 ? 'Una cuenta dejó de sincronizar' : r.cuentas_con_error + ' cuentas dejaron de sincronizar' }}. Revísala en Cuentas.</a>
    }

    <nav class="bj-nav" aria-label="Secciones de la bandeja">
      <a routerLink="./" [queryParams]="qp({})" routerLinkActive="bj-nav--on" [routerLinkActiveOptions]="{ paths: 'exact', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored' }"><mat-icon>inbox</mat-icon>Conversaciones</a>
      <a routerLink="compromisos" [queryParams]="qp({})" routerLinkActive="bj-nav--on"><mat-icon>handshake</mat-icon>Compromisos</a>
      <a routerLink="contactos" [queryParams]="qp({})" routerLinkActive="bj-nav--on"><mat-icon>contacts</mat-icon>Contactos</a>
      <a routerLink="cuentas" [queryParams]="qp({})" routerLinkActive="bj-nav--on"><mat-icon>link</mat-icon>Cuentas</a>
      @if (r?.es_supervisor) {
        <a routerLink="equipo" routerLinkActive="bj-nav--on"><mat-icon>supervisor_account</mat-icon>Equipo</a>
      }
    </nav>

    <router-outlet />
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 12px; }
    .bj-super { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 14px; background: var(--warn-bg);
                border: 1px solid var(--warn-border); color: var(--warn-fg); font-size: 14px; }
    .bj-super mat-icon { flex: none; }
    .bj-super span { flex: 1; min-width: 0; }
    .bj-super-salir { color: inherit; font-weight: 800; white-space: nowrap; }
    .bj-kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
    .bj-kpi { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 14px; background: var(--surface);
              border: 1px solid var(--border); min-width: 0; text-decoration: none; color: inherit; }
    a.bj-kpi:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }
    .bj-kpi mat-icon { flex: none; width: 34px; height: 34px; font-size: 20px; display: grid; place-items: center; border-radius: 10px;
                       background: var(--surface-3); color: var(--text-2); }
    .bj-kpi div { display: flex; flex-direction: column; min-width: 0; }
    .bj-kpi strong { font-size: 22px; font-weight: 800; line-height: 1.1; color: var(--text); white-space: nowrap; }
    .bj-kpi span { font-size: 12px; color: var(--muted); font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bj-kpi[data-tono="peligro"] mat-icon { background: var(--danger-bg); color: var(--danger-fg); }
    .bj-kpi[data-tono="aviso"] mat-icon { background: var(--warn-bg); color: var(--warn-fg); }
    .bj-kpi[data-tono="ok"] mat-icon { background: var(--ok-bg); color: var(--ok-fg); }
    .bj-kpi[data-tono="info"] mat-icon { background: var(--info-bg); color: var(--info-fg); }
    .bj-alerta { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 12px; background: var(--danger-bg);
                 border: 1px solid var(--danger-border); color: var(--danger-fg); font-weight: 700; text-decoration: none; }
    .bj-nav { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
    .bj-nav::-webkit-scrollbar { display: none; }
    .bj-nav a { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 10px; color: var(--text-2);
                text-decoration: none; font-weight: 700; font-size: 14px; white-space: nowrap; }
    .bj-nav a mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .bj-nav a:hover { background: var(--surface-3); color: var(--text); }
    .bj-nav--on { background: var(--blue-soft) !important; color: var(--brand-blue-strong, var(--primary)) !important; }
    :host-context(html[data-theme='dark']) .bj-nav--on { background: var(--info-bg) !important; color: var(--info-fg) !important; }
    @media (max-width: 1100px) { .bj-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 600px) {
      .bj-kpis { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
      .bj-kpi { flex: 0 0 72%; scroll-snap-align: start; }
      .bj-super { align-items: flex-start; font-size: 13px; }
    }
  `],
})
export class BandejaShellComponent {
  readonly estado = inject(BandejaEstadoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly mediana = computed(() => minutosLegibles(this.estado.resumen()?.respuesta_mediana_min));

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(q => {
      const u = q.get('usuario');
      const nombre = q.get('nombre');
      if (u !== this.estado.usuario()) {
        this.estado.usuario.set(u);
        this.estado.nombreSupervisado.set(nombre);
        void this.estado.refrescar();
      } else if (!this.estado.resumen()) {
        void this.estado.refrescar();
      }
    });
  }

  /** Conserva ?usuario (supervisión) al navegar entre las vistas de la bandeja. */
  qp(extra: Record<string, string>): Record<string, string | null> {
    const u = this.estado.usuario();
    return u ? { usuario: u, nombre: this.estado.nombreSupervisado(), ...extra } : { ...extra };
  }
}
