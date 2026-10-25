import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, Subject, of } from 'rxjs';
import { catchError, debounceTime, switchMap } from 'rxjs/operators';

import { markdownToHtml } from '@/app/features/dashboard/submodule/nomina/pages/analitica-nomina-ia/markdown-lite';

export interface RespuestaResumenIa { texto?: string; modelo?: string; generado?: string; motivo?: string; }

/**
 * Tarjeta "Resumen con IA" (ms-hr → ms-ai, canal interno). Se regenera sola, con una pausa,
 * cuando cambia la `clave` (fecha + filtros); ms-hr guarda 15 min cada combinación, así que
 * volver a un filtro ya visto no vuelve a pagar la llamada.
 */
@Component({
  selector: 'app-resumen-ia',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <section class="ria" [class.plegado]="plegado()">
      <header>
        <span class="ria-ico"><mat-icon>auto_awesome</mat-icon></span>
        <div class="ria-tit">
          <b>{{ titulo() }}</b>
          <small>
            @if (cargando()) { Analizando las cifras… }
            @else if (generado()) { Generado {{ generado() }} · revise las cifras antes de compartir }
            @else { Lectura automática de lo que muestra la pantalla }
          </small>
        </div>
        <button mat-icon-button (click)="pedir()" [disabled]="cargando()" matTooltip="Volver a generar"><mat-icon>refresh</mat-icon></button>
        <button mat-icon-button (click)="plegado.set(!plegado())" [matTooltip]="plegado() ? 'Mostrar' : 'Ocultar'">
          <mat-icon>{{ plegado() ? 'expand_more' : 'expand_less' }}</mat-icon>
        </button>
      </header>
      @if (!plegado()) {
        @if (cargando() && !html()) {
          <div class="ria-esq"><i></i><i></i><i></i></div>
        } @else if (html()) {
          <div class="ria-txt" [class.atenuado]="cargando()" [innerHTML]="html()"></div>
        } @else if (motivo()) {
          <p class="ria-motivo"><mat-icon>info</mat-icon> {{ motivo() }}</p>
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .ria { position: relative; border-radius: 16px; padding: 14px 16px; background: var(--surface);
      border: 1px solid transparent; background-clip: padding-box; box-shadow: var(--shadow-sm); }
    .ria::before { content: ''; position: absolute; inset: -1px; z-index: -1; border-radius: 17px;
      background: linear-gradient(120deg, #2B59F0, #7C3AED 45%, #16A34A); }
    .ria { isolation: isolate; }
    .ria::after { content: ''; position: absolute; inset: 0; z-index: -1; border-radius: 16px; background: var(--surface); }
    header { display: flex; align-items: center; gap: 10px; }
    .ria-ico { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: #fff;
      background: linear-gradient(135deg, #2B59F0, #7C3AED); flex: none; }
    .ria-ico mat-icon { font-size: 19px; width: 19px; height: 19px; }
    .ria-tit { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .ria-tit b { font: 800 .95rem var(--font-sans); color: var(--text); }
    .ria-tit small { font-size: .74rem; color: var(--text-2); }
    .ria-txt { margin-top: 10px; font-size: .9rem; line-height: 1.55; color: var(--text); transition: opacity .2s; }
    .ria-txt.atenuado { opacity: .5; }
    .ria-txt ::ng-deep p { margin: 0 0 6px; }
    .ria-txt ::ng-deep ul { margin: 4px 0 0; padding-left: 20px; }
    .ria-txt ::ng-deep li { margin: 3px 0; }
    .ria-txt ::ng-deep strong { color: var(--text); }
    .ria-esq { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
    .ria-esq i { height: 11px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2));
      background-size: 200% 100%; animation: ria-brillo 1.2s infinite linear; }
    .ria-esq i:nth-child(2) { width: 85%; }
    .ria-esq i:nth-child(3) { width: 60%; }
    @keyframes ria-brillo { to { background-position: -200% 0; } }
    .ria-motivo { margin: 10px 0 0; display: flex; align-items: center; gap: 6px; font-size: .84rem; color: var(--text-2); }
    .ria-motivo mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `],
})
export class ResumenIaComponent {
  readonly titulo = input('Resumen con IA');
  /** Cambia con la fecha y los filtros: dispara un resumen nuevo. */
  readonly clave = input.required<string>();
  readonly fuente = input.required<() => Observable<RespuestaResumenIa>>();

  readonly cargando = signal(false);
  readonly html = signal<string | null>(null);
  readonly motivo = signal<string | null>(null);
  readonly generado = signal<string | null>(null);
  readonly plegado = signal(false);
  private readonly pedido$ = new Subject<number>();

  constructor() {
    this.pedido$.pipe(
      debounceTime(1200),
      switchMap(() => {
        this.cargando.set(true);
        return untracked(() => this.fuente())().pipe(catchError(() => of({ motivo: 'No se pudo generar el resumen.' } as RespuestaResumenIa)));
      }),
      takeUntilDestroyed(inject(DestroyRef)),
    ).subscribe((r) => {
      this.cargando.set(false);
      if (r.texto) {
        this.html.set(markdownToHtml(r.texto));
        this.motivo.set(null);
        this.generado.set(r.generado ? r.generado.slice(11, 16) : null);
      } else {
        this.html.set(null);
        this.motivo.set(r.motivo ?? 'Sin resumen.');
      }
    });
    effect(() => {
      this.clave();
      untracked(() => this.pedido$.next(Date.now()));
    });
  }

  pedir(): void {
    this.pedido$.next(Date.now());
  }
}
