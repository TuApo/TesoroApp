import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, OnInit, afterNextRender, computed, effect, inject, input, signal,
  untracked, viewChild,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Adjunto, Conversacion, Mensaje } from '../../modelos';
import { ChatStoreService } from '../../service/chat-store.service';
import { LlamadaService } from '../../service/llamada.service';
import { SOPORTE_BOT, etiquetaAlcance, etiquetaDia, primerNombre } from '../../utiles';
import { ComComposer } from '../composer/composer';
import { ComMensaje } from '../mensaje/mensaje';
import { VisorAdjunto } from '../visor/visor-adjunto';
import { abrirActa } from '../acta/acta';

type Item =
  | { tipo: 'dia'; clave: string; etiqueta: string }
  | { tipo: 'nuevos'; clave: string }
  | { tipo: 'msg'; clave: string; m: Mensaje; mio: boolean; primero: boolean; visto: boolean; ultimo: boolean };

/** Por encima de esto no hay "visto": la lista de participantes llega recortada y no se sabe quién leyó. */
const MAX_VISTO = 40;

/**
 * Una conversación: mensajes (con scroll infinito hacia arriba), quién escribe
 * y el compositor. La usan tanto la ventana del dock como la página completa.
 */
@Component({
  selector: 'app-com-conversacion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatMenuModule, ComMensaje, ComComposer],
  template: `
    <div class="lista" #lista (scroll)="alScroll()" (dragenter)="arrastrando.set(true)">
      @if (!completo() && mensajes().length) {
        <div class="cargando">@if (cargandoViejos()) { Cargando mensajes anteriores… } @else { &nbsp; }</div>
      }
      @if (completo() && !mensajes().length && conv()) {
        <div class="vacio">
          <mat-icon>forum</mat-icon>
          @if (conv()!.alcance_tipo) {
            <p>{{ etiqueta(conv()!.alcance_tipo) }}: aquí llegan los anuncios para todo el personal.</p>
            <small>Lo publican los coordinadores. Si tienes una duda, escríbele a tu coordinador.</small>
          } @else {
            <p>{{ conv()!.tipo === 'GRUPO' ? 'Este es el comienzo del grupo.' : 'Escríbele a ' + primer(conv()!.nombre) + '.' }}</p>
            @if (nuncaEntro()) {
              <small class="aviso-inactivo">{{ primer(conv()!.nombre) }} todavía no ha entrado a la plataforma: verá tu mensaje cuando entre.</small>
            } @else {
              <small>Puedes enviar documentos, fotos y escaneos, o llamar desde el encabezado.</small>
            }
          }
        </div>
      }
      @for (it of items(); track it.clave) {
        @switch (it.tipo) {
          @case ('dia') { <div class="dia"><span>{{ it.etiqueta }}</span></div> }
          @case ('nuevos') { <div class="nuevos"><span>Mensajes nuevos</span></div> }
          @case ('msg') {
            <app-com-mensaje [m]="it.m" [conversacion]="conv()!" [mio]="it.mio" [primero]="it.primero" [visto]="it.visto"
              [ultimo]="it.ultimo" [soloLectura]="soloLectura()" (sugerir)="sugerir($event)" (escalar)="escalar()"
              (responder)="responder($event)" (editar)="editar($event)" (eliminar)="eliminar($event)"
              (reintentar)="store.reintentar(conversacionId(), $event)" (descartar)="store.descartarFallido(conversacionId(), $event)"
              (abrir)="abrirVisor($event.adjuntos, $event.indice)" (verActa)="verActa($event)" (unirse)="unirse()" />
          }
        }
      }
      @if (escriben().length) {
        <div class="escribiendo"><span class="puntos"><i></i><i></i><i></i></span> {{ textoEscriben() }}</div>
      }
    </div>
    @if (hayNuevosAbajo()) {
      <button type="button" class="bajar" (click)="bajar(true)"><mat-icon>arrow_downward</mat-icon> Mensajes nuevos</button>
    }
    @if (arrastrando()) {
      <div class="soltar" (dragover)="$event.preventDefault()" (dragleave)="arrastrando.set(false)" (drop)="soltar($event)">
        <mat-icon>upload_file</mat-icon><span>Suelta para adjuntar</span>
      </div>
    }
    @if (editando(); as e) {
      <div class="edicion">
        <mat-icon>edit</mat-icon>
        <textarea #edicion [value]="e.texto" (keydown.enter)="$event.preventDefault(); guardarEdicion(edicion.value)"
                  (keydown.escape)="editando.set(null)" rows="2"></textarea>
        <button type="button" (click)="editando.set(null)">Cancelar</button>
        <button type="button" class="ok" (click)="guardarEdicion(edicion.value)">Guardar</button>
      </div>
    } @else if (soloLectura()) {
      <div class="solo-lectura">
        <mat-icon>campaign</mat-icon>
        <span>Solo los coordinadores publican en este grupo.</span>
        @if (store.misContactos().length === 1) {
          <button type="button" (click)="escribirA(store.misContactos()[0].usuario.id)"><mat-icon>chat</mat-icon>
            {{ store.misContactos()[0].origen === 'COORDINADOR' ? 'Escribir a mi coordinador' : 'Escribir a ' + primer(store.misContactos()[0].usuario.nombre) }}</button>
        } @else if (store.misContactos().length > 1) {
          <button type="button" [matMenuTriggerFor]="coords"><mat-icon>chat</mat-icon> Escribir a quien me atiende</button>
          <mat-menu #coords="matMenu" yPosition="above">
            @for (k of store.misContactos(); track k.usuario.id) {
              <button mat-menu-item (click)="escribirA(k.usuario.id)"><mat-icon>star</mat-icon> {{ k.usuario.nombre }}
                @if (k.motivo) { <small class="motivo-menu">· {{ k.motivo }}</small> }</button>
            }
          </mat-menu>
        }
      </div>
    } @else {
      <app-com-composer #composer [conversacionId]="conversacionId()" [(respondiendo)]="respondiendo"
        [placeholder]="esMiSoporte() ? 'Escribe tu pregunta' : 'Escribe un mensaje'" />
    }`,
  styleUrl: './conversacion.css',
})
export class ComConversacion implements OnInit, OnDestroy {
  readonly store = inject(ChatStoreService);
  private readonly llamadas = inject(LlamadaService);
  private readonly dialog = inject(MatDialog);
  private readonly injector = inject(Injector);

  readonly conversacionId = input.required<string>();
  private readonly lista = viewChild<ElementRef<HTMLDivElement>>('lista');
  private readonly composer = viewChild<ComComposer>('composer');

  readonly conv = computed<Conversacion | undefined>(() => this.store.conversacion(this.conversacionId()));
  readonly mensajes = computed(() => this.store.mensajesDe(this.conversacionId())());
  readonly completo = computed(() => this.store.completo(this.conversacionId())());
  readonly escriben = computed(() => { this.store.conversaciones(); return this.store.escribiendoEn(this.conversacionId()); });
  readonly respondiendo = signal<Mensaje | null>(null);
  /** Canal de anuncios en el que no publico. */
  readonly soloLectura = computed(() => { const c = this.conv(); return !!c && c.puede_escribir === false; });
  /** En un chat 1 a 1, la otra persona nunca ha entrado a la plataforma. */
  readonly nuncaEntro = computed(() => {
    const c = this.conv();
    if (!c || c.tipo !== 'DIRECTA') return false;
    const o = c.participantes.find(p => p.usuario_id === c.otro_usuario_id);
    return !!o && !o.en_linea && !o.ultima_vez_ms;
  });
  readonly esMiSoporte = computed(() => this.conv()?.tipo === 'SOPORTE' && this.conv()?.otro_usuario_id === SOPORTE_BOT);
  readonly editando = signal<Mensaje | null>(null);
  readonly arrastrando = signal(false);
  readonly cargandoViejos = signal(false);
  readonly hayNuevosAbajo = signal(false);
  /**
   * Lo que estaba sin leer AL ABRIR (entre el último leído y el último mensaje de ese momento):
   * la raya de "Mensajes nuevos" marca eso y no se mueve con lo que llega mientras se conversa.
   */
  private leidoAlAbrir: number | null = null;
  private ultimoAlAbrir: number | null = null;
  private pegadoAbajo = true;
  private cantidadPrevia = 0;

  readonly items = computed<Item[]>(() => {
    const ms = this.mensajes();
    const c = this.conv();
    const yo = this.store.miId();
    const out: Item[] = [];
    let dia = '';
    let prev: Mensaje | null = null;
    let rayaPuesta = false;
    // Hasta dónde leyó cada otro participante: para el "visto".
    const otros = (c?.total_participantes ?? 0) > MAX_VISTO ? []
      : (c?.participantes ?? []).filter(p => p.usuario_id !== yo && p.activo);
    const ultimaClave = ms.length ? ms[ms.length - 1] : null;
    const ultimoMioId = [...ms].reverse().find(m => m.autor_id === yo && m.id > 0)?.id;
    for (const m of ms) {
      const d = new Date(m.creado_en).toDateString();
      if (d !== dia) { out.push({ tipo: 'dia', clave: 'd' + d, etiqueta: etiquetaDia(m.creado_en) }); dia = d; prev = null; }
      if (!rayaPuesta && this.leidoAlAbrir != null && this.ultimoAlAbrir != null && m.id > this.leidoAlAbrir
          && m.id <= this.ultimoAlAbrir && m.autor_id !== yo && m.id > 0) {
        out.push({ tipo: 'nuevos', clave: 'nuevos' });
        rayaPuesta = true;
      }
      const seguido = !!prev && prev.autor_id === m.autor_id && prev.tipo !== 'SISTEMA' && prev.tipo !== 'LLAMADA'
        && m.tipo !== 'SISTEMA' && m.tipo !== 'LLAMADA'
        && new Date(m.creado_en).getTime() - new Date(prev.creado_en).getTime() < 5 * 60_000;
      const mio = m.autor_id === yo;
      const visto = mio && m.id === ultimoMioId && otros.length > 0 && otros.every(p => p.ultimo_leido_id >= m.id);
      out.push({ tipo: 'msg', clave: 'm' + (m.cliente_id ?? m.id), m, mio, primero: !seguido, visto, ultimo: m === ultimaClave });
      prev = m;
    }
    return out;
  });

  constructor() {
    // Al llegar mensajes: si la persona estaba abajo, seguir abajo; si no, avisar.
    effect(() => {
      const n = this.mensajes().length;
      untracked(() => {
        if (this.leidoAlAbrir == null && this.conv()) {
          this.leidoAlAbrir = this.conv()!.mi_ultimo_leido_id;
          this.ultimoAlAbrir = this.conv()!.ultimo_mensaje_id;
        }
        const crecio = n > this.cantidadPrevia;
        const primeraCarga = this.cantidadPrevia === 0;
        // Se decide ANTES de que se pinte lo nuevo: después la distancia al fondo ya creció.
        const estabaAbajo = this.pegadoAbajo;
        this.cantidadPrevia = n;
        if (!crecio) return;
        afterNextRender(() => {
          if (primeraCarga || estabaAbajo || this.ultimoEsMio()) this.bajar(false);
          else this.hayNuevosAbajo.set(true);
        }, { injector: this.injector });
      });
    });
  }

  ngOnInit(): void {
    // Primero se fotografía qué estaba sin leer; después se marca leído (si no, la raya nunca sale).
    const c = this.conv();
    if (c) { this.leidoAlAbrir = c.mi_ultimo_leido_id; this.ultimoAlAbrir = c.ultimo_mensaje_id; }
    this.store.marcarVisible(this.conversacionId(), true);
  }
  ngOnDestroy(): void { this.store.marcarVisible(this.conversacionId(), false); }

  enfocar(): void { this.composer()?.enfocar(); }

  private ultimoEsMio(): boolean {
    const ms = this.mensajes();
    return ms.length > 0 && ms[ms.length - 1].autor_id === this.store.miId();
  }

  alScroll(): void {
    const el = this.lista()?.nativeElement;
    if (!el) return;
    this.pegadoAbajo = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (this.pegadoAbajo) { this.hayNuevosAbajo.set(false); this.store.marcarLeido(this.conversacionId()); }
    if (el.scrollTop < 60 && !this.completo() && !this.cargandoViejos()) void this.cargarViejos();
  }

  private async cargarViejos(): Promise<void> {
    const el = this.lista()?.nativeElement;
    if (!el) return;
    const alto = el.scrollHeight;
    this.cargandoViejos.set(true);
    try {
      const n = await this.store.cargarAnteriores(this.conversacionId());
      if (n) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - alto + el.scrollTop; });
    } finally {
      this.cargandoViejos.set(false);
    }
  }

  bajar(suave: boolean): void {
    const el = this.lista()?.nativeElement;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: suave ? 'smooth' : 'auto' });
    this.hayNuevosAbajo.set(false);
    this.pegadoAbajo = true;
    this.store.marcarLeido(this.conversacionId());
  }

  textoEscriben(): string {
    const l = this.escriben();
    if (l.length === 1) return `${primerNombre(l[0].nombre)} está escribiendo…`;
    if (l.length === 2) return `${primerNombre(l[0].nombre)} y ${primerNombre(l[1].nombre)} están escribiendo…`;
    return 'Varias personas están escribiendo…';
  }

  primer(n: string): string { return primerNombre(n); }
  etiqueta(t: string | null): string { return etiquetaAlcance(t); }

  /** Una sugerencia del asistente se envía como si la persona la hubiera escrito. */
  sugerir(texto: string): void { this.store.enviar(this.conversacionId(), texto); }
  escalar(): void { void this.store.escalarSoporte(this.conversacionId()).catch(() => undefined); }

  async escribirA(usuarioId: string): Promise<void> {
    try { this.store.pedirAbrir((await this.store.abrirDirecta(usuarioId)).id); } catch { /* sin red */ }
  }

  responder(m: Mensaje): void { this.respondiendo.set(m); this.composer()?.enfocar(); }
  editar(m: Mensaje): void { this.editando.set(m); }
  eliminar(m: Mensaje): void { if (confirm('¿Eliminar este mensaje para todos?')) this.store.eliminar(m); }

  guardarEdicion(texto: string): void {
    const m = this.editando();
    if (m && texto.trim() && texto.trim() !== m.texto) this.store.editar(m, texto.trim());
    this.editando.set(null);
  }

  soltar(e: DragEvent): void {
    e.preventDefault();
    this.arrastrando.set(false);
    const archivos = Array.from(e.dataTransfer?.files ?? []);
    if (archivos.length) void this.composer()?.agregarArchivos(archivos);
  }

  abrirVisor(adjuntos: Adjunto[], indice: number): void {
    this.dialog.open(VisorAdjunto, {
      data: { adjuntos, indice }, panelClass: 'com-visor-panel', maxWidth: '100vw', maxHeight: '100vh',
      width: '100vw', height: '100vh',
    });
  }

  verActa(llamadaId: string): void { abrirActa(this.dialog, llamadaId); }

  unirse(): void {
    const ll = this.conv()?.llamada_activa;
    if (!ll) return;
    void this.llamadas.llamar(this.conversacionId(), ll.tipo);
  }
}
