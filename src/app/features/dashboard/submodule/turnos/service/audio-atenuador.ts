/**
 * Baja el volumen de todo lo que suena en la pantalla mientras habla la voz
 * (llamado de turno, perifoneo, aviso con voz) y lo devuelve al terminar.
 *
 * Cubre los `<audio>`/`<video>` del documento, los elementos registrados a
 * mano (la música de fondo, que vive fuera del DOM) y los embebidos de
 * YouTube (por su API de postMessage; el embed debe llevar enablejsapi=1).
 * Lleva la cuenta de cuántas voces hay activas: con dos superpuestas no se
 * restaura hasta que termine la última.
 */
export class AudioAtenuador {
  private activos = 0;
  private originales = new Map<HTMLMediaElement, number>();
  private registrados = new Set<HTMLMediaElement>();
  private youtubeAtenuado = false;

  /** Elementos que no están en el documento (música de fondo creada con new Audio()). */
  registrar(el: HTMLMediaElement): void { this.registrados.add(el); }
  olvidar(el: HTMLMediaElement): void { this.registrados.delete(el); this.originales.delete(el); }

  /** Baja todo al porcentaje dado (0-100) del volumen que tenía. */
  bajar(porcentaje: number): void {
    this.activos++;
    if (this.activos > 1) return;
    const factor = Math.max(0, Math.min(1, porcentaje / 100));
    for (const el of this.elementos()) {
      if (!this.originales.has(el)) this.originales.set(el, el.volume);
      try { el.volume = (this.originales.get(el) ?? 1) * factor; } catch { /* algunos navegadores no dejan */ }
    }
    this.youtube('setVolume', [Math.round(factor * 100)]);
    this.youtubeAtenuado = true;
  }

  /** Restaura los volúmenes cuando termina la última voz activa. */
  subir(): void {
    this.activos = Math.max(0, this.activos - 1);
    if (this.activos > 0) return;
    for (const [el, v] of this.originales) { try { el.volume = v; } catch { /* nada */ } }
    this.originales.clear();
    if (this.youtubeAtenuado) { this.youtube('setVolume', [100]); this.youtubeAtenuado = false; }
  }

  private elementos(): HTMLMediaElement[] {
    const enDom = typeof document === 'undefined' ? [] : Array.from(document.querySelectorAll<HTMLMediaElement>('audio, video'));
    return [...new Set([...enDom, ...this.registrados])];
  }

  private youtube(func: string, args: unknown[]): void {
    if (typeof document === 'undefined') return;
    for (const f of Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src*="youtube"]'))) {
      try { f.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*'); } catch { /* sin ventana */ }
    }
  }
}
