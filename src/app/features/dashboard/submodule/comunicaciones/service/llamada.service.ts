import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ComunicacionesApiService } from './comunicaciones-api.service';
import { ChatStoreService } from './chat-store.service';
import { DispositivosService } from './dispositivos.service';
import { GrabadoraPista } from './grabadora-pista';
import { FraseLocal, TranscriptorLlamada } from './transcriptor-llamada';
import { sonarColgar, timbre, tonoLlamando } from './sonidos';
import { idCliente } from '../utiles';
import { tokenActual } from '../../turnos/service/sse.util';
import { LineaVivo, Llamada, Mensaje, MensajeLlamada, Momento, ParticipanteLlamada } from '../modelos';

export interface PeerRemoto {
  usuarioId: string;
  nombre: string;
  sesion: string | null;
  stream: MediaStream;
  estado: 'conectando' | 'conectado' | 'fallo';
  mic: boolean;
  cam: boolean;
  /** Cambia cada vez que llega una pista: obliga a repintar el <video>. */
  version: number;
}

interface Par {
  pc: RTCPeerConnection;
  sesion: string | null;
  iceEntrante: RTCIceCandidateInit[];
  iceSaliente: RTCIceCandidateInit[];
  temporizadorIce: ReturnType<typeof setTimeout> | null;
}

type Fase = 'inactiva' | 'saliente' | 'conectando' | 'en_curso';

/** Un mensaje del chat (lo que llega por el canal) como línea del chat de la llamada. */
function aMensajeLlamada(m: Mensaje): MensajeLlamada {
  return {
    id: m.id, autor_id: m.autor_id, autor_nombre: m.autor_nombre, tipo: m.tipo, texto: m.texto, adjuntos: m.adjuntos ?? [],
    momento_ms: 0, creado_en: m.creado_en, cliente_id: m.cliente_id,
  };
}

/**
 * Llamadas de voz y video en MALLA WebRTC: cada navegador se conecta directo con
 * cada uno de los demás. El servidor solo sabe quién está y releva las ofertas,
 * respuestas y candidatos ICE por el canal SSE.
 *
 * Protocolo (sin choques de ofertas): quien ENTRA a la llamada le hace la oferta
 * a cada uno de los que ya estaban; los que ya estaban solo responden. Cada
 * conexión lleva siempre un transceptor de audio y uno de video, así prender la
 * cámara o compartir pantalla es cambiar la pista (replaceTrack), sin renegociar.
 *
 * Cada pestaña tiene su propia sesión: la misma persona con dos pestañas solo
 * está en la llamada con la que contestó; las demás dejan de sonar.
 */
@Injectable({ providedIn: 'root' })
export class LlamadaService {
  private readonly api = inject(ComunicacionesApiService);
  private readonly store = inject(ChatStoreService);
  private readonly disp = inject(DispositivosService);

  readonly sesion = idCliente();
  readonly actual = signal<Llamada | null>(null);
  readonly fase = signal<Fase>('inactiva');
  readonly entrantes = signal<Llamada[]>([]);
  readonly local = signal<MediaStream | null>(null);
  readonly remotos = signal<PeerRemoto[]>([]);
  readonly mic = signal(true);
  readonly cam = signal(false);
  readonly pantalla = signal(false);
  readonly grabando = signal(false);
  readonly minimizada = signal(false);
  readonly aviso = signal<string | null>(null);
  readonly inicio = signal<number | null>(null);
  readonly enLlamada = computed(() => this.fase() !== 'inactiva');
  /** Tope de personas de la malla (lo dice el servidor al unirse). */
  readonly maxParticipantes = signal(8);
  /** El chat de la llamada: queda en la conversación y entra al acta. */
  readonly chat = signal<MensajeLlamada[]>([]);
  readonly chatSinLeer = signal(0);
  /** El panel tiene el chat a la vista (lo que llega no cuenta como sin leer). */
  readonly chatVisible = signal(false);
  /** El último mensaje que llegó con el chat cerrado, para asomarlo unos segundos. */
  readonly vistaPrevia = signal<MensajeLlamada | null>(null);
  private temporizadorVista: ReturnType<typeof setTimeout> | null = null;
  /** Lo transcrito en vivo de todos (cada quien su micrófono), en orden de tiempo. */
  readonly lineasVivo = signal<LineaVivo[]>([]);
  /** Los momentos importantes (clips) guardados por alguien o detectados por la IA. */
  readonly momentos = signal<Momento[]>([]);
  /** El último momento que guardé, para ofrecer ponerle nombre. */
  readonly momentoReciente = signal<Momento | null>(null);
  /** El servidor puede transcribir en vivo (hay llave y la llamada se transcribe). */
  readonly vivoDisponible = signal(false);
  private transcriptor: TranscriptorLlamada | null = null;
  readonly parcialVivo = computed(() => this.transcriptorSig()?.parcial() ?? '');
  readonly estadoVivo = computed(() => this.transcriptorSig()?.estado() ?? 'apagado');
  readonly detalleVivo = computed(() => this.transcriptorSig()?.detalle() ?? null);
  private readonly transcriptorSig = signal<TranscriptorLlamada | null>(null);
  private grabadoraPantalla: GrabadoraPista | null = null;

  private readonly pares = new Map<string, Par>();
  private ice: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];
  private pararTimbre: (() => void) | null = null;
  private pararTono: (() => void) | null = null;
  private grabadora: GrabadoraPista | null = null;
  private pistaCamara: MediaStreamTrack | null = null;
  private pistaPantalla: MediaStreamTrack | null = null;

  constructor() {
    this.store.eventos$.subscribe(({ nombre, datos }) => {
      if (nombre === 'llamada') this.alLlamada(datos?.evento, datos?.llamada as Llamada);
      else if (nombre === 'rtc') void this.alSenal(datos);
      else if (nombre === 'llamada-mensaje') this.alMensajeDeLlamada(datos as Mensaje);
      else if (nombre === 'llamada-linea') this.alLineas(datos?.llamada_id, (datos?.lineas ?? []) as LineaVivo[]);
      else if (nombre === 'llamada-momento') this.alMomento(datos);
    });
    if (typeof window !== 'undefined') {
      // Cerrar la pestaña en plena llamada: se avisa con keepalive (sendBeacon no lleva Authorization).
      window.addEventListener('pagehide', () => this.salirAlCerrar());
    }
  }

  // ─── Acciones de la persona ─────────────────────────────────────────────

  async llamar(conversacionId: string, tipo: 'AUDIO' | 'VIDEO', transcribir = true): Promise<void> {
    if (this.enLlamada()) { this.aviso.set('Ya estás en una llamada. Cuelga primero.'); return; }
    this.aviso.set(null);
    if (!(await this.obtenerMedios(tipo === 'VIDEO'))) return;
    try {
      const [l, cfg] = await Promise.all([
        firstValueFrom(this.api.iniciarLlamada(conversacionId, tipo, transcribir, this.sesion)),
        firstValueFrom(this.api.rtcConfig()).catch(() => null),
      ]);
      if (cfg?.ice_servers?.length) this.ice = cfg.ice_servers;
      const yo = l.participantes.find(p => p.usuario_id === this.store.miId());
      if (yo?.estado === 'CONECTADO' && yo.sesion === this.sesion) {
        this.actual.set(l);
        this.cargarChat(l.id);
        this.fase.set('saliente');
        this.minimizada.set(false);
        this.pararTono = tonoLlamando();
      } else {
        // Ya había una llamada en curso en esta conversación: se entra a ella.
        await this.contestar(l, tipo === 'VIDEO', true);
      }
    } catch (e: any) {
      this.pararMedios();
      this.aviso.set(e?.error?.message ?? 'No se pudo iniciar la llamada');
    }
  }

  async contestar(l: Llamada, conVideo?: boolean, yaTengoMedios = false): Promise<void> {
    this.quitarEntrante(l.id);
    if (this.enLlamada() && this.actual()?.id !== l.id) await this.colgar();
    if (!yaTengoMedios && !(await this.obtenerMedios(conVideo ?? l.tipo === 'VIDEO'))) {
      firstValueFrom(this.api.rechazar(l.id)).catch(() => null);
      return;
    }
    try {
      const r = await firstValueFrom(this.api.unirse(l.id, this.sesion));
      if (r.ice_servers?.length) this.ice = r.ice_servers;
      this.store.desfaseReloj.set(r.servidor_ahora_ms - Date.now());
      if (r.max_participantes) this.maxParticipantes.set(r.max_participantes);
      this.actual.set(r.llamada);
      this.cargarChat(r.llamada.id);
      this.fase.set('conectando');
      this.minimizada.set(false);
      const yo = this.store.miId();
      for (const p of r.llamada.participantes) {
        if (p.usuario_id !== yo && p.estado === 'CONECTADO') await this.ofrecer(p);
      }
    } catch (e: any) {
      this.pararMedios();
      this.fase.set('inactiva');
      this.actual.set(null);
      this.aviso.set(e?.error?.message ?? 'No se pudo entrar a la llamada');
    }
  }

  rechazar(l: Llamada): void {
    this.quitarEntrante(l.id);
    firstValueFrom(this.api.rechazar(l.id)).catch(() => null);
  }

  async colgar(): Promise<void> {
    const l = this.actual();
    if (!l) return;
    for (const [usuarioId, par] of this.pares) this.senal(usuarioId, par.sesion, 'bye', null);
    await this.limpiar();
    sonarColgar();
    await firstValueFrom(this.api.salir(l.id, this.sesion)).catch(() => null);
  }

  async terminarParaTodos(): Promise<void> {
    const l = this.actual();
    if (!l) return;
    await firstValueFrom(this.api.terminar(l.id)).catch(() => null);
    await this.limpiar();
    sonarColgar();
  }

  alternarMic(): void {
    const t = this.local()?.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    this.mic.set(t.enabled);
    this.difundirMedios();
  }

  async alternarCamara(): Promise<void> {
    if (this.cam()) {
      this.pistaCamara?.stop();
      this.local()?.getVideoTracks().forEach(t => { if (t === this.pistaCamara) this.local()!.removeTrack(t); });
      this.pistaCamara = null;
      this.cam.set(false);
      if (!this.pantalla()) await this.ponerVideo(null);
    } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: this.disp.video() })
          .catch(e => {
            // La cámara elegida se desconectó: sigue con la del sistema.
            if (this.disp.camara() && this.disp.esErrorDeDispositivo(e)) return navigator.mediaDevices.getUserMedia({ video: this.disp.video('') });
            throw e;
          });
        this.pistaCamara = s.getVideoTracks()[0];
        this.local()?.addTrack(this.pistaCamara);
        this.cam.set(true);
        if (!this.pantalla()) await this.ponerVideo(this.pistaCamara);
      } catch {
        this.aviso.set('No se pudo usar la cámara (¿permiso denegado o la usa otra aplicación?)');
      }
    }
    this.local.set(this.local() ? new MediaStream(this.local()!.getTracks()) : null);
    this.difundirMedios();
  }

  async alternarPantalla(): Promise<void> {
    if (this.pantalla()) {
      this.soltarGrabadoraPantalla();
      this.pistaPantalla?.stop();
      this.pistaPantalla = null;
      this.pantalla.set(false);
      await this.ponerVideo(this.cam() ? this.pistaCamara : null);
      this.difundirMedios();
      return;
    }
    try {
      const s = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false }) as MediaStream;
      this.pistaPantalla = s.getVideoTracks()[0];
      this.pistaPantalla.onended = () => { if (this.pantalla()) void this.alternarPantalla(); };
      this.pantalla.set(true);
      await this.ponerVideo(this.pistaPantalla);
      this.difundirMedios();
      this.grabarPantalla();
    } catch { /* la persona canceló el selector */ }
  }

  /**
   * Cambia el micrófono en plena llamada: los demás empiezan a oír el nuevo sin
   * renegociar (replaceTrack) y la grabación para el acta sigue en una pista nueva
   * (el servidor ordena las pistas de cada quien por su hora de inicio).
   * {@code guardar} = false cuando se cae el elegido y se sigue con el del sistema
   * sin olvidar la preferencia (al volver a conectarlo se usa de nuevo).
   */
  async cambiarMicrofono(id: string, guardar = true): Promise<void> {
    if (guardar) this.disp.elegirMic(id);
    const local = this.local();
    if (!local || !this.enLlamada()) return;
    const vieja = local.getAudioTracks()[0] ?? null;
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: this.disp.audio(id) });
    } catch (e) {
      if (!id || !this.disp.esErrorDeDispositivo(e)) { this.aviso.set('No se pudo usar ese micrófono.'); return; }
      this.aviso.set('Ese micrófono no está disponible: sigues con el del sistema.');
      try { s = await navigator.mediaDevices.getUserMedia({ audio: this.disp.audio('') }); } catch { return; }
    }
    if (!this.enLlamada()) { s.getTracks().forEach(t => t.stop()); return; }
    const nueva = s.getAudioTracks()[0];
    nueva.enabled = this.mic();
    this.vigilarMic(nueva);
    for (const par of this.pares.values()) {
      const t = par.pc.getTransceivers().find(x => x.receiver.track?.kind === 'audio');
      if (t) await t.sender.replaceTrack(nueva).catch(() => undefined);
    }
    if (vieja) local.removeTrack(vieja);
    local.addTrack(nueva);
    this.local.set(new MediaStream(local.getTracks()));
    void this.disp.refrescar();
    void this.transcriptor?.cambiarPista(nueva);
    const g = this.grabadora;
    if (g) {
      // La grabación sigue con el micrófono nuevo; la vieja sube lo que le falte antes de soltarlo.
      this.grabadora = null;
      this.grabando.set(false);
      this.iniciarGrabacion();
      void g.detener().catch(() => undefined).finally(() => vieja?.stop());
    } else {
      vieja?.stop();
    }
  }

  /** Cambia la cámara (si está prendida, los demás ven la nueva de una vez). */
  async cambiarCamara(id: string): Promise<void> {
    this.disp.elegirCamara(id);
    const vieja = this.pistaCamara;
    if (!this.cam() || !vieja) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: this.disp.video(id) });
      const nueva = s.getVideoTracks()[0];
      if (!this.cam()) { nueva.stop(); return; }
      this.pistaCamara = nueva;
      const local = this.local();
      if (local) {
        local.removeTrack(vieja);
        local.addTrack(nueva);
        this.local.set(new MediaStream(local.getTracks()));
      }
      if (!this.pantalla()) await this.ponerVideo(nueva);
      vieja.stop();
    } catch {
      this.aviso.set('No se pudo usar esa cámara (¿la usa otra aplicación?).');
    }
  }

  /** Llama a más personas (las que se buscaron en el panel), sean o no del chat. */
  async invitar(usuarios: string[]): Promise<boolean> {
    const l = this.actual();
    if (!l || !usuarios.length) return false;
    try {
      const r = await firstValueFrom(this.api.invitarALlamada(l.id, usuarios));
      if (this.actual()?.id === r.id) this.actual.set(r);
      return true;
    } catch (e: any) {
      this.aviso.set(e?.error?.message ?? 'No se pudo llamar a esa persona.');
      return false;
    }
  }

  /** Escribe en el chat de la llamada (sale en el acto; si falla queda marcado para reintentar). */
  escribirChat(texto: string, reintento?: MensajeLlamada): void {
    const l = this.actual();
    const t = texto.trim();
    if (!l || !t) return;
    const cid = reintento?.cliente_id ?? idCliente();
    if (reintento) {
      this.chat.update(xs => xs.map(x => x.cliente_id === cid ? { ...x, _estado: 'enviando' } : x));
    } else {
      this.chat.update(xs => [...xs, {
        id: -Date.now(), autor_id: this.store.miId(), autor_nombre: this.store.yo()?.nombre ?? '', tipo: 'TEXTO', texto: t,
        adjuntos: [], momento_ms: this.ahoraMs(), creado_en: new Date().toISOString(), cliente_id: cid, _estado: 'enviando',
      }]);
    }
    this.api.escribirEnLlamada(l.id, t, cid).subscribe({
      next: m => this.integrarChat(aMensajeLlamada(m)),
      error: e => {
        this.chat.update(xs => xs.map(x => x.cliente_id === cid ? { ...x, _estado: 'error' } : x));
        this.aviso.set(e?.error?.message ?? 'No se pudo enviar el mensaje.');
      },
    });
  }

  marcarChatLeido(): void {
    this.chatSinLeer.set(0);
    this.vistaPrevia.set(null);
  }

  /** La pista de video que ven los demás (cámara, pantalla o nada). */
  pistaVideoPropia(): MediaStreamTrack | null {
    return this.pantalla() ? this.pistaPantalla : this.cam() ? this.pistaCamara : null;
  }

  // ─── Medios ─────────────────────────────────────────────────────────────

  private async obtenerMedios(video: boolean): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.aviso.set('Este navegador no permite llamadas (se necesita HTTPS y un navegador actual).');
      return false;
    }
    try {
      const s = await this.pedirMedios(video);
      this.vigilarMic(s.getAudioTracks()[0]);
      void this.disp.refrescar(); // con el permiso ya dado, los dispositivos traen su nombre
      this.local.set(s);
      this.pistaCamara = s.getVideoTracks()[0] ?? null;
      this.mic.set(true);
      this.cam.set(!!this.pistaCamara);
      return true;
    } catch (e: any) {
      if (video) {
        // Sin cámara (o sin permiso): se sigue solo con audio.
        return this.obtenerMedios(false);
      }
      this.aviso.set(e?.name === 'NotAllowedError'
        ? 'Debes permitir el micrófono en el navegador para llamar.'
        : 'No se encontró un micrófono disponible.');
      return false;
    }
  }

  /** Micrófono (y cámara) elegidos; si alguno ya no está conectado, los del sistema. */
  private async pedirMedios(video: boolean): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: this.disp.audio(), video: video ? this.disp.video() : false });
    } catch (e) {
      if (!this.disp.esErrorDeDispositivo(e) || (!this.disp.mic() && !this.disp.camara())) throw e;
      return navigator.mediaDevices.getUserMedia({ audio: this.disp.audio(''), video: video ? this.disp.video('') : false });
    }
  }

  /** Si se desconecta el micrófono en plena llamada se sigue con el del sistema. */
  private vigilarMic(pista: MediaStreamTrack | undefined): void {
    if (!pista) return;
    pista.addEventListener('ended', () => {
      if (!this.enLlamada() || this.local()?.getAudioTracks()[0] !== pista) return;
      this.aviso.set('Se desconectó el micrófono: sigues con el del sistema.');
      void this.cambiarMicrofono('', false);
    });
  }

  private pararMedios(): void {
    this.local()?.getTracks().forEach(t => t.stop());
    this.pistaCamara?.stop();
    this.pistaPantalla?.stop();
    this.pistaCamara = null;
    this.pistaPantalla = null;
    this.local.set(null);
    this.cam.set(false);
    this.pantalla.set(false);
  }

  private async ponerVideo(pista: MediaStreamTrack | null): Promise<void> {
    for (const par of this.pares.values()) {
      const t = par.pc.getTransceivers().find(x => x.receiver.track?.kind === 'video');
      if (t) await t.sender.replaceTrack(pista).catch(() => undefined);
    }
  }

  // ─── Conexiones ─────────────────────────────────────────────────────────

  private crearPar(usuarioId: string, nombre: string, sesion: string | null): RTCPeerConnection {
    this.cerrarPar(usuarioId, false);
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const stream = new MediaStream();
    const par: Par = { pc, sesion, iceEntrante: [], iceSaliente: [], temporizadorIce: null };
    this.pares.set(usuarioId, par);
    this.remotos.update(l => [...l.filter(r => r.usuarioId !== usuarioId),
      { usuarioId, nombre, sesion, stream, estado: 'conectando', mic: true, cam: false, version: 0 }]);

    pc.ontrack = e => {
      if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
      const refrescar = () => this.parcharRemoto(usuarioId, r => ({
        ...r, version: r.version + 1,
        cam: e.track.kind === 'video' ? !e.track.muted : r.cam,
      }));
      e.track.onunmute = refrescar;
      e.track.onmute = refrescar;
      refrescar();
    };
    pc.onicecandidate = e => {
      if (!e.candidate) return;
      par.iceSaliente.push(e.candidate.toJSON());
      if (!par.temporizadorIce) {
        par.temporizadorIce = setTimeout(() => {
          const lote = par.iceSaliente.splice(0);
          par.temporizadorIce = null;
          if (lote.length) this.senal(usuarioId, par.sesion, 'ice', { candidatos: lote });
        }, 150);
      }
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') {
        this.parcharRemoto(usuarioId, r => ({ ...r, estado: 'conectado' }));
        if (this.fase() !== 'en_curso') {
          this.fase.set('en_curso');
          this.inicio.set(Date.now());
          this.pararTono?.(); this.pararTono = null;
        }
        this.iniciarGrabacion();
      } else if (st === 'failed') {
        this.parcharRemoto(usuarioId, r => ({ ...r, estado: 'fallo' }));
        this.aviso.set(`No se pudo conectar con ${nombre}: la red no deja la conexión directa (hace falta un servidor TURN).`);
      } else if (st === 'disconnected') {
        this.parcharRemoto(usuarioId, r => ({ ...r, estado: 'conectando' }));
      }
    };
    return pc;
  }

  /** Oferta a alguien que ya estaba en la llamada (lo hace siempre quien llega). */
  private async ofrecer(p: ParticipanteLlamada): Promise<void> {
    const pc = this.crearPar(p.usuario_id, p.nombre, p.sesion);
    const audio = this.local()?.getAudioTracks()[0];
    if (audio) pc.addTransceiver(audio, { direction: 'sendrecv', streams: [this.local()!] });
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    const tv = pc.addTransceiver('video', { direction: 'sendrecv' });
    const v = this.pistaVideoPropia();
    if (v) await tv.sender.replaceTrack(v);
    const oferta = await pc.createOffer();
    await pc.setLocalDescription(oferta);
    this.senal(p.usuario_id, p.sesion, 'offer', { sdp: pc.localDescription?.toJSON() });
    this.difundirMedios(p.usuario_id);
  }

  private async alSenal(d: any): Promise<void> {
    const l = this.actual();
    if (!d || !l || d.llamada_id !== l.id) return;
    if (d.para_sesion && d.para_sesion !== this.sesion) return;
    const de: string = d.de;
    try {
      switch (d.tipo) {
        case 'offer': {
          const pc = this.crearPar(de, d.de_nombre ?? 'Participante', d.de_sesion ?? null);
          await pc.setRemoteDescription(d.datos.sdp);
          for (const t of pc.getTransceivers()) {
            const tipo = t.receiver.track?.kind;
            t.direction = 'sendrecv';
            if (tipo === 'audio') await t.sender.replaceTrack(this.local()?.getAudioTracks()[0] ?? null);
            if (tipo === 'video') await t.sender.replaceTrack(this.pistaVideoPropia());
          }
          await this.vaciarIce(de);
          const respuesta = await pc.createAnswer();
          await pc.setLocalDescription(respuesta);
          this.senal(de, d.de_sesion ?? null, 'answer', { sdp: pc.localDescription?.toJSON() });
          this.difundirMedios(de);
          break;
        }
        case 'answer': {
          const par = this.pares.get(de);
          if (par && par.pc.signalingState === 'have-local-offer') {
            await par.pc.setRemoteDescription(d.datos.sdp);
            await this.vaciarIce(de);
          }
          break;
        }
        case 'ice': {
          const par = this.pares.get(de);
          const candidatos: RTCIceCandidateInit[] = d.datos?.candidatos ?? [];
          if (!par) break;
          if (par.pc.remoteDescription) {
            for (const c of candidatos) await par.pc.addIceCandidate(c).catch(() => undefined);
          } else {
            par.iceEntrante.push(...candidatos);
          }
          break;
        }
        case 'medios':
          this.parcharRemoto(de, r => ({ ...r, mic: !!d.datos?.mic, cam: !!d.datos?.cam }));
          break;
        case 'bye':
          this.cerrarPar(de, true);
          break;
      }
    } catch (e) {
      console.warn('[llamada] señal', d?.tipo, e);
    }
  }

  private async vaciarIce(usuarioId: string): Promise<void> {
    const par = this.pares.get(usuarioId);
    if (!par) return;
    for (const c of par.iceEntrante.splice(0)) await par.pc.addIceCandidate(c).catch(() => undefined);
  }

  private cerrarPar(usuarioId: string, quitarRemoto: boolean): void {
    const par = this.pares.get(usuarioId);
    if (par) {
      if (par.temporizadorIce) clearTimeout(par.temporizadorIce);
      try { par.pc.close(); } catch { /* ya cerrada */ }
      this.pares.delete(usuarioId);
    }
    if (quitarRemoto) this.remotos.update(l => l.filter(r => r.usuarioId !== usuarioId));
  }

  private senal(para: string, paraSesion: string | null, tipo: string, datos: unknown): void {
    const l = this.actual();
    if (!l) return;
    firstValueFrom(this.api.senal(l.id, { para, para_sesion: paraSesion, de_sesion: this.sesion, tipo, datos }))
      .catch(() => undefined);
  }

  private difundirMedios(soloA?: string): void {
    const datos = { mic: this.mic(), cam: !!this.pistaVideoPropia() };
    for (const [u, par] of this.pares) if (!soloA || u === soloA) this.senal(u, par.sesion, 'medios', datos);
  }

  private parcharRemoto(usuarioId: string, f: (r: PeerRemoto) => PeerRemoto): void {
    this.remotos.update(l => l.map(r => r.usuarioId === usuarioId ? f(r) : r));
  }

  // ─── Grabación para la transcripción ────────────────────────────────────

  private iniciarGrabacion(): void {
    this.iniciarEnVivo();
    const l = this.actual();
    const pista = this.local()?.getAudioTracks()[0];
    if (!l || !l.transcribir || this.grabadora || !pista || !GrabadoraPista.soportada()) return;
    const g = new GrabadoraPista(this.api, l.id, pista, Date.now() + this.store.desfaseReloj());
    if (g.iniciar()) {
      this.grabadora = g;
      this.grabando.set(true);
    }
  }

  // ─── Chat de la llamada ─────────────────────────────────────────────────

  private cargarChat(llamadaId: string): void {
    this.chat.set([]);
    this.chatSinLeer.set(0);
    this.lineasVivo.set([]);
    this.momentos.set([]);
    this.api.enVivo(llamadaId).subscribe({
      next: v => {
        if (this.actual()?.id !== llamadaId) return;
        this.vivoDisponible.set(v.disponible);
        this.lineasVivo.update(ls => unirLineas(ls, v.lineas));
        this.momentos.update(ms => unirMomentos(ms, v.momentos));
      },
      error: () => undefined,
    });
    this.api.chatDeLlamada(llamadaId).subscribe({
      next: xs => {
        if (this.actual()?.id !== llamadaId) return;
        const pendientes = this.chat().filter(x => x.id < 0);
        this.chat.set([...xs, ...pendientes.filter(p => !xs.some(x => x.cliente_id && x.cliente_id === p.cliente_id))]);
      },
      error: () => undefined,
    });
  }

  private alMensajeDeLlamada(m: Mensaje): void {
    if (!m || m.llamada_id !== this.actual()?.id) return;
    // El momento exacto lo da el servidor al leer el acta; en vivo basta con "ahora".
    const nuevo = this.integrarChat({ ...aMensajeLlamada(m), momento_ms: this.ahoraMs() });
    if (!nuevo || m.autor_id === this.store.miId()) return;
    if (this.chatVisible() && !this.minimizada()) return;
    this.chatSinLeer.update(n => n + 1);
    this.vistaPrevia.set(aMensajeLlamada(m));
    if (this.temporizadorVista) clearTimeout(this.temporizadorVista);
    this.temporizadorVista = setTimeout(() => this.vistaPrevia.set(null), 5000);
  }

  /** Mete o reemplaza un mensaje (el propio llega dos veces: respuesta del POST y canal). true = era nuevo. */
  private integrarChat(m: MensajeLlamada): boolean {
    const xs = this.chat();
    const i = xs.findIndex(x => x.id === m.id || (!!m.cliente_id && x.cliente_id === m.cliente_id));
    if (i >= 0) {
      this.chat.set(xs.map((x, j) => j === i ? { ...m, momento_ms: m.momento_ms || x.momento_ms } : x));
      return false;
    }
    this.chat.set([...xs, m]);
    return true;
  }

  // ─── En vivo: transcripción, momentos y pantalla ───────────────────────

  /** Milisegundos de la conversación de la llamada, con el reloj del servidor (la línea de tiempo de todos). */
  ahoraMs(): number {
    const l = this.actual();
    return l ? Math.max(0, Date.now() + this.store.desfaseReloj() - l.inicio_epoch_ms) : 0;
  }

  private iniciarEnVivo(): void {
    const l = this.actual();
    const pista = this.local()?.getAudioTracks()[0];
    if (!l || !l.transcribir || this.transcriptor || !pista) return;
    const t = new TranscriptorLlamada(this.api, l.id, () => this.ahoraMs(), f => this.alFrasePropia(l.id, f));
    this.transcriptor = t;
    this.transcriptorSig.set(t);
    void t.iniciar(pista).catch(() => undefined);
  }

  private alFrasePropia(llamadaId: string, f: FraseLocal): void {
    if (this.actual()?.id !== llamadaId) return;
    const yo = this.store.miId();
    const nombre = this.actual()?.participantes.find(p => p.usuario_id === yo)?.nombre ?? this.store.yo()?.nombre ?? '';
    this.lineasVivo.update(ls => unirLineas(ls, [{ id: null, llamada_id: llamadaId, usuario_id: yo, nombre, ...f }]));
  }

  private alLineas(llamadaId: string, lineas: LineaVivo[]): void {
    if (!lineas.length || llamadaId !== this.actual()?.id) return;
    this.lineasVivo.update(ls => unirLineas(ls, lineas));
  }

  private alMomento(d: any): void {
    if (!d || d.llamada_id !== this.actual()?.id) return;
    if (d.borrado) { this.momentos.update(ms => ms.filter(m => m.id !== d.momento_id)); return; }
    const m = d.momento as Momento;
    if (m) this.momentos.update(ms => unirMomentos(ms, [m]));
  }

  /**
   * Guarda "este momento" (o una frase que ya pasó, con {@code momentoMs}). Si se está viendo algo
   * (pantalla compartida o cámara de alguien) se sube también la captura de lo que se mostraba.
   */
  async guardarMomento(titulo?: string | null, momentoMs?: number | null): Promise<Momento | null> {
    const l = this.actual();
    if (!l) return null;
    const captura = momentoMs == null ? this.capturarVista() : Promise.resolve(null);
    try {
      const m = await firstValueFrom(this.api.guardarMomento(l.id, { titulo: titulo ?? null, momento_ms: momentoMs ?? null }));
      this.momentos.update(ms => unirMomentos(ms, [m]));
      this.momentoReciente.set(m);
      const jpeg = await captura;
      if (jpeg) {
        firstValueFrom(this.api.imagenMomento(m.id, jpeg))
          .then(x => this.momentos.update(ms => unirMomentos(ms, [x])))
          .catch(() => undefined);
      }
      return m;
    } catch (e: any) {
      this.aviso.set(e?.error?.message ?? 'No se pudo guardar el momento.');
      return null;
    }
  }

  nombrarMomento(id: string, titulo: string): void {
    firstValueFrom(this.api.editarMomento(id, { titulo }))
      .then(m => { this.momentos.update(ms => unirMomentos(ms, [m])); if (this.momentoReciente()?.id === id) this.momentoReciente.set(null); })
      .catch(() => undefined);
  }

  quitarMomento(id: string): void {
    firstValueFrom(this.api.quitarMomento(id))
      .then(() => this.momentos.update(ms => ms.filter(m => m.id !== id)))
      .catch((e: any) => this.aviso.set(e?.error?.message ?? 'No se pudo quitar el momento.'));
  }

  /**
   * Una foto de lo que se está mostrando: la pantalla que yo comparto, o la de alguien, o
   * la cámara de quien tenga video. JPEG de hasta 1600 px. Null si no hay nada que mostrar.
   */
  private async capturarVista(): Promise<Blob | null> {
    const remotoConVideo = this.remotos().find(r => r.cam && r.stream.getVideoTracks().some(t => t.readyState === 'live' && !t.muted));
    const pista = this.pistaPantalla ?? remotoConVideo?.stream.getVideoTracks().find(t => t.readyState === 'live') ?? null;
    if (!pista || typeof document === 'undefined') return null;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([pista]);
    try {
      await video.play();
      await new Promise(r => setTimeout(r, video.videoWidth ? 0 : 400));
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return null;
      const escala = Math.min(1, 1600 / w);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * escala);
      canvas.height = Math.round(h * escala);
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob | null>(r => canvas.toBlob(b => r(b), 'image/jpeg', 0.82));
    } catch {
      return null;
    } finally {
      video.pause();
      video.srcObject = null;
    }
  }

  /** Mientras comparto pantalla (y la llamada se transcribe) se graba, para los clips de lo mostrado. */
  private grabarPantalla(): void {
    const l = this.actual();
    if (!l?.transcribir || !this.pistaPantalla || this.grabadoraPantalla || !GrabadoraPista.soportada()) return;
    const g = new GrabadoraPista(this.api, l.id, this.pistaPantalla, Date.now() + this.store.desfaseReloj(), 'PANTALLA');
    if (g.iniciar()) this.grabadoraPantalla = g;
  }

  private soltarGrabadoraPantalla(): void {
    const g = this.grabadoraPantalla;
    this.grabadoraPantalla = null;
    if (g) void g.detener().catch(() => undefined);
  }

  // ─── Eventos del servidor ───────────────────────────────────────────────

  private alLlamada(evento: string, l: Llamada | undefined): void {
    if (!l) return;
    const yo = this.store.miId();
    const mio = l.participantes.find(p => p.usuario_id === yo);
    const activa = l.estado === 'SONANDO' || l.estado === 'EN_CURSO';

    if (evento === 'entrante' && activa && this.actual()?.id !== l.id && mio?.estado === 'INVITADO') {
      if (!this.entrantes().some(x => x.id === l.id)) {
        this.entrantes.update(xs => [...xs, l]);
        this.pararTimbre ??= timbre();
        this.notificarNavegador(l);
      }
      return;
    }
    // Deja de sonar si ya terminó, si contesté en otra pestaña o si rechacé.
    if (this.entrantes().some(x => x.id === l.id) && (!activa || mio?.estado !== 'INVITADO')) this.quitarEntrante(l.id);

    if (this.actual()?.id !== l.id) return;
    if (!activa) {
      void this.limpiar();
      sonarColgar();
      return;
    }
    // Contesté esta misma llamada desde otra pestaña: esta se retira sin colgar.
    if (mio?.estado === 'CONECTADO' && mio.sesion && mio.sesion !== this.sesion) {
      void this.limpiar();
      return;
    }
    this.actual.set(l);
    if (this.fase() === 'saliente' && l.estado === 'EN_CURSO') {
      this.fase.set('conectando');
      this.pararTono?.(); this.pararTono = null;
    }
    for (const p of l.participantes) {
      if (p.usuario_id !== yo && p.estado !== 'CONECTADO' && (this.pares.has(p.usuario_id) || this.remotos().some(r => r.usuarioId === p.usuario_id))) {
        this.cerrarPar(p.usuario_id, true);
      }
    }
    // Red de seguridad: si dos personas entraron a la vez, ninguna vio a la otra al
    // unirse. El de id menor ofrece a quien siga sin conexión pasados unos segundos.
    setTimeout(() => {
      const ahora = this.actual();
      if (!ahora || ahora.id !== l.id) return;
      for (const p of ahora.participantes) {
        if (p.usuario_id !== yo && p.estado === 'CONECTADO' && !this.pares.has(p.usuario_id) && yo < p.usuario_id) {
          void this.ofrecer(p);
        }
      }
    }, 3000);
  }

  private quitarEntrante(id: string): void {
    this.entrantes.update(xs => xs.filter(x => x.id !== id));
    if (!this.entrantes().length) { this.pararTimbre?.(); this.pararTimbre = null; }
  }

  private notificarNavegador(l: Llamada): void {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden' || !('Notification' in window)
        || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(`${l.tipo === 'VIDEO' ? 'Videollamada' : 'Llamada'} de ${l.iniciada_por_nombre}`, {
        body: l.grupo ? `En ${l.conversacion_nombre}` : 'Toca para contestar', tag: `cm-llamada-${l.id}`, requireInteraction: true,
      } as NotificationOptions);
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* sin notificaciones */ }
  }

  private async limpiar(): Promise<void> {
    this.pararTono?.(); this.pararTono = null;
    const g = this.grabadora;
    this.grabadora = null;
    this.grabando.set(false);
    // Lo transcrito en vivo que quedó en cola se sigue enviando un rato (idempotente por cliente_id).
    const t = this.transcriptor;
    this.transcriptor = null;
    this.transcriptorSig.set(null);
    if (t) void t.detener().catch(() => undefined);
    this.soltarGrabadoraPantalla();
    for (const u of [...this.pares.keys()]) this.cerrarPar(u, true);
    this.remotos.set([]);
    this.fase.set('inactiva');
    this.actual.set(null);
    this.inicio.set(null);
    this.chat.set([]);
    this.chatSinLeer.set(0);
    this.vistaPrevia.set(null);
    this.lineasVivo.set([]);
    this.momentos.set([]);
    this.momentoReciente.set(null);
    this.vivoDisponible.set(false);
    // La grabadora sube lo que le falte ANTES de soltar el micrófono.
    if (g) await g.detener().catch(() => undefined);
    this.pararMedios();
  }

  private salirAlCerrar(): void {
    const l = this.actual();
    const token = tokenActual();
    if (!l || !token) return;
    try {
      void fetch(`${this.api.base}/llamadas/${l.id}/salir`, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: token },
        body: JSON.stringify({ sesion: this.sesion }),
      });
    } catch { /* la pestaña ya se va */ }
  }
}

/** Junta lo transcrito en vivo sin duplicar (la frase propia llega antes por el micrófono y luego por el canal). */
export function unirLineas(actuales: LineaVivo[], nuevas: LineaVivo[]): LineaVivo[] {
  const clave = (l: LineaVivo) => `${l.usuario_id}|${l.cliente_id}`;
  const mapa = new Map(actuales.map(l => [clave(l), l]));
  for (const l of nuevas) {
    const ya = mapa.get(clave(l));
    mapa.set(clave(l), ya && ya.id && !l.id ? ya : l);
  }
  return [...mapa.values()].sort((a, b) => a.inicio_ms - b.inicio_ms || (a.id ?? Infinity) - (b.id ?? Infinity));
}

export function unirMomentos(actuales: Momento[], nuevos: Momento[]): Momento[] {
  const mapa = new Map(actuales.map(m => [m.id, m]));
  for (const m of nuevos) mapa.set(m.id, m);
  return [...mapa.values()].sort((a, b) => a.momento_ms - b.momento_ms);
}
