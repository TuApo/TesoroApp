import { signal } from '@angular/core';

/**
 * Nivel del micrófono (0..1) mientras el reconocimiento de voz del navegador escucha, solo para
 * animar la onda: el reconocedor no lo expone. Si el navegador no deja abrir el micrófono dos
 * veces, la onda se anima sola (CSS) y nada falla.
 */
export class MedidorMic {
  readonly nivel = signal(0);
  private flujo: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private cuadro = 0;

  async iniciar(): Promise<void> {
    this.detener();
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      this.flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      const analizador = this.ctx.createAnalyser();
      analizador.fftSize = 256;
      this.ctx.createMediaStreamSource(this.flujo).connect(analizador);
      const datos = new Uint8Array(analizador.frequencyBinCount);
      const leer = () => {
        analizador.getByteTimeDomainData(datos);
        let pico = 0;
        for (const v of datos) pico = Math.max(pico, Math.abs(v - 128));
        // Suavizado: sube rápido y baja despacio, como un vúmetro.
        const n = Math.min(1, pico / 48);
        this.nivel.update(a => (n > a ? n : a * 0.85 + n * 0.15));
        this.cuadro = requestAnimationFrame(leer);
      };
      leer();
    } catch {
      this.detener();
    }
  }

  detener(): void {
    if (this.cuadro) cancelAnimationFrame(this.cuadro);
    this.cuadro = 0;
    this.flujo?.getTracks().forEach(t => t.stop());
    this.flujo = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.nivel.set(0);
  }
}
