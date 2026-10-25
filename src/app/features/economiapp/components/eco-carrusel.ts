import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, effect, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { EcoImagen } from './eco-imagen';

export interface Diapositiva {
  id: string;
  titulo: string | null;
  subtitulo?: string | null;
  /** Foto o video de ms-documents. Sin él se pinta el degradado con el icono. */
  doc?: string | null;
  /** Degradado de respaldo (banners automáticos) y color de marca. */
  fondo?: string;
  icono?: string;
  cta?: string | null;
  etiqueta?: string | null;
}

/**
 * Carrusel de la portada. En el celular se desliza con el dedo (scroll-snap nativo: no hay
 * librería ni gestos a mano); en el computador tiene flechas. Avanza solo cada 6 s, y se
 * detiene mientras la persona lo toca o tiene el puntero encima — un banner que se va
 * justo cuando uno lo iba a leer es la queja número uno de estas vitrinas.
 *
 * <p>Medida de la pieza: 1600 × 800 px (2:1). El contenedor respeta esa proporción en todos
 * los tamaños, así que lo que se diseña es lo que se ve.
 */
@Component({
  selector: 'eco-carrusel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, EcoImagen],
  template: `
    <div class="marco" (mouseenter)="pausa.set(true)" (mouseleave)="pausa.set(false)"
         (touchstart)="pausa.set(true)" (touchend)="reanudarLuego()">
      <div class="pista" #pista (scroll)="alDesplazar()" role="region" aria-roledescription="carrusel" aria-label="Promociones">
        @for (d of diapositivas(); track d.id; let i = $index) {
          <button type="button" class="slide" [style.background]="d.fondo" (click)="abrir.emit(d)"
                  [attr.aria-label]="d.titulo" [attr.aria-hidden]="i !== actual()">
            @if (d.doc) { <eco-imagen class="media" [doc]="d.doc" [nombre]="d.titulo || ''" [icono]="d.icono || 'local_offer'" /> }
            @else if (d.icono) { <mat-icon class="deco">{{ d.icono }}</mat-icon> }
            @if (d.titulo || d.subtitulo || d.cta) {
              <span class="texto" [class.sobre-media]="!!d.doc">
                @if (d.etiqueta) { <i class="etq">{{ d.etiqueta }}</i> }
                @if (d.titulo) { <b>{{ d.titulo }}</b> }
                @if (d.subtitulo) { <small>{{ d.subtitulo }}</small> }
                @if (d.cta) { <span class="cta">{{ d.cta }} <mat-icon>arrow_forward</mat-icon></span> }
              </span>
            }
          </button>
        }
      </div>
      @if (diapositivas().length > 1) {
        <button type="button" class="flecha izq" (click)="ir(actual() - 1)" aria-label="Anterior"><mat-icon>chevron_left</mat-icon></button>
        <button type="button" class="flecha der" (click)="ir(actual() + 1)" aria-label="Siguiente"><mat-icon>chevron_right</mat-icon></button>
        <div class="puntos">
          @for (d of diapositivas(); track d.id; let i = $index) {
            <button type="button" [class.activo]="i === actual()" (click)="ir(i)" [attr.aria-label]="'Ir a la ' + (i + 1)"></button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display:block; }
    .marco { position:relative; border-radius:24px; overflow:hidden; aspect-ratio: 2 / 1; background: var(--surface-3); }
    .pista { display:flex; height:100%; overflow-x:auto; scroll-snap-type:x mandatory; scrollbar-width:none; }
    .pista::-webkit-scrollbar { display:none; }
    .slide { position:relative; flex:0 0 100%; height:100%; scroll-snap-align:start; border:0; padding:0; margin:0; cursor:pointer;
      color:#fff; text-align:left; font:inherit; overflow:hidden; min-height:0; }
    .media { position:absolute; inset:0; }
    .deco { position:absolute; right:6%; top:50%; transform:translateY(-50%) rotate(-12deg); font-size:min(34vw, 220px); width:auto; height:auto; opacity:.22; }
    .texto { position:absolute; left:0; right:0; bottom:0; padding: clamp(14px, 3vw, 32px); display:flex; flex-direction:column; gap:6px; max-width: 70%; }
    .texto.sobre-media { max-width:none; background: linear-gradient(0deg, rgba(0,0,0,.62), transparent); padding-top: 48px; }
    .etq { align-self:flex-start; font-style:normal; font-size:12px; font-weight:800; padding:3px 10px; border-radius:999px; background:rgba(255,255,255,.22); backdrop-filter: blur(6px); }
    .texto b { font-size: clamp(19px, 3vw, 34px); font-weight:800; line-height:1.1; letter-spacing:-.02em; text-shadow: 0 2px 12px rgba(0,0,0,.18); }
    .texto small { font-size: clamp(12.5px, 1.4vw, 16px); opacity:.95; line-height:1.35; }
    .cta { align-self:flex-start; display:inline-flex; align-items:center; gap:6px; margin-top:4px; padding:8px 14px; border-radius:999px; background:#fff; color:#0F1B2D; font-weight:800; font-size:13.5px; }
    .cta mat-icon { font-size:18px; width:18px; height:18px; }
    .flecha { position:absolute; top:50%; transform:translateY(-50%); width:40px; height:40px; min-height:40px; border-radius:999px; border:0;
      background: rgba(255,255,255,.9); color:#0F1B2D; display:grid; place-items:center; cursor:pointer; box-shadow: 0 6px 16px rgba(0,0,0,.18); opacity:0; transition: opacity .15s; }
    .marco:hover .flecha { opacity:1; }
    .izq { left:12px; } .der { right:12px; }
    .puntos { position:absolute; left:0; right:0; bottom:10px; display:flex; justify-content:center; gap:6px; pointer-events:none; }
    .puntos button { pointer-events:auto; width:8px; height:8px !important; min-height:0 !important; min-width:0; padding:0; flex:none; border-radius:999px; border:0; background:rgba(255,255,255,.55); cursor:pointer; transition: width .2s; }
    .puntos button.activo { width:22px; background:#fff; }
    @media (max-width: 600px) {
      .marco { border-radius:18px; }
      .flecha { display:none; }
      .texto { max-width: 82%; }
    }
  `],
})
export class EcoCarrusel implements OnDestroy {
  readonly diapositivas = input<Diapositiva[]>([]);
  readonly abrir = output<Diapositiva>();

  private readonly pista = viewChild<ElementRef<HTMLElement>>('pista');
  readonly actual = signal(0);
  readonly pausa = signal(false);
  private reloj: ReturnType<typeof setInterval> | null = null;
  private reanudar: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const n = this.diapositivas().length;
      untracked(() => {
        if (this.reloj) clearInterval(this.reloj);
        this.reloj = null;
        if (n > 1) {
          this.reloj = setInterval(() => {
            if (this.pausa() || document.hidden) return;
            this.ir(this.actual() + 1);
          }, 6000);
        }
      });
    });
  }

  ngOnDestroy(): void {
    if (this.reloj) clearInterval(this.reloj);
    if (this.reanudar) clearTimeout(this.reanudar);
  }

  ir(i: number): void {
    const el = this.pista()?.nativeElement;
    const n = this.diapositivas().length;
    if (!el || !n) return;
    const destino = (i + n) % n;
    el.scrollTo({ left: destino * el.clientWidth, behavior: 'smooth' });
    this.actual.set(destino);
  }

  alDesplazar(): void {
    const el = this.pista()?.nativeElement;
    if (!el || !el.clientWidth) return;
    this.actual.set(Math.round(el.scrollLeft / el.clientWidth));
  }

  reanudarLuego(): void {
    if (this.reanudar) clearTimeout(this.reanudar);
    this.reanudar = setTimeout(() => this.pausa.set(false), 4000);
  }
}
