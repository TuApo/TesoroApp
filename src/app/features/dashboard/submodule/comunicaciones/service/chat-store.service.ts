import { Injectable, Signal, WritableSignal, computed, effect, inject, signal } from '@angular/core';
import { Subject, firstValueFrom } from 'rxjs';
import { ComunicacionesApiService } from './comunicaciones-api.service';
import { ConexionSse, conectarSse, tokenActual } from '../../turnos/service/sse.util';
import { Adjunto, Conversacion, Favorito, LlamadaActiva, Llamada, Mensaje, UsuarioDir } from '../modelos';
import { SOPORTE_BOT, idCliente } from '../utiles';
import { sonarMensaje } from './sonidos';
import { AvisosChatService } from './avisos-chat.service';
import { obtenerUsuarioActual } from '../../../../../core/utils/usuario-actual';

export interface EventoChat { nombre: string; datos: any }

interface Escribiendo { usuario_id: string; nombre: string; hasta: number }

/**
 * Estado vivo del chat para toda la app: la lista de conversaciones, los
 * mensajes cargados de cada una, los no leídos, quién está conectado y quién
 * está escribiendo. Una sola conexión SSE por pestaña alimenta todo; el dock,
 * las ventanas, la página completa y las llamadas leen de aquí.
 */
@Injectable({ providedIn: 'root' })
export class ChatStoreService {
  private readonly api = inject(ComunicacionesApiService);
  private readonly avisos = inject(AvisosChatService);

  readonly yo = signal<UsuarioDir | null>(null);
  readonly miId = computed(() => this.yo()?.id ?? obtenerUsuarioActual().id);
  readonly conversaciones = signal<Conversacion[]>([]);
  readonly cargado = signal(false);
  readonly estadoCanal = signal<'conectando' | 'conectado' | 'reconectando' | 'cerrado'>('cerrado');
  readonly iaDisponible = signal(false);
  /**
   * Mis favoritos: quienes me atienden las novedades (asignados por la administración),
   * mis coordinadores y los que marqué con estrella. Van arriba de la lista de chats.
   */
  readonly favoritos = signal<Favorito[]>([]);
  /** Quienes me atienden (asignados y coordinadores): a quién escribir desde un canal de anuncios. */
  readonly misContactos = computed(() => this.favoritos().filter(f => f.origen !== 'PERSONAL'));
  readonly estrellas = computed(() => new Set(this.favoritos().filter(f => f.estrella).map(f => f.usuario.id)));
  /** Puede asignar los contactos para novedades (administración). */
  readonly administraContactos = signal(false);
  /** Llamadas que me entraron y no contesté desde la última vez que abrí Llamadas. */
  readonly perdidasSinVer = signal(0);
  /** En el celular, una conversación abierta ocupa toda la pantalla (tapa la barra de abajo). */
  readonly enfoqueMovil = signal(false);
  private esperaPerdidas: ReturnType<typeof setTimeout> | null = null;
  private relojFavoritos: ReturnType<typeof setInterval> | null = null;
  /** Mi línea de soporte, si ya la abrí alguna vez. */
  readonly miSoporte = computed(() => this.conversaciones().find(c => c.tipo === 'SOPORTE' && c.otro_usuario_id === SOPORTE_BOT));
  /** Diferencia reloj del servidor − reloj local (ms): las grabaciones se sellan con hora del servidor. */
  readonly desfaseReloj = signal(0);

  /** Cuántos chats (no mensajes) tienen algo sin leer: el número de la pestaña Chat. */
  readonly chatsSinLeer = computed(() => this.conversaciones().filter(c => !c.silenciada && (c.no_leidos || 0) > 0).length);

  readonly totalNoLeidos = computed(() =>
    this.conversaciones().filter(c => !c.silenciada).reduce((s, c) => s + (c.no_leidos || 0), 0));

  /** Eventos crudos del canal para quien los necesite (llamadas, memoria, compromisos). */
  readonly eventos$ = new Subject<EventoChat>();
  /** Un texto para dejar en el redactor de una conversación (el borrador que armó el asistente). */
  readonly insertarEnComposer$ = new Subject<{ conversacionId: string; texto: string }>();
  /** Mensaje nuevo de otra persona: el dock resalta la pestaña y suena. */
  readonly mensajeEntrante$ = new Subject<{ conversacion: Conversacion; mensaje: Mensaje }>();

  private readonly mensajes = new Map<string, WritableSignal<Mensaje[]>>();
  private readonly completos = new Map<string, WritableSignal<boolean>>();
  private readonly cargando = new Set<string>();
  private readonly escribiendoMap = signal<Record<string, Escribiendo[]>>({});
  private readonly visibles = new Map<string, number>();
  private readonly ultimoEscribiendo = new Map<string, number>();
  private conexion: ConexionSse | null = null;
  private iniciado = false;
  private yaConecto = false;
  private reloj: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // "(3) TuApo": el contador en el título de la pestaña, como cualquier chat.
    effect(() => {
      const n = this.totalNoLeidos();
      if (typeof document === 'undefined') return;
      const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
      document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${base}` : base;
    });
  }

  // ─── Ciclo de vida ──────────────────────────────────────────────────────

  iniciar(): void {
    if (this.iniciado || typeof window === 'undefined') return;
    const token = tokenActual();
    if (!token) return;
    this.iniciado = true;
    this.api.yo().subscribe({ next: u => this.yo.set(u), error: () => undefined });
    this.api.estado().subscribe({
      next: e => { this.iaDisponible.set(!!e?.ia); this.administraContactos.set(!!e?.administra_contactos); },
      error: () => undefined,
    });
    this.cargarFavoritos();
    this.refrescarPerdidas();
    // La actividad de los favoritos ("activo hace 5 min") se refresca sola.
    this.relojFavoritos = setInterval(() => { if (document.visibilityState === 'visible') this.cargarFavoritos(); }, 180_000);
    this.recargarConversaciones();
    this.conexion = conectarSse(this.api.urlEventos(), {
      token,
      onEstado: e => this.estadoCanal.set(e),
      onEvento: (nombre, datos) => this.alEvento(nombre, datos),
    });
    // Limpia los "está escribiendo" vencidos.
    this.reloj = setInterval(() => this.podarEscribiendo(), 1500);
    document.addEventListener('visibilitychange', this.alCambiarVisibilidad);
  }

  detener(): void {
    this.conexion?.cerrar();
    this.conexion = null;
    if (this.reloj) clearInterval(this.reloj);
    this.reloj = null;
    this.iniciado = false;
    this.yaConecto = false;
    this.conversaciones.set([]);
    this.favoritos.set([]);
    this.administraContactos.set(false);
    if (this.relojFavoritos) clearInterval(this.relojFavoritos);
    this.relojFavoritos = null;
    this.yo.set(null);
    this.mensajes.clear();
    this.completos.clear();
    this.cargado.set(false);
    document.removeEventListener('visibilitychange', this.alCambiarVisibilidad);
  }

  private readonly alCambiarVisibilidad = () => {
    if (document.visibilityState === 'visible') {
      for (const id of this.visibles.keys()) this.marcarLeido(id);
    }
  };

  recargarConversaciones(): void {
    this.api.conversaciones().subscribe({
      next: lista => { this.conversaciones.set(this.ordenar(lista)); this.cargado.set(true); },
      error: () => this.cargado.set(true),
    });
  }

  // ─── Lectura ────────────────────────────────────────────────────────────

  conversacion(id: string | null | undefined): Conversacion | undefined {
    return id ? this.conversaciones().find(c => c.id === id) : undefined;
  }

  /** Señal de los mensajes cargados de una conversación (la crea y carga la primera página). */
  mensajesDe(id: string): Signal<Mensaje[]> {
    let s = this.mensajes.get(id);
    if (!s) {
      s = signal<Mensaje[]>([]);
      this.mensajes.set(id, s);
      this.completos.set(id, signal(false));
      this.cargarUltimos(id);
    }
    return s;
  }

  completo(id: string): Signal<boolean> {
    this.mensajesDe(id);
    return this.completos.get(id)!;
  }

  estaCargando(id: string): boolean { return this.cargando.has(id); }

  private cargarUltimos(id: string): void {
    this.cargando.add(id);
    this.api.mensajes(id, { limite: 40 }).subscribe({
      next: lista => {
        this.mensajes.get(id)?.set(lista);
        if (lista.length < 40) this.completos.get(id)?.set(true);
        this.cargando.delete(id);
      },
      error: () => this.cargando.delete(id),
    });
  }

  /** Página anterior (scroll hacia arriba). Devuelve cuántos llegaron. */
  async cargarAnteriores(id: string): Promise<number> {
    const s = this.mensajes.get(id);
    if (!s || this.cargando.has(id) || this.completos.get(id)?.()) return 0;
    const primero = s().find(m => m.id > 0)?.id;
    if (!primero) return 0;
    this.cargando.add(id);
    try {
      const lista = await firstValueFrom(this.api.mensajes(id, { antes: primero, limite: 40 }));
      s.update(actuales => [...lista.filter(m => !actuales.some(a => a.id === m.id)), ...actuales]);
      if (lista.length < 40) this.completos.get(id)?.set(true);
      return lista.length;
    } finally {
      this.cargando.delete(id);
    }
  }

  escribiendoEn(id: string): Escribiendo[] {
    return (this.escribiendoMap()[id] ?? []).filter(e => e.usuario_id !== this.miId());
  }

  enLinea(usuarioId: string | null | undefined): boolean {
    if (!usuarioId) return false;
    for (const c of this.conversaciones()) {
      const p = c.participantes.find(x => x.usuario_id === usuarioId);
      if (p) return p.en_linea;
    }
    return false;
  }

  // ─── Escritura ──────────────────────────────────────────────────────────

  /**
   * Envío optimista: el mensaje aparece de inmediato con un id provisional
   * negativo y se reemplaza por el del servidor. El cliente_id hace que un
   * reintento no lo duplique.
   */
  enviar(conversacionId: string, texto: string | null, adjuntos: Adjunto[] = [], respondeA: Mensaje | null = null): void {
    const s = this.mensajesDe(conversacionId) as WritableSignal<Mensaje[]>;
    const clienteId = idCliente();
    const provisional: Mensaje = {
      id: -Date.now(), conversacion_id: conversacionId, autor_id: this.miId(), autor_nombre: this.yo()?.nombre ?? '',
      tipo: texto ? 'TEXTO' : 'ARCHIVO', texto, responde_a_id: respondeA?.id ?? null,
      responde_a: respondeA ? { id: respondeA.id, autor_id: respondeA.autor_id, autor_nombre: respondeA.autor_nombre,
        tipo: respondeA.tipo, texto: respondeA.texto, eliminado: respondeA.eliminado } : null,
      llamada_id: null, meta: null, adjuntos, creado_en: new Date().toISOString(), editado_en: null, eliminado: false,
      cliente_id: clienteId, _estado: 'enviando',
    };
    s.update(l => [...l, provisional]);
    this.mandar(conversacionId, provisional);
  }

  reintentar(conversacionId: string, m: Mensaje): void {
    const s = this.mensajes.get(conversacionId);
    s?.update(l => l.map(x => x.cliente_id === m.cliente_id ? { ...x, _estado: 'enviando' } : x));
    this.mandar(conversacionId, m);
  }

  descartarFallido(conversacionId: string, m: Mensaje): void {
    this.mensajes.get(conversacionId)?.update(l => l.filter(x => x.cliente_id !== m.cliente_id));
  }

  private mandar(conversacionId: string, m: Mensaje): void {
    this.api.enviar(conversacionId, {
      texto: m.texto, responde_a_id: m.responde_a_id, adjuntos: m.adjuntos.map(a => a.id), cliente_id: m.cliente_id!,
    }).subscribe({
      next: real => this.integrarMensaje(real),
      error: () => this.mensajes.get(conversacionId)?.update(l =>
        l.map(x => x.cliente_id === m.cliente_id ? { ...x, _estado: 'error' } : x)),
    });
  }

  editar(m: Mensaje, texto: string): void {
    this.api.editar(m.id, texto).subscribe({ next: r => this.reemplazar(r) });
  }

  eliminar(m: Mensaje): void {
    this.api.eliminar(m.id).subscribe({ next: r => this.reemplazar(r) });
  }

  /** Marca leída la conversación hasta el último mensaje cargado. */
  marcarLeido(conversacionId: string): void {
    const c = this.conversacion(conversacionId);
    if (!c || !c.ultimo_mensaje_id) return;
    if (c.no_leidos === 0 && c.mi_ultimo_leido_id >= c.ultimo_mensaje_id) return;
    const hasta = c.ultimo_mensaje_id;
    this.parchar(conversacionId, { no_leidos: 0, mi_ultimo_leido_id: hasta });
    this.api.leido(conversacionId, hasta).subscribe({ error: () => undefined });
    this.avisos.marcarLeidos(conversacionId);
  }

  /** Avisa a los demás que estoy escribiendo (como mucho cada 3 s). */
  escribiendo(conversacionId: string): void {
    const ahora = Date.now();
    if ((this.ultimoEscribiendo.get(conversacionId) ?? 0) > ahora - 3000) return;
    this.ultimoEscribiendo.set(conversacionId, ahora);
    this.api.escribiendo(conversacionId).subscribe({ error: () => undefined });
  }

  /** Una ventana o la página muestra esta conversación: lo que llegue se da por leído. */
  marcarVisible(conversacionId: string, visible: boolean): void {
    const n = (this.visibles.get(conversacionId) ?? 0) + (visible ? 1 : -1);
    if (n <= 0) this.visibles.delete(conversacionId); else this.visibles.set(conversacionId, n);
    if (visible) {
      this.marcarLeido(conversacionId);
      // Aunque ya estuviera leído (en otra pestaña), sus avisos de la campana también.
      this.avisos.marcarLeidos(conversacionId);
    }
  }

  estaVisible(conversacionId: string): boolean {
    return this.visibles.has(conversacionId) && typeof document !== 'undefined' && document.visibilityState === 'visible';
  }

  async abrirDirecta(usuarioId: string): Promise<Conversacion> {
    const c = await firstValueFrom(this.api.directa(usuarioId));
    this.upsert(c);
    return c;
  }

  async crearGrupo(titulo: string, participantes: string[], descripcion?: string): Promise<Conversacion> {
    const c = await firstValueFrom(this.api.grupo(titulo, participantes, descripcion));
    this.upsert(c);
    return c;
  }

  private claveLlamadasVistas(): string { return `com-llamadas-vistas:${this.miId()}`; }

  /** Cuenta las llamadas perdidas nuevas (entrantes sin contestar después de la última visita a Llamadas). */
  refrescarPerdidas(): void {
    if (this.esperaPerdidas) clearTimeout(this.esperaPerdidas);
    this.esperaPerdidas = setTimeout(() => {
      this.api.historial(undefined, 40).subscribe({
        next: lista => {
          let desde = 0;
          try { desde = Number(localStorage.getItem(this.claveLlamadasVistas())) || 0; } catch { /* sin almacenamiento */ }
          const yo = this.miId();
          this.perdidasSinVer.set(lista.filter(l => l.iniciada_por !== yo && (l.estado === 'PERDIDA' || l.estado === 'CANCELADA')
            && Date.parse(l.creada_en) > desde).length);
        },
        error: () => undefined,
      });
    }, 400);
  }

  marcarLlamadasVistas(): void {
    try { localStorage.setItem(this.claveLlamadasVistas(), String(Date.now())); } catch { /* sin almacenamiento */ }
    this.perdidasSinVer.set(0);
  }

  cargarFavoritos(): void {
    this.api.misFavoritos().subscribe({ next: l => this.favoritos.set(l ?? []), error: () => undefined });
  }

  /** Marca o desmarca a alguien con la estrella. */
  async estrella(usuarioId: string, poner: boolean): Promise<void> {
    await firstValueFrom(this.api.estrella(usuarioId, poner));
    this.cargarFavoritos();
  }

  /** Pide abrir una conversación donde se esté mirando: el dock abre una ventana, la página la muestra. */
  pedirAbrir(conversacionId: string): void {
    this.eventos$.next({ nombre: 'abrir-conversacion', datos: { conversacion_id: conversacionId } });
  }

  /** Abre (o crea) mi línea de soporte con el asistente. */
  async abrirSoporte(): Promise<Conversacion> {
    const c = await firstValueFrom(this.api.soporte());
    this.upsert(c);
    return c;
  }

  async escalarSoporte(id: string): Promise<void> {
    this.upsert(await firstValueFrom(this.api.escalarSoporte(id)));
  }

  /** Quien atendía sale de la conversación; la dueña la sigue viendo con el asistente de vuelta. */
  async cerrarSoporte(id: string): Promise<void> {
    const c = await firstValueFrom(this.api.cerrarSoporte(id));
    if (c) this.upsert(c); else this.quitar(id);
  }

  upsert(c: Conversacion): void {
    this.conversaciones.update(l => {
      const i = l.findIndex(x => x.id === c.id);
      const nueva = i >= 0 ? l.map(x => x.id === c.id ? c : x) : [c, ...l];
      return this.ordenar(nueva);
    });
  }

  refrescar(id: string): void {
    this.api.conversacion(id).subscribe({
      next: c => this.upsert(c),
      error: e => { if (e?.status === 403 || e?.status === 404) this.quitar(id); },
    });
  }

  quitar(id: string): void {
    this.conversaciones.update(l => l.filter(c => c.id !== id));
  }

  parchar(id: string, cambios: Partial<Conversacion>): void {
    const reordena = 'no_leidos' in cambios || 'fijada' in cambios || 'silenciada' in cambios || 'ultimo_mensaje_id' in cambios;
    this.conversaciones.update(l => {
      const nueva = l.map(c => c.id === id ? { ...c, ...cambios } : c);
      return reordena ? this.ordenar(nueva) : nueva;
    });
  }

  // ─── Canal ──────────────────────────────────────────────────────────────

  private alEvento(nombre: string, datos: any): void {
    switch (nombre) {
      case 'conectado':
        if (datos?.servidor_ahora_ms) this.desfaseReloj.set(datos.servidor_ahora_ms - Date.now());
        if (this.yaConecto) this.ponerseAlDia();
        this.yaConecto = true;
        break;
      case 'mensaje': this.alMensaje(datos as Mensaje); break;
      case 'mensaje-editado': this.reemplazar(datos as Mensaje); break;
      case 'leido': this.alLeido(datos); break;
      case 'escribiendo': this.alEscribiendo(datos); break;
      case 'presencia': this.alPresencia(datos); break;
      case 'conversacion': if (datos?.conversacion_id) this.refrescar(datos.conversacion_id); break;
      case 'conversacion-salida': if (datos?.conversacion_id) this.quitar(datos.conversacion_id); break;
      case 'llamada':
        this.alLlamada(datos?.llamada as Llamada);
        if (['PERDIDA', 'CANCELADA'].includes(datos?.llamada?.estado)) this.refrescarPerdidas();
        break;
      default: break;
    }
    if (nombre !== 'latido') this.eventos$.next({ nombre, datos });
  }

  /** Tras un corte del canal: lista de chats de nuevo y lo que faltó en los chats abiertos. */
  private ponerseAlDia(): void {
    this.recargarConversaciones();
    for (const [id, s] of this.mensajes) {
      const ultimo = [...s()].reverse().find(m => m.id > 0)?.id;
      if (!ultimo) continue;
      this.api.mensajes(id, { despues: ultimo, limite: 100 }).subscribe({
        next: nuevos => nuevos.forEach(m => this.integrarMensaje(m)),
      });
    }
  }

  private alMensaje(m: Mensaje): void {
    this.integrarMensaje(m);
    const mio = m.autor_id === this.miId();
    const c = this.conversacion(m.conversacion_id);
    if (!c) {
      // Conversación nueva para mí (me escribieron por primera vez o me agregaron).
      this.api.conversacion(m.conversacion_id).subscribe({
        next: nueva => {
          this.upsert(nueva);
          if (!mio && m.tipo !== 'SISTEMA') this.avisarEntrante(nueva, m);
        },
      });
      return;
    }
    const vista = this.estaVisible(m.conversacion_id);
    const noLeidos = mio || vista ? 0 : (c.no_leidos || 0) + 1;
    this.parchar(m.conversacion_id, {
      ultimo_mensaje_id: m.id, ultimo_mensaje_en: m.creado_en,
      ultimo_mensaje_texto: vistaPrevia(m), ultimo_mensaje_autor: m.autor_nombre,
      no_leidos: noLeidos, archivada: false,
      mi_ultimo_leido_id: mio || vista ? m.id : c.mi_ultimo_leido_id,
    });
    this.conversaciones.update(l => this.ordenar(l));
    // Llegó con el chat a la vista: queda leído también en el servidor (antes solo en pantalla,
    // y al recargar volvía a salir como no leído) y en la campana.
    if (vista && !mio && m.id > 0) {
      this.api.leido(m.conversacion_id, m.id).subscribe({ error: () => undefined });
      this.avisos.marcarLeidos(m.conversacion_id);
    }
    if (!mio && m.tipo !== 'SISTEMA' && m.tipo !== 'LLAMADA') this.avisarEntrante(this.conversacion(m.conversacion_id)!, m);
    // Quien escribió ya no está "escribiendo".
    if (m.autor_id) this.quitarEscribiendo(m.conversacion_id, m.autor_id);
  }

  private avisarEntrante(c: Conversacion, m: Mensaje): void {
    this.mensajeEntrante$.next({ conversacion: c, mensaje: m });
    if (c.silenciada || this.estaVisible(c.id)) return;
    sonarMensaje();
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && 'Notification' in window
        && Notification.permission === 'granted') {
      try {
        const n = new Notification(c.tipo === 'DIRECTA' ? (m.autor_nombre ?? 'Mensaje nuevo') : `${m.autor_nombre} · ${c.nombre}`, {
          body: vistaPrevia(m) ?? '', tag: `cm-${c.id}`, icon: 'favicon.ico',
        });
        n.onclick = () => { window.focus(); this.eventos$.next({ nombre: 'abrir-conversacion', datos: { conversacion_id: c.id } }); n.close(); };
      } catch { /* algunos navegadores solo permiten notificaciones desde el service worker */ }
    }
  }

  /** Mete o reemplaza un mensaje en su lista (por id o por el id del cliente). */
  private integrarMensaje(m: Mensaje): void {
    const s = this.mensajes.get(m.conversacion_id);
    if (!s) return;
    s.update(l => {
      const i = l.findIndex(x => x.id === m.id || (m.cliente_id && x.cliente_id === m.cliente_id));
      if (i >= 0) { const copia = [...l]; copia[i] = m; return copia; }
      const nueva = [...l, m];
      // Los provisionales (id negativo) se quedan al final.
      return nueva.sort((a, b) => (a.id < 0 ? Number.MAX_SAFE_INTEGER : a.id) - (b.id < 0 ? Number.MAX_SAFE_INTEGER : b.id));
    });
  }

  private reemplazar(m: Mensaje): void {
    this.integrarMensaje(m);
    const c = this.conversacion(m.conversacion_id);
    if (c && c.ultimo_mensaje_id === m.id) this.parchar(c.id, { ultimo_mensaje_texto: vistaPrevia(m) });
  }

  private alLeido(d: { conversacion_id: string; usuario_id: string; hasta_id: number }): void {
    if (!d) return;
    if (d.usuario_id === this.miId()) {
      this.parchar(d.conversacion_id, { no_leidos: 0, mi_ultimo_leido_id: d.hasta_id });
    } else {
      this.conversaciones.update(l => l.map(c => c.id !== d.conversacion_id ? c : {
        ...c, participantes: c.participantes.map(p => p.usuario_id === d.usuario_id ? { ...p, ultimo_leido_id: d.hasta_id } : p),
      }));
    }
  }

  private alEscribiendo(d: { conversacion_id: string; usuario_id: string; nombre: string }): void {
    if (!d) return;
    this.escribiendoMap.update(m => {
      const actuales = (m[d.conversacion_id] ?? []).filter(e => e.usuario_id !== d.usuario_id);
      return { ...m, [d.conversacion_id]: [...actuales, { usuario_id: d.usuario_id, nombre: d.nombre, hasta: Date.now() + 5500 }] };
    });
  }

  private quitarEscribiendo(conversacionId: string, usuarioId: string): void {
    this.escribiendoMap.update(m => ({ ...m, [conversacionId]: (m[conversacionId] ?? []).filter(e => e.usuario_id !== usuarioId) }));
  }

  private podarEscribiendo(): void {
    const ahora = Date.now();
    const m = this.escribiendoMap();
    if (!Object.values(m).some(l => l.some(e => e.hasta < ahora))) return;
    const limpio: Record<string, Escribiendo[]> = {};
    for (const [k, l] of Object.entries(m)) limpio[k] = l.filter(e => e.hasta >= ahora);
    this.escribiendoMap.set(limpio);
  }

  private alPresencia(d: { usuario_id: string; en_linea: boolean; ultima_vez?: string | null }): void {
    if (!d) return;
    const ms = d.en_linea ? Date.now() : (d.ultima_vez ? Date.parse(d.ultima_vez) : Date.now());
    if (this.favoritos().some(k => k.usuario.id === d.usuario_id)) {
      this.favoritos.update(l => l.map(k => k.usuario.id === d.usuario_id
        ? { ...k, usuario: { ...k.usuario, en_linea: d.en_linea, ultima_vez_ms: ms } } : k));
    }
    this.conversaciones.update(l => l.map(c => c.participantes.some(p => p.usuario_id === d.usuario_id)
      ? { ...c, participantes: c.participantes.map(p => p.usuario_id === d.usuario_id ? { ...p, en_linea: d.en_linea, ultima_vez_ms: ms } : p) }
      : c));
  }

  private alLlamada(l: Llamada | undefined): void {
    if (!l) return;
    const activa = l.estado === 'SONANDO' || l.estado === 'EN_CURSO';
    const resumen: LlamadaActiva | null = activa ? {
      id: l.id, tipo: l.tipo, estado: l.estado, iniciada_por: l.iniciada_por, iniciada_por_nombre: l.iniciada_por_nombre,
      conectados: l.participantes.filter(p => p.estado === 'CONECTADO').map(p => p.usuario_id), creada_en: l.creada_en,
    } : null;
    this.parchar(l.conversacion_id, { llamada_activa: resumen });
  }

  /**
   * Orden de la lista: primero quien me escribió y no he leído (lo más reciente arriba),
   * luego los fijados, luego el resto por su último mensaje; los grupos que aún no tienen
   * mensajes (los automáticos por rango recién creados) van al final.
   */
  private ordenar(l: Conversacion[]): Conversacion[] {
    const grupo = (c: Conversacion) => (c.no_leidos > 0 && !c.silenciada) ? 0 : c.fijada ? 1 : c.ultimo_mensaje_id ? 2 : 3;
    return [...l].sort((a, b) => {
      const ga = grupo(a), gb = grupo(b);
      if (ga !== gb) return ga - gb;
      const ta = a.ultimo_mensaje_en ?? a.creado_en, tb = b.ultimo_mensaje_en ?? b.creado_en;
      return (tb ?? '').localeCompare(ta ?? '');
    });
  }
}

export function vistaPrevia(m: Mensaje): string {
  if (m.eliminado) return 'Mensaje eliminado';
  if (m.texto) return m.texto.length > 120 ? m.texto.slice(0, 119) + '…' : m.texto;
  if (m.adjuntos?.length > 1) return `📎 ${m.adjuntos.length} archivos`;
  const a = m.adjuntos?.[0];
  if (!a) return '';
  return a.clase === 'IMAGEN' ? '📷 Foto' : a.clase === 'VIDEO' ? '🎬 Video' : a.clase === 'ESCANEO' ? '📄 Documento escaneado'
    : a.clase === 'AUDIO' ? '🎤 Audio' : `📎 ${a.nombre}`;
}
