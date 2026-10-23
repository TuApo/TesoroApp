import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, OnInit, afterNextRender, computed, effect, inject, input, output,
  signal, untracked, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Adjunto, Momento, MsgAsistente } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { mmss, textoAsistente } from '../../utiles';
import { VisorAdjunto } from '../visor/visor-adjunto';

/** Lo que se le sugiere preguntar según dónde está. */
const SUGERENCIAS_LLAMADA = [
  '¿Qué se ha acordado hasta ahora?',
  'Resume lo último que se habló',
  'Redacta un mensaje con los compromisos y responsables',
  '¿Qué se mostró en pantalla?',
];
const SUGERENCIAS_CHAT = [
  'Resume lo que se ha hablado en este chat',
  '¿Qué compromisos quedaron pendientes?',
  'Redacta una respuesta para el último mensaje',
  'Busca lo que se dijo sobre…',
];

/**
 * El asistente de IA de una llamada o de una conversación: pregunta lo que se dijo, mostró o
 * escribió; pide que redacte (con el texto listo para usar en el chat); y abre pantallas y
 * documentos de la plataforma. El hilo es privado de cada persona.
 */
@Component({
  selector: 'app-com-asistente-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    <div class="asis" [class.oscuro]="oscuro()">
      <div class="lista" #lista>
        @if (!mensajes().length && !pensando()) {
          <div class="vacio">
            <mat-icon>auto_awesome</mat-icon>
            <p>{{ llamadaId() ? 'Pregúntame lo que se ha hablado, mostrado o escrito en esta llamada, o pídeme que redacte algo.'
                : 'Pregúntame por lo que se ha hablado en este chat, pídeme que redacte o que te lleve a una pantalla o documento.' }}</p>
            <div class="sugs">
              @for (s of sugerencias(); track s) { <button type="button" (click)="usarSugerencia(s)">{{ s }}</button> }
            </div>
          </div>
        }
        @for (m of mensajes(); track m.id) {
          @if (m.rol === 'PERSONA') {
            <div class="yo"><div class="burbuja">{{ m.texto }}</div></div>
          } @else {
            <div class="ia">
              <span class="quien"><mat-icon>auto_awesome</mat-icon> Asistente</span>
              <div class="burbuja" [innerHTML]="html(m.texto)"></div>
              @if (m.meta?.borrador; as b) {
                <div class="borrador">
                  <div class="b-txt">{{ b }}</div>
                  <div class="b-acc">
                    <button type="button" (click)="copiar(b)"><mat-icon>content_copy</mat-icon>{{ copiado() === m.id ? 'Copiado' : 'Copiar' }}</button>
                    @if (puedeUsar()) { <button type="button" class="pri" (click)="usar.emit(b)"><mat-icon>send</mat-icon>{{ textoUsar() }}</button> }
                  </div>
                </div>
              }
              @if (momentosDe(m).length) {
                <div class="chips">
                  @for (x of momentosDe(m); track x.id) {
                    <button type="button" class="chip" (click)="verMomento.emit(x)" [matTooltip]="x.extracto ?? ''">
                      <mat-icon>bookmark</mat-icon>{{ t(x.momento_ms) }} · {{ x.titulo || 'Momento' }}</button>
                  }
                </div>
              }
              @if (m.meta?.ir_a?.length || m.meta?.documentos?.length || m.meta?.enlaces?.length) {
                <div class="chips">
                  @for (x of m.meta?.ir_a ?? []; track x.ruta) {
                    <button type="button" class="chip ir" (click)="ir(x.ruta)"><mat-icon>arrow_forward</mat-icon>{{ x.etiqueta }}</button>
                  }
                  @for (d of m.meta?.documentos ?? []; track d.id; let i = $index) {
                    <button type="button" class="chip doc" (click)="verDocs(m, i)"><mat-icon>description</mat-icon>{{ d.nombre }}</button>
                  }
                  @for (x of m.meta?.enlaces ?? []; track x.url) {
                    <a class="chip" [href]="x.url" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon>{{ x.etiqueta }}</a>
                  }
                </div>
              }
            </div>
          }
        }
        @if (pensando()) { <div class="ia"><div class="burbuja pensando"><i></i><i></i><i></i> Pensando…</div></div> }
        @if (error()) { <p class="error">{{ error() }}</p> }
      </div>
      <form class="escribir" (submit)="$event.preventDefault(); enviar()">
        <textarea #caja rows="1" [placeholder]="llamadaId() ? 'Pregunta o pide algo sobre la llamada' : 'Pregunta o pide algo sobre este chat'"
                  aria-label="Pregunta para el asistente" maxlength="4000" [value]="borrador()" (input)="borrador.set($any($event.target).value)"
                  (keydown.enter)="alEnter($any($event))"></textarea>
        <button type="submit" class="enviar" [disabled]="!borrador().trim() || pensando()" aria-label="Preguntar"><mat-icon>arrow_upward</mat-icon></button>
      </form>
      <p class="pie"><mat-icon>lock</mat-icon> Solo tú ves esta conversación con la IA.
        @if (mensajes().length) { <button type="button" (click)="olvidar()">Borrar</button> }</p>
    </div>`,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .asis { --fondo-b: var(--surface-2); --texto: var(--text); --tenue: var(--muted); --borde: var(--border); --pri: var(--primary);
      display: flex; flex-direction: column; min-height: 0; flex: 1; color: var(--texto); }
    .oscuro { --fondo-b: rgba(255,255,255,.09); --texto: #fff; --tenue: rgba(255,255,255,.62); --borde: rgba(255,255,255,.14); --pri: #60A5FA; }
    .lista { flex: 1; min-height: 0; overflow-y: auto; padding: .8rem; display: flex; flex-direction: column; gap: .6rem; }
    .vacio { margin: auto 0; text-align: center; color: var(--tenue); font-size: .82rem; display: flex; flex-direction: column; align-items: center; gap: .4rem; }
    .vacio > mat-icon { color: var(--pri); font-size: 30px; width: 30px; height: 30px; }
    .vacio p { margin: 0 .5rem; }
    .sugs { display: flex; flex-wrap: wrap; gap: .35rem; justify-content: center; margin-top: .3rem; }
    .sugs button { border: 1px solid var(--borde); background: transparent; color: var(--texto); border-radius: 999px; padding: .3rem .7rem;
      font: inherit; font-size: .76rem; cursor: pointer; min-height: 0 !important; }
    .sugs button:hover { border-color: var(--pri); }
    .yo { align-self: flex-end; max-width: 88%; }
    .yo .burbuja { background: var(--pri); color: #fff; border-radius: 14px 14px 4px 14px; }
    .ia { align-self: stretch; display: flex; flex-direction: column; gap: .35rem; max-width: 100%; }
    .quien { display: inline-flex; align-items: center; gap: .2rem; font-size: .7rem; font-weight: 700; color: var(--pri); }
    .quien mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .burbuja { background: var(--fondo-b); border-radius: 14px 14px 14px 4px; padding: .5rem .7rem; font-size: .84rem; line-height: 1.45;
      overflow-wrap: anywhere; white-space: pre-wrap; }
    .ia .burbuja { white-space: normal; }
    .burbuja ::ng-deep a { color: var(--pri); }
    .burbuja ::ng-deep ul { margin: .3rem 0; padding-left: 1.1rem; }
    .pensando { display: inline-flex; align-items: center; gap: .25rem; color: var(--tenue); width: fit-content; }
    .pensando i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: salto 1.2s infinite; }
    .pensando i:nth-child(2) { animation-delay: .15s; } .pensando i:nth-child(3) { animation-delay: .3s; }
    .borrador { border: 1px dashed var(--pri); border-radius: 12px; padding: .55rem .65rem; display: flex; flex-direction: column; gap: .45rem; }
    .b-txt { white-space: pre-wrap; font-size: .83rem; line-height: 1.45; overflow-wrap: anywhere; max-height: 260px; overflow-y: auto; }
    .b-acc { display: flex; gap: .35rem; justify-content: flex-end; flex-wrap: wrap; }
    .b-acc button { display: inline-flex; align-items: center; gap: .2rem; border: 1px solid var(--borde); background: transparent; color: var(--texto);
      border-radius: 999px; padding: .25rem .65rem; font: inherit; font-size: .74rem; cursor: pointer; min-height: 0 !important; }
    .b-acc button.pri { background: var(--pri); border-color: var(--pri); color: #fff; }
    .b-acc mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .chips { display: flex; flex-wrap: wrap; gap: .3rem; }
    .chip { display: inline-flex; align-items: center; gap: .2rem; border: 1px solid var(--borde); background: transparent; color: var(--texto);
      border-radius: 999px; padding: .22rem .6rem; font: inherit; font-size: .73rem; cursor: pointer; text-decoration: none; min-height: 0 !important;
      max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip mat-icon { font-size: 15px; width: 15px; height: 15px; flex: none; color: var(--pri); }
    .chip:hover { border-color: var(--pri); }
    .error { color: var(--danger-fg, #FCA5A5); font-size: .78rem; margin: 0; }
    .escribir { display: flex; align-items: flex-end; gap: .4rem; padding: .55rem .7rem 0; }
    textarea { flex: 1; min-width: 0; resize: none; max-height: 120px; border-radius: 12px; border: 1px solid var(--borde); background: var(--fondo-b);
      color: var(--texto); padding: .55rem .7rem; font: inherit; font-size: .85rem; line-height: 1.3; outline: 0; field-sizing: content; }
    textarea:focus { border-color: var(--pri); }
    .enviar { flex: none; width: 38px; height: 38px; min-height: 0 !important; border-radius: 50%; border: 0; background: var(--pri); color: #fff;
      cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .enviar:disabled { opacity: .45; cursor: default; }
    .pie { margin: 0; padding: .35rem .8rem .55rem; display: flex; align-items: center; gap: .25rem; font-size: .68rem; color: var(--tenue); }
    .pie mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .pie button { margin-left: auto; border: 0; background: transparent; color: var(--tenue); text-decoration: underline; cursor: pointer;
      font: inherit; font-size: .68rem; min-height: 0 !important; padding: 0; }
    @keyframes salto { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-3px); opacity: 1; } }
  `],
})
export class ComAsistentePanel implements OnInit {
  private readonly api = inject(ComunicacionesApiService);
  private readonly store = inject(ChatStoreService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  readonly conversacionId = input<string | null>(null);
  readonly llamadaId = input<string | null>(null);
  readonly oscuro = input(false);
  /** Los momentos de la llamada, para mostrar los que cite la IA. */
  readonly momentos = input<Momento[]>([]);
  /** Hay dónde usar el borrador (el chat de la llamada o el redactor de la conversación). */
  readonly puedeUsar = input(true);
  readonly textoUsar = input('Usar en el chat');
  readonly usar = output<string>();
  readonly verMomento = output<Momento>();
  /** Se abrió una pantalla o un documento (quien contiene el panel puede minimizarse). */
  readonly salio = output<void>();

  readonly mensajes = signal<MsgAsistente[]>([]);
  readonly pensando = signal(false);
  readonly error = signal<string | null>(null);
  readonly borrador = signal('');
  readonly copiado = signal<number | null>(null);
  readonly sugerencias = computed(() => this.llamadaId() ? SUGERENCIAS_LLAMADA : SUGERENCIAS_CHAT);
  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');
  private readonly caja = viewChild<ElementRef<HTMLTextAreaElement>>('caja');
  private espera: ReturnType<typeof setTimeout> | null = null;

  private readonly ambitoId = computed(() => this.llamadaId() ?? this.conversacionId());

  constructor() {
    effect(() => {
      this.mensajes().length;
      this.pensando();
      untracked(() => afterNextRender(() => {
        const el = this.lista()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      }, { injector: this.injector }));
    });
    this.destroyRef.onDestroy(() => { if (this.espera) clearTimeout(this.espera); });
  }

  ngOnInit(): void {
    this.api.historialAsistente(this.ambito()).subscribe({ next: xs => this.mensajes.set(xs), error: () => undefined });
    this.store.eventos$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ nombre, datos }) => {
      if (nombre !== 'asistente' || datos?.ambito_id !== this.ambitoId()) return;
      const m = datos.mensaje as MsgAsistente;
      if (m && !this.mensajes().some(x => x.id === m.id)) this.mensajes.update(xs => [...xs, m]);
      this.pensando.set(false);
      if (this.espera) { clearTimeout(this.espera); this.espera = null; }
    });
    afterNextRender(() => this.caja()?.nativeElement.focus(), { injector: this.injector });
  }

  enviar(): void {
    const t = this.borrador().trim();
    // Sin zone.js el campo existe un instante antes de recibir el ámbito: no se pregunta "a nadie".
    if (!t || this.pensando() || !this.ambitoId()) return;
    this.error.set(null);
    this.pensando.set(true);
    this.borrador.set('');
    const c = this.caja()?.nativeElement;
    if (c) c.value = '';
    this.api.preguntarAsistente(this.ambito(), t).subscribe({
      next: m => {
        this.mensajes.update(xs => [...xs, m]);
        // La respuesta llega por el canal; si tarda demasiado se avisa (puede seguir llegando).
        this.espera = setTimeout(() => {
          if (this.pensando()) { this.pensando.set(false); this.error.set('La IA está tardando más de lo normal; la respuesta aparecerá aquí cuando llegue.'); }
        }, 90_000);
      },
      error: e => {
        this.pensando.set(false);
        this.borrador.set(t);
        const caja = this.caja()?.nativeElement;
        if (caja) caja.value = t;
        this.error.set(e?.error?.message ?? 'No se pudo preguntar a la IA.');
      },
    });
  }

  usarSugerencia(s: string): void {
    if (s.endsWith('…')) { this.borrador.set(s.replace('…', ' ')); this.caja()?.nativeElement.focus(); return; }
    this.borrador.set(s);
    this.enviar();
  }

  alEnter(e: KeyboardEvent): void {
    if (e.shiftKey || e.isComposing) return;
    e.preventDefault();
    this.enviar();
  }

  olvidar(): void {
    this.api.olvidarAsistente(this.ambito()).subscribe({ next: () => this.mensajes.set([]) });
  }

  copiar(t: string): void {
    void navigator.clipboard?.writeText(t);
    const id = this.mensajes().find(m => m.meta?.borrador === t)?.id ?? null;
    this.copiado.set(id);
    setTimeout(() => this.copiado.set(null), 2000);
  }

  momentosDe(m: MsgAsistente): Momento[] {
    const ids = m.meta?.momentos ?? [];
    return this.momentos().filter(x => ids.includes(x.id));
  }

  ir(ruta: string): void {
    this.salio.emit();
    void this.router.navigateByUrl(ruta);
  }

  verDocs(m: MsgAsistente, i: number): void {
    const docs: Adjunto[] = (m.meta?.documentos ?? []).filter(d => !!d.url).map(d => ({
      id: String(d.id), nombre: d.nombre || 'Documento', mime: d.mime || 'application/pdf', clase: 'DOCUMENTO' as const, tamano: 0,
      ancho: null, alto: null, duracion_ms: null, url: d.url!, miniatura_url: null, descarga_url: d.descarga_url ?? d.url!,
      mensaje_id: null, creado_en: m.creado_en,
    } as Adjunto));
    if (!docs.length) return;
    this.salio.emit();
    this.dialog.open(VisorAdjunto, { data: { adjuntos: docs, indice: Math.min(i, docs.length - 1) }, panelClass: 'com-visor-panel',
      maxWidth: '100vw', maxHeight: '100vh', width: '100vw', height: '100vh' });
  }

  html(t: string): string { return textoAsistente(t); }
  t(ms: number): string { return mmss(ms); }

  private ambito(): { conversacion_id?: string | null; llamada_id?: string | null } {
    return this.llamadaId() ? { llamada_id: this.llamadaId() } : { conversacion_id: this.conversacionId() };
  }
}
