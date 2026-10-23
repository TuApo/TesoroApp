import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChatStoreService } from '../../service/chat-store.service';
import { DispositivosService } from '../../service/dispositivos.service';
import { LlamadaService } from '../../service/llamada.service';
import { mmss } from '../../utiles';
import { ComAvatar } from '../avatar/avatar';
import { ComAsistentePanel } from '../asistente/asistente-panel';
import { ComLlamadaChat } from './llamada-chat';
import { ComLlamadaDispositivos } from './llamada-dispositivos';
import { ComLlamadaEnVivo } from './llamada-envivo';
import { ComLlamadaPersonas } from './llamada-personas';
import { SrcObjectDirective } from './src-object.directive';

type Lateral = 'personas' | 'chat' | 'vivo' | 'ia' | 'audio';

/**
 * La llamada en curso: mosaico de participantes, controles, aviso de transcripción y
 * un panel lateral con las personas (para sumar a alguien), el chat de la llamada y
 * el micrófono, la salida de audio y la cámara.
 */
@Component({
  selector: 'app-com-llamada-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule, ComAvatar, SrcObjectDirective, ComLlamadaChat, ComLlamadaDispositivos, ComLlamadaPersonas,
    ComLlamadaEnVivo, ComAsistentePanel],
  templateUrl: './llamada-panel.html',
  styleUrl: './llamada-panel.css',
})
export class ComLlamadaPanel implements OnDestroy {
  readonly ll = inject(LlamadaService);
  readonly disp = inject(DispositivosService);
  private readonly store = inject(ChatStoreService);
  readonly ahora = signal(Date.now());
  readonly grande = signal(false);
  readonly lateral = signal<Lateral | null>(null);
  private readonly reloj = setInterval(() => this.ahora.set(Date.now()), 1000);

  readonly conv = computed(() => this.store.conversacion(this.ll.actual()?.conversacion_id));
  /** El grupo, la otra persona del 1 a 1 o, para quien entró invitado sin ser del chat, quienes están. */
  readonly titulo = computed(() => {
    const l = this.ll.actual();
    if (!l) return 'Llamada';
    const c = this.conv();
    if (c) return c.nombre;
    if (l.conversacion_nombre) return l.conversacion_nombre;
    const yo = this.store.miId();
    const otros = l.participantes.filter(p => p.usuario_id !== yo && p.estado === 'CONECTADO').map(p => p.nombre.split(' ')[0]);
    return otros.length ? 'Llamada con ' + otros.join(', ') : 'Llamada';
  });
  readonly duracion = computed(() => {
    const i = this.ll.inicio();
    return i ? mmss(this.ahora() - i) : '';
  });
  readonly estadoTexto = computed(() => {
    switch (this.ll.fase()) {
      case 'saliente': return 'Llamando…';
      case 'conectando': return 'Conectando…';
      case 'en_curso': return this.duracion();
      default: return '';
    }
  });
  /** Invitados que aún no contestan (se muestran como "sonando"). */
  readonly esperando = computed(() => {
    const yo = this.store.miId();
    const conectados = new Set(this.ll.remotos().map(r => r.usuarioId));
    return (this.ll.actual()?.participantes ?? []).filter(p => p.usuario_id !== yo && p.estado === 'INVITADO' && !conectados.has(p.usuario_id));
  });
  readonly enLaLlamada = computed(() => (this.ll.actual()?.participantes ?? []).filter(p => p.estado === 'CONECTADO').length);
  readonly hayVideo = computed(() => this.ll.remotos().some(r => r.cam) || !!this.ll.pistaVideoPropia() || this.ll.cam());
  readonly soyQuienLlamo = computed(() => this.ll.actual()?.iniciada_por === this.store.miId());
  t(ms: number): string { return mmss(ms); }
  readonly fotoDe = (id: string) => this.conv()?.participantes.find(p => p.usuario_id === id)?.tiene_foto ?? false;

  /** El aviso "momento guardado" se va solo si nadie lo toca. */
  private temporizadorMomento: ReturnType<typeof setTimeout> | null = null;
  readonly guardandoMomento = signal(false);

  constructor() {
    // Una llamada nueva arranca con el panel lateral cerrado.
    effect(() => { if (!this.ll.enLlamada()) this.lateral.set(null); });
    effect(() => {
      const m = this.ll.momentoReciente();
      if (this.temporizadorMomento) clearTimeout(this.temporizadorMomento);
      if (m) this.temporizadorMomento = setTimeout(() => this.ll.momentoReciente.set(null), 15_000);
    });
  }

  async guardarMomento(): Promise<void> {
    if (this.guardandoMomento()) return;
    this.guardandoMomento.set(true);
    await this.ll.guardarMomento();
    this.guardandoMomento.set(false);
  }

  nombrarReciente(titulo: string): void {
    const m = this.ll.momentoReciente();
    if (!m) return;
    if (titulo.trim()) this.ll.nombrarMomento(m.id, titulo.trim());
    this.ll.momentoReciente.set(null);
  }

  /** El borrador del asistente va al chat de la llamada (ahí todos lo ven y queda en el acta). */
  usarEnChat(texto: string): void {
    this.ll.escribirChat(texto);
    this.lateral.set('chat');
  }

  verMomento(): void { this.lateral.set('vivo'); }

  alternar(t: Lateral): void {
    this.lateral.set(this.lateral() === t ? null : t);
    if (this.lateral() === 'chat') this.ll.marcarChatLeido();
  }

  abrirChat(): void {
    this.ll.minimizada.set(false);
    this.lateral.set('chat');
    this.ll.marcarChatLeido();
  }

  ngOnDestroy(): void {
    clearInterval(this.reloj);
    if (this.temporizadorMomento) clearTimeout(this.temporizadorMomento);
  }
}
