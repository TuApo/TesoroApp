import { Injectable, computed, signal } from '@angular/core';

export interface Dispositivo { id: string; nombre: string }

interface Preferencias { mic: string; altavoz: string; camara: string }

const CLAVE = 'tuapo.com.dispositivos';

/**
 * Micrófono, salida de audio y cámara que cada quien prefiere para las llamadas.
 * La elección se guarda en el navegador (es de ese equipo: otro computador tiene
 * otros dispositivos) y se usa al llamar, al contestar y al cambiar en plena llamada.
 *
 * "" = el predeterminado del sistema. Si el elegido ya no está conectado, la llamada
 * sigue con el predeterminado en vez de fallar.
 */
@Injectable({ providedIn: 'root' })
export class DispositivosService {
  readonly microfonos = signal<Dispositivo[]>([]);
  readonly altavoces = signal<Dispositivo[]>([]);
  readonly camaras = signal<Dispositivo[]>([]);
  readonly mic = signal('');
  readonly altavoz = signal('');
  readonly camara = signal('');
  /** El navegador deja elegir la salida de audio (Chrome, Edge, Firefox; Safari no). */
  readonly eligeSalida = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  /** Sin permiso de micrófono el navegador no dice los nombres de los dispositivos. */
  readonly sinNombres = computed(() => this.microfonos().length > 0 && this.microfonos().every(d => d.nombre.startsWith('Micrófono ')));

  constructor() {
    const p = this.leer();
    this.mic.set(p.mic);
    this.altavoz.set(p.altavoz);
    this.camara.set(p.camara);
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', () => void this.refrescar());
    }
  }

  async refrescar(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const todos = await navigator.mediaDevices.enumerateDevices();
      const de = (tipo: MediaDeviceKind, base: string) => todos.filter(d => d.kind === tipo && d.deviceId)
        .map((d, i) => ({ id: d.deviceId, nombre: d.label || `${base} ${i + 1}` }));
      this.microfonos.set(de('audioinput', 'Micrófono'));
      this.altavoces.set(de('audiooutput', 'Salida'));
      this.camaras.set(de('videoinput', 'Cámara'));
    } catch { /* sin acceso a la lista */ }
  }

  /** Restricciones de audio para un micrófono ("" = el del sistema) con la limpieza de voz encendida. */
  audio(id = this.mic()): MediaTrackConstraints {
    const c: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (id) c.deviceId = { exact: id };
    return c;
  }

  video(id = this.camara()): MediaTrackConstraints {
    const c: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (id) c.deviceId = { exact: id };
    return c;
  }

  elegirMic(id: string): void { this.mic.set(id); this.guardar(); }
  elegirAltavoz(id: string): void { this.altavoz.set(id); this.guardar(); }
  elegirCamara(id: string): void { this.camara.set(id); this.guardar(); }

  /** Pone la salida elegida en un <audio>/<video> (sin soporte, suena por la del sistema). */
  async aplicarSalida(el: HTMLMediaElement, id = this.altavoz()): Promise<void> {
    if (!this.eligeSalida) return;
    const actual = (el as any).sinkId ?? '';
    if (actual === id) return;
    try {
      await (el as any).setSinkId(id);
    } catch {
      // La salida elegida se desconectó: vuelve a la del sistema.
      if (id) await (el as any).setSinkId('').catch(() => undefined);
    }
  }

  /** El dispositivo pedido ya no existe (se desconectó): se olvida para no fallar la próxima vez. */
  esErrorDeDispositivo(e: any): boolean {
    return e?.name === 'OverconstrainedError' || e?.name === 'NotFoundError' || e?.name === 'NotReadableError';
  }

  nombreMic(): string {
    return this.microfonos().find(d => d.id === this.mic())?.nombre ?? 'Predeterminado del sistema';
  }

  private leer(): Preferencias {
    try {
      const p = JSON.parse(localStorage.getItem(CLAVE) ?? '{}');
      return { mic: p.mic ?? '', altavoz: p.altavoz ?? '', camara: p.camara ?? '' };
    } catch {
      return { mic: '', altavoz: '', camara: '' };
    }
  }

  private guardar(): void {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({ mic: this.mic(), altavoz: this.altavoz(), camara: this.camara() }));
    } catch { /* navegador sin almacenamiento: la elección dura la sesión */ }
  }
}

/** Un pitido corto como WAV (para probar la salida de audio sin descargar nada). */
export function wavDePrueba(): string {
  const tasa = 22050, dur = 0.9, n = Math.floor(tasa * dur);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const txt = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVE'); txt(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, tasa, true);
  v.setUint32(28, tasa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / tasa;
    const f = t < dur / 2 ? 660 : 880;
    const env = Math.min(1, t * 30, (dur - t) * 30) * (t % (dur / 2) < dur / 2 - 0.05 ? 1 : 0.2);
    v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * f * t) * 0.3 * env * 32767, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
