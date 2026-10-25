import {
  ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { DocViewerService } from '../../services/doc-viewer/doc-viewer.service';

/** Caché por ruta: la misma foto sale en la tabla, la caja y la ficha. */
const cache = new Map<string, Promise<string | null>>();

/** Ruta descargable de un doc: id suelto de ms-documents, ruta del API o URL ya resuelta. */
export function rutaDoc(doc: string): string {
  return /^(https?:|blob:|data:|\/)/.test(doc) ? doc : `/api/v1/documents/${doc}/download`;
}

/**
 * Foto pequeña que se reconoce en la celda y que, al tocarla, se ve grande encima de todo
 * (con flechas si hay varias). Las fotos viven en ms-documents detrás del gateway, que
 * exige token: se bajan con el JWT y se pintan como blob.
 *
 * <p>Uso: `<app-imagen-ampliable [doc]="docId" [nombre]="producto" />` o con varias fotos
 * `[docs]="[...]"`. `tamano` es el lado de la miniatura en px (por defecto 56).
 */
@Component({
  selector: 'app-imagen-ampliable',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <button type="button" class="ia-mini" [style.--lado.px]="tamano()"
            [class.ia-mini--vacia]="!url()" [disabled]="!url()"
            [attr.aria-label]="url() ? 'Ver foto de ' + nombre() : 'Sin foto'"
            (click)="abrir($event)">
      @if (url(); as u) {
        <img [src]="u" [alt]="nombre()" loading="lazy" decoding="async" />
      } @else {
        <mat-icon>{{ cargando() ? 'hourglass_empty' : icono() }}</mat-icon>
      }
      @if (todas().length > 1) { <span class="ia-cuenta">{{ todas().length }}</span> }
    </button>

    @if (abierta()) {
      <div class="ia-velo" role="dialog" aria-modal="true" [attr.aria-label]="nombre()" (click)="cerrar()">
        <figure class="ia-figura" (click)="$event.stopPropagation()">
          @if (urlGrande(); as g) { <img [src]="g" [alt]="nombre()" /> }
          @else { <mat-icon class="ia-cargando">hourglass_empty</mat-icon> }
          @if (nombre()) { <figcaption>{{ nombre() }}@if (todas().length > 1) { · {{ indice() + 1 }} de {{ todas().length }} }</figcaption> }
        </figure>
        @if (todas().length > 1) {
          <button type="button" class="ia-flecha ia-flecha--izq" aria-label="Anterior" (click)="mover(-1, $event)"><mat-icon>chevron_left</mat-icon></button>
          <button type="button" class="ia-flecha ia-flecha--der" aria-label="Siguiente" (click)="mover(1, $event)"><mat-icon>chevron_right</mat-icon></button>
        }
        <button type="button" class="ia-cerrar" aria-label="Cerrar" (click)="cerrar()"><mat-icon>close</mat-icon></button>
      </div>
    }
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
    .ia-mini {
      position: relative; width: var(--lado, 56px); height: var(--lado, 56px);
      min-height: 0 !important; min-width: 0; padding: 0; flex: none;
      border-radius: 10px; overflow: hidden; cursor: zoom-in;
      border: 1px solid var(--border, rgba(127,127,127,.25));
      background: var(--surface-2, rgba(127,127,127,.08));
      display: grid; place-items: center;
    }
    .ia-mini img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ia-mini--vacia { cursor: default; opacity: .7; }
    .ia-mini mat-icon { opacity: .55; }
    .ia-cuenta {
      position: absolute; right: 3px; bottom: 3px; font-size: 10px; line-height: 1;
      padding: 2px 4px; border-radius: 6px; background: rgba(0,0,0,.6); color: #fff;
    }
    .ia-velo {
      position: fixed; inset: 0; z-index: 10000; background: rgba(5, 8, 15, .86);
      display: grid; place-items: center; padding: 16px; cursor: zoom-out;
      animation: ia-entra .15s ease-out;
    }
    @keyframes ia-entra { from { opacity: 0; } to { opacity: 1; } }
    .ia-figura { margin: 0; display: grid; gap: 10px; justify-items: center; cursor: default; max-width: 100%; }
    .ia-figura img {
      max-width: min(92vw, 1100px); max-height: 80vh; object-fit: contain;
      border-radius: 12px; background: #fff; box-shadow: 0 20px 60px rgba(0,0,0,.5);
    }
    .ia-figura figcaption { color: #e5e7eb; font-size: 15px; text-align: center; }
    .ia-cargando { color: #fff; font-size: 40px; width: 40px; height: 40px; }
    .ia-cerrar, .ia-flecha {
      position: fixed; border: 0; border-radius: 999px; width: 52px; height: 52px; min-height: 0 !important;
      display: grid; place-items: center; cursor: pointer; background: rgba(255,255,255,.14); color: #fff;
    }
    .ia-cerrar:hover, .ia-flecha:hover { background: rgba(255,255,255,.26); }
    .ia-cerrar { top: 16px; right: 16px; }
    .ia-flecha { top: 50%; transform: translateY(-50%); }
    .ia-flecha--izq { left: 12px; }
    .ia-flecha--der { right: 12px; }
  `],
})
export class ImagenAmpliableComponent {
  private docs = inject(DocViewerService);

  readonly doc = input<string | null | undefined>(null);
  readonly docs$ = input<Array<string | null | undefined> | null>(null, { alias: 'docs' });
  readonly nombre = input<string>('');
  readonly icono = input<string>('image');
  readonly tamano = input<number>(56);

  /** Todas las fotos: la de `doc` primero y luego las de `docs`, sin repetir. */
  readonly todas = computed(() => {
    const lista = [this.doc(), ...(this.docs$() ?? [])].filter((d): d is string => !!d);
    return [...new Set(lista)];
  });

  readonly url = signal<string | null>(null);
  readonly cargando = signal(false);
  readonly abierta = signal(false);
  readonly indice = signal(0);
  readonly urlGrande = signal<string | null>(null);

  constructor() {
    effect(() => {
      const primera = this.todas()[0];
      untracked(() => {
        this.url.set(null);
        if (!primera) return;
        this.cargando.set(true);
        this.cargar(primera).then(u => {
          if (this.todas()[0] === primera) { this.url.set(u); this.cargando.set(false); }
        });
      });
    });
  }

  abrir(ev: Event): void {
    ev.stopPropagation();
    if (!this.url()) return;
    this.indice.set(0);
    this.urlGrande.set(this.url());
    this.abierta.set(true);
  }

  cerrar(): void { this.abierta.set(false); }

  mover(paso: number, ev: Event): void {
    ev.stopPropagation();
    const n = this.todas().length;
    const i = (this.indice() + paso + n) % n;
    this.indice.set(i);
    this.urlGrande.set(null);
    const doc = this.todas()[i];
    this.cargar(doc).then(u => { if (this.todas()[this.indice()] === doc) this.urlGrande.set(u); });
  }

  @HostListener('document:keydown', ['$event'])
  tecla(ev: KeyboardEvent): void {
    if (!this.abierta()) return;
    if (ev.key === 'Escape') this.cerrar();
    else if (ev.key === 'ArrowRight' && this.todas().length > 1) this.mover(1, ev);
    else if (ev.key === 'ArrowLeft' && this.todas().length > 1) this.mover(-1, ev);
  }

  private cargar(doc: string): Promise<string | null> {
    const ruta = rutaDoc(doc);
    if (!cache.has(ruta)) {
      cache.set(ruta, this.docs.toBlobUrl(ruta).catch(() => null).then(u => {
        if (!u) cache.delete(ruta);
        return u;
      }));
    }
    return cache.get(ruta)!;
  }
}
