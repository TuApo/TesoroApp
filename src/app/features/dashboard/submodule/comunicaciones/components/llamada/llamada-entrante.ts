import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Llamada, ParticipanteLlamada } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { LlamadaService } from '../../service/llamada.service';
import { ComAvatar } from '../avatar/avatar';

/** Tarjeta de llamada entrante (timbra hasta contestar, rechazar o que cuelguen). */
@Component({
  selector: 'app-com-llamada-entrante',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ComAvatar],
  template: `
    <div class="pila">
      @for (l of ll.entrantes(); track l.id) {
        @let inv = invitacion(l);
        <div class="tarjeta" role="alertdialog" [attr.aria-label]="'Llamada de ' + (inv?.invitado_por_nombre ?? l.iniciada_por_nombre)">
          <div class="ondas"><app-com-avatar [usuarioId]="inv?.invitado_por ?? l.iniciada_por" [nombre]="inv?.invitado_por_nombre ?? l.iniciada_por_nombre"
            [tieneFoto]="foto(l)" [tam]="52" /></div>
          <div class="txt">
            <strong>{{ inv?.invitado_por_nombre ?? l.iniciada_por_nombre }}</strong>
            @if (inv) {
              <small>Te suma a una {{ l.tipo === 'VIDEO' ? 'videollamada' : 'llamada' }} en curso{{ l.grupo ? ' en ' + l.conversacion_nombre : '' }}</small>
              @if (conQuien(l); as quienes) { <small class="con">Con {{ quienes }}</small> }
            } @else {
              <small>{{ l.tipo === 'VIDEO' ? 'Videollamada' : 'Llamada de voz' }}{{ l.grupo ? ' en ' + l.conversacion_nombre : '' }}</small>
            }
            @if (l.transcribir) { <small class="tr"><mat-icon>subtitles</mat-icon> Se transcribirá para el acta</small> }
          </div>
          <div class="acc">
            <button type="button" class="rechazar" (click)="ll.rechazar(l)" aria-label="Rechazar"><mat-icon>call_end</mat-icon></button>
            @if (l.tipo === 'VIDEO') {
              <button type="button" class="contestar" (click)="ll.contestar(l, true)" aria-label="Contestar con video"><mat-icon>videocam</mat-icon></button>
            }
            <button type="button" class="contestar" (click)="ll.contestar(l, false)" aria-label="Contestar"><mat-icon>call</mat-icon></button>
          </div>
        </div>
      }
    </div>`,
  styles: [`
    .pila { position: fixed; top: 76px; right: 48px; z-index: 1400; display: flex; flex-direction: column; gap: .6rem; }
    .tarjeta { width: 340px; max-width: calc(100vw - 32px); display: flex; align-items: center; gap: .75rem; padding: .8rem;
      background: #111827; color: #fff; border-radius: 18px; box-shadow: 0 20px 50px rgba(0,0,0,.45); animation: entra .25s ease-out; }
    .ondas { border-radius: 50%; animation: ondas 1.6s infinite; }
    .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .1rem; }
    .txt strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .txt small { color: rgba(255,255,255,.75); font-size: .75rem; }
    .con { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tr { display: inline-flex; align-items: center; gap: .2rem; color: #FCA5A5 !important; }
    .tr mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .acc { display: flex; gap: .4rem; }
    .acc button { border: 0; width: 44px; height: 44px; border-radius: 50%; color: #fff; cursor: pointer; display: inline-flex;
      align-items: center; justify-content: center; }
    .rechazar { background: #DC2626; }
    .contestar { background: #16A34A; animation: vibra 1.2s infinite; }
    @keyframes ondas { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.55); } 100% { box-shadow: 0 0 0 14px rgba(34,197,94,0); } }
    @keyframes vibra { 0%, 100% { transform: rotate(0); } 10%, 30% { transform: rotate(-12deg); } 20%, 40% { transform: rotate(12deg); } 50% { transform: rotate(0); } }
    @keyframes entra { from { transform: translateY(-12px); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (max-width: 600px) { .pila { top: 12px; right: 16px; left: 16px; } .tarjeta { width: auto; } }
  `],
})
export class ComLlamadaEntrante {
  readonly ll = inject(LlamadaService);
  private readonly store = inject(ChatStoreService);
  foto(l: Llamada): boolean {
    const quien = this.invitacion(l)?.invitado_por ?? l.iniciada_por;
    return this.store.conversacion(l.conversacion_id)?.participantes.find(p => p.usuario_id === quien)?.tiene_foto ?? false;
  }

  /** Me sumaron a una llamada ya empezada (puede que ni siquiera sea del chat). */
  invitacion(l: Llamada): ParticipanteLlamada | null {
    const mio = l.participantes.find(p => p.usuario_id === this.store.miId());
    return mio?.invitado_por_nombre ? mio : null;
  }

  /** Quiénes ya están en la llamada a la que me suman. */
  conQuien(l: Llamada): string {
    const yo = this.store.miId();
    return l.participantes.filter(p => p.estado === 'CONECTADO' && p.usuario_id !== yo).map(p => p.nombre.split(' ')[0]).join(', ');
  }
}
