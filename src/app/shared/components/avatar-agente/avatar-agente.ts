import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, inject, input } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { EstadoAvatar, Personaje } from './avatar-agente.modelos';
import { AvatarAgenteService } from './avatar-agente.service';

/**
 * La cara de un personaje de Avatar Agent. Con clips pinta el video en bucle (reposo o
 * hablando); sin clips, el retrato; sin retrato, sus iniciales sobre sus colores. Mientras la IA
 * piensa gira un aro con su color y mientras habla el borde late con el volumen de la voz.
 *
 * Sin `mask-image` ni `backdrop-filter`: en el WebView de Android dejan texto fantasma.
 * Con `prefers-reduced-motion` no se reproduce video: queda el retrato.
 */
@Component({
  selector: 'app-avatar-agente',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--av-tam.px]': 'tam()',
    '[style.--av-c1]': 'personaje().colorPrimario || "#4F46E5"',
    '[style.--av-c2]': 'personaje().colorSecundario || "#C7D2FE"',
    '[style.--av-nivel]': 'nivel()',
    '[class.av--pensando]': 'estado() === "pensando"',
    '[class.av--hablando]': 'estado() === "hablando"',
    '[attr.title]': 'conTitulo() ? personaje().nombre + " · " + personaje().cargo : null',
    role: 'img',
    '[attr.aria-label]': 'etiqueta()',
  },
  template: `
    <span class="av-marco">
      @if (video(); as v) {
        <video class="av-medio" [src]="v" [attr.poster]="medios().retrato" autoplay loop muted playsinline disablepictureinpicture
               aria-hidden="true"></video>
      } @else if (medios().retrato; as r) {
        <img class="av-medio av-medio--quieto" [src]="r" alt="" loading="lazy" decoding="async">
      } @else {
        <span class="av-iniciales" aria-hidden="true">{{ iniciales() }}</span>
      }
    </span>
    @if (insignia() && personaje().icono) {
      <span class="av-insignia" aria-hidden="true"><mat-icon>{{ personaje().icono }}</mat-icon></span>
    }
  `,
  styles: [`
    :host {
      position: relative; display: inline-flex; flex: 0 0 auto;
      width: var(--av-tam); height: var(--av-tam); border-radius: 50%; line-height: 0;
      isolation: isolate;
    }
    .av-marco {
      position: relative; display: block; width: 100%; height: 100%; border-radius: 50%; overflow: hidden;
      background: radial-gradient(circle at 30% 25%, var(--av-c2), var(--av-c1));
      box-shadow: 0 0 0 2px var(--av-c1), 0 2px 6px rgb(0 0 0 / .18);
      transition: box-shadow .12s linear;
    }
    .av-medio { width: 100%; height: 100%; object-fit: cover; display: block; }
    .av-medio--quieto { animation: av-respirar 4.5s ease-in-out infinite; transform-origin: 50% 80%; }
    .av-iniciales {
      display: grid; place-items: center; width: 100%; height: 100%;
      color: #fff; font-weight: 800; font-size: calc(var(--av-tam) * .38); letter-spacing: -.02em;
      text-shadow: 0 1px 2px rgb(0 0 0 / .25); line-height: 1;
      animation: av-respirar 4.5s ease-in-out infinite;
    }
    .av-insignia {
      position: absolute; right: -2px; bottom: -2px; z-index: 1;
      display: grid; place-items: center; width: calc(var(--av-tam) * .38); height: calc(var(--av-tam) * .38);
      min-width: 14px; min-height: 14px; border-radius: 50%;
      background: var(--av-c1); color: #fff; box-shadow: 0 0 0 2px var(--surface, #fff);
    }
    .av-insignia mat-icon { width: auto; height: auto; font-size: calc(var(--av-tam) * .24); line-height: 1; }
    :host(.av--pensando) .av-marco::after {
      content: ''; position: absolute; inset: 0; border-radius: 50%;
      border: 3px solid transparent; border-top-color: #fff; border-right-color: var(--av-c2);
      animation: av-girar 1s linear infinite;
    }
    :host(.av--hablando) .av-marco {
      box-shadow: 0 0 0 calc(2px + var(--av-nivel, 0) * 5px) var(--av-c1), 0 2px 10px rgb(0 0 0 / .22);
    }
    @keyframes av-respirar { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.035); } }
    @keyframes av-girar { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .av-medio--quieto, .av-iniciales, :host(.av--pensando) .av-marco::after { animation: none; }
    }
  `],
})
export class AvatarAgente {
  private avatares = inject(AvatarAgenteService);
  private navegador = isPlatformBrowser(inject(PLATFORM_ID));
  private quieto = this.navegador && typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  readonly personaje = input.required<Personaje>();
  readonly tam = input(40);
  readonly estado = input<EstadoAvatar>('reposo');
  /** Volumen de la voz (0..1) mientras habla. */
  readonly nivel = input(0);
  /** Animar con los clips (en listas largas conviene el retrato quieto). */
  readonly animado = input(true);
  readonly insignia = input(false);
  readonly conTitulo = input(true);

  private readonly fuentes = computed(() => this.avatares.medios(this.personaje()));
  readonly medios = computed(() => this.fuentes()());

  readonly video = computed(() => {
    if (!this.animado() || this.quieto || !this.navegador) return null;
    const m = this.medios();
    return this.estado() === 'hablando' ? (m.hablando ?? m.idle) : m.idle;
  });

  readonly iniciales = computed(() => {
    const n = this.personaje().nombreCorto || this.personaje().nombre || '?';
    if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+IA$/.test(n)) return 'IA';
    const partes = n.replace(/^(Don|Doña)\s+/, '').split(/\s+/).filter(Boolean);
    return (partes.length > 1 ? partes[0][0] + partes[1][0] : n.slice(0, 2)).toUpperCase();
  });

  readonly etiqueta = computed(() => {
    const p = this.personaje();
    const sufijo = this.estado() === 'pensando' ? ' está pensando' : this.estado() === 'hablando' ? ' está hablando' : '';
    return `${p.nombre}, ${p.cargo}${sufijo}`;
  });
}
