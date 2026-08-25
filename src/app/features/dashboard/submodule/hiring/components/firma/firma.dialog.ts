import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, signal, ViewChild,
} from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { SharedModule } from '@/app/shared/shared.module';

/**
 * Firma manuscrita sobre un lienzo propio.
 *
 * Sin librería y con pointer events: en el mostrador se firma con el dedo en
 * una tablet, con el ratón en un escritorio y a veces con lápiz óptico, y
 * `pointerdown/move/up` cubre los tres sin ramas por dispositivo.
 *
 * El lienzo se dimensiona por `devicePixelRatio`: a 1x el trazo sale pixelado
 * en pantallas retina y una firma borrosa no sirve para un contrato.
 */
@Component({
  selector: 'app-firma-dialog',
  standalone: true,
  imports: [SharedModule, MatDialogModule, MatIconModule],
  templateUrl: './firma.dialog.html',
  styleUrls: ['./firma.dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FirmaDialogComponent implements AfterViewInit {
  private readonly ref = inject<MatDialogRef<FirmaDialogComponent, File | undefined>>(MatDialogRef);

  @ViewChild('lienzo') private lienzo?: ElementRef<HTMLCanvasElement>;

  /** Hay trazo: sin esto se podría guardar una firma en blanco. */
  readonly firmado = signal(false);

  private ctx: CanvasRenderingContext2D | null = null;
  private trazando = false;

  ngAfterViewInit(): void {
    this.preparar();
  }

  private preparar(): void {
    const c = this.lienzo?.nativeElement;
    if (!c) return;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    const ancho = c.clientWidth || 560;
    const alto = c.clientHeight || 200;
    c.width = Math.round(ancho * dpr);
    c.height = Math.round(alto * dpr);

    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#21263C';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ancho, alto);
    this.ctx = ctx;
  }

  private punto(ev: PointerEvent): { x: number; y: number } {
    const r = (ev.target as HTMLCanvasElement).getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  alBajar(ev: PointerEvent): void {
    if (!this.ctx) return;
    ev.preventDefault();
    // Captura el puntero: si el dedo se sale del lienzo a media firma, el
    // trazo se corta y hay que volver a empezar.
    (ev.target as HTMLCanvasElement).setPointerCapture(ev.pointerId);
    const p = this.punto(ev);
    this.ctx.beginPath();
    this.ctx.moveTo(p.x, p.y);
    this.trazando = true;
    this.firmado.set(true);
  }

  alMover(ev: PointerEvent): void {
    if (!this.trazando || !this.ctx) return;
    ev.preventDefault();
    const p = this.punto(ev);
    this.ctx.lineTo(p.x, p.y);
    this.ctx.stroke();
  }

  alSoltar(ev: PointerEvent): void {
    if (!this.trazando) return;
    this.trazando = false;
    try { (ev.target as HTMLCanvasElement).releasePointerCapture(ev.pointerId); } catch { /* ya soltado */ }
  }

  limpiar(): void {
    this.preparar();
    this.firmado.set(false);
  }

  guardar(): void {
    const c = this.lienzo?.nativeElement;
    if (!c || !this.firmado()) return;
    c.toBlob((blob) => {
      if (!blob) return;
      this.ref.close(new File([blob], 'firma.png', { type: 'image/png' }));
    }, 'image/png');
  }

  cancelar(): void {
    this.ref.close();
  }
}
