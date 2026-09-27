import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Clasificacion } from '../../service/turnos.service';

/**
 * Cierre de un turno con clasificación y nota. Finalizar exige las dos cosas (el
 * backend también lo valida): así queda claro CÓMO terminó cada atención. Lo usan el
 * panel colgante y la atención remota; el mismo formulario en los dos sitios.
 */
@Component({
  selector: 'app-cierre-turno',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cierre-turno" role="group" aria-label="Finalizar atención">
      <div class="cierre-turno__cab">
        <mat-icon>task_alt</mat-icon>
        <span>¿Cómo terminó la atención{{ codigo() ? ' de ' + codigo() : '' }}?</span>
      </div>
      @if (!clasificaciones().length) {
        <p class="cierre-turno__vacio">No hay clasificaciones activas: un administrador debe crearlas en Control Oficina.</p>
      }
      <div class="cierre-turno__chips" role="radiogroup" aria-label="Clasificación">
        @for (c of clasificaciones(); track c.id) {
          <button type="button" class="cierre-turno__chip" role="radio" [attr.aria-checked]="elegida() === c.clave"
                  [class.cierre-turno__chip--on]="elegida() === c.clave" [style.--c]="c.color || 'var(--brand-blue)'"
                  [title]="c.descripcion || c.nombre" (click)="elegida.set(c.clave)">
            @if (c.icono) { <mat-icon>{{ c.icono }}</mat-icon> }
            {{ c.nombre }}
          </button>
        }
      </div>
      @if (descripcionElegida(); as d) { <p class="cierre-turno__ayuda">{{ d }}</p> }
      <textarea class="cierre-turno__nota" rows="2" [ngModel]="nota()" (ngModelChange)="nota.set($event)"
                placeholder="Nota obligatoria: qué se hizo, qué queda pendiente…" aria-label="Nota de cierre"
                (keydown.control.enter)="confirmar()" (keydown.meta.enter)="confirmar()"></textarea>
      <div class="cierre-turno__acciones">
        <span class="cierre-turno__falta">{{ falta() || '' }}</span>
        <button type="button" class="tn-boton tn-boton--fantasma" (click)="cancelar.emit()" [disabled]="ocupado()">Volver</button>
        <button type="button" class="tn-boton tn-boton--exito" (click)="confirmar()" [disabled]="ocupado() || !!falta()">
          <mat-icon>task_alt</mat-icon> Finalizar
        </button>
      </div>
    </div>
  `,
  styles: [`
    .cierre-turno { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2, var(--surface)); }
    .cierre-turno__cab { display: flex; align-items: center; gap: 6px; font-weight: 800; font-size: 13px; color: var(--text); }
    .cierre-turno__cab mat-icon { color: var(--success); font-size: 18px; width: 18px; height: 18px; }
    .cierre-turno__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .cierre-turno__chip { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--c) 45%, var(--border)); background: color-mix(in srgb, var(--c) 8%, var(--surface)); color: var(--text); font: 600 12px var(--font-sans); cursor: pointer; transition: transform .08s ease, background .12s ease; }
    .cierre-turno__chip mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--c); }
    .cierre-turno__chip:hover { background: color-mix(in srgb, var(--c) 18%, var(--surface)); }
    .cierre-turno__chip--on { background: var(--c); border-color: var(--c); color: #fff; box-shadow: 0 4px 12px -6px var(--c); }
    .cierre-turno__chip--on mat-icon { color: #fff; }
    .cierre-turno__ayuda, .cierre-turno__vacio { margin: 0; font-size: 12px; color: var(--muted); }
    .cierre-turno__nota { width: 100%; box-sizing: border-box; resize: vertical; min-height: 44px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font: 500 13px var(--font-sans); }
    .cierre-turno__nota:focus { outline: 2px solid color-mix(in srgb, var(--brand-blue) 40%, transparent); border-color: var(--brand-blue); }
    .cierre-turno__acciones { display: flex; align-items: center; gap: 8px; }
    .cierre-turno__falta { flex: 1; min-width: 0; font-size: 12px; color: var(--warning); }
  `],
})
export class CierreTurno {
  /** Catálogo activo (lo carga quien usa el componente). */
  readonly clasificaciones = input<Clasificacion[]>([]);
  readonly codigo = input<string | null>(null);
  readonly ocupado = input(false);
  /** Nota inicial (p. ej. el resumen de la atención remota). */
  readonly notaInicial = input<string>('');

  readonly confirmar$ = output<{ clasificacion: string; nota: string }>();
  readonly cancelar = output<void>();

  readonly elegida = signal<string>('');
  readonly nota = signal<string>('');

  readonly descripcionElegida = computed(() => this.clasificaciones().find(c => c.clave === this.elegida())?.descripcion ?? null);
  /** Lo que falta para poder finalizar (misma regla que el backend). */
  readonly falta = computed(() => {
    const sinClasificacion = !this.elegida();
    const sinNota = this.nota().trim().length < 3;
    if (sinClasificacion && sinNota) return 'Elija cómo terminó y deje una nota';
    if (sinClasificacion) return 'Elija cómo terminó la atención';
    if (sinNota) return 'Deje una nota de lo que se hizo';
    return null;
  });

  constructor() {
    effect(() => { const n = this.notaInicial(); if (n && !this.nota()) this.nota.set(n); });
  }

  confirmar(): void {
    if (this.falta()) return;
    this.confirmar$.emit({ clasificacion: this.elegida(), nota: this.nota().trim() });
  }
}
