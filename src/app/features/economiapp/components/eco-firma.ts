import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, input, output, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * Firma a mano alzada en pantalla (dedo, lápiz o mouse). Entrega un PNG con fondo blanco.
 * El trazo se escala al tamaño real del lienzo para que no salga pixelado en el celular.
 */
@Component({
  selector: 'eco-firma',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="marco" [class.vacio]="vacio()">
      <canvas #lienzo (pointerdown)="empezar($event)" (pointermove)="mover($event)" (pointerup)="terminar()" (pointerleave)="terminar()" (pointercancel)="terminar()"></canvas>
      @if (vacio()) { <span class="guia">{{ texto() }}</span> }
      <span class="linea"></span>
    </div>
    <div class="pie">
      <small>{{ pie() }}</small>
      <button type="button" class="limpiar" (click)="limpiar()" [disabled]="vacio()"><mat-icon>backspace</mat-icon> Borrar</button>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .marco { position: relative; height: 180px; border: 1px dashed var(--border, #cbd5e1); border-radius: 14px; background: #fff; overflow: hidden; touch-action: none; }
    canvas { width: 100%; height: 100%; display: block; cursor: crosshair; }
    .guia { position: absolute; inset: 0; display: grid; place-items: center; color: #94a3b8; font-size: 14px; pointer-events: none; }
    .linea { position: absolute; left: 16px; right: 16px; bottom: 36px; border-bottom: 1px solid #cbd5e1; pointer-events: none; }
    .pie { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 4px; }
    .pie small { color: var(--muted, #64748b); font-size: 12px; }
    .limpiar { display: inline-flex; align-items: center; gap: 4px; border: 0; background: none; color: var(--muted, #64748b); cursor: pointer; font: inherit; font-size: 13px; min-height: 36px; }
    .limpiar mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `],
})
export class EcoFirma {
  readonly texto = input('Firme aquí');
  readonly pie = input('');
  /** Cada trazo terminado emite la firma completa (PNG). Al borrar emite null. */
  readonly firma = output<Blob | null>();
  readonly vacio = signal(true);
  private readonly lienzo = viewChild.required<ElementRef<HTMLCanvasElement>>('lienzo');
  private dibujando = false;
  private ctx?: CanvasRenderingContext2D;

  constructor() {
    afterNextRender(() => this.preparar());
  }

  private preparar(): void {
    const c = this.lienzo().nativeElement;
    const r = c.getBoundingClientRect(), dpr = Math.max(1, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    this.ctx = c.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.ctx.fillStyle = '#fff'; this.ctx.fillRect(0, 0, r.width, r.height);
    this.ctx.lineWidth = 2.4; this.ctx.lineCap = 'round'; this.ctx.lineJoin = 'round'; this.ctx.strokeStyle = '#0f172a';
  }

  private punto(e: PointerEvent) {
    const r = this.lienzo().nativeElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  empezar(e: PointerEvent): void {
    if (!this.ctx) this.preparar();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.dibujando = true;
    const p = this.punto(e);
    this.ctx!.beginPath(); this.ctx!.moveTo(p.x, p.y);
  }
  mover(e: PointerEvent): void {
    if (!this.dibujando) return;
    const p = this.punto(e);
    this.ctx!.lineTo(p.x, p.y); this.ctx!.stroke();
    if (this.vacio()) this.vacio.set(false);
  }
  terminar(): void {
    if (!this.dibujando) return;
    this.dibujando = false;
    if (!this.vacio()) this.lienzo().nativeElement.toBlob(b => this.firma.emit(b), 'image/png');
  }
  limpiar(): void {
    const c = this.lienzo().nativeElement;
    this.ctx?.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx?.clearRect(0, 0, c.width, c.height);
    this.preparar();
    this.vacio.set(true);
    this.firma.emit(null);
  }
}
