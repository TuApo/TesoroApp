import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Area, Croquis, ElementoCroquis, ElementosJson, PisoCroquis } from '../../service/turnos.service';

/**
 * Pinta un piso de un croquis como SVG. Es el MISMO dibujo en cuatro sitios: el editor, la
 * hoja imprimible, el televisor de la sala (mini-mapa con el área resaltada) y el celular de
 * quien tomó turno por QR. Un solo componente para que el plano que se imprimió sea
 * exactamente el que se ve en pantalla.
 *
 * <p>MEDIDAS REALES: el lienzo va en píxeles pero cada píxel vale `escalaCmPx` centímetros
 * (2 por defecto: 1 m = 50 px). Con `mostrarRegla` se dibujan reglas en metros y con
 * `mostrarCotas` cada área muestra su ancho × alto real.
 *
 * <p>PISOS: `elementos_json` v2 trae varios pisos, cada uno con su lienzo y sus elementos;
 * las áreas llevan `piso`. `piso` elige cuál se pinta (el primero si no se indica).
 *
 * <p>Solo lectura: el editor pone sus manejadores encima (misma escala, mismo viewBox).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-croquis-svg',
  imports: [],
  template: `
    <svg [attr.viewBox]="viewBox()" preserveAspectRatio="xMidYMid meet"
         class="croquis" [class.croquis--interactivo]="interactivo()"
         xmlns="http://www.w3.org/2000/svg" role="img" [attr.aria-label]="'Croquis ' + (croquis()?.nombre ?? '')">
      <defs>
        <pattern id="tn-cuadricula" [attr.width]="pxMetro() / 2" [attr.height]="pxMetro() / 2" patternUnits="userSpaceOnUse">
          <path [attr.d]="'M ' + (pxMetro() / 2) + ' 0 L 0 0 0 ' + (pxMetro() / 2)" fill="none" stroke="currentColor" stroke-opacity=".08" stroke-width="1"/>
        </pattern>
        <pattern id="tn-cuadricula-m" [attr.width]="pxMetro()" [attr.height]="pxMetro()" patternUnits="userSpaceOnUse">
          <path [attr.d]="'M ' + pxMetro() + ' 0 L 0 0 0 ' + pxMetro()" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="1"/>
        </pattern>
        <marker id="tn-flecha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/>
        </marker>
      </defs>

      <rect x="0" y="0" [attr.width]="ancho()" [attr.height]="alto()" [attr.fill]="fondo()" rx="4"/>
      @if (croquis()?.fondo_imagen_url) {
        <image [attr.href]="croquis()!.fondo_imagen_url" x="0" y="0" [attr.width]="ancho()" [attr.height]="alto()" preserveAspectRatio="xMidYMid slice" opacity=".9"/>
      }
      @if (mostrarCuadricula()) {
        <rect x="0" y="0" [attr.width]="ancho()" [attr.height]="alto()" fill="url(#tn-cuadricula)" class="cuadricula"/>
        <rect x="0" y="0" [attr.width]="ancho()" [attr.height]="alto()" fill="url(#tn-cuadricula-m)" class="cuadricula"/>
      }

      <!-- Reglas en metros -->
      @if (mostrarRegla()) {
        <g class="regla" font-family="Manrope, system-ui, sans-serif" font-size="10" fill="currentColor">
          <rect [attr.x]="-margen()" [attr.y]="-margen()" [attr.width]="ancho() + margen()" [attr.height]="margen()" fill="currentColor" fill-opacity=".05"/>
          <rect [attr.x]="-margen()" [attr.y]="-margen()" [attr.width]="margen()" [attr.height]="alto() + margen()" fill="currentColor" fill-opacity=".05"/>
          @for (m of marcasX(); track m.px) {
            <line [attr.x1]="m.px" [attr.y1]="-margen() + (m.mayor ? 8 : 14)" [attr.x2]="m.px" y2="0" stroke="currentColor" [attr.stroke-opacity]="m.mayor ? .6 : .3" stroke-width="1"/>
            @if (m.mayor) { <text [attr.x]="m.px + 3" [attr.y]="-margen() + 12" opacity=".8">{{ m.m }} m</text> }
          }
          @for (m of marcasY(); track m.px) {
            <line [attr.x1]="-margen() + (m.mayor ? 8 : 14)" [attr.y1]="m.px" x2="0" [attr.y2]="m.px" stroke="currentColor" [attr.stroke-opacity]="m.mayor ? .6 : .3" stroke-width="1"/>
            @if (m.mayor && m.m > 0) { <text [attr.x]="-margen() + 2" [attr.y]="m.px - 3" opacity=".8" [attr.transform]="'rotate(-90 ' + (-margen() + 2) + ' ' + (m.px - 3) + ')'">{{ m.m }} m</text> }
          }
          <text [attr.x]="ancho() - 4" [attr.y]="alto() + 14" text-anchor="end" opacity=".7">{{ metros(ancho()) }} × {{ metros(alto()) }} m · 1 px = {{ escala() }} cm</text>
        </g>
      }

      <!-- Elementos: paredes, puertas, ventanas, sillas, mesas, textos, flechas, iconos -->
      @for (e of elementos(); track e.id) {
        <g [attr.transform]="'rotate(' + (e.rotacion || 0) + ' ' + (e.x + e.ancho / 2) + ' ' + (e.y + e.alto / 2) + ')'"
           class="elemento" [class.seleccionado]="seleccionId() === e.id"
           (pointerdown)="interactivo() && elegir.emit({ tipo: 'elemento', id: e.id, evento: $event })">
          @switch (e.tipo) {
            @case ('PARED') {
              <rect [attr.x]="e.x" [attr.y]="e.y" [attr.width]="e.ancho" [attr.height]="e.alto" [attr.fill]="e.color || '#334155'" rx="1"/>
            }
            @case ('PUERTA') {
              <rect [attr.x]="e.x" [attr.y]="e.y + e.alto - 4" [attr.width]="e.ancho" height="4" [attr.fill]="e.color || '#334155'"/>
              <line [attr.x1]="e.x" [attr.y1]="e.y + e.alto - 2" [attr.x2]="e.x" [attr.y2]="e.y + e.alto - 2 - e.ancho" [attr.stroke]="e.color || '#334155'" stroke-width="3" stroke-linecap="round"/>
              <path [attr.d]="'M ' + e.x + ' ' + (e.y + e.alto - 2 - e.ancho) + ' A ' + e.ancho + ' ' + e.ancho + ' 0 0 1 ' + (e.x + e.ancho) + ' ' + (e.y + e.alto - 2)"
                    fill="none" [attr.stroke]="e.color || '#334155'" stroke-width="1" stroke-dasharray="4 3"/>
            }
            @case ('VENTANA') {
              <rect [attr.x]="e.x" [attr.y]="e.y" [attr.width]="e.ancho" [attr.height]="e.alto" fill="#E0F2FE" [attr.stroke]="e.color || '#0369A1'" stroke-width="1.5"/>
              <line [attr.x1]="e.x" [attr.y1]="e.y + e.alto / 2" [attr.x2]="e.x + e.ancho" [attr.y2]="e.y + e.alto / 2" [attr.stroke]="e.color || '#0369A1'" stroke-width="1"/>
            }
            @case ('SILLA') {
              @for (i of asientos(e); track i) {
                <rect [attr.x]="e.x + i * (e.ancho / (e.cantidad || 1)) + 2" [attr.y]="e.y + e.alto * .3" [attr.width]="e.ancho / (e.cantidad || 1) - 4" [attr.height]="e.alto * .7 - 2"
                      [attr.fill]="e.color || '#94A3B8'" rx="4"/>
                <rect [attr.x]="e.x + i * (e.ancho / (e.cantidad || 1)) + 2" [attr.y]="e.y" [attr.width]="e.ancho / (e.cantidad || 1) - 4" [attr.height]="e.alto * .28"
                      [attr.fill]="e.color || '#94A3B8'" rx="3" opacity=".75"/>
              }
              @if ((e.cantidad || 1) > 1) {
                <rect [attr.x]="e.x" [attr.y]="e.y + e.alto - 3" [attr.width]="e.ancho" height="3" [attr.fill]="e.color || '#94A3B8'" opacity=".6"/>
              }
            }
            @case ('MOSTRADOR') {
              <rect [attr.x]="e.x" [attr.y]="e.y" [attr.width]="e.ancho" [attr.height]="e.alto" [attr.fill]="e.color || '#CBD5E1'" stroke="#64748B" stroke-width="1.5" rx="3"/>
              <line [attr.x1]="e.x + 4" [attr.y1]="e.y + e.alto - 5" [attr.x2]="e.x + e.ancho - 4" [attr.y2]="e.y + e.alto - 5" stroke="#64748B" stroke-width="1" opacity=".6"/>
            }
            @case ('FLECHA') {
              <line [attr.x1]="e.x" [attr.y1]="e.y + e.alto / 2" [attr.x2]="e.x + e.ancho" [attr.y2]="e.y + e.alto / 2"
                    [attr.stroke]="e.color || '#2B59F0'" [attr.stroke-width]="e.grosor || 4" stroke-linecap="round" marker-end="url(#tn-flecha)" [style.color]="e.color || '#2B59F0'"/>
            }
            @case ('TEXTO') {
              <text [attr.x]="e.x" [attr.y]="e.y + (e.tamano || 16)" [attr.font-size]="e.tamano || 16" [attr.fill]="e.color || '#0F1B2D'" font-weight="700" font-family="Manrope, system-ui, sans-serif">{{ e.texto }}</text>
            }
            @case ('MESA') {
              <rect [attr.x]="e.x" [attr.y]="e.y" [attr.width]="e.ancho" [attr.height]="e.alto" [attr.fill]="e.color || '#CBD5E1'" stroke="#94A3B8" rx="6"/>
            }
            @case ('PLANTA') {
              <circle [attr.cx]="e.x + e.ancho / 2" [attr.cy]="e.y + e.alto / 2" [attr.r]="e.ancho / 2" [attr.fill]="e.color || '#86C22E'" opacity=".8"/>
              <circle [attr.cx]="e.x + e.ancho / 2" [attr.cy]="e.y + e.alto / 2" [attr.r]="e.ancho / 4" fill="#5E8F17" opacity=".7"/>
            }
            @case ('ICONO') {
              <text [attr.x]="e.x + e.ancho / 2" [attr.y]="e.y + e.alto / 2 + (e.tamano || 24) * .36" [attr.font-size]="e.tamano || 24" text-anchor="middle" font-family="Material Icons" [attr.fill]="e.color || '#44526A'">{{ e.icono || 'place' }}</text>
            }
          }
          @if (mostrarCotas() && (e.tipo === 'SILLA' || e.tipo === 'MESA' || e.tipo === 'MOSTRADOR' || e.tipo === 'PARED') && seleccionId() === e.id) {
            <text [attr.x]="e.x + e.ancho / 2" [attr.y]="e.y - 4" text-anchor="middle" font-size="9" fill="currentColor" opacity=".7" font-family="Manrope, system-ui, sans-serif">{{ metros(e.ancho) }} m</text>
          }
          @if (interactivo()) {
            <rect [attr.x]="e.x - 3" [attr.y]="e.y - 3" [attr.width]="e.ancho + 6" [attr.height]="e.alto + 6" fill="transparent" stroke="var(--brand-blue)" stroke-width="1.5" stroke-dasharray="4 3" class="marco"/>
            @if (seleccionId() === e.id) {
              <rect [attr.x]="e.x + e.ancho - 6" [attr.y]="e.y + e.alto - 6" width="12" height="12" fill="var(--brand-blue)" rx="2" class="asa"
                    (pointerdown)="$event.stopPropagation(); elegir.emit({ tipo: 'elemento', id: e.id, evento: $event, asa: true })"/>
              <line [attr.x1]="e.x + e.ancho / 2" [attr.y1]="e.y - 3" [attr.x2]="e.x + e.ancho / 2" [attr.y2]="e.y - 22" stroke="var(--brand-blue)" stroke-width="1.5"/>
              <circle [attr.cx]="e.x + e.ancho / 2" [attr.cy]="e.y - 26" r="7" fill="var(--surface, #fff)" stroke="var(--brand-blue)" stroke-width="2" class="rotor"
                      (pointerdown)="$event.stopPropagation(); elegir.emit({ tipo: 'elemento', id: e.id, evento: $event, rotar: true })"/>
            }
          }
        </g>
      }

      <!-- Áreas: lo que el cartel traduce a "su turno se atiende en X, al lado Y" -->
      @for (a of areas(); track a.id) {
        <g [attr.transform]="'rotate(' + (a.rotacion || 0) + ' ' + (a.x + a.ancho / 2) + ' ' + (a.y + a.alto / 2) + ')'"
           class="area" [class.seleccionado]="seleccionId() === a.id" [class.resaltada]="resaltar() === a.id"
           (pointerdown)="interactivo() && elegir.emit({ tipo: 'area', id: a.id, evento: $event })">
          @switch (a.forma) {
            @case ('CIRCULO') {
              <ellipse [attr.cx]="a.x + a.ancho / 2" [attr.cy]="a.y + a.alto / 2" [attr.rx]="a.ancho / 2" [attr.ry]="a.alto / 2"
                       [attr.fill]="relleno(a)" [attr.stroke]="borde(a)" stroke-width="2"/>
            }
            @case ('POLIGONO') {
              <polygon [attr.points]="poligono(a)" [attr.fill]="relleno(a)" [attr.stroke]="borde(a)" stroke-width="2" stroke-linejoin="round"/>
            }
            @default {
              <rect [attr.x]="a.x" [attr.y]="a.y" [attr.width]="a.ancho" [attr.height]="a.alto"
                    [attr.rx]="a.forma === 'REDONDEADO' ? 14 : 4"
                    [attr.fill]="relleno(a)" [attr.stroke]="borde(a)" stroke-width="2"/>
            }
          }
          <text [attr.x]="a.x + a.ancho / 2" [attr.y]="a.y + a.alto / 2 - (a.codigo || mostrarCotas() ? 4 : -5)" text-anchor="middle"
                [attr.font-size]="tamanoTexto(a)" font-weight="800" [attr.fill]="texto(a)" font-family="Manrope, system-ui, sans-serif">{{ a.nombre }}</text>
          @if (a.codigo) {
            <text [attr.x]="a.x + a.ancho / 2" [attr.y]="a.y + a.alto / 2 + tamanoTexto(a) + 2" text-anchor="middle"
                  [attr.font-size]="tamanoTexto(a) * .8" font-weight="700" [attr.fill]="texto(a)" opacity=".85" font-family="ui-monospace, monospace">{{ a.codigo }}</text>
          }
          @if (mostrarCotas()) {
            <text [attr.x]="a.x + a.ancho / 2" [attr.y]="a.y + a.alto / 2 + tamanoTexto(a) * (a.codigo ? 1.9 : 1) + 4" text-anchor="middle"
                  [attr.font-size]="tamanoTexto(a) * .7" [attr.fill]="texto(a)" opacity=".75" font-family="Manrope, system-ui, sans-serif">{{ metros(a.ancho) }} × {{ metros(a.alto) }} m</text>
          }
          @if (a.icono) {
            <text [attr.x]="a.x + 12" [attr.y]="a.y + 20" font-size="16" font-family="Material Icons" [attr.fill]="texto(a)" opacity=".9">{{ a.icono }}</text>
          }
          <!-- Puestos: una cabecita por persona que atiende aquí; el apoyo móvil, caminando -->
          @if (mostrarPuestos() && (a.capacidad || 0) > 0) {
            @for (i of cabezas(a); track i) {
              <circle [attr.cx]="a.x + a.ancho - 10 - i * 12" [attr.cy]="a.y + 11" r="4.5" [attr.fill]="ocupado(a, i) ? borde(a) : 'none'" [attr.stroke]="borde(a)" stroke-width="1.5"/>
            }
            @if (a.movil) {
              <text [attr.x]="a.x + a.ancho - 10 - cabezas(a).length * 12 - 8" [attr.y]="a.y + 17" font-size="14" text-anchor="end" font-family="Material Icons" [attr.fill]="borde(a)">directions_walk</text>
            }
            @if ((a.capacidad || 0) > 6) {
              <text [attr.x]="a.x + a.ancho - 10 - cabezas(a).length * 12 - 4" [attr.y]="a.y + 15" font-size="10" text-anchor="end" font-weight="800" [attr.fill]="borde(a)" font-family="Manrope, system-ui, sans-serif">×{{ a.capacidad }}</text>
            }
          }
          @if (interactivo()) {
            <rect [attr.x]="a.x - 3" [attr.y]="a.y - 3" [attr.width]="a.ancho + 6" [attr.height]="a.alto + 6" fill="transparent" stroke="var(--brand-blue)" stroke-width="1.5" stroke-dasharray="4 3" class="marco"/>
            @if (seleccionId() === a.id) {
              <rect [attr.x]="a.x + a.ancho - 6" [attr.y]="a.y + a.alto - 6" width="12" height="12" fill="var(--brand-blue)" rx="2" class="asa"
                    (pointerdown)="$event.stopPropagation(); elegir.emit({ tipo: 'area', id: a.id, evento: $event, asa: true })"/>
              <line [attr.x1]="a.x + a.ancho / 2" [attr.y1]="a.y - 3" [attr.x2]="a.x + a.ancho / 2" [attr.y2]="a.y - 22" stroke="var(--brand-blue)" stroke-width="1.5"/>
              <circle [attr.cx]="a.x + a.ancho / 2" [attr.cy]="a.y - 26" r="7" fill="var(--surface, #fff)" stroke="var(--brand-blue)" stroke-width="2" class="rotor"
                      (pointerdown)="$event.stopPropagation(); elegir.emit({ tipo: 'area', id: a.id, evento: $event, rotar: true })"/>
              <!-- Cotas de la selección -->
              <line [attr.x1]="a.x" [attr.y1]="a.y + a.alto + 12" [attr.x2]="a.x + a.ancho" [attr.y2]="a.y + a.alto + 12" stroke="var(--brand-blue)" stroke-width="1" marker-start="url(#tn-flecha)" marker-end="url(#tn-flecha)" style="color: var(--brand-blue)"/>
              <text [attr.x]="a.x + a.ancho / 2" [attr.y]="a.y + a.alto + 24" text-anchor="middle" font-size="10" fill="var(--brand-blue)" font-weight="700" font-family="Manrope, system-ui, sans-serif">{{ metros(a.ancho) }} m</text>
              <line [attr.x1]="a.x + a.ancho + 12" [attr.y1]="a.y" [attr.x2]="a.x + a.ancho + 12" [attr.y2]="a.y + a.alto" stroke="var(--brand-blue)" stroke-width="1" marker-start="url(#tn-flecha)" marker-end="url(#tn-flecha)" style="color: var(--brand-blue)"/>
              <text [attr.x]="a.x + a.ancho + 16" [attr.y]="a.y + a.alto / 2 + 4" font-size="10" fill="var(--brand-blue)" font-weight="700" font-family="Manrope, system-ui, sans-serif">{{ metros(a.alto) }} m</text>
            }
          }
        </g>
      }
      <ng-content />
    </svg>
  `,
  styles: [`
    :host { display: block; width: 100%; color: var(--text, #0F1B2D); }
    .croquis { width: 100%; height: auto; display: block; border-radius: 8px; overflow: visible; }
    .croquis--interactivo .area, .croquis--interactivo .elemento { cursor: grab; }
    .croquis--interactivo .asa { cursor: nwse-resize; }
    .croquis--interactivo .rotor { cursor: grab; }
    .marco { opacity: 0; pointer-events: none; }
    .seleccionado .marco { opacity: 1; }
    .croquis--interactivo .area:hover .marco, .croquis--interactivo .elemento:hover .marco { opacity: .45; }
    .resaltada rect, .resaltada ellipse, .resaltada polygon { filter: drop-shadow(0 0 10px rgba(155, 212, 65, .9)); animation: tn-late 1.2s ease-in-out infinite; }
    @keyframes tn-late { 0%, 100% { stroke-width: 2; } 50% { stroke-width: 6; } }
    .cuadricula, .regla { pointer-events: none; }
  `],
})
export class CroquisSvg {
  readonly croquis = input<Croquis | null>(null);
  /** Áreas a pintar (todas: aquí se filtran por piso); si no se pasan, se toman del croquis. */
  readonly areasEntrada = input<Area[] | null>(null);
  /** Elementos DEL PISO ACTUAL; si no se pasan, salen del elementos_json del croquis. */
  readonly elementosEntrada = input<ElementoCroquis[] | null>(null);
  /** Pisos en edición (el editor los pasa); si no, salen del croquis. */
  readonly pisosEntrada = input<PisoCroquis[] | null>(null);
  /** Id del piso a pintar; null = el primero. */
  readonly piso = input<string | null>(null);
  readonly interactivo = input(false);
  readonly mostrarCuadricula = input(false);
  readonly mostrarRegla = input(false);
  readonly mostrarCotas = input(false);
  readonly mostrarPuestos = input(true);
  /** Centímetros por píxel; si no se pasa, el del croquis (2 = 1 m son 50 px). */
  readonly escalaEntrada = input<number | null>(null);
  readonly seleccionId = input<string | null>(null);
  /** Id del área a resaltar (el televisor al cantar un turno). */
  readonly resaltar = input<string | null>(null);

  readonly elegir = output<{ tipo: 'area' | 'elemento'; id: string; evento: PointerEvent; asa?: boolean; rotar?: boolean }>();

  readonly pisos = computed<PisoCroquis[]>(() => this.pisosEntrada() ?? leerPisos(this.croquis()));
  readonly pisoActual = computed<PisoCroquis>(() => {
    const lista = this.pisos();
    return lista.find(p => p.id === this.piso()) ?? lista[0] ?? { id: 'p1', nombre: 'Piso 1', ancho: 1200, alto: 800, elementos: [] };
  });
  readonly ancho = computed(() => this.pisoActual().ancho || this.croquis()?.ancho || 1200);
  readonly alto = computed(() => this.pisoActual().alto || this.croquis()?.alto || 800);
  readonly fondo = computed(() => this.croquis()?.fondo_color || '#FFFFFF');
  readonly escala = computed(() => this.escalaEntrada() ?? (Number(this.croquis()?.escala_cm_px) || 2));
  readonly pxMetro = computed(() => 100 / this.escala());
  readonly margen = computed(() => (this.mostrarRegla() ? 24 : 0));
  readonly viewBox = computed(() => `${-this.margen()} ${-this.margen()} ${this.ancho() + this.margen() + (this.mostrarRegla() ? 8 : 0)} ${this.alto() + this.margen() + (this.mostrarRegla() ? 18 : 0)}`);

  readonly areas = computed<Area[]>(() => {
    const todas = (this.areasEntrada() ?? this.croquis()?.areas ?? []).filter(a => a.activa !== false);
    const pisoId = this.pisoActual().id;
    const esPrimero = this.pisos()[0]?.id === pisoId;
    return todas.filter(a => a.piso === pisoId || (!a.piso && esPrimero) || (a.piso && !this.pisos().some(p => p.id === a.piso) && esPrimero));
  });
  readonly elementos = computed<ElementoCroquis[]>(() => this.elementosEntrada() ?? this.pisoActual().elementos ?? []);

  readonly marcasX = computed(() => marcas(this.ancho(), this.pxMetro()));
  readonly marcasY = computed(() => marcas(this.alto(), this.pxMetro()));

  metros(px: number): string { return (px * this.escala() / 100).toFixed(2).replace(/\.?0+$/, '') || '0'; }
  asientos(e: ElementoCroquis): number[] { return Array.from({ length: Math.max(1, Math.min(4, e.cantidad || 1)) }, (_, i) => i); }
  cabezas(a: Area): number[] { return Array.from({ length: Math.min(6, a.capacidad || 0) }, (_, i) => i); }
  ocupado(a: Area, i: number): boolean { const p = a.puestos?.[i]; return !!p?.usuario_ref; }
  relleno(a: Area): string { return a.color ? conAlfa(a.color, .22) : COLOR_TIPO[a.tipo]?.fondo ?? '#EEF2FF'; }
  borde(a: Area): string { return a.color || COLOR_TIPO[a.tipo]?.borde || '#2B59F0'; }
  texto(a: Area): string { return a.color || COLOR_TIPO[a.tipo]?.borde || '#1E44C8'; }
  tamanoTexto(a: Area): number { return Math.max(9, Math.min(18, Math.min(a.ancho / Math.max(6, a.nombre.length) * 1.7, a.alto / 3.2))); }
  poligono(a: Area): string {
    const pts = leerPuntos(a.puntos_json);
    if (!pts.length) return `${a.x},${a.y} ${a.x + a.ancho},${a.y} ${a.x + a.ancho},${a.y + a.alto} ${a.x},${a.y + a.alto}`;
    return pts.map(p => `${a.x + p[0]},${a.y + p[1]}`).join(' ');
  }
}

function marcas(largo: number, pxMetro: number): { px: number; m: number; mayor: boolean }[] {
  const out: { px: number; m: number; mayor: boolean }[] = [];
  const paso = pxMetro / 2;
  if (paso <= 0) return out;
  for (let px = 0, i = 0; px <= largo + 0.01; px += paso, i++) out.push({ px, m: i / 2, mayor: i % 2 === 0 });
  return out;
}

/** Colores por tipo de área cuando no se eligió uno a mano. */
export const COLOR_TIPO: Record<string, { fondo: string; borde: string }> = {
  RECEPCION: { fondo: '#EEF2FF', borde: '#2B59F0' },
  MODULO: { fondo: '#ECFCCB', borde: '#4E8A12' },
  VENTANILLA: { fondo: '#DBEAFE', borde: '#1D4ED8' },
  PUESTO: { fondo: '#ECFCCB', borde: '#3F7A0E' },
  OFICINA: { fondo: '#EDE9FE', borde: '#6D28D9' },
  AREA_ATENCION: { fondo: '#FFEDD5', borde: '#C2410C' },
  SALA_ESPERA: { fondo: '#F1F5F9', borde: '#64748B' },
  PASILLO: { fondo: '#F8FAFC', borde: '#94A3B8' },
  BANO: { fondo: '#E0F2FE', borde: '#0369A1' },
  SALIDA: { fondo: '#FEE2E2', borde: '#B91C1C' },
  ENTRADA: { fondo: '#DCFCE7', borde: '#166534' },
  ESCALERA: { fondo: '#FEF3C7', borde: '#92400E' },
  ASCENSOR: { fondo: '#FEF3C7', borde: '#92400E' },
  OTRO: { fondo: '#F1F5F9', borde: '#475569' },
};

/** Pisos del croquis: lee el formato v2 o envuelve el array plano (v1) como un solo piso. */
export function leerPisos(c: Croquis | null | undefined): PisoCroquis[] {
  const ancho = c?.ancho || 1200, alto = c?.alto || 800;
  const vacio: PisoCroquis[] = [{ id: 'p1', nombre: 'Piso 1', ancho, alto, elementos: [] }];
  if (!c?.elementos_json) return vacio;
  try {
    const v = JSON.parse(c.elementos_json);
    if (Array.isArray(v)) return [{ id: 'p1', nombre: 'Piso 1', ancho, alto, elementos: v }];
    if (v && typeof v === 'object' && Array.isArray((v as ElementosJson).pisos) && (v as ElementosJson).pisos.length) {
      return (v as ElementosJson).pisos.map((p, i) => ({
        id: p.id || `p${i + 1}`, nombre: p.nombre || `Piso ${i + 1}`,
        ancho: p.ancho || ancho, alto: p.alto || alto, elementos: Array.isArray(p.elementos) ? p.elementos : [],
      }));
    }
  } catch { /* JSON viejo o roto */ }
  return vacio;
}

export function serializarPisos(pisos: PisoCroquis[]): string {
  const doc: ElementosJson = { v: 2, pisos };
  return JSON.stringify(doc);
}

/** Compatibilidad: los elementos del primer piso. */
export function leerElementos(json: string | null | undefined): ElementoCroquis[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.pisos)) return v.pisos[0]?.elementos ?? [];
  } catch { /* nada */ }
  return [];
}

export function leerPuntos(json: string | null | undefined): [number, number][] {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
}

function conAlfa(hex: string, alfa: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}
