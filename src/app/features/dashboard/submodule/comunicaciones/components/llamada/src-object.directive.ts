import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import { DispositivosService } from '../../service/dispositivos.service';

/** Conecta un MediaStream a un <video>/<audio> (srcObject no se puede enlazar como atributo). */
@Directive({ selector: '[comSrcObject]' })
export class SrcObjectDirective {
  private readonly el = inject<ElementRef<HTMLMediaElement>>(ElementRef).nativeElement;
  private readonly disp = inject(DispositivosService);
  readonly comSrcObject = input<MediaStream | null>(null);
  /** Cambia cuando llega una pista nueva al mismo stream: fuerza a reproducir de nuevo. */
  readonly version = input<number>(0);
  /** Salida de audio elegida (deviceId; "" = la del sistema). Solo para lo que suena: null = no tocar. */
  readonly salida = input<string | null>(null);

  constructor() {
    effect(() => {
      const s = this.comSrcObject();
      this.version();
      if (this.el.srcObject !== s) this.el.srcObject = s;
      if (s) void this.el.play().catch(() => undefined);
    });
    effect(() => {
      const id = this.salida();
      if (id !== null) void this.disp.aplicarSalida(this.el, id);
    });
  }
}
