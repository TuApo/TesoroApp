import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** Algo que se pinta como punto en el mapa. */
export interface MarcadorMapa {
  id: string;
  lat: number;
  lon: number;
  /** persona = círculo con iniciales; finca = alfiler; yo = punto azul con halo. */
  tipo: 'persona' | 'finca' | 'yo' | 'punto';
  color?: string;
  etiqueta?: string;
  iniciales?: string;
  /** Un halo que late (alguien en línea, una alerta). */
  pulso?: boolean;
  /** Atenuado (sin señal, finca inactiva). */
  tenue?: boolean;
  seleccionado?: boolean;
}

export interface CirculoMapa { lat: number; lon: number; radioM: number; color?: string; punteado?: boolean }
export interface LineaMapa { puntos: [number, number][]; color?: string }

const TAM = 256;
const CACHE = 'tuapo-campo-mosaicos-v1';
const MIN_Z = 3;
const MAX_Z = 19;

function aMundo(lat: number, lon: number, z: number): [number, number] {
  const s = TAM * 2 ** z;
  const r = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  return [(lon + 180) / 360 * s, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * s];
}

function aGeo(x: number, y: number, z: number): [number, number] {
  const s = TAM * 2 ** z;
  const lon = x / s * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / s;
  return [180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon];
}

function urlMosaico(plantilla: string, z: number, x: number, y: number): string {
  return plantilla.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)).replace('{s}', 'abc'[(x + y) % 3]);
}

/**
 * Mapa de campo hecho a la medida, sin librerías: mosaicos estándar (z/x/y) con caché propia
 * en Cache Storage para que el mapa de la zona del coordinador se vea SIN SEÑAL, geocercas de
 * las fincas, recorridos y marcadores. Se arrastra con el dedo o el ratón, se acerca con
 * pellizco, rueda, doble toque o los botones.
 *
 * Con `elegirPunto` un toque en el mapa emite la coordenada: es el respaldo cuando el GPS no
 * da posición (la marcación queda como "punto elegido en el mapa" para el supervisor).
 */
@Component({
  selector: 'app-mapa-campo',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mapa" #caja
         [class.eligiendo]="elegirPunto()"
         (pointerdown)="abajo($event)" (pointermove)="mover($event)" (pointerup)="arriba($event)"
         (pointercancel)="arriba($event)" (wheel)="rueda($event)" (dblclick)="dobleClic($event)">
      <div class="capa">
        @for (t of mosaicos(); track t.k) {
          <img class="mosaico" [src]="t.src" [style.left.px]="t.x" [style.top.px]="t.y" alt="" draggable="false"
               [class.vacio]="!t.listo" />
        }
      </div>
      <svg class="vector" [attr.width]="ancho()" [attr.height]="alto()">
        @for (c of circulosPx(); track $index) {
          <circle [attr.cx]="c.x" [attr.cy]="c.y" [attr.r]="c.r" [attr.fill]="c.color" fill-opacity="0.12"
                  [attr.stroke]="c.color" stroke-width="2" [attr.stroke-dasharray]="c.punteado ? '6 5' : null" />
        }
        @for (l of lineasPx(); track $index) {
          <polyline [attr.points]="l.d" fill="none" [attr.stroke]="l.color" stroke-width="4" stroke-linejoin="round"
                    stroke-linecap="round" stroke-opacity="0.85" />
        }
      </svg>
      @for (m of marcadoresPx(); track m.id) {
        <button type="button" class="marca" [class]="'marca tipo-' + m.tipo" [class.tenue]="m.tenue" [class.sel]="m.seleccionado"
                [style.left.px]="m.x" [style.top.px]="m.y" [style.--c]="m.color || '#2563EB'"
                [attr.aria-label]="m.etiqueta || m.id" [title]="m.etiqueta || ''"
                (pointerdown)="$event.stopPropagation()" (click)="clicMarcador.emit(m.id); $event.stopPropagation()">
          @if (m.pulso) { <span class="pulso"></span> }
          @switch (m.tipo) {
            @case ('persona') { <span class="bola">{{ m.iniciales || '•' }}</span> }
            @case ('finca') { <mat-icon>location_on</mat-icon> }
            @case ('yo') { <span class="yo"></span> }
            @default { <span class="punto"></span> }
          }
          @if (m.etiqueta && (m.tipo !== 'punto') && zoom() >= etiquetasDesde()) { <span class="rotulo">{{ m.etiqueta }}</span> }
        </button>
      }
      <div class="controles">
        <button type="button" (click)="acercar(1)" aria-label="Acercar"><mat-icon>add</mat-icon></button>
        <button type="button" (click)="acercar(-1)" aria-label="Alejar"><mat-icon>remove</mat-icon></button>
        @if (mostrarCentrar()) {
          <button type="button" (click)="centrar.emit()" aria-label="Centrar"><mat-icon>my_location</mat-icon></button>
        }
      </div>
      @if (sinRed() && faltan() > 0) { <div class="aviso">Sin señal: solo se ven las partes del mapa ya descargadas</div> }
      <div class="atrib">{{ atribucion() }}</div>
    </div>
  `,
  styles: [`
    :host { display: block; position: relative; min-height: 240px; }
    .mapa { position: absolute; inset: 0; overflow: hidden; background: #E8EEF2; touch-action: none; user-select: none;
            cursor: grab; border-radius: inherit; isolation: isolate; }
    .mapa.eligiendo { cursor: crosshair; }
    .capa { position: absolute; inset: 0; }
    .mosaico { position: absolute; width: 256px; height: 256px; pointer-events: none; }
    .mosaico.vacio { visibility: hidden; }
    .vector { position: absolute; inset: 0; pointer-events: none; }
    .marca { position: absolute; transform: translate(-50%, -50%); border: 0; background: none; padding: 0; cursor: pointer;
             display: grid; place-items: center; color: var(--c); z-index: 2;
             /* sin heredar alturas mínimas de los botones globales (estiraban el punto en óvalo) */
             min-height: 0; min-width: 0; height: auto; width: auto; margin: 0; line-height: 0; }
    .yo, .punto, .bola { flex: none; box-sizing: content-box; }
    .marca.tipo-finca { transform: translate(-50%, -92%); }
    .marca.tipo-finca mat-icon { font-size: 34px; width: 34px; height: 34px; filter: drop-shadow(0 2px 2px rgb(0 0 0 / .35)); }
    .marca.sel { z-index: 4; }
    .marca.sel .bola, .marca.sel mat-icon { outline: 3px solid #111827; outline-offset: 2px; border-radius: 50%; }
    .bola { width: 34px; height: 34px; border-radius: 50%; background: var(--c); color: #fff; font: 700 12px/34px var(--font-sans, system-ui);
            text-align: center; border: 2px solid #fff; box-shadow: 0 2px 6px rgb(0 0 0 / .35); }
    .yo { width: 16px; height: 16px; border-radius: 50%; background: #2563EB; border: 3px solid #fff; box-shadow: 0 0 0 6px rgb(37 99 235 / .25); }
    .punto { width: 10px; height: 10px; border-radius: 50%; background: var(--c); border: 2px solid #fff; }
    .tenue { opacity: .45; filter: grayscale(.6); }
    .pulso { position: absolute; width: 34px; height: 34px; border-radius: 50%; background: var(--c); opacity: .35;
             animation: pulso 1.8s ease-out infinite; }
    @keyframes pulso { from { transform: scale(1); opacity: .45 } to { transform: scale(2.4); opacity: 0 } }
    .rotulo { position: absolute; top: 100%; margin-top: 3px; white-space: nowrap; font: 600 11px/1.2 var(--font-sans, system-ui);
              color: #111827; background: rgb(255 255 255 / .92); padding: 2px 6px; border-radius: 6px; pointer-events: none;
              max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
    .controles { position: absolute; right: 10px; top: 10px; display: flex; flex-direction: column; gap: 6px; z-index: 5; }
    .controles button { width: 40px; height: 40px; border-radius: 12px; border: 0; background: #fff; color: #111827;
                        box-shadow: 0 2px 8px rgb(0 0 0 / .18); display: grid; place-items: center; cursor: pointer; }
    .aviso { position: absolute; left: 10px; right: 60px; top: 10px; z-index: 5; background: #FEF3C7; color: #78350F;
             font: 600 12px/1.3 var(--font-sans, system-ui); padding: 6px 10px; border-radius: 10px; }
    .atrib { position: absolute; right: 4px; bottom: 2px; font: 10px/1.2 system-ui; color: #374151; background: rgb(255 255 255 / .7);
             padding: 1px 4px; border-radius: 4px; z-index: 5; pointer-events: none; }
  `],
})
export class MapaCampoComponent {
  readonly tilesUrl = input('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  readonly atribucion = input('© OpenStreetMap');
  readonly marcadores = input<MarcadorMapa[]>([]);
  readonly circulos = input<CirculoMapa[]>([]);
  readonly lineas = input<LineaMapa[]>([]);
  readonly elegirPunto = input(false);
  readonly mostrarCentrar = input(false);
  readonly etiquetasDesde = input(13);
  /** Centro inicial (o cuando cambia la "vista" pedida desde fuera). */
  readonly vista = input<{ lat: number; lon: number; zoom?: number } | null>(null);
  /** Encuadrar estos puntos (se aplica cuando cambia el arreglo). */
  readonly encuadrar = input<[number, number][] | null>(null);

  readonly clicMarcador = output<string>();
  readonly clicMapa = output<{ lat: number; lon: number }>();
  readonly centrar = output<void>();

  private readonly caja = viewChild.required<ElementRef<HTMLDivElement>>('caja');
  private readonly destroy = inject(DestroyRef);

  readonly zoom = signal(12);
  private readonly cx = signal(0);
  private readonly cy = signal(0);
  readonly ancho = signal(300);
  readonly alto = signal(300);
  readonly sinRed = signal(typeof navigator !== 'undefined' && !navigator.onLine);
  readonly faltan = signal(0);
  private readonly resueltos = signal(new Map<string, string>());
  private readonly pedidos = new Set<string>();
  private readonly urlsObjeto: string[] = [];

  constructor() {
    const [x, y] = aMundo(4.711, -74.072, 12); // Bogotá hasta que llegue una vista
    this.cx.set(x);
    this.cy.set(y);
    effect(() => {
      const v = this.vista();
      if (v) this.irA(v.lat, v.lon, v.zoom ?? this.zoom());
    });
    effect(() => {
      const pts = this.encuadrar();
      if (pts?.length) this.ajustar(pts);
    });
    afterNextRender(() => {
      const el = this.caja().nativeElement;
      const ro = new ResizeObserver(() => { this.ancho.set(el.clientWidth || 300); this.alto.set(el.clientHeight || 300); });
      ro.observe(el);
      const red = () => this.sinRed.set(!navigator.onLine);
      window.addEventListener('online', red);
      window.addEventListener('offline', red);
      this.destroy.onDestroy(() => {
        ro.disconnect();
        window.removeEventListener('online', red);
        window.removeEventListener('offline', red);
        this.urlsObjeto.forEach(u => URL.revokeObjectURL(u));
      });
    });
  }

  irA(lat: number, lon: number, zoom = this.zoom()): void {
    const z = Math.max(MIN_Z, Math.min(MAX_Z, Math.round(zoom)));
    const [x, y] = aMundo(lat, lon, z);
    this.zoom.set(z);
    this.cx.set(x);
    this.cy.set(y);
  }

  /** Encuadra un conjunto de puntos con algo de margen. */
  ajustar(pts: [number, number][]): void {
    if (pts.length === 1) { this.irA(pts[0][0], pts[0][1], 16); return; }
    const w = this.ancho() || 300, h = this.alto() || 300;
    for (let z = 17; z >= MIN_Z; z--) {
      const px = pts.map(p => aMundo(p[0], p[1], z));
      const xs = px.map(p => p[0]), ys = px.map(p => p[1]);
      if (Math.max(...xs) - Math.min(...xs) < w * 0.8 && Math.max(...ys) - Math.min(...ys) < h * 0.8) {
        this.zoom.set(z);
        this.cx.set((Math.max(...xs) + Math.min(...xs)) / 2);
        this.cy.set((Math.max(...ys) + Math.min(...ys)) / 2);
        return;
      }
    }
  }

  readonly mosaicos = computed(() => {
    const z = this.zoom(), w = this.ancho(), h = this.alto(), cx = this.cx(), cy = this.cy();
    const n = 2 ** z;
    const x0 = Math.floor((cx - w / 2) / TAM), x1 = Math.floor((cx + w / 2) / TAM);
    const y0 = Math.max(0, Math.floor((cy - h / 2) / TAM)), y1 = Math.min(n - 1, Math.floor((cy + h / 2) / TAM));
    const res = this.resueltos();
    const out: { k: string; src: string; x: number; y: number; listo: boolean }[] = [];
    let faltan = 0;
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const wx = ((tx % n) + n) % n;
        const url = urlMosaico(this.tilesUrl(), z, wx, ty);
        const src = res.get(url);
        if (!src) { this.pedir(url); faltan++; }
        out.push({ k: `${z}/${tx}/${ty}`, src: src ?? '', x: Math.round(tx * TAM - cx + w / 2), y: Math.round(ty * TAM - cy + h / 2), listo: !!src });
      }
    }
    queueMicrotask(() => this.faltan.set(faltan));
    return out;
  });

  private px(lat: number, lon: number): [number, number] {
    const [x, y] = aMundo(lat, lon, this.zoom());
    return [x - this.cx() + this.ancho() / 2, y - this.cy() + this.alto() / 2];
  }

  readonly marcadoresPx = computed(() => this.marcadores()
    .filter(m => Number.isFinite(m.lat) && Number.isFinite(m.lon))
    .map(m => { const [x, y] = this.px(m.lat, m.lon); return { ...m, x, y }; })
    .filter(m => m.x > -80 && m.y > -80 && m.x < this.ancho() + 80 && m.y < this.alto() + 80));

  readonly circulosPx = computed(() => {
    const z = this.zoom();
    return this.circulos().map(c => {
      const [x, y] = this.px(c.lat, c.lon);
      // metros por píxel a esa latitud
      const mpp = 156543.03392 * Math.cos(c.lat * Math.PI / 180) / 2 ** z;
      return { x, y, r: Math.max(3, c.radioM / mpp), color: c.color || '#16A34A', punteado: !!c.punteado };
    });
  });

  readonly lineasPx = computed(() => this.lineas().map(l => ({
    color: l.color || '#2563EB',
    d: l.puntos.map(p => this.px(p[0], p[1]).map(v => v.toFixed(1)).join(',')).join(' '),
  })));

  /** Mosaico desde la caché del teléfono; si no está y hay red, se baja y se guarda. */
  private pedir(url: string): void {
    if (this.pedidos.has(url)) return;
    this.pedidos.add(url);
    void MapaCampoComponent.obtener(url).then(src => {
      if (!src) { this.pedidos.delete(url); return; }
      if (src.startsWith('blob:')) this.urlsObjeto.push(src);
      this.resueltos.update(m => { const n = new Map(m); n.set(url, src); return n; });
    });
  }

  static async obtener(url: string): Promise<string | null> {
    try {
      if (typeof caches === 'undefined') return navigator.onLine ? url : null;
      const c = await caches.open(CACHE);
      const hit = await c.match(url);
      if (hit) return URL.createObjectURL(await hit.blob());
      if (!navigator.onLine) return null;
      const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!r.ok) return null;
      await c.put(url, r.clone());
      return URL.createObjectURL(await r.blob());
    } catch {
      return navigator.onLine ? url : null;
    }
  }

  /**
   * Descarga el mapa alrededor de unos puntos (las fincas del coordinador) para tenerlo sin
   * señal. Tope `max` mosaicos: los proveedores públicos no permiten descargas masivas.
   */
  static async descargarZona(plantilla: string, puntos: [number, number][], radioKm: number, zooms: number[], max: number,
                             progreso?: (hechos: number, total: number) => void): Promise<number> {
    if (typeof caches === 'undefined' || !puntos.length) return 0;
    const urls = new Set<string>();
    for (const z of zooms) {
      for (const [lat, lon] of puntos) {
        const dLat = radioKm / 111, dLon = radioKm / (111 * Math.cos(lat * Math.PI / 180));
        const [xa, ya] = aMundo(lat + dLat, lon - dLon, z), [xb, yb] = aMundo(lat - dLat, lon + dLon, z);
        for (let x = Math.floor(xa / TAM); x <= Math.floor(xb / TAM); x++) {
          for (let y = Math.floor(ya / TAM); y <= Math.floor(yb / TAM); y++) urls.add(urlMosaico(plantilla, z, x, y));
        }
      }
      if (urls.size >= max) break;
    }
    const lista = [...urls].slice(0, max);
    const c = await caches.open(CACHE);
    let hechos = 0, nuevos = 0;
    // De a 4 a la vez: rápido sin martillar al proveedor.
    for (let i = 0; i < lista.length; i += 4) {
      await Promise.all(lista.slice(i, i + 4).map(async u => {
        try {
          if (!(await c.match(u))) {
            const r = await fetch(u, { mode: 'cors', credentials: 'omit' });
            if (r.ok) { await c.put(u, r); nuevos++; }
          }
        } catch { /* sigue con los demás */ }
        hechos++;
      }));
      progreso?.(hechos, lista.length);
    }
    return nuevos;
  }

  static async mosaicosGuardados(): Promise<number> {
    try { return (await (await caches.open(CACHE)).keys()).length; } catch { return 0; }
  }

  // ─── Gestos ─────────────────────────────────────────────────────────────

  private punteros = new Map<number, { x: number; y: number }>();
  private arrastre: { x: number; y: number; cx: number; cy: number; movido: boolean } | null = null;
  private pellizco: { d: number; z: number } | null = null;

  abajo(e: PointerEvent): void {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.punteros.size === 1) this.arrastre = { x: e.clientX, y: e.clientY, cx: this.cx(), cy: this.cy(), movido: false };
    if (this.punteros.size === 2) {
      const [a, b] = [...this.punteros.values()];
      this.pellizco = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoom() };
    }
  }

  mover(e: PointerEvent): void {
    if (!this.punteros.has(e.pointerId)) return;
    this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pellizco && this.punteros.size === 2) {
      const [a, b] = [...this.punteros.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const dz = Math.round(Math.log2(d / this.pellizco.d));
      const objetivo = Math.max(MIN_Z, Math.min(MAX_Z, this.pellizco.z + dz));
      if (objetivo !== this.zoom()) this.zoomEn(objetivo, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (this.arrastre) {
      const dx = e.clientX - this.arrastre.x, dy = e.clientY - this.arrastre.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.arrastre.movido = true;
      this.cx.set(this.arrastre.cx - dx);
      this.cy.set(this.arrastre.cy - dy);
    }
  }

  arriba(e: PointerEvent): void {
    const eraToque = this.arrastre && !this.arrastre.movido && this.punteros.size === 1 && !this.pellizco;
    this.punteros.delete(e.pointerId);
    if (this.punteros.size < 2) this.pellizco = null;
    if (this.punteros.size === 0) {
      if (eraToque && e.type === 'pointerup') {
        const r = this.caja().nativeElement.getBoundingClientRect();
        const [lat, lon] = aGeo(this.cx() - this.ancho() / 2 + (e.clientX - r.left), this.cy() - this.alto() / 2 + (e.clientY - r.top), this.zoom());
        this.clicMapa.emit({ lat, lon });
      }
      this.arrastre = null;
    } else if (this.punteros.size === 1) {
      const [p] = [...this.punteros.values()];
      this.arrastre = { x: p.x, y: p.y, cx: this.cx(), cy: this.cy(), movido: true };
    }
  }

  rueda(e: WheelEvent): void {
    e.preventDefault();
    const z = this.zoom() + (e.deltaY < 0 ? 1 : -1);
    const r = this.caja().nativeElement.getBoundingClientRect();
    this.zoomEn(Math.max(MIN_Z, Math.min(MAX_Z, z)), e.clientX - r.left + r.left, e.clientY - r.top + r.top);
  }

  dobleClic(e: MouseEvent): void {
    this.zoomEn(Math.min(MAX_Z, this.zoom() + 1), e.clientX, e.clientY);
  }

  acercar(d: number): void {
    const r = this.caja().nativeElement.getBoundingClientRect();
    this.zoomEn(Math.max(MIN_Z, Math.min(MAX_Z, this.zoom() + d)), r.left + r.width / 2, r.top + r.height / 2);
  }

  /** Cambia de zoom dejando quieto el punto bajo (clientX, clientY). */
  private zoomEn(z: number, clientX: number, clientY: number): void {
    if (z === this.zoom()) return;
    const r = this.caja().nativeElement.getBoundingClientRect();
    const ox = clientX - r.left - this.ancho() / 2, oy = clientY - r.top - this.alto() / 2;
    const f = 2 ** (z - this.zoom());
    this.cx.set((this.cx() + ox) * f - ox);
    this.cy.set((this.cy() + oy) * f - oy);
    this.zoom.set(z);
    if (this.arrastre) this.arrastre = { ...this.arrastre, cx: this.cx(), cy: this.cy(), x: clientX, y: clientY };
  }
}
