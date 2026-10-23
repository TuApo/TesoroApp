import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Contenedor, Grupo, NOMBRE_GRUPO, ORDEN_GRUPO } from '../../models/infra.models';
import { bytes, estadoContenedor, num } from '../../utils/formato';

/**
 * Todos los contenedores de un vistazo, como la fila de luces de un rack: una celda por
 * contenedor agrupada por zona (la misma que en la vista 3D). El color dice el estado,
 * y además la forma: verde lleno = bien, ámbar con borde = detenido/arrancando,
 * rojo con aspa = mal. La barrita interior es la memoria contra su límite.
 */
@Component({
  selector: 'app-infra-rack',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rack" role="list" aria-label="Contenedores por zona">
      @for (g of grupos(); track g.grupo) {
        <div class="zona" role="listitem">
          <span class="nombre">{{ g.nombre }} <b>{{ g.items.length }}</b></span>
          <div class="leds">
            @for (c of g.items; track c.id) {
              <button type="button" class="led" [class]="'led ' + tono(c)" [attr.aria-label]="etiqueta(c)" [title]="etiqueta(c)"
                      (click)="elegido.emit(c)">
                <i class="mem" [style.height.%]="memPct(c)"></i>
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .rack { display: flex; flex-wrap: wrap; gap: 14px 20px; }
    .zona { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .nombre { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
    .nombre b { font-family: var(--font-mono); color: var(--text-2); margin-left: 4px; }
    .leds { display: flex; flex-wrap: wrap; gap: 4px; max-width: 420px; }
    .led {
      position: relative; width: 16px; height: 26px; min-height: 26px !important; padding: 0; border-radius: 4px; cursor: pointer;
      border: 1px solid transparent; overflow: hidden; transition: transform .12s;
    }
    .led:hover { transform: translateY(-2px); }
    .led:focus-visible { outline: none; box-shadow: var(--ring); }
    .led .mem { position: absolute; left: 3px; right: 3px; bottom: 3px; border-radius: 2px; background: rgb(255 255 255 / .55); max-height: calc(100% - 6px); }
    .led.ok { background: #0ca30c; }
    .led.info { background: var(--surface); border: 2px solid #2a78d6; }
    .led.info .mem { background: #2a78d6; opacity: .5; }
    .led.warn { background: var(--surface); border: 2px solid #fab219; }
    .led.warn .mem { background: #fab219; opacity: .6; }
    .led.danger { background: #d03b3b; }
    .led.danger::after { content: ''; position: absolute; inset: 0;
      background: linear-gradient(45deg, transparent 44%, #fff 45% 55%, transparent 56%), linear-gradient(-45deg, transparent 44%, #fff 45% 55%, transparent 56%); opacity: .8; }
    .led.neutro { background: var(--surface-3); border: 1px dashed var(--border-strong); }
    @media (prefers-reduced-motion: reduce) { .led { transition: none; } .led:hover { transform: none; } }
  `],
})
export class RackLeds {
  readonly contenedores = input<Contenedor[]>([]);
  readonly incluirPruebas = input(false);
  readonly elegido = output<Contenedor>();

  readonly grupos = computed(() => {
    const por = new Map<Grupo, Contenedor[]>();
    for (const c of this.contenedores()) {
      if (!this.incluirPruebas() && !c.produccion) continue;
      const l = por.get(c.grupo) ?? [];
      l.push(c);
      por.set(c.grupo, l);
    }
    return ORDEN_GRUPO.filter((g) => por.has(g)).map((g) => ({
      grupo: g, nombre: NOMBRE_GRUPO[g],
      items: por.get(g)!.sort((a, b) => a.nombre.localeCompare(b.nombre)),
    }));
  });

  tono(c: Contenedor): string {
    if (!c.produccion && c.estado !== 'running') return 'neutro';
    return estadoContenedor(c.estado, c.salud).tono;
  }

  memPct(c: Contenedor): number {
    if (!c.mem_bytes || !c.mem_limite) return 0;
    return Math.min(100, (100 * c.mem_bytes) / c.mem_limite);
  }

  etiqueta(c: Contenedor): string {
    const e = estadoContenedor(c.estado, c.salud).texto;
    const mem = c.mem_bytes ? ` · RAM ${bytes(c.mem_bytes)}${c.mem_limite ? ' de ' + bytes(c.mem_limite) : ''}` : '';
    const cpu = c.cpu_pct != null ? ` · CPU ${num(c.cpu_pct)} %` : '';
    return `${c.nombre}: ${e}${cpu}${mem}`;
  }
}
