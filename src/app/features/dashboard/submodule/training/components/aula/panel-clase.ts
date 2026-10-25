import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AulasService, ClaseAula } from '../../service/aulas.service';
import { BloqueFicha } from '../bloque-ficha/bloque-ficha';
import { BloqueYoutube } from '../bloque-youtube/bloque-youtube';

/**
 * La clase del curso que acompaña el aula: su texto, fichas, videos de YouTube y enlaces. Quien
 * dirige puede "llevar a todos" a un bloque: el panel de cada quien salta a ese bloque.
 */
@Component({
  selector: 'app-aula-clase',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, BloqueFicha, BloqueYoutube],
  template: `
    @if (clase(); as c) {
      @if (c.leccion) { <h3 class="cl-titulo">{{ c.leccion }}</h3> }
      @for (b of c.bloques; track b.id) {
        <section class="cl-bloque" [id]="'cl-' + b.id" [class.actual]="b.id === bloqueActual">
          @if (dirijo) {
            <button type="button" class="cl-llevar" (click)="llevar.emit(b.id)" title="Llevar a todos a este bloque"><mat-icon>my_location</mat-icon></button>
          }
          @if (b.tipo !== 'TEXTO') { <h4><mat-icon>{{ icono(b.tipo) }}</mat-icon> {{ b.titulo }}</h4> }
          @switch (b.tipo) {
            @case ('TEXTO') { <div class="cl-html" [innerHTML]="b.contenido"></div> }
            @case ('FICHA') { <app-bloque-ficha [contenido]="b.contenido" /> }
            @case ('YOUTUBE') { <app-bloque-youtube [contenido]="b.contenido" /> }
            @case ('ENLACE') { <a [href]="b.recurso?.url" target="_blank" rel="noopener">{{ b.recurso?.url }}</a> }
            @case ('ACTIVIDAD') { <p class="cl-nota">Actividad del curso: se entrega desde el curso.</p> }
            @default { @if (b.descripcion) { <p class="cl-nota">{{ b.descripcion }}</p> } <p class="cl-nota">Material del curso ({{ b.tipo.toLowerCase() }}): quien dirige lo muestra compartiendo pantalla.</p> }
          }
        </section>
      } @empty {
        <p class="cl-vacio">Esta aula no tiene una clase del curso asociada.</p>
      }
    } @else {
      <p class="cl-vacio">Cargando la clase…</p>
    }
  `,
  styles: [`
    :host { display: block; overflow-y: auto; height: 100%; }
    .cl-titulo { margin: 0 0 8px; font-size: 17px; font-weight: 800; }
    .cl-bloque { position: relative; border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; margin-bottom: 10px; transition: border-color .2s, box-shadow .2s; }
    .cl-bloque.actual { border-color: var(--mt-accent-2); box-shadow: 0 0 0 3px rgb(140 213 10 / .25); }
    .cl-bloque h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: 14px; }
    .cl-bloque h4 mat-icon { color: var(--primary); font-size: 18px; width: 18px; height: 18px; }
    .cl-html { font-size: 14.5px; line-height: 1.6; overflow-wrap: anywhere; }
    .cl-llevar { position: absolute; top: 6px; right: 6px; width: 32px; min-height: 32px !important; border: 0; border-radius: 9px; background: var(--surface-3); color: var(--primary); cursor: pointer; display: grid; place-items: center; }
    .cl-nota { margin: 0; font-size: 13px; color: var(--muted); }
    .cl-vacio { color: var(--muted); font-size: 13px; text-align: center; padding: 20px 6px; }
  `],
})
export class PanelClase implements OnInit, OnChanges {
  @Input({ required: true }) aulaId!: string;
  @Input() dirijo = false;
  @Input() bloqueActual: string | null = null;
  @Output() llevar = new EventEmitter<string>();
  private api = inject(AulasService);
  readonly clase = signal<ClaseAula | null>(null);

  async ngOnInit(): Promise<void> {
    try { this.clase.set(await this.api.clase(this.aulaId)); } catch { this.clase.set({ leccion: null, bloques: [] }); }
    // Quien abre el panel tarde llega al bloque en el que va la clase.
    this.irAlActual('auto');
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['bloqueActual'] && !c['bloqueActual'].firstChange) this.irAlActual('smooth');
  }

  private irAlActual(behavior: ScrollBehavior): void {
    if (!this.bloqueActual) return;
    setTimeout(() => document.getElementById('cl-' + this.bloqueActual)?.scrollIntoView({ behavior, block: 'start' }), 50);
  }

  icono(t: string): string {
    return ({ FICHA: 'style', YOUTUBE: 'smart_display', ENLACE: 'link', ACTIVIDAD: 'assignment', VIDEO: 'play_circle', AUDIO: 'headphones' } as Record<string, string>)[t] ?? 'description';
  }
}
