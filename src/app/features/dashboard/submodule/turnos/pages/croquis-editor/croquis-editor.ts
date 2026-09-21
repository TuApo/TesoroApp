import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { CroquisSvg, COLOR_TIPO, leerPisos, serializarPisos } from '../../components/croquis-svg/croquis-svg';
import { Area, Croquis, ElementoCroquis, FormaArea, Oficina, PisoCroquis, TipoArea, TurnosService } from '../../service/turnos.service';

type Herramienta = 'seleccionar' | TipoArea | ElementoCroquis['tipo'] | 'SILLA2' | 'SILLA3' | 'SILLA4';
type Seleccion = { tipo: 'area' | 'elemento'; id: string } | null;
type Arrastre = { modo: 'mover' | 'redimensionar' | 'rotar'; sel: NonNullable<Seleccion>; x0: number; y0: number; ox: number; oy: number; ow: number; oh: number; cx: number; cy: number; rot0: number; ang0: number };

/** Tamaños reales por tipo de área (metros) al crearla con un clic. */
const TAMANO_AREA_M: Record<string, [number, number]> = {
  RECEPCION: [3, 2], MODULO: [2, 1.5], VENTANILLA: [1.5, 1], PUESTO: [1.6, 1.2], OFICINA: [3, 3],
  AREA_ATENCION: [5, 4], SALA_ESPERA: [5, 4], PASILLO: [6, 1.5], BANO: [2, 2], SALIDA: [1.2, 0.6],
  ENTRADA: [1.2, 0.6], ESCALERA: [3, 1.2], ASCENSOR: [1.8, 1.8], OTRO: [2, 2],
};
/** Capacidad por defecto: cuántas personas atienden en un área de ese tipo. */
const CAPACIDAD_TIPO: Record<string, number> = {
  RECEPCION: 1, MODULO: 1, VENTANILLA: 1, PUESTO: 1, OFICINA: 1, AREA_ATENCION: 4,
};

/**
 * La mesa de trabajo del croquis: dibujar el plano de la oficina con medidas reales, en
 * varios pisos, y decir qué hay en cada lado.
 *
 * <p>Se dibuja sobre el mismo SVG que después se imprime y se muestra en el televisor.
 * El lienzo va en píxeles pero cada píxel vale `escala` centímetros (2 por defecto: 1 m son
 * 50 px), así que todo lo que se ve tiene reglas y cotas en metros y las medidas se editan
 * en metros.
 *
 * <p>LAS ÁREAS SON LOS PUESTOS. Un área con capacidad N (una oficina privada = 1, un área
 * compartida de contratación = 4, un pasillo de apoyo móvil = 2) genera al guardar N puntos
 * de atención que la gente elige al abrir atención. Lo demás (paredes, puertas, sillas de
 * espera ×1..×4, mesas, textos) es decoración y viaja como JSON por piso.
 *
 * <p>Guardado completo: se manda todo y se sustituye lo que había. Un plano ya publicado no
 * se toca: guardar abre versión nueva.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-croquis-editor',
  imports: [CommonModule, FormsModule, MatIconModule, CroquisSvg],
  templateUrl: './croquis-editor.html',
  styleUrls: ['../../styles/turnos-comun.css', './croquis-editor.css'],
})
export class CroquisEditor implements OnInit {
  readonly id = input.required<string>();

  private api = inject(TurnosService);
  private router = inject(Router);
  readonly lienzo = viewChild<ElementRef<HTMLElement>>('lienzo');

  readonly oficina = signal<Oficina | null>(null);
  readonly croquis = signal<Croquis | null>(null);
  readonly versiones = signal<Croquis[]>([]);
  readonly areas = signal<Area[]>([]);
  readonly pisos = signal<PisoCroquis[]>([]);
  readonly pisoId = signal<string>('p1');
  readonly fondoColor = signal('#FFFFFF');
  readonly nombre = signal('Croquis');
  readonly escala = signal(2);
  readonly herramienta = signal<Herramienta>('seleccionar');
  readonly seleccion = signal<Seleccion>(null);
  readonly cuadricula = signal(true);
  readonly regla = signal(true);
  readonly cotas = signal(true);
  readonly ajustar = signal(true);
  readonly zoom = signal(1);
  readonly sucio = signal(false);
  readonly ocupado = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly renombrandoPiso = signal<string | null>(null);
  nombrePisoTemporal = '';

  readonly TIPOS_AREA: { tipo: TipoArea; icono: string; nombre: string; ayuda: string }[] = [
    { tipo: 'OFICINA', icono: 'business_center', nombre: 'Oficina privada', ayuda: 'Un puesto: quien la abre atiende ahí' },
    { tipo: 'PUESTO', icono: 'desk', nombre: 'Puesto', ayuda: 'Un escritorio de atención' },
    { tipo: 'AREA_ATENCION', icono: 'groups', nombre: 'Área compartida', ayuda: 'Varias personas atienden (capacidad)' },
    { tipo: 'MODULO', icono: 'meeting_room', nombre: 'Módulo', ayuda: 'Un puesto' },
    { tipo: 'VENTANILLA', icono: 'storefront', nombre: 'Ventanilla', ayuda: 'Un puesto' },
    { tipo: 'RECEPCION', icono: 'support_agent', nombre: 'Recepción', ayuda: 'Un puesto' },
    { tipo: 'PASILLO', icono: 'directions_walk', nombre: 'Pasillo / apoyo', ayuda: 'Apoyo móvil: sin escritorio fijo' },
    { tipo: 'SALA_ESPERA', icono: 'chair', nombre: 'Sala de espera', ayuda: 'No atiende' },
    { tipo: 'BANO', icono: 'wc', nombre: 'Baño', ayuda: '' },
    { tipo: 'ENTRADA', icono: 'login', nombre: 'Entrada', ayuda: '' },
    { tipo: 'SALIDA', icono: 'logout', nombre: 'Salida', ayuda: '' },
    { tipo: 'ESCALERA', icono: 'stairs', nombre: 'Escalera', ayuda: '' },
    { tipo: 'ASCENSOR', icono: 'elevator', nombre: 'Ascensor', ayuda: '' },
    { tipo: 'OTRO', icono: 'category', nombre: 'Otra área', ayuda: '' },
  ];
  readonly TIPOS_ELEMENTO: { tipo: Herramienta; icono: string; nombre: string }[] = [
    { tipo: 'PARED', icono: 'horizontal_rule', nombre: 'Pared' },
    { tipo: 'PUERTA', icono: 'door_front', nombre: 'Puerta' },
    { tipo: 'VENTANA', icono: 'window', nombre: 'Ventana' },
    { tipo: 'SILLA', icono: 'chair_alt', nombre: 'Silla ×1' },
    { tipo: 'SILLA2', icono: 'weekend', nombre: 'Sillas ×2' },
    { tipo: 'SILLA3', icono: 'weekend', nombre: 'Sillas ×3' },
    { tipo: 'SILLA4', icono: 'weekend', nombre: 'Sillas ×4' },
    { tipo: 'MOSTRADOR', icono: 'countertops', nombre: 'Mostrador' },
    { tipo: 'MESA', icono: 'table_restaurant', nombre: 'Mesa' },
    { tipo: 'FLECHA', icono: 'arrow_right_alt', nombre: 'Flecha' },
    { tipo: 'TEXTO', icono: 'title', nombre: 'Texto' },
    { tipo: 'PLANTA', icono: 'potted_plant', nombre: 'Planta' },
    { tipo: 'ICONO', icono: 'emoji_symbols', nombre: 'Icono' },
  ];
  readonly FORMAS: FormaArea[] = ['RECTANGULO', 'REDONDEADO', 'CIRCULO'];
  readonly ICONOS = ['place', 'desk', 'print', 'local_cafe', 'wifi', 'accessible', 'local_parking', 'restaurant', 'phone', 'info', 'emergency', 'fire_extinguisher', 'water_drop', 'elevator'];

  readonly piso = computed<PisoCroquis>(() => this.pisos().find(p => p.id === this.pisoId()) ?? this.pisos()[0]);
  readonly areasDelPiso = computed(() => {
    const id = this.piso()?.id;
    const primero = this.pisos()[0]?.id === id;
    return this.areas().filter(a => a.piso === id || (!a.piso && primero));
  });
  readonly elementos = computed(() => this.piso()?.elementos ?? []);
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
    ancho: this.piso()?.ancho ?? 1200, alto: this.piso()?.alto ?? 800, fondo_color: this.fondoColor(), nombre: this.nombre(),
    escala_cm_px: this.escala(), areas: this.areas(), elementos_json: null, fondo_imagen_url: this.croquis()?.fondo_imagen_url ?? null,
  } as Croquis));
  readonly puestosTotales = computed(() => this.areas().filter(a => a.activa !== false).reduce((s, a) => s + (a.capacidad || 0), 0));

  private arrastre: Arrastre | null = null;

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
    this.areas.set(c?.areas ? c.areas.map(a => ({ ...a, capacidad: a.capacidad ?? 0, movil: !!a.movil })) : []);
    const pisos = leerPisos(c);
    this.pisos.set(pisos);
    this.pisoId.set(pisos[0].id);
    this.fondoColor.set(c?.fondo_color || '#FFFFFF');
    this.nombre.set(c?.nombre || 'Croquis');
    this.escala.set(Number(c?.escala_cm_px) || 2);
    this.seleccion.set(null);
    this.sucio.set(false);
  }

  cargarVersion(id: string): void {
    if (this.sucio() && !confirm('Hay cambios sin guardar. ¿Cambiar de versión igualmente?')) return;
    this.api.croquisPorId(id).subscribe({ next: c => this.aplicar(c), error: () => {} });
  }

  // ── Medidas ───────────────────────────────────────────────────────────

  /** Metros → píxeles del lienzo con la escala actual. */
  px(m: number): number { return Math.round(m * 100 / this.escala()); }
  m(px: number): number { return Math.round(px * this.escala()) / 100; }
  private snap(v: number): number { return this.ajustar() ? Math.round(v / this.px(0.1)) * this.px(0.1) : Math.round(v); }

  cambiarEscala(v: number): void {
    const nueva = Math.max(0.5, Math.min(10, +v || 2));
    if (nueva === this.escala()) return;
    if (!confirm('Cambiar la escala no mueve nada: solo cambia cuántos centímetros vale cada píxel. ¿Continuar?')) return;
    this.escala.set(nueva);
    this.sucio.set(true);
  }

  // ── Pisos ─────────────────────────────────────────────────────────────

  elegirPiso(id: string): void { this.pisoId.set(id); this.seleccion.set(null); }

  agregarPiso(): void {
    const n = this.pisos().length + 1;
    const base = this.piso();
    const nuevo: PisoCroquis = { id: `p${Date.now().toString(36)}`, nombre: `Piso ${n}`, ancho: base?.ancho ?? 1200, alto: base?.alto ?? 800, elementos: [] };
    this.pisos.update(l => [...l, nuevo]);
    this.pisoId.set(nuevo.id);
    this.sucio.set(true);
  }

  empezarRenombrarPiso(p: PisoCroquis): void { this.renombrandoPiso.set(p.id); this.nombrePisoTemporal = p.nombre; }
  guardarNombrePiso(p: PisoCroquis): void {
    const nombre = this.nombrePisoTemporal.trim();
    this.renombrandoPiso.set(null);
    if (!nombre || nombre === p.nombre) return;
    this.pisos.update(l => l.map(x => (x.id === p.id ? { ...x, nombre } : x)));
    this.sucio.set(true);
  }

  eliminarPiso(p: PisoCroquis): void {
    if (this.pisos().length <= 1) return;
    const conAreas = this.areas().some(a => a.piso === p.id && a.activa !== false);
    if (conAreas) { this.error.set('Ese piso tiene áreas: muévalas o elimínelas primero'); setTimeout(() => this.error.set(null), 3000); return; }
    if (!confirm(`¿Eliminar "${p.nombre}" con sus elementos?`)) return;
    this.pisos.update(l => l.filter(x => x.id !== p.id));
    this.pisoId.set(this.pisos()[0].id);
    this.sucio.set(true);
  }

  tamanoPiso(campo: 'ancho' | 'alto', metros: number): void {
    const px = Math.max(this.px(2), Math.min(this.px(120), this.px(+metros || 0)));
    this.pisos.update(l => l.map(x => (x.id === this.pisoId() ? { ...x, [campo]: px } : x)));
    this.sucio.set(true);
  }

  moverAreaAPiso(a: Area, pisoId: string): void {
    this.areas.update(l => l.map(x => (x.id === a.id ? { ...x, piso: pisoId } : x)));
    this.sucio.set(true);
  }

  // ── Coordenadas ───────────────────────────────────────────────────────

  private aLienzo(e: PointerEvent): { x: number; y: number } {
    const svg = this.lienzo()?.nativeElement.querySelector('svg');
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return { x: vb.x + ((e.clientX - r.left) / r.width) * vb.width, y: vb.y + ((e.clientY - r.top) / r.height) * vb.height };
  }

  // ── Crear ─────────────────────────────────────────────────────────────

  clicLienzo(e: PointerEvent): void {
    const h = this.herramienta();
    if (h === 'seleccionar') { this.seleccion.set(null); return; }
    const p = this.aLienzo(e);
    const pisoId = this.piso().id;
    if (this.TIPOS_AREA.some(t => t.tipo === h)) {
      const tipo = h as TipoArea;
      const [wm, hm] = TAMANO_AREA_M[tipo] ?? [2, 2];
      const w = this.px(wm), hh = this.px(hm);
      const n = this.areas().filter(a => a.tipo === tipo).length + 1;
      const base = this.TIPOS_AREA.find(t => t.tipo === tipo)!.nombre;
      const conNumero = ['MODULO', 'VENTANILLA', 'PUESTO', 'OFICINA', 'AREA_ATENCION'].includes(tipo);
      const a: Area = {
        id: crypto.randomUUID(), nombre: conNumero ? `${base} ${n}` : base,
        codigo: null, tipo, x: this.snap(p.x - w / 2), y: this.snap(p.y - hh / 2), ancho: w, alto: hh, rotacion: 0,
        forma: tipo === 'SALA_ESPERA' ? 'REDONDEADO' : 'RECTANGULO', puntos_json: null, color: null, icono: null,
        referencia: null, piso: pisoId, descripcion: null, orden: this.areas().length, activa: true,
        capacidad: CAPACIDAD_TIPO[tipo] ?? 0, movil: tipo === 'PASILLO',
      };
      if (tipo === 'PASILLO') a.capacidad = 1;
      this.areas.update(l => [...l, a]);
      this.seleccion.set({ tipo: 'area', id: a.id });
    } else {
      const cantidad = h === 'SILLA2' ? 2 : h === 'SILLA3' ? 3 : h === 'SILLA4' ? 4 : 1;
      const tipo = (h.startsWith('SILLA') ? 'SILLA' : h) as ElementoCroquis['tipo'];
      const dims: Record<string, [number, number]> = {
        PARED: [4, 0.2], PUERTA: [0.9, 0.9], VENTANA: [1.5, 0.15], SILLA: [0.55 * cantidad, 0.55], MOSTRADOR: [2.4, 0.7],
        MESA: [1.6, 0.8], FLECHA: [2, 0.4], TEXTO: [3, 0.5], PLANTA: [0.6, 0.6], ICONO: [0.6, 0.6],
      };
      const [wm, hm] = dims[tipo] ?? [1, 1];
      const el: ElementoCroquis = {
        id: crypto.randomUUID(), tipo, x: this.snap(p.x), y: this.snap(p.y), rotacion: 0,
        ancho: this.px(wm), alto: this.px(hm), cantidad: tipo === 'SILLA' ? cantidad : undefined,
        texto: tipo === 'TEXTO' ? 'Texto' : undefined, tamano: tipo === 'TEXTO' ? 16 : tipo === 'ICONO' ? 28 : undefined,
        icono: tipo === 'ICONO' ? 'place' : undefined,
      };
      this.pisos.update(l => l.map(x => (x.id === pisoId ? { ...x, elementos: [...x.elementos, el] } : x)));
      this.seleccion.set({ tipo: 'elemento', id: el.id });
    }
    this.sucio.set(true);
    // Con Shift se sigue creando el mismo tipo; sin Shift se vuelve a seleccionar.
    if (!e.shiftKey) this.herramienta.set('seleccionar');
  }

  // ── Mover / redimensionar / rotar ─────────────────────────────────────

  elegir(ev: { tipo: 'area' | 'elemento'; id: string; evento: PointerEvent; asa?: boolean; rotar?: boolean }): void {
    ev.evento.stopPropagation();
    this.seleccion.set({ tipo: ev.tipo, id: ev.id });
    const obj = ev.tipo === 'area' ? this.areas().find(a => a.id === ev.id) : this.elementos().find(e => e.id === ev.id);
    if (!obj) return;
    const p = this.aLienzo(ev.evento);
    const cx = obj.x + obj.ancho / 2, cy = obj.y + obj.alto / 2;
    this.arrastre = {
      modo: ev.rotar ? 'rotar' : ev.asa ? 'redimensionar' : 'mover', sel: { tipo: ev.tipo, id: ev.id },
      x0: p.x, y0: p.y, ox: obj.x, oy: obj.y, ow: obj.ancho, oh: obj.alto, cx, cy,
      rot0: obj.rotacion || 0, ang0: Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI,
    };
    (ev.evento.currentTarget as Element | null)?.setPointerCapture?.(ev.evento.pointerId);
  }

  mover(e: PointerEvent): void {
    const d = this.arrastre;
    if (!d) return;
    const p = this.aLienzo(e);
    const dx = p.x - d.x0, dy = p.y - d.y0;
    let cambio: Record<string, unknown>;
    if (d.modo === 'mover') {
      cambio = { x: this.snap(Math.max(0, Math.min(this.piso().ancho - d.ow, d.ox + dx))), y: this.snap(Math.max(0, Math.min(this.piso().alto - d.oh, d.oy + dy))) };
    } else if (d.modo === 'redimensionar') {
      cambio = { ancho: this.snap(Math.max(this.px(0.2), d.ow + dx)), alto: this.snap(Math.max(this.px(0.1), d.oh + dy)) };
    } else {
      const ang = Math.atan2(p.y - d.cy, p.x - d.cx) * 180 / Math.PI;
      let rot = d.rot0 + (ang - d.ang0);
      if (!e.altKey) rot = Math.round(rot / 15) * 15;      // Alt = libre; si no, de 15 en 15
      rot = ((rot + 180) % 360 + 360) % 360 - 180;
      cambio = { rotacion: Math.round(rot) };
    }
    this.aplicarCambio(d.sel, cambio);
  }

  soltar(): void { this.arrastre = null; }

  rotar(grados: number): void {
    const s = this.seleccion();
    if (!s) return;
    const obj = s.tipo === 'area' ? this.areaSel() : this.elementoSel();
    if (!obj) return;
    let rot = (obj.rotacion || 0) + grados;
    rot = ((rot + 180) % 360 + 360) % 360 - 180;
    this.aplicarCambio(s, { rotacion: rot });
  }

  teclado(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const s = this.seleccion();
    if (e.key === 'Escape') { this.herramienta.set('seleccionar'); this.seleccion.set(null); return; }
    if (!s) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.eliminarSeleccion(); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); this.rotar(e.shiftKey ? -15 : 15); return; }
    if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.duplicarSeleccion(); return; }
    const paso = e.shiftKey ? this.px(0.5) : this.px(0.1);
    const delta: Record<string, [number, number]> = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    const obj = s.tipo === 'area' ? this.areaSel() : this.elementoSel();
    if (obj) this.aplicarCambio(s, { x: obj.x + d[0], y: obj.y + d[1] });
  }

  /** Un mismo cambio (posición, tamaño, giro) sirve para áreas y para muebles. */
  private aplicarCambio(s: NonNullable<Seleccion>, cambio: Record<string, unknown>): void {
    if (s.tipo === 'area') this.areas.update(l => l.map(a => (a.id === s.id ? { ...a, ...(cambio as Partial<Area>) } : a)));
    else this.pisos.update(l => l.map(p => (p.id === this.pisoId() ? { ...p, elementos: p.elementos.map(x => (x.id === s.id ? { ...x, ...(cambio as Partial<ElementoCroquis>) } : x)) } : p)));
    this.sucio.set(true);
  }

  actualizarArea(cambio: Partial<Area>): void {
    const a = this.areaSel();
    if (!a) return;
    this.aplicarCambio({ tipo: 'area', id: a.id }, cambio as Record<string, unknown>);
  }
  actualizarAreaM(campo: 'x' | 'y' | 'ancho' | 'alto', metros: number): void { this.actualizarArea({ [campo]: this.px(+metros || 0) }); }
  cambiarTipoArea(tipo: TipoArea): void {
    const a = this.areaSel();
    if (!a) return;
    const cambio: Partial<Area> = { tipo };
    if (!a.capacidad && CAPACIDAD_TIPO[tipo]) cambio.capacidad = CAPACIDAD_TIPO[tipo];
    if (tipo === 'PASILLO' && !a.capacidad) { cambio.capacidad = 1; cambio.movil = true; }
    this.actualizarArea(cambio);
  }

  actualizarElemento(cambio: Partial<ElementoCroquis>): void {
    const e = this.elementoSel();
    if (!e) return;
    this.aplicarCambio({ tipo: 'elemento', id: e.id }, cambio as Record<string, unknown>);
  }
  actualizarElementoM(campo: 'x' | 'y' | 'ancho' | 'alto', metros: number): void { this.actualizarElemento({ [campo]: this.px(+metros || 0) }); }
  cantidadSillas(n: number): void {
    const e = this.elementoSel();
    if (!e || e.tipo !== 'SILLA') return;
    const cantidad = Math.max(1, Math.min(4, +n || 1));
    const porSilla = e.ancho / Math.max(1, e.cantidad || 1);
    this.actualizarElemento({ cantidad, ancho: Math.round(porSilla * cantidad) });
  }

  duplicarSeleccion(): void {
    const a = this.areaSel();
    if (a) {
      const copia = { ...a, id: crypto.randomUUID(), x: a.x + this.px(0.4), y: a.y + this.px(0.4), nombre: siguienteNombre(a.nombre), orden: this.areas().length };
      this.areas.update(l => [...l, copia]);
      this.seleccion.set({ tipo: 'area', id: copia.id });
    }
    const e = this.elementoSel();
    if (e) {
      const copia = { ...e, id: crypto.randomUUID(), x: e.x + this.px(0.4), y: e.y + this.px(0.4) };
      this.pisos.update(l => l.map(p => (p.id === this.pisoId() ? { ...p, elementos: [...p.elementos, copia] } : p)));
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
      if (a?.puestos?.some(p => p.usuario_ref) && !confirm(`Alguien está atendiendo en "${a.nombre}" ahora mismo. Su puesto quedará inactivo cuando cierre. ¿Continuar?`)) return;
      this.areas.update(l => l.filter(x => x.id !== s.id));
    } else {
      this.pisos.update(l => l.map(p => (p.id === this.pisoId() ? { ...p, elementos: p.elementos.filter(x => x.id !== s.id) } : p)));
    }
    this.seleccion.set(null);
    this.sucio.set(true);
  }

  traerAlFrente(): void {
    const s = this.seleccion();
    if (!s) return;
    if (s.tipo === 'area') this.areas.update(l => { const a = l.find(x => x.id === s.id)!; return [...l.filter(x => x.id !== s.id), a].map((x, i) => ({ ...x, orden: i })); });
    else this.pisos.update(l => l.map(p => (p.id === this.pisoId() ? { ...p, elementos: [...p.elementos.filter(x => x.id !== s.id), p.elementos.find(x => x.id === s.id)!] } : p)));
    this.sucio.set(true);
  }

  colorPorDefecto(a: Area): string { return COLOR_TIPO[a.tipo]?.borde ?? '#2B59F0'; }
  nombreTipo(t: string): string { return this.TIPOS_AREA.find(x => x.tipo === t)?.nombre ?? t; }

  // ── Guardar / publicar ────────────────────────────────────────────────

  guardar(nuevaVersion = false): void {
    this.ocupado.set(true);
    this.error.set(null);
    const primero = this.pisos()[0];
    this.api.guardarCroquis(this.id(), {
      nombre: this.nombre(), ancho: primero.ancho, alto: primero.alto, escala_cm_px: this.escala(),
      fondo_color: this.fondoColor(), fondo_imagen_url: this.croquis()?.fondo_imagen_url ?? null,
      elementos_json: serializarPisos(this.pisos()),
      areas: this.areas().map(({ servicios: _s, puestos: _p, ...a }) => a),
      nueva_version: nuevaVersion,
    }).subscribe({
      next: c => {
        this.ocupado.set(false);
        const pisoActual = this.pisoId();
        this.aplicar(c);
        if (this.pisos().some(p => p.id === pisoActual)) this.pisoId.set(pisoActual);
        this.aviso.set(`Guardado (versión ${c.version}) · ${this.puestosTotales()} puestos de atención`);
        this.api.versionesCroquis(this.id()).subscribe({ next: v => this.versiones.set(v), error: () => {} });
        setTimeout(() => this.aviso.set(null), 3500);
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

/** "Módulo 3" → "Módulo 4"; "Oficina" → "Oficina 2". */
function siguienteNombre(nombre: string): string {
  const m = /^(.*?)(\d+)\s*$/.exec(nombre);
  return m ? `${m[1]}${+m[2] + 1}` : `${nombre} 2`;
}
