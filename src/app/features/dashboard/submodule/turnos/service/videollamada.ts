import { signal } from '@angular/core';
import { SenalVideo } from './turnos.service';

export type EstadoVideollamada = 'lista' | 'preparando' | 'llamando' | 'conectada' | 'terminada' | 'error';

/**
 * Una videollamada WebRTC entre dos extremos (el asesor y la persona), con la
 * señalización por fuera: quien la crea le pasa cómo enviar una señal y le
 * entrega las que llegan. Sin librerías: es una llamada 1 a 1 con cámara y
 * micrófono, que es lo que necesita una entrevista.
 *
 * <p>El asesor {@link #llamar}: pide cámara, arma la oferta y la envía. La
 * persona {@link #contestar}: pide cámara, pone la oferta y devuelve la
 * respuesta. Los candidatos ICE van y vienen por el mismo canal. Sin TURN, dos
 * extremos detrás de NAT simétricos no se ven: el estado queda en 'error'.
 */
export class Videollamada {
  readonly estado = signal<EstadoVideollamada>('lista');
  readonly detalle = signal<string | null>(null);
  readonly local = signal<MediaStream | null>(null);
  readonly remoto = signal<MediaStream | null>(null);
  readonly microSilenciado = signal(false);
  readonly camaraApagada = signal(false);

  private pc: RTCPeerConnection | null = null;
  private pendientes: RTCIceCandidateInit[] = [];
  private remotaPuesta = false;

  constructor(private readonly ice: RTCIceServer[], private readonly enviar: (s: SenalVideo) => void) {}

  /** El asesor inicia: cámara, oferta y a esperar la respuesta. */
  async llamar(): Promise<void> {
    try {
      this.estado.set('preparando');
      await this.prepararMedios();
      const pc = this.conexion();
      const oferta = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(oferta);
      this.enviar({ tipo: 'offer', datos: { type: oferta.type, sdp: oferta.sdp } });
      this.estado.set('llamando');
      this.detalle.set('Esperando a que la persona se conecte desde su celular…');
    } catch (e) {
      this.fallar(e);
    }
  }

  /** La persona contesta la oferta que le llegó. */
  async contestar(oferta: RTCSessionDescriptionInit): Promise<void> {
    try {
      this.estado.set('preparando');
      await this.prepararMedios();
      const pc = this.conexion();
      await pc.setRemoteDescription(oferta);
      this.remotaPuesta = true;
      await this.vaciarPendientes();
      const respuesta = await pc.createAnswer();
      await pc.setLocalDescription(respuesta);
      this.enviar({ tipo: 'answer', datos: { type: respuesta.type, sdp: respuesta.sdp } });
      this.estado.set('llamando');
      this.detalle.set('Conectando…');
    } catch (e) {
      this.fallar(e);
    }
  }

  /** Una señal del otro extremo. */
  async recibir(s: SenalVideo): Promise<void> {
    try {
      if (s.tipo === 'answer' && this.pc) {
        await this.pc.setRemoteDescription(s.datos as RTCSessionDescriptionInit);
        this.remotaPuesta = true;
        await this.vaciarPendientes();
      } else if (s.tipo === 'ice') {
        const c = s.datos as RTCIceCandidateInit | null;
        if (!c) return;
        if (this.pc && this.remotaPuesta) await this.pc.addIceCandidate(c);
        else this.pendientes.push(c);
      } else if (s.tipo === 'colgar') {
        this.cerrar('La otra persona colgó');
      }
    } catch (e) {
      this.fallar(e);
    }
  }

  colgar(): void {
    this.enviar({ tipo: 'colgar' });
    this.cerrar('Llamada terminada');
  }

  alternarMicro(): void {
    const l = this.local();
    if (!l) return;
    const on = this.microSilenciado();
    l.getAudioTracks().forEach(t => (t.enabled = on));
    this.microSilenciado.set(!on);
  }

  alternarCamara(): void {
    const l = this.local();
    if (!l) return;
    const on = this.camaraApagada();
    l.getVideoTracks().forEach(t => (t.enabled = on));
    this.camaraApagada.set(!on);
  }

  private async prepararMedios(): Promise<void> {
    if (this.local()) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite cámara ni micrófono');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: true });
    } catch {
      // Sin cámara se sigue solo con audio: una entrevista por voz es mejor que nada.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.camaraApagada.set(true);
    }
    this.local.set(stream);
  }

  private conexion(): RTCPeerConnection {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    this.local()?.getTracks().forEach(t => pc.addTrack(t, this.local()!));
    const remoto = new MediaStream();
    this.remoto.set(remoto);
    pc.ontrack = ev => { ev.streams[0]?.getTracks().forEach(t => remoto.addTrack(t)); this.remoto.set(remoto); };
    pc.onicecandidate = ev => { if (ev.candidate) this.enviar({ tipo: 'ice', datos: ev.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') { this.estado.set('conectada'); this.detalle.set(null); }
      else if (st === 'failed') this.fallar(new Error('No se pudo establecer la conexión (redes sin TURN). Intente por datos móviles o pida configurar TURN.'));
      else if (st === 'disconnected') this.detalle.set('Conexión inestable…');
      else if (st === 'closed') this.estado.set('terminada');
    };
    this.pc = pc;
    return pc;
  }

  private async vaciarPendientes(): Promise<void> {
    const lista = this.pendientes.splice(0);
    for (const c of lista) { try { await this.pc?.addIceCandidate(c); } catch { /* candidato viejo */ } }
  }

  private cerrar(motivo: string): void {
    try { this.pc?.close(); } catch { /* ya cerrada */ }
    this.pc = null;
    this.local()?.getTracks().forEach(t => t.stop());
    this.local.set(null);
    this.remoto.set(null);
    this.remotaPuesta = false;
    this.pendientes = [];
    this.estado.set('terminada');
    this.detalle.set(motivo);
  }

  private fallar(e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    this.estado.set('error');
    this.detalle.set(/Permission|NotAllowed|denied/i.test(msg) ? 'Sin permiso de cámara o micrófono: revíselo en el navegador' : msg);
  }
}
