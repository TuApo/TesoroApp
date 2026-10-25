import { Directive, ElementRef, Input, OnChanges, OnDestroy } from '@angular/core';
import type { Track } from 'livekit-client';

/** Conecta una pista de LiveKit a un <video> y la suelta al cambiar o destruirse. */
@Directive({ selector: 'video[lkPista]', standalone: true })
export class LkPista implements OnChanges, OnDestroy {
  @Input('lkPista') pista: Track | null = null;
  private actual: Track | null = null;

  constructor(private el: ElementRef<HTMLVideoElement>) {
    el.nativeElement.muted = true;
    el.nativeElement.playsInline = true;
    el.nativeElement.autoplay = true;
  }

  ngOnChanges(): void {
    if (this.actual === this.pista) return;
    this.actual?.detach(this.el.nativeElement);
    this.actual = this.pista;
    this.pista?.attach(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.actual?.detach(this.el.nativeElement);
  }
}
