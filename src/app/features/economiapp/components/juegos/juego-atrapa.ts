import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';

import { SonidosService } from '../../sonidos.service';
import { FinDeJuego, azarConSemilla } from './azar';

interface Cosa { x: number; y: number; v: number; tipo: 'bueno' | 'estrella' | 'bomba'; emoji: string; giro: number; }
interface Texto { x: number; y: number; t: string; vida: number; color: string; }

const BUENOS = ['🍎', '🥖', '🥛', '🧀', '🥚', '🍌', '🥑', '🍅', '🥕', '☕', '🍗', '🌭', '🍞', '🍇'];
const BUENOS_HALLOWEEN = ['🎃', '🍬', '🍭', '🍫', '🍎', '🧁', '🌭', '🍪'];

/**
 * «Atrapa el mercado»: cae mercado y la canasta lo atrapa. Se mueve arrastrando el dedo (o el
 * mouse, o las flechas). Cada producto suma 10 por el multiplicador de racha (sube cada 5
 * seguidos, hasta ×5); la estrella vale 50; la bomba quita una vida y corta la racha. Dura lo
 * que diga el servidor (45 s) o hasta perder las 3 vidas. Todo en un canvas: los emojis se
 * pintan una vez en mapas de bits y luego solo se copian (va fluido en celulares sencillos).
 */
@Component({
  selector: 'juego-atrapa',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hud">
      <span class="vidas">@for (v of [0, 1, 2]; track v) { <i [class.perdida]="v >= vidas()">{{ halloween() ? '🧡' : '❤️' }}</i> }</span>
      <span class="combo" [class.vivo]="multi() > 1">×{{ multi() }}</span>
      <span class="puntos">{{ puntaje() }}</span>
    </div>
    <div class="tiempo"><i [style.width.%]="restante() * 100"></i></div>
    <canvas #lienzo (pointerdown)="tocar($event)" (pointermove)="mover($event)"></canvas>
  `,
  styles: [`
    :host { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; touch-action: none; user-select: none; }
    .hud { position: absolute; top: 10px; left: 12px; right: 12px; z-index: 2; display: flex; align-items: center; gap: 10px; pointer-events: none; }
    .vidas i { font-style: normal; font-size: 22px; margin-right: 2px; transition: opacity .2s, transform .2s; display: inline-block; }
    .vidas i.perdida { opacity: .2; transform: scale(.8); filter: grayscale(1); }
    .combo { margin-left: auto; font-weight: 900; font-size: 18px; color: rgba(255, 255, 255, .5); }
    .combo.vivo { color: #FDE047; animation: pulso .4s ease; }
    .puntos { min-width: 70px; text-align: right; font-weight: 900; font-size: 28px; color: #fff; text-shadow: 0 2px 8px rgba(0, 0, 0, .4); font-variant-numeric: tabular-nums; }
    .tiempo { position: absolute; top: 0; left: 0; right: 0; height: 5px; z-index: 2; background: rgba(255, 255, 255, .15); }
    .tiempo i { display: block; height: 100%; background: linear-gradient(90deg, #FDE047, #F97316); transition: width .2s linear; }
    canvas { flex: 1; width: 100%; height: 100%; display: block; cursor: grab; }
    @keyframes pulso { 50% { transform: scale(1.3); } }
  `],
})
export class JuegoAtrapa {
  readonly semilla = input.required<number>();
  readonly duracion = input(45);
  readonly halloween = input(false);
  readonly activo = input(false);
  readonly fin = output<FinDeJuego>();
  readonly listo = output<void>();

  private sonidos = inject(SonidosService);
  private lienzo = viewChild.required<ElementRef<HTMLCanvasElement>>('lienzo');

  readonly puntaje = signal(0);
  readonly vidas = signal(3);
  readonly multi = signal(1);
  readonly restante = signal(1);

  private cosas: Cosa[] = [];
  private textos: Texto[] = [];
  private mapas = new Map<string, HTMLCanvasElement>();
  private ctx!: CanvasRenderingContext2D;
  private w = 0; h = 0; private dpr = 1;
  private canastaX = 0; private objetivoX = 0;
  private racha = 0; private atrapados = 0; private estrellas = 0; private bombas = 0;
  private tiempo = 0; private proxima = 0; private ultimo = 0; private frame = 0;
  private terminado = false; private corriendo = false; private sacudir = 0;
  private azar: () => number = Math.random;
  private teclas = new Set<string>();

  constructor() {
    const destroy = inject(DestroyRef);
    const alTeclear = (e: KeyboardEvent) => { if (e.type === 'keydown') this.teclas.add(e.key); else this.teclas.delete(e.key); };
    const alCambiarTamano = () => this.medir();
    window.addEventListener('keydown', alTeclear);
    window.addEventListener('keyup', alTeclear);
    window.addEventListener('resize', alCambiarTamano);
    destroy.onDestroy(() => {
      cancelAnimationFrame(this.frame);
      window.removeEventListener('keydown', alTeclear);
      window.removeEventListener('keyup', alTeclear);
      window.removeEventListener('resize', alCambiarTamano);
    });
    // Preparado apenas existe el canvas; arranca cuando el anfitrión lo activa (tras el 3, 2, 1).
    afterNextRender(() => { this.preparar(); this.listo.emit(); });
    effect(() => { if (this.activo()) untracked(() => this.arrancar()); });
  }

  private preparar(): void {
    this.azar = azarConSemilla(this.semilla());
    const c = this.lienzo().nativeElement;
    this.ctx = c.getContext('2d')!;
    this.medir();
    this.canastaX = this.objetivoX = this.w / 2;
    this.pintar();
  }

  private medir(): void {
    const c = this.lienzo()?.nativeElement;
    if (!c) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = c.getBoundingClientRect();
    this.w = Math.max(200, r.width); this.h = Math.max(300, r.height);
    c.width = Math.round(this.w * this.dpr); c.height = Math.round(this.h * this.dpr);
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.canastaX = Math.min(this.w - 30, Math.max(30, this.canastaX));
  }

  private arrancar(): void {
    if (this.corriendo || this.terminado) return;
    this.corriendo = true;
    this.ultimo = performance.now();
    const cuadro = (ahora: number) => {
      const dt = Math.min(0.05, (ahora - this.ultimo) / 1000);
      this.ultimo = ahora;
      this.avanzar(dt);
      this.pintar();
      if (!this.terminado) this.frame = requestAnimationFrame(cuadro);
    };
    this.frame = requestAnimationFrame(cuadro);
  }

  private get tamCosa(): number { return Math.max(34, Math.min(52, this.w / 9)); }
  private get altoCanasta(): number { return this.h - 70; }

  private avanzar(dt: number): void {
    const dur = this.duracion();
    this.tiempo += dt;
    const avance = Math.min(1, this.tiempo / dur);
    this.restante.set(Math.max(0, 1 - avance));
    // Teclado
    if (this.teclas.has('ArrowLeft')) this.objetivoX -= 520 * dt;
    if (this.teclas.has('ArrowRight')) this.objetivoX += 520 * dt;
    this.objetivoX = Math.min(this.w - 30, Math.max(30, this.objetivoX));
    this.canastaX += (this.objetivoX - this.canastaX) * Math.min(1, dt * 18);

    // Aparecen más y más rápido con el tiempo.
    this.proxima -= dt;
    if (this.proxima <= 0) {
      const r = this.azar();
      const tipo: Cosa['tipo'] = r < 0.06 ? 'estrella' : r < 0.06 + 0.1 + avance * 0.08 ? 'bomba' : 'bueno';
      const lista = this.halloween() ? BUENOS_HALLOWEEN : BUENOS;
      const emoji = tipo === 'estrella' ? '⭐' : tipo === 'bomba' ? (this.halloween() ? '👻' : '💣') : lista[Math.floor(this.azar() * lista.length)];
      const t = this.tamCosa;
      this.cosas.push({ x: t / 2 + this.azar() * (this.w - t), y: -t, v: (this.h / 4.2) * (1 + avance * 1.6) * (0.85 + this.azar() * 0.3), tipo, emoji, giro: (this.azar() - 0.5) * 2 });
      this.proxima = 0.85 - avance * 0.5 + this.azar() * 0.25;
    }

    const t = this.tamCosa, ancho = Math.max(70, this.w / 5), yC = this.altoCanasta;
    for (const c of this.cosas) c.y += c.v * dt;
    const quedan: Cosa[] = [];
    for (const c of this.cosas) {
      const enAltura = c.y + t * 0.4 >= yC - 10 && c.y <= yC + 30;
      if (enAltura && Math.abs(c.x - this.canastaX) < ancho / 2 + t * 0.2) { this.atrapar(c); continue; }
      if (c.y > this.h + t) { if (c.tipo === 'bueno') this.racha = 0, this.multi.set(1); continue; }
      quedan.push(c);
    }
    this.cosas = quedan;
    for (const x of this.textos) { x.y -= 60 * dt; x.vida -= dt; }
    this.textos = this.textos.filter(x => x.vida > 0);
    if (this.sacudir > 0) this.sacudir -= dt;

    if (this.tiempo >= dur || this.vidas() <= 0) this.terminar();
  }

  private atrapar(c: Cosa): void {
    if (c.tipo === 'bomba') {
      this.vidas.update(v => v - 1);
      this.racha = 0; this.multi.set(1); this.bombas++; this.sacudir = 0.35;
      this.textos.push({ x: c.x, y: this.altoCanasta - 30, t: '−1 ❤', vida: 0.9, color: '#FCA5A5' });
      this.sonidos.tocar('bomba');
      try { navigator.vibrate?.(120); } catch { /* opcional */ }
      return;
    }
    this.racha++;
    const multi = Math.min(5, 1 + Math.floor(this.racha / 5));
    if (multi > this.multi()) this.sonidos.tocar('acierto');
    this.multi.set(multi);
    const base = c.tipo === 'estrella' ? 50 : 10;
    const gana = base * multi;
    this.puntaje.update(p => p + gana);
    if (c.tipo === 'estrella') this.estrellas++; else this.atrapados++;
    this.textos.push({ x: c.x, y: this.altoCanasta - 30, t: '+' + gana, vida: 0.8, color: c.tipo === 'estrella' ? '#FDE047' : '#FFFFFF' });
    this.sonidos.tocar(c.tipo === 'estrella' ? 'monedas' : 'atrapar');
  }

  private terminar(): void {
    if (this.terminado) return;
    this.terminado = true;
    cancelAnimationFrame(this.frame);
    this.sonidos.tocar('fin');
    this.fin.emit({ puntaje: this.puntaje(), detalle: JSON.stringify({ a: this.atrapados, e: this.estrellas, b: this.bombas, s: Math.round(this.tiempo) }) });
  }

  // ── control ──
  tocar(e: PointerEvent): void { this.lienzo().nativeElement.setPointerCapture?.(e.pointerId); this.mover(e); }
  mover(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.buttons === 0 && e.type === 'pointermove') { /* el mouse sigue sin clic */ }
    const r = this.lienzo().nativeElement.getBoundingClientRect();
    this.objetivoX = Math.min(this.w - 30, Math.max(30, e.clientX - r.left));
  }

  // ── dibujo ──
  private mapa(emoji: string, tam: number): HTMLCanvasElement {
    const clave = emoji + tam;
    let m = this.mapas.get(clave);
    if (!m) {
      m = document.createElement('canvas');
      const px = Math.round(tam * this.dpr * 1.25);
      m.width = m.height = px;
      const c = m.getContext('2d')!;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `${Math.round(px * 0.8)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      c.fillText(emoji, px / 2, px / 2 + px * 0.04);
      this.mapas.set(clave, m);
    }
    return m;
  }

  private pintar(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { w, h } = this;
    ctx.save();
    if (this.sacudir > 0) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6);
    const fondo = ctx.createLinearGradient(0, 0, 0, h);
    if (this.halloween()) { fondo.addColorStop(0, '#1B0A36'); fondo.addColorStop(1, '#5B21B6'); }
    else { fondo.addColorStop(0, '#0B3B2E'); fondo.addColorStop(1, '#0E9F6E'); }
    ctx.fillStyle = fondo;
    ctx.fillRect(-10, -10, w + 20, h + 20);
    // Estantes de fondo, suaves.
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    for (let y = 120; y < h - 120; y += 110) ctx.fillRect(0, y, w, 8);

    const t = this.tamCosa;
    for (const c of this.cosas) {
      const m = this.mapa(c.emoji, t);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(Math.sin((c.y / h) * Math.PI * 2) * 0.25 * c.giro);
      if (c.tipo === 'estrella') { ctx.shadowColor = '#FDE047'; ctx.shadowBlur = 18; }
      ctx.drawImage(m, -t * 0.625, -t * 0.625, t * 1.25, t * 1.25);
      ctx.restore();
    }
    // Canasta
    const ancho = Math.max(70, w / 5), yC = this.altoCanasta;
    const mc = this.mapa(this.halloween() ? '🪣' : '🧺', ancho);
    ctx.drawImage(mc, this.canastaX - ancho * 0.62, yC - ancho * 0.45, ancho * 1.25, ancho * 1.25);
    // Textos flotantes
    ctx.textAlign = 'center';
    ctx.font = '900 22px system-ui, sans-serif';
    for (const x of this.textos) {
      ctx.globalAlpha = Math.max(0, Math.min(1, x.vida * 1.6));
      ctx.fillStyle = x.color;
      ctx.fillText(x.t, x.x, x.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
