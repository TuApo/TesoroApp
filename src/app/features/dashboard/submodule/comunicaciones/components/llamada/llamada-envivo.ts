import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LineaVivo, MensajeLlamada, Momento } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { LlamadaService } from '../../service/llamada.service';
import { colorDe, mmss, textoConEnlaces } from '../../utiles';

type Filtro = 'todo' | 'momentos' | 'dicho' | 'chat';
interface Item { clave: string; ms: number; linea?: LineaVivo; chat?: MensajeLlamada; momento?: Momento }

export const ETIQUETA_TIPO: Record<string, string> = {
  ACUERDO: 'Acuerdo', COMPROMISO: 'Compromiso', DATO: 'Dato clave', ALERTA: 'Alerta', PREGUNTA: 'Pregunta abierta', MOSTRADO: 'Se mostró',
};

/**
 * El "en vivo" de la llamada: lo que cada quien va diciendo (transcrito desde su micrófono),
 * lo que se escriben en el chat y los momentos importantes (los que alguien guardó y los que
 * detecta la IA), en una sola línea de tiempo para mirar hacia atrás sin perder detalle.
 */
@Component({
  selector: 'app-com-llamada-envivo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    <div class="vivo">
      <div class="cab">
        <label class="buscar-v"><mat-icon>search</mat-icon>
          <input type="search" placeholder="Buscar en lo dicho y escrito" aria-label="Buscar en la llamada"
                 [value]="q()" (input)="q.set($any($event.target).value)" /></label>
        <div class="filtros" role="tablist" aria-label="Qué ver">
          @for (f of filtros; track f.v) {
            <button type="button" role="tab" [class.on]="filtro() === f.v" [attr.aria-selected]="filtro() === f.v" (click)="filtro.set(f.v)">
              {{ f.t }}@if (f.v === 'momentos' && ll.momentos().length) { <b>{{ ll.momentos().length }}</b> }</button>
          }
        </div>
      </div>

      <div class="lista" #lista (scroll)="alDesplazar()">
        @for (it of items(); track it.clave) {
          @if (it.linea; as l) {
            <div class="linea" [style.--c]="color(l.usuario_id)">
              <span class="t">{{ t(l.inicio_ms) }}</span>
              <div class="txt"><strong>{{ l.nombre }}</strong> {{ l.texto }}</div>
              <button type="button" class="marcar" (click)="marcar(l.inicio_ms)" matTooltip="Guardar este momento" aria-label="Guardar este momento">
                <mat-icon>bookmark_add</mat-icon></button>
            </div>
          } @else if (it.chat; as c) {
            <div class="linea escrito" [style.--c]="color(c.autor_id)">
              <span class="t"><mat-icon>chat_bubble_outline</mat-icon></span>
              <div class="txt"><strong>{{ c.autor_nombre }}</strong> <em>escribió</em> <span [innerHTML]="enlaces(c.texto)"></span>
                @for (a of c.adjuntos; track a.id) { <a class="adj" [href]="abs(a.descarga_url || a.url)" target="_blank" rel="noopener">📎 {{ a.nombre }}</a> }</div>
            </div>
          } @else if (it.momento; as m) {
            <div class="momento" [class.ia]="m.origen === 'IA'">
              <div class="m-cab">
                <mat-icon class="m-ico">{{ m.origen === 'IA' ? 'auto_awesome' : 'bookmark' }}</mat-icon>
                <span class="t">{{ t(m.momento_ms) }}</span>
                @if (m.tipo) { <span class="tipo">{{ etiqueta(m.tipo) }}</span> }
                <small>{{ m.origen === 'IA' ? 'Lo marcó la IA' : (m.creado_por === yo() ? 'Lo guardaste tú' : 'Lo guardó ' + m.creado_por_nombre) }}</small>
                <span class="m-acc">
                  <button type="button" (click)="editar(m)" matTooltip="Ponerle nombre" aria-label="Ponerle nombre"><mat-icon>edit</mat-icon></button>
                  @if (m.origen === 'IA' || m.creado_por === yo()) {
                    <button type="button" (click)="ll.quitarMomento(m.id)" matTooltip="Quitar" aria-label="Quitar momento"><mat-icon>close</mat-icon></button>
                  }
                </span>
              </div>
              @if (editando() === m.id) {
                <form class="nombrar" (submit)="$event.preventDefault(); guardarNombre(m, nombre.value)">
                  <input #nombre type="text" maxlength="200" [value]="m.titulo ?? ''" placeholder="¿Qué pasó en este momento?" aria-label="Nombre del momento" />
                  <button type="submit">Guardar</button>
                </form>
              } @else {
                <strong class="m-tit">{{ m.titulo || (m.audio_estado === 'PENDIENTE' ? 'Momento guardado' : 'Momento sin nombre') }}</strong>
              }
              @if (m.nota) { <p class="m-nota">{{ m.nota }}</p> }
              @if (m.imagen_url) {
                <a class="captura" [href]="abs(m.imagen_url)" target="_blank" rel="noopener" aria-label="Ver la captura en grande">
                  <img [src]="abs(m.imagen_url)" alt="Lo que se estaba mostrando" loading="lazy" /></a>
              }
              @if (m.video_url) {
                <video [src]="abs(m.video_url)" controls preload="metadata" playsinline></video>
              } @else if (m.audio_url) {
                <audio [src]="abs(m.audio_url)" controls preload="none"></audio>
              } @else if (m.audio_estado === 'PENDIENTE') {
                <small class="prep"><mat-icon class="gira">autorenew</mat-icon> Preparando el clip ({{ t(m.desde_ms) }}–{{ t(m.hasta_ms) }})…</small>
              }
              @if (m.extracto) {
                <details><summary>Lo que se dijo en ese tramo</summary><pre>{{ m.extracto }}</pre></details>
              }
            </div>
          }
        } @empty {
          <p class="vacio">{{ q() ? 'Nada coincide con la búsqueda.' : vacio() }}</p>
        }
        @if (ll.parcialVivo() && filtro() !== 'momentos' && filtro() !== 'chat') {
          <div class="linea parcial"><span class="t">{{ t(ll.ahoraMs()) }}</span><div class="txt"><strong>Tú</strong> {{ ll.parcialVivo() }}…</div></div>
        }
      </div>

      @if (!abajo()) {
        <button type="button" class="ir-abajo" (click)="bajar(true)"><mat-icon>arrow_downward</mat-icon> Lo más reciente</button>
      }
      <div class="estado">
        @switch (ll.estadoVivo()) {
          @case ('transcribiendo') { <span class="ok"><i></i> Transcribiendo tu voz en vivo</span> }
          @case ('conectando') { <span><mat-icon class="gira">autorenew</mat-icon> Conectando la transcripción…</span> }
          @case ('reconectando') { <span><mat-icon class="gira">autorenew</mat-icon> {{ ll.detalleVivo() || 'Reconectando la transcripción…' }}</span> }
          @case ('error') { <span class="mal"><mat-icon>error</mat-icon> {{ ll.detalleVivo() || 'La transcripción en vivo falló' }}</span> }
          @default {
            <span>{{ ll.actual()?.transcribir ? (ll.vivoDisponible() ? 'La transcripción empieza cuando alguien contesta' : 'Transcripción en vivo no disponible: el acta sale de la grabación') : 'Esta llamada no se transcribe' }}</span>
          }
        }
      </div>
    </div>`,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .vivo { position: relative; display: flex; flex-direction: column; min-height: 0; flex: 1; color: #fff; }
    .cab { padding: .6rem .7rem .4rem; display: flex; flex-direction: column; gap: .4rem; border-bottom: 1px solid rgba(255,255,255,.08); }
    .buscar-v { display: flex; align-items: center; gap: .35rem; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12);
      border-radius: 10px; padding: 0 .55rem; height: 36px; }
    .buscar-v mat-icon { font-size: 18px; width: 18px; height: 18px; color: rgba(255,255,255,.55); }
    .buscar-v input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: #fff; font-size: .8rem; }
    .filtros { display: flex; gap: .25rem; flex-wrap: wrap; }
    .filtros button { border: 1px solid rgba(255,255,255,.14); background: transparent; color: rgba(255,255,255,.75); border-radius: 999px;
      padding: .15rem .55rem; font: inherit; font-size: .72rem; cursor: pointer; min-height: 0 !important; display: inline-flex; gap: .25rem; align-items: center; }
    .filtros button.on { background: #fff; color: #111827; border-color: #fff; font-weight: 700; }
    .filtros b { background: #F59E0B; color: #111827; border-radius: 999px; font-size: .62rem; padding: 0 .3rem; }
    .lista { flex: 1; min-height: 0; overflow-y: auto; padding: .5rem .6rem 2.5rem; display: flex; flex-direction: column; gap: .2rem; }
    .linea { position: relative; display: flex; gap: .45rem; padding: .3rem .35rem; border-radius: 8px; border-left: 3px solid var(--c); font-size: .8rem; line-height: 1.4; }
    .linea:hover { background: rgba(255,255,255,.05); }
    .linea.escrito { border-left-style: dashed; background: rgba(255,255,255,.03); }
    .linea.parcial { opacity: .65; font-style: italic; border-left-color: rgba(255,255,255,.4); }
    .t { flex: none; display: inline-flex; align-items: flex-start; font-size: .68rem; color: rgba(255,255,255,.5); font-variant-numeric: tabular-nums; padding-top: .1rem; min-width: 34px; }
    .t mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .txt { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .txt strong { color: var(--c); filter: brightness(1.5); margin-right: .15rem; }
    .txt em { font-style: normal; font-size: .7rem; color: rgba(255,255,255,.5); }
    .txt ::ng-deep a, .adj { color: #93C5FD; }
    .adj { margin-left: .3rem; font-size: .75rem; }
    .marcar { position: absolute; right: 4px; top: 2px; opacity: 0; border: 0; background: rgba(17,24,39,.9); color: #FCD34D; border-radius: 6px;
      width: 26px; height: 26px; min-height: 0 !important; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .marcar mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .linea:hover .marcar, .marcar:focus-visible { opacity: 1; }
    @media (hover: none) { .marcar { opacity: .7; } }
    .momento { margin: .3rem 0; border: 1px solid rgba(245,158,11,.45); background: rgba(245,158,11,.1); border-radius: 12px; padding: .5rem .6rem;
      display: flex; flex-direction: column; gap: .35rem; }
    .momento.ia { border-color: rgba(96,165,250,.45); background: rgba(96,165,250,.1); }
    .m-cab { display: flex; align-items: center; gap: .35rem; flex-wrap: wrap; }
    .m-ico { font-size: 18px; width: 18px; height: 18px; color: #FCD34D; }
    .ia .m-ico { color: #93C5FD; }
    .tipo { font-size: .64rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; background: rgba(255,255,255,.12); padding: .05rem .4rem; border-radius: 999px; }
    .m-cab small { font-size: .68rem; color: rgba(255,255,255,.55); }
    .m-acc { margin-left: auto; display: inline-flex; gap: .1rem; }
    .m-acc button { border: 0; background: transparent; color: rgba(255,255,255,.6); width: 26px; height: 26px; min-height: 0 !important; border-radius: 6px;
      cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .m-acc button:hover { background: rgba(255,255,255,.1); color: #fff; }
    .m-acc mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .m-tit { font-size: .84rem; }
    .m-nota { margin: 0; font-size: .76rem; color: rgba(255,255,255,.75); }
    .captura img { display: block; width: 100%; max-height: 180px; object-fit: contain; background: #000; border-radius: 8px; }
    .momento video { width: 100%; max-height: 200px; border-radius: 8px; background: #000; }
    .momento audio { width: 100%; height: 34px; }
    .prep { display: inline-flex; align-items: center; gap: .25rem; font-size: .72rem; color: rgba(255,255,255,.6); }
    .prep mat-icon { font-size: 14px; width: 14px; height: 14px; }
    details summary { cursor: pointer; font-size: .72rem; color: rgba(255,255,255,.65); }
    details pre { margin: .3rem 0 0; white-space: pre-wrap; font: inherit; font-size: .74rem; color: rgba(255,255,255,.8); max-height: 160px; overflow-y: auto; }
    .nombrar { display: flex; gap: .3rem; }
    .nombrar input { flex: 1; min-width: 0; border-radius: 8px; border: 1px solid rgba(255,255,255,.2); background: rgba(0,0,0,.25); color: #fff; padding: .3rem .5rem; font-size: .8rem; }
    .nombrar button { border: 0; border-radius: 8px; background: #2563EB; color: #fff; padding: .3rem .6rem; font-size: .75rem; cursor: pointer; min-height: 0 !important; }
    .vacio { margin: auto; text-align: center; color: rgba(255,255,255,.55); font-size: .8rem; padding: 1rem; }
    .ir-abajo { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); border: 0; border-radius: 999px; background: #2563EB; color: #fff;
      padding: .3rem .7rem; font-size: .74rem; display: inline-flex; align-items: center; gap: .2rem; cursor: pointer; min-height: 0 !important;
      box-shadow: 0 6px 16px rgba(0,0,0,.35); }
    .ir-abajo mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .estado { padding: .4rem .7rem; border-top: 1px solid rgba(255,255,255,.08); font-size: .7rem; color: rgba(255,255,255,.6); }
    .estado span { display: inline-flex; align-items: center; gap: .3rem; }
    .estado mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .estado .ok i { width: 8px; height: 8px; border-radius: 50%; background: #22C55E; animation: pulso 1.4s infinite; }
    .estado .mal { color: #FCA5A5; }
    .gira { animation: gira 1.2s linear infinite; }
    @keyframes gira { to { transform: rotate(360deg); } }
    @keyframes pulso { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
  `],
})
export class ComLlamadaEnVivo {
  readonly ll = inject(LlamadaService);
  private readonly store = inject(ChatStoreService);
  private readonly api = inject(ComunicacionesApiService);
  private readonly injector = inject(Injector);
  /** Abrir directamente en los momentos (desde el aviso de "momento guardado"). */
  readonly soloMomentos = input(false);

  readonly filtros: { v: Filtro; t: string }[] = [
    { v: 'todo', t: 'Todo' }, { v: 'momentos', t: 'Momentos' }, { v: 'dicho', t: 'Lo dicho' }, { v: 'chat', t: 'Chat' },
  ];
  readonly filtro = signal<Filtro>('todo');
  readonly q = signal('');
  readonly editando = signal<string | null>(null);
  readonly abajo = signal(true);
  readonly yo = computed(() => this.store.miId());
  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');

  readonly items = computed<Item[]>(() => {
    const f = this.filtro();
    const q = this.q().trim().toLowerCase();
    const coincide = (...xs: (string | null | undefined)[]) => !q || xs.some(x => (x ?? '').toLowerCase().includes(q));
    const out: Item[] = [];
    if (f === 'todo' || f === 'dicho') {
      for (const l of this.ll.lineasVivo()) if (coincide(l.texto, l.nombre)) out.push({ clave: 'l' + l.usuario_id + l.cliente_id, ms: l.inicio_ms, linea: l });
    }
    if (f === 'todo' || f === 'chat') {
      for (const c of this.ll.chat()) if (coincide(c.texto, c.autor_nombre)) out.push({ clave: 'c' + (c.cliente_id ?? c.id), ms: c.momento_ms, chat: c });
    }
    if (f === 'todo' || f === 'momentos') {
      for (const m of this.ll.momentos()) if (coincide(m.titulo, m.nota, m.extracto)) out.push({ clave: 'm' + m.id, ms: m.momento_ms, momento: m });
    }
    // A igual tiempo: lo dicho, luego lo escrito y al final el momento (que resume ese tramo).
    const orden = (x: Item) => x.linea ? 0 : x.chat ? 1 : 2;
    return out.sort((a, b) => a.ms - b.ms || orden(a) - orden(b));
  });

  readonly vacio = computed(() => {
    switch (this.filtro()) {
      case 'momentos': return 'Aún no hay momentos. Pulsa ★ “Guardar momento” cuando pase algo importante (o pasa el mouse sobre una frase).';
      case 'chat': return 'Nadie ha escrito en el chat de la llamada.';
      default: return this.ll.actual()?.transcribir ? 'Aquí va apareciendo lo que se dice, lo que se escribe y los momentos importantes.' : 'Esta llamada no se transcribe.';
    }
  });

  constructor() {
    effect(() => {
      if (this.soloMomentos()) untracked(() => this.filtro.set('momentos'));
    });
    // Con cada novedad baja al final, salvo que la persona esté leyendo más arriba.
    effect(() => {
      this.items().length;
      this.ll.parcialVivo();
      untracked(() => { if (this.abajo()) this.bajar(false); });
    });
  }

  marcar(ms: number): void { void this.ll.guardarMomento(null, ms); }

  editar(m: Momento): void { this.editando.set(this.editando() === m.id ? null : m.id); }

  guardarNombre(m: Momento, titulo: string): void {
    this.editando.set(null);
    if (titulo.trim() && titulo.trim() !== m.titulo) this.ll.nombrarMomento(m.id, titulo.trim());
  }

  alDesplazar(): void {
    const el = this.lista()?.nativeElement;
    if (el) this.abajo.set(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }

  bajar(suave: boolean): void {
    afterNextRender(() => {
      const el = this.lista()?.nativeElement;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: suave ? 'smooth' : 'auto' });
      this.abajo.set(true);
    }, { injector: this.injector });
  }

  t(ms: number): string { return mmss(ms); }
  color(id: string | null): string { return colorDe(id); }
  etiqueta(tipo: string): string { return ETIQUETA_TIPO[tipo] ?? tipo; }
  enlaces(t: string | null): string { return textoConEnlaces(t); }
  abs(u: string | null): string | null { return this.api.absoluta(u); }
}
