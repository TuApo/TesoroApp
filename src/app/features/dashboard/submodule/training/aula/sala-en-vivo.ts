import { signal } from '@angular/core';
import {
  ConnectionState, LocalTrack, Participant, RemoteParticipant, RemoteTrack, Room, RoomEvent, Track,
  TrackPublication, VideoPresets, createLocalScreenTracks,
} from 'livekit-client';
import type { Entrada } from '../service/aulas.service';

/** Una persona en el escenario. */
export interface Mosaico {
  identidad: string;
  nombre: string;
  rol: string;
  local: boolean;
  camara: Track | null;
  micActivo: boolean;
  camActiva: boolean;
  hablando: boolean;
  /** Epoch ms en que levantó la mano; null = no la tiene levantada. */
  mano: number | null;
}

/** Una pantalla compartida. Una persona puede compartir hasta dos a la vez. */
export interface Pantalla {
  clave: string;
  identidad: string;
  nombre: string;
  track: Track;
  titulo: string;
  local: boolean;
}

export interface MensajeChat { id: string; de: string; nombre: string; texto: string; hora: number; propio: boolean; }
export interface Reaccion { id: string; emoji: string; nombre: string; }

type Escucha = (datos: any, de: string | null) => void;

const CODIFICADOR = new TextEncoder();
const DECODIFICADOR = new TextDecoder();
const MAX_PANTALLAS = 2;

/**
 * Una sala de LiveKit vista desde el navegador, con todo lo que el aula necesita encima.
 *
 * <p>Una instancia por sala: la principal, o la de un equipo cuando se abren. Expone señales
 * (quién está, qué pantallas hay, el chat, el estado del aula) y un canal de mensajes por tópico
 * que usan el chat, las manos, las reacciones, las encuestas y el código compartido (Yjs).
 *
 * <p>Los mensajes pequeños van por `publishData` (fiables o con pérdida, ≤ 14 KiB); lo grande
 * —la sincronización inicial de un documento Yjs— va por `sendText`, que LiveKit trocea solo.
 * Quien entra tarde no recibe lo anterior: por eso el estado del aula vive en la metadata de la
 * sala y los documentos se guardan en el servidor.
 */
export class SalaEnVivo {
  readonly estado = signal<'desconectado' | 'conectando' | 'conectado' | 'reconectando'>('desconectado');
  readonly mosaicos = signal<Mosaico[]>([]);
  readonly pantallas = signal<Pantalla[]>([]);
  readonly chat = signal<MensajeChat[]>([]);
  readonly reacciones = signal<Reaccion[]>([]);
  readonly metadata = signal<Record<string, any>>({});
  readonly miRol = signal<string>('ESPECTADOR');
  readonly puedoPublicar = signal(false);
  readonly micActivo = signal(false);
  readonly camActiva = signal(false);
  readonly misPantallas = signal(0);
  readonly manoLevantada = signal(false);
  readonly audioBloqueado = signal(false);
  readonly error = signal<string | null>(null);
  readonly chatSinLeer = signal(0);

  room: Room | null = null;
  identidad = '';
  nombre = '';
  sala = '';
  private escuchas = new Map<string, Set<Escucha>>();
  private textos = new Map<string, Set<Escucha>>();
  private audios = new Map<string, HTMLMediaElement[]>();
  private misPantallasTracks: LocalTrack[] = [];

  constructor(private contenedorAudio: HTMLElement) {}

  async conectar(e: Entrada, opciones: { mic: boolean; cam: boolean; micId?: string | null; camId?: string | null }): Promise<void> {
    this.identidad = e.identidad;
    this.nombre = e.nombre;
    this.sala = e.sala;
    this.miRol.set(e.rol);
    this.estado.set('conectando');
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360] },
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.room = room;
    this.escucharSala(room);
    try {
      await room.connect(e.url, e.token, { autoSubscribe: true });
    } catch (err) {
      this.estado.set('desconectado');
      this.error.set('No se pudo conectar al servidor de video. Si estás fuera de la oficina, puede que la red no deje pasar el video.');
      throw err;
    }
    this.estado.set('conectado');
    this.leerMetadata(room.metadata);
    this.puedoPublicar.set(!!room.localParticipant.permissions?.canPublish);
    if (this.puedoPublicar()) {
      if (opciones.mic) await this.activarMic(true, opciones.micId);
      if (opciones.cam) await this.activarCam(true, opciones.camId);
    }
    this.refrescar();
  }

  async desconectar(): Promise<void> {
    for (const t of this.misPantallasTracks) t.stop();
    this.misPantallasTracks = [];
    await this.room?.disconnect();
    this.audios.forEach(l => l.forEach(el => el.remove()));
    this.audios.clear();
    this.room = null;
    this.estado.set('desconectado');
  }

  // ── Medios propios ─────────────────────────────────────────────────────────

  async activarMic(on: boolean, dispositivo?: string | null): Promise<void> {
    if (!this.room) return;
    try {
      await this.room.localParticipant.setMicrophoneEnabled(on, dispositivo ? { deviceId: dispositivo } : undefined);
      this.micActivo.set(on);
    } catch {
      this.error.set('No se pudo usar el micrófono (¿permiso del navegador?)');
    }
    this.refrescar();
  }

  async activarCam(on: boolean, dispositivo?: string | null): Promise<void> {
    if (!this.room) return;
    try {
      await this.room.localParticipant.setCameraEnabled(on, dispositivo ? { deviceId: dispositivo } : undefined);
      this.camActiva.set(on);
    } catch {
      this.error.set('No se pudo usar la cámara (¿permiso del navegador?)');
    }
    this.refrescar();
  }

  /**
   * Comparte una pantalla más. La primera va por el camino normal (con su audio, si el
   * navegador lo ofrece); la segunda se publica aparte con otro nombre: LiveKit admite dos
   * pistas de la misma fuente y el receptor las distingue por nombre.
   */
  async compartirPantalla(): Promise<void> {
    if (!this.room || this.misPantallas() >= MAX_PANTALLAS) return;
    try {
      const n = this.misPantallas() + 1;
      const tracks = await createLocalScreenTracks({ audio: n === 1, resolution: VideoPresets.h1080.resolution, contentHint: 'detail' } as any);
      for (const t of tracks) {
        const esVideo = t.kind === Track.Kind.Video;
        await this.room.localParticipant.publishTrack(t, {
          name: esVideo ? `pantalla-${n}` : `pantalla-${n}-audio`,
          source: esVideo ? Track.Source.ScreenShare : Track.Source.ScreenShareAudio,
          simulcast: false,
        });
        this.misPantallasTracks.push(t);
        // Si la persona corta desde el botón del navegador, se despublica sola.
        t.mediaStreamTrack.addEventListener('ended', () => this.dejarDeCompartir(t));
      }
      this.misPantallas.set(this.misPantallasTracks.filter(t => t.kind === Track.Kind.Video).length);
    } catch (err: any) {
      if (err?.name !== 'NotAllowedError') this.error.set('No se pudo compartir la pantalla');
    }
    this.refrescar();
  }

  async dejarDeCompartir(track?: LocalTrack): Promise<void> {
    if (!this.room) return;
    const quitar = track ? [track, ...this.misPantallasTracks.filter(t => t !== track && this.pareja(t, track))] : [...this.misPantallasTracks];
    for (const t of quitar) {
      try { await this.room.localParticipant.unpublishTrack(t, true); } catch { /* ya no estaba */ }
      t.stop();
    }
    this.misPantallasTracks = this.misPantallasTracks.filter(t => !quitar.includes(t));
    this.misPantallas.set(this.misPantallasTracks.filter(t => t.kind === Track.Kind.Video).length);
    this.refrescar();
  }

  /** La pista de audio que acompaña a una pantalla (misma captura). */
  private pareja(a: LocalTrack, b: LocalTrack): boolean {
    const n = (x: LocalTrack) => (this.room?.localParticipant.getTrackPublications()
      .find(p => p.track === x)?.trackName ?? '').replace('-audio', '');
    return n(a) !== '' && n(a) === n(b);
  }

  // ── Manos, reacciones, chat ────────────────────────────────────────────────

  async levantarMano(on: boolean): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setAttributes({ mano: on ? String(Date.now()) : '' });
    this.manoLevantada.set(on);
    this.refrescar();
  }

  reaccionar(emoji: string): void {
    this.enviar('reaccion', { emoji }, { confiable: false });
    this.mostrarReaccion(emoji, 'Tú');
  }

  enviarChat(texto: string): void {
    const t = texto.trim();
    if (!t) return;
    const m: MensajeChat = { id: crypto.randomUUID(), de: this.identidad, nombre: this.nombre, texto: t.slice(0, 2000), hora: Date.now(), propio: true };
    this.enviar('chat', { id: m.id, texto: m.texto });
    this.chat.update(l => [...l.slice(-199), m]);
  }

  // ── Mensajes por tópico ────────────────────────────────────────────────────

  async enviar(topico: string, datos: unknown, o: { confiable?: boolean; para?: string[] } = {}): Promise<void> {
    if (!this.room || this.room.state !== ConnectionState.Connected) return;
    try {
      await this.room.localParticipant.publishData(CODIFICADOR.encode(JSON.stringify(datos)), {
        reliable: o.confiable !== false, topic: topico, destinationIdentities: o.para,
      });
    } catch { /* sin conexión: se pierde, como en cualquier llamada */ }
  }

  /** Para lo grande (estado de un documento Yjs): LiveKit lo trocea. */
  async enviarTexto(topico: string, texto: string, para?: string[]): Promise<void> {
    if (!this.room || this.room.state !== ConnectionState.Connected) return;
    try {
      await this.room.localParticipant.sendText(texto, { topic: topico, destinationIdentities: para });
    } catch { /* se reintenta en la siguiente sincronización */ }
  }

  on(topico: string, cb: Escucha): () => void {
    const set = this.escuchas.get(topico) ?? new Set<Escucha>();
    set.add(cb);
    this.escuchas.set(topico, set);
    return () => set.delete(cb);
  }

  onTexto(topico: string, cb: Escucha): () => void {
    let set = this.textos.get(topico);
    if (!set) {
      set = new Set<Escucha>();
      this.textos.set(topico, set);
      const s = set;
      this.room?.registerTextStreamHandler(topico, async (reader, info) => {
        const texto = await reader.readAll();
        s.forEach(f => f(texto, info.identity));
      });
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
      if (!set!.size) {
        this.textos.delete(topico);
        try { this.room?.unregisterTextStreamHandler(topico); } catch { /* sala cerrada */ }
      }
    };
  }

  /** Identidades conectadas ahora (sin la propia), para decidir quién responde una sincronización. */
  identidades(): string[] {
    return this.room ? [...this.room.remoteParticipants.values()].map(p => p.identity) : [];
  }

  async activarAudio(): Promise<void> {
    await this.room?.startAudio();
    this.audioBloqueado.set(false);
  }

  // ── Eventos ────────────────────────────────────────────────────────────────

  private escucharSala(room: Room): void {
    const refrescar = () => this.refrescar();
    room
      .on(RoomEvent.ParticipantConnected, refrescar)
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => { this.soltarAudios(p.identity); refrescar(); })
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.style.display = 'none';
          this.contenedorAudio.appendChild(el);
          this.audios.set(p.identity + track.sid, [el]);
        }
        refrescar();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) => {
        track.detach().forEach(el => el.remove());
        this.audios.delete(p.identity + track.sid);
        refrescar();
      })
      .on(RoomEvent.TrackMuted, refrescar)
      .on(RoomEvent.TrackUnmuted, refrescar)
      .on(RoomEvent.LocalTrackPublished, refrescar)
      .on(RoomEvent.LocalTrackUnpublished, refrescar)
      .on(RoomEvent.ActiveSpeakersChanged, refrescar)
      .on(RoomEvent.ParticipantAttributesChanged, refrescar)
      .on(RoomEvent.ParticipantMetadataChanged, refrescar)
      .on(RoomEvent.RoomMetadataChanged, (m: string) => this.leerMetadata(m))
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, p: Participant) => {
        if (p.identity !== this.identidad) return;
        const puede = !!room.localParticipant.permissions?.canPublish;
        this.puedoPublicar.set(puede);
        try { this.miRol.set(JSON.parse(room.localParticipant.metadata || '{}').rol ?? this.miRol()); } catch { /* sin metadata */ }
        if (!puede) { this.micActivo.set(false); this.camActiva.set(false); this.misPantallas.set(0); this.misPantallasTracks = []; }
        refrescar();
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => this.audioBloqueado.set(!room.canPlaybackAudio))
      .on(RoomEvent.Reconnecting, () => this.estado.set('reconectando'))
      .on(RoomEvent.Reconnected, () => this.estado.set('conectado'))
      .on(RoomEvent.Disconnected, () => this.estado.set('desconectado'))
      .on(RoomEvent.DataReceived, (payload, p, _kind, topico) => {
        if (!topico) return;
        let datos: any;
        try { datos = JSON.parse(DECODIFICADOR.decode(payload)); } catch { return; }
        const de = p?.identity ?? null;
        if (topico === 'chat' && de) {
          this.chat.update(l => [...l.slice(-199), { id: datos.id ?? crypto.randomUUID(), de, nombre: p?.name || 'Alguien',
            texto: String(datos.texto ?? '').slice(0, 2000), hora: Date.now(), propio: false }]);
          this.chatSinLeer.update(n => n + 1);
        } else if (topico === 'reaccion') {
          this.mostrarReaccion(String(datos.emoji ?? '👍').slice(0, 4), p?.name || 'Alguien');
        } else if (topico === 'aula.control' && datos.accion === 'bajar-mano' && datos.identidad === this.identidad) {
          this.levantarMano(false);
        }
        this.escuchas.get(topico)?.forEach(f => f(datos, de));
      });
  }

  private leerMetadata(m: string | undefined): void {
    try { this.metadata.set(m ? JSON.parse(m) : {}); } catch { this.metadata.set({}); }
  }

  private mostrarReaccion(emoji: string, nombre: string): void {
    const r = { id: crypto.randomUUID(), emoji, nombre };
    this.reacciones.update(l => [...l.slice(-20), r]);
    setTimeout(() => this.reacciones.update(l => l.filter(x => x.id !== r.id)), 3500);
  }

  private soltarAudios(identidad: string): void {
    for (const [k, els] of this.audios) {
      if (k.startsWith(identidad)) { els.forEach(e => e.remove()); this.audios.delete(k); }
    }
  }

  /** Recalcula mosaicos y pantallas desde el estado de LiveKit. */
  refrescar(): void {
    const room = this.room;
    if (!room) { this.mosaicos.set([]); this.pantallas.set([]); return; }
    const todos: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    const mosaicos: Mosaico[] = [];
    const pantallas: Pantalla[] = [];
    for (const p of todos) {
      const local = p === room.localParticipant;
      let rol = 'PARTICIPANTE';
      try { rol = JSON.parse(p.metadata || '{}').rol ?? rol; } catch { /* sin metadata */ }
      const cam = p.getTrackPublication(Track.Source.Camera);
      const mic = p.getTrackPublication(Track.Source.Microphone);
      const mano = Number(p.attributes?.['mano'] || 0) || null;
      mosaicos.push({
        identidad: p.identity, nombre: p.name || (local ? this.nombre : 'Participante'), rol, local,
        camara: cam && !cam.isMuted && cam.track ? cam.track : null,
        micActivo: !!mic && !mic.isMuted, camActiva: !!cam && !cam.isMuted, hablando: p.isSpeaking, mano,
      });
      p.getTrackPublications().forEach((pub: TrackPublication) => {
        if (pub.source !== Track.Source.ScreenShare || !pub.track) return;
        pantallas.push({ clave: `${p.identity}/${pub.trackSid}`, identidad: p.identity, nombre: p.name || 'Participante',
          track: pub.track, titulo: pub.trackName || 'Pantalla', local });
      });
    }
    // Primero quien dirige, luego quien habla, luego por nombre: el escenario no salta sin razón.
    const peso = (m: Mosaico) => (m.rol === 'ANFITRION' ? 0 : m.rol === 'COPRESENTADOR' ? 1 : m.rol === 'ESPECTADOR' ? 3 : 2);
    mosaicos.sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre));
    this.mosaicos.set(mosaicos);
    this.pantallas.set(pantallas);
  }
}
