import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';

import { SalonContextoService } from '../services/salon-contexto.service';
import { SALON_CONTEXTO } from '../services/salon-contexto.token';

/**
 * Selector de sede del salón. Solo existe cuando el contexto inyectado (`SALON_CONTEXTO`)
 * es el `SalonContextoService` propio: en una app que provea su propio contexto de sede
 * (EconomiaNegocio) no se pinta nada. Lee `?tienda=<id>` de la URL y, si no, lo guardado
 * en `salon:tienda`.
 */
@Component({
  selector: 'app-salon-selector-sede',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    @if (ctx; as c) {
      @if (c.tiendas().length > 1) {
        <label class="sede">
          <mat-icon>storefront</mat-icon>
          <select class="sede-select" [value]="c.tiendaId() ?? ''" (change)="elegir($event)" aria-label="Sede">
            @for (t of c.tiendas(); track t.id) {
              <option [value]="t.id">{{ t.nombre }}</option>
            }
          </select>
        </label>
      } @else if (c.tienda(); as t) {
        <span class="sede sede--fija"><mat-icon>storefront</mat-icon>{{ t.nombre }}</span>
      } @else if (c.cargando()) {
        <span class="sede sede--fija sl-muted">Cargando sedes…</span>
      } @else if (c.error(); as e) {
        <span class="sede sede--fija sede--error" role="alert"><mat-icon>error</mat-icon>{{ e }}</span>
      }
    }
  `,
  styles: [`
    :host { display: inline-flex; min-width: 0; }
    :host:empty { display: none; }
    .sede { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 10px; border-radius: 999px;
      border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); font-weight: 700; max-width: 100%; }
    .sede mat-icon { color: var(--muted); flex: none; }
    .sede-select { border: 0; background: transparent; color: inherit; font: inherit; min-height: 36px; max-width: 220px; cursor: pointer; }
    .sede-select:focus { outline: none; }
    .sede--error { color: var(--danger-fg); border-color: var(--danger-border); }
    .sl-muted { color: var(--muted); }
  `],
})
export class SalonSelectorSede implements OnInit {
  /** El servicio propio, o null si la app monta otro contexto de sede. */
  readonly ctx: SalonContextoService | null = (() => {
    const c = inject(SALON_CONTEXTO);
    return c instanceof SalonContextoService ? c : null;
  })();
  private ruta = inject(ActivatedRoute);

  ngOnInit(): void {
    this.ctx?.cargar(this.ruta.snapshot.queryParamMap.get('tienda'));
  }

  elegir(ev: Event): void {
    this.ctx?.seleccionar((ev.target as HTMLSelectElement).value || null);
  }
}
