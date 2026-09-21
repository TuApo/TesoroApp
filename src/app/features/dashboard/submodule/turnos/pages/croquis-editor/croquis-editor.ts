import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { CroquisSvg, COLOR_TIPO, leerElementos } from '../../components/croquis-svg/croquis-svg';
import { Area, Croquis, ElementoCroquis, FormaArea, Oficina, TipoArea, TurnosService } from '../../service/turnos.service';

type Herramienta = 'seleccionar' | TipoArea | ElementoCroquis['tipo'];
type Seleccion = { tipo: 'area' | 'elemento'; id: string } | null;

/**
 * El generador de croquis: dibujar el plano de la oficina y decir qué hay en cada lado.
 *
 * <p>Se dibuja sobre el mismo SVG que después se imprime y se muestra en el televisor,
 * así que lo que se ve aquí es exactamente lo que va a salir. Las ÁREAS (recepción,
 * módulos, salas) son las que importan al negocio: se guardan como filas y se enlazan con
 * servicios y puntos. Lo demás (paredes, puertas, flechas, textos) es decoración y viaja
 * como JSON.
 *
 * <p>Guardado completo: se manda el lienzo entero con sus áreas y se sustituye lo que había.
 * Un plano ya publicado no se toca: guardar abre versión nueva.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-croquis-editor',
  imports: [CommonModule, FormsModule, MatIconModule, CroquisSvg],
  templateUrl: './croquis-editor.html',
  styleUrls: ['../../styles/turnos-comun.css', './croquis-editor.css'],
})
export class CroquisEditor implements OnInit {
  /** Llega por withComponentInputBinding desde la ruta oficinas/:id/croquis. */
  readonly id = input.required<string>();

  private api = inject(TurnosService);
  private router = inject(Router);

  readonly lienzo = viewChild<ElementRef<HTMLElement>>('lienzo');

  readonly oficina = signal<Oficina | null>(null);
  readonly croquis = signal<Croquis | null>(null);
  readonly versiones = signal<Croquis[]>([]);
  readonly areas = signal<Area[]>([]);
  readonly elementos = signal<ElementoCroquis[]>([]);
  readonly ancho = signal(1200);
  readonly alto = signal(800);
  readonly fondoColor = signal('#FFFFFF');
  readonly nombre = signal('Croquis');
  readonly escala = signal<number | null>(null);
  readonly herramienta = signal<Herramienta>('seleccionar');
  readonly seleccion = signal<Seleccion>(null);
  readonly cuadricula = signal(true);
  readonly ajustar = signal(true);
  readonly zoom = signal(1);
  readonly sucio = signal(false);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly TIPOS_AREA: { tipo: TipoArea; icono: string; nombre: string }[] = [
    { tipo: 'RECEPCION', icono: 'desk', nombre: 'Recepción' },
    { tipo: 'MODULO', icono: 'meeting_room', nombre: 'Módulo' },
    { tipo: 'VENTANILLA', icono: 'storefront', nombre: 'Ventanilla' },
    { tipo: 'SALA_ESPERA', icono: 'chair', nombre: 'Sala de espera' },
    { tipo: 'OFICINA', icono: 'business_center', nombre: 'Oficina' },
    { tipo: 'BANO', icono: 'wc', nombre: 'Baño' },
    { tipo: 'ENTRADA', icono: 'login', nombre: 'Entrada' },
    { tipo: 'SALIDA', icono: 'logout', nombre: 'Salida' },
    { tipo: 'ESCALERA', icono: 'stairs', nombre: 'Escalera' },
    { tipo: 'ASCENSOR', icono: 'elevator', nombre: 'Ascensor' },
    { tipo: 'OTRO', icono: 'category', nombre: 'Otra área' },
  ];
  readonly TIPOS_ELEMENTO: { tipo: ElementoCroquis['tipo']; icono: string; nombre: string }[] = [
    { tipo: 'PARED', icono: 'horizontal_rule', nombre: 'Pared' },
    { tipo: 'PUERTA', icono: 'door_front', nombre: 'Puerta' },
    { tipo: 'FLECHA', icono: 'arrow_right_alt', nombre: 'Flecha' },
    { tipo: 'TEXTO', icono: 'title', nombre: 'Texto' },
    { tipo: 'MESA', icono: 'table_restaurant', nombre: 'Mesa' },
    { tipo: 'PLANTA', icono: 'potted_plant', nombre: 'Planta' },
    { tipo: 'ICONO', icono: 'emoji_symbols', nombre: 'Icono' },
  ];
  readonly FORMAS: FormaArea[] = ['RECTANGULO', 'REDONDEADO', 'CIRCULO'];
  readonly ICONOS = ['place', 'desk', 'print', 'local_cafe', 'wifi', 'accessible', 'local_parking', 'restaurant', 'phone', 'info', 'emergency', 'fire_extinguisher'];

  readonly areaSel = computed<Area | null>(() => {
    const s = this.seleccion();
    return s?.tipo === 'area' ? this.areas().find(a => a.id === s.id) ?? null : null;
  });
  readonly elementoSel = computed<ElementoCroquis | null>(() => {
    const s = this.seleccion();
    return s?.tipo === 'elemento' ? this.elementos().find(e => e.id === s.id) ?? null : null;
  });
  readonly croquisVista = computed<Croquis>(() => ({
    ...(this.croquis() ?? ({} as Croquis)),
    ancho: this.ancho(), alto: this.alto(), fondo_color: this.fondoColor(), nombre: this.nombre(),
    areas: this.areas(), elementos_json: null, fondo_imagen_url: this.croquis()?.fondo_imagen_url ?? null,
  } as Croquis));

  private arrastre: { tipo: 'mover' | 'redimensionar'; sel: NonNullable<Seleccion>; x0: number; y0: number; ox: number; oy: number; ow: number; oh: number } | null = null;

  ngOnInit(): void {
    this.api.oficina(this.id()).subscribe({ next: o => this.oficina.set(o), error: () => this.error.set('Oficina no encontrada') });
    this.cargar();
  }

  private cargar(): void {
    this.api.croquis(this.id(), true).subscribe({
      next: c => { this.aplicar(c); this.api.versionesCroquis(this.id()).subscribe({ next: v => this.versiones.set(v), error: () => {} }); },
      error: () => this.aplicar(null),
    });
  }

  private aplicar(c: Croquis | null): void {
    this.croquis.set(c);
    this.areas.set(c?.areas ? c.areas.map(a => ({ ...a })) : []);
    this.elementos.set(leerElementos(c?.elementos_json));
    this.ancho.set(c?.ancho ?? 1200);
    this.alto.set(c?.alto ?? 800);
    this.fondoColor.set(c?.fondo_color || '#FFFFFF');
    this.nombre.set(c?.nombre || 'Croquis');
    this.escala.set(c?.escala_cm_px ?? null);
    this.seleccion.set(null);
    this.sucio.set(false);
  }

  cargarVersion(id: string): void {
    if (this.sucio() && !confirm('Hay cambios sin guardar. ¿Cambiar de versión igualmente?')) return;
    this.api.croquisPorId(id).subscribe({ next: c => this.aplicar(c), error: () => {} });
  }

  // ── Coordenadas ───────────────────────────────────────────────────────

  /** Coordenadas del puntero en unidades del lienzo (el SVG escala con el contenedor). */
  private aLienzo(e: PointerEvent): { x: number; y: number } {
    const svg = this.lienzo()?.nativeElement.querySelector('svg');
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.ancho(), y: ((e.clientY - r.top) / r.height) * this.alto() };
  }

  private snap(v: number): number { return this.ajustar() ? Math.round(v / 10) * 10 : Math.round(v); }

  // ── Crear ─────────────────────────────────────────────────────────────

  clicLienzo(e: PointerEvent): void {
    const h = this.herramienta();
    if (h === 'seleccionar') { this.seleccion.set(null); return; }
    const p = this.aLienzo(e);
    if (this.TIPOS_AREA.some(t => t.tipo === h)) {
      const tipo = h as TipoArea;
      const n = this.areas().filter(a => a.tipo === tipo).length + 1;
      const base = this.TIPOS_AREA.find(t => t.tipo === tipo)!.nombre;
      const a: Area = {
        id: crypto.randomUUID(), nombre: tipo === 'MODULO' || tipo === 'VENTANILLA' ? `${base} ${n}` : base,
        codigo: null, tipo, x: this.snap(p.x - 80), y: this.snap(p.y - 50), ancho: 160, alto: 100, rotacion: 0,
        forma: tipo === 'SALA_ESPERA' ? 'REDONDEADO' : 'RECTANGULO', puntos_json: null, color: null, icono: null,
        referencia: null, piso: null, descripcion: null, orden: this.areas().length, activa: true,
      };
      this.areas.update(l => [...l, a]);
      this.seleccion.set({ tipo: 'area', id: a.id });
    } else {
      const tipo = h as ElementoCroquis['tipo'];
      const el: ElementoCroquis = {
        id: crypto.randomUUID(), tipo, x: this.snap(p.x), y: this.snap(p.y), rotacion: 0,
        ancho: tipo === 'PARED' ? 240 : tipo === 'PUERTA' ? 40 : tipo === 'FLECHA' ? 120 : tipo === 'TEXTO' ? 160 : tipo === 'PLANTA' ? 36 : 80,
        alto: tipo === 'PARED' ? 10 : tipo === 'PUERTA' ? 40 : tipo === 'FLECHA' ? 20 : tipo === 'TEXTO' ? 24 : tipo === 'PLANTA' ? 36 : 50,
        texto: tipo === 'TEXTO' ? 'Texto' : undefined, tamano: tipo === 'TEXTO' ? 16 : tipo === 'ICONO' ? 28 : undefined,
        icono: tipo === 'ICONO' ? 'place' : undefined,
      };
      this.elementos.update(l => [...l, el]);
      this.seleccion.set({ tipo: 'elemento', id: el.id });
    }
    this.sucio.set(true);
    this.herramienta.set('seleccionar');
  }

  // ── Mover / redimensionar ─────────────────────────────────────────────

  elegir(ev: { tipo: 'area' | 'elemento'; id: string; evento: PointerEvent; asa?: boolean }): void {
    ev.evento.stopPropagation();
    this.seleccion.set({ tipo: ev.tipo, id: ev.id });
    const obj = ev.tipo === 'area' ? this.areas().find(a => a.id === ev.id) : this.elementos().find(e => e.id === ev.id);
    if (!obj) return;
    const p = this.aLienzo(ev.evento);
    this.arrastre = { tipo: ev.asa ? 'redimensionar' : 'mover', sel: { tipo: ev.tipo, id: ev.id }, x0: p.x, y0: p.y, ox: obj.x, oy: obj.y, ow: obj.ancho, oh: obj.alto };
    (ev.evento.currentTarget as Element | null)?.setPointerCapture?.(ev.evento.pointerId);
  }

  mover(e: PointerEvent): void {
    const d = this.arrastre;
    if (!d) return;
    const p = this.aLienzo(e);
    const dx = p.x - d.x0, dy = p.y - d.y0;
    const cambio = d.tipo === 'mover'
      ? { x: this.snap(Math.max(0, Math.min(this.ancho() - d.ow, d.ox + dx))), y: this.snap(Math.max(0, Math.min(this.alto() - d.oh, d.oy + dy))) }
      : { ancho: this.snap(Math.max(20, d.ow + dx)), alto: this.snap(Math.max(12, d.oh + dy)) };
    if (d.sel.tipo === 'area') this.areas.update(l => l.map(a => (a.id === d.sel.id ? { ...a, ...cambio } : a)));
    else this.elementos.update(l => l.map(x => (x.id === d.sel.id ? { ...x, ...cambio } : x)));
    this.sucio.set(true);
  }

  soltar(): void { this.arrastre = null; }

  teclado(e: KeyboardEvent): void {
    const s = this.seleccion();
    if (!s) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      e.preventDefault();
      this.eliminarSeleccion();
      return;
    }
    const paso = e.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    this.modificar({ dx: d[0], dy: d[1] });
  }

  private modificar(c: { dx?: number; dy?: number }): void {
    const s = this.seleccion();
    if (!s) return;
    const dx = c.dx ?? 0, dy = c.dy ?? 0;
    if (s.tipo === 'area') this.areas.update(l => l.map(a => (a.id === s.id ? { ...a, x: a.x + dx, y: a.y + dy } : a)));
    else this.elementos.update(l => l.map(x => (x.id === s.id ? { ...x, x: x.x + dx, y: x.y + dy } : x)));
    this.sucio.set(true);
  }

  actualizarArea(cambio: Partial<Area>): void {
    const a = this.areaSel();
    if (!a) return;
    this.areas.update(l => l.map(x => (x.id === a.id ? { ...x, ...cambio } : x)));
    this.sucio.set(true);
  }

  actualizarElemento(cambio: Partial<ElementoCroquis>): void {
    const e = this.elementoSel();
    if (!e) return;
    this.elementos.update(l => l.map(x => (x.id === e.id ? { ...x, ...cambio } : x)));
    this.sucio.set(true);
  }

  duplicarSeleccion(): void {
    const a = this.areaSel();
    if (a) {
      const copia = { ...a, id: crypto.randomUUID(), x: a.x + 20, y: a.y + 20, nombre: a.nombre + ' (copia)', orden: this.areas().length };
      this.areas.update(l => [...l, copia]);
      this.seleccion.set({ tipo: 'area', id: copia.id });
    }
    const e = this.elementoSel();
    if (e) {
      const copia = { ...e, id: crypto.randomUUID(), x: e.x + 20, y: e.y + 20 };
      this.elementos.update(l => [...l, copia]);
      this.seleccion.set({ tipo: 'elemento', id: copia.id });
    }
    this.sucio.set(true);
  }

  eliminarSeleccion(): void {
    const s = this.seleccion();
    if (!s) return;
    if (s.tipo === 'area') {
      const a = this.areas().find(x => x.id === s.id);
      if (a?.servicios?.length && !confirm(`El área "${a.nombre}" tiene servicios asignados (${a.servicios.join(', ')}). Se desactiva, no se borra. ¿Continuar?`)) return;
      this.areas.update(l => l.filter(x => x.id !== s.id));
    } else {
      this.elementos.update(l => l.filter(x => x.id !== s.id));
    }
    this.seleccion.set(null);
    this.sucio.set(true);
  }

  traerAlFrente(): void {
    const s = this.seleccion();
    if (!s) return;
    if (s.tipo === 'area') this.areas.update(l => { const a = l.find(x => x.id === s.id)!; return [...l.filter(x => x.id !== s.id), a].map((x, i) => ({ ...x, orden: i })); });
    else this.elementos.update(l => { const e = l.find(x => x.id === s.id)!; return [...l.filter(x => x.id !== s.id), e]; });
    this.sucio.set(true);
  }

  colorPorDefecto(a: Area): string { return COLOR_TIPO[a.tipo]?.borde ?? '#2B59F0'; }

  // ── Guardar / publicar ────────────────────────────────────────────────

  guardar(nuevaVersion = false): void {
    this.ocupado.set(true);
    this.error.set(null);
    this.api.guardarCroquis(this.id(), {
      nombre: this.nombre(), ancho: this.ancho(), alto: this.alto(), escala_cm_px: this.escala(),
      fondo_color: this.fondoColor(), fondo_imagen_url: this.croquis()?.fondo_imagen_url ?? null,
      elementos_json: JSON.stringify(this.elementos()),
      areas: this.areas().map(({ servicios: _s, ...a }) => a),
      nueva_version: nuevaVersion,
    }).subscribe({
      next: c => {
        this.ocupado.set(false);
        this.aplicar(c);
        this.aviso.set(`Guardado (versión ${c.version})`);
        this.api.versionesCroquis(this.id()).subscribe({ next: v => this.versiones.set(v), error: () => {} });
        setTimeout(() => this.aviso.set(null), 2500);
      },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo guardar'); },
    });
  }

  publicar(): void {
    const c = this.croquis();
    if (!c) return;
    if (this.sucio()) { this.error.set('Guarde antes de publicar'); return; }
    if (!confirm('Publicar deja esta versión como el plano vigente: es la que se imprime y la que ve el televisor. ¿Continuar?')) return;
    this.ocupado.set(true);
    this.api.publicarCroquis(c.id).subscribe({
      next: r => { this.ocupado.set(false); this.aplicar(r); this.aviso.set('Croquis publicado'); setTimeout(() => this.aviso.set(null), 2500); },
      error: e => { this.ocupado.set(false); this.error.set(e?.error?.message || 'No se pudo publicar'); },
    });
  }

  volver(): void {
    if (this.sucio() && !confirm('Hay cambios sin guardar. ¿Salir igualmente?')) return;
    this.router.navigate(['/dashboard/turnos/oficinas']);
  }

  irAlCartel(): void { this.router.navigate(['/dashboard/turnos/cartel']); }
}
