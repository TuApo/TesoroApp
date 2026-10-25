import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ArticuloComprador, TiendaService } from '../../../dashboard/submodule/tienda/service/tienda.service';
import { EconomiaStore } from '../../economia.store';
import { pesos } from '../../economia.util';
import { SonidosService } from '../../sonidos.service';
import { EcoImagen } from '../eco-imagen';
import { FinDeJuego, azarConSemilla, barajar } from './azar';

interface Ronda { a: ArticuloComprador; b: ArticuloComprador; }

/**
 * «¿Cuál cuesta menos?»: dos productos de verdad de la tienda; se toca el más barato. Acertar
 * suma 100 más 20 por cada acierto seguido (hasta +200); fallar corta la racha. Los pares se
 * arman con precios que difieren al menos 12 %, para que se pueda adivinar sin lupa. De paso,
 * la persona se entera de lo que hay y cuánto cuesta.
 */
@Component({
  selector: 'juego-precio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EcoImagen],
  template: `
    <div class="hud">
      <span class="racha" [class.viva]="racha() > 1">racha ×{{ racha() }}</span>
      <span class="puntos">{{ puntaje() }}</span>
    </div>
    <div class="tiempo"><i [style.width.%]="restante() * 100"></i></div>
    @if (error()) {
      <p class="aviso">{{ error() }}</p>
    } @else if (ronda(); as r) {
      <h3>¿Cuál cuesta <b>menos</b>?</h3>
      <div class="par">
        @for (p of [r.a, r.b]; track p.id) {
          <button type="button" class="opcion" (click)="elegir(p)" [disabled]="!!respuesta() || !activo()" data-sin-sonido
                  [class.bien]="respuesta() && esMasBarato(p)" [class.mal]="respuesta() === p.id && !esMasBarato(p)">
            <span class="foto"><eco-imagen [doc]="p.imagen" [nombre]="p.nombre" icono="shopping_bag" /></span>
            <span class="nombre">{{ p.nombre }}</span>
            <span class="precio" [class.ver]="!!respuesta()">{{ respuesta() ? pesos(precio(p)) : '¿ ? ?' }}</span>
          </button>
        }
      </div>
      <p class="contador">{{ aciertos() }} aciertos · {{ rondas() }} rondas</p>
    } @else {
      <p class="aviso">Buscando productos de su tienda…</p>
    }
  `,
  styles: [`
    :host { position: relative; display: flex; flex-direction: column; align-items: center; width: 100%; height: 100%; padding: 46px 14px 16px;
      box-sizing: border-box; color: #fff; background: linear-gradient(180deg, #0C4A6E, #0E9F6E); user-select: none; }
    :host(.halloween) { background: linear-gradient(180deg, #1B0A36, #9A3412); }
    .hud { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; align-items: center; gap: 10px; }
    .racha { font-weight: 900; color: rgba(255, 255, 255, .5); }
    .racha.viva { color: #FDE047; }
    .puntos { margin-left: auto; font-weight: 900; font-size: 28px; font-variant-numeric: tabular-nums; }
    .tiempo { position: absolute; top: 0; left: 0; right: 0; height: 5px; background: rgba(255, 255, 255, .15); }
    .tiempo i { display: block; height: 100%; background: linear-gradient(90deg, #FDE047, #F97316); transition: width .25s linear; }
    h3 { margin: 8px 0 14px; font-size: clamp(20px, 6vw, 26px); font-weight: 900; }
    h3 b { color: #FDE047; }
    .par { width: min(100%, 560px); flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-content: start; }
    .opcion { display: flex; flex-direction: column; gap: 8px; padding: 10px; margin: 0 !important; min-height: 0 !important; border-radius: 20px;
      border: 3px solid transparent; background: #fff; color: #0F172A; cursor: pointer; font: inherit; text-align: center;
      box-shadow: 0 10px 24px rgba(0, 0, 0, .25); transition: transform .12s ease, border-color .15s ease; }
    .opcion:active:not(:disabled) { transform: scale(.97); }
    .opcion.bien { border-color: #22C55E; animation: salto .35s ease; }
    .opcion.mal { border-color: #EF4444; animation: temblor .35s ease; }
    .opcion:disabled { cursor: default; }
    .foto { aspect-ratio: 1; border-radius: 14px; overflow: hidden; background: #F1F5F9; display: block; }
    .foto eco-imagen { width: 100%; height: 100%; }
    .nombre { font-weight: 700; font-size: 13px; line-height: 1.25; min-height: 3.75em; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .precio { font-weight: 900; font-size: 18px; color: #94A3B8; }
    .precio.ver { color: #0F172A; }
    .opcion.bien .precio { color: #15803D; }
    .opcion.mal .precio { color: #B91C1C; }
    .contador { margin: 12px 0 0; font-size: 13px; opacity: .85; }
    .aviso { margin: auto; font-weight: 700; text-align: center; }
    @keyframes salto { 50% { transform: translateY(-6px); } }
    @keyframes temblor { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
  `],
  host: { '[class.halloween]': 'halloween()' },
})
export class JuegoPrecio {
  readonly semilla = input.required<number>();
  readonly duracion = input(45);
  readonly halloween = input(false);
  readonly activo = input(false);
  readonly fin = output<FinDeJuego>();
  readonly listo = output<void>();

  private api = inject(TiendaService);
  private store = inject(EconomiaStore);
  private sonidos = inject(SonidosService);

  readonly ronda = signal<Ronda | null>(null);
  readonly respuesta = signal<string | null>(null);
  readonly puntaje = signal(0);
  readonly racha = signal(0);
  readonly aciertos = signal(0);
  readonly rondas = signal(0);
  readonly restante = signal(1);
  readonly error = signal<string | null>(null);
  readonly pesos = pesos;

  private productos: ArticuloComprador[] = [];
  private azar: () => number = Math.random;
  private reloj: ReturnType<typeof setInterval> | null = null;
  private inicio = 0;
  private terminado = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => { if (this.reloj) clearInterval(this.reloj); });
    queueMicrotask(() => this.cargar());
    effect(() => { if (this.activo()) untracked(() => this.arrancar()); });
  }

  /** Trae productos de la tienda con foto y precio; listo cuando hay suficientes para jugar. */
  private async cargar(): Promise<void> {
    this.azar = azarConSemilla(this.semilla());
    try {
      const ambito = this.store.ambito();
      const vistos = new Map<string, ArticuloComprador>();
      for (const pagina of [0, 1, 2]) {
        const r = await firstValueFrom(this.api.catalogoMulti(ambito, { pagina, tamano: 60 }));
        for (const a of r.articulos ?? []) if (a.imagen && this.precio(a) > 0 && !a.con_opciones) vistos.set(a.id, a);
        if (vistos.size >= 60 || (r.total_paginas ?? 1) <= pagina + 1) break;
      }
      this.productos = barajar([...vistos.values()], this.azar);
      if (this.productos.length < 6) { this.error.set('Su tienda todavía no tiene suficientes productos con foto para este juego.'); return; }
      this.siguiente();
      this.listo.emit();
    } catch {
      this.error.set('No pudimos traer los productos. Revise la conexión e intente de nuevo.');
    }
  }

  private arrancar(): void {
    if (this.reloj || this.terminado || !this.productos.length) return;
    this.inicio = performance.now();
    this.reloj = setInterval(() => {
      const r = Math.max(0, 1 - (performance.now() - this.inicio) / (this.duracion() * 1000));
      this.restante.set(r);
      if (r <= 0) this.terminar();
    }, 200);
  }

  precio(a: ArticuloComprador): number { return Number(a.precio_promo ?? a.precio ?? 0); }
  esMasBarato(p: ArticuloComprador): boolean {
    const r = this.ronda();
    if (!r) return false;
    const otro = r.a.id === p.id ? r.b : r.a;
    return this.precio(p) < this.precio(otro);
  }

  private siguiente(): void {
    const n = this.productos.length;
    for (let intento = 0; intento < 40; intento++) {
      const a = this.productos[Math.floor(this.azar() * n)], b = this.productos[Math.floor(this.azar() * n)];
      if (a.id === b.id) continue;
      const x = this.precio(a), y = this.precio(b), mayor = Math.max(x, y), menor = Math.min(x, y);
      if (menor <= 0 || mayor / menor < 1.12 || mayor / menor > 6) continue;
      this.ronda.set({ a, b });
      this.respuesta.set(null);
      return;
    }
    const [a, b] = barajar(this.productos, this.azar);
    this.ronda.set({ a, b });
    this.respuesta.set(null);
  }

  elegir(p: ArticuloComprador): void {
    if (!this.activo() || this.terminado || this.respuesta()) return;
    this.respuesta.set(p.id);
    this.rondas.update(n => n + 1);
    if (this.esMasBarato(p)) {
      this.racha.update(r => r + 1);
      this.aciertos.update(n => n + 1);
      this.puntaje.update(x => x + 100 + Math.min(200, 20 * (this.racha() - 1)));
      this.sonidos.tocar('acierto');
    } else {
      this.racha.set(0);
      this.sonidos.tocar('error');
    }
    setTimeout(() => { if (!this.terminado) this.siguiente(); }, 750);
  }

  private terminar(): void {
    if (this.terminado) return;
    this.terminado = true;
    if (this.reloj) clearInterval(this.reloj);
    this.sonidos.tocar('fin');
    this.fin.emit({ puntaje: this.puntaje(), detalle: JSON.stringify({ a: this.aciertos(), r: this.rondas() }) });
  }
}
