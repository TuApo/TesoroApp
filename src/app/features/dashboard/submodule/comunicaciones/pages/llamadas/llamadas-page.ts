import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Llamada } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { LlamadaService } from '../../service/llamada.service';
import { duracionLarga, etiquetaDia } from '../../utiles';
import { ComActa } from '../../components/acta/acta';
import { ComAvatar } from '../../components/avatar/avatar';
import { abrirDispositivos } from '../../components/llamada/llamada-dispositivos';

type Filtro = 'todas' | 'perdidas' | 'actas' | 'entrantes' | 'salientes';

/**
 * Historial de llamadas ordenado por día: con quién fue, si entró, salió o se perdió,
 * cuánto duró y de qué se habló (el título del acta). Al elegir una se ve el acta:
 * resumen, decisiones, compromisos y la transcripción de quién dijo qué.
 */
@Component({
  selector: 'app-com-llamadas-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule, ComActa, ComAvatar],
  template: `
    <div class="llamadas" [class.con-acta]="!!elegida()">
      <aside class="lista">
        <div class="cab">
          <div class="busq">
            <label class="buscar"><mat-icon>search</mat-icon>
              <input type="search" placeholder="Buscar por persona o tema" [value]="q()" (input)="q.set($any($event.target).value)"
                     aria-label="Buscar llamadas" /></label>
            <button type="button" class="ajustes" (click)="ajustes()" matTooltip="Micrófono, salida de audio y cámara" aria-label="Audio y video">
              <mat-icon>headset_mic</mat-icon></button>
          </div>
          <div class="filtros" role="tablist" aria-label="Filtrar llamadas">
            @for (f of filtros; track f.v) {
              <button type="button" role="tab" [class.on]="filtro() === f.v" [attr.aria-selected]="filtro() === f.v" (click)="filtro.set(f.v)">
                {{ f.t }} @if (f.v === 'perdidas' && perdidasTotal()) { <b>{{ perdidasTotal() }}</b> }
              </button>
            }
          </div>
        </div>
        <div class="scroll">
          @for (g of grupos(); track g.dia) {
            <h4>{{ g.dia }}</h4>
            @for (l of g.items; track l.id) {
              <div class="fila" role="button" tabindex="0" [class.on]="elegida() === l.id" [class.perdida]="perdidaEntrante(l)"
                   (click)="elegida.set(l.id)" (keydown.enter)="elegida.set(l.id)">
                <span class="av">
                  <app-com-avatar [usuarioId]="otroId(l)" [nombre]="nombre(l)" [tieneFoto]="foto(l)" [grupo]="l.grupo" [tam]="40" />
                  <i class="dir" [attr.data-d]="direccion(l)"><mat-icon>{{ iconoDireccion(l) }}</mat-icon></i>
                </span>
                <span class="txt">
                  <strong>{{ nombre(l) }}</strong>
                  <small><mat-icon>{{ l.tipo === 'VIDEO' ? 'videocam' : 'call' }}</mat-icon>{{ etiquetaDireccion(l) }} · {{ hora(l.creada_en) }}
                    @if (l.estado === 'FINALIZADA') { · {{ dur(l.duracion_seg) }} }</small>
                  @if (l.titulo) { <span class="tema">{{ l.titulo }}</span> }
                </span>
                <span class="der">
                  @switch (l.transcripcion_estado) {
                    @case ('LISTA') { <em class="chip acta"><mat-icon>article</mat-icon>Acta</em> }
                    @case ('PROCESANDO') { <em class="chip"><mat-icon class="gira">autorenew</mat-icon>Transcribiendo</em> }
                    @case ('PENDIENTE') { <em class="chip"><mat-icon>hourglass_top</mat-icon>En cola</em> }
                    @case ('ERROR') { <em class="chip err">Sin acta</em> }
                  }
                  <span class="botones">
                    <button type="button" class="ico" (click)="$event.stopPropagation(); abrirChat(l)" matTooltip="Abrir el chat"
                            aria-label="Abrir el chat"><mat-icon>chat_bubble_outline</mat-icon></button>
                    <button type="button" class="ico verde" (click)="$event.stopPropagation(); rellamar(l)" [disabled]="ll.enLlamada()"
                            [matTooltip]="l.tipo === 'VIDEO' ? 'Videollamar de nuevo' : 'Llamar de nuevo'" aria-label="Volver a llamar">
                      <mat-icon>{{ l.tipo === 'VIDEO' ? 'videocam' : 'call' }}</mat-icon></button>
                  </span>
                </span>
              </div>
            }
          } @empty {
            <div class="vacio">
              <mat-icon>{{ cargando() ? 'hourglass_top' : 'phone_in_talk' }}</mat-icon>
              <p>{{ cargando() ? 'Cargando…' : (q() || filtro() !== 'todas' ? 'Ninguna llamada coincide.' : 'Todavía no hay llamadas.') }}</p>
              @if (!cargando() && !q() && filtro() === 'todas') {
                <small>Llama desde un chat o desde <button type="button" (click)="irAPersonas()">Personas</button>. Las llamadas se
                  transcriben y quedan aquí con su acta.</small>
              }
            </div>
          }
        </div>
      </aside>
      <section class="detalle">
        @if (elegida(); as id) {
          <button type="button" class="volver" (click)="elegida.set(null)"><mat-icon>arrow_back</mat-icon> Llamadas</button>
          @for (x of [id]; track x) { <app-com-acta [llamadaId]="x" /> }
        } @else {
          <div class="vacio-grande"><mat-icon>record_voice_over</mat-icon>
            <h3>Actas de llamadas</h3>
            <p>Elige una llamada para ver su acta: resumen, decisiones, compromisos y la transcripción de quién dijo qué.</p></div>
        }
      </section>
    </div>`,
  styles: [`
    :host { display: block; height: 100%; }
    .llamadas { display: grid; grid-template-columns: 380px minmax(0, 1fr); height: 100%; }
    .lista { border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; min-width: 0; }
    .cab { padding: .7rem .7rem .45rem; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: .45rem; }
    .busq { display: flex; align-items: center; gap: .4rem; }
    .buscar { display: flex; align-items: center; gap: .35rem; border-radius: 999px; padding: .35rem .75rem; background: var(--surface-3);
      flex: 1; min-width: 0; width: auto; }
    .ajustes { flex: none; width: 38px; height: 38px; min-height: 0 !important; border-radius: 50%; border: 1px solid var(--border);
      background: var(--surface); color: var(--text-2); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .ajustes:hover { background: var(--surface-3); }
    .ajustes mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .buscar mat-icon { color: var(--muted); font-size: 20px; width: 20px; height: 20px; }
    .buscar input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: .86rem; color: var(--text); }
    .filtros { display: flex; flex-wrap: wrap; gap: .3rem; }
    .filtros button { display: inline-flex; align-items: center; gap: .3rem; border: 1px solid var(--border); background: var(--surface);
      border-radius: 999px; padding: .22rem .65rem; font: inherit; font-size: .76rem; color: var(--text-2); cursor: pointer; white-space: nowrap; }
    .filtros button.on { background: var(--info-bg); border-color: var(--info-border); color: var(--info-fg); font-weight: 700; }
    .filtros b { background: #DC2626; color: #fff; border-radius: 999px; font-size: .66rem; padding: 0 .35rem; }
    .scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 .4rem .8rem; }
    h4 { margin: .8rem .45rem .25rem; font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
    .fila { display: flex; align-items: center; gap: .65rem; border-radius: 12px; padding: .5rem; cursor: pointer; outline: none; }
    .fila:hover, .fila:focus-visible { background: var(--surface-3); }
    .fila.on { background: var(--info-bg); }
    .av { position: relative; flex: none; display: inline-flex; }
    .dir { position: absolute; right: -3px; bottom: -3px; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center;
      justify-content: center; border: 2px solid var(--surface); background: #16A34A; color: #fff; font-style: normal; }
    .dir[data-d='saliente'] { background: #2563EB; }
    .dir[data-d='perdida'] { background: #DC2626; }
    .dir mat-icon { font-size: 11px; width: 11px; height: 11px; }
    .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .05rem; }
    .txt strong { font-size: .88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .perdida .txt strong { color: #DC2626; }
    .txt small { display: flex; align-items: center; gap: .2rem; font-size: .72rem; color: var(--muted); white-space: nowrap; overflow: hidden; }
    .txt small mat-icon { font-size: 14px; width: 14px; height: 14px; flex: none; }
    .tema { font-size: .74rem; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .der { display: flex; flex-direction: column; align-items: flex-end; gap: .2rem; flex: none; }
    .chip { display: inline-flex; align-items: center; gap: .15rem; font-style: normal; font-size: .64rem; font-weight: 700; color: var(--text-2);
      background: var(--surface-3); border-radius: 999px; padding: .05rem .45rem .05rem .3rem; }
    .chip mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .chip.acta { background: var(--info-bg); color: var(--info-fg); }
    .chip.err { background: var(--danger-bg); color: var(--danger-fg); padding-left: .45rem; }
    .botones { display: flex; gap: .1rem; }
    .ico { border: 0; background: transparent; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; color: var(--text-2);
      display: inline-flex; align-items: center; justify-content: center; }
    .ico mat-icon { font-size: 19px; width: 19px; height: 19px; }
    .ico:hover { background: var(--surface); color: var(--primary); }
    .ico.verde { color: #16A34A; }
    .ico:disabled { opacity: .35; cursor: default; }
    .detalle { min-height: 0; min-width: 0; display: flex; flex-direction: column; }
    .detalle app-com-acta { flex: 1; min-height: 0; }
    .volver { display: none; }
    .vacio { color: var(--muted); text-align: center; font-size: .85rem; padding: 2.5rem 1rem; }
    .vacio mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
    .vacio p { margin: .4rem 0; color: var(--text-2); font-weight: 600; }
    .vacio button { border: 0; background: transparent; color: var(--primary); font: inherit; font-weight: 700; cursor: pointer; padding: 0; }
    .vacio-grande { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: var(--muted);
      padding: 2rem; background: radial-gradient(circle at 50% 35%, var(--surface-2), var(--surface) 70%); }
    .vacio-grande mat-icon { font-size: 56px; width: 56px; height: 56px; color: var(--primary); opacity: .65; }
    .vacio-grande h3 { margin: .5rem 0 .2rem; color: var(--text); }
    .vacio-grande p { max-width: 420px; line-height: 1.5; margin: 0; }
    .gira { animation: gira 1.2s linear infinite; }
    @keyframes gira { to { transform: rotate(360deg); } }
    @media (max-width: 900px) {
      .llamadas { grid-template-columns: minmax(0, 1fr); }
      .llamadas.con-acta .lista { display: none; }
      .llamadas:not(.con-acta) .detalle { display: none; }
      .lista { border-right: 0; }
      .volver { display: inline-flex; align-items: center; gap: .2rem; border: 0; border-bottom: 1px solid var(--border); background: var(--surface);
        color: var(--primary); padding: .6rem .8rem; cursor: pointer; font: inherit; font-weight: 600; }
    }
  `],
})
export class LlamadasPage implements OnInit {
  private readonly api = inject(ComunicacionesApiService);
  private readonly store = inject(ChatStoreService);
  private readonly router = inject(Router);
  readonly ll = inject(LlamadaService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);

  readonly filtros: { v: Filtro; t: string }[] = [
    { v: 'todas', t: 'Todas' }, { v: 'perdidas', t: 'Perdidas' }, { v: 'actas', t: 'Con acta' },
    { v: 'entrantes', t: 'Entrantes' }, { v: 'salientes', t: 'Salientes' },
  ];
  readonly llamadas = signal<Llamada[]>([]);
  readonly cargando = signal(true);
  readonly elegida = signal<string | null>(null);
  readonly filtro = signal<Filtro>('todas');
  readonly q = signal('');
  readonly perdidasTotal = computed(() => this.llamadas().filter(l => this.perdidaEntrante(l)).length);

  readonly grupos = computed(() => {
    const f = this.filtro();
    const q = this.q().trim().toLowerCase();
    const lista = this.llamadas().filter(l => {
      const ok = f === 'todas' || (f === 'actas' ? l.transcripcion_estado === 'LISTA'
        : f === 'perdidas' ? this.perdidaEntrante(l)
        : f === 'entrantes' ? this.entrante(l) : !this.entrante(l));
      if (!ok) return false;
      if (!q) return true;
      return `${this.nombre(l)} ${l.titulo ?? ''} ${l.participantes.map(p => p.nombre).join(' ')}`.toLowerCase().includes(q);
    });
    const out: { dia: string; items: Llamada[] }[] = [];
    for (const l of lista) {
      const dia = etiquetaDia(l.creada_en);
      const g = out.find(x => x.dia === dia);
      if (g) g.items.push(l); else out.push({ dia, items: [l] });
    }
    return out;
  });

  ngOnInit(): void {
    this.cargar();
    this.store.eventos$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ nombre, datos }) => {
      if ((nombre === 'llamada' && datos?.evento === 'finalizada') || nombre === 'transcripcion') this.cargar();
    });
  }

  cargar(): void {
    this.api.historial(undefined, 200).subscribe({
      next: l => { this.llamadas.set(l); this.cargando.set(false); this.store.marcarLlamadasVistas(); },
      error: () => this.cargando.set(false),
    });
  }

  /** Micrófono, salida de audio y cámara para las próximas llamadas. */
  ajustes(): void { abrirDispositivos(this.dialog); }

  otroId(l: Llamada): string | null {
    if (l.grupo) return null;
    const yo = this.store.miId();
    return l.participantes.find(p => p.usuario_id !== yo)?.usuario_id ?? null;
  }
  nombre(l: Llamada): string {
    if (l.grupo) return l.conversacion_nombre ?? 'Grupo';
    const yo = this.store.miId();
    return l.participantes.filter(p => p.usuario_id !== yo).map(p => p.nombre).join(', ') || l.conversacion_nombre || 'Llamada';
  }
  foto(l: Llamada): boolean {
    const otro = this.otroId(l);
    return !!otro && !!this.store.conversacion(l.conversacion_id)?.participantes.find(p => p.usuario_id === otro)?.tiene_foto;
  }
  entrante(l: Llamada): boolean { return l.iniciada_por !== this.store.miId(); }
  perdidaEntrante(l: Llamada): boolean { return this.entrante(l) && (l.estado === 'PERDIDA' || l.estado === 'CANCELADA'); }
  direccion(l: Llamada): 'entrante' | 'saliente' | 'perdida' {
    if (this.perdidaEntrante(l)) return 'perdida';
    return this.entrante(l) ? 'entrante' : 'saliente';
  }
  iconoDireccion(l: Llamada): string {
    return { perdida: 'call_missed', entrante: 'call_received', saliente: 'call_made' }[this.direccion(l)];
  }
  etiquetaDireccion(l: Llamada): string {
    if (this.perdidaEntrante(l)) return 'Perdida';
    if (l.estado === 'RECHAZADA') return this.entrante(l) ? 'Rechazada' : 'No contestó';
    if (l.estado === 'PERDIDA' || l.estado === 'CANCELADA') return 'Sin respuesta';
    if (l.estado === 'SONANDO' || l.estado === 'EN_CURSO') return 'En curso';
    return this.entrante(l) ? 'Entrante' : 'Saliente';
  }
  hora(iso: string): string { return new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }); }
  dur(s: number | null): string { return duracionLarga(s); }
  rellamar(l: Llamada): void { void this.ll.llamar(l.conversacion_id, l.tipo); }
  abrirChat(l: Llamada): void {
    void this.router.navigate(['/dashboard/comunicaciones/chats'], { queryParams: { c: l.conversacion_id } });
  }
  irAPersonas(): void { void this.router.navigate(['/dashboard/comunicaciones/personas']); }
}
