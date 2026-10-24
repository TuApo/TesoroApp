import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';

import { environment } from '@/environments/environment';
import { urlApi } from '../../services/seguridad.service';

/**
 * `<img>` para capturas protegidas. Un `<img src>` no lleva el JWT, así que las URLs de la
 * API autenticada (`/api/v1/seguridad/...`) se piden por HttpClient como Blob y se pintan
 * con un `blob:` que se libera al cambiar o al salir. Las públicas y las de otros orígenes
 * van directo.
 */
@Component({
  selector: 'sg-imagen',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (url(); as u) {
      <img [src]="u" [alt]="alt()" [style.object-fit]="ajuste()" (load)="cargada.emit()" loading="lazy" decoding="async" />
    } @else if (fallo()) {
      <span class="vacio" [attr.aria-label]="alt() || 'Sin imagen'"><mat-icon aria-hidden="true">image_not_supported</mat-icon></span>
    } @else if (src()) {
      <span class="vacio cargando" aria-hidden="true"></span>
    } @else {
      <span class="vacio" [attr.aria-label]="alt() || 'Sin imagen'"><mat-icon aria-hidden="true">{{ iconoVacio() }}</mat-icon></span>
    }
  `,
  styles: [`
    :host { display: block; position: relative; overflow: hidden; background: var(--surface-3); }
    img { display: block; width: 100%; height: 100%; }
    .vacio { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-faint); }
    .vacio mat-icon { font-size: 28px; width: 28px; height: 28px; }
    .cargando { background: linear-gradient(90deg, var(--surface-3), var(--surface-2), var(--surface-3)); background-size: 200% 100%; animation: brillo 1.2s infinite linear; }
    @keyframes brillo { from { background-position: 200% 0; } to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .cargando { animation: none; } }
  `],
})
export class SgImagen {
  private readonly http = inject(HttpClient);
  readonly src = input<string | null | undefined>(null);
  readonly alt = input('');
  readonly ajuste = input<'cover' | 'contain'>('cover');
  readonly iconoVacio = input('photo_camera');
  readonly cargada = output<void>();

  readonly url = signal<string | null>(null);
  readonly fallo = signal(false);
  private blobUrl: string | null = null;
  private sub: Subscription | null = null;

  constructor() {
    effect(() => {
      const s = this.src();
      untracked(() => this.cargar(s));
    });
    inject(DestroyRef).onDestroy(() => { this.sub?.unsubscribe(); this.liberar(); });
  }

  private cargar(src: string | null | undefined): void {
    this.sub?.unsubscribe();
    this.fallo.set(false);
    const abs = urlApi(src);
    if (!abs) { this.liberar(); this.url.set(null); return; }
    const protegida = abs.startsWith(environment.apiUrl) && !abs.includes('/api/v1/public/');
    if (!protegida) { this.liberar(); this.url.set(abs); return; }
    this.sub = this.http.get(abs, { responseType: 'blob' }).subscribe({
      next: (b) => {
        this.liberar();
        this.blobUrl = URL.createObjectURL(b);
        this.url.set(this.blobUrl);
      },
      error: () => { this.liberar(); this.url.set(null); this.fallo.set(true); },
    });
  }

  private liberar(): void {
    if (this.blobUrl) { URL.revokeObjectURL(this.blobUrl); this.blobUrl = null; }
  }
}
