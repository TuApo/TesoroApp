import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { Mosaico, SalaEnVivo } from '../../aula/sala-en-vivo';

/**
 * Quién está en el aula, la fila de manos levantadas (por orden de llegada) y, para quien
 * dirige, dar la palabra, silenciar, pasar a espectador o sacar.
 */
@Component({
  selector: 'app-aula-personas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    @if (manos().length) {
      <section class="pp-manos">
        <h4>✋ Manos levantadas</h4>
        @for (m of manos(); track m.identidad; let i = $index) {
          <div class="pp-fila">
            <span class="pp-orden">{{ i + 1 }}</span>
            <span class="pp-nombre">{{ m.nombre }}</span>
            @if (dirijo) {
              <button type="button" class="pp-btn pp-btn--ok" (click)="accion.emit({ tipo: 'palabra', identidad: m.identidad, rol: m.rol })">Dar la palabra</button>
            }
          </div>
        }
      </section>
    }
    <input class="pp-buscar" [value]="filtro()" (input)="filtro.set($any($event.target).value)" placeholder="Buscar persona…" aria-label="Buscar persona" />
    @for (g of grupos(); track g.titulo) {
      @if (g.personas.length) {
        <h4 class="pp-titulo">{{ g.titulo }} · {{ g.personas.length }}</h4>
        @for (m of g.personas; track m.identidad) {
          <div class="pp-fila">
            <span class="pp-avatar">{{ inicial(m.nombre) }}</span>
            <span class="pp-nombre">{{ m.nombre }}{{ m.local ? ' (tú)' : '' }}</span>
            <mat-icon class="pp-ico" [class.off]="!m.micActivo">{{ m.micActivo ? 'mic' : 'mic_off' }}</mat-icon>
            @if (dirijo && !m.local && m.rol !== 'ANFITRION') {
              <div class="pp-menu">
                @if (m.rol === 'ESPECTADOR') {
                  <button type="button" class="pp-mini" title="Dar la palabra" (click)="accion.emit({ tipo: 'palabra', identidad: m.identidad, rol: m.rol })"><mat-icon>record_voice_over</mat-icon></button>
                } @else {
                  <button type="button" class="pp-mini" title="Silenciar" (click)="accion.emit({ tipo: 'silenciar', identidad: m.identidad, rol: m.rol })"><mat-icon>volume_off</mat-icon></button>
                  <button type="button" class="pp-mini" title="Pasar a espectador" (click)="accion.emit({ tipo: 'espectador', identidad: m.identidad, rol: m.rol })"><mat-icon>visibility</mat-icon></button>
                }
                <button type="button" class="pp-mini" title="Poner en foco para todos" (click)="accion.emit({ tipo: 'foco', identidad: m.identidad, rol: m.rol })"><mat-icon>center_focus_strong</mat-icon></button>
                <button type="button" class="pp-mini pp-mini--peligro" title="Sacar del aula" (click)="accion.emit({ tipo: 'sacar', identidad: m.identidad, rol: m.rol })"><mat-icon>person_remove</mat-icon></button>
              </div>
            }
          </div>
        }
      }
    }
  `,
  styles: [`
    :host { display: block; overflow-y: auto; height: 100%; }
    h4 { margin: 10px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
    .pp-manos { background: var(--warn-bg); border: 1px solid var(--warn-border); border-radius: 12px; padding: 4px 10px 8px; margin-bottom: 8px; }
    .pp-manos h4 { color: var(--warn-fg); }
    .pp-buscar { width: 100%; box-sizing: border-box; font: 14px var(--font-sans); padding: 9px 12px; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text); }
    .pp-fila { display: flex; align-items: center; gap: 8px; padding: 5px 2px; border-radius: 8px; }
    .pp-fila:hover { background: var(--surface-3); }
    .pp-orden { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--warn-fg); color: #fff; font-size: 12px; font-weight: 800; }
    .pp-avatar { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--blue-soft); color: var(--brand-blue-strong); font: 800 13px var(--font-sans); flex: none; }
    .pp-nombre { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; }
    .pp-ico { font-size: 18px; width: 18px; height: 18px; color: var(--mt-done); }
    .pp-ico.off { color: var(--text-faint); }
    .pp-menu { display: flex; gap: 2px; }
    .pp-mini { width: 30px; min-width: 30px; min-height: 30px !important; border: 0; background: transparent; border-radius: 8px; cursor: pointer; color: var(--text-2); display: grid; place-items: center; }
    .pp-mini:hover { background: var(--surface-4); }
    .pp-mini mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pp-mini--peligro { color: var(--danger-fg); }
    .pp-btn { border: 0; border-radius: 999px; padding: 0 12px; min-height: 30px !important; font: 700 12px var(--font-sans); cursor: pointer; }
    .pp-btn--ok { background: var(--mt-accent); color: var(--mt-accent-ink); }
  `],
})
export class PanelPersonas {
  private readonly _mosaicos = signal<Mosaico[]>([]);
  @Input({ required: true }) sala!: SalaEnVivo;
  @Input() set mosaicos(v: Mosaico[]) { this._mosaicos.set(v ?? []); }
  @Input() dirijo = false;
  @Output() accion = new EventEmitter<{ tipo: 'palabra' | 'silenciar' | 'espectador' | 'sacar' | 'foco'; identidad: string; rol: string }>();
  readonly filtro = signal('');

  readonly manos = computed(() => this._mosaicos().filter(m => m.mano).sort((a, b) => (a.mano ?? 0) - (b.mano ?? 0)));
  readonly grupos = computed(() => {
    const f = this.filtro().trim().toLowerCase();
    const ms = this._mosaicos().filter(m => !f || m.nombre.toLowerCase().includes(f));
    return [
      { titulo: 'Dirigen', personas: ms.filter(m => m.rol === 'ANFITRION' || m.rol === 'COPRESENTADOR') },
      { titulo: 'Participan', personas: ms.filter(m => m.rol === 'PARTICIPANTE') },
      { titulo: 'Espectadores', personas: ms.filter(m => m.rol === 'ESPECTADOR') },
    ];
  });

  inicial(n: string): string { return (n?.trim()[0] ?? '?').toUpperCase(); }
}
