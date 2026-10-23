import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  ActivoCroquis, Area, Croquis, ElementoCroquis, ElementosJson, MetaArea, PisoCroquis,
} from '../../service/turnos.service';

/**
 * Pinta un piso de un croquis como SVG. Es el MISMO dibujo en varios sitios: el editor (vista
 * 2D), la hoja imprimible, el televisor de la sala (cuando no hay 3D) y el celular de quien tomó
 * turno por QR. Un solo componente para que el plano que se imprimió sea el que se ve en pantalla.
 *
 * <p>MEDIDAS REALES: el lienzo va en píxeles pero cada píxel vale `escalaCmPx` centímetros
 * (2 por defecto: 1 m = 50 px). Con `mostrarRegla` se dibujan reglas en metros y con
 * `mostrarCotas` cada área muestra su ancho × alto real.
 *
 * <p>PISOS: `elementos_json` v2/v3 trae varios pisos, cada uno con su lienzo y sus elementos;
 * las áreas llevan `piso`. `piso` elige cuál se pinta (el primero si no se indica).
 *
 * <p>ORDEN DE DIBUJO: primero las áreas (el "suelo" de cada zona, translúcido) y encima los
 * muebles y paredes. Así una pared o un escritorio dentro de un área se ven y se pueden tocar.
 *
 * <p>LLAMADOS: `resaltar` (área) y `resaltarPuesto` (punto de atención) encienden una baliza
 * donde tiene que ir la persona y hacen parpadear las luces (LUZ) que haya en esa área.
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
        <radialGradient id="tn-luz-halo">
          <stop offset="0%" stop-color="#FFF7D6" stop-opacity=".95"/>
          <stop offset="45%" stop-color="#FDE68A" stop-opacity=".55"/>
          <stop offset="100%" stop-color="#FDE68A" stop-opacity="0"/>
        </radialGradient>
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

      <!-- Áreas (debajo): lo que el cartel traduce a "su turno se atiende en X, al lado Y" -->
      @for (a of areas(); track a.id) {
        <g [attr.transform]="'rotate(' + (a.rotacion || 0) + ' ' + (a.x + a.ancho / 2) + ' ' + (a.y + a.alto / 2) + ')'"
           class="area" [class.seleccionado]="seleccionId() === a.id" [class.resaltada]="areaResaltada() === a.id"
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
          <!-- Escalera: peldaños y hacia dónde va. Ascensor: puertas y flechas. -->
          @if (a.tipo === 'ESCALERA') {
            <g class="escalera" [attr.stroke]="borde(a)" stroke-width="1.2" stroke-opacity=".7">
              @for (p of peldanos(a); track $index) {
                <line [attr.x1]="p.x1" [attr.y1]="p.y1" [attr.x2]="p.x2" [attr.y2]="p.y2"/>
              }
            </g>
            <line [attr.x1]="flechaEscalera(a).x1" [attr.y1]="flechaEscalera(a).y1" [attr.x2]="flechaEscalera(a).x2" [attr.y2]="flechaEscalera(a).y2"
                  [attr.stroke]="borde(a)" stroke-width="3" stroke-linecap="round" [attr.stroke-dasharray]="sentido(a) === 'BAJA' ? '6 4' : null"
                  marker-end="url(#tn-flecha)" [attr.marker-start]="sentido(a) === 'AMBOS' ? 'url(#tn-flecha)' : null" [style.color]="borde(a)" class="escalera__flecha"/>
          }
          @if (a.tipo === 'ASCENSOR') {
            <line [attr.x1]="a.x + a.ancho / 2" [attr.y1]="a.y + a.alto * .2" [attr.x2]="a.x + a.ancho / 2" [attr.y2]="a.y + a.alto * .8" [attr.stroke]="borde(a)" stroke-width="1.5" opacity=".6"/>
            <path [attr.d]="triangulo(a, true)" [attr.fill]="borde(a)" class="ascensor__luz"/>
            <path [attr.d]="triangulo(a, false)" [attr.fill]="borde(a)" class="ascensor__luz ascensor__luz--b"/>
          }
          <text [attr.x]="a.x + a.ancho / 2" [attr.y]="a.y + a.alto / 2 - (a.codigo || mostrarCotas() ? 4 : -5)" text-anchor="middle"
                [attr.font-size]="tamanoTexto(a)" font-weight="800" [attr.fill]="texto(a)" font-family="Manrope, system-ui, sans-serif" class="rotulo">{{ a.nombre }}</text>
          @if (destinoEscalera(a); as d) {
            <text [attr.x]="a.x + a.ancho / 2" [attr.y]="a.y + a.alto / 2 + tamanoTexto(a) * .95 + 2" text-anchor="middle"
                  [attr.font-size]="tamanoTexto(a) * .72" font-weight="800" [attr.fill]="texto(a)" font-family="Manrope, system-ui, sans-serif" class="rotulo">{{ d }}</text>
          } @else if (a.codigo) {
            <text [attr.x]="a.x + a.ancho / 2" [attr.y]="a.y + a.alto / 2 + tamanoTexto(a) + 2" text-anchor="middle"
                  [attr.font-size]="tamanoTexto(a) * .8" font-weight="700" [attr.fill]="texto(a)" opacity=".85" font-family="ui-monospace, monospace" class="rotulo">{{ a.codigo }}</text>
          }
          <!-- En la escalera el renglón de abajo es "Sube a…": la medida se ve al seleccionarla -->
          @if (mostrarCotas() && !destinoEscalera(a)) {
            <text [attr.x]="a.x + a.ancho / 2" [attr.y]="a.y + a.alto / 2 + tamanoTexto(a) * (a.codigo ? 1.9 : 1) + 4" text-anchor="middle"
                  [attr.font-size]="tamanoTexto(a) * .7" [attr.fill]="texto(a)" opacity=".75" font-family="Manrope, system-ui, sans-serif" class="rotulo">{{ metros(a.ancho) }} × {{ metros(a.alto) }} m</text>
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

      <!-- Elementos (encima): paredes, puertas, ventanas, muebles, luces, textos, flechas, iconos -->
      @for (e of elementos(); track e.id) {
        <g [attr.transform]="'rotate(' + (e.rotacion || 0) + ' ' + (e.x + e.ancho / 2) + ' ' + (e.y + e.alto / 2) + ')'"
           class="elemento" [class.seleccionado]="seleccionId() === e.id" [class.bloqueado]="e.bloqueado"
           (pointerdown)="interactivo() && elegir.emit({ tipo: 'elemento', id: e.id, evento: $event })">
          @if (interactivo()) {
            <!-- Zona de clic generosa: una pared de 20 cm a poco zoom mide 4 px y no se acierta. -->
            <rect [attr.x]="e.x - holgura(e)" [attr.y]="e.y - holgura(e)" [attr.width]="e.ancho + holgura(e) * 2" [attr.height]="e.alto + holgura(e) * 2" fill="transparent" class="zona"/>
          }
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
            @case ('ARCHIVADOR') {
              <rect [attr.x]="e.x" [attr.y]="e.y" [attr.width]="e.ancho" [attr.height]="e.alto" [attr.fill]="e.color || '#94A3B8'" stroke="#475569" stroke-width="1.2" rx="2"/>
              @for (i of [1, 2, 3]; track i) {
                <line [attr.x1]="e.x + e.ancho * i / 4" [attr.y1]="e.y + 2" [attr.x2]="e.x + e.ancho * i / 4" [attr.y2]="e.y + e.alto - 2" stroke="#475569" stroke-width="1" opacity=".6"/>
              }
            }
            @case ('ESTANTE') {
              <rect [attr.x]="e.x" [attr.y]="e.y" [attr.width]="e.ancho" [attr.height]="e.alto" [attr.fill]="e.color || '#D6B98C'" stroke="#8B6B3E" stroke-width="1.2" rx="1"/>
              <line [attr.x1]="e.x" [attr.y1]="e.y + e.alto / 2" [attr.x2]="e.x + e.ancho" [attr.y2]="e.y + e.alto / 2" stroke="#8B6B3E" stroke-width="1" opacity=".7"/>
            }
            @case ('SOFA') {
              <rect [attr.x]="e.x" [attr.y]="e.y" [attr.width]="e.ancho" [attr.height]="e.alto" [attr.fill]="e.color || '#7C9CC9'" rx="8"/>
              <rect [attr.x]="e.x + e.ancho * .12" [attr.y]="e.y + e.alto * .32" [attr.width]="e.ancho * .76" [attr.height]="e.alto * .6" fill="#FFFFFF" opacity=".28" rx="5"/>
            }
            @case ('PANTALLA') {
              <rect [attr.x]="e.x" [attr.y]="e.y" [attr.width]="e.ancho" [attr.height]="e.alto" [attr.fill]="e.color || '#0F172A'" rx="2"/>
              <rect [attr.x]="e.x + 2" [attr.y]="e.y + 1" [attr.width]="Math.max(0, e.ancho - 4)" [attr.height]="Math.max(1, e.alto - 2)" fill="#38BDF8" opacity=".55" rx="1"/>
            }
            @case ('LUZ') {
              <circle [attr.cx]="e.x + e.ancho / 2" [attr.cy]="e.y + e.alto / 2" [attr.r]="Math.max(e.ancho, e.alto) * 1.6"
                      fill="url(#tn-luz-halo)" class="luz__halo" [class]="'luz__halo luz--' + (e.luz_modo || 'FIJA').toLowerCase()" [class.luz--llamado]="luzEnLlamado(e)"/>
              <circle [attr.cx]="e.x + e.ancho / 2" [attr.cy]="e.y + e.alto / 2" [attr.r]="Math.max(3, Math.min(e.ancho, e.alto) / 2)"
                      [attr.fill]="e.luz_modo === 'APAGADA' ? '#94A3B8' : (e.color || '#FACC15')" stroke="#A16207" stroke-width="1"/>
            }
            @case ('CAMARA') {
              <!-- Cámara: cuerpo + un cono que insinúa hacia dónde mira (la perspectiva real se ve en 3D). -->
              <path [attr.d]="conoCamara(e)" [attr.fill]="e.color || '#F59E0B'" fill-opacity=".18" [attr.stroke]="e.color || '#B45309'" stroke-width="1" stroke-dasharray="3 2"/>
              <circle [attr.cx]="e.x + e.ancho / 2" [attr.cy]="e.y + e.alto / 2" [attr.r]="radioCamara(e)" [attr.fill]="e.color || '#F59E0B'" stroke="#78350F" stroke-width="1.5"/>
              <text [attr.x]="e.x + e.ancho / 2" [attr.y]="e.y + e.alto / 2 + 5" [attr.font-size]="radioCamara(e) * 1.3" text-anchor="middle" font-family="Material Icons" fill="#78350F">videocam</text>
            }
            @case ('MODELO3D') {
              <rect [attr.x]="e.x" [attr.y]="e.y" [attr.width]="e.ancho" [attr.height]="e.alto" fill="#E2E8F0" stroke="#94A3B8" stroke-dasharray="4 3" rx="4"/>
              <text [attr.x]="e.x + e.ancho / 2" [attr.y]="e.y + e.alto / 2 + (e.tamano || 20) * .36" [attr.font-size]="e.tamano || 20" text-anchor="middle" font-family="Material Icons" [attr.fill]="e.color || '#44526A'">{{ e.icono || 'view_in_ar' }}</text>
            }
            @case ('EQUIPO') {
              <rect [attr.x]="e.x" [attr.y]="e.y" [attr.width]="e.ancho" [attr.height]="e.alto" [attr.fill]="e.color || '#DBEAFE'" stroke="#1D4ED8" rx="3"/>
              <text [attr.x]="e.x + e.ancho / 2" [attr.y]="e.y + e.alto / 2 + (e.tamano || 18) * .36" [attr.font-size]="e.tamano || 18" text-anchor="middle" font-family="Material Icons" fill="#1D4ED8">{{ e.icono || 'computer' }}</text>
            }
          }
          @if (mostrarActivos() && e.activo?.codigo) {
            <text [attr.x]="e.x + e.ancho / 2" [attr.y]="e.y + e.alto + 9" text-anchor="middle" font-size="7.5" fill="currentColor" opacity=".55" font-family="ui-monospace, monospace">{{ e.activo!.codigo }}</text>
          }
          @if (mostrarCotas() && (e.tipo === 'SILLA' || e.tipo === 'MESA' || e.tipo === 'MOSTRADOR' || e.tipo === 'PARED') && seleccionId() === e.id) {
            <text [attr.x]="e.x + e.ancho / 2" [attr.y]="e.y - 4" text-anchor="middle" font-size="9" fill="currentColor" opacity=".7" font-family="Manrope, system-ui, sans-serif">{{ metros(e.ancho) }} m</text>
          }
          @if (interactivo()) {
            <rect [attr.x]="e.x - 3" [attr.y]="e.y - 3" [attr.width]="e.ancho + 6" [attr.height]="e.alto + 6" fill="transparent" stroke="var(--brand-blue)" stroke-width="1.5" stroke-dasharray="4 3" class="marco"/>
            @if (seleccionId() === e.id && !e.bloqueado) {
              <rect [attr.x]="e.x + e.ancho - 6" [attr.y]="e.y + e.alto - 6" width="12" height="12" fill="var(--brand-blue)" rx="2" class="asa"
                    (pointerdown)="$event.stopPropagation(); elegir.emit({ tipo: 'elemento', id: e.id, evento: $event, asa: true })"/>
              <line [attr.x1]="e.x + e.ancho / 2" [attr.y1]="e.y - 3" [attr.x2]="e.x + e.ancho / 2" [attr.y2]="e.y - 22" stroke="var(--brand-blue)" stroke-width="1.5"/>
              <circle [attr.cx]="e.x + e.ancho / 2" [attr.cy]="e.y - 26" r="7" fill="var(--surface, #fff)" stroke="var(--brand-blue)" stroke-width="2" class="rotor"
                      (pointerdown)="$event.stopPropagation(); elegir.emit({ tipo: 'elemento', id: e.id, evento: $event, rotar: true })"/>
            }
          }
        </g>
      }

      <!-- Baliza del llamado: dónde tiene que ir la persona -->
      @if (baliza(); as b) {
        <g class="baliza" pointer-events="none">
          <circle [attr.cx]="b.x" [attr.cy]="b.y" r="10" fill="none" stroke="#9BD441" stroke-width="4">
            <animate attributeName="r" values="8;44" dur="1.4s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="1;0" dur="1.4s" repeatCount="indefinite"/>
          </circle>
          <circle [attr.cx]="b.x" [attr.cy]="b.y" r="10" fill="none" stroke="#9BD441" stroke-width="4">
            <animate attributeName="r" values="8;44" dur="1.4s" begin=".7s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="1;0" dur="1.4s" begin=".7s" repeatCount="indefinite"/>
          </circle>
          <circle [attr.cx]="b.x" [attr.cy]="b.y" r="9" fill="#9BD441" stroke="#21263C" stroke-width="2.5" class="baliza__nucleo"/>
          <text [attr.x]="b.x" [attr.y]="b.y - 16" text-anchor="middle" font-size="26" font-family="Material Icons" fill="#21263C" class="baliza__pin">place</text>
        </g>
      }
      <ng-content />
    </svg>
  `,
  styles: [`
    :host { display: block; width: 100%; color: var(--text, #0F1B2D); }
    .croquis { width: 100%; height: auto; display: block; border-radius: 8px; overflow: visible; }
    .croquis--interactivo .area, .croquis--interactivo .elemento { cursor: grab; }
    .croquis--interactivo .elemento.bloqueado { cursor: default; }
    .croquis--interactivo .asa { cursor: nwse-resize; }
    .croquis--interactivo .rotor { cursor: grab; }
    .marco { opacity: 0; pointer-events: none; }
    .seleccionado .marco { opacity: 1; }
    .croquis--interactivo .area:hover .marco, .croquis--interactivo .elemento:hover .marco { opacity: .45; }
    .rotulo { pointer-events: none; paint-order: stroke; stroke: rgba(255,255,255,.75); stroke-width: 3px; }
    .resaltada rect, .resaltada ellipse, .resaltada polygon { filter: drop-shadow(0 0 10px rgba(155, 212, 65, .9)); animation: tn-late 1.2s ease-in-out infinite; }
    @keyframes tn-late { 0%, 100% { stroke-width: 2; } 50% { stroke-width: 6; } }
    .escalera__flecha { animation: tn-escalera 1.6s linear infinite; }
    @keyframes tn-escalera { 0% { stroke-dashoffset: 20; } 100% { stroke-dashoffset: 0; } }
    .ascensor__luz { animation: tn-ascensor 2.4s ease-in-out infinite; }
    .ascensor__luz--b { animation-delay: 1.2s; }
    @keyframes tn-ascensor { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
    .luz--fija { opacity: .85; }
    .luz--parpadeo { animation: tn-parpadeo 1s steps(1, end) infinite; }
    .luz--respira { animation: tn-respira 3s ease-in-out infinite; }
    .luz--apagada { opacity: 0; }
    .luz--llamado { animation: tn-parpadeo .35s steps(1, end) infinite !important; opacity: 1; }
    @keyframes tn-parpadeo { 0% { opacity: 1; } 50% { opacity: .1; } }
    @keyframes tn-respira { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
    .baliza__pin { animation: tn-salto .9s ease-in-out infinite; }
    @keyframes tn-salto { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    .cuadricula, .regla { pointer-events: none; }
    @media (prefers-reduced-motion: reduce) {
      .escalera__flecha, .ascensor__luz, .luz--parpadeo, .luz--respira, .baliza__pin { animation: none; }
    }
  `],
})
export class CroquisSvg {
  protected readonly Math = Math;

  readonly croquis = input<Croquis | null>(null);
  /** Áreas a pintar (todas: aquí se filtran por piso); si no se pasan, se toman del croquis. */
  readonly areasEntrada = input<Area[] | null>(null);
  /** Elementos DEL PISO ACTUAL; si no se pasan, salen del elementos_json del croquis. */
  readonly elementosEntrada = input<ElementoCroquis[] | null>(null);
  /** Pisos en edición (el editor los pasa); si no, salen del croquis. */
  readonly pisosEntrada = input<PisoCroquis[] | null>(null);
  /** Datos extra de las áreas (escaleras, luz de llamado); si no, salen del croquis. */
  readonly metaEntrada = input<Record<string, MetaArea> | null>(null);
  /** Id del piso a pintar; null = el primero. */
  readonly piso = input<string | null>(null);
  readonly interactivo = input(false);
  readonly mostrarCuadricula = input(false);
  readonly mostrarRegla = input(false);
  readonly mostrarCotas = input(false);
  readonly mostrarPuestos = input(true);
  /** Muestra el código de activo bajo cada mueble (editor, hoja de inventario). */
  readonly mostrarActivos = input(false);
  /** Centímetros por píxel; si no se pasa, el del croquis (2 = 1 m son 50 px). */
  readonly escalaEntrada = input<number | null>(null);
  readonly seleccionId = input<string | null>(null);
  /** Id del área a resaltar (el televisor al cantar un turno). */
  readonly resaltar = input<string | null>(null);
  /** Id del punto de atención llamado: precisa el escritorio dentro de un área compartida. */
  readonly resaltarPuesto = input<string | null>(null);
  /** true = hay un llamado en curso: baliza y luces encendidas. false = solo el contorno. */
  readonly llamando = input(true);

  readonly elegir = output<{ tipo: 'area' | 'elemento'; id: string; evento: PointerEvent; asa?: boolean; rotar?: boolean }>();

  readonly pisos = computed<PisoCroquis[]>(() => this.pisosEntrada() ?? leerPisos(this.croquis()));
  readonly meta = computed<Record<string, MetaArea>>(() => this.metaEntrada() ?? leerMetaAreas(this.croquis()?.elementos_json));
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

  /** Área del llamado: la del punto llamado si se conoce, si no la que llegó en `resaltar`. */
  readonly destino = computed(() => {
    const punto = this.resaltarPuesto();
    if (punto) {
      for (const a of this.areas()) {
        const p = a.puestos?.find(x => x.id === punto);
        if (p) return { area: a, indice: p.indice || 1 };
      }
    }
    const id = this.resaltar();
    const a = id ? this.areas().find(x => x.id === id) : null;
    return a ? { area: a, indice: null as number | null } : null;
  });
  readonly areaResaltada = computed(() => this.destino()?.area.id ?? null);
  /** Punto exacto de la baliza: el escritorio dentro del área (si es compartida) o su centro. */
  readonly baliza = computed(() => {
    const d = this.destino();
    if (!d || !this.llamando()) return null;
    if (this.meta()[d.area.id]?.luz_llamado === false) return null;
    return puntoDePuesto(d.area, d.indice);
  });

  readonly marcasX = computed(() => marcas(this.ancho(), this.pxMetro()));
  readonly marcasY = computed(() => marcas(this.alto(), this.pxMetro()));

  metros(px: number): string { return (px * this.escala() / 100).toFixed(2).replace(/\.?0+$/, '') || '0'; }
  asientos(e: ElementoCroquis): number[] { return Array.from({ length: Math.max(1, Math.min(4, e.cantidad || 1)) }, (_, i) => i); }
  cabezas(a: Area): number[] { return Array.from({ length: Math.min(6, a.capacidad || 0) }, (_, i) => i); }
  ocupado(a: Area, i: number): boolean { const p = a.puestos?.[i]; return !!p?.usuario_ref; }
  /** Relleno translúcido: el área es "suelo"; lo que hay encima (muebles, paredes) se ve. */
  relleno(a: Area): string { return conAlfa(a.color || COLOR_TIPO[a.tipo]?.borde || '#2B59F0', a.color ? .2 : .14); }
  borde(a: Area): string { return a.color || COLOR_TIPO[a.tipo]?.borde || '#2B59F0'; }
  texto(a: Area): string { return a.color || COLOR_TIPO[a.tipo]?.borde || '#1E44C8'; }
  tamanoTexto(a: Area): number { return Math.max(9, Math.min(18, Math.min(a.ancho / Math.max(6, a.nombre.length) * 1.7, a.alto / 3.2))); }
  poligono(a: Area): string {
    const pts = leerPuntos(a.puntos_json);
    if (!pts.length) return `${a.x},${a.y} ${a.x + a.ancho},${a.y} ${a.x + a.ancho},${a.y + a.alto} ${a.x},${a.y + a.alto}`;
    return pts.map(p => `${a.x + p[0]},${a.y + p[1]}`).join(' ');
  }
  /** Holgura de la zona de clic: al menos ~0,3 m alrededor de lo delgado. */
  holgura(e: ElementoCroquis): number {
    const minimo = this.pxMetro() * 0.3;
    return Math.max(2, (minimo - Math.min(e.ancho, e.alto)) / 2);
  }

  // ── Escaleras y ascensores ──────────────────────────────────────────────
  sentido(a: Area): 'SUBE' | 'BAJA' | 'AMBOS' { return this.meta()[a.id]?.sentido ?? 'SUBE'; }
  destinoEscalera(a: Area): string | null {
    if (a.tipo !== 'ESCALERA' && a.tipo !== 'ASCENSOR') return null;
    const m = this.meta()[a.id];
    const piso = m?.conecta_piso ? this.pisos().find(p => p.id === m.conecta_piso) : null;
    const s = m?.sentido ?? (a.tipo === 'ESCALERA' ? 'SUBE' : null);
    if (!s && !piso) return null;
    const verbo = s === 'BAJA' ? 'Baja' : s === 'AMBOS' ? 'Sube y baja' : 'Sube';
    return piso ? `${verbo} a ${piso.nombre}` : verbo;
  }
  /** Líneas de peldaños a lo largo del lado largo (huella de ~28 cm). */
  peldanos(a: Area): { x1: number; y1: number; x2: number; y2: number }[] {
    const largoEnX = a.ancho >= a.alto;
    const largo = largoEnX ? a.ancho : a.alto;
    const huella = Math.max(6, this.pxMetro() * 0.28);
    const n = Math.max(3, Math.min(40, Math.floor(largo / huella)));
    const out = [];
    for (let i = 1; i < n; i++) {
      const t = (largo * i) / n;
      out.push(largoEnX ? { x1: a.x + t, y1: a.y + 3, x2: a.x + t, y2: a.y + a.alto - 3 } : { x1: a.x + 3, y1: a.y + t, x2: a.x + a.ancho - 3, y2: a.y + t });
    }
    return out;
  }
  /** Flecha de la escalera: de abajo hacia arriba en el sentido de subida (la rotación del área la orienta). */
  flechaEscalera(a: Area): { x1: number; y1: number; x2: number; y2: number } {
    const largoEnX = a.ancho >= a.alto;
    const baja = this.sentido(a) === 'BAJA';
    if (largoEnX) {
      const y = a.y + a.alto * .78, x1 = a.x + a.ancho * .12, x2 = a.x + a.ancho * .88;
      return baja ? { x1: x2, y1: y, x2: x1, y2: y } : { x1, y1: y, x2, y2: y };
    }
    const x = a.x + a.ancho * .78, y1 = a.y + a.alto * .88, y2 = a.y + a.alto * .12;
    return baja ? { x1: x, y1: y2, x2: x, y2: y1 } : { x1: x, y1, x2: x, y2 };
  }
  triangulo(a: Area, arriba: boolean): string {
    const cx = a.x + a.ancho * .82, s = Math.max(4, Math.min(a.ancho, a.alto) * .1);
    const cy = a.y + a.alto * (arriba ? .3 : .7);
    return arriba ? `M ${cx - s} ${cy + s * .6} L ${cx} ${cy - s * .6} L ${cx + s} ${cy + s * .6} Z`
      : `M ${cx - s} ${cy - s * .6} L ${cx} ${cy + s * .6} L ${cx + s} ${cy - s * .6} Z`;
  }

  /** Una luz dentro del área llamada parpadea rápido mientras dura el llamado. */
  luzEnLlamado(e: ElementoCroquis): boolean {
    const d = this.destino();
    if (!d || !this.llamando()) return false;
    const a = d.area, cx = e.x + e.ancho / 2, cy = e.y + e.alto / 2;
    return cx >= a.x && cx <= a.x + a.ancho && cy >= a.y && cy <= a.y + a.alto;
  }

  radioCamara(e: ElementoCroquis): number { return Math.max(6, e.ancho / 2); }
  /** Cono 2D de la cámara: un triángulo desde el centro hacia +x local (el <g> ya aplica la rotación). */
  conoCamara(e: ElementoCroquis): string {
    const cx = e.x + e.ancho / 2, cy = e.y + e.alto / 2;
    const alcancePx = this.px((e.alcance ?? 8)); // metros → px con la escala vigente
    const semi = (((e.fov ?? 70)) * Math.PI / 180) / 2;
    const x1 = cx + alcancePx * Math.cos(-semi), y1 = cy + alcancePx * Math.sin(-semi);
    const x2 = cx + alcancePx * Math.cos(semi), y2 = cy + alcancePx * Math.sin(semi);
    return `M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${alcancePx.toFixed(1)} ${alcancePx.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
  }
  /** metros → px con la escala vigente (inverso de `metros`). */
  private px(m: number): number { return Math.round(m * 100 / this.escala()); }
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

/** Categoría de activo por defecto para cada mueble (la que va en la placa). */
export const CATEGORIA_ACTIVO: Record<string, { categoria: string; prefijo: string }> = {
  MESA: { categoria: 'Escritorios y mesas', prefijo: 'MES' },
  SILLA: { categoria: 'Sillas', prefijo: 'SIL' },
  MOSTRADOR: { categoria: 'Mostradores', prefijo: 'MOS' },
  ARCHIVADOR: { categoria: 'Archivadores', prefijo: 'ARC' },
  ESTANTE: { categoria: 'Estantes', prefijo: 'EST' },
  SOFA: { categoria: 'Sofás y bancas', prefijo: 'SOF' },
  PANTALLA: { categoria: 'Televisores y pantallas', prefijo: 'PAN' },
  EQUIPO: { categoria: 'Equipos de cómputo', prefijo: 'EQP' },
  CAMARA: { categoria: 'Cámaras', prefijo: 'CAM' },
  LUZ: { categoria: 'Iluminación', prefijo: 'LUZ' },
  PLANTA: { categoria: 'Decoración', prefijo: 'DEC' },
  MODELO3D: { categoria: 'Mobiliario', prefijo: 'MOB' },
};

/** Tipos de elemento que son mobiliario (pueden llevar ficha de activo). */
export const TIPOS_MUEBLE = new Set(Object.keys(CATEGORIA_ACTIVO));

/** Pisos del croquis: lee el formato v2/v3 o envuelve el array plano (v1) como un solo piso. */
export function leerPisos(c: Croquis | null | undefined): PisoCroquis[] {
  const ancho = c?.ancho || 1200, alto = c?.alto || 800;
  const vacio: PisoCroquis[] = [{ id: 'p1', nombre: 'Piso 1', ancho, alto, elementos: [], nivel: 0 }];
  if (!c?.elementos_json) return vacio;
  try {
    const v = JSON.parse(c.elementos_json);
    if (Array.isArray(v)) return [{ id: 'p1', nombre: 'Piso 1', ancho, alto, elementos: v, nivel: 0 }];
    if (v && typeof v === 'object' && Array.isArray((v as ElementosJson).pisos) && (v as ElementosJson).pisos.length) {
      return (v as ElementosJson).pisos.map((p, i) => ({
        id: p.id || `p${i + 1}`, nombre: p.nombre || `Piso ${i + 1}`,
        ancho: p.ancho || ancho, alto: p.alto || alto, elementos: Array.isArray(p.elementos) ? p.elementos : [],
        altura3d: p.altura3d, nivel: typeof p.nivel === 'number' ? p.nivel : i,
      }));
    }
  } catch { /* JSON viejo o roto */ }
  return vacio;
}

/** Datos extra por área (escaleras, luz de llamado) guardados en elementos_json.areas_meta. */
export function leerMetaAreas(json: string | null | undefined): Record<string, MetaArea> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) && v.areas_meta && typeof v.areas_meta === 'object' ? v.areas_meta : {};
  } catch { return {}; }
}

/** Formato v3: pisos + datos extra de áreas. Lo leen igual el 2D, el 3D y el televisor. */
export function serializarCroquis(pisos: PisoCroquis[], meta: Record<string, MetaArea> = {}): string {
  const limpio: Record<string, MetaArea> = {};
  for (const [k, m] of Object.entries(meta)) {
    if (m && (m.sentido || m.conecta_piso || m.luz_llamado === false)) limpio[k] = m;
  }
  const doc: ElementosJson = { v: 3, pisos, ...(Object.keys(limpio).length ? { areas_meta: limpio } : {}) };
  return JSON.stringify(doc);
}

/** Compatibilidad con quien todavía guarda solo pisos. */
export function serializarPisos(pisos: PisoCroquis[]): string {
  return serializarCroquis(pisos);
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

/** Dónde queda el escritorio `indice` (1..capacidad) dentro de un área compartida, en px del lienzo. */
export function puntoDePuesto(a: Area, indice: number | null): { x: number; y: number } {
  const cap = Math.max(1, a.capacidad || 1);
  let lx = 0, ly = 0;
  if (indice && cap > 1) {
    const t = (Math.min(cap, Math.max(1, indice)) - 0.5) / cap - 0.5;
    if (a.ancho >= a.alto) lx = t * a.ancho; else ly = t * a.alto;
  }
  const r = ((a.rotacion || 0) * Math.PI) / 180;
  const cx = a.x + a.ancho / 2, cy = a.y + a.alto / 2;
  return { x: cx + lx * Math.cos(r) - ly * Math.sin(r), y: cy + lx * Math.sin(r) + ly * Math.cos(r) };
}

/**
 * A dónde tiene que ir quien fue llamado: el punto de atención exacto si nació del plano
 * (áreas con capacidad), si no el área destino del turno. Devuelve también el piso, para que
 * el televisor muestre el piso correcto.
 */
export function resolverDestino(
  croquis: Croquis | null | undefined,
  turno: { punto_id?: string | null; area_id?: string | null } | null | undefined,
): { areaId: string; puntoId: string | null; indice: number | null; pisoId: string | null } | null {
  if (!croquis || !turno) return null;
  const areas = (croquis.areas ?? []).filter(a => a.activa !== false);
  if (turno.punto_id) {
    for (const a of areas) {
      const p = a.puestos?.find(x => x.id === turno.punto_id);
      if (p) return { areaId: a.id, puntoId: p.id, indice: p.indice || 1, pisoId: a.piso ?? null };
    }
  }
  const a = turno.area_id ? areas.find(x => x.id === turno.area_id) : null;
  return a ? { areaId: a.id, puntoId: null, indice: null, pisoId: a.piso ?? null } : null;
}

/** Código consecutivo para la placa de un mueble: PREFIJO-OFICINA-0007. */
export function siguienteCodigoActivo(tipo: string, oficina: string | null | undefined, existentes: (ActivoCroquis | null | undefined)[]): string {
  const pref = CATEGORIA_ACTIVO[tipo]?.prefijo ?? 'MOB';
  const of = (oficina || 'OF').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'OF';
  const base = `${pref}-${of}-`;
  let max = 0;
  for (const a of existentes) {
    if (a?.codigo?.startsWith(base)) max = Math.max(max, parseInt(a.codigo.slice(base.length), 10) || 0);
  }
  return `${base}${String(max + 1).padStart(4, '0')}`;
}

function conAlfa(hex: string, alfa: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}
