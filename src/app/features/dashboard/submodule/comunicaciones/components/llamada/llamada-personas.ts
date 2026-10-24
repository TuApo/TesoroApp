import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';
import { ParticipanteLlamada, UsuarioDir } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { LlamadaService } from '../../service/llamada.service';
import { ComAvatar } from '../avatar/avatar';

/**
 * Quién está en la llamada, a quién le está sonando y quién ya salió (para volver a
 * llamarlo), más el buscador para sumar a alguien: se busca por nombre, cargo, sede o
 * empresa y se le llama de una vez, sea o no del chat.
 */
@Component({
  selector: 'app-com-llamada-personas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ComAvatar],
  template: `
    <div class="pers">
      <label class="buscar-ll">
        <mat-icon>person_search</mat-icon>
        <input type="search" placeholder="Buscar a alguien para sumarlo" aria-label="Buscar a alguien para sumarlo a la llamada"
               [value]="texto()" (input)="escribir($any($event.target).value)" />
      </label>
      <small class="cupo">{{ ocupados() }} de {{ ll.maxParticipantes() }} lugares · también puedes llamar a quien no esté en este chat</small>

      @if (texto().trim().length >= 2) {
        <div class="bloque">
          <h4>Resultados</h4>
          @for (u of resultados(); track u.id) {
            <div class="fila">
              <app-com-avatar [usuarioId]="u.id" [nombre]="u.nombre" [tieneFoto]="u.tiene_foto" [presencia]="u.en_linea" [tam]="34" />
              <span class="txt"><strong>{{ u.nombre }}</strong><small>{{ detalle(u) }}</small></span>
              @switch (estadoDe(u.id)) {
                @case ('CONECTADO') { <em class="est">En la llamada</em> }
                @case ('INVITADO') { <em class="est">Sonando…</em> }
                @default {
                  <button type="button" class="llamar" (click)="llamar(u.id)" [disabled]="lleno() || llamando().has(u.id)">
                    <mat-icon>add_call</mat-icon>{{ llamando().has(u.id) ? 'Llamando' : 'Llamar' }}</button>
                }
              }
            </div>
          } @empty {
            <p class="vacio">{{ buscando() ? 'Buscando…' : 'No se encontró a nadie con “' + texto().trim() + '”.' }}</p>
          }
        </div>
      }

      <div class="bloque">
        <h4>En la llamada · {{ conectados().length }}</h4>
        @for (p of conectados(); track p.usuario_id) {
          <div class="fila">
            <app-com-avatar [usuarioId]="p.usuario_id" [nombre]="p.nombre" [tieneFoto]="foto(p.usuario_id)" [tam]="34" />
            <span class="txt"><strong>{{ p.nombre }}@if (p.usuario_id === yo()) { <em>(tú)</em> }</strong>
              @if (p.invitado_por_nombre) { <small>La sumó {{ p.invitado_por_nombre }}</small> }</span>
            @if (sinMic(p.usuario_id)) { <mat-icon class="mic-off" aria-label="Micrófono apagado">mic_off</mat-icon> }
          </div>
        }
      </div>

      @if (sonando().length) {
        <div class="bloque">
          <h4>Sonando · {{ sonando().length }}</h4>
          @for (p of sonando(); track p.usuario_id) {
            <div class="fila">
              <app-com-avatar [usuarioId]="p.usuario_id" [nombre]="p.nombre" [tieneFoto]="foto(p.usuario_id)" [tam]="34" />
              <span class="txt"><strong>{{ p.nombre }}</strong><small>Le está sonando…</small></span>
              <mat-icon class="timbre">ring_volume</mat-icon>
            </div>
          }
        </div>
      }

      @if (fuera().length) {
        <div class="bloque">
          <h4>No están</h4>
          @for (p of fuera(); track p.usuario_id) {
            <div class="fila">
              <app-com-avatar [usuarioId]="p.usuario_id" [nombre]="p.nombre" [tieneFoto]="foto(p.usuario_id)" [tam]="34" />
              <span class="txt"><strong>{{ p.nombre }}</strong><small>{{ etiqueta(p) }}</small></span>
              <button type="button" class="llamar" (click)="llamar(p.usuario_id)" [disabled]="lleno() || llamando().has(p.usuario_id)">
                <mat-icon>phone_callback</mat-icon>Volver a llamar</button>
            </div>
          }
        </div>
      }

      @if (puedeTerminar()) {
        <button type="button" class="terminar" (click)="terminar.emit()"><mat-icon>call_end</mat-icon> Terminar para todos</button>
      }
    </div>`,
  styles: [`
    :host { display: block; }
    .pers { display: flex; flex-direction: column; gap: .6rem; padding: .8rem; }
    .buscar-ll { display: flex; align-items: center; gap: .4rem; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14);
      border-radius: 12px; padding: 0 .6rem; height: 42px; }
    .buscar-ll:focus-within { border-color: #60A5FA; }
    .buscar-ll mat-icon { color: rgba(255,255,255,.6); font-size: 20px; width: 20px; height: 20px; }
    .buscar-ll input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: #fff; font-size: .85rem; }
    .buscar-ll input::placeholder { color: rgba(255,255,255,.5); }
    .cupo { color: rgba(255,255,255,.55); font-size: .72rem; }
    .bloque { display: flex; flex-direction: column; gap: .15rem; }
    h4 { margin: .4rem 0 .2rem; font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: rgba(255,255,255,.55); }
    .fila { display: flex; align-items: center; gap: .55rem; padding: .35rem .3rem; border-radius: 10px; }
    .fila:hover { background: rgba(255,255,255,.05); }
    .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .txt strong { font-size: .84rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .txt strong em { font-style: normal; font-weight: 400; color: rgba(255,255,255,.6); }
    .txt small { font-size: .72rem; color: rgba(255,255,255,.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .est { font-style: normal; font-size: .72rem; color: rgba(255,255,255,.6); flex: none; }
    .llamar { flex: none; display: inline-flex; align-items: center; gap: .25rem; border: 0; border-radius: 999px; padding: .3rem .7rem;
      min-height: 0 !important; background: #16A34A; color: #fff; font-size: .75rem; font-weight: 700; cursor: pointer; }
    .llamar:disabled { opacity: .5; cursor: default; }
    .llamar mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .mic-off { color: #FCA5A5; font-size: 18px; width: 18px; height: 18px; }
    .timbre { color: #86EFAC; font-size: 18px; width: 18px; height: 18px; animation: vibra 1.2s infinite; }
    .vacio { margin: .3rem 0; font-size: .78rem; color: rgba(255,255,255,.6); }
    .terminar { margin-top: .6rem; display: inline-flex; align-items: center; justify-content: center; gap: .3rem; border: 1px solid rgba(239,68,68,.5);
      background: transparent; color: #FCA5A5; border-radius: 12px; padding: .5rem; cursor: pointer; font-weight: 600; }
    @keyframes vibra { 0%, 100% { transform: rotate(0); } 15% { transform: rotate(-14deg); } 30% { transform: rotate(14deg); } 45% { transform: rotate(0); } }
  `],
})
export class ComLlamadaPersonas {
  readonly ll = inject(LlamadaService);
  private readonly store = inject(ChatStoreService);
  private readonly api = inject(ComunicacionesApiService);
  readonly puedeTerminar = input(false);
  readonly terminar = output<void>();

  readonly texto = signal('');
  readonly resultados = signal<UsuarioDir[]>([]);
  readonly buscando = signal(false);
  readonly llamando = signal<Set<string>>(new Set());
  private readonly busqueda$ = new Subject<string>();

  readonly yo = computed(() => this.store.miId());
  private readonly participantes = computed(() => this.ll.actual()?.participantes ?? []);
  readonly conectados = computed(() => this.participantes().filter(p => p.estado === 'CONECTADO')
    .sort((a, b) => (a.usuario_id === this.yo() ? -1 : b.usuario_id === this.yo() ? 1 : a.nombre.localeCompare(b.nombre))));
  readonly sonando = computed(() => this.participantes().filter(p => p.estado === 'INVITADO'));
  readonly fuera = computed(() => this.participantes().filter(p => ['SALIO', 'RECHAZO', 'PERDIDA'].includes(p.estado)));
  readonly ocupados = computed(() => this.conectados().length + this.sonando().length);
  readonly lleno = computed(() => this.ocupados() >= this.ll.maxParticipantes());

  constructor() {
    this.busqueda$.pipe(
      debounceTime(250),
      switchMap(q => q.length < 2 ? of([]) : this.api.buscarPersonas(q, 10).pipe(catchError(() => of([])))),
      takeUntilDestroyed(inject(DestroyRef)),
    ).subscribe(xs => {
      this.resultados.set(xs.filter(u => u.id !== this.yo()));
      this.buscando.set(false);
    });
  }

  escribir(q: string): void {
    this.texto.set(q);
    this.buscando.set(q.trim().length >= 2);
    this.busqueda$.next(q.trim());
  }

  async llamar(id: string): Promise<void> {
    this.llamando.update(s => new Set(s).add(id));
    await this.ll.invitar([id]);
    this.llamando.update(s => { const n = new Set(s); n.delete(id); return n; });
  }

  estadoDe(id: string): string | null {
    return this.participantes().find(p => p.usuario_id === id)?.estado ?? null;
  }

  sinMic(id: string): boolean {
    if (id === this.yo()) return !this.ll.mic();
    return this.ll.remotos().some(r => r.usuarioId === id && !r.mic);
  }

  foto(id: string): boolean {
    return this.store.conversacion(this.ll.actual()?.conversacion_id)?.participantes.find(p => p.usuario_id === id)?.tiene_foto ?? false;
  }

  detalle(u: UsuarioDir): string {
    return [u.cargo, u.lugar].filter(Boolean).join(' · ') || (u.rol ?? '');
  }

  etiqueta(p: ParticipanteLlamada): string {
    switch (p.estado) {
      case 'SALIO': return 'Salió de la llamada';
      case 'RECHAZO': return 'No contestó (rechazó)';
      default: return 'No alcanzó a contestar';
    }
  }
}
