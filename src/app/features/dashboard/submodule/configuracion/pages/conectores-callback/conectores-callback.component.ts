import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '@/environments/environment';

/**
 * A donde vuelve el navegador tras autorizar en la página del proveedor.
 *
 * <p>Esta pantalla no decide nada: recoge `code` y `state` de la URL y se los pasa al
 * backend, que es quien tiene el `code_verifier` de PKCE y puede canjear el código por un
 * token. Ese verificador nunca sale del servidor — si viajara hasta aquí, PKCE no
 * protegería de nada.
 */
@Component({
  selector: 'app-conectores-callback',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="retorno">
      <ng-container [ngSwitch]="estado()">
        <div *ngSwitchCase="'procesando'" class="caja">
          <mat-icon class="girando">progress_activity</mat-icon>
          <h3>Terminando la conexión…</h3>
          <p>Un momento, estamos guardando el permiso.</p>
        </div>

        <div *ngSwitchCase="'ok'" class="caja bien">
          <mat-icon>check_circle</mat-icon>
          <h3>Conector autorizado</h3>
          <p>Ya puedes volver y pulsar «Sincronizar» para traer sus herramientas.</p>
          <a routerLink="/dashboard/configuracion/conectores" class="btn">Volver a conectores</a>
        </div>

        <div *ngSwitchDefault class="caja mal">
          <mat-icon>error_outline</mat-icon>
          <h3>No se pudo completar</h3>
          <p>{{ detalle() }}</p>
          <a routerLink="/dashboard/configuracion/conectores" class="btn">Volver e intentar de nuevo</a>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .retorno { display: flex; justify-content: center; padding: 40px 16px; }
    .caja {
      display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
      border: 1px solid var(--cfg-border, var(--border)); border-radius: 16px;
      padding: 32px 24px; background: var(--surface); max-width: 420px;
    }
    .caja .mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--cfg-muted, var(--text-faint)); }
    .caja.bien .mat-icon { color: #16a34a; color: light-dark(#16a34a, #9cf2bc); }
    .caja.mal .mat-icon { color: var(--danger, #ef4444); color: light-dark(var(--danger, #ef4444), #f2a29c); }
    h3 { margin: 0; font-size: 1.05rem; font-weight: 700; }
    p { margin: 0; font-size: 0.86rem; color: var(--cfg-muted, var(--muted)); }
    .btn {
      margin-top: 8px; text-decoration: none; font-size: 0.88rem; font-weight: 600;
      padding: 10px 16px; border-radius: 10px;
      background: var(--primary, #3b82f6); color: #fff;
    }
    .girando { animation: giro 1.1s linear infinite; }
    @keyframes giro { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .girando { animation: none; } }
  `],
})
export class ConectoresCallbackComponent implements OnInit {
  private readonly ruta = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);

  readonly estado = signal<'procesando' | 'ok' | 'error'>('procesando');
  readonly detalle = signal('');

  ngOnInit(): void {
    const p = this.ruta.snapshot.queryParamMap;
    const error = p.get('error');
    if (error) {
      this.estado.set('error');
      this.detalle.set(p.get('error_description') || error);
      return;
    }
    const code = p.get('code');
    const state = p.get('state');
    if (!code || !state) {
      this.estado.set('error');
      this.detalle.set('La respuesta del proveedor llegó incompleta.');
      return;
    }
    this.http.get<{ ok: boolean }>(
      `${environment.apiUrl}/api/v1/ai/mcp/callback`, { params: { code, state } },
    ).subscribe({
      next: () => this.estado.set('ok'),
      error: (e) => {
        this.estado.set('error');
        this.detalle.set(e?.error?.error ?? e?.message ?? 'No se pudo canjear el permiso.');
      },
    });
  }
}
