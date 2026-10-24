import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, model, signal, viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Punto, SentidoLinea, TipoZona } from '../../models/seguridad.models';
import { SgImagen } from '../imagen-segura/imagen-segura';

/** Una zona en edición (la pantalla decide cuándo guardarla). `id` null = nueva. */
export interface ZonaBorrador {
  id: string | null;
  nombre: string;
  tipo: TipoZona;
  puntos: Punto[];
  sentido: SentidoLinea;
  capacidad: number | null;
  color: string | null;
  /** Cambió desde la última vez que se guardó. */
  sucia?: boolean;
}

type Modo = 'ver' | 'ZONA' | 'LINEA';
type Arrastre = { tipo: 'vertice'; zona: number; punto: number } | { tipo: 'forma'; zona: number; desde: Punto; original: Punto[] };

const COLORES = ['#2b59f0', '#e8590c', '#1baf7a', '#c2255c', '#7048e8', '#e0a100'];
const r3 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;

/**
 * Dibujo de zonas (polígonos) y líneas de conteo sobre la captura de una cámara.
 * Coordenadas normalizadas 0..1 (independientes de la resolución), como las guarda el backend.
 *
 * <p>Línea: el lado A queda a la IZQUIERDA del trazo P1→P2 (mirando la imagen, con y hacia
 * abajo) y el B a la derecha. `A_B` cuenta a quien cruza de A hacia B; la flecha lo muestra.
 *
 * <p>Uso: elegir "Nueva zona" y hacer clic en cada esquina (clic en el primer punto, doble
 * clic o "Terminar" para cerrar); "Nueva línea" son dos clics. Arrastrar un punto lo mueve;
 * arrastrar el relleno mueve la figura; el punto medio de un borde agrega un vértice;
 * Supr borra el punto elegido.
 */
@Component({
  selector: 'sg-editor-zonas',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, SgImagen],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor-zonas.html',
  styleUrls: ['./editor-zonas.css'],
})
export class EditorZonas {
  /** URL de la captura de fondo (protegida: se pide con JWT). */
  readonly fondo = input<string | null>(null);
  readonly zonas = model<ZonaBorrador[]>([]);
  readonly seleccion = model<number | null>(null);
  readonly soloLectura = input(false);

  readonly lienzo = viewChild<ElementRef<HTMLElement>>('lienzo');
  readonly ancho = signal(800);
  readonly alto = signal(450);
  readonly modo = signal<Modo>('ver');
  readonly borrador = signal<Punto[]>([]);
  readonly puntero = signal<Punto | null>(null);
  readonly verticeElegido = signal<number | null>(null);
  private arrastre: Arrastre | null = null;

  /** El trazo en curso, con el puntero como punto provisional. */
  readonly trazoBorrador = computed(() => {
    const p = this.puntero();
    return this.puntosSvg(p ? [...this.borrador(), p] : this.borrador());
  });

  readonly ayuda = computed(() => {
    switch (this.modo()) {
      case 'ZONA': return this.borrador().length < 3
        ? 'Haga clic en cada esquina de la zona (mínimo 3).'
        : 'Siga marcando esquinas; clic en el primer punto, doble clic o "Terminar" para cerrarla.';
      case 'LINEA': return this.borrador().length === 0 ? 'Clic en el punto de inicio de la línea (P1).' : 'Clic en el punto final (P2).';
      default: return this.soloLectura() ? '' : 'Elija una figura para editarla: arrastre sus puntos o su relleno. Supr borra el punto elegido.';
    }
  });

  constructor() {
    let ro: ResizeObserver | null = null;
    afterNextRender(() => {
      const el = this.lienzo()?.nativeElement;
      if (!el || typeof ResizeObserver === 'undefined') return;
      ro = new ResizeObserver(([e]) => {
        this.ancho.set(Math.max(1, e.contentRect.width));
        this.alto.set(Math.max(1, e.contentRect.height));
      });
      ro.observe(el);
    });
    inject(DestroyRef).onDestroy(() => ro?.disconnect());
  }

  // ── Conversión de coordenadas ────────────────────────────────────────────
  px(p: Punto): [number, number] { return [p[0] * this.ancho(), p[1] * this.alto()]; }
  puntosSvg(ps: Punto[]): string { return ps.map((p) => this.px(p).join(',')).join(' '); }

  private norm(ev: PointerEvent | MouseEvent): Punto {
    const el = this.lienzo()?.nativeElement;
    if (!el) return [0, 0];
    const r = el.getBoundingClientRect();
    return [r3((ev.clientX - r.left) / r.width), r3((ev.clientY - r.top) / r.height)];
  }

  color(z: ZonaBorrador, i: number): string { return z.color || COLORES[i % COLORES.length]; }

  medios(z: ZonaBorrador): { p: Punto; i: number }[] {
    if (z.tipo === 'LINEA') return [];
    return z.puntos.map((p, i) => {
      const q = z.puntos[(i + 1) % z.puntos.length];
      return { p: [r3((p[0] + q[0]) / 2), r3((p[1] + q[1]) / 2)] as Punto, i: i + 1 };
    });
  }

  /** Flechas perpendiculares de una línea según su sentido. */
  flechas(z: ZonaBorrador): { x1: number; y1: number; x2: number; y2: number }[] {
    if (z.tipo !== 'LINEA' || z.puntos.length < 2) return [];
    const [a, b] = [this.px(z.puntos[0]), this.px(z.puntos[1])];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const largo = Math.hypot(dx, dy) || 1;
    // Normal hacia la IZQUIERDA del trazo (lado A) en coordenadas de pantalla (y hacia abajo).
    const nx = dy / largo, ny = -dx / largo;
    const L = 28;
    const aB = { x1: mx + nx * L, y1: my + ny * L, x2: mx - nx * L, y2: my - ny * L };
    const bA = { x1: aB.x2, y1: aB.y2, x2: aB.x1, y2: aB.y1 };
    return z.sentido === 'A_B' ? [aB] : z.sentido === 'B_A' ? [bA] : [aB, bA];
  }

  /** Posición de las letras A y B a cada lado de la línea. */
  ladosLinea(z: ZonaBorrador): { a: [number, number]; b: [number, number] } | null {
    if (z.tipo !== 'LINEA' || z.puntos.length < 2) return null;
    const [p, q] = [this.px(z.puntos[0]), this.px(z.puntos[1])];
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = dy / l, ny = -dx / l;
    return { a: [mx + nx * 44, my + ny * 44], b: [mx - nx * 44, my - ny * 44] };
  }

  centro(z: ZonaBorrador): [number, number] {
    if (!z.puntos.length) return [0, 0];
    const s = z.puntos.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return this.px([s[0] / z.puntos.length, s[1] / z.puntos.length]);
  }

  // ── Dibujo ───────────────────────────────────────────────────────────────
  empezar(tipo: 'ZONA' | 'LINEA'): void {
    this.modo.set(tipo);
    this.borrador.set([]);
    this.seleccion.set(null);
    this.verticeElegido.set(null);
  }

  cancelar(): void { this.modo.set('ver'); this.borrador.set([]); }

  terminar(): void {
    const m = this.modo();
    const pts = this.borrador();
    if (m === 'ZONA' && pts.length < 3) return;
    if (m === 'LINEA' && pts.length < 2) return;
    if (m === 'ver') return;
    const n = this.zonas().length;
    const nueva: ZonaBorrador = {
      id: null, tipo: m, puntos: pts.slice(0, m === 'LINEA' ? 2 : undefined), sentido: 'AMBOS', capacidad: null,
      color: COLORES[n % COLORES.length], nombre: m === 'LINEA' ? `Línea ${n + 1}` : `Zona ${n + 1}`, sucia: true,
    };
    this.zonas.set([...this.zonas(), nueva]);
    this.seleccion.set(n);
    this.cancelar();
  }

  clicLienzo(ev: MouseEvent): void {
    if (this.soloLectura()) return;
    const m = this.modo();
    if (m === 'ver') {
      // Clic en vacío: quita la selección (los clics sobre figuras se detienen antes).
      this.seleccion.set(null);
      this.verticeElegido.set(null);
      return;
    }
    const p = this.norm(ev);
    const pts = this.borrador();
    if (m === 'ZONA' && pts.length >= 3) {
      const [x0, y0] = this.px(pts[0]);
      const [x, y] = this.px(p);
      if (Math.hypot(x - x0, y - y0) < 12) { this.terminar(); return; }
    }
    this.borrador.set([...pts, p]);
    if (m === 'LINEA' && pts.length + 1 >= 2) this.terminar();
  }

  dobleClic(ev: MouseEvent): void {
    if (this.modo() === 'ZONA') { ev.preventDefault(); this.terminar(); }
  }

  mover(ev: PointerEvent): void {
    const p = this.norm(ev);
    if (this.modo() !== 'ver') { this.puntero.set(p); return; }
    const a = this.arrastre;
    if (!a) return;
    const zs = [...this.zonas()];
    const z = { ...zs[a.zona], sucia: true };
    if (a.tipo === 'vertice') {
      z.puntos = z.puntos.map((q, i) => (i === a.punto ? p : q));
    } else {
      const dx = p[0] - a.desde[0], dy = p[1] - a.desde[1];
      // Que la figura no se salga del cuadro.
      const minX = Math.min(...a.original.map((q) => q[0])), maxX = Math.max(...a.original.map((q) => q[0]));
      const minY = Math.min(...a.original.map((q) => q[1])), maxY = Math.max(...a.original.map((q) => q[1]));
      const ddx = Math.min(Math.max(dx, -minX), 1 - maxX), ddy = Math.min(Math.max(dy, -minY), 1 - maxY);
      z.puntos = a.original.map((q) => [r3(q[0] + ddx), r3(q[1] + ddy)] as Punto);
    }
    zs[a.zona] = z;
    this.zonas.set(zs);
  }

  soltar(): void { this.arrastre = null; }

  tomarVertice(ev: PointerEvent, zona: number, punto: number): void {
    if (this.soloLectura() || this.modo() !== 'ver') return;
    ev.stopPropagation();
    ev.preventDefault();
    this.seleccion.set(zona);
    this.verticeElegido.set(punto);
    this.arrastre = { tipo: 'vertice', zona, punto };
    this.capturar(ev);
  }

  tomarForma(ev: PointerEvent, zona: number): void {
    if (this.modo() !== 'ver') return;
    ev.stopPropagation();
    this.seleccion.set(zona);
    this.verticeElegido.set(null);
    if (this.soloLectura()) return;
    this.arrastre = { tipo: 'forma', zona, desde: this.norm(ev), original: this.zonas()[zona].puntos.map((p) => [...p] as Punto) };
    this.capturar(ev);
  }

  agregarVertice(ev: PointerEvent, zona: number, despuesDe: number, p: Punto): void {
    if (this.soloLectura()) return;
    ev.stopPropagation();
    ev.preventDefault();
    const zs = [...this.zonas()];
    const z = { ...zs[zona], sucia: true, puntos: [...zs[zona].puntos] };
    z.puntos.splice(despuesDe, 0, p);
    zs[zona] = z;
    this.zonas.set(zs);
    this.seleccion.set(zona);
    this.verticeElegido.set(despuesDe);
    this.arrastre = { tipo: 'vertice', zona, punto: despuesDe };
    this.capturar(ev);
  }

  private capturar(ev: PointerEvent): void {
    try { this.lienzo()?.nativeElement.setPointerCapture(ev.pointerId); } catch { /* nada */ }
  }

  quitarVertice(): void {
    const zi = this.seleccion(), vi = this.verticeElegido();
    if (zi === null || vi === null) return;
    const z = this.zonas()[zi];
    if (!z || z.tipo === 'LINEA' || z.puntos.length <= 3) return;
    const zs = [...this.zonas()];
    zs[zi] = { ...z, sucia: true, puntos: z.puntos.filter((_, i) => i !== vi) };
    this.zonas.set(zs);
    this.verticeElegido.set(null);
  }

  tecla(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') { this.cancelar(); this.verticeElegido.set(null); }
    else if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.verticeElegido() !== null) { ev.preventDefault(); this.quitarVertice(); }
    else if (ev.key === 'Enter' && this.modo() !== 'ver') { ev.preventDefault(); this.terminar(); }
  }
}
