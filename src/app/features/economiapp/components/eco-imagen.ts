import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { DocViewerService } from '../../../shared/services/doc-viewer/doc-viewer.service';
import { tono } from '../economia.util';

interface Medio { url: string; video: boolean; }

/** Caché por documento: la misma foto sale en la rejilla, la ficha y el carrito. */
const cache = new Map<string, Promise<Medio | null>>();

/**
 * Foto (o video) de un producto o de una publicidad. Los archivos viven en ms-documents
 * detrás del gateway, que exige token, así que no sirve un `<img src>` directo: se bajan
 * con el JWT y se pintan como blob. El tipo real se saca del contenido, no del nombre: un
 * video de publicidad se reproduce solo, en silencio y en bucle, como en cualquier vitrina.
 *
 * <p>Sin archivo se pinta un fondo de color estable por nombre con el icono de su
 * categoría, en vez de un hueco gris: la rejilla sigue leyéndose como una tienda.
 */
@Component({
  selector: 'eco-imagen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    @if (medio(); as m) {
      @if (m.video) {
        <video [src]="m.url" autoplay muted loop playsinline preload="metadata" [attr.aria-label]="nombre()"></video>
      } @else {
        <img [src]="m.url" [alt]="nombre()" loading="lazy" decoding="async" />
      }
    } @else {
      <div class="vacia" [style.--h]="hue()">
        <mat-icon>{{ icono() }}</mat-icon>
      </div>
    }
  `,
  styles: [`
    :host { display:block; width:100%; height:100%; overflow:hidden; border-radius:inherit; }
    img, video { width:100%; height:100%; object-fit:cover; display:block; }
    .vacia {
      width:100%; height:100%; display:grid; place-items:center;
      background: linear-gradient(140deg, hsl(var(--h) 70% 92%), hsl(calc(var(--h) + 40) 60% 84%));
    }
    :host-context(html[data-theme='dark']) .vacia {
      background: linear-gradient(140deg, hsl(var(--h) 35% 24%), hsl(calc(var(--h) + 40) 30% 18%));
    }
    .vacia mat-icon {
      width:auto; height:auto; font-size: 44px;
      color: hsl(var(--h) 45% 38%); opacity:.85;
    }
    :host-context(html[data-theme='dark']) .vacia mat-icon { color: hsl(var(--h) 60% 72%); }
  `],
})
export class EcoImagen {
  private docs = inject(DocViewerService);

  readonly doc = input<string | null | undefined>(null);
  readonly nombre = input<string>('');
  readonly icono = input<string>('shopping_bag');

  readonly medio = signal<Medio | null>(null);
  readonly hue = signal(0);

  constructor() {
    effect(() => {
      const doc = this.doc();
      const nombre = this.nombre();
      untracked(() => {
        this.hue.set(tono(nombre));
        this.medio.set(null);
        if (!doc) return;
        // Las imágenes propias de la app (portadas de las vitrinas) se sirven desde public/.
        if (/^economiapp\//.test(doc)) { this.medio.set({ url: doc, video: false }); return; }
        const ruta = /^(https?:|blob:|data:|\/)/.test(doc) ? doc : `/api/v1/documents/${doc}/download`;
        if (!cache.has(ruta)) cache.set(ruta, this.cargar(ruta));
        cache.get(ruta)!.then(m => { if (this.doc() === doc) this.medio.set(m); });
      });
    });
  }

  private async cargar(ruta: string): Promise<Medio | null> {
    if (/^(blob:|data:)/.test(ruta)) return { url: ruta, video: ruta.startsWith('data:video') };
    if (!this.docs.isApiUrl(ruta)) return { url: this.docs.absolute(ruta), video: /\.(mp4|webm)(\?|$)/i.test(ruta) };
    const blob = await this.docs.fetchBlob(ruta);
    if (!blob) return null;
    const video = blob.type.startsWith('video/') || await esVideo(blob);
    return { url: URL.createObjectURL(video && !blob.type.startsWith('video/') ? new Blob([blob], { type: 'video/mp4' }) : blob), video };
  }
}

/** MP4 ("ftyp" en el byte 4) o WebM (EBML 1A45DFA3): el mime de la BD suele ser octet-stream. */
async function esVideo(blob: Blob): Promise<boolean> {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const ftyp = b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
  const ebml = b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  return ftyp || ebml;
}
