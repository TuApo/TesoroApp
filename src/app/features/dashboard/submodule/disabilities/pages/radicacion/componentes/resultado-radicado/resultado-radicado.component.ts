/**
 * Resumen de un guardado de radicados (`ResultadoAsignacionRadicado`): cuantas quedaron y,
 * fila por fila, cuales no y por que. El backend no tumba el lote por una invalida, asi que
 * este resumen es la unica forma de saber que paso con cada codigo.
 */
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import type { ResultadoAsignacionRadicado } from '../../../../models/incapacidad-salud.model';
import { codigoSinGuion } from '../../../../utils/codigos';

@Component({
  selector: 'app-resultado-radicado',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (resultado(); as r) {
      <section class="rres" [class.rres-con-fallos]="r.fallidos > 0" role="status" aria-live="polite">
        <header class="rres-cabecera">
          <mat-icon class="rres-icono">{{ r.fallidos === 0 ? 'task_alt' : r.exitosos === 0 ? 'error' : 'rule' }}</mat-icon>
          <div class="rres-textos">
            <strong>{{ titulo() }}</strong>
            <span class="rres-sub">
              {{ r.exitosos }} de {{ r.total }} guardada(s){{ r.fallidos ? ' · ' + r.fallidos + ' con error' : '' }}
              @if (numero()) { · radicado <span class="rres-mono">{{ numero() }}</span> }
            </span>
          </div>
          @if (cerrable()) {
            <button type="button" mat-icon-button (click)="cerrar.emit()" matTooltip="Ocultar el resumen" aria-label="Ocultar el resumen">
              <mat-icon>close</mat-icon>
            </button>
          }
        </header>
        @if (r.resultados.length) {
          <ul class="rres-lista">
            @for (f of ordenados(); track f.incapacidadId) {
              <li [class.rres-error]="!f.ok">
                <mat-icon>{{ f.ok ? 'check_circle' : 'cancel' }}</mat-icon>
                <span class="rres-mono">{{ codigo(f) }}</span>
                @if (f.incapacidad?.nombreCompleto; as nombre) { <span class="rres-nombre">{{ nombre }}</span> }
                <span class="rres-mensaje">{{ f.mensaje }}</span>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: `
    :host { display: block; }
    .rres { border: 1px solid #a5d6a7; border-color: light-dark(#a5d6a7, #24513a); border-radius: 10px; background: #f1f8e9; background: light-dark(#f1f8e9, #17281f); padding: 10px 12px; }
    .rres.rres-con-fallos { border-color: #f59e0b; background: #fffbeb; background: light-dark(#fffbeb, #2d2716); }
    .rres-cabecera { display: flex; align-items: center; gap: 10px; }
    .rres-icono { color: var(--disab-ok, #2e7d32); flex-shrink: 0; }
    .rres-con-fallos .rres-icono { color: var(--disab-warn, #b26a00); }
    .rres-textos { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; font-size: 13.5px; color: var(--text); }
    .rres-sub { font-size: 12.5px; color: var(--muted); }
    .rres-mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12.5px; }
    .rres-lista { list-style: none; margin: 8px 0 0; padding: 0; max-height: 240px; overflow: auto; display: flex; flex-direction: column; gap: 4px; }
    .rres-lista li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 12.5px; color: var(--text); }
    .rres-lista mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--disab-ok, #2e7d32); }
    .rres-lista li.rres-error mat-icon { color: var(--disab-danger, #c62828); }
    .rres-lista li.rres-error .rres-mensaje { color: var(--disab-danger, #c62828); font-weight: 600; }
    .rres-nombre { font-weight: 600; }
    .rres-mensaje { color: var(--muted); }
  `,
})
export class ResultadoRadicadoComponent {
  readonly resultado = input<ResultadoAsignacionRadicado | null>(null);
  /** Numero que se guardo, para el encabezado. */
  readonly numero = input<string | null>(null);
  readonly recobro = input(false);
  readonly cerrable = input(true);
  readonly cerrar = output<void>();

  /** Los errores primero: son lo que hay que mirar. */
  readonly ordenados = computed(() => {
    const r = this.resultado();
    return r ? [...r.resultados].sort((a, b) => Number(a.ok) - Number(b.ok)) : [];
  });

  readonly titulo = computed(() => {
    const r = this.resultado();
    if (!r) return '';
    const que = this.recobro() ? 'recobro' : 'radicado';
    if (r.fallidos === 0) return `Se guardó el ${que} en ${r.exitosos === 1 ? 'la incapacidad' : 'las ' + r.exitosos + ' incapacidades'}.`;
    if (r.exitosos === 0) return `No se guardó el ${que} en ninguna incapacidad.`;
    return `Se guardó el ${que} en ${r.exitosos} de ${r.total} incapacidades; revise las que fallaron.`;
  });

  codigo(f: { codigo: string | null; incapacidad: { codigoOficina: string | null; codigoUnico: string } | null; incapacidadId: number }): string {
    return f.incapacidad?.codigoOficina || codigoSinGuion(f.codigo ?? f.incapacidad?.codigoUnico) || `#${f.incapacidadId}`;
  }
}
