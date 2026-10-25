import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Conversacion } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { LlamadaService } from '../../service/llamada.service';
import { SOPORTE_BOT, actividad, cargoYLugar, etiquetaAlcance, iconoConversacion, primerNombre } from '../../utiles';
import { ComAvatar } from '../avatar/avatar';
import { abrirAsistente } from '../asistente/asistente-dialog';

/** Encabezado de una conversación: quién es, si está conectado, y los botones de llamar. */
@Component({
  selector: 'app-com-cabecera',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatMenuModule, MatTooltipModule, ComAvatar],
  template: `
    <div class="cab" [class.ventana]="modo() === 'ventana'" [class.resaltada]="resaltada()" (click)="alternar.emit()">
      <app-com-avatar [usuarioId]="c().otro_usuario_id" [nombre]="c().nombre" [tieneFoto]="fotoOtro()" [grupo]="c().tipo === 'GRUPO'"
        [icono]="icono()" [color]="c().color ?? (soporte() ? '#0B6B58' : null)" [tam]="modo() === 'ventana' ? 32 : 40"
        [presencia]="c().tipo === 'DIRECTA' ? enLinea() : null" [coordinador]="!!otro()?.coordinador" />
      <div class="txt" [attr.title]="c().nombre">
        <strong>{{ c().nombre }}</strong>
        <small [class.escribe]="escriben().length" [class.en-linea]="c().tipo === 'DIRECTA' && enLinea() && !escriben().length">{{ subtitulo() }}</small>
      </div>
      @if (minimizada() && c().no_leidos > 0) { <span class="badge">{{ c().no_leidos > 99 ? '99+' : c().no_leidos }}</span> }
      @if (!minimizada()) {
        <div class="acc" (click)="$event.stopPropagation()">
          @if (sePuedeLlamar()) {
            <button type="button" (click)="llamar('AUDIO')" [disabled]="enLlamada()" matTooltip="Llamada de voz" aria-label="Llamada de voz"><mat-icon>call</mat-icon></button>
            <button type="button" (click)="llamar('VIDEO')" [disabled]="enLlamada()" matTooltip="Videollamada" aria-label="Videollamada"><mat-icon>videocam</mat-icon></button>
          }
          @if (!soporte()) {
            <button type="button" class="ia" (click)="asistente()" matTooltip="Asistente IA: resume, busca y redacta" aria-label="Asistente IA"><mat-icon>auto_awesome</mat-icon></button>
          }
          @if (soporte() && c().soporte_estado !== 'HUMANO' && esMiSoporte()) {
            <button type="button" (click)="escalar()" [disabled]="ocupado()" matTooltip="Hablar con una persona" aria-label="Hablar con una persona"><mat-icon>support_agent</mat-icon></button>
          }
          <button type="button" [matMenuTriggerFor]="mas" aria-label="Más opciones"><mat-icon>more_vert</mat-icon></button>
          <mat-menu #mas="matMenu">
            @if (sePuedeLlamar()) {
              <button mat-menu-item (click)="llamar('AUDIO', false)"><mat-icon>call</mat-icon> Llamar sin transcribir</button>
              <button mat-menu-item (click)="llamar('VIDEO', false)"><mat-icon>videocam</mat-icon> Videollamada sin transcribir</button>
            }
            @if (soporte()) {
              @if (c().soporte_estado === 'HUMANO') {
                <button mat-menu-item (click)="cerrarSoporte()"><mat-icon>smart_toy</mat-icon>
                  {{ esMiSoporte() ? 'Volver al asistente' : 'Cerrar la atención' }}</button>
              } @else if (esMiSoporte()) {
                <button mat-menu-item (click)="escalar()"><mat-icon>support_agent</mat-icon> Hablar con una persona</button>
              }
            }
            @if (modo() === 'ventana') {
              <button mat-menu-item (click)="maximizar.emit()"><mat-icon>open_in_full</mat-icon> Abrir en pantalla completa</button>
            }
            @if (!soporte()) {
              <button mat-menu-item (click)="info.emit()"><mat-icon>info</mat-icon> {{ c().alcance_tipo ? 'Detalles y personas del grupo' : 'Detalles, archivos y compromisos' }}</button>
            }
            <button mat-menu-item (click)="silenciar()"><mat-icon>{{ c().silenciada ? 'notifications_active' : 'notifications_off' }}</mat-icon>
              {{ c().silenciada ? 'Activar avisos' : 'Silenciar' }}</button>
          </mat-menu>
        </div>
      }
      @if (modo() === 'ventana') {
        <div class="acc" (click)="$event.stopPropagation()">
          <button type="button" (click)="alternar.emit()" [attr.aria-label]="minimizada() ? 'Abrir' : 'Minimizar'"><mat-icon>{{ minimizada() ? 'expand_less' : 'remove' }}</mat-icon></button>
          <button type="button" (click)="cerrar.emit()" aria-label="Cerrar"><mat-icon>close</mat-icon></button>
        </div>
      }
    </div>
    @if (llamadaAjena(); as ll) {
      <div class="en-curso" (click)="$event.stopPropagation()">
        <span class="pulso"></span>
        <span>{{ ll.tipo === 'VIDEO' ? 'Videollamada' : 'Llamada' }} en curso · {{ ll.conectados.length }} conectado{{ ll.conectados.length === 1 ? '' : 's' }}</span>
        <button type="button" (click)="unirse()"><mat-icon>call</mat-icon> Unirse</button>
      </div>
    }`,
  styleUrl: './cabecera.css',
})
export class ComCabecera {
  private readonly store = inject(ChatStoreService);
  private readonly llamadas = inject(LlamadaService);
  private readonly api = inject(ComunicacionesApiService);
  private readonly dialog = inject(MatDialog);

  readonly c = input.required<Conversacion>();
  readonly modo = input<'ventana' | 'pagina'>('ventana');
  readonly minimizada = input(false);
  readonly resaltada = input(false);
  readonly alternar = output<void>();
  readonly cerrar = output<void>();
  readonly maximizar = output<void>();
  readonly info = output<void>();

  readonly enLlamada = computed(() => this.llamadas.enLlamada());
  readonly ocupado = signal(false);
  readonly icono = computed(() => iconoConversacion(this.c()));
  readonly soporte = computed(() => this.c().tipo === 'SOPORTE');
  readonly esMiSoporte = computed(() => this.soporte() && this.c().otro_usuario_id === SOPORTE_BOT);
  /** Ni la línea de soporte ni los grupos por rango (cientos de personas) tienen llamadas. */
  readonly sePuedeLlamar = computed(() => !this.soporte() && !this.c().alcance_tipo);
  readonly otro = computed(() => this.c().participantes.find(p => p.usuario_id === this.c().otro_usuario_id));
  readonly fotoOtro = computed(() => this.otro()?.tiene_foto ?? false);
  readonly enLinea = computed(() => this.otro()?.en_linea ?? false);
  readonly escriben = computed(() => this.store.escribiendoEn(this.c().id));
  readonly subtitulo = computed(() => {
    const e = this.escriben();
    if (e.length) return e.length === 1 && this.c().tipo === 'DIRECTA' ? 'escribiendo…' : `${primerNombre(e[0].nombre)} está escribiendo…`;
    const c = this.c();
    if (c.tipo === 'SOPORTE') {
      if (!this.esMiSoporte()) return c.soporte_estado === 'HUMANO' ? 'Pidió hablar con una persona' : 'Atendido por el asistente';
      return c.soporte_estado === 'HUMANO' ? 'Te atiende el equipo de soporte' : 'Asistente con IA · responde al instante';
    }
    if (c.tipo === 'GRUPO') {
      const total = c.total_participantes || c.participantes.filter(p => p.activo).length;
      if (c.alcance_tipo) return `${etiquetaAlcance(c.alcance_tipo)} · ${total.toLocaleString('es-CO')} personas`;
      const conectados = c.participantes.filter(p => p.activo && p.en_linea).length;
      return `${total} personas${conectados ? ' · ' + conectados + ' en línea' : ''}`;
    }
    const o = this.otro();
    return [actividad(o?.en_linea, o?.ultima_vez_ms).texto, cargoYLugar(o?.cargo, o?.sede)].filter(Boolean).join(' · ');
  });
  /** Una llamada activa de esta conversación en la que no estoy (para unirse). */
  readonly llamadaAjena = computed(() => {
    const ll = this.c().llamada_activa;
    if (!ll || this.llamadas.actual()?.id === ll.id) return null;
    if (ll.estado === 'SONANDO' && ll.iniciada_por === this.store.miId()) return null;
    return ll.estado === 'EN_CURSO' ? ll : null;
  });

  asistente(): void { abrirAsistente(this.dialog, this.c().id, this.c().nombre); }
  llamar(tipo: 'AUDIO' | 'VIDEO', transcribir = true): void { void this.llamadas.llamar(this.c().id, tipo, transcribir); }
  unirse(): void { const ll = this.c().llamada_activa; if (ll) void this.llamadas.llamar(this.c().id, ll.tipo); }
  async escalar(): Promise<void> {
    this.ocupado.set(true);
    try { await this.store.escalarSoporte(this.c().id); } catch { /* reintenta desde el menú */ } finally { this.ocupado.set(false); }
  }
  async cerrarSoporte(): Promise<void> {
    // Si cierra alguien del equipo, sale de la conversación y el aviso de salida cierra su ventana.
    try { await this.store.cerrarSoporte(this.c().id); } catch { /* nada */ }
  }
  silenciar(): void {
    const id = this.c().id;
    const nuevo = !this.c().silenciada;
    this.store.parchar(id, { silenciada: nuevo });
    this.api.preferencias(id, { silenciada: nuevo }).subscribe({ error: () => this.store.parchar(id, { silenciada: !nuevo }) });
  }
}
