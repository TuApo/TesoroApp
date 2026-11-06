import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, afterNextRender, computed, inject, input, output, signal,
} from '@angular/core';

export interface PuntoMapa {
  lat: number;
  lng: number;
  /** Lo que va dentro del marcador (número de parada, ícono corto). */
  etiqueta?: string;
  titulo?: string;
  tono?: 'pendiente' | 'ok' | 'falla' | 'origen' | 'yo' | 'elegido' | 'espera';
  /** Si viene, tocar el marcador emite `marcaTocada` con esta clave. */
  clave?: string;
}

const TAM = 256;
const ZOOM_MAX = 18;

/**
 * Mapa sin librerías: teselas de OpenStreetMap puestas a mano y una capa SVG encima con las
 * paradas, el recorrido planeado y el trazo real. Se ajusta solo a los puntos que recibe.
 *
 * <p>Con `seleccionable` un toque elige un punto (para marcar la dirección del domicilio).
 * No hay arrastre a propósito: en el celular el gesto de arrastrar compite con el scroll de
 * la página, y con +/- y tocar basta para corregir un punto.
 */
@Component({
  selector: 'eco-mapa',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lienzo" [style.height.px]="alto()" (click)="tocar($event)" [class.seleccionable]="seleccionable()">
      @for (t of teselas(); track t.url) {
        <img class="tesela" [src]="t.url" [style.left.px]="t.x" [style.top.px]="t.y" alt="" draggable="false" loading="lazy" />
      }
      <svg class="capa" [attr.width]="ancho()" [attr.height]="alto()">
        @if (planeado(); as p) { <polyline [attr.points]="p" class="planeado" /> }
        @if (recorrido(); as r) { <polyline [attr.points]="r" class="recorrido" /> }
        @for (m of marcadores(); track $index) {
          <g [attr.transform]="'translate(' + m.x + ',' + m.y + ')'" [attr.class]="'marca ' + (m.tono || 'pendiente')">
            <title>{{ m.titulo || '' }}</title>
            @if (m.tono === 'yo') {
              <circle r="14" class="halo" /><circle r="7" />
            } @else {
              <path d="M0,0 C-4,-9 -13,-13 -13,-22 A13,13 0 1,1 13,-22 C13,-13 4,-9 0,0Z" />
              <text y="-18" text-anchor="middle">{{ m.etiqueta || '' }}</text>
            }
          </g>
        }
      </svg>
      <div class="zoom">
        <button type="button" (click)="acercar(1, $event)" aria-label="Acercar">+</button>
        <button type="button" (click)="acercar(-1, $event)" aria-label="Alejar">−</button>
      </div>
      <span class="credito">© OpenStreetMap</span>
      @if (!hayPuntos()) { <div class="sin-puntos">Sin ubicaciones para mostrar</div> }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .lienzo { position: relative; overflow: hidden; border-radius: 16px; background: #e5e7eb; border: 1px solid var(--border, #e5e7eb); touch-action: pan-y; }
    .lienzo.seleccionable { cursor: crosshair; }
    .tesela { position: absolute; width: 256px; height: 256px; user-select: none; pointer-events: none; }
    .capa { position: absolute; inset: 0; pointer-events: none; }
    .planeado { fill: none; stroke: #2563eb; stroke-width: 3; stroke-dasharray: 7 6; opacity: .75; }
    .recorrido { fill: none; stroke: #059669; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
    .marca path { stroke: #fff; stroke-width: 2; }
    .marca text { fill: #fff; font: 800 12px system-ui, sans-serif; }
    .marca.pendiente path { fill: #2563eb; }
    .marca.ok path { fill: #059669; }
    .marca.falla path { fill: #dc2626; }
    .marca.origen path { fill: #0f172a; }
    .marca.elegido path { fill: #dc2626; }
    .marca.espera path { fill: #d97706; }
    .marca.yo circle { fill: #2563eb; stroke: #fff; stroke-width: 3; }
    .marca.yo .halo { fill: rgba(37,99,235,.18); stroke: none; }
    .zoom { position: absolute; right: 10px; top: 10px; display: flex; flex-direction: column; gap: 4px; }
    .zoom button { width: 34px; height: 34px; min-height: 34px !important; border-radius: 10px; border: 1px solid #cbd5e1; background: #fff; color: #0f172a; font: 700 18px system-ui; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,.12); }
    .credito { position: absolute; right: 6px; bottom: 4px; font-size: 10px; color: #334155; background: rgba(255,255,255,.75); padding: 0 4px; border-radius: 4px; }
    .sin-puntos { position: absolute; inset: 0; display: grid; place-items: center; color: #475569; font-size: 13px; background: rgba(255,255,255,.55); }
  `],
})
export class EcoMapa implements OnDestroy {
  readonly puntos = input<PuntoMapa[]>([]);
  /** Une los puntos en orden con línea punteada (la ruta planeada). */
  readonly unir = input(false);
  /** Trazo real recorrido (lo que mandó el GPS), en orden cronológico. */
  readonly trazo = input<{ lat: number; lng: number }[]>([]);
  readonly alto = input(360);
  readonly seleccionable = input(false);
  readonly elegido = output<{ lat: number; lng: number }>();
  /** Se tocó un marcador que trae `clave`. */
  readonly marcaTocada = output<string>();

  private host = inject(ElementRef<HTMLElement>);
  readonly ancho = signal(600);
  /** Ajuste manual con +/-; null = encuadre automático. */
  private readonly zoomManual = signal<number | null>(null);
  private obs?: ResizeObserver;

  constructor() {
    afterNextRender(() => {
      const medir = () => this.ancho.set(Math.max(200, Math.round(this.host.nativeElement.getBoundingClientRect().width)));
      medir();
      this.obs = new ResizeObserver(medir);
      this.obs.observe(this.host.nativeElement);
    });
  }
  ngOnDestroy(): void { this.obs?.disconnect(); }

  readonly hayPuntos = computed(() => this.todos().length > 0);
  private readonly todos = computed(() => [
    ...this.puntos().filter(p => esNum(p.lat) && esNum(p.lng)),
    ...this.trazo().filter(p => esNum(p.lat) && esNum(p.lng)),
  ]);

  /** Zoom y centro (en pixeles del mundo) que encuadran todo. */
  private readonly vista = computed(() => {
    const pts = this.todos();
    const W = this.ancho(), H = this.alto(), margen = 48;
    if (!pts.length) return { z: 11, cx: px(-74.07, 4.65, 11).x, cy: px(-74.07, 4.65, 11).y }; // Bogotá
    let z = ZOOM_MAX;
    if (pts.length > 1) {
      for (; z > 3; z--) {
        const xs = pts.map(p => px(+p.lng, +p.lat, z).x), ys = pts.map(p => px(+p.lng, +p.lat, z).y);
        if (Math.max(...xs) - Math.min(...xs) <= W - 2 * margen && Math.max(...ys) - Math.min(...ys) <= H - 2 * margen - 24) break;
      }
    } else z = 16;
    const manual = this.zoomManual();
    if (manual !== null) z = Math.max(3, Math.min(ZOOM_MAX, z + manual));
    const xs = pts.map(p => px(+p.lng, +p.lat, z).x), ys = pts.map(p => px(+p.lng, +p.lat, z).y);
    return { z, cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 - 10 };
  });

  readonly teselas = computed(() => {
    const { z, cx, cy } = this.vista();
    const W = this.ancho(), H = this.alto();
    const izq = cx - W / 2, arr = cy - H / 2, n = 2 ** z;
    const out: { url: string; x: number; y: number }[] = [];
    for (let tx = Math.floor(izq / TAM); tx <= Math.floor((izq + W) / TAM); tx++) {
      for (let ty = Math.floor(arr / TAM); ty <= Math.floor((arr + H) / TAM); ty++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n;
        out.push({ url: `https://tile.openstreetmap.org/${z}/${wx}/${ty}.png`, x: Math.round(tx * TAM - izq), y: Math.round(ty * TAM - arr) });
      }
    }
    return out;
  });

  private pantalla(lat: number, lng: number) {
    const { z, cx, cy } = this.vista();
    const p = px(lng, lat, z);
    return { x: Math.round(p.x - cx + this.ancho() / 2), y: Math.round(p.y - cy + this.alto() / 2) };
  }

  readonly marcadores = computed(() => this.puntos().filter(p => esNum(p.lat) && esNum(p.lng))
    .map(p => ({ ...p, ...this.pantalla(+p.lat, +p.lng) })));

  readonly planeado = computed(() => {
    if (!this.unir()) return null;
    const ps = this.puntos().filter(p => esNum(p.lat) && esNum(p.lng) && p.tono !== 'yo');
    return ps.length > 1 ? ps.map(p => { const s = this.pantalla(+p.lat, +p.lng); return `${s.x},${s.y}`; }).join(' ') : null;
  });

  readonly recorrido = computed(() => {
    const t = this.trazo().filter(p => esNum(p.lat) && esNum(p.lng));
    return t.length > 1 ? t.map(p => { const s = this.pantalla(+p.lat, +p.lng); return `${s.x},${s.y}`; }).join(' ') : null;
  });

  acercar(d: number, ev: Event): void {
    ev.stopPropagation();
    this.zoomManual.update(v => (v ?? 0) + d);
  }

  tocar(ev: MouseEvent): void {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    // ¿Tocó un marcador con clave? El pin se dibuja hacia arriba del punto (unos 35 px).
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    let mejor: { clave: string; d: number } | null = null;
    for (const m of this.marcadores()) {
      if (!m.clave) continue;
      const dx = x - m.x, dy = y - (m.y - 20);
      const d = dx * dx + dy * dy;
      if (Math.abs(dx) <= 16 && dy >= -18 && dy <= 22 && (!mejor || d < mejor.d)) mejor = { clave: m.clave, d };
    }
    if (mejor) { this.marcaTocada.emit(mejor.clave); return; }
    if (!this.seleccionable()) return;
    const { z, cx, cy } = this.vista();
    const wx = cx - this.ancho() / 2 + (ev.clientX - r.left), wy = cy - this.alto() / 2 + (ev.clientY - r.top);
    const n = TAM * 2 ** z;
    const lng = wx / n * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * wy / n))) * 180 / Math.PI;
    this.elegido.emit({ lat: +lat.toFixed(7), lng: +lng.toFixed(7) });
  }
}

function esNum(v: unknown): boolean { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }

/** Web Mercator: coordenadas a pixeles del mundo en el zoom z. */
function px(lng: number, lat: number, z: number) {
  const n = TAM * 2 ** z, s = Math.sin(lat * Math.PI / 180);
  return { x: (lng + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
