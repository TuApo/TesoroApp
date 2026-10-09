import {
  ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, untracked, viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { BannerItem, MedioBanner, Orientacion } from './carrusel.models';
import { CarruselService } from './carrusel.service';

/**
 * Un banner pintado: el medio (imagen o video) y, según el diseño, el texto encima.
 *
 * Es PRESENTACIONAL a propósito: lo usa el carrusel del home y lo usa la vista previa del
 * editor de Marketing. Si fueran dos componentes, la vista previa acabaría mintiendo —
 * mostraría algo que el home ya no pinta igual— y eso solo se descubre en producción.
 */
@Component({
  selector: 'app-banner-slide',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './banner-slide.component.html',
  styleUrl: './banner-slide.component.css',
})
export class BannerSlideComponent {
  private readonly carrusel = inject(CarruselService);

  readonly item = input.required<BannerItem>();
  readonly orientacion = input<Orientacion>('HORIZONTAL');
  /** Solo el slide activo reproduce su video. */
  readonly activo = input(true);
  readonly silenciado = input(true);
  /** Para {{nombre}} en el texto ("¡Feliz cumpleaños, {{nombre}}!"). */
  readonly nombreUsuario = input('');
  /** En la vista previa del editor el medio puede ser un archivo local (blob:). */
  readonly urlLocal = input<string | null>(null);
  /** Miniatura (lista, simulador, plantillas): sin botón de ocultar. */
  readonly miniatura = input(false);

  readonly cta = output<void>();
  readonly videoTerminado = output<void>();
  readonly ocultar = output<void>();

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  readonly medio = computed<MedioBanner | null>(() => {
    const it = this.item();
    return this.orientacion() === 'VERTICAL' ? (it.vertical ?? it.horizontal) : (it.horizontal ?? it.vertical);
  });

  readonly src = computed(() => this.urlLocal() || this.carrusel.urlMedio(this.medio()?.url));
  readonly esVideo = computed(() => this.medio()?.tipo === 'VIDEO');
  readonly soloMedia = computed(() => this.item().diseno === 'SOLO_MEDIA');

  readonly titulo = computed(() => this.rellenar(this.item().titulo));
  readonly subtitulo = computed(() => this.rellenar(this.item().subtitulo));
  readonly etiqueta = computed(() => this.rellenar(this.item().etiqueta));
  readonly alt = computed(() =>
    this.rellenar(this.item().texto_alternativo) || this.titulo() || this.rellenar(this.item().descripcion) || 'Banner');

  readonly hayCta = computed(() => {
    const it = this.item();
    return it.destino?.tipo && it.destino.tipo !== 'NINGUNO' && !!it.cta_texto;
  });

  /** Variables de color y velo como custom properties: el CSS decide el resto. */
  readonly estilo = computed(() => {
    const it = this.item();
    return {
      '--b-fondo': it.color_fondo || '#0f172a',
      '--b-texto': it.color_texto || '#ffffff',
      '--b-acento': it.color_acento || '#f59e0b',
      '--b-velo': String(Math.max(0, Math.min(90, it.oscurecer ?? 45)) / 100),
    } as Record<string, string>;
  });

  constructor() {
    // El video activo se reproduce desde el principio; el que deja de estarlo se para. Un
    // video que sigue sonando (o gastando datos) en un slide oculto es lo peor que puede
    // hacer un carrusel en un celular.
    effect(() => {
      const el = this.video()?.nativeElement;
      const activo = this.activo();
      const src = this.src();
      if (!el || !src) return;
      // Sin silenciar no hay autoplay en ningún navegador: se fuerza ANTES de play().
      el.muted = untracked(() => this.silenciado());
      if (activo) {
        el.currentTime = 0;
        el.play().catch(() => { /* autoplay bloqueado: queda el primer cuadro */ });
      } else {
        el.pause();
      }
    });
    // Aparte: activar el sonido no debe reiniciar el video.
    effect(() => {
      const el = this.video()?.nativeElement;
      const silenciado = this.silenciado();
      if (el) el.muted = silenciado;
    });
  }

  /**
   * {{nombre}} con el primer nombre de la sesión; cualquier otra variable que el backend
   * no rellenó se borra en vez de imprimir llaves en el home de alguien.
   */
  private rellenar(texto: string | null | undefined): string {
    if (!texto) return '';
    const nombre = this.nombreUsuario();
    return texto
      .replace(/\{\{\s*nombre\s*\}\}/gi, nombre)
      .replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, '')
      .replace(/\s+([,.!?])/g, '$1')
      .replace(/,\s*!/g, '!')
      .trim();
  }

  alTerminarVideo(): void {
    this.videoTerminado.emit();
  }
}
