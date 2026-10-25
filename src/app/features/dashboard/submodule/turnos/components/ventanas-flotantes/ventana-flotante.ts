import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';

import { GestorVentanas, Ventana } from './gestor-ventanas';
import { baseDeLaApp } from './modulos';

/**
 * Una ventana flotante: barra de título que se arrastra (o se mueve con las flechas), bordes
 * que se estiran, minimizar a pestaña, poner grande / volver a su tamaño y cerrar.
 *
 * <p>El contenido es la pantalla real del módulo en un iframe del mismo origen, en modo
 * embebido (sin menú ni barras). Si el servidor no deja enmarcar la app (cabecera
 * `X-Frame-Options: DENY`), el navegador pinta su página de error y aquí se detecta: se
 * ofrece abrirla en otra pestaña en vez de dejar un recuadro gris.
 */
@Component({
  selector: 'app-ventana-flotante',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let v = ventana();
    @let est = estado();
    @let r = rect();
    <section class="vf" role="dialog" [attr.aria-label]="v.titulo + (v.subtitulo ? ' · ' + v.subtitulo : '')"
             [class.vf--max]="est === 'maximizada'" [class.vf--min]="est === 'minimizada'" [class.vf--frente]="gestor.alFrente() === v.id"
             [style.left.px]="est === 'normal' ? r.x : null" [style.top.px]="est === 'normal' ? r.y : null"
             [style.width.px]="est === 'normal' ? r.w : null" [style.height.px]="est === 'normal' ? r.h : null"
             [style.z-index]="v.z" (pointerdown)="gestor.traerAlFrente(v.id)">
      <header class="vf__barra" tabindex="0" (pointerdown)="empezar($event, 'mover')" (dblclick)="gestor.alternarMaximizar(v.id)" (keydown)="teclado($event)"
              [attr.aria-label]="'Barra de ' + v.titulo + ': flechas para mover, Mayús + flechas para cambiar el tamaño'">
        <span class="vf__icono" aria-hidden="true"><mat-icon>{{ v.icono }}</mat-icon></span>
        <div class="vf__titulos">
          <strong>{{ v.titulo }}</strong>
          @if (v.subtitulo) { <span>{{ v.subtitulo }}</span> }
        </div>
        @if (cedula()) {
          <button type="button" class="vf__cedula" (click)="copiarCedula()" [title]="copiada() ? 'Copiada' : 'Copiar la cédula para buscarla en el módulo'">
            <mat-icon>{{ copiada() ? 'check' : 'content_copy' }}</mat-icon> {{ cedula() }}
          </button>
        }
        <div class="vf__botones">
          <a class="vf__btn" [href]="v.urlExterna" target="_blank" rel="noopener" title="Abrir en una pestaña nueva" aria-label="Abrir en una pestaña nueva"><mat-icon>open_in_new</mat-icon></a>
          <button type="button" class="vf__btn" (click)="gestor.minimizar(v.id)" title="Minimizar a pestaña" aria-label="Minimizar a pestaña"><mat-icon>minimize</mat-icon></button>
          @if (!gestor.movil()) {
            <button type="button" class="vf__btn" (click)="gestor.alternarMaximizar(v.id)" [title]="est === 'maximizada' ? 'Volver a su tamaño' : 'Poner grande'"
                    [attr.aria-label]="est === 'maximizada' ? 'Volver a su tamaño' : 'Poner grande'"><mat-icon>{{ est === 'maximizada' ? 'close_fullscreen' : 'open_in_full' }}</mat-icon></button>
          }
          <button type="button" class="vf__btn vf__btn--cerrar" (click)="gestor.cerrar(v.id)" title="Cerrar" aria-label="Cerrar ventana"><mat-icon>close</mat-icon></button>
        </div>
      </header>
      <div class="vf__cuerpo">
        @if (v.cargada && url(); as src) {
          @if (!bloqueado()) {
            <iframe [src]="src" [title]="v.titulo + ' (módulo embebido)'" (load)="alCargar($event)" loading="eager" referrerpolicy="same-origin"></iframe>
          }
        }
        @if (cargando() && !bloqueado()) {
          <div class="vf__esqueleto" aria-live="polite" aria-label="Cargando el módulo">
            <div class="sk sk--barra"></div>
            <div class="sk-fila"><div class="sk sk--bloque"></div><div class="sk sk--bloque"></div><div class="sk sk--bloque"></div></div>
            <div class="sk sk--linea"></div><div class="sk sk--linea sk--corta"></div><div class="sk sk--tabla"></div>
            @if (lento()) {
              <p class="vf__lento">Está tardando más de lo normal. <button type="button" class="vf__enlace" (click)="recargar()">Volver a cargar</button></p>
            }
          </div>
        }
        @if (bloqueado()) {
          <div class="vf__bloqueado" role="alert">
            <mat-icon>web_asset_off</mat-icon>
            <strong>Este módulo no se deja mostrar dentro de la llamada</strong>
            <p>El servidor no permite enmarcar la aplicación en una ventana. Ábralo en una pestaña nueva: la videollamada sigue aquí.</p>
            <div class="vf__acciones">
              <a class="vf__primario" [href]="v.urlExterna" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon> Abrir en pestaña nueva</a>
              <button type="button" class="vf__enlace" (click)="recargar()">Intentar otra vez</button>
            </div>
          </div>
        }
      </div>
      @if (est === 'normal') {
        <span class="vf__borde vf__borde--der" (pointerdown)="empezar($event, 'ancho')" aria-hidden="true"></span>
        <span class="vf__borde vf__borde--abajo" (pointerdown)="empezar($event, 'alto')" aria-hidden="true"></span>
        <span class="vf__borde vf__borde--esquina" (pointerdown)="empezar($event, 'ambos')" aria-hidden="true"></span>
      }
    </section>
  `,
  styleUrl: './ventana-flotante.css',
})
export class VentanaFlotante {
  readonly ventana = input.required<Ventana>();
  readonly cedula = input<string | null>(null);

  readonly gestor = inject(GestorVentanas);
  private sanitizer = inject(DomSanitizer);

  /** Cómo y dónde se pinta (en móvil, a pantalla completa; siempre dentro del viewport). */
  readonly estado = computed(() => this.gestor.estadoVisible(this.ventana()));
  readonly rect = computed(() => this.gestor.rectVisible(this.ventana()));
  readonly cargando = signal(true);
  readonly lento = signal(false);
  readonly bloqueado = signal(false);
  readonly copiada = signal(false);
  private intento = signal(0);
  private temporizadorLento: ReturnType<typeof setTimeout> | null = null;

  // La ventana llega como objeto nuevo en cada cambio (z, posición…): lo que alimenta el
  // iframe se aísla en computed de valores simples para que moverla no lo recargue.
  private readonly urlTexto = computed(() => this.ventana().url);
  private readonly cargada = computed(() => this.ventana().cargada);

  /** Solo URLs del mismo origen: el catálogo las arma así, y esto impide enmarcar otra cosa. */
  readonly url = computed<SafeResourceUrl | null>(() => {
    const u = this.urlTexto();
    this.intento();
    if (typeof location === 'undefined' || !u.startsWith(baseDeLaApp() + '#')) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(u);
  });

  constructor() {
    // Cada vez que el iframe nace (primera apertura o "volver a cargar") se mide cuánto tarda.
    effect(() => {
      const cargada = this.cargada();
      this.intento();
      if (!cargada) return;
      untracked(() => this.vigilarCarga());
    });
    inject(DestroyRef).onDestroy(() => { if (this.temporizadorLento) clearTimeout(this.temporizadorLento); });
  }

  alCargar(ev: Event): void {
    const f = ev.target as HTMLIFrameElement;
    let href = '';
    let accesible = true;
    try { href = f.contentWindow?.location.href ?? ''; } catch { accesible = false; }
    // El primer "load" puede ser el about:blank inicial: se sigue esperando.
    if (accesible && (!href || href === 'about:blank')) return;
    if (this.temporizadorLento) { clearTimeout(this.temporizadorLento); this.temporizadorLento = null; }
    this.cargando.set(false);
    this.lento.set(false);
    this.bloqueado.set(!accesible || !href.startsWith(baseDeLaApp()));
  }

  recargar(): void {
    this.bloqueado.set(false);
    this.intento.update(n => n + 1);
  }

  copiarCedula(): void {
    const c = this.cedula();
    if (!c) return;
    const hecho = () => { this.copiada.set(true); setTimeout(() => this.copiada.set(false), 1600); };
    try { void navigator.clipboard?.writeText(c).then(hecho, () => {}); } catch { /* sin portapapeles */ }
  }

  // ── Mover y redimensionar ──

  empezar(ev: PointerEvent, modo: 'mover' | 'ancho' | 'alto' | 'ambos'): void {
    const v = this.ventana();
    if (ev.button !== 0 || this.estado() !== 'normal') return;
    if (modo === 'mover' && (ev.target as Element).closest('button, a')) return;
    ev.preventDefault();
    const el = ev.currentTarget as HTMLElement;
    try { el.setPointerCapture(ev.pointerId); } catch { /* sin captura */ }
    const inicio = { x: ev.clientX, y: ev.clientY, r: { ...this.rect() } };
    let cuadro = 0;
    let ultimo: PointerEvent | null = null;
    this.gestor.arrastrando.set(true);
    const aplicar = () => {
      cuadro = 0;
      if (!ultimo) return;
      const dx = ultimo.clientX - inicio.x;
      const dy = ultimo.clientY - inicio.y;
      if (modo === 'mover') this.gestor.mover(v.id, inicio.r.x + dx, inicio.r.y + dy);
      else this.gestor.redimensionar(v.id, modo === 'alto' ? inicio.r.w : inicio.r.w + dx, modo === 'ancho' ? inicio.r.h : inicio.r.h + dy);
    };
    const mover = (e: PointerEvent) => { ultimo = e; if (!cuadro) cuadro = requestAnimationFrame(aplicar); };
    const soltar = () => {
      el.removeEventListener('pointermove', mover);
      el.removeEventListener('pointerup', soltar);
      el.removeEventListener('pointercancel', soltar);
      if (cuadro) cancelAnimationFrame(cuadro);
      aplicar();
      this.gestor.arrastrando.set(false);
      this.gestor.recordar(v.id);
    };
    el.addEventListener('pointermove', mover);
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', soltar);
  }

  /** Teclado: flechas mueven 24 px; con Mayús cambian el tamaño; Esc minimiza. */
  teclado(ev: KeyboardEvent): void {
    const v = this.ventana();
    if (ev.key === 'Escape') { ev.preventDefault(); this.gestor.minimizar(v.id); return; }
    if (ev.key === 'Enter') { ev.preventDefault(); this.gestor.alternarMaximizar(v.id); return; }
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[ev.key];
    if (!d || this.estado() !== 'normal') return;
    ev.preventDefault();
    const paso = 24;
    const r = this.rect();
    if (ev.shiftKey) this.gestor.redimensionar(v.id, r.w + d[0] * paso, r.h + d[1] * paso);
    else this.gestor.mover(v.id, r.x + d[0] * paso, r.y + d[1] * paso);
    this.gestor.recordar(v.id);
  }

  private vigilarCarga(): void {
    this.cargando.set(true);
    this.lento.set(false);
    if (this.temporizadorLento) clearTimeout(this.temporizadorLento);
    this.temporizadorLento = setTimeout(() => { if (this.cargando()) this.lento.set(true); }, 20_000);
  }
}
