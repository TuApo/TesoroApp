import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';

import { SonidosService } from '../../sonidos.service';
import { FinDeJuego, azarConSemilla, barajar } from './azar';

interface Carta { id: number; emoji: string; volteada: boolean; hecha: boolean; }

const CARAS = ['🍎', '🥖', '🥛', '🧀', '🥚', '🍌', '🥑', '🍅', '🥕', '☕', '🍗', '🌭', '🍇', '🧃', '🍫', '🧴', '🧼', '🪥', '🧻', '🍯'];
const CARAS_HALLOWEEN = ['🎃', '👻', '🦇', '🕷️', '🍬', '🍭', '🧙', '🕸️', '🍫', '💀', '🌙', '🧛'];

/**
 * «Memoria de la tienda»: 8 parejas boca abajo. Encontrar una pareja suma 50 más 10 por cada
 * acierto seguido; limpiar el tablero suma 200 y sale uno nuevo, hasta que se acaba el tiempo.
 */
@Component({
  selector: 'juego-memoria',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.halloween]': 'halloween()' },
  template: `
    <div class="hud">
      <span class="tablero">Tablero {{ tablero() }}</span>
      <span class="racha" [class.viva]="racha() > 1">racha ×{{ racha() }}</span>
      <span class="puntos">{{ puntaje() }}</span>
    </div>
    <div class="tiempo"><i [style.width.%]="restante() * 100"></i></div>
    <div class="mesa" [class.nuevo]="animarTablero()">
      @for (c of cartas(); track c.id) {
        <button type="button" class="carta" [class.volteada]="c.volteada || c.hecha" [class.hecha]="c.hecha" (click)="voltear(c)"
                [disabled]="c.hecha || !activo()" data-sin-sonido [attr.aria-label]="c.volteada || c.hecha ? c.emoji : 'Carta boca abajo'">
          <span class="cara atras">{{ halloween() ? '🦇' : '🛒' }}</span>
          <span class="cara frente">{{ c.emoji }}</span>
        </button>
      }
    </div>
  `,
  styles: [`
    :host { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; padding: 46px 12px 16px; box-sizing: border-box;
      background: linear-gradient(180deg, #312E81, #6D28D9); user-select: none; }
    :host(.halloween) { background: linear-gradient(180deg, #1B0A36, #7C2D12); }
    .hud { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; align-items: center; gap: 10px; color: #fff; }
    .tablero { font-weight: 800; font-size: 13px; opacity: .8; }
    .racha { margin-left: auto; font-weight: 900; color: rgba(255, 255, 255, .5); }
    .racha.viva { color: #FDE047; }
    .puntos { min-width: 70px; text-align: right; font-weight: 900; font-size: 28px; font-variant-numeric: tabular-nums; }
    .tiempo { position: absolute; top: 0; left: 0; right: 0; height: 5px; background: rgba(255, 255, 255, .15); }
    .tiempo i { display: block; height: 100%; background: linear-gradient(90deg, #FDE047, #F97316); transition: width .25s linear; }
    .mesa { flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-rows: 1fr; gap: 10px;
      width: min(100%, 520px, calc((100dvh - 210px) * .9)); margin: auto; aspect-ratio: 1; }
    .mesa.nuevo .carta { animation: repartir .45s cubic-bezier(.2, 1.3, .4, 1) both; }
    .carta { position: relative; padding: 0; margin: 0 !important; min-height: 0 !important; border: 0; background: none; cursor: pointer;
      perspective: 600px; transform-style: preserve-3d; transition: transform .3s ease; }
    .cara { position: absolute; inset: 0; display: grid; place-items: center; border-radius: 14px; backface-visibility: hidden;
      font-size: clamp(26px, 8vw, 44px); transition: transform .32s ease; box-shadow: 0 6px 14px rgba(0, 0, 0, .25); }
    .atras { background: linear-gradient(135deg, #F97316, #EA580C); transform: rotateY(0deg); border: 3px solid rgba(255, 255, 255, .5); font-size: clamp(20px, 6vw, 30px); }
    .frente { background: #fff; transform: rotateY(180deg); }
    .carta.volteada .atras { transform: rotateY(-180deg); }
    .carta.volteada .frente { transform: rotateY(0deg); }
    .carta.hecha .frente { background: #DCFCE7; animation: hecha .4s ease; }
    .carta:disabled { cursor: default; }
    @keyframes hecha { 50% { transform: scale(1.12); } }
    @keyframes repartir { from { transform: translateY(-30px) scale(.6); opacity: 0; } }
  `],
})
export class JuegoMemoria {
  readonly semilla = input.required<number>();
  readonly duracion = input(60);
  readonly halloween = input(false);
  readonly activo = input(false);
  readonly fin = output<FinDeJuego>();
  readonly listo = output<void>();

  private sonidos = inject(SonidosService);
  readonly cartas = signal<Carta[]>([]);
  readonly puntaje = signal(0);
  readonly racha = signal(0);
  readonly tablero = signal(1);
  readonly restante = signal(1);
  readonly animarTablero = signal(false);

  private azar: () => number = Math.random;
  private abiertas: Carta[] = [];
  private bloqueo = false;
  private inicio = 0;
  private reloj: ReturnType<typeof setInterval> | null = null;
  private terminado = false;
  private parejas = 0; private errores = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => { if (this.reloj) clearInterval(this.reloj); });
    queueMicrotask(() => { this.azar = azarConSemilla(this.semilla()); this.repartir(); this.listo.emit(); });
    effect(() => { if (this.activo()) untracked(() => this.arrancar()); });
  }

  private arrancar(): void {
    if (this.reloj || this.terminado) return;
    this.inicio = performance.now();
    this.reloj = setInterval(() => {
      const r = Math.max(0, 1 - (performance.now() - this.inicio) / (this.duracion() * 1000));
      this.restante.set(r);
      if (r <= 0) this.terminar();
    }, 200);
  }

  private repartir(): void {
    const lista = this.halloween() ? CARAS_HALLOWEEN : CARAS;
    const ocho = barajar(lista, this.azar).slice(0, 8);
    const mazo = barajar([...ocho, ...ocho], this.azar).map((emoji, i) => ({ id: this.tablero() * 100 + i, emoji, volteada: false, hecha: false }));
    this.cartas.set(mazo);
    this.animarTablero.set(false);
    queueMicrotask(() => this.animarTablero.set(true));
  }

  voltear(c: Carta): void {
    if (!this.activo() || this.terminado || this.bloqueo || c.volteada || c.hecha) return;
    this.sonidos.tocar('voltear');
    this.cambiar(c.id, { volteada: true });
    this.abiertas.push(c);
    if (this.abiertas.length < 2) return;
    const [a, b] = this.abiertas;
    this.abiertas = [];
    if (a.emoji === b.emoji) {
      this.racha.update(r => r + 1);
      this.parejas++;
      this.puntaje.update(p => p + 50 + 10 * (this.racha() - 1));
      this.cambiar(a.id, { hecha: true }); this.cambiar(b.id, { hecha: true });
      this.sonidos.tocar('acierto');
      if (this.cartas().every(x => x.hecha)) {
        this.puntaje.update(p => p + 200);
        this.sonidos.tocar('monedas');
        this.bloqueo = true;
        setTimeout(() => { this.tablero.update(t => t + 1); this.repartir(); this.bloqueo = false; }, 650);
      }
    } else {
      this.racha.set(0);
      this.errores++;
      this.bloqueo = true;
      setTimeout(() => { this.cambiar(a.id, { volteada: false }); this.cambiar(b.id, { volteada: false }); this.bloqueo = false; }, 650);
    }
  }

  private cambiar(id: number, c: Partial<Carta>): void {
    this.cartas.update(l => l.map(x => x.id === id ? { ...x, ...c } : x));
  }

  private terminar(): void {
    if (this.terminado) return;
    this.terminado = true;
    if (this.reloj) clearInterval(this.reloj);
    this.sonidos.tocar('fin');
    this.fin.emit({ puntaje: this.puntaje(), detalle: JSON.stringify({ p: this.parejas, e: this.errores, t: this.tablero() }) });
  }
}
