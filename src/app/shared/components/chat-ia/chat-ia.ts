import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, model, output, signal, untracked, viewChild,
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { MarkdownMessageComponent } from '../../../features/dashboard/submodule/nomina/pages/analitica-nomina-ia/markdown-message.component';
import { obtenerUsuarioActual } from '../../../core/utils/usuario-actual';
import { mensajeDeError } from '../../utils/mensaje-error';
import {
  ArchivoChat, ContextoChatIa, ConversacionChat, EstadoChatIa, MensajeChat, ModuloChatIa, RUTA_BANDEJA_IA, etiquetaFormato, iconoArchivo, tamanoLegible,
} from './chat-ia.modelos';
import { ChatIaService } from './chat-ia.service';
import { LectorPantallaService } from '../../../core/services/operador/lector-pantalla.service';
import { AvatarAgente } from '../avatar-agente/avatar-agente';
import { AvatarAgenteService } from '../avatar-agente/avatar-agente.service';
import { Personaje, Tramo } from '../avatar-agente/avatar-agente.modelos';
import { partirTramos, sinMarcas } from '../avatar-agente/tramos';
import { GrabadoraVoz, ReproductorVoz, textoParaVoz } from './chat-ia-voz';
import { archivosPegados, nombreAlSubir, reducirImagen, traeArchivos } from './chat-ia-archivos';

/** Adjunto mientras sube y se lee. */
interface AdjuntoLocal {
  clave: string;
  nombre: string;
  tipoMime: string;
  estado: 'subiendo' | 'leyendo' | 'listo' | 'error';
  archivo?: ArchivoChat;
  error?: string;
  vista?: string;
}

const CLAVE_LEER = 'tuapo.chatia.leer';
const MAX_ADJUNTOS = 8;

/**
 * Chat de IA estándar de la plataforma. Cada módulo lo trae (con {@link ChatIaAcceso}) y le pasa
 * su contexto: qué módulo, qué tienda, qué se ve en pantalla y con qué parámetros consultar.
 * La IA consulta los datos del módulo con los permisos de la persona, lee lo que se le adjunte
 * (fotos, PDF, Excel, Word, PowerPoint, notas de voz) y entrega PDF, Excel, Word y PowerPoint.
 *
 * Reúne lo que tenían por separado los chats que ya existían: la voz de MatIA (EconomiAPP), el
 * render con gráficas del Asistente IA y los documentos del chat de Seguimiento de Tareas.
 * Todas las conversaciones quedan en la bandeja central (Herramientas IA › Conversaciones).
 */
@Component({
  selector: 'app-chat-ia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, DatePipe, NgTemplateOutlet, RouterLink, MatButtonModule, MatIconModule, MatMenuModule, MatProgressSpinnerModule, MatTooltipModule,
    MarkdownMessageComponent, AvatarAgente,
  ],
  templateUrl: './chat-ia.html',
  styleUrl: './chat-ia.css',
  host: {
    '[class.cia-pagina]': "modo() === 'pagina'",
    '(dragenter)': 'alArrastrar($event)',
    '(dragover)': 'alArrastrar($event)',
    '(dragleave)': 'alSalir($event)',
    '(drop)': 'alSoltar($event)',
    '(paste)': 'alPegar($event)',
  },
})
export class ChatIa {
  private api = inject(ChatIaService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private lectorPantalla = inject(LectorPantallaService);
  private avatares = inject(AvatarAgenteService);

  /** Contexto del módulo. En la bandeja puede venir vacío (se usa el de la conversación). */
  readonly contexto = input<ContextoChatIa | null>(null);
  /** Conversación abierta (null = nueva). Cambia sola al enviar el primer mensaje. */
  readonly conversacionId = model<number | null>(null);
  readonly modo = input<'panel' | 'pagina'>('panel');
  readonly cabecera = input(true);
  readonly mostrarCerrar = input(false);
  readonly cerrar = output<void>();
  /** Avisa a quien lo contiene (la bandeja) que la conversación cambió: título, último mensaje. */
  readonly cambio = output<ConversacionChat>();

  private readonly hilo = viewChild<ElementRef<HTMLElement>>('hilo');
  private readonly entrada = viewChild<ElementRef<HTMLTextAreaElement>>('entrada');

  readonly usuario = obtenerUsuarioActual();
  readonly estado = signal<EstadoChatIa | null>(null);
  readonly sinServicio = signal<string | null>(null);
  readonly modulo = signal<ModuloChatIa | null>(null);
  readonly conversacion = signal<ConversacionChat | null>(null);
  readonly mensajes = signal<MensajeChat[]>([]);
  readonly recientes = signal<ConversacionChat[]>([]);
  readonly cargando = signal(false);
  readonly enviando = signal(false);
  readonly adjuntos = signal<AdjuntoLocal[]>([]);
  readonly arrastrando = signal(false);
  readonly aviso = signal<string | null>(null);
  readonly leerSiempre = signal(this.leerGuardado());
  readonly cargandoVoz = signal<number | null>(null);
  readonly copiado = signal<number | null>(null);
  /** Lo que se está escribiendo (signal: con zoneless un campo plano no repinta al limpiarlo tras un await). */
  readonly texto = signal('');

  readonly grabadora = new GrabadoraVoz();
  readonly reproductor = new ReproductorVoz();
  readonly puedeGrabar = GrabadoraVoz.soportada();
  readonly rutaBandeja = RUTA_BANDEJA_IA;

  readonly pendiente = computed(() => this.mensajes().some(m => m.estado === 'PENDIENTE'));
  readonly soloLectura = computed(() => {
    const c = this.conversacion();
    return !!c && (!c.propia || c.legado);
  });
  readonly subiendo = computed(() => this.adjuntos().some(a => a.estado === 'subiendo'));
  readonly puedeEnviar = computed(() => !this.enviando() && !this.subiendo() && !!this.estado()?.disponible);
  readonly sugerencias = computed(() => {
    const propias = this.contexto()?.sugerencias;
    return (propias?.length ? propias : this.modulo()?.sugerencias ?? []).slice(0, 6);
  });
  readonly nombreModulo = computed(() => this.conversacion()?.moduloNombre ?? this.contexto()?.moduloNombre ?? this.modulo()?.nombre ?? 'Tu Apo IA');
  readonly nombreTienda = computed(() => this.conversacion()?.tiendaNombre ?? this.contexto()?.tiendaNombre ?? null);
  /**
   * Avatar Agent: quién atiende este chat (el director del módulo; el presidente si el módulo no
   * tiene). Cada respuesta trae además quién la dio, por si el módulo cambió de director.
   */
  readonly personaje = computed<Personaje>(() =>
    this.avatares.deModulo(this.conversacion()?.modulo ?? this.contexto()?.modulo ?? this.modulo()?.clave));
  /** Las respuestas partidas por personaje (cuando dos áreas resuelven juntas). */
  readonly tramos = computed(() => {
    const out = new Map<number, (Tramo & { p: Personaje })[]>();
    const principal = this.personaje().clave;
    for (const m of this.mensajes()) {
      if (m.rol !== 'assistant' || m.estado !== 'LISTO') continue;
      const quien = m.personaje ?? principal;
      out.set(m.id, partirTramos(m.contenido, quien).map(t => ({ ...t, p: this.avatares.personaje(t.clave) })));
    }
    return out;
  });
  /** Dónde cambia quien responde (traspaso): id del mensaje → quien tenía la palabra antes. */
  readonly traspasos = computed(() => {
    const out = new Map<number, Personaje>();
    let antes: string | null = null;
    for (const m of this.mensajes()) {
      if (m.rol !== 'assistant' || !m.personaje) continue;
      if (antes && antes !== m.personaje) out.set(m.id, this.avatares.personaje(antes));
      antes = m.personaje;
    }
    return out;
  });
  /** Quién dio (o está dando) una respuesta. */
  quien(m: MensajeChat): Personaje {
    return m.personaje ? this.avatares.personaje(m.personaje) : this.personaje();
  }

  readonly primerNombre = computed(() => (this.usuario.nombreCompleto || '').split(' ')[0]?.toLowerCase().replace(/^\p{L}/u, c => c.toUpperCase()) ?? '');

  readonly icono = iconoArchivo;
  readonly formato = etiquetaFormato;
  readonly tam = tamanoLegible;

  private vigilando = false;
  private cargadaId: number | null = null;
  private leerAlTerminar = new Set<number>();
  private vozUrls = new Map<number, string>();
  private destruido = false;

  constructor() {
    this.avatares.cargar();
    this.api.estado().subscribe({
      next: e => { this.estado.set(e); if (!e.disponible) this.sinServicio.set('La IA no está disponible en este momento.'); },
      error: e => this.sinServicio.set(mensajeDeError(e, 'No se pudo conectar con la IA.')),
    });
    // Módulo y conversaciones recientes de este módulo/tienda.
    effect(() => {
      const ctx = this.contexto();
      untracked(() => this.cargarModulo(ctx));
    });
    // Abrir la conversación pedida (o dejar el chat en blanco).
    effect(() => {
      const id = this.conversacionId();
      untracked(() => {
        if (id && id !== this.cargadaId) this.abrir(id);
        else if (!id && this.cargadaId) this.limpiar();
      });
    });
    this.destroyRef.onDestroy(() => {
      this.destruido = true;
      this.reproductor.callar();
      if (this.grabadora.grabando()) this.grabadora.detener(true);
      for (const a of this.adjuntos()) if (a.vista) URL.revokeObjectURL(a.vista);
      for (const u of this.vozUrls.values()) URL.revokeObjectURL(u);
    });
  }

  // ── Conversación ──

  private cargarModulo(ctx: ContextoChatIa | null): void {
    if (!ctx?.modulo) return;
    this.api.modulo(ctx.modulo, ctx.moduloNombre).subscribe({ next: m => this.modulo.set(m), error: () => undefined });
    this.refrescarRecientes();
  }

  refrescarRecientes(): void {
    const ctx = this.contexto();
    if (!ctx?.modulo) return;
    this.api.delModulo(ctx.modulo, ctx.tiendaId).subscribe({ next: l => this.recientes.set(l), error: () => undefined });
  }

  private async abrir(id: number): Promise<void> {
    this.cargando.set(true);
    this.cargadaId = id;
    try {
      const r = await firstValueFrom(this.api.conversacion(id));
      if (this.cargadaId !== id) return;
      this.conversacion.set(r.conversacion);
      this.mensajes.set(r.mensajes);
      this.bajar(true);
      if (r.mensajes.some(m => m.estado === 'PENDIENTE')) this.vigilar();
    } catch (e) {
      this.aviso.set(mensajeDeError(e, 'No se pudo abrir la conversación.'));
      this.cargadaId = null;
      this.conversacionId.set(null);
    } finally {
      this.cargando.set(false);
    }
  }

  nueva(): void {
    this.conversacionId.set(null);
    this.limpiar();
    setTimeout(() => this.entrada()?.nativeElement.focus(), 50);
  }

  elegir(c: ConversacionChat): void {
    if (c.id !== this.conversacionId()) this.conversacionId.set(c.id);
  }

  private limpiar(): void {
    this.cargadaId = null;
    this.conversacion.set(null);
    this.mensajes.set([]);
    this.reproductor.callar();
  }

  verEnBandeja(): void {
    const id = this.conversacionId();
    this.router.navigate([RUTA_BANDEJA_IA], id ? { queryParams: { c: id } } : {});
    this.cerrar.emit();
  }

  // ── Enviar ──

  usarSugerencia(s: string): void {
    this.texto.set(s);
    this.enviar();
  }

  teclear(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.enviar();
    }
  }

  async enviar(viaVoz = false, audio?: ArchivoChat): Promise<void> {
    const texto = this.texto().trim();
    const listos = this.adjuntos().filter(a => a.archivo && a.estado !== 'error').map(a => a.archivo!.id);
    if (audio) listos.push(audio.id);
    if (!texto && !listos.length) return;
    if (!this.puedeEnviar() && !audio) return;
    this.enviando.set(true);
    this.aviso.set(null);
    const ctx = this.contexto();
    const conv = this.conversacion();
    try {
      const r = await firstValueFrom(this.api.enviar({
        conversacionId: this.conversacionId(),
        texto,
        adjuntos: listos,
        viaVoz,
        usuarioNombre: this.usuario.nombreCompleto || null,
        contexto: {
          modulo: ctx?.modulo ?? conv?.modulo ?? 'general',
          moduloNombre: ctx?.moduloNombre ?? conv?.moduloNombre ?? 'General',
          tiendaId: ctx?.tiendaId ?? conv?.tiendaId ?? null,
          tiendaNombre: ctx?.tiendaNombre ?? conv?.tiendaNombre ?? null,
          ruta: ctx?.ruta ?? conv?.ruta ?? this.router.url,
          parametros: limpiarParametros(ctx?.parametros),
          // Si el módulo no describe su pantalla, se manda la lectura genérica de lo que se ve.
          pantalla: ctx?.pantalla ?? this.lectorPantalla.instantanea(),
        },
      }));
      this.vaciarEntrada();
      for (const a of this.adjuntos()) if (a.vista) URL.revokeObjectURL(a.vista);
      this.adjuntos.set([]);
      this.cargadaId = r.conversacion.id;
      this.conversacion.set(r.conversacion);
      if (this.conversacionId() !== r.conversacion.id) this.conversacionId.set(r.conversacion.id);
      this.mensajes.update(l => [...l, ...r.mensajes]);
      const asistente = r.mensajes.find(m => m.rol === 'assistant');
      if (asistente && (viaVoz || this.leerSiempre())) this.leerAlTerminar.add(asistente.id);
      this.cambio.emit(r.conversacion);
      this.bajar(true);
      this.vigilar();
    } catch (e) {
      this.aviso.set(mensajeDeError(e, 'No se pudo enviar el mensaje.'));
    } finally {
      this.enviando.set(false);
    }
  }

  reintentar(m: MensajeChat): void {
    const i = this.mensajes().findIndex(x => x.id === m.id);
    const pregunta = [...this.mensajes().slice(0, i)].reverse().find(x => x.rol === 'user');
    if (pregunta?.contenido) {
      this.texto.set(pregunta.contenido);
      this.enviar();
    }
  }

  /** Consulta los mensajes en PENDIENTE hasta que terminen (la IA responde en segundo plano). */
  private async vigilar(): Promise<void> {
    if (this.vigilando) return;
    this.vigilando = true;
    try {
      while (!this.destruido) {
        const pendientes = this.mensajes().filter(m => m.estado === 'PENDIENTE');
        if (!pendientes.length) break;
        await new Promise(r => setTimeout(r, 1400));
        let termino = false;
        for (const p of pendientes) {
          try {
            const m = await firstValueFrom(this.api.mensaje(p.id));
            this.mensajes.update(l => l.map(x => x.id === m.id ? m : x));
            if (m.estado !== 'PENDIENTE') {
              termino = true;
              if (m.estado === 'LISTO' && this.leerAlTerminar.delete(m.id)) this.escuchar(m, true);
            }
          } catch { /* se reintenta en la siguiente vuelta */ }
        }
        if (termino) await this.refrescar();
        this.bajar();
      }
    } finally {
      this.vigilando = false;
    }
  }

  /** Trae la conversación completa: la transcripción de la nota de voz y los adjuntos ya leídos. */
  private async refrescar(): Promise<void> {
    const id = this.conversacionId();
    if (!id) return;
    try {
      const r = await firstValueFrom(this.api.conversacion(id));
      if (this.conversacionId() !== id) return;
      this.conversacion.set(r.conversacion);
      // Lo que siga pendiente se conserva tal cual (lo actualiza el ciclo de arriba).
      this.mensajes.set(r.mensajes);
      this.cambio.emit(r.conversacion);
      this.refrescarRecientes();
    } catch { /* la próxima consulta lo arregla */ }
  }

  // ── Adjuntos ──

  elegirArchivos(ev: Event): void {
    const inp = ev.target as HTMLInputElement;
    this.agregarArchivos(Array.from(inp.files ?? []));
    inp.value = '';
  }

  alArrastrar(e: DragEvent): void {
    if (this.soloLectura() || !traeArchivos(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    this.arrastrando.set(true);
  }

  alSalir(e: DragEvent): void {
    const dentro = e.relatedTarget as Node | null;
    if (!dentro || !(e.currentTarget as HTMLElement).contains(dentro)) this.arrastrando.set(false);
  }

  alSoltar(e: DragEvent): void {
    if (this.soloLectura()) return;
    e.preventDefault();
    this.arrastrando.set(false);
    this.agregarArchivos(Array.from(e.dataTransfer?.files ?? []));
  }

  /** Pegar una captura, una foto copiada o archivos del explorador los adjunta. */
  alPegar(e: ClipboardEvent): void {
    if (this.soloLectura()) return;
    const archivos = archivosPegados(e);
    if (!archivos.length) return;
    e.preventDefault();
    this.agregarArchivos(archivos);
  }

  private agregarArchivos(archivos: File[]): void {
    const max = (this.estado()?.maxArchivoMb ?? 15) * 1024 * 1024;
    for (const f of archivos) {
      if (this.adjuntos().length >= MAX_ADJUNTOS) { this.aviso.set(`Máximo ${MAX_ADJUNTOS} archivos por mensaje.`); break; }
      if (f.size > max && !f.type.startsWith('image/')) { this.aviso.set(`${f.name}: supera ${this.estado()?.maxArchivoMb ?? 15} MB.`); continue; }
      const clave = crypto.randomUUID();
      const vista = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
      this.adjuntos.update(l => [...l, { clave, nombre: f.name || 'archivo', tipoMime: f.type, estado: 'subiendo', vista }]);
      this.subirUno(clave, f);
    }
  }

  private async subirUno(clave: string, f: File): Promise<void> {
    try {
      const blob = f.type.startsWith('image/') ? await reducirImagen(f) : f;
      const nombre = nombreAlSubir(f, blob);
      const a = await firstValueFrom(this.api.subir(blob, nombre, this.conversacionId()));
      this.cambiarAdjunto(clave, { archivo: a, estado: a.estado === 'ERROR' ? 'error' : 'leyendo', error: a.error });
      const fin = a.estado === 'PENDIENTE' ? await this.api.esperarArchivo(a.id) : a;
      this.cambiarAdjunto(clave, { archivo: fin, estado: fin.estado === 'LISTO' ? 'listo' : fin.estado === 'ERROR' ? 'error' : 'leyendo', error: fin.error });
    } catch (e) {
      this.cambiarAdjunto(clave, { estado: 'error', error: mensajeDeError(e, 'No se pudo subir') });
    }
  }

  quitarAdjunto(clave: string): void {
    const a = this.adjuntos().find(x => x.clave === clave);
    if (a?.vista) URL.revokeObjectURL(a.vista);
    this.adjuntos.update(l => l.filter(x => x.clave !== clave));
  }

  private cambiarAdjunto(clave: string, c: Partial<AdjuntoLocal>): void {
    this.adjuntos.update(l => l.map(a => a.clave === clave ? { ...a, ...c } : a));
  }

  ver(archivos: ArchivoChat[], i: number): void {
    import('./visor-archivo-ia').then(({ VisorArchivoIa }) =>
      this.dialog.open(VisorArchivoIa, {
        data: { archivos, indice: i }, width: 'min(1100px, 96vw)', maxWidth: '96vw', panelClass: 'cia-visor-panel', autoFocus: false,
      }));
  }

  async descargar(a: ArchivoChat): Promise<void> {
    try { await this.api.descargar(a); } catch (e) { this.aviso.set(mensajeDeError(e, 'No se pudo descargar.')); }
  }

  // ── Voz ──

  async alternarGrabacion(): Promise<void> {
    if (this.grabadora.grabando()) { this.grabadora.detener(false); return; }
    if (!this.puedeGrabar) { this.aviso.set('Este navegador no permite grabar audio.'); return; }
    this.reproductor.callar();
    let fin: Promise<Blob | null>;
    try {
      fin = (await this.grabadora.iniciar()).fin;
    } catch (e: unknown) {
      const n = (e as { name?: string })?.name;
      this.aviso.set(n === 'NotAllowedError' ? 'Permita el micrófono para enviar notas de voz.' : 'No se pudo usar el micrófono.');
      return;
    }
    const audio = await fin;
    if (!audio) return;
    if (audio.size < 1500) { this.aviso.set('La nota de voz quedó muy corta.'); return; }
    const ext = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm';
    this.enviando.set(true);
    try {
      const a = await firstValueFrom(this.api.subir(audio, `nota-de-voz.${ext}`, this.conversacionId()));
      this.enviando.set(false);
      await this.enviar(true, a);
    } catch (e) {
      this.enviando.set(false);
      this.aviso.set(mensajeDeError(e, 'No se pudo enviar la nota de voz.'));
    }
  }

  cancelarGrabacion(): void {
    this.grabadora.detener(true);
  }

  /** Lee en voz alta una respuesta (voz del servidor; si no hay, la del navegador). */
  async escuchar(m: MensajeChat, automatico = false): Promise<void> {
    if (this.reproductor.sonando() === m.id) { this.reproductor.callar(); return; }
    try {
      let url = this.vozUrls.get(m.id);
      if (!url) {
        if (!this.estado()?.voz) throw new Error('sin voz');
        this.cargandoVoz.set(m.id);
        let a = await firstValueFrom(this.api.voz(m.id));
        if (a.estado === 'PENDIENTE') a = await this.api.esperarArchivo(a.id, 90_000, 700);
        if (a.estado !== 'LISTO') throw new Error(a.error || 'voz no disponible');
        url = URL.createObjectURL(await firstValueFrom(this.api.contenido(a.id)));
        this.vozUrls.set(m.id, url);
      }
      this.cargandoVoz.set(null);
      await this.reproductor.reproducir(m.id, url);
    } catch {
      this.cargandoVoz.set(null);
      // En el navegador, el audio automático puede estar bloqueado: solo se usa el respaldo si la persona lo pidió.
      if (!automatico || this.leerSiempre()) this.reproductor.leerConNavegador(m.id, textoParaVoz(m.contenido));
    }
  }

  alternarLeer(): void {
    const v = !this.leerSiempre();
    this.leerSiempre.set(v);
    try { localStorage.setItem(CLAVE_LEER, v ? '1' : '0'); } catch { /* opcional */ }
    if (!v) this.reproductor.callar();
  }

  async copiar(m: MensajeChat): Promise<void> {
    try {
      await navigator.clipboard.writeText(sinMarcas(m.contenido));
      this.copiado.set(m.id);
      setTimeout(() => this.copiado.set(null), 1500);
    } catch { this.aviso.set('No se pudo copiar.'); }
  }

  // ── Utilidades de vista ──

  /**
   * Vacía la caja de texto. Además del signal se limpia el elemento: si se escribe y se da
   * Enter muy rápido, la detección de cambios (zoneless) puede no haber visto el texto y el
   * paso de "" a "" no repinta la caja (pasó en la prueba con Playwright).
   */
  private vaciarEntrada(): void {
    this.texto.set('');
    const t = this.entrada()?.nativeElement;
    if (t) t.value = '';
    setTimeout(() => this.ajustarAltura());
  }

  ajustarAltura(): void {
    const t = this.entrada()?.nativeElement;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 168) + 'px';
  }

  private bajar(forzar = false): void {
    setTimeout(() => {
      const h = this.hilo()?.nativeElement;
      if (!h) return;
      const cerca = h.scrollHeight - h.scrollTop - h.clientHeight < 160;
      if (forzar || cerca) h.scrollTo({ top: h.scrollHeight, behavior: forzar ? 'auto' : 'smooth' });
    }, 30);
  }

  segundosGrabados(): string {
    const s = this.grabadora.segundos();
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  esUltimoAsistente(m: MensajeChat): boolean {
    const l = this.mensajes();
    return l.length > 0 && l[l.length - 1].id === m.id;
  }

  private leerGuardado(): boolean {
    try { return localStorage.getItem(CLAVE_LEER) === '1'; } catch { return false; }
  }
}

function limpiarParametros(p?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p ?? {})) if (v !== null && v !== undefined && v !== '') out[k] = String(v);
  return out;
}
