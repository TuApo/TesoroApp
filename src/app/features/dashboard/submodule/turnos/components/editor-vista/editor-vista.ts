import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, model, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { Bloque, EstiloBloque, FondoVista, Media, Playlist, TipoBloque, TurnosService, Vista } from '../../service/turnos.service';
import { DatosVista, ICONO_BLOQUE, NOMBRE_BLOQUE, VistaRender, bloqueNuevo } from '../vista-render/vista-render';

type Asa = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type Modo = 'mover' | Asa;

/**
 * El lienzo del diseñador: la vista pintada por el mismo renderizador del
 * televisor, con una caja transparente por bloque encima para arrastrarla y
 * cambiarle el tamaño, y un panel con las propiedades del bloque elegido.
 *
 * <p>Todo se guarda en % del lienzo, así que lo que se acomoda aquí en 900 px
 * queda igual en el televisor. La vista es un `model`: cada cambio sale entero
 * al padre, que decide cuándo guardar.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-editor-vista',
  imports: [CommonModule, FormsModule, MatIconModule, VistaRender],
  templateUrl: './editor-vista.html',
  styleUrl: './editor-vista.css',
})
export class EditorVista {
  readonly vista = model.required<Vista>();
  readonly datos = input.required<DatosVista>();
  readonly playlists = input<Playlist[]>([]);
  readonly imagenes = input<Media[]>([]);

  private api = inject(TurnosService);
  readonly seleccion = signal<string | null>(null);
  readonly rejilla = signal(true);
  readonly TIPOS = Object.keys(NOMBRE_BLOQUE) as TipoBloque[];
  readonly NOMBRE = NOMBRE_BLOQUE;
  readonly ICONO = ICONO_BLOQUE;
  readonly ASAS: Asa[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  readonly bloque = computed<Bloque | null>(() => this.vista().bloques.find(b => b.id === this.seleccion()) ?? null);
  readonly relacion = computed(() => this.vista().orientacion === 'VERTICAL' ? '9 / 16' : '16 / 9');
  readonly fondo = computed<FondoVista>(() => this.vista().fondo ?? { tipo: 'COLOR', color: '#0B1020' });

  private lienzo = viewChild<ElementRef<HTMLElement>>('lienzo');
  private arrastre: { id: string; modo: Modo; x0: number; y0: number; b0: Bloque } | null = null;

  // ── Bloques ────────────────────────────────────────────────────────────

  agregar(tipo: TipoBloque): void {
    const b = bloqueNuevo(tipo, this.vista().orientacion === 'VERTICAL');
    b.z = Math.max(0, ...this.vista().bloques.map(x => x.z ?? 0)) + 1;
    this.vista.update(v => ({ ...v, bloques: [...v.bloques, b] }));
    this.seleccion.set(b.id);
  }

  actualizar(id: string, cambios: Partial<Bloque>): void {
    this.vista.update(v => ({ ...v, bloques: v.bloques.map(b => (b.id === id ? { ...b, ...cambios } : b)) }));
  }

  estiloSet(clave: keyof EstiloBloque, valor: unknown): void {
    const b = this.bloque();
    if (!b) return;
    this.actualizar(b.id, { estilo: { ...(b.estilo ?? {}), [clave]: valor } });
  }

  propSet(clave: string, valor: unknown): void {
    const b = this.bloque();
    if (!b) return;
    this.actualizar(b.id, { props: { ...(b.props ?? {}), [clave]: valor } });
  }

  numero(b: Bloque, clave: 'x' | 'y' | 'w' | 'h', valor: unknown): void {
    const n = Number(valor);
    if (!Number.isFinite(n)) return;
    this.actualizar(b.id, this.acotar({ ...b, [clave]: n }));
  }

  eliminar(id: string): void {
    this.vista.update(v => ({ ...v, bloques: v.bloques.filter(b => b.id !== id) }));
    if (this.seleccion() === id) this.seleccion.set(null);
  }

  duplicar(id: string): void {
    const o = this.vista().bloques.find(b => b.id === id);
    if (!o) return;
    const copia = bloqueNuevo(o.tipo);
    const b: Bloque = { ...structuredClone(o), id: copia.id, x: Math.min(100 - o.w, o.x + 3), y: Math.min(100 - o.h, o.y + 3), z: (o.z ?? 0) + 1 };
    this.vista.update(v => ({ ...v, bloques: [...v.bloques, b] }));
    this.seleccion.set(b.id);
  }

  alFrente(id: string): void { this.actualizar(id, { z: Math.max(0, ...this.vista().bloques.map(x => x.z ?? 0)) + 1 }); }
  alFondo(id: string): void { this.actualizar(id, { z: Math.min(0, ...this.vista().bloques.map(x => x.z ?? 0)) - 1 }); }

  // ── Fondo de la vista ──────────────────────────────────────────────────

  fondoSet(cambios: Partial<FondoVista>): void {
    this.vista.update(v => ({ ...v, fondo: { ...(v.fondo ?? { tipo: 'COLOR', color: '#0B1020' }), ...cambios } }));
  }

  // ── Arrastrar y redimensionar ──────────────────────────────────────────

  iniciar(ev: PointerEvent, b: Bloque, modo: Modo): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.seleccion.set(b.id);
    this.arrastre = { id: b.id, modo, x0: ev.clientX, y0: ev.clientY, b0: { ...b } };
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  }

  mover(ev: PointerEvent): void {
    const a = this.arrastre;
    const el = this.lienzo()?.nativeElement;
    if (!a || !el) return;
    const r = el.getBoundingClientRect();
    const dx = ((ev.clientX - a.x0) / r.width) * 100;
    const dy = ((ev.clientY - a.y0) / r.height) * 100;
    const b0 = a.b0;
    let { x, y, w, h } = b0;
    switch (a.modo) {
      case 'mover': x = b0.x + dx; y = b0.y + dy; break;
      case 'e': w = b0.w + dx; break;
      case 'w': x = b0.x + dx; w = b0.w - dx; break;
      case 's': h = b0.h + dy; break;
      case 'n': y = b0.y + dy; h = b0.h - dy; break;
      case 'se': w = b0.w + dx; h = b0.h + dy; break;
      case 'ne': w = b0.w + dx; y = b0.y + dy; h = b0.h - dy; break;
      case 'sw': x = b0.x + dx; w = b0.w - dx; h = b0.h + dy; break;
      case 'nw': x = b0.x + dx; w = b0.w - dx; y = b0.y + dy; h = b0.h - dy; break;
    }
    this.actualizar(a.id, this.acotar({ ...b0, x, y, w, h }));
  }

  terminar(): void { this.arrastre = null; }

  /** Dentro del lienzo, tamaño mínimo y, con rejilla, redondeo a medio punto. */
  private acotar(b: Bloque): Pick<Bloque, 'x' | 'y' | 'w' | 'h'> {
    const paso = this.rejilla() ? 0.5 : 0.1;
    const r = (n: number) => Math.round(n / paso) * paso;
    let w = Math.max(3, Math.min(100, r(b.w)));
    let h = Math.max(3, Math.min(100, r(b.h)));
    let x = Math.max(0, Math.min(100 - w, r(b.x)));
    let y = Math.max(0, Math.min(100 - h, r(b.y)));
    return { x, y, w, h };
  }

  teclado(ev: KeyboardEvent): void {
    const b = this.bloque();
    if (!b) return;
    const objetivo = ev.target as HTMLElement;
    if (objetivo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(objetivo.tagName)) return;
    const paso = ev.shiftKey ? 5 : 1;
    switch (ev.key) {
      case 'Delete': case 'Backspace': ev.preventDefault(); this.eliminar(b.id); break;
      case 'ArrowLeft': ev.preventDefault(); this.actualizar(b.id, this.acotar({ ...b, x: b.x - paso })); break;
      case 'ArrowRight': ev.preventDefault(); this.actualizar(b.id, this.acotar({ ...b, x: b.x + paso })); break;
      case 'ArrowUp': ev.preventDefault(); this.actualizar(b.id, this.acotar({ ...b, y: b.y - paso })); break;
      case 'ArrowDown': ev.preventDefault(); this.actualizar(b.id, this.acotar({ ...b, y: b.y + paso })); break;
      case 'Escape': this.seleccion.set(null); break;
    }
  }

  prop<T>(b: Bloque, clave: string, defecto: T): T {
    const v = b.props?.[clave];
    return v === undefined || v === null ? defecto : (v as T);
  }

  /** URL absoluta de una pieza subida (el televisor no comparte origen con el API). */
  urlDe(m: Media): string { return this.api.urlMedia(m) ?? ''; }
}
