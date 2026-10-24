import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';

import { mensajeDeError } from '../../../../../../shared/utils/mensaje-error';
import { SeguridadService } from '../../services/seguridad.service';
import { SesionWebrtc, mensajeMicrofono, pedirMicrofono, publicarWhip } from '../../services/webrtc.util';

type Estado = 'listo' | 'preparando' | 'hablando' | 'error';

/** Tope de una transmisión: el token de publicación dura poco y nadie habla un minuto seguido. */
const MAXIMO_MS = 60_000;

/**
 * Pulsar para hablar (como un radio): mientras se mantiene presionado, el micrófono del
 * operador sale por el parlante de la sede.
 *
 * <p>Al presionar: pide el micrófono → `POST /parlantes/{id}/ptt` (el backend avisa al
 * parlante por SSE para que reproduzca) → publica por WHIP. Al soltar: cierra WHIP,
 * suelta el micrófono y `DELETE /parlantes/{id}/ptt`. Si se suelta antes de que todo esté
 * listo, se deshace lo que alcanzó a abrirse. Con teclado: mantener Espacio o Enter.
 */
@Component({
  selector: 'sg-ptt-boton',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="ptt" [class]="'ptt e-' + estado()" [class.compacto]="compacto()" [disabled]="!parlanteId() || deshabilitado()"
            (pointerdown)="presionar($event)" (pointerup)="soltar()" (pointercancel)="soltar()" (lostpointercapture)="soltar()"
            (keydown)="tecla($event, true)" (keyup)="tecla($event, false)" (contextmenu)="$event.preventDefault()" (blur)="soltar()"
            [attr.aria-pressed]="estado() === 'hablando'" [attr.aria-label]="textoAccesible()" [matTooltip]="error() ?? ''">
      <mat-icon aria-hidden="true">{{ estado() === 'hablando' ? 'mic' : estado() === 'error' ? 'mic_off' : 'settings_voice' }}</mat-icon>
      <span class="txt">{{ texto() }}</span>
      @if (estado() === 'hablando') { <span class="seg sg-mono">{{ segundos() }} s</span> }
    </button>
    @if (error() && !compacto()) { <small class="err" role="alert">{{ error() }}</small> }
  `,
  styles: [`
    :host { display: inline-flex; flex-direction: column; gap: 4px; max-width: 100%; }
    .ptt { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px !important; padding: 8px 18px;
      border-radius: 999px; border: 2px solid var(--brand-blue); background: var(--surface); color: var(--brand-blue);
      font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none;
      transition: background .12s, color .12s, transform .08s; }
    .ptt.compacto { min-height: 36px !important; padding: 4px 12px; font-size: 12.5px; }
    .ptt:focus-visible { outline: none; box-shadow: var(--ring); }
    .ptt:disabled { opacity: .5; cursor: default; }
    .ptt.e-preparando { background: var(--warn-bg); border-color: var(--warn-fg); color: var(--warn-fg); }
    .ptt.e-hablando { background: #d0302f; border-color: #d0302f; color: #fff; transform: scale(1.03); box-shadow: 0 0 0 6px rgb(208 48 47 / .2); }
    .ptt.e-error { border-color: var(--danger-fg); color: var(--danger-fg); }
    .seg { font-size: 12px; opacity: .9; }
    .err { font-size: 11.5px; color: var(--danger-fg); max-width: 320px; }
    @media (prefers-reduced-motion: reduce) { .ptt { transition: none; } .ptt.e-hablando { transform: none; } }
  `],
})
export class PttBoton {
  private readonly api = inject(SeguridadService);

  readonly parlanteId = input<string | null>(null);
  readonly etiqueta = input('Mantener para hablar');
  readonly compacto = input(false);
  readonly deshabilitado = input(false);

  readonly estado = signal<Estado>('listo');
  readonly error = signal<string | null>(null);
  readonly segundos = signal(0);

  readonly texto = computed(() => {
    switch (this.estado()) {
      case 'preparando': return 'Abriendo micrófono…';
      case 'hablando': return 'Hablando… suelte para terminar';
      default: return this.etiqueta();
    }
  });
  readonly textoAccesible = computed(() => `${this.etiqueta()} (mantenga presionado; con teclado, mantenga Espacio)`);

  private gen = 0;
  private sesion: SesionWebrtc | null = null;
  private mic: MediaStream | null = null;
  private pttAbierto: string | null = null;
  private reloj: ReturnType<typeof setInterval> | null = null;
  private tope: ReturnType<typeof setTimeout> | null = null;
  private presionado = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.soltar());
  }

  presionar(ev: PointerEvent): void {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    ev.preventDefault();
    try { (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); } catch { /* nada */ }
    void this.empezar();
  }

  tecla(ev: KeyboardEvent, abajo: boolean): void {
    if (ev.key !== ' ' && ev.key !== 'Enter') return;
    ev.preventDefault();
    if (abajo) { if (!ev.repeat) void this.empezar(); } else this.soltar();
  }

  private async empezar(): Promise<void> {
    const id = this.parlanteId();
    if (!id || this.presionado) return;
    this.presionado = true;
    const g = ++this.gen;
    this.error.set(null);
    this.estado.set('preparando');
    try {
      const mic = await pedirMicrofono();
      if (g !== this.gen) { mic.getTracks().forEach((t) => t.stop()); return; }
      this.mic = mic;
      const ses = await firstValueFrom(this.api.iniciarPtt(id));
      this.pttAbierto = id;
      if (g !== this.gen) { this.limpiar(); return; }
      if (!ses.whip_url) throw new Error('El servidor no entregó la dirección de publicación.');
      const s = await publicarWhip(ses.whip_url, ses.token, mic, { timeoutMs: 8000 });
      if (g !== this.gen) { s.cerrar(); this.limpiar(); return; }
      this.sesion = s;
      this.mic = null; // ahora lo suelta la sesión al cerrar
      this.estado.set('hablando');
      this.segundos.set(0);
      this.reloj = setInterval(() => this.segundos.update((x) => x + 1), 1000);
      this.tope = setTimeout(() => this.soltar(), MAXIMO_MS);
    } catch (e) {
      if (g !== this.gen) return;
      const n = (e as { name?: string })?.name;
      this.error.set(n && /NotAllowed|NotFound|NotReadable|Security/.test(n) ? mensajeMicrofono(e)
        : (e as { status?: number })?.status ? mensajeDeError(e, 'No se pudo abrir el canal de voz.')
        : (e as Error)?.message || 'No se pudo abrir el canal de voz.');
      this.estado.set('error');
      this.limpiar(true);
      this.presionado = false;
    }
  }

  soltar(): void {
    if (!this.presionado) return;
    this.presionado = false;
    this.gen++;
    this.limpiar();
    if (this.estado() !== 'error') this.estado.set('listo');
  }

  private limpiar(conservarEstado = false): void {
    if (this.reloj) { clearInterval(this.reloj); this.reloj = null; }
    if (this.tope) { clearTimeout(this.tope); this.tope = null; }
    this.sesion?.cerrar();
    this.sesion = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    if (this.pttAbierto) {
      this.api.terminarPtt(this.pttAbierto).subscribe({ error: () => {} });
      this.pttAbierto = null;
    }
    if (!conservarEstado && this.estado() === 'hablando') this.estado.set('listo');
  }
}
