import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, PLATFORM_ID, computed, effect, inject, input,
  signal, untracked, viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { BotService } from '../../services/bot.service';
import {
  Compromiso, EstadoCompromiso, Evento, MomentoClave, Notas, Sesion, SugerenciaIa, TipoComando,
} from '../../models/bot.model';
import { PLATAFORMAS, esTerminal, esVivo, estadoInfo, fusionarEventos, markdownSimple, ultimoId } from '../../utils/bot';
import { CapturaDispositivoComponent } from '../../components/captura-dispositivo/captura-dispositivo.component';
import { contiene, mensajeError } from '../../../utils/texto';
import { reloj, fechaHora } from '../../../utils/tiempo';

type PestanaPanel = 'notas' | 'compromisos' | 'capturas' | 'clips';
type ColumnaMovil = 'transcripcion' | 'panel' | 'chat';

/** Cadencia normal del feed en vivo y tope del backoff ante errores. */
export const POLL_MS = 2000;
export const POLL_MAX_MS = 20000;
/** Tope de espera de la respuesta de la IA antes de darla por perdida. */
export const ESPERA_IA_MS = 90_000;
/** Las URL firmadas viven 10 min; se renuevan un minuto antes de que venzan. */
const URL_TTL_MS = 9 * 60_000;
const URL_MARGEN_MS = 60_000;

export const PREGUNTAS_RAPIDAS = [
  '¿Qué se ha decidido hasta ahora?',
  'Resume los últimos 5 minutos',
  '¿Qué compromisos hay y de quién?',
  '¿Qué me falta preguntar?',
  'Propón una respuesta a lo último que dijeron',
];

interface UrlFirmada { url: string; vence: number; }

/** Un turno del chat con la IA: la pregunta y, cuando llegue, su respuesta. */
export interface TurnoChat {
  pregunta: Evento;
  respuesta: Evento | null;
  esperando: boolean;
  vencida: boolean;
}

/**
 * Sala en vivo del asistente de reuniones. Pensada para que la persona siga trabajando
 * mientras el bot está en la reunión: transcripción a la izquierda, notas/compromisos/
 * capturas/clips al centro y la IA a la derecha (en móvil, una columna con pestañas).
 *
 * El feed llega por polling a `/live` con cursor (`desde`) cada 2 s, se pausa si la
 * pestaña está oculta, hace backoff ante errores y se detiene cuando la sesión es
 * terminal… salvo que haya una pregunta a la IA esperando respuesta (la respuesta llega
 * por el feed aunque la sesión haya cerrado).
 */
@Component({
  selector: 'app-bot-sala',
  standalone: true,
  imports: [RouterLink, MatIconModule, MatTooltipModule, CapturaDispositivoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bot-sala.component.html',
  styleUrls: ['../../../estilos/base.css', './bot-sala.component.css'],
})
export class BotSalaComponent {
  private readonly api = inject(BotService);
  private readonly navegador = isPlatformBrowser(inject(PLATFORM_ID));

  readonly sessionId = input.required<string>();

  readonly PREGUNTAS = PREGUNTAS_RAPIDAS;
  readonly reloj = reloj;
  readonly fechaHora = fechaHora;

  // ── Estado del feed ───────────────────────────────────────────────────────
  readonly sesion = signal<Sesion | null>(null);
  readonly eventos = signal<Evento[]>([]);
  readonly notas = signal<Notas | null>(null);
  readonly compromisos = signal<Compromiso[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly sinConexion = signal(false);
  private cursor = 0;
  private notasVersion = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private espera = POLL_MS;
  private enVuelo = false;
  private vivo = true;

  readonly ahora = signal(Date.now());

  // ── UI ────────────────────────────────────────────────────────────────────
  readonly pestana = signal<PestanaPanel>('notas');
  readonly columnaMovil = signal<ColumnaMovil>('transcripcion');
  readonly busqueda = signal('');
  readonly seguir = signal(true);
  readonly resaltado = signal<number | null>(null);
  readonly verSubtitulos = signal(false);
  readonly soloImportantes = signal(false);
  readonly lightbox = signal<Evento | null>(null);
  readonly toast = signal('');
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  readonly ocupado = signal<TipoComando | 'MARCA' | null>(null);
  readonly pausado = signal(false);
  readonly mensajeReunion = signal('');
  readonly escribiendoReunion = signal(false);
  readonly confirmarSalida = signal(false);

  // Chat
  readonly pregunta = signal('');
  readonly enviandoPregunta = signal(false);
  readonly errorChat = signal('');

  // Compromisos
  readonly editando = signal<string | null>(null);
  readonly borrador = signal<{ texto: string; responsable: string; fecha_limite: string }>({ texto: '', responsable: '', fecha_limite: '' });
  readonly nuevoCompromiso = signal<{ texto: string; responsable: string; fecha_limite: string } | null>(null);

  // URL firmadas de capturas y clips
  readonly urls = signal<Record<number, UrlFirmada>>({});
  private pidiendoUrl = new Set<number>();

  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');
  private readonly chatLista = viewChild<ElementRef<HTMLElement>>('chatLista');

  // ── Derivados ─────────────────────────────────────────────────────────────
  readonly estado = computed(() => estadoInfo(this.sesion()?.estado));
  readonly plataforma = computed(() => PLATAFORMAS[this.sesion()?.plataforma ?? 'OTRA'] ?? PLATAFORMAS.OTRA);
  readonly terminal = computed(() => esTerminal(this.sesion()?.estado));
  readonly enVivo = computed(() => esVivo(this.sesion()?.estado));
  readonly enCurso = computed(() => this.sesion()?.estado === 'EN_CURSO');
  readonly esCaptura = computed(() => this.sesion()?.modo === 'CAPTURA');

  readonly cronometro = computed(() => {
    const s = this.sesion();
    if (!s) return '--:--';
    if (s.duracion_ms != null && this.terminal()) return reloj(s.duracion_ms);
    if (!s.unido_en) return '--:--';
    return reloj(this.ahora() - new Date(s.unido_en).getTime());
  });

  readonly hayTranscripcion = computed(() => this.eventos().some(e => e.tipo === 'TRANSCRIPCION'));
  readonly haySubtitulos = computed(() => this.eventos().some(e => e.tipo === 'SUBTITULO'));

  /** Transcripción + marcas + cambios de estado, en orden. Subtítulos solo si se piden (o si no hay otra cosa). */
  readonly lineas = computed(() => {
    const subs = this.verSubtitulos() || !this.hayTranscripcion();
    const q = this.busqueda().trim();
    return this.eventos().filter(e => {
      const tipoOk = e.tipo === 'TRANSCRIPCION' || e.tipo === 'MARCA' || e.tipo === 'ESTADO'
        || e.tipo === 'CHAT_REUNION' || e.tipo === 'PARTICIPANTE' || (subs && e.tipo === 'SUBTITULO');
      if (!tipoOk) return false;
      return !q || contiene(e.texto, q) || contiene(e.hablante, q);
    });
  });

  readonly capturas = computed(() => this.eventos()
    .filter(e => e.tipo === 'CAPTURA' && e.archivo && (!this.soloImportantes() || e.importante))
    .slice().reverse());
  readonly totalCapturas = computed(() => this.eventos().filter(e => e.tipo === 'CAPTURA' && e.archivo).length);
  readonly clips = computed(() => this.eventos().filter(e => e.tipo === 'CLIP').slice().reverse());

  readonly turnosChat = computed<TurnoChat[]>(() => {
    const chat = this.eventos().filter(e => e.tipo === 'CHAT_IA');
    const respuestas = new Map<number, Evento>();
    for (const e of chat) {
      const ref = Number(e.payload?.['en_respuesta_a']);
      if (this.rolDe(e) === 'IA' && Number.isFinite(ref)) respuestas.set(ref, e);
    }
    const ahora = this.ahora();
    return chat.filter(e => this.rolDe(e) === 'USUARIO').map(p => {
      const r = respuestas.get(p.id) ?? null;
      const edad = ahora - new Date(p.creado_en).getTime();
      return { pregunta: p, respuesta: r, esperando: !r && edad < ESPERA_IA_MS, vencida: !r && edad >= ESPERA_IA_MS };
    });
  });
  readonly preguntaPendiente = computed(() => this.turnosChat().some(t => t.esperando));

  readonly resumenHtml = computed(() => markdownSimple(this.notas()?.resumen));
  readonly compromisosVisibles = computed(() => this.compromisos().filter(c => c.estado !== 'DESCARTADO'));
  readonly compromisosDescartados = computed(() => this.compromisos().filter(c => c.estado === 'DESCARTADO').length);

  constructor() {
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => {
      this.vivo = false;
      if (this.timer) clearTimeout(this.timer);
      if (this.toastTimer) clearTimeout(this.toastTimer);
      if (this.navegador) document.removeEventListener('visibilitychange', this.alCambiarVisibilidad);
    });

    if (this.navegador) {
      document.addEventListener('visibilitychange', this.alCambiarVisibilidad);
      const reloj = setInterval(() => this.ahora.set(Date.now()), 1000);
      destroy.onDestroy(() => clearInterval(reloj));
    }

    // Cambio de sesión (o primera carga): se reinicia el feed.
    effect(() => {
      const id = this.sessionId();
      untracked(() => this.reiniciar(id));
    });

    // Autoscroll de la transcripción mientras la persona esté abajo.
    effect(() => {
      this.lineas();
      if (!untracked(this.seguir)) return;
      queueMicrotask(() => this.alFinal());
    });

    // Chat: siempre a lo último cuando entra algo nuevo.
    effect(() => {
      this.turnosChat().length;
      const el = untracked(this.chatLista)?.nativeElement;
      if (el) queueMicrotask(() => el.scrollTop = el.scrollHeight);
    });

    // URL firmadas para lo que se está viendo.
    effect(() => {
      const visibles = this.pestana() === 'capturas' ? this.capturas().slice(0, 48)
        : this.pestana() === 'clips' ? this.clips().filter(c => c.archivo) : [];
      const extra = this.lightbox();
      this.ahora();   // re-evalúa: renueva las que vencen
      untracked(() => {
        for (const e of extra ? [...visibles, extra] : visibles) this.asegurarUrl(e);
      });
    });
  }

  // ── Feed ──────────────────────────────────────────────────────────────────

  private reiniciar(id: string): void {
    if (this.timer) clearTimeout(this.timer);
    this.cursor = 0;
    this.notasVersion = 0;
    this.sesion.set(null);
    this.eventos.set([]);
    this.notas.set(null);
    this.compromisos.set([]);
    this.urls.set({});
    this.cargando.set(true);
    this.error.set('');
    this.espera = POLL_MS;
    if (id) void this.tick();
  }

  private readonly alCambiarVisibilidad = () => {
    if (!document.hidden && !this.timer && !this.enVuelo && this.debeSeguir()) {
      this.espera = POLL_MS;
      void this.tick();
    }
  };

  private debeSeguir(): boolean {
    return this.vivo && (!this.terminal() || this.preguntaPendiente());
  }

  private programar(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.vivo || !this.debeSeguir()) return;
    // Pestaña oculta: no se pide nada; al volver, alCambiarVisibilidad retoma.
    if (this.navegador && document.hidden) return;
    this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, ms);
  }

  async tick(): Promise<void> {
    if (this.enVuelo) return;
    this.enVuelo = true;
    try {
      const r = await firstValueFrom(this.api.live(this.sessionId(), this.cursor, this.notasVersion));
      this.sesion.set(r.sesion);
      if (r.eventos?.length) {
        this.eventos.update(v => fusionarEventos(v, r.eventos));
      }
      this.cursor = Math.max(this.cursor, r.ultimo_id ?? 0, ultimoId(r.eventos ?? []));
      if (r.notas) {
        this.notas.set(r.notas);
        this.notasVersion = r.notas.version;
      }
      if (r.compromisos) this.compromisos.set(r.compromisos);
      this.error.set('');
      this.sinConexion.set(false);
      this.espera = POLL_MS;
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 403 || status === 404) {
        this.error.set(mensajeError(e, 'No se pudo abrir esta sesión'));
        this.vivo = false;
        return;
      }
      this.sinConexion.set(true);
      this.espera = Math.min(POLL_MAX_MS, Math.round(this.espera * 1.8));
    } finally {
      this.enVuelo = false;
      this.cargando.set(false);
      this.programar(this.espera);
    }
  }

  // ── Transcripción ─────────────────────────────────────────────────────────

  alDesplazar(el: HTMLElement): void {
    this.seguir.set(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  }

  alFinal(): void {
    const el = this.lista()?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
    this.seguir.set(true);
  }

  /** Salta al punto de la transcripción más cercano a `tMs` (momentos clave, temas, decisiones). */
  irA(tMs: number | null | undefined): void {
    if (tMs == null) return;
    const lineas = this.eventos().filter(e => e.tipo === 'TRANSCRIPCION' || e.tipo === 'SUBTITULO');
    if (!lineas.length) return;
    let mejor = lineas[0];
    for (const e of lineas) if (Math.abs((e.t_ms ?? 0) - tMs) < Math.abs((mejor.t_ms ?? 0) - tMs)) mejor = e;
    if (mejor.tipo === 'SUBTITULO' && this.hayTranscripcion()) this.verSubtitulos.set(true);
    this.busqueda.set('');
    this.columnaMovil.set('transcripcion');
    this.seguir.set(false);
    this.resaltado.set(mejor.id);
    setTimeout(() => {
      this.lista()?.nativeElement.querySelector(`[data-ev="${mejor.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    setTimeout(() => { if (this.resaltado() === mejor.id) this.resaltado.set(null); }, 4000);
  }

  claseLinea(e: Evento): string {
    return e.tipo === 'TRANSCRIPCION' || e.tipo === 'SUBTITULO' ? 'habla' : 'sistema';
  }

  // ── Comandos ──────────────────────────────────────────────────────────────

  async comando(tipo: TipoComando, extra: { texto?: string; segundos?: number } = {}, aviso = ''): Promise<boolean> {
    this.ocupado.set(tipo);
    try {
      await firstValueFrom(this.api.comando(this.sessionId(), tipo, extra));
      if (aviso) this.mostrar(aviso);
      return true;
    } catch (e) {
      this.mostrar(mensajeError(e, 'El bot no recibió la orden'));
      return false;
    } finally {
      this.ocupado.set(null);
    }
  }

  pantallazo(): void { void this.comando('CAPTURA', {}, 'Pantallazo pedido: aparecerá en Capturas.'); }

  async marcarMomento(): Promise<void> {
    const texto = (typeof prompt === 'function' ? prompt('¿Qué pasó en este momento? (opcional)') : '') ?? null;
    if (texto === null) return;
    this.ocupado.set('MARCA');
    try {
      await firstValueFrom(this.api.marca(this.sessionId(), texto.trim() || 'Momento marcado'));
      await firstValueFrom(this.api.comando(this.sessionId(), 'CLIP', { texto: texto.trim() || undefined }));
      this.mostrar('Momento marcado: el clip aparecerá en Clips.');
    } catch (e) {
      this.mostrar(mensajeError(e, 'No se pudo marcar el momento'));
    } finally {
      this.ocupado.set(null);
    }
  }

  async alternarPausa(): Promise<void> {
    const pausar = !this.pausado();
    const ok = await this.comando(pausar ? 'PAUSAR' : 'REANUDAR', {},
      pausar ? 'El bot dejó de grabar y transcribir.' : 'El bot volvió a grabar y transcribir.');
    if (ok) this.pausado.set(pausar);
  }

  async enviarAReunion(texto?: string): Promise<void> {
    const t = (texto ?? this.mensajeReunion()).trim();
    if (!t) return;
    const ok = await this.comando('ENVIAR_CHAT', { texto: t }, 'Mensaje enviado al chat de la reunión.');
    if (ok && texto === undefined) { this.mensajeReunion.set(''); this.escribiendoReunion.set(false); }
  }

  async sacarBot(): Promise<void> {
    this.confirmarSalida.set(false);
    await this.comando('SALIR', {}, this.esCaptura() ? 'Cerrando la captura…' : 'El bot está saliendo de la reunión.');
  }

  // ── Chat con la IA ────────────────────────────────────────────────────────

  rolDe(e: Evento): 'USUARIO' | 'IA' {
    const rol = e.payload?.['rol'];
    if (rol === 'USUARIO' || rol === 'IA') return rol;
    return e.autor === 'USUARIO' ? 'USUARIO' : 'IA';
  }

  sugerencias(e: Evento | null): SugerenciaIa[] {
    const s = e?.payload?.['sugerencias'];
    return Array.isArray(s) ? (s as SugerenciaIa[]).filter(x => x?.tipo === 'ENVIAR_CHAT' && !!x.texto) : [];
  }

  errorDe(e: Evento | null): string | null {
    const err = e?.payload?.['error'];
    return typeof err === 'string' && err ? err : null;
  }

  async preguntar(texto?: string): Promise<void> {
    const q = (texto ?? this.pregunta()).trim();
    if (!q || this.enviandoPregunta()) return;
    this.enviandoPregunta.set(true);
    this.errorChat.set('');
    try {
      const r = await firstValueFrom(this.api.chat(this.sessionId(), q));
      const llegados = [r.pregunta, ...(r.respuesta ? [r.respuesta] : [])].filter(Boolean);
      this.eventos.update(v => fusionarEventos(v, llegados));
      this.pregunta.set('');
      // La respuesta llega por el feed: se pide ya (y se reanuda aunque la sesión haya cerrado).
      this.espera = POLL_MS;
      if (!this.timer && !this.enVuelo) this.programar(800);
    } catch (e) {
      this.errorChat.set(mensajeError(e, 'La IA no recibió la pregunta'));
    } finally {
      this.enviandoPregunta.set(false);
    }
  }

  alTeclaPregunta(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void this.preguntar(); }
  }

  // ── Compromisos ───────────────────────────────────────────────────────────

  editar(c: Compromiso): void {
    this.editando.set(c.id);
    this.borrador.set({ texto: c.texto, responsable: c.responsable ?? '', fecha_limite: c.fecha_limite ?? '' });
  }

  campoBorrador(campo: 'texto' | 'responsable' | 'fecha_limite', valor: string): void {
    this.borrador.update(b => ({ ...b, [campo]: valor }));
  }

  async guardarEdicion(c: Compromiso): Promise<void> {
    const b = this.borrador();
    if (!b.texto.trim()) return;
    await this.patchCompromiso(c, {
      texto: b.texto.trim(), responsable: b.responsable.trim() || null, fecha_limite: b.fecha_limite || null,
    });
    this.editando.set(null);
  }

  cambiarEstado(c: Compromiso, estado: EstadoCompromiso): void { void this.patchCompromiso(c, { estado }); }

  private async patchCompromiso(c: Compromiso, cambios: Parameters<BotService['editarCompromiso']>[2]): Promise<void> {
    try {
      const nuevo = await firstValueFrom(this.api.editarCompromiso(this.sessionId(), c.id, cambios));
      this.compromisos.update(l => l.map(x => (x.id === c.id ? nuevo : x)));
    } catch (e) {
      this.mostrar(mensajeError(e, 'No se pudo guardar el compromiso'));
    }
  }

  abrirNuevoCompromiso(): void { this.nuevoCompromiso.set({ texto: '', responsable: '', fecha_limite: '' }); }

  campoNuevo(campo: 'texto' | 'responsable' | 'fecha_limite', valor: string): void {
    this.nuevoCompromiso.update(b => (b ? { ...b, [campo]: valor } : b));
  }

  async crearCompromiso(): Promise<void> {
    const b = this.nuevoCompromiso();
    if (!b || !b.texto.trim()) return;
    try {
      const c = await firstValueFrom(this.api.agregarCompromiso(this.sessionId(), {
        texto: b.texto.trim(), responsable: b.responsable.trim() || null, fecha_limite: b.fecha_limite || null,
      }));
      this.compromisos.update(l => [...l, c]);
      this.nuevoCompromiso.set(null);
    } catch (e) {
      this.mostrar(mensajeError(e, 'No se pudo agregar el compromiso'));
    }
  }

  // ── Archivos (capturas/clips) ─────────────────────────────────────────────

  url(e: Evento): string | null {
    const u = this.urls()[e.id];
    return u && u.vence > this.ahora() ? u.url : null;
  }

  private asegurarUrl(e: Evento): void {
    if (!e.archivo || this.pidiendoUrl.has(e.id)) return;
    const u = this.urls()[e.id];
    if (u && u.vence > Date.now()) return;
    this.pidiendoUrl.add(e.id);
    this.api.urlArchivo(this.sessionId(), e.id).subscribe({
      next: r => {
        const expira = r.expira_en ? new Date(r.expira_en).getTime() - URL_MARGEN_MS : NaN;
        const vence = Number.isFinite(expira) && expira > Date.now() ? expira : Date.now() + URL_TTL_MS;
        this.urls.update(m => ({ ...m, [e.id]: { url: this.api.absoluta(r.url), vence } }));
        this.pidiendoUrl.delete(e.id);
      },
      error: () => {
        // Se reintenta en el siguiente tic del reloj (no en bucle: cada segundo como mucho).
        setTimeout(() => this.pidiendoUrl.delete(e.id), 15_000);
      },
    });
  }

  /** Una imagen que falla (URL vencida en el servidor) pide otra firma. */
  alFallarArchivo(e: Evento): void {
    this.urls.update(m => { const c = { ...m }; delete c[e.id]; return c; });
  }

  motivoClip(e: Evento): string {
    const m = e.payload?.['motivo'];
    return (typeof m === 'string' && m) || e.texto || 'Clip';
  }

  rangoClip(e: Evento): string {
    const d = Number(e.payload?.['desde_ms']);
    const h = Number(e.payload?.['hasta_ms']);
    return Number.isFinite(d) && Number.isFinite(h) ? `${reloj(d)} – ${reloj(h)}` : reloj(e.t_ms);
  }

  momentoTrack(m: MomentoClave, i: number): string { return `${m.t_ms}-${i}`; }

  private mostrar(texto: string): void {
    this.toast.set(texto);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 4000);
  }
}
