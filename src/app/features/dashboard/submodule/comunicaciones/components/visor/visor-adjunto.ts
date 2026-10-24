import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Adjunto } from '../../modelos';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { tamano } from '../../utiles';

export interface VisorData { adjuntos: Adjunto[]; indice: number }

/** Visor a pantalla completa: fotos (con flechas), PDF, video y audio. */
@Component({
  selector: 'app-com-visor-adjunto',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="visor" (click)="cerrar()">
      <header (click)="$event.stopPropagation()">
        <div class="nombre">
          <strong>{{ actual().nombre }}</strong>
          <small>@if (actual().tamano) { {{ tam(actual().tamano) }} · }{{ indice() + 1 }} de {{ data.adjuntos.length }}</small>
        </div>
        <a class="btn" [href]="abs(actual().descarga_url)" download title="Descargar"><span class="material-icons">download</span></a>
        <a class="btn" [href]="abs(actual().url)" target="_blank" rel="noopener" title="Abrir en otra pestaña"><span class="material-icons">open_in_new</span></a>
        <button class="btn" type="button" (click)="cerrar()" title="Cerrar (Esc)"><span class="material-icons">close</span></button>
      </header>
      <div class="lienzo" (click)="$event.stopPropagation()">
        @switch (tipo()) {
          @case ('imagen') { <img [src]="abs(actual().url)" [alt]="actual().nombre" /> }
          @case ('video') { <video [src]="abs(actual().url)" controls autoplay></video> }
          @case ('audio') { <audio [src]="abs(actual().url)" controls autoplay></audio> }
          @case ('pdf') { <iframe [src]="pdf()" title="Documento"></iframe> }
          @default {
            <div class="otro">
              <span class="material-icons">description</span>
              <p>Este tipo de archivo no se puede ver aquí.</p>
              <a class="descargar" [href]="abs(actual().descarga_url)" download>Descargar {{ actual().nombre }}</a>
            </div>
          }
        }
      </div>
      @if (data.adjuntos.length > 1) {
        <button class="nav izq" type="button" (click)="mover(-1); $event.stopPropagation()" aria-label="Anterior"><span class="material-icons">chevron_left</span></button>
        <button class="nav der" type="button" (click)="mover(1); $event.stopPropagation()" aria-label="Siguiente"><span class="material-icons">chevron_right</span></button>
      }
    </div>`,
  styles: [`
    .visor { position: fixed; inset: 0; background: rgba(8, 12, 22, .92); display: flex; flex-direction: column; z-index: 1; }
    header { display: flex; align-items: center; gap: .5rem; padding: .6rem 1rem; color: #fff; }
    .nombre { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .nombre strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .nombre small { opacity: .7; }
    .btn { background: rgba(255,255,255,.1); border: 0; color: #fff; width: 40px; height: 40px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; text-decoration: none; }
    .btn:hover { background: rgba(255,255,255,.2); }
    .lienzo { flex: 1; display: flex; align-items: center; justify-content: center; padding: 0 4rem 1.5rem; min-height: 0; }
    img, video { max-width: 100%; max-height: 100%; border-radius: 6px; box-shadow: 0 12px 40px rgba(0,0,0,.5); }
    iframe { width: min(1000px, 100%); height: 100%; border: 0; border-radius: 6px; background: #fff; }
    audio { width: min(520px, 100%); }
    .otro { color: #fff; text-align: center; }
    .otro .material-icons { font-size: 64px; opacity: .8; }
    .descargar { color: #9BD441; }
    .nav { position: absolute; top: 50%; transform: translateY(-50%); border: 0; width: 48px; height: 48px; border-radius: 50%;
      background: rgba(255,255,255,.12); color: #fff; cursor: pointer; }
    .nav:hover { background: rgba(255,255,255,.25); }
    .izq { left: 1rem; } .der { right: 1rem; }
    @media (max-width: 600px) { .lienzo { padding: 0 .5rem 1rem; } .nav { top: auto; bottom: 1rem; transform: none; } }
  `],
})
export class VisorAdjunto {
  readonly data = inject<VisorData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<VisorAdjunto>);
  private readonly api = inject(ComunicacionesApiService);
  private readonly san = inject(DomSanitizer);

  readonly indice = signal(this.data.indice);
  readonly actual = computed(() => this.data.adjuntos[this.indice()]);
  readonly tipo = computed(() => {
    const a = this.actual();
    if (a.mime.startsWith('image/')) return 'imagen';
    if (a.mime.startsWith('video/')) return 'video';
    if (a.mime.startsWith('audio/')) return 'audio';
    if (a.mime === 'application/pdf') return 'pdf';
    return 'otro';
  });
  readonly pdf = computed<SafeResourceUrl>(() => this.san.bypassSecurityTrustResourceUrl(this.abs(this.actual().url) ?? ''));

  abs(u: string | null): string | null { return this.api.absoluta(u); }
  tam(b: number): string { return tamano(b); }
  cerrar(): void { this.ref.close(); }
  mover(d: number): void {
    const n = this.data.adjuntos.length;
    this.indice.set((this.indice() + d + n) % n);
  }

  @HostListener('document:keydown', ['$event'])
  tecla(e: KeyboardEvent): void {
    if (e.key === 'ArrowRight') this.mover(1);
    if (e.key === 'ArrowLeft') this.mover(-1);
  }
}
