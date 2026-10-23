import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { Gpu } from '../../models/infra.models';
import { bytes, num, pct } from '../../utils/formato';

/**
 * Una tarjeta gráfica: modelo, estado y lo que su driver deje leer. Si la lectura es parcial
 * (p. ej. NVIDIA con el driver libre nouveau no da uso ni memoria) lo dice en vez de enseñar ceros.
 * `compacta` = una sola línea para listas (Resumen).
 */
@Component({
  selector: 'app-infra-gpu',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let g = gpu();
    @if (compacta()) {
      <div class="linea">
        <span class="if-chip" [class]="'if-chip ' + tono()"><mat-icon>{{ icono() }}</mat-icon>{{ g.temp_c != null ? f.num(g.temp_c, 0) + ' °C' : textoEstado() }}</span>
        <div class="cuerpo">
          <div class="t">{{ g.fabricante }} {{ g.modelo }}</div>
          <div class="d">{{ resumen() }}</div>
        </div>
      </div>
    } @else {
      <div class="ficha" [class]="'ficha ' + tono()">
        <div class="cab">
          <mat-icon class="ico">memory</mat-icon>
          <div class="nombre">
            <strong>{{ g.fabricante }} {{ g.modelo }}</strong>
            <span class="if-tenue">{{ subtitulo() }}</span>
          </div>
          <span class="if-chip" [class]="'if-chip ' + tono()"><mat-icon>{{ icono() }}</mat-icon>{{ textoEstado() }}</span>
        </div>
        @if (g.uso_pct != null) {
          <div class="if-medidor"><span class="nombre">Uso</span><span class="if-barra"><i [style.width.%]="g.uso_pct"></i></span>
            <span class="valor">{{ f.pct(g.uso_pct) }}</span></div>
        }
        @if (g.vram_usada != null && g.vram_total) {
          <div class="if-medidor"><span class="nombre">Memoria de video</span><span class="if-barra"><i [style.width.%]="100 * g.vram_usada / g.vram_total"></i></span>
            <span class="valor">{{ f.bytes(g.vram_usada) }} de {{ f.bytes(g.vram_total) }}</span></div>
        }
        @if (g.temp_c != null) {
          <div class="if-medidor"><span class="nombre">Temperatura</span><span class="if-barra"><i [class]="tonoTemp()" [style.width.%]="g.temp_c"></i></span>
            <span class="valor">{{ f.num(g.temp_c, 0) }} °C</span></div>
        }
        <dl class="datos">
          @if (g.vram_total && g.vram_usada == null) { <dt>Memoria</dt><dd>{{ f.bytes(g.vram_total) }}{{ g.vram_fuente === 'ficha' ? ' (según el modelo)' : '' }}</dd> }
          <dt>Driver</dt><dd class="if-mono">{{ g.driver === 'ninguno' ? 'ninguno' : g.driver }}</dd>
          @if (g.carriles) { <dt>PCIe</dt><dd>x{{ g.carriles }}{{ g.carriles_max && g.carriles_max !== g.carriles ? ' de x' + g.carriles_max : '' }} · {{ f.num(g.pcie_gts, 1) }} de {{ f.num(g.pcie_gts_max, 1) }} GT/s</dd> }
          @if (g.salidas) { <dt>Pantallas</dt><dd>{{ g.pantallas }} de {{ g.salidas }} salidas</dd> }
          @if (g.ventilador_rpm != null || g.ventilador_pct != null) { <dt>Ventilador</dt><dd>{{ ventilador() }}</dd> }
          @if (g.potencia_w != null) { <dt>Consumo</dt><dd>{{ f.num(g.potencia_w, 0) }} W</dd> }
          @if (g.frecuencia_mhz != null) { <dt>Frecuencia</dt><dd>{{ f.num(g.frecuencia_mhz, 0) }} MHz</dd> }
          @if (g.energia && g.energia !== 'D0') { <dt>Energía</dt><dd>{{ g.energia }} (en reposo)</dd> }
          <dt>Ranura</dt><dd class="if-mono">{{ g.pci }}{{ g.principal ? ' · principal' : '' }}</dd>
        </dl>
        @if (g.lectura !== 'completa' && g.motivo) {
          <div class="nota"><mat-icon>info</mat-icon><span>Lectura parcial: {{ g.motivo }}.</span></div>
        }
      </div>
    }
  `,
  styleUrls: ['../../styles/infra-comun.css'],
  styles: [`
    :host { display: block; min-width: 0; }
    .ficha { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2); }
    .ficha.warn { border-color: var(--warn-border, var(--border)); }
    .ficha.danger { border-color: var(--danger-border); }
    .cab { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .cab .ico { color: var(--text-2); flex: none; }
    .nombre { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .nombre strong { font-size: 13.5px; overflow-wrap: anywhere; }
    .nombre .if-tenue { font-size: 12px; }
    .datos { display: grid; grid-template-columns: max-content 1fr; gap: 3px 12px; margin: 2px 0 0; font-size: 12.5px; }
    .datos dt { color: var(--muted); font-weight: 700; }
    .datos dd { margin: 0; overflow-wrap: anywhere; }
    .nota { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; color: var(--text-2); }
    .nota mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; margin-top: 1px; }
    .linea { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .linea .cuerpo { min-width: 0; }
    .linea .t { font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
    .linea .d { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
  `],
})
export class GpuFicha {
  readonly gpu = input.required<Gpu>();
  readonly compacta = input(false);
  readonly f = { bytes, num, pct };

  readonly tono = computed(() => ({ ok: 'ok', atencion: 'warn', critico: 'danger' })[this.gpu().estado] ?? 'neutro');
  readonly icono = computed(() => ({ ok: 'check_circle', atencion: 'warning', critico: 'error' })[this.gpu().estado] ?? 'help');
  readonly textoEstado = computed(() => {
    const g = this.gpu();
    if (g.estado === 'critico') return 'Caliente';
    if (g.driver === 'ninguno') return 'Sin driver';
    if (g.carriles && g.carriles_max && g.carriles < g.carriles_max) return 'PCIe reducido';
    if (g.estado === 'atencion') return 'Atención';
    return 'Funcionando';
  });
  readonly subtitulo = computed(() => {
    const g = this.gpu();
    return [g.chip, g.ensamblador, g.tipo === 'integrada' ? 'integrada' : null].filter((x) => !!x).join(' · ');
  });
  readonly tonoTemp = computed(() => {
    const t = this.gpu().temp_c ?? 0;
    return t >= 90 ? 'danger' : t >= 80 ? 'warn' : 'ok';
  });
  readonly ventilador = computed(() => {
    const g = this.gpu();
    if (g.ventilador_rpm === 0) return '0 rpm (detenido o sin ventilador)';
    return [g.ventilador_rpm != null ? `${num(g.ventilador_rpm, 0)} rpm` : null, g.ventilador_pct != null ? `${num(g.ventilador_pct, 0)} %` : null]
      .filter((x) => !!x).join(' · ');
  });
  readonly resumen = computed(() => {
    const g = this.gpu();
    const partes = [
      g.vram_total ? bytes(g.vram_total) : null,
      g.carriles ? `PCIe x${g.carriles}` : null,
      `driver ${g.driver}`,
      g.salidas ? `${g.pantallas}/${g.salidas} pantallas` : null,
      g.lectura !== 'completa' ? 'lectura parcial' : null,
    ];
    return partes.filter((x) => !!x).join(' · ');
  });
}
