import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

interface Tarjeta { frente: string; reverso: string; }

/**
 * Fichas de repaso: una tarjeta a la vez, se voltea tocándola. Para repasar antes del quiz,
 * en el celular, con el pulgar: por eso las flechas son grandes y la tarjeta ocupa el ancho.
 */
@Component({
  selector: 'app-bloque-ficha',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    @if (tarjetas().length) {
      <div class="bf">
        <button type="button" class="bf-tarjeta" [class.volteada]="volteada()" (click)="volteada.set(!volteada())"
                [attr.aria-label]="volteada() ? 'Ver la pregunta' : 'Ver la respuesta'">
          <span class="bf-cara bf-frente">
            <em>Pregunta · {{ indice() + 1 }} de {{ tarjetas().length }}</em>
            <strong>{{ actual().frente }}</strong>
            <small><mat-icon>touch_app</mat-icon> Toca para ver la respuesta</small>
          </span>
          <span class="bf-cara bf-reverso">
            <em>Respuesta</em>
            <strong>{{ actual().reverso }}</strong>
          </span>
        </button>
        <div class="bf-nav">
          <button type="button" (click)="mover(-1)" [disabled]="indice() === 0" aria-label="Anterior"><mat-icon>chevron_left</mat-icon></button>
          <span class="bf-puntos">
            @for (t of tarjetas(); track $index) { <i [class.activa]="$index === indice()"></i> }
          </span>
          <button type="button" (click)="mover(1)" [disabled]="indice() === tarjetas().length - 1" aria-label="Siguiente"><mat-icon>chevron_right</mat-icon></button>
        </div>
      </div>
    }
  `,
  styles: [`
    .bf { display: grid; gap: 10px; }
    .bf-tarjeta { all: unset; box-sizing: border-box; cursor: pointer; display: grid; min-height: 190px !important; perspective: 1200px; }
    .bf-cara { grid-area: 1 / 1; display: grid; align-content: center; gap: 10px; text-align: center; padding: 22px; border-radius: 18px;
      backface-visibility: hidden; transition: transform .45s cubic-bezier(.2,.8,.2,1); }
    .bf-frente { background: var(--mt-hero); color: #fff; }
    .bf-reverso { background: var(--mt-accent-soft); color: var(--mt-accent-ink); transform: rotateY(180deg); }
    html[data-theme='dark'] .bf-reverso { background: rgb(140 213 10 / .16); color: var(--text); }
    .volteada .bf-frente { transform: rotateY(180deg); }
    .volteada .bf-reverso { transform: rotateY(360deg); }
    .bf-cara em { font-style: normal; font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; opacity: .75; }
    .bf-cara strong { font-size: clamp(16px, 2.2vw, 20px); line-height: 1.4; }
    .bf-cara small { display: inline-flex; gap: 4px; align-items: center; justify-content: center; opacity: .7; font-size: 12px; }
    .bf-cara small mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .bf-nav { display: flex; align-items: center; justify-content: center; gap: 12px; }
    .bf-nav button { width: 44px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; display: grid; place-items: center; }
    .bf-nav button:disabled { opacity: .4; cursor: default; }
    .bf-puntos { display: flex; gap: 5px; flex-wrap: wrap; justify-content: center; max-width: 60%; }
    .bf-puntos i { width: 7px; height: 7px; border-radius: 50%; background: var(--surface-4); }
    .bf-puntos i.activa { background: var(--primary); }
  `],
})
export class BloqueFicha {
  private readonly datos = signal<Tarjeta[]>([]);
  readonly indice = signal(0);
  readonly volteada = signal(false);
  readonly tarjetas = computed(() => this.datos());
  readonly actual = computed(() => this.tarjetas()[this.indice()] ?? { frente: '', reverso: '' });

  /** El contenido del bloque FICHA: JSON {tarjetas:[{frente, reverso}]} (o ya la lista). */
  @Input() set contenido(v: string | Tarjeta[] | null | undefined) {
    let lista: Tarjeta[] = [];
    try {
      const d = typeof v === 'string' ? JSON.parse(v) : v;
      lista = (Array.isArray(d) ? d : d?.tarjetas ?? []).filter((t: Tarjeta) => t?.frente);
    } catch { lista = []; }
    this.datos.set(lista);
    this.indice.set(0);
    this.volteada.set(false);
  }

  mover(d: number): void {
    const i = Math.max(0, Math.min(this.tarjetas().length - 1, this.indice() + d));
    this.indice.set(i);
    this.volteada.set(false);
  }
}
