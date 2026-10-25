import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import Swal from 'sweetalert2';
import { EtiquetaCelebracion } from '../../../../components/celebracion/celebracion.models';
import { CelebracionService } from '../../../../components/celebracion/celebracion.service';

/**
 * El catálogo de etiquetas que el equipo elige para describir a quien cumple. Cada una
 * trae cómo se ve para la IA (en inglés): es lo único que viaja a Higgsfield.
 */
@Component({
  selector: 'app-cumpleanos-etiquetas',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="et-cab">
      <div>
        <h3>Etiquetas para describir a los cumpleañeros</h3>
        <p class="sub">El equipo elige hasta 6 desde el enlace de cada persona. Cada etiqueta lleva cómo se ve para la IA (en
          inglés): es lo único que se envía a Higgsfield, nunca nombres ni mensajes.</p>
      </div>
      <button type="button" class="btn btn--fantasma" (click)="nueva()"><mat-icon>add</mat-icon> Nueva etiqueta</button>
    </header>
    @for (c of grupos(); track c.nombre) {
      <div class="et-grupo">
        <span class="et-grupo__t">{{ c.nombre }}</span>
        <div class="et-chips">
          @for (e of c.etiquetas; track e.id) {
            <button type="button" class="et-chip" [class.et-chip--off]="!e.activo" (click)="editar(e)" [title]="e.prompt_visual || ''">
              {{ e.emoji }} {{ e.nombre }}</button>
          }
        </div>
      </div>
    }
    @if (form(); as f) {
      <div class="telon" (click)="form.set(null)">
        <form class="panel" (click)="$event.stopPropagation()" (ngSubmit)="guardar()">
          <h3>{{ f.id ? 'Editar etiqueta' : 'Nueva etiqueta' }}</h3>
          <div class="fila">
            <label class="campo"><span>Nombre</span>
              <input name="n" [ngModel]="f.nombre" (ngModelChange)="campo('nombre', $event)" maxlength="60" required placeholder="Salsa" /></label>
            <label class="campo"><span>Emoji</span>
              <input name="e" [ngModel]="f.emoji" (ngModelChange)="campo('emoji', $event)" maxlength="16" placeholder="💃" /></label>
          </div>
          <label class="campo"><span>Categoría</span>
            <input name="c" [ngModel]="f.categoria" (ngModelChange)="campo('categoria', $event)" maxlength="40" list="et-categorias" />
            <datalist id="et-categorias">@for (c of grupos(); track c.nombre) { <option [value]="c.nombre"></option> }</datalist></label>
          <label class="campo"><span>Cómo se ve para la IA <em>(en inglés, sin personas ni texto)</em></span>
            <textarea name="p" rows="2" [ngModel]="f.prompt_visual" (ngModelChange)="campo('prompt_visual', $event)" maxlength="300"
                      placeholder="a shiny trumpet and colorful salsa dance lights"></textarea></label>
          <label class="check"><input type="checkbox" name="a" [ngModel]="f.activo" (ngModelChange)="campo('activo', $event)" /> Activa (el equipo la puede elegir)</label>
          <div class="pie">
            <button type="button" class="btn btn--fantasma" (click)="form.set(null)">Cancelar</button>
            <button type="submit" class="btn btn--primario" [disabled]="!f.nombre || !f.prompt_visual || guardando()">Guardar</button>
          </div>
        </form>
      </div>
    }
  `,
  styleUrls: ['../banners/pestanas-banners.css'],
  styles: [`
    .et-cab { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
    .et-cab h3 { margin: 0 0 4px; font-size: 1.02rem; }
    .et-grupo { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
    .et-grupo__t { font-size: .72rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
    .et-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .et-chip { min-height: 34px !important; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface);
      color: var(--text); font: inherit; font-size: .84rem; font-weight: 600; cursor: pointer; }
    .et-chip:hover { border-color: #e0245e; }
    .et-chip--off { opacity: .45; text-decoration: line-through; }
  `],
})
export class CumpleanosEtiquetasComponent implements OnInit {
  private readonly api = inject(CelebracionService);
  readonly lista = signal<EtiquetaCelebracion[]>([]);
  readonly form = signal<Partial<EtiquetaCelebracion> | null>(null);
  readonly guardando = signal(false);

  readonly grupos = computed(() => {
    const g = new Map<string, EtiquetaCelebracion[]>();
    for (const e of this.lista()) g.set(e.categoria, [...(g.get(e.categoria) ?? []), e]);
    return [...g.entries()].map(([nombre, etiquetas]) => ({ nombre, etiquetas }));
  });

  ngOnInit(): void { this.cargar(); }

  private cargar(): void {
    this.api.etiquetas().subscribe({ next: (l) => this.lista.set(l), error: () => undefined });
  }

  nueva(): void { this.form.set({ nombre: '', emoji: '', categoria: 'Pasatiempos', prompt_visual: '', activo: true }); }
  editar(e: EtiquetaCelebracion): void { this.form.set({ ...e }); }

  campo<K extends keyof EtiquetaCelebracion>(k: K, v: EtiquetaCelebracion[K]): void {
    this.form.update((f) => (f ? { ...f, [k]: v } : f));
  }

  guardar(): void {
    const f = this.form();
    if (!f) return;
    this.guardando.set(true);
    const cuerpo = { nombre: f.nombre, emoji: f.emoji, categoria: f.categoria, prompt_visual: f.prompt_visual, activo: f.activo };
    (f.id ? this.api.editarEtiqueta(f.id, cuerpo) : this.api.crearEtiqueta(cuerpo)).subscribe({
      next: () => { this.guardando.set(false); this.form.set(null); this.cargar(); },
      error: (e: HttpErrorResponse) => { this.guardando.set(false); Swal.fire('No se pudo guardar', e.error?.error || '', 'error'); },
    });
  }
}
