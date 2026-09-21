import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Area, Croquis, ElementoCroquis } from '../../service/turnos.service';

/**
 * Pinta un croquis como SVG. Es el MISMO dibujo en cuatro sitios: el editor, la hoja
 * imprimible, el televisor de la sala (mini-mapa con el área resaltada) y el celular
 * de quien tomó turno por QR. Un solo componente para que el plano que se imprimió sea
 * exactamente el que se ve en pantalla.
 *
 * <p>Solo lectura: el editor pone sus propios manejadores encima (misma escala, mismo
 * viewBox), así que aquí no hay estado ni eventos de arrastre. `resaltar` marca un área.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-croquis-svg',
  imports: [],
  template: `
    <svg [attr.viewBox]="'0 0 ' + ancho() + ' ' + alto()" preserveAspectRatio="xMidYMid meet"
         class="croquis" [class.croquis--interactivo]="interactivo()"
         xmlns="http://www.w3.org/2000/svg" role="img" [attr.aria-label]="'Croquis ' + (croquis()?.nombre ?? '')">
      <defs>
        <pattern id="tn-cuadricula" [attr.width]="cuadricula()" [attr.height]="cuadricula()" patternUnits="userSpaceOnUse">
          <path [attr.d]="'M ' + cuadricula() + ' 0 L 0 0 0 ' + cuadricula()" fill="none" stroke="currentColor" stroke-opacity=".12" stroke-width="1"/>
        </pattern>
        <marker id="tn-flecha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/>
        </marker>
      </defs>

      <rect x="0" y="0" [attr.width]="ancho()" [attr.height]="alto()" [attr.fill]="fondo()" rx="8"/>
      @if (croquis()?.fondo_imagen_url) {
        <image [attr.href]="croquis()!.fondo_imagen_url" x="0" y="0" [attr.width]="ancho()" [attr.height]="alto()" preserveAspectRatio="xMidYMid slice" opacity=".9"/>
      }
      @if (mostrarCuadricula()) {
        <rect x="0" y="0" [attr.width]="ancho()" [attr.height]="alto()" fill="url(#tn-cuadricula)" class="cuadricula"/>
      }

      <!-- Elementos decorativos: paredes, puertas, textos, flechas, iconos -->
      @for (e of elementos(); track e.id) {
        <g [attr.transform]="'rotate(' + (e.rotacion || 0) + ' ' + (e.x + e.ancho / 2) + ' ' + (e.y + e.alto / 2) + ')'"
           class="elemento" [class.seleccionado]="seleccionId() === e.id"
           (pointerdown)="interactivo() && elegir.emit({ tipo: 'elemento', id: e.id, evento: $event })">
          @switch (e.tipo) {
            @case ('PARED') {
              <rect [attr.x]="e.x" [attr.y]="e.y" [attr.width]="e.ancho" [attr.height]="e.alto" [attr.fill]="e.color || '#334155'" rx="1"/>
            }
            @case ('PUERTA') {
              <rect [attr.x]="e.x" [attr.y]="e.y" [attr.width]="e.ancho" [attr.height]="e.alto" fill="#fff" [attr.stroke]="e.color || '#334155'" stroke-width="2" rx="2"/>
              <path [attr.d]="'M ' + e.x + ' ' + (e.y + e.alto) + ' A ' + e.ancho + ' ' + e.ancho + ' 0 0 1 ' + (e.x + e.ancho) + ' ' + (e.y + e.alto - e.ancho)"
                    fill="none" [attr.stroke]="e.color || '#334155'" stroke-width="1.5" stroke-dasharray="4 3"/>
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
          @if (interactivo()) {
            <rect [attr.x]="e.x - 3" [attr.y]="e.y - 3" [attr.width]="e.ancho + 6" [attr.height]="e.alto + 6" fill="transparent" stroke="var(--brand-blue)" stroke-width="1.5" stroke-dasharray="4 3" class="marco"/>
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
          <text [attr.x]="a.x + a.ancho / 2" [attr.y]="a.y + a.alto / 2 - (a.codigo ? 4 : -5)" text-anchor="middle"
                [attr.font-size]="tamanoTexto(a)" font-weight="800" [attr.fill]="texto(a)" font-family="Manrope, system-ui, sans-serif">{{ a.nombre }}</text>
          @if (a.codigo) {
            <text [attr.x]="a.x + a.ancho / 2" [attr.y]="a.y + a.alto / 2 + tamanoTexto(a) + 2" text-anchor="middle"
                  [attr.font-size]="tamanoTexto(a) * .8" font-weight="700" [attr.fill]="texto(a)" opacity=".85" font-family="ui-monospace, monospace">{{ a.codigo }}</text>
          }
          @if (a.icono) {
            <text [attr.x]="a.x + 12" [attr.y]="a.y + 20" font-size="16" font-family="Material Icons" [attr.fill]="texto(a)" opacity=".9">{{ a.icono }}</text>
          }
          @if (interactivo()) {
            <rect [attr.x]="a.x - 3" [attr.y]="a.y - 3" [attr.width]="a.ancho + 6" [attr.height]="a.alto + 6" fill="transparent" stroke="var(--brand-blue)" stroke-width="1.5" stroke-dasharray="4 3" class="marco"/>
            <rect [attr.x]="a.x + a.ancho - 6" [attr.y]="a.y + a.alto - 6" width="12" height="12" fill="var(--brand-blue)" rx="2" class="asa"
                  (pointerdown)="$event.stopPropagation(); elegir.emit({ tipo: 'area', id: a.id, evento: $event, asa: true })"/>
          }
        </g>
      }
      <ng-content />
    </svg>
  `,
  styles: [`
    :host { display: block; width: 100%; color: var(--text, #0F1B2D); }
    .croquis { width: 100%; height: auto; display: block; border-radius: 8px; }
    .croquis--interactivo .area, .croquis--interactivo .elemento { cursor: grab; }
    .croquis--interactivo .asa { cursor: nwse-resize; }
    .marco { opacity: 0; pointer-events: none; }
    .seleccionado .marco { opacity: 1; }
    .croquis--interactivo .area:hover .marco, .croquis--interactivo .elemento:hover .marco { opacity: .45; }
    .resaltada rect, .resaltada ellipse, .resaltada polygon { filter: drop-shadow(0 0 10px rgba(155, 212, 65, .9)); animation: tn-late 1.2s ease-in-out infinite; }
    @keyframes tn-late { 0%, 100% { stroke-width: 2; } 50% { stroke-width: 6; } }
    .cuadricula { pointer-events: none; }
  `],
})
export class CroquisSvg {
  readonly croquis = input<Croquis | null>(null);
  /** Áreas a pintar; si no se pasan, se toman del croquis. El editor pasa las suyas (en edición). */
  readonly areasEntrada = input<Area[] | null>(null);
  readonly elementosEntrada = input<ElementoCroquis[] | null>(null);
  readonly interactivo = input(false);
  readonly mostrarCuadricula = input(false);
  readonly cuadricula = input(20);
  readonly seleccionId = input<string | null>(null);
  /** Id del área a resaltar (el televisor al cantar un turno). */
  readonly resaltar = input<string | null>(null);

  readonly elegir = output<{ tipo: 'area' | 'elemento'; id: string; evento: PointerEvent; asa?: boolean }>();

  readonly ancho = computed(() => this.croquis()?.ancho ?? 1200);
  readonly alto = computed(() => this.croquis()?.alto ?? 800);
  readonly fondo = computed(() => this.croquis()?.fondo_color || '#FFFFFF');
  readonly areas = computed<Area[]>(() => (this.areasEntrada() ?? this.croquis()?.areas ?? []).filter(a => a.activa !== false));
  readonly elementos = computed<ElementoCroquis[]>(() => {
    if (this.elementosEntrada()) return this.elementosEntrada()!;
    return leerElementos(this.croquis()?.elementos_json);
  });

  relleno(a: Area): string { return a.color ? conAlfa(a.color, .22) : COLOR_TIPO[a.tipo]?.fondo ?? '#EEF2FF'; }
  borde(a: Area): string { return a.color || COLOR_TIPO[a.tipo]?.borde || '#2B59F0'; }
  texto(a: Area): string { return a.color || COLOR_TIPO[a.tipo]?.borde || '#1E44C8'; }
  tamanoTexto(a: Area): number { return Math.max(10, Math.min(18, Math.min(a.ancho / Math.max(6, a.nombre.length) * 1.7, a.alto / 3))); }
  poligono(a: Area): string {
    const pts = leerPuntos(a.puntos_json);
    if (!pts.length) return `${a.x},${a.y} ${a.x + a.ancho},${a.y} ${a.x + a.ancho},${a.y + a.alto} ${a.x},${a.y + a.alto}`;
    return pts.map(p => `${a.x + p[0]},${a.y + p[1]}`).join(' ');
  }
}

/** Colores por tipo de área cuando no se eligió uno a mano. */
export const COLOR_TIPO: Record<string, { fondo: string; borde: string }> = {
  RECEPCION: { fondo: '#EEF2FF', borde: '#2B59F0' },
  MODULO: { fondo: '#ECFCCB', borde: '#4E8A12' },
  VENTANILLA: { fondo: '#DBEAFE', borde: '#1D4ED8' },
  SALA_ESPERA: { fondo: '#F1F5F9', borde: '#64748B' },
  OFICINA: { fondo: '#EDE9FE', borde: '#6D28D9' },
  BANO: { fondo: '#E0F2FE', borde: '#0369A1' },
  SALIDA: { fondo: '#FEE2E2', borde: '#B91C1C' },
  ENTRADA: { fondo: '#DCFCE7', borde: '#166534' },
  ESCALERA: { fondo: '#FEF3C7', borde: '#92400E' },
  ASCENSOR: { fondo: '#FEF3C7', borde: '#92400E' },
  OTRO: { fondo: '#F1F5F9', borde: '#475569' },
};

export function leerElementos(json: string | null | undefined): ElementoCroquis[] {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
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
