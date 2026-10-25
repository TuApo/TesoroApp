import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';

import { GiroRuleta, OpcionRuleta } from '../../dashboard/submodule/tienda/service/tienda.service';
import { TemporadaService } from '../../../core/services/temporada.service';
import { EconomiaStore } from '../economia.store';
import { mensajeError } from '../economia.util';
import { SonidosService } from '../sonidos.service';
import { EcoConfeti } from './eco-confeti';

const VUELTAS = 6;
const DURACION_MS = 5600;

/**
 * La ruleta del día (como las de las tiendas en línea): una vez al día, en vez de puntos por
 * solo entrar. El sorteo lo hace el servidor; aquí solo se anima la rueda hasta la casilla que
 * devolvió, con un «tic» por cada casilla que pasa bajo la flecha y frenando de a poco.
 *
 * <p>Las casillas se pintan del mismo tamaño (así se ven las ruletas), pero las probabilidades
 * reales están a la vista en «¿Cómo funciona?».
 */
@Component({
  selector: 'eco-ruleta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, EcoConfeti],
  template: `
    <div class="velo" (click)="cerrar()"></div>
    <section class="hoja" role="dialog" aria-modal="true" aria-label="Ruleta del día" [class.halloween]="halloween()">
      <button type="button" class="x" (click)="cerrar()" aria-label="Cerrar" data-sin-sonido><mat-icon>close</mat-icon></button>
      @if (festejar()) { <eco-confeti /> }

      <header class="cabeza">
        <span class="chip"><mat-icon>casino</mat-icon> {{ halloween() ? 'Ruleta embrujada' : 'Ruleta del día' }}</span>
        <h2>{{ titulo() }}</h2>
        <p>{{ subtitulo() }}</p>
      </header>

      <div class="rueda-marco">
        <div class="flecha" [class.golpe]="golpe()"></div>
        <svg class="rueda" viewBox="-160 -160 320 320" aria-hidden="true">
          <circle r="158" class="aro" />
          <g [attr.transform]="'rotate(' + angulo() + ')'">
            @for (o of opciones(); track o.id; let i = $index) {
              <path [attr.d]="sector(i)" [attr.fill]="color(o, i)" class="sector" [class.ganadora]="ganadora() === i" />
              <g [attr.transform]="'rotate(' + (i * paso() + paso() / 2) + ')'">
                @if (o.tipo === 'PUNTOS') {
                  <text y="-104" class="num">{{ o.puntos }}</text>
                  <text y="-84" class="pts">pts</text>
                } @else {
                  <text y="-100" class="emoji">{{ emoji(o) }}</text>
                  <text y="-76" class="mini">{{ corta(o.etiqueta) }}</text>
                }
              </g>
            }
          </g>
          @for (b of bombillos; track b) {
            <circle [attr.cx]="150 * cos(b)" [attr.cy]="150 * sen(b)" r="4.2" class="bombillo" [class.par]="b % 2 === 0" [class.rapido]="girando()" />
          }
        </svg>
        <button type="button" class="centro" (click)="girar()" [disabled]="girando() || !!resultado() || store.ruleta()?.girada_hoy || !opciones().length"
                data-sin-sonido>
          @if (girando()) { <mat-icon class="gira">autorenew</mat-icon> }
          @else if (resultado() || store.ruleta()?.girada_hoy) { <mat-icon>check</mat-icon> }
          @else { <span>{{ halloween() ? '🎃' : '' }} GIRAR</span> }
        </button>
      </div>

      @if (error()) { <p class="error"><mat-icon>error</mat-icon> {{ error() }}</p> }

      @if (resultado(); as r) {
        <div class="premio" [class.objeto]="r.tipo === 'PREMIO'">
          @if (r.tipo === 'PREMIO') {
            <span class="premio-emoji">{{ emojiDe(r.etiqueta) }}</span>
            <div>
              <b>¡Ganó {{ r.premio_nombre || r.etiqueta }}!</b>
              <small>Quedó guardado en sus canjes@if (r.canje_codigo) { con el código <code>{{ r.canje_codigo }}</code> }. Muéstrelo en {{ r.tienda_nombre || 'la tienda' }} para reclamarlo.</small>
            </div>
          } @else {
            <span class="premio-emoji">⭐</span>
            <div><b>+{{ r.puntos }} puntos</b><small>Ya están en su saldo. ¡Vuelva mañana por otro giro!</small></div>
          }
        </div>
        @if (r.bono_racha) { <p class="racha"><mat-icon>local_fire_department</mat-icon> ¡Racha de {{ r.racha }} días! +{{ r.bono_racha }} puntos de bono.</p> }
        <div class="acciones">
          @if (r.tipo === 'PREMIO') { <button type="button" class="rb-btn" (click)="irACanjes()"><mat-icon>qr_code_2</mat-icon> Ver mi canje</button> }
          <button type="button" class="rb-btn sec" (click)="irAJuegos()"><mat-icon>sports_esports</mat-icon> Jugar por el podio</button>
        </div>
      } @else if (yaGiro()) {
        <p class="espera"><mat-icon>schedule</mat-icon> Próximo giro en <b>{{ faltan() }}</b></p>
        <div class="acciones"><button type="button" class="rb-btn sec" (click)="irAJuegos()"><mat-icon>sports_esports</mat-icon> Mientras tanto, jugar</button></div>
      } @else if (!girando()) {
        <p class="pista">Toque <b>GIRAR</b>. Casi siempre caen puntos… ¡y a veces un perro caliente o un premio!</p>
      }

      <details class="como">
        <summary>¿Cómo funciona?</summary>
        <p>Un giro por día (se reinicia a medianoche). Si cae un premio, queda en sus canjes para reclamarlo en la tienda.
          Girar 7 días seguidos suma {{ store.ruleta()?.bono_racha || 50 }} puntos de bono.</p>
        <ul>
          @for (o of porProbabilidad(); track o.id) {
            <li><i [style.background]="o.color || '#7C3AED'"></i> {{ o.etiqueta }} <span>{{ o.probabilidad }} %</span></li>
          }
        </ul>
      </details>
    </section>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 16px; }
    .velo { position: absolute; inset: 0; background: rgba(15, 6, 34, .62); backdrop-filter: blur(3px); animation: aparecer .2s ease; }
    .hoja {
      position: relative; width: min(420px, 100%); max-height: calc(100dvh - 32px); overflow: auto; overscroll-behavior: contain;
      border-radius: 28px; padding: 22px 18px 16px; text-align: center; color: #fff;
      background: radial-gradient(130% 90% at 50% 0%, #6D28D9 0%, #3B0D6B 55%, #1B0A36 100%);
      box-shadow: 0 30px 80px rgba(0, 0, 0, .45); animation: subir .35s cubic-bezier(.2, 1.3, .4, 1);
    }
    .hoja.halloween { background: radial-gradient(130% 90% at 50% 0%, #EA580C 0%, #6B21A8 50%, #1B0A36 100%); }
    .x { position: absolute; top: 10px; right: 10px; width: 38px; height: 38px; min-height: 38px !important; margin: 0 !important; padding: 0;
      border: 0; border-radius: 50%; background: rgba(255, 255, 255, .14); color: #fff; display: grid; place-items: center; cursor: pointer; z-index: 2; }
    .cabeza { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-bottom: 8px; }
    .chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 800;
      background: rgba(253, 224, 71, .18); color: #FDE047; letter-spacing: .02em; }
    .chip mat-icon { font-size: 16px; width: 16px; height: 16px; }
    h2 { margin: 0; font-size: clamp(22px, 6vw, 28px); font-weight: 900; letter-spacing: -.02em; }
    .cabeza p { margin: 0; font-size: 13.5px; opacity: .85; }

    .rueda-marco { position: relative; width: min(82vw, 330px); aspect-ratio: 1; margin: 6px auto 10px; }
    .rueda { width: 100%; height: 100%; display: block; filter: drop-shadow(0 12px 24px rgba(0, 0, 0, .4)); }
    .aro { fill: #1E0B3B; stroke: #FDE047; stroke-width: 4; }
    .sector { stroke: rgba(255, 255, 255, .55); stroke-width: 1.5; }
    .sector.ganadora { animation: brillo .5s ease-in-out 4 alternate; }
    text { text-anchor: middle; fill: #fff; font-family: inherit; font-weight: 900; paint-order: stroke; stroke: rgba(0, 0, 0, .25); stroke-width: 2px; }
    .num { font-size: 26px; }
    .pts { font-size: 11px; font-weight: 800; letter-spacing: .08em; }
    .emoji { font-size: 26px; stroke: none; }
    .mini { font-size: 11px; font-weight: 800; }
    .bombillo { fill: #FEF3C7; animation: parpadeo 1.2s ease-in-out infinite; }
    .bombillo.par { animation-delay: .6s; }
    .bombillo.rapido { animation-duration: .25s; }
    .flecha {
      position: absolute; left: 50%; top: -6px; z-index: 2; width: 0; height: 0; translate: -50% 0;
      border-left: 15px solid transparent; border-right: 15px solid transparent; border-top: 30px solid #FDE047;
      filter: drop-shadow(0 3px 4px rgba(0, 0, 0, .45)); transform-origin: 50% 0;
    }
    .flecha.golpe { animation: golpe .12s ease-out; }
    .centro {
      position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: 30%; aspect-ratio: 1; min-height: 0 !important; margin: 0 !important;
      border-radius: 50%; border: 4px solid #FDE047; background: radial-gradient(circle at 35% 30%, #FB923C, #C2410C 70%);
      color: #fff; font: inherit; font-weight: 900; font-size: clamp(13px, 4vw, 17px); letter-spacing: .04em; cursor: pointer;
      box-shadow: 0 6px 18px rgba(0, 0, 0, .45), inset 0 -4px 0 rgba(0, 0, 0, .2); display: grid; place-items: center;
      transition: transform .12s ease;
    }
    .centro:not(:disabled) { animation: latir 1.4s ease-in-out infinite; }
    .centro:active:not(:disabled) { transform: scale(.94); }
    .centro:disabled { cursor: default; filter: saturate(.85); }
    .centro mat-icon { font-size: 30px; width: 30px; height: 30px; }
    .gira { animation: rotar 1s linear infinite; }

    .premio { display: flex; align-items: center; gap: 12px; text-align: left; margin: 6px 0 10px; padding: 12px 14px; border-radius: 18px;
      background: rgba(255, 255, 255, .12); border: 1px solid rgba(253, 224, 71, .45); animation: subir .4s ease; }
    .premio.objeto { background: linear-gradient(135deg, rgba(253, 224, 71, .25), rgba(249, 115, 22, .25)); }
    .premio-emoji { font-size: 40px; line-height: 1; flex: none; }
    .premio b { display: block; font-size: 18px; font-weight: 900; }
    .premio small { display: block; font-size: 12.5px; opacity: .9; line-height: 1.35; margin-top: 2px; }
    .premio code { font-weight: 900; letter-spacing: .08em; background: rgba(0, 0, 0, .25); padding: 1px 6px; border-radius: 6px; }
    .racha, .espera, .error { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 4px 0 10px; font-size: 13.5px; }
    .pista { margin: 4px 0 10px; font-size: 13.5px; line-height: 1.4; }
    .racha mat-icon { color: #FB923C; }
    .error { color: #FECACA; }
    .acciones { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 10px; }
    .rb-btn { flex: 1 1 160px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 46px; margin: 0 !important;
      padding: 0 16px; border: 0; border-radius: 999px; font: inherit; font-weight: 800; font-size: 14.5px; cursor: pointer;
      background: #FDE047; color: #3B0D6B; box-shadow: 0 8px 20px rgba(253, 224, 71, .3); }
    .rb-btn.sec { background: rgba(255, 255, 255, .14); color: #fff; box-shadow: none; border: 1px solid rgba(255, 255, 255, .3); }
    .rb-btn mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .como { text-align: left; font-size: 12.5px; opacity: .92; margin-top: 4px; }
    .como summary { cursor: pointer; font-weight: 800; text-align: center; list-style: none; padding: 6px; }
    .como summary::-webkit-details-marker { display: none; }
    .como p { margin: 4px 0 8px; line-height: 1.4; }
    .como ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; }
    .como li { display: flex; align-items: center; gap: 6px; }
    .como li i { width: 10px; height: 10px; border-radius: 3px; flex: none; }
    .como li span { margin-left: auto; font-weight: 800; }

    @keyframes aparecer { from { opacity: 0; } }
    @keyframes subir { from { transform: translateY(24px) scale(.96); opacity: 0; } }
    @keyframes parpadeo { 50% { fill: #F59E0B; opacity: .5; } }
    @keyframes golpe { 50% { rotate: -14deg; } }
    @keyframes latir { 50% { transform: scale(1.06); } }
    @keyframes rotar { to { rotate: 360deg; } }
    @keyframes brillo { to { filter: brightness(1.45); } }
    @media (prefers-reduced-motion: reduce) { .bombillo, .centro, .hoja, .premio { animation: none !important; } }
  `],
})
export class EcoRuleta {
  readonly store = inject(EconomiaStore);
  private sonidos = inject(SonidosService);
  private router = inject(Router);
  private temporada = inject(TemporadaService);

  readonly halloween = computed(() => this.temporada.clave() === 'halloween');
  readonly opciones = computed<OpcionRuleta[]>(() => this.store.ruleta()?.opciones ?? []);
  readonly paso = computed(() => 360 / Math.max(1, this.opciones().length));
  readonly porProbabilidad = computed(() => [...this.opciones()].sort((a, b) => b.probabilidad - a.probabilidad));
  readonly angulo = signal(0);
  readonly girando = signal(false);
  readonly golpe = signal(false);
  readonly resultado = signal<GiroRuleta | null>(null);
  readonly ganadora = signal<number | null>(null);
  readonly error = signal<string | null>(null);
  readonly festejar = signal(false);
  readonly faltan = signal('');
  readonly bombillos = Array.from({ length: 20 }, (_, i) => i);

  /** Ya giró hoy y no es el giro que se está viendo ahora (el servidor responde antes de que la rueda pare). */
  readonly yaGiro = computed(() => !!this.store.ruleta()?.girada_hoy && !this.girando() && !this.resultado());
  readonly titulo = computed(() => {
    const r = this.resultado();
    if (r) return r.tipo === 'PREMIO' ? '¡Felicitaciones!' : '¡Buen giro!';
    if (this.girando()) return '¡Suerte!';
    return this.yaGiro() ? 'Ya giró hoy' : '¡Gire y gane!';
  });
  readonly subtitulo = computed(() => this.yaGiro()
    ? 'Mañana tiene otro giro. Su racha sigue contando.'
    : 'Puntos, perros calientes y premios de su tienda');

  private frame = 0;
  private reloj: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Si ya giró hoy, la rueda queda quieta en lo que le salió.
    effect(() => {
      const r = this.store.ruleta();
      if (!r?.girada_hoy || !r.hoy || this.girando() || this.resultado()) return;
      untracked(() => {
        const i = this.opciones().findIndex(o => o.id === r.hoy!.opcion_id);
        if (i >= 0) { this.angulo.set(-(i * this.paso() + this.paso() / 2)); this.ganadora.set(i); }
      });
    });
    this.reloj = setInterval(() => this.contar(), 1000);
    this.contar();
    inject(DestroyRef).onDestroy(() => { cancelAnimationFrame(this.frame); if (this.reloj) clearInterval(this.reloj); });
    this.sonidos.tocar('abrir');
  }

  async girar(): Promise<void> {
    if (this.girando() || this.resultado() || this.store.ruleta()?.girada_hoy) return;
    this.error.set(null);
    this.girando.set(true);
    this.sonidos.tocar('giro');
    // Mientras el servidor sortea, la rueda ya arranca a girar suave.
    const inicio = performance.now();
    const previo = this.angulo();
    const arranque = () => {
      this.angulo.set(previo + ((performance.now() - inicio) / 1000) * 220);
      this.frame = requestAnimationFrame(arranque);
    };
    this.frame = requestAnimationFrame(arranque);
    try {
      const g = await this.store.girarRuleta();
      cancelAnimationFrame(this.frame);
      const i = g.indice ?? this.opciones().findIndex(o => o.id === g.opcion_id);
      await this.animarHasta(Math.max(0, i));
      this.ganadora.set(i);
      this.resultado.set(g);
      this.celebrar(g);
    } catch (e) {
      cancelAnimationFrame(this.frame);
      this.error.set(mensajeError(e, 'No se pudo girar. Intente de nuevo.'));
      this.sonidos.tocar('error');
    } finally {
      this.girando.set(false);
    }
  }

  /** Frena hasta dejar la casilla i bajo la flecha, con un tic por casilla que pasa. */
  private animarHasta(i: number): Promise<void> {
    const paso = this.paso();
    const desde = this.angulo();
    // Un punto al azar dentro de la casilla (no siempre el centro): se ve más natural.
    const dentro = (Math.random() - 0.5) * paso * 0.6;
    const destinoMod = -(i * paso + paso / 2 + dentro);
    let destino = Math.ceil((desde - destinoMod) / 360) * 360 + destinoMod; // ≥ desde, mismo lugar
    destino += 360 * VUELTAS;
    const inicio = performance.now();
    let ultimaCasilla = Math.floor(-desde / paso);
    return new Promise(resolve => {
      const cuadro = (ahora: number) => {
        const t = Math.min(1, (ahora - inicio) / DURACION_MS);
        const suave = 1 - Math.pow(1 - t, 4); // frena de a poco
        const a = desde + (destino - desde) * suave;
        this.angulo.set(a);
        const casilla = Math.floor((-a) / paso);
        if (casilla !== ultimaCasilla) {
          ultimaCasilla = casilla;
          this.sonidos.tocar('tic');
          this.golpe.set(false);
          queueMicrotask(() => this.golpe.set(true));
        }
        if (t < 1) this.frame = requestAnimationFrame(cuadro);
        else resolve();
      };
      this.frame = requestAnimationFrame(cuadro);
    });
  }

  private celebrar(g: GiroRuleta): void {
    if (g.tipo === 'PREMIO') { this.sonidos.tocar('canje'); this.festejar.set(true); }
    else if (g.puntos >= 100) { this.sonidos.tocar('nivel'); this.festejar.set(true); }
    else if (g.puntos >= 50) { this.sonidos.tocar('festejo'); this.festejar.set(true); }
    else this.sonidos.tocar('monedas');
    try { navigator.vibrate?.(g.tipo === 'PREMIO' ? [60, 80, 60, 80, 120] : [40]); } catch { /* opcional */ }
  }

  private contar(): void {
    const prox = this.store.ruleta()?.proximo_giro;
    if (!prox) return;
    const ms = Math.max(0, Date.parse(prox) - Date.now());
    const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
    this.faltan.set(`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
  }

  cerrar(): void {
    if (this.girando()) return;
    this.sonidos.tocar('cerrar');
    this.store.ruletaAbierta.set(false);
  }

  irACanjes(): void { this.store.ruletaAbierta.set(false); this.router.navigate(['/economiapp/premios'], { fragment: 'canjes' }); }
  irAJuegos(): void { this.store.ruletaAbierta.set(false); this.router.navigate(['/economiapp/juegos']); }

  // ── dibujo ──
  sector(i: number): string {
    const p = this.paso(), r = 150;
    const a0 = (i * p - 90) * Math.PI / 180, a1 = ((i + 1) * p - 90) * Math.PI / 180;
    const x0 = r * Math.cos(a0), y0 = r * Math.sin(a0), x1 = r * Math.cos(a1), y1 = r * Math.sin(a1);
    return `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${p > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
  }
  color(o: OpcionRuleta, i: number): string { return o.color || (i % 2 ? '#7C3AED' : '#F97316'); }
  cos(b: number): number { return Math.cos((b * 18 - 90) * Math.PI / 180); }
  sen(b: number): number { return Math.sin((b * 18 - 90) * Math.PI / 180); }
  emoji(o: OpcionRuleta): string { return this.emojiDe(o.etiqueta); }
  emojiDe(etiqueta: string | null | undefined): string {
    const e = (etiqueta || '').toLowerCase();
    if (e.includes('perro')) return '🌭';
    if (e.includes('maquill') || e.includes('esponja') || e.includes('encresp')) return '💄';
    if (e.includes('escoba') || e.includes('trapero')) return '🧹';
    return '🎁';
  }
  /** Etiqueta corta para la casilla: «Sencillo»/«Especial» para los perros, una palabra para lo demás. */
  corta(etiqueta: string): string {
    const p = etiqueta.trim().split(/\s+/);
    const palabra = /^perro$/i.test(p[0]) && p[1] ? p[1] : p[0];
    const w = palabra.charAt(0).toUpperCase() + palabra.slice(1);
    return w.length > 9 ? w.slice(0, 8) + '.' : w;
  }
}
