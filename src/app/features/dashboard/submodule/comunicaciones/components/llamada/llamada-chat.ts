import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, OnInit, afterNextRender, computed, effect, inject, signal,
  untracked, viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MensajeLlamada } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { LlamadaService } from '../../service/llamada.service';
import { colorDe, hora, iconoAdjunto, textoConEnlaces } from '../../utiles';

/**
 * El chat de la llamada: para pasar un enlace, una cifra o un nombre sin interrumpir.
 * Lo escrito queda en la conversación y entra al acta junto con lo que se dijo.
 */
@Component({
  selector: 'app-com-llamada-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="chat-ll">
      <p class="nota"><mat-icon>bookmark_added</mat-icon> Queda guardado en el chat y en el acta de la llamada.</p>
      <div class="lista" #lista>
        @for (m of ll.chat(); track m.cliente_id ?? m.id) {
          <div class="msg" [class.mio]="m.autor_id === yo()">
            @if (m.autor_id !== yo()) { <span class="autor" [style.color]="color(m.autor_id)">{{ m.autor_nombre }}</span> }
            <div class="burbuja" [class.error]="m._estado === 'error'">
              @if (m.texto) { <div class="texto" [innerHTML]="html(m)"></div> }
              @for (a of m.adjuntos; track a.id) {
                <a class="adj" [href]="abs(a.descarga_url || a.url)" target="_blank" rel="noopener"><mat-icon>{{ icono(a.clase, a.mime) }}</mat-icon>{{ a.nombre }}</a>
              }
              <span class="meta">
                @switch (m._estado) {
                  @case ('enviando') { <mat-icon>schedule</mat-icon> }
                  @case ('error') { <button type="button" class="reintentar" (click)="ll.escribirChat(m.texto ?? '', m)">No se envió · Reintentar</button> }
                  @default { {{ h(m.creado_en) }} }
                }
              </span>
            </div>
          </div>
        } @empty {
          <p class="vacio">Nadie ha escrito todavía. Escribe aquí lo que quieras dejar por escrito: un enlace, una cifra, un acuerdo.</p>
        }
      </div>
      <form class="escribir" (submit)="$event.preventDefault(); enviar()">
        <textarea #caja rows="1" placeholder="Escribe un mensaje para todos" aria-label="Mensaje para la llamada" maxlength="8000"
                  [value]="borrador()" (input)="borrador.set($any($event.target).value)"
                  (keydown.enter)="alEnter($any($event))"></textarea>
        <button type="submit" class="enviar" [disabled]="!borrador().trim()" aria-label="Enviar"><mat-icon>send</mat-icon></button>
      </form>
    </div>`,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .chat-ll { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .nota { margin: 0; padding: .6rem .8rem; display: flex; align-items: center; gap: .35rem; font-size: .72rem; color: rgba(255,255,255,.6);
      border-bottom: 1px solid rgba(255,255,255,.08); }
    .nota mat-icon { font-size: 16px; width: 16px; height: 16px; color: #86EFAC; }
    .lista { flex: 1; min-height: 0; overflow-y: auto; padding: .7rem .8rem; display: flex; flex-direction: column; gap: .45rem; }
    .msg { display: flex; flex-direction: column; align-items: flex-start; max-width: 88%; }
    .msg.mio { align-self: flex-end; align-items: flex-end; }
    .autor { font-size: .7rem; font-weight: 700; margin: 0 0 .1rem .3rem; filter: brightness(1.6); }
    .burbuja { background: rgba(255,255,255,.1); border-radius: 14px 14px 14px 4px; padding: .4rem .65rem; font-size: .83rem; line-height: 1.35;
      overflow-wrap: anywhere; display: flex; flex-direction: column; gap: .2rem; }
    .mio .burbuja { background: #2563EB; border-radius: 14px 14px 4px 14px; }
    .burbuja.error { background: rgba(220,38,38,.35); }
    .texto { white-space: pre-wrap; }
    /* Los enlaces los arma textoConEnlaces por innerHTML: sin ::ng-deep no les llega el estilo. */
    .texto ::ng-deep a { color: #93C5FD; text-decoration: underline; }
    .mio .texto ::ng-deep a { color: #fff; }
    .adj { display: inline-flex; align-items: center; gap: .25rem; color: inherit; font-size: .78rem; text-decoration: underline; }
    .adj mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .meta { align-self: flex-end; font-size: .66rem; color: rgba(255,255,255,.6); display: inline-flex; align-items: center; }
    .meta mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .reintentar { border: 0; background: transparent; color: #FCA5A5; font-size: .7rem; cursor: pointer; padding: 0; min-height: 0 !important;
      text-decoration: underline; }
    .vacio { margin: auto 0; text-align: center; color: rgba(255,255,255,.55); font-size: .8rem; padding: 1rem; }
    .escribir { display: flex; align-items: flex-end; gap: .4rem; padding: .6rem .7rem; border-top: 1px solid rgba(255,255,255,.08); }
    textarea { flex: 1; min-width: 0; resize: none; max-height: 120px; border-radius: 12px; border: 1px solid rgba(255,255,255,.16);
      background: rgba(255,255,255,.06); color: #fff; padding: .55rem .7rem; font-size: .85rem; line-height: 1.3; outline: 0; field-sizing: content; }
    textarea:focus { border-color: #60A5FA; }
    textarea::placeholder { color: rgba(255,255,255,.5); }
    .enviar { flex: none; width: 40px; height: 40px; min-height: 0 !important; border-radius: 50%; border: 0; background: #2563EB; color: #fff;
      cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .enviar:disabled { opacity: .45; cursor: default; }
    .enviar mat-icon { font-size: 20px; width: 20px; height: 20px; }
  `],
})
export class ComLlamadaChat implements OnInit, OnDestroy {
  readonly ll = inject(LlamadaService);
  private readonly store = inject(ChatStoreService);
  private readonly api = inject(ComunicacionesApiService);
  private readonly injector = inject(Injector);
  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');
  private readonly caja = viewChild<ElementRef<HTMLTextAreaElement>>('caja');

  readonly borrador = signal('');
  readonly yo = computed(() => this.store.miId());

  constructor() {
    // Con cada mensaje nuevo baja al final (después de pintarlo: la app no usa zone.js).
    effect(() => {
      this.ll.chat().length;
      untracked(() => afterNextRender(() => {
        const el = this.lista()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      }, { injector: this.injector }));
    });
  }

  ngOnInit(): void {
    this.ll.chatVisible.set(true);
    this.ll.marcarChatLeido();
    afterNextRender(() => this.caja()?.nativeElement.focus(), { injector: this.injector });
  }

  ngOnDestroy(): void {
    this.ll.chatVisible.set(false);
  }

  enviar(): void {
    const t = this.borrador().trim();
    if (!t) return;
    this.ll.escribirChat(t);
    this.borrador.set('');
    // Sin zone.js, escribir y enviar en el mismo instante no alcanza a refrescar el [value]: se limpia a mano.
    const c = this.caja()?.nativeElement;
    if (c) c.value = '';
  }

  alEnter(e: KeyboardEvent): void {
    if (e.shiftKey || e.isComposing) return;
    e.preventDefault();
    this.enviar();
  }

  html(m: MensajeLlamada): string { return textoConEnlaces(m.texto); }
  h(iso: string): string { return hora(iso); }
  color(id: string | null): string { return colorDe(id); }
  abs(u: string | null): string | null { return this.api.absoluta(u); }
  icono(clase: string, mime: string): string { return iconoAdjunto(clase, mime); }
}
