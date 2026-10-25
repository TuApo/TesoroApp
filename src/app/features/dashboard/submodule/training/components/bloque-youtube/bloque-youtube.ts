import { ChangeDetectionStrategy, Component, Input, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';

interface DatosYoutube { video_id?: string; titulo?: string; canal?: string; inicio?: number; fin?: number; }

/**
 * Video de YouTube incrustado con su tramo.
 *
 * Se usa youtube-nocookie (sin cookies de seguimiento hasta que se reproduce) y se construye
 * la URL SOLO desde un id de 11 caracteres validado: el contenido del bloque viene de la base
 * y confiarle una URL arbitraria a un iframe sería abrir la puerta a incrustar cualquier cosa.
 * El referrer va explícito: sin él YouTube responde "error 153" desde finales de 2025.
 */
@Component({
  selector: 'app-bloque-youtube',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    @if (url(); as u) {
      <div class="by">
        <iframe [src]="u" title="Video de YouTube" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe>
      </div>
      @if (tramo()) { <p class="by-tramo"><mat-icon>content_cut</mat-icon> {{ tramo() }}</p> }
    } @else {
      <p class="by-vacio">Este video no está disponible.</p>
    }
  `,
  styles: [`
    .by { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden; background: #000; }
    .by iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
    .by-tramo { display: flex; align-items: center; gap: 6px; margin: 6px 0 0; font-size: 12.5px; color: var(--muted); }
    .by-tramo mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .by-vacio { color: var(--muted); font-size: 13px; }
  `],
})
export class BloqueYoutube {
  private san = inject(DomSanitizer);
  readonly url = signal<SafeResourceUrl | null>(null);
  readonly tramo = signal<string | null>(null);

  @Input() set contenido(v: string | DatosYoutube | null | undefined) {
    let d: DatosYoutube | null = null;
    try { d = typeof v === 'string' ? JSON.parse(v) : v ?? null; } catch { d = null; }
    const id = d?.video_id ?? '';
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) { this.url.set(null); return; }
    const p = new URLSearchParams({ rel: '0', hl: 'es', cc_lang_pref: 'es', playsinline: '1' });
    const ini = Math.max(0, Math.floor(d?.inicio ?? 0));
    if (ini > 0) p.set('start', String(ini));
    if (d?.fin && d.fin > ini) p.set('end', String(Math.floor(d.fin)));
    this.url.set(this.san.bypassSecurityTrustResourceUrl(`https://www.youtube-nocookie.com/embed/${id}?${p}`));
    this.tramo.set(ini > 0 || d?.fin ? `Del ${BloqueYoutube.mmss(ini)}${d?.fin ? ' al ' + BloqueYoutube.mmss(d.fin) : ' en adelante'}` : null);
  }

  static mmss(s: number): string {
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }
}
