import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, afterNextRender, computed, effect, input, model, output, signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { Poligono, Punto } from '../models/salon.models';

export type CapaPoligono = 'mesa' | 'personal';

/**
 * Editor de polígonos sobre el fotograma de la cámara. Dos capas: la mesa (obligatoria,
 * ≥ 3 puntos) y la «zona del personal» (opcional, donde ver a un mesero reinicia el
 * cronómetro de atención).
 *
 * <p>Interacción: clic/toque añade un vértice a la capa activa mientras está abierta;
 * arrastrar un vértice lo mueve; «Cerrar» termina la figura (o clic sobre el primer punto);
 * Supr/Retroceso quita el último vértice. Todo en coordenadas normalizadas 0..1 respecto al
 * fotograma, así da igual la resolución del substream con que calibre el worker.
 */
@Component({
  selector: 'app-editor-poligono',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="ed-barra" role="toolbar" aria-label="Herramientas del polígono">
      <button type="button" class="ed-capa" [attr.aria-pressed]="capa() === 'mesa'" (click)="capa.set('mesa')"><span class="ed-punto ed-punto--mesa"></span>Mesa ({{ poligono().length }})</button>
      <button type="button" class="ed-capa" [attr.aria-pressed]="capa() === 'personal'" (click)="capa.set('personal')"><span class="ed-punto ed-punto--personal"></span>Zona del personal ({{ zonaPersonal()?.length ?? 0 }})</button>
      <span class="ed-esp"></span>
      <button type="button" class="ed-btn" (click)="cerrar()" [disabled]="puntosActivos().length < 3 || cerrada()" title="Cerrar la figura"><mat-icon>check</mat-icon>Cerrar</button>
      <button type="button" class="ed-btn" (click)="deshacer()" [disabled]="!puntosActivos().length" title="Quitar el último punto"><mat-icon>undo</mat-icon></button>
      <button type="button" class="ed-btn" (click)="limpiar()" [disabled]="!puntosActivos().length" title="Borrar la capa"><mat-icon>delete_sweep</mat-icon></button>
      <button type="button" class="ed-btn" (click)="proponer.emit()" [disabled]="!puedeProponer()" title="Que la visión proponga la mesa sobre el cuadro actual"><mat-icon>auto_awesome</mat-icon>Proponer automáticamente</button>
    </div>
    <div #lienzo class="ed-lienzo" [class.ed-lienzo--sin-imagen]="!imagenUrl()" tabindex="0" (keydown)="tecla($event)"
      (pointerdown)="abajo($event)" (pointermove)="mover($event)" (pointerup)="arriba($event)" (pointercancel)="arriba($event)" (dblclick)="cerrar()">
      @if (imagenUrl(); as url) {
        <img [src]="url" alt="Fotograma de la cámara" draggable="false" (load)="redibujar()" />
      } @else {
        <div class="ed-vacio"><mat-icon>videocam_off</mat-icon><span>Sin fotograma: comprueba la cámara.</span></div>
      }
      <canvas #canvas></canvas>
    </div>
    <p class="ed-ayuda">Clic para añadir puntos · arrastra un vértice para moverlo · doble clic o «Cerrar» para terminar · Supr quita el último.</p>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .ed-barra { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
    .ed-esp { flex: 1; }
    .ed-capa, .ed-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 12px; border-radius: 999px; border: 2px solid var(--border-strong);
      background: var(--surface); color: var(--text); font: 700 .88rem var(--font-sans); cursor: pointer; }
    .ed-capa[aria-pressed='true'] { border-color: var(--primary); background: var(--blue-soft); color: var(--primary); }
    :host-context(html[data-theme='dark']) .ed-capa[aria-pressed='true'] { background: var(--info-bg); color: var(--info-fg); }
    .ed-btn:disabled { opacity: .45; cursor: not-allowed; }
    .ed-btn mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .ed-punto { width: 12px; height: 12px; border-radius: 50%; }
    .ed-punto--mesa { background: var(--mesa-ocupada, #DC2626); }
    .ed-punto--personal { background: var(--mesa-reservada, #2563EB); }
    .ed-lienzo { position: relative; width: 100%; max-width: 1280px; aspect-ratio: 16 / 9; background: var(--surface-4); border-radius: var(--r-md); overflow: hidden;
      touch-action: none; user-select: none; cursor: crosshair; outline: none; }
    .ed-lienzo:focus-visible { box-shadow: var(--ring); }
    .ed-lienzo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block; }
    .ed-lienzo canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    .ed-vacio { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--muted); font-weight: 700; }
    .ed-vacio mat-icon { font-size: 44px; width: 44px; height: 44px; }
    .ed-ayuda { margin: 6px 0 0; color: var(--muted); font-size: .8rem; }
  `],
})
export class EditorPoligono implements OnDestroy {
  /** URL (blob u http) del fotograma. */
  readonly imagenUrl = input<string | null>(null);
  readonly poligono = model<Poligono>([]);
  readonly zonaPersonal = model<Poligono | null>(null);
  readonly puedeProponer = input(true);
  /** Otros polígonos de la misma cámara, para verlos de fondo y no pisarlos. */
  readonly otros = input<Array<{ nombre: string; poligono: Poligono }>>([]);
  readonly proponer = output<void>();

  readonly capa = signal<CapaPoligono>('mesa');
  /** Figura terminada en la capa activa (ya no se añaden puntos; sí se arrastran). */
  private cerradas = signal<Record<CapaPoligono, boolean>>({ mesa: false, personal: false });
  readonly cerrada = computed(() => this.cerradas()[this.capa()]);
  readonly puntosActivos = computed<Poligono>(() => this.capa() === 'mesa' ? this.poligono() : (this.zonaPersonal() ?? []));

  private lienzo = viewChild.required<ElementRef<HTMLDivElement>>('lienzo');
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private arrastrando: { capa: CapaPoligono; indice: number } | null = null;
  private observador: ResizeObserver | null = null;

  constructor() {
    effect(() => { this.poligono(); this.zonaPersonal(); this.capa(); this.otros(); this.imagenUrl(); this.redibujar(); });
    afterNextRender(() => {
      this.observador = new ResizeObserver(() => this.redibujar());
      this.observador.observe(this.lienzo().nativeElement);
      this.redibujar();
    });
  }

  ngOnDestroy(): void { this.observador?.disconnect(); }

  /** Reemplaza la capa de mesa con una propuesta (la figura queda cerrada). */
  aplicarPropuesta(p: Poligono): void {
    this.poligono.set(p.map(([x, y]) => [acotar(x), acotar(y)] as Punto));
    this.capa.set('mesa');
    this.cerradas.update(c => ({ ...c, mesa: true }));
  }

  /** Carga un polígono existente (al elegir otra mesa). */
  cargar(mesa: Poligono, personal: Poligono | null): void {
    this.poligono.set(mesa);
    this.zonaPersonal.set(personal);
    this.cerradas.set({ mesa: mesa.length >= 3, personal: (personal?.length ?? 0) >= 3 });
    this.capa.set('mesa');
  }

  cerrar(): void {
    if (this.puntosActivos().length < 3) return;
    this.cerradas.update(c => ({ ...c, [this.capa()]: true }));
  }
  deshacer(): void {
    this.escribir(this.puntosActivos().slice(0, -1));
    this.cerradas.update(c => ({ ...c, [this.capa()]: false }));
  }
  limpiar(): void {
    this.escribir([]);
    this.cerradas.update(c => ({ ...c, [this.capa()]: false }));
  }

  tecla(ev: KeyboardEvent): void {
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.deshacer(); }
    if (ev.key === 'Enter') { ev.preventDefault(); this.cerrar(); }
  }

  // ── punteros ─────────────────────────────────────────────────────────────
  abajo(ev: PointerEvent): void {
    if (!this.imagenUrl()) return;
    this.lienzo().nativeElement.focus();
    const p = this.aNormalizado(ev);
    // ¿Toca un vértice de la capa activa? → arrastrar.
    const idx = this.vérticeCerca(this.puntosActivos(), p);
    if (idx >= 0) {
      // Clic sobre el primer punto con ≥ 3 puntos cierra la figura.
      if (idx === 0 && !this.cerrada() && this.puntosActivos().length >= 3) { this.cerrar(); return; }
      this.arrastrando = { capa: this.capa(), indice: idx };
      this.lienzo().nativeElement.setPointerCapture(ev.pointerId);
      return;
    }
    if (this.cerrada()) return;
    this.escribir([...this.puntosActivos(), p]);
  }
  mover(ev: PointerEvent): void {
    if (!this.arrastrando) return;
    const p = this.aNormalizado(ev);
    const lista = this.arrastrando.capa === 'mesa' ? this.poligono() : (this.zonaPersonal() ?? []);
    const nueva = lista.map((q, i) => (i === this.arrastrando!.indice ? p : q));
    if (this.arrastrando.capa === 'mesa') this.poligono.set(nueva); else this.zonaPersonal.set(nueva);
  }
  arriba(ev: PointerEvent): void {
    if (!this.arrastrando) return;
    try { this.lienzo().nativeElement.releasePointerCapture(ev.pointerId); } catch { /* ya liberado */ }
    this.arrastrando = null;
  }

  private escribir(p: Poligono): void {
    if (this.capa() === 'mesa') this.poligono.set(p); else this.zonaPersonal.set(p.length ? p : null);
  }

  /** Rectángulo que ocupa la imagen dentro del lienzo (object-fit: contain). */
  private marco(): { x: number; y: number; w: number; h: number } {
    const el = this.lienzo().nativeElement;
    const W = el.clientWidth, H = el.clientHeight;
    const img = el.querySelector('img');
    const iw = img?.naturalWidth || 16, ih = img?.naturalHeight || 9;
    const escala = Math.min(W / iw, H / ih);
    const w = iw * escala, h = ih * escala;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }
  private aNormalizado(ev: PointerEvent): Punto {
    const r = this.lienzo().nativeElement.getBoundingClientRect();
    const m = this.marco();
    return [acotar((ev.clientX - r.left - m.x) / m.w), acotar((ev.clientY - r.top - m.y) / m.h)];
  }
  private vérticeCerca(lista: Poligono, p: Punto): number {
    const m = this.marco();
    const tol = 12; // px
    for (let i = 0; i < lista.length; i++) {
      const dx = (lista[i][0] - p[0]) * m.w, dy = (lista[i][1] - p[1]) * m.h;
      if (Math.hypot(dx, dy) <= tol) return i;
    }
    return -1;
  }

  redibujar(): void {
    const c = this.canvas()?.nativeElement;
    const el = this.lienzo()?.nativeElement;
    if (!c || !el) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, el.clientWidth * dpr);
    c.height = Math.max(1, el.clientHeight * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, el.clientWidth, el.clientHeight);
    const m = this.marco();
    const aPx = ([x, y]: Punto): [number, number] => [m.x + x * m.w, m.y + y * m.h];
    const estilos = getComputedStyle(el);
    const colorMesa = estilos.getPropertyValue('--mesa-ocupada').trim() || '#DC2626';
    const colorPersonal = estilos.getPropertyValue('--mesa-reservada').trim() || '#2563EB';

    const trazar = (lista: Poligono, color: string, activa: boolean, cerrada: boolean, etiqueta?: string) => {
      if (!lista.length) return;
      g.lineWidth = activa ? 3 : 1.5;
      g.strokeStyle = color;
      g.fillStyle = color + (activa ? '33' : '1A');
      g.setLineDash(activa || cerrada ? [] : [6, 4]);
      g.beginPath();
      lista.forEach((p, i) => { const [x, y] = aPx(p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      if (cerrada || lista.length >= 3) g.closePath();
      if (lista.length >= 3) g.fill();
      g.stroke();
      g.setLineDash([]);
      if (activa) {
        lista.forEach((p, i) => {
          const [x, y] = aPx(p);
          g.beginPath(); g.arc(x, y, i === 0 ? 7 : 5, 0, Math.PI * 2);
          g.fillStyle = i === 0 ? '#fff' : color; g.fill();
          g.lineWidth = 2; g.strokeStyle = color; g.stroke();
        });
      }
      if (etiqueta && lista.length) {
        const [x, y] = aPx(lista[0]);
        g.font = '700 12px sans-serif';
        g.fillStyle = color;
        g.fillText(etiqueta, x + 8, y - 6);
      }
    };

    for (const o of this.otros()) trazar(o.poligono, '#9AA8BC', false, true, o.nombre);
    const capa = this.capa();
    const cerr = this.cerradas();
    if (capa === 'mesa') {
      trazar(this.zonaPersonal() ?? [], colorPersonal, false, cerr.personal);
      trazar(this.poligono(), colorMesa, true, cerr.mesa);
    } else {
      trazar(this.poligono(), colorMesa, false, cerr.mesa);
      trazar(this.zonaPersonal() ?? [], colorPersonal, true, cerr.personal);
    }
  }
}

function acotar(v: number): number { return Math.min(1, Math.max(0, Math.round(v * 10000) / 10000)); }
