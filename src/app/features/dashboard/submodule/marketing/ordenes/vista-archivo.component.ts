import {
  ChangeDetectionStrategy, Component, OnChanges, OnDestroy, SimpleChanges, inject, input, signal,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { OrdenesService } from './ordenes.service';
import { ArchivoOrden } from './ordenes.models';

/**
 * Muestra cualquier archivo de una orden: imagen, video, audio, PDF o texto.
 *
 * <p>El binario se pide con HttpClient (lleva el JWT) y se pinta con un object URL; una URL
 * directa al backend en un {@code <img>} no llevaria la sesion. El HTML generado por la IA
 * se muestra como TEXTO, nunca interpretado: el backend lo sirve como text/plain a proposito.
 */
@Component({
  selector: 'app-os-vista-archivo',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cargando()) {
      <div class="va va--vacio"><mat-icon>hourglass_top</mat-icon> Cargando…</div>
    } @else if (error()) {
      <div class="va va--vacio"><mat-icon>broken_image</mat-icon> {{ error() }}</div>
    } @else {
      @switch (clase()) {
        @case ('imagen') { <img class="va va--img" [src]="url()" [alt]="archivo().nombre || 'imagen'" /> }
        @case ('video') { <video class="va va--video" [src]="url()" controls playsinline preload="metadata"></video> }
        @case ('audio') { <audio class="va va--audio" [src]="url()" controls preload="metadata"></audio> }
        @case ('pdf') { <iframe class="va va--pdf" [src]="urlSegura()" title="Documento PDF"></iframe> }
        @case ('texto') { <pre class="va va--texto">{{ texto() }}</pre> }
        @case ('enlace') {
          <a class="va va--enlace" [href]="archivo().url_externa" target="_blank" rel="noopener noreferrer">
            <mat-icon>open_in_new</mat-icon> {{ archivo().url_externa }}
          </a>
        }
        @default {
          <div class="va va--vacio"><mat-icon>insert_drive_file</mat-icon> {{ archivo().nombre }} ({{ archivo().mime || 'archivo' }})</div>
        }
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .va { display: block; width: 100%; border-radius: 10px; }
    .va--img { max-height: var(--os-alto, 420px); object-fit: contain; background: var(--surface-2, #f1f5f9); }
    .va--video { max-height: var(--os-alto, 420px); background: #000; }
    .va--audio { width: 100%; }
    .va--pdf { height: var(--os-alto-pdf, 520px); border: 1px solid var(--border); background: #fff; }
    .va--texto {
      margin: 0; padding: 12px 14px; white-space: pre-wrap; word-break: break-word; max-height: var(--os-alto, 420px);
      overflow: auto; font: .82rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
      background: var(--surface-2, #f8fafc); border: 1px solid var(--border);
    }
    .va--enlace { display: inline-flex; align-items: center; gap: 6px; word-break: break-all; font-size: .85rem; }
    .va--vacio {
      display: flex; align-items: center; gap: 8px; padding: 18px; font-size: .84rem; color: var(--muted);
      background: var(--surface-2, #f8fafc); border: 1px dashed var(--border);
    }
  `],
})
export class VistaArchivoComponent implements OnChanges, OnDestroy {
  private readonly api = inject(OrdenesService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly ordenId = input.required<string>();
  readonly archivo = input.required<ArchivoOrden>();
  /** true = muestra la fuente (el HTML del que salio un PDF) en vez del binario. */
  readonly fuente = input(false);

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly url = signal<string | null>(null);
  readonly urlSegura = signal<SafeResourceUrl | null>(null);
  readonly texto = signal<string>('');
  readonly clase = signal<string>('otro');

  ngOnChanges(c: SimpleChanges): void {
    if (c['archivo'] || c['fuente']) this.cargar();
  }

  ngOnDestroy(): void { this.soltar(); }

  private cargar(): void {
    this.soltar();
    const a = this.archivo();
    const mime = (a.mime || '').split(';')[0];
    const clase = this.fuente() ? 'texto'
      : !a.tiene_contenido && a.url_externa ? 'enlace'
      : mime.startsWith('image/') ? 'imagen'
      : mime.startsWith('video/') ? 'video'
      : mime.startsWith('audio/') ? 'audio'
      : mime === 'application/pdf' ? 'pdf'
      : mime.startsWith('text/') || mime === 'application/json' || (!a.tiene_binario && a.texto) ? 'texto'
      : 'otro';
    this.clase.set(clase);
    this.error.set(null);
    if (clase === 'enlace' || clase === 'otro') return;
    if (clase === 'texto' && a.texto && !this.fuente()) { this.texto.set(a.texto); return; }
    this.cargando.set(true);
    this.api.contenido(this.ordenId(), a.id, this.fuente()).subscribe({
      next: (b) => {
        if (clase === 'texto') {
          b.text().then((t) => { this.texto.set(t); this.cargando.set(false); });
          return;
        }
        // Se fuerza el tipo declarado: el backend sirve con nosniff y el blob hereda su mime.
        const blob = mime && b.type !== mime ? new Blob([b], { type: mime }) : b;
        const u = URL.createObjectURL(blob);
        this.url.set(u);
        this.urlSegura.set(this.sanitizer.bypassSecurityTrustResourceUrl(u));
        this.cargando.set(false);
      },
      error: () => { this.error.set('No se pudo cargar el archivo.'); this.cargando.set(false); },
    });
  }

  private soltar(): void {
    const u = this.url();
    if (u) URL.revokeObjectURL(u);
    this.url.set(null);
    this.urlSegura.set(null);
  }
}
