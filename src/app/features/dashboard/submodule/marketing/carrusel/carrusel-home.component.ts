import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject,
  input, signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { BannerItem, Orientacion } from './carrusel.models';
import { CarruselService } from './carrusel.service';
import { BannerSlideComponent } from './banner-slide.component';
import { getLocalStorageItem, setLocalStorageItem } from '@/app/core/utils/safe-storage';

/** Cuántos banners trajo la última vez: decide si se pinta el esqueleto mientras carga. */
const CLAVE_ULTIMO = 'mk.carrusel.ultimo';
/** Vistas ya apuntadas en esta sesión del navegador (una por banner y sesión). */
const CLAVE_VISTAS = 'mk.carrusel.vistas';

/**
 * El carrusel del home. Lo primero que ve cualquier persona al entrar.
 *
 * Reglas que no son obvias:
 * - **Sin banners, no ocupa sitio.** Ni un hueco ni un esqueleto que luego se colapsa: el
 *   esqueleto solo se pinta si la última visita sí trajo banners.
 * - **Horizontal o vertical lo decide la pantalla**, no el dispositivo: un celular girado
 *   ve la horizontal y una tableta vertical ve la vertical. Por eso Marketing tiene que
 *   subir las dos.
 * - **Se para** al pasar el mouse, al enfocarlo con el teclado, con la pestaña oculta y si
 *   la persona pidió reducir el movimiento (WCAG 2.2.2: contenido que se mueve solo debe
 *   poder pausarse, y hay botón para eso).
 * - **Un video avanza cuando termina**, no a los N segundos: cortarlo a la mitad es
 *   desperdiciar el único medio que alguien se tomó el trabajo de grabar.
 * - **La vista se apunta cuando se ve de verdad**: slide activo, carrusel en pantalla al
 *   menos a la mitad y pestaña visible. Una vez por banner y sesión.
 */
@Component({
  selector: 'app-carrusel-home',
  standalone: true,
  imports: [MatIconModule, BannerSlideComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './carrusel-home.component.html',
  styleUrl: './carrusel-home.component.css',
  host: { '(document:keydown.escape)': 'detalle() && cerrarDetalle()' },
})
export class CarruselHomeComponent implements OnInit, AfterViewInit {
  private readonly api = inject(CarruselService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  /** Dónde se está mostrando (el backend filtra por esto). */
  readonly superficie = input('TESORO');

  readonly items = signal<BannerItem[]>([]);
  readonly cargando = signal(true);
  readonly mostrarEsqueleto = signal(false);
  readonly indice = signal(0);
  readonly orientacion = signal<Orientacion>('HORIZONTAL');
  readonly silenciado = signal(true);
  readonly pausaManual = signal(false);
  private readonly pausaHover = signal(false);
  private readonly pausaFoco = signal(false);
  private readonly pestanaOculta = signal(false);
  private readonly enPantalla = signal(false);
  readonly reducirMovimiento = signal(false);
  readonly detalle = signal<BannerItem | null>(null);
  readonly nombre = signal('');

  readonly actual = computed(() => this.items()[this.indice()] ?? null);
  readonly pausado = computed(() =>
    this.pausaManual() || this.pausaHover() || this.pausaFoco() || this.pestanaOculta()
    || this.reducirMovimiento() || !!this.detalle());
  readonly esVideoActual = computed(() => {
    const it = this.actual();
    if (!it) return false;
    const m = this.orientacion() === 'VERTICAL' ? (it.vertical ?? it.horizontal) : (it.horizontal ?? it.vertical);
    return m?.tipo === 'VIDEO';
  });
  /** Duración del slide activo, para la barra de progreso del punto. */
  readonly duracionActual = computed(() => this.duracion(this.actual()));
  /** El detalle muestra el medio sin texto encima (el texto va debajo, completo). */
  readonly detalleMedio = computed<BannerItem | null>(() => {
    const d = this.detalle();
    return d ? { ...d, diseno: 'SOLO_MEDIA', descartable: false, destino: { tipo: 'NINGUNO' } } : null;
  });

  private temporizador: ReturnType<typeof setTimeout> | null = null;
  /** El video activo terminó mientras estaba en pausa: al reanudar se avanza sin esperar. */
  private terminoEnPausa = false;
  private inicioPuntero: { x: number; y: number } | null = null;
  private vistas = new Set<string>();

  ngOnInit(): void {
    this.nombre.set(this.primerNombre());
    this.mostrarEsqueleto.set(Number(getLocalStorageItem(CLAVE_ULTIMO) ?? '0') > 0);
    try {
      this.vistas = new Set(JSON.parse(sessionStorage.getItem(CLAVE_VISTAS) ?? '[]'));
    } catch { this.vistas = new Set(); }

    this.observarPantalla();

    this.api.feed(this.superficie()).subscribe((lista) => {
      this.items.set(lista);
      this.cargando.set(false);
      this.indice.set(0);
      setLocalStorageItem(CLAVE_ULTIMO, String(lista.length));
      this.programar();
      this.apuntarVista();
    });

    this.destroyRef.onDestroy(() => this.limpiarTemporizador());
  }

  ngAfterViewInit(): void {
    // La vista solo cuenta si el carrusel está en pantalla (alguien que entra y baja
    // directo a sus tarjetas no "vio" el banner).
    if (typeof IntersectionObserver === 'undefined') { this.enPantalla.set(true); return; }
    const io = new IntersectionObserver(([e]) => {
      this.enPantalla.set(e.isIntersecting && e.intersectionRatio >= 0.5);
      this.apuntarVista();
    }, { threshold: [0, 0.5, 1] });
    io.observe(this.host.nativeElement);
    this.destroyRef.onDestroy(() => io.disconnect());
  }

  // ── navegación entre slides ───────────────────────────────────────────────

  ir(i: number): void {
    const n = this.items().length;
    if (!n) return;
    this.terminoEnPausa = false;
    this.indice.set(((i % n) + n) % n);
    this.programar();
    this.apuntarVista();
  }

  siguiente(): void { this.ir(this.indice() + 1); }
  anterior(): void { this.ir(this.indice() - 1); }

  alternarPausa(): void {
    this.pausaManual.update((v) => !v);
    this.programar();
  }

  alternarSonido(): void { this.silenciado.update((v) => !v); }

  /** Un video avanza al terminar (si no hay pausa); con un solo banner vuelve a empezar. */
  alTerminarVideo(): void {
    if (this.pausado()) { this.terminoEnPausa = true; return; }
    this.siguiente();
  }

  /**
   * Reprograma el avance automático del slide activo. El video se respalda con un tope por
   * si nunca dispara `ended` (red lenta, video corrupto): su duración más un margen.
   */
  private programar(): void {
    this.limpiarTemporizador();
    if (this.items().length < 2 || this.pausado()) return;
    if (this.terminoEnPausa) { this.siguiente(); return; }
    const it = this.actual();
    if (!it) return;
    const ms = this.esVideoActual() ? this.duracion(it) + 4000 : this.duracion(it);
    this.temporizador = setTimeout(() => this.siguiente(), ms);
  }

  private duracion(it: BannerItem | null): number {
    if (!it) return 7000;
    const m = this.orientacion() === 'VERTICAL' ? (it.vertical ?? it.horizontal) : (it.horizontal ?? it.vertical);
    if (m?.tipo === 'VIDEO' && m.duracion_ms) return Math.min(Math.max(m.duracion_ms, 3000), 120000);
    return Math.max(3, it.duracion_segundos || 7) * 1000;
  }

  private limpiarTemporizador(): void {
    if (this.temporizador) { clearTimeout(this.temporizador); this.temporizador = null; }
  }

  // ── pausa por interacción ─────────────────────────────────────────────────

  /** Solo con mouse: en un celular el "hover" se queda pegado tras un toque y lo pararía. */
  entraMouse(ev: PointerEvent): void {
    if (ev.pointerType !== 'mouse') return;
    this.pausaHover.set(true);
    this.programar();
  }
  saleMouse(ev: PointerEvent): void {
    if (ev.pointerType !== 'mouse') return;
    this.pausaHover.set(false);
    this.programar();
  }
  /**
   * Solo con foco de TECLADO: quien hace clic en una flecha no quiere que el carrusel se
   * quede parado para siempre; quien navega con tabulador sí necesita que no se le mueva.
   */
  entraFoco(ev: FocusEvent): void {
    const el = ev.target as Element | null;
    let teclado = false;
    try { teclado = !!el?.matches(':focus-visible'); } catch { teclado = false; }
    if (!teclado) return;
    this.pausaFoco.set(true);
    this.programar();
  }
  saleFoco(ev: FocusEvent): void {
    const destino = ev.relatedTarget as Node | null;
    if (destino && this.host.nativeElement.contains(destino)) return;
    this.pausaFoco.set(false);
    this.programar();
  }

  teclado(ev: KeyboardEvent): void {
    if (ev.key === 'ArrowRight') { ev.preventDefault(); this.siguiente(); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); this.anterior(); }
  }

  // ── deslizar con el dedo ──────────────────────────────────────────────────

  punteroAbajo(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse') return;
    this.inicioPuntero = { x: ev.clientX, y: ev.clientY };
  }

  punteroArriba(ev: PointerEvent): void {
    const ini = this.inicioPuntero;
    this.inicioPuntero = null;
    if (!ini) return;
    const dx = ev.clientX - ini.x;
    const dy = ev.clientY - ini.y;
    // Horizontal y con intención: un desplazamiento vertical de la página no cambia de slide.
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) this.siguiente(); else this.anterior();
    }
  }

  // ── acciones del banner ───────────────────────────────────────────────────

  abrir(it: BannerItem): void {
    this.api.interaccion(it.id, 'CLIC');
    const d = it.destino;
    const valor = (d?.valor ?? '').trim();
    switch (d?.tipo) {
      case 'DETALLE':
        this.detalle.set(it);
        this.programar();
        return;
      case 'RUTA_INTERNA':
      case 'FORMULARIO':
        if (valor.startsWith('/') && !valor.startsWith('//')) {
          if (d.nueva_pestana) {
            window.open(new URL(this.location.prepareExternalUrl(valor), window.location.href).toString(),
              '_blank', 'noopener');
          } else {
            this.router.navigateByUrl(valor);
          }
          return;
        }
        this.abrirExterno(valor);
        return;
      case 'URL_EXTERNA':
        this.abrirExterno(valor);
        return;
      default:
        return;
    }
  }

  /** Siempre en otra pestaña: en el escritorio y en la APK abre el navegador del sistema. */
  private abrirExterno(url: string): void {
    if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener');
  }

  ocultar(it: BannerItem): void {
    this.api.interaccion(it.id, 'DESCARTE');
    const lista = this.items().filter((x) => x.id !== it.id);
    this.items.set(lista);
    setLocalStorageItem(CLAVE_ULTIMO, String(lista.length));
    if (this.indice() >= lista.length) this.indice.set(0);
    this.programar();
    this.apuntarVista();
  }

  cerrarDetalle(): void {
    this.detalle.set(null);
    this.programar();
  }

  // ── telemetría ────────────────────────────────────────────────────────────

  private apuntarVista(): void {
    const it = this.actual();
    if (!it || !this.enPantalla() || this.pestanaOculta()) return;
    if (this.vistas.has(it.id)) return;
    this.vistas.add(it.id);
    try { sessionStorage.setItem(CLAVE_VISTAS, JSON.stringify([...this.vistas])); } catch { /* modo privado */ }
    this.api.interaccion(it.id, 'VISTA');
  }

  // ── entorno ───────────────────────────────────────────────────────────────

  private observarPantalla(): void {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    // Vertical: pantallas angostas o tabletas en vertical. Un celular girado ve la horizontal.
    const vertical = window.matchMedia('(max-width: 700px), (orientation: portrait) and (max-width: 1024px)');
    const movimiento = window.matchMedia('(prefers-reduced-motion: reduce)');
    const aplicar = () => {
      this.orientacion.set(vertical.matches ? 'VERTICAL' : 'HORIZONTAL');
      this.reducirMovimiento.set(movimiento.matches);
      this.programar();
    };
    aplicar();
    vertical.addEventListener('change', aplicar);
    movimiento.addEventListener('change', aplicar);
    const visibilidad = () => {
      this.pestanaOculta.set(document.visibilityState === 'hidden');
      this.programar();
      this.apuntarVista();
    };
    document.addEventListener('visibilitychange', visibilidad);
    this.destroyRef.onDestroy(() => {
      vertical.removeEventListener('change', aplicar);
      movimiento.removeEventListener('change', aplicar);
      document.removeEventListener('visibilitychange', visibilidad);
    });
  }

  private primerNombre(): string {
    try {
      const u = JSON.parse(getLocalStorageItem('user') ?? '{}');
      const n = String(u?.datos_basicos?.nombres ?? u?.nombres ?? '').trim().split(/\s+/)[0] ?? '';
      return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
    } catch {
      return '';
    }
  }
}
