import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Router } from '@angular/router';
import { Adjunto, Conversacion, Mensaje, MetaAsistente } from '../../modelos';
import { ComunicacionesApiService } from '../../service/comunicaciones-api.service';
import { LlamadaService } from '../../service/llamada.service';
import { SOPORTE_BOT, duracionLarga, hora, iconoAdjunto, tamano, textoAsistente, textoConEnlaces } from '../../utiles';
import { ComAvatar } from '../avatar/avatar';

/** Un mensaje del chat: burbuja, adjuntos, cita, tarjeta de llamada o aviso del sistema. */
@Component({
  selector: 'app-com-mensaje',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatMenuModule, ComAvatar],
  template: `
    @switch (m().tipo) {
      @case ('SISTEMA') { <div class="sistema">{{ m().texto }}</div> }
      @case ('LLAMADA') {
        <div class="llamada" [class.perdida]="perdida()">
          <div class="ll-ico"><mat-icon>{{ perdida() ? 'phone_missed' : (m().meta?.['tipo'] === 'VIDEO' ? 'videocam' : 'call') }}</mat-icon></div>
          <div class="ll-txt">
            <strong>{{ m().texto }}</strong>
            <small>{{ m().autor_nombre }} · {{ h(m().creado_en) }}</small>
            @switch (m().meta?.['transcripcion']) {
              @case ('PENDIENTE') { <span class="tr"><mat-icon>hourglass_top</mat-icon> Preparando la transcripción…</span> }
              @case ('PROCESANDO') { <span class="tr"><mat-icon class="gira">autorenew</mat-icon> Transcribiendo y resumiendo…</span> }
              @case ('SIN_AUDIO') { <span class="tr">No se grabó audio para transcribir.</span> }
              @case ('ERROR') { <span class="tr err">La transcripción falló. Se puede reintentar desde el acta.</span> }
              @case ('LISTA') {
                @if (m().meta?.['titulo']) { <span class="tit">{{ m().meta?.['titulo'] }}</span> }
                @if (m().meta?.['resumen']) { <span class="res">{{ m().meta?.['resumen'] }}</span> }
              }
            }
            <div class="ll-acc">
              @if (activa()) { <button type="button" class="unirse" (click)="unirse.emit(m())"><mat-icon>call</mat-icon> Unirse</button> }
              @if (m().meta?.['transcripcion'] && m().meta?.['transcripcion'] !== 'NINGUNA') {
                <button type="button" class="link" (click)="verActa.emit(m().llamada_id!)"><mat-icon>article</mat-icon> Ver acta</button>
              }
            </div>
          </div>
        </div>
      }
      @default {
        <div class="fila" [class.mio]="mio()" [class.cont]="!primero()">
          @if (!mio() && grupo()) {
            <div class="av">@if (primero()) {
              @if (asistente()) { <app-com-avatar nombre="Asistente" icono="support_agent" color="#0B6B58" [tam]="28" /> }
              @else { <app-com-avatar [usuarioId]="m().autor_id" [nombre]="m().autor_nombre" [tieneFoto]="autor()?.tiene_foto ?? false"
                        [coordinador]="!!autor()?.coordinador" [tam]="28" /> }
            }</div>
          }
          <div class="col">
            @if (primero() && !mio() && grupo()) {
              <span class="autor">{{ m().autor_nombre }}@if (autor()?.cargo; as cargo) { <small>· {{ cargo }}</small> }@if (deInvitado()) { <small>· sumado a la llamada</small> }</span>
            }
            <div class="burbuja" [class.error]="m()._estado === 'error'" [class.solo-media]="soloMedia()" [class.asistente]="asistente()">
              @if (m().responde_a; as c) {
                <div class="cita"><strong>{{ c.autor_nombre }}</strong><span>{{ c.eliminado ? 'Mensaje eliminado' : (c.texto || 'Archivo') }}</span></div>
              }
              @if (m().eliminado) {
                <span class="borrado"><mat-icon>block</mat-icon> Mensaje eliminado</span>
              } @else {
                @if (imagenes().length) {
                  <div class="fotos" [class.varias]="imagenes().length > 1">
                    @for (a of imagenes(); track a.id; let i = $index) {
                      <img [src]="abs(a.miniatura_url || a.url)" [alt]="a.nombre" loading="lazy" (click)="abrir.emit({ adjuntos: imagenes(), indice: i })" />
                    }
                  </div>
                }
                @for (a of videos(); track a.id) { <video [src]="abs(a.url)" controls preload="metadata"></video> }
                @for (a of audios(); track a.id) { <audio [src]="abs(a.url)" controls preload="none"></audio> }
                @for (a of documentos(); track a.id; let i = $index) {
                  <button type="button" class="doc" (click)="abrir.emit({ adjuntos: documentos(), indice: i })">
                    <mat-icon [class.escaneo]="a.clase === 'ESCANEO'">{{ icono(a) }}</mat-icon>
                    <span class="doc-t"><strong>{{ a.nombre }}</strong><small>{{ a.clase === 'ESCANEO' ? 'Escaneado · ' : '' }}{{ tam(a.tamano) }}</small></span>
                    <a [href]="abs(a.descarga_url)" download (click)="$event.stopPropagation()" aria-label="Descargar"><mat-icon>download</mat-icon></a>
                  </button>
                }
                @if (m().texto) { <div class="texto" [class.md]="asistente()" [innerHTML]="html()"></div> }
              }
              <span class="meta">
                @if (enLlamada()) { <mat-icon class="en-llamada" title="Escrito durante la llamada: queda en el acta" aria-label="Escrito durante la llamada (queda en el acta)">call</mat-icon> }
                @if (m().editado_en && !m().eliminado) { editado · }
                {{ h(m().creado_en) }}
                @if (mio()) {
                  @switch (m()._estado) {
                    @case ('enviando') { <mat-icon class="est">schedule</mat-icon> }
                    @case ('error') { <mat-icon class="est err">error</mat-icon> }
                    @default { <mat-icon class="est" [class.visto]="visto()">{{ visto() ? 'done_all' : 'done' }}</mat-icon> }
                  }
                }
              </span>
            </div>
            @if (asistente() && !m().eliminado) {
              @for (d of docsAsistente(); track d.id; let i = $index) {
                <button type="button" class="doc doc-ia" (click)="abrir.emit({ adjuntos: docsAsistente(), indice: i })">
                  <mat-icon>{{ d.mime === 'application/pdf' ? 'picture_as_pdf' : icono(d) }}</mat-icon>
                  <span class="doc-t"><strong>{{ d.nombre }}</strong><small>{{ tipoDoc(i) }} · Ver</small></span>
                  <a [href]="abs(d.descarga_url)" download (click)="$event.stopPropagation()" aria-label="Descargar"><mat-icon>download</mat-icon></a>
                </button>
              }
              @if (meta()?.ir_a?.length || meta()?.enlaces?.length || (meta()?.escalar && puedeEscalar())) {
                <div class="acciones-ia">
                  @for (x of meta()!.ir_a ?? []; track x.ruta) {
                    <button type="button" (click)="ir(x.ruta)"><mat-icon>arrow_forward</mat-icon> {{ x.etiqueta }}</button>
                  }
                  @for (x of meta()!.enlaces ?? []; track x.url) {
                    <a [href]="x.url" target="_blank" rel="noopener noreferrer"><mat-icon>open_in_new</mat-icon> {{ x.etiqueta }}</a>
                  }
                  @if (meta()?.escalar && puedeEscalar()) {
                    <button type="button" class="persona" (click)="escalar.emit()"><mat-icon>support_agent</mat-icon> Hablar con una persona</button>
                  }
                </div>
              }
              @if (ultimo() && meta()?.sugerencias?.length) {
                <div class="sugerencias">
                  @for (s of meta()!.sugerencias!; track s) { <button type="button" (click)="sugerir.emit(s)">{{ s }}</button> }
                </div>
              }
            }
            @if (m()._estado === 'error') {
              <span class="fallo">No se envió · <button type="button" (click)="reintentar.emit(m())">Reintentar</button> ·
                <button type="button" (click)="descartar.emit(m())">Descartar</button></span>
            }
          </div>
          @if (!m().eliminado && m().id > 0) {
            <button type="button" class="mas" [matMenuTriggerFor]="acciones" aria-label="Acciones"><mat-icon>more_vert</mat-icon></button>
            <mat-menu #acciones="matMenu">
              @if (!soloLectura() && !asistente()) { <button mat-menu-item (click)="responder.emit(m())"><mat-icon>reply</mat-icon> Responder</button> }
              @if (m().texto) { <button mat-menu-item (click)="copiar()"><mat-icon>content_copy</mat-icon> Copiar</button> }
              @if (mio() && m().texto) { <button mat-menu-item (click)="editar.emit(m())"><mat-icon>edit</mat-icon> Editar</button> }
              @if (mio() || puedeModerar()) { <button mat-menu-item (click)="eliminar.emit(m())"><mat-icon>delete</mat-icon> Eliminar</button> }
            </mat-menu>
          }
        </div>
      }
    }`,
  styleUrl: './mensaje.css',
})
export class ComMensaje {
  private readonly api = inject(ComunicacionesApiService);
  private readonly llamadas = inject(LlamadaService);
  readonly m = input.required<Mensaje>();
  readonly conversacion = input.required<Conversacion>();
  readonly mio = input(false);
  readonly primero = input(true);
  readonly visto = input(false);
  /** Es el último mensaje de la conversación (las sugerencias del asistente solo van ahí). */
  readonly ultimo = input(false);
  readonly soloLectura = input(false);
  readonly sugerir = output<string>();
  readonly escalar = output<void>();

  readonly responder = output<Mensaje>();
  readonly editar = output<Mensaje>();
  readonly eliminar = output<Mensaje>();
  readonly reintentar = output<Mensaje>();
  readonly descartar = output<Mensaje>();
  readonly abrir = output<{ adjuntos: Adjunto[]; indice: number }>();
  readonly verActa = output<string>();
  readonly unirse = output<Mensaje>();

  private readonly router = inject(Router);
  /** Lo escribió alguien a quien sumaron a una llamada sin ser del chat. */
  readonly deInvitado = computed(() => !!this.m().meta?.['invitado_llamada']);
  /** En grupos y en soporte se muestra quién escribe; en 1 a 1 no hace falta (salvo que sea alguien sumado a una llamada). */
  readonly grupo = computed(() => this.conversacion().tipo !== 'DIRECTA' || this.deInvitado());
  /** Escrito durante una llamada: también quedó en el acta. */
  readonly enLlamada = computed(() => !!this.m().llamada_id && this.m().tipo !== 'LLAMADA');
  readonly puedeModerar = computed(() => this.conversacion().tipo === 'GRUPO' && this.conversacion().mi_rol === 'ADMIN');
  readonly autor = computed(() => this.conversacion().participantes.find(p => p.usuario_id === this.m().autor_id));
  readonly asistente = computed(() => this.m().autor_id === SOPORTE_BOT);
  readonly meta = computed(() => (this.asistente() ? this.m().meta : null) as MetaAsistente | null);
  readonly puedeEscalar = computed(() => this.conversacion().otro_usuario_id === SOPORTE_BOT && this.conversacion().soporte_estado !== 'HUMANO');
  /** Los documentos que mostró el asistente, con la forma que entiende el visor. */
  readonly docsAsistente = computed<Adjunto[]>(() => (this.meta()?.documentos ?? []).filter(d => !!d.url).map(d => ({
    id: String(d.id), nombre: d.nombre || 'Documento', mime: d.mime || 'application/pdf', clase: 'DOCUMENTO' as const, tamano: 0,
    ancho: null, alto: null, duracion_ms: null, url: d.url!, miniatura_url: null, descarga_url: d.descarga_url ?? d.url!,
    mensaje_id: this.m().id, creado_en: this.m().creado_en,
  })));
  readonly imagenes = computed(() => this.m().adjuntos.filter(a => a.clase === 'IMAGEN' || (a.clase === 'ESCANEO' && a.mime.startsWith('image/'))));
  readonly videos = computed(() => this.m().adjuntos.filter(a => a.clase === 'VIDEO'));
  readonly audios = computed(() => this.m().adjuntos.filter(a => a.clase === 'AUDIO'));
  readonly documentos = computed(() => this.m().adjuntos.filter(a =>
    !this.imagenes().includes(a) && a.clase !== 'VIDEO' && a.clase !== 'AUDIO'));
  readonly soloMedia = computed(() => !this.m().texto && this.imagenes().length > 0 && this.documentos().length === 0 && !this.m().responde_a);
  readonly html = computed(() => this.asistente() ? textoAsistente(this.m().texto) : textoConEnlaces(this.m().texto));
  readonly perdida = computed(() => ['PERDIDA', 'RECHAZADA', 'CANCELADA'].includes(this.m().meta?.['estado']));
  readonly activa = computed(() => {
    const ll = this.conversacion().llamada_activa;
    return !!ll && ll.id === this.m().llamada_id && this.llamadas.actual()?.id !== ll.id;
  });

  abs(u: string | null): string | null { return this.api.absoluta(u); }
  h(iso: string): string { return hora(iso); }
  tam(b: number): string { return tamano(b); }
  icono(a: Adjunto): string { return iconoAdjunto(a.clase, a.mime); }
  dur(s: number): string { return duracionLarga(s); }
  tipoDoc(i: number): string {
    const t = this.meta()?.documentos?.[i]?.tipo ?? '';
    const bonito = t.replace(/_/g, ' ').toLowerCase().trim();
    return bonito ? bonito[0].toUpperCase() + bonito.slice(1) : 'Documento';
  }
  /** Lleva a la pantalla que sugirió el asistente (ya validada contra el menú de la persona). */
  ir(ruta: string): void { void this.router.navigateByUrl(ruta); }
  copiar(): void { void navigator.clipboard?.writeText(this.m().texto ?? ''); }
}
