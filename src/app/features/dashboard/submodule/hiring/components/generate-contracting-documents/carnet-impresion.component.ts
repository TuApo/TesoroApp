/**
 * Bloque "¿cómo vas a imprimir el reverso?" que comparten la generación
 * individual y la masiva de carnets.
 *
 * Existe porque el reverso solo cae detrás del frente si la hoja se voltea del
 * mismo modo en que se dibujó, y eso NO se puede adivinar: depende de la
 * impresora (o de cómo el operador voltee la hoja a mano). Acá se elige una vez
 * por equipo y queda guardado; la lógica del volteo vive en `carnet-impresion`.
 *
 * El bloque también traduce la elección al nombre que usa el driver, que cambia
 * entre los dos formatos porque uno imprime en hoja horizontal y el otro en
 * vertical. Ese detalle es el que hacía que, con la misma configuración, un
 * formato saliera bien y el otro corrido.
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  ConfigImpresionCarnet,
  FormatoCarnet,
  ORIENTACION_CARNET,
  VOLTEO_A_MANO,
  VOLTEO_EN_IMPRESORA,
  VolteoHoja,
  guardarImpresion,
  leerImpresion,
  normalizarImpresion,
} from './carnet-impresion';

interface OpcionVolteo {
  valor: VolteoHoja;
  icono: string;
  titulo: string;
  detalle: string;
}

@Component({
  selector: 'app-carnet-impresion',
  // Documento (se imprime o se captura): se queda en claro aunque la app esté en oscuro.
  host: { class: 'tema-claro-fijo' },
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  template: `
    <section class="ci">
      <header class="ci-head">
        <mat-icon>print</mat-icon>
        <div>
          <h3>¿Cómo vas a voltear la hoja?</h3>
          <p>De esto depende que el reverso quede justo detrás del frente al recortar.</p>
        </div>
      </header>

      <div class="ci-opts">
        @for (o of opciones; track o.valor) {
          <button type="button" class="ci-opt" [class.on]="cfg().volteo === o.valor"
            (click)="elegir(o.valor)">
            <mat-icon>{{ o.icono }}</mat-icon>
            <span class="ci-opt-t">{{ o.titulo }}</span>
            <span class="ci-opt-d">{{ o.detalle }}</span>
          </button>
        }
      </div>

      <ul class="ci-instrucciones">
        <li>
          <mat-icon>flip_to_front</mat-icon>
          <span>
            <b>Si la impresora hace la doble cara sola:</b>
            @for (d of enDriver(); track d.formato) {
              <span class="ci-driver">{{ d.formato }} → voltear por el <b>{{ d.nombre }}</b></span>
            }
          </span>
        </li>
        <li>
          <mat-icon>touch_app</mat-icon>
          <span>
            <b>Si volteas a mano:</b> imprime la <b>página 1</b>, {{ aMano() }} sin girarla,
            vuélvela a meter en la bandeja igual que estaba y manda la <b>página 2</b>.
          </span>
        </li>
      </ul>

      <button type="button" class="ci-fino-toggle" (click)="verFino.set(!verFino())">
        <mat-icon>{{ verFino() ? 'expand_less' : 'expand_more' }}</mat-icon>
        Ajuste fino {{ ajustado() ? '(' + cfg().ajusteX + ' / ' + cfg().ajusteY + ' mm)' : '' }}
      </button>

      @if (verFino()) {
        <div class="ci-fino">
          <p class="ci-fino-ayuda">
            Solo si el reverso sale <b>parejo pero corrido unos milímetros</b>. Mide cuánto
            hay que moverlo <b>mirando el reverso</b>: positivo = derecha / abajo.
          </p>
          <label>
            <span>Mover en X</span>
            <input type="number" step="0.5" min="-10" max="10" [value]="cfg().ajusteX"
              (change)="fino('ajusteX', $event)">
            <small>mm</small>
          </label>
          <label>
            <span>Mover en Y</span>
            <input type="number" step="0.5" min="-10" max="10" [value]="cfg().ajusteY"
              (change)="fino('ajusteY', $event)">
            <small>mm</small>
          </label>
          @if (ajustado()) {
            <button type="button" class="ci-reset" (click)="limpiarFino()">
              <mat-icon>restart_alt</mat-icon> Quitar ajuste
            </button>
          }
        </div>
      }

      <p class="ci-nota">
        <mat-icon>info</mat-icon>
        Imprime siempre al <b>100% (tamaño real)</b>, sin "ajustar a la página": si el PDF se
        escala, ninguna configuración lo deja parejo.
      </p>
    </section>
  `,
  styles: [`
    :host { --azul: #21263c; --linea: #e2e8f0; --muted: #64748b; display: block; }

    .ci {
      border: 1px solid var(--linea);
      border-radius: 12px;
      background: #f8fafc;
      padding: 12px 14px;
    }

    .ci-head { display: flex; align-items: flex-start; gap: 10px; }
    .ci-head > mat-icon { color: var(--azul); flex: 0 0 auto; }
    .ci-head h3 { margin: 0; font-size: .92rem; font-weight: 700; color: var(--azul); }
    .ci-head p { margin: 2px 0 0; font-size: .74rem; color: var(--muted); }

    .ci-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }

    .ci-opt {
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-areas: 'ic t' 'ic d';
      align-items: center;
      gap: 0 8px;
      text-align: left;
      padding: 9px 11px;
      border: 1.5px solid var(--linea);
      border-radius: 10px;
      background: #fff;
      cursor: pointer;
      font: inherit;
      color: var(--muted);
      transition: border-color .15s, background .15s;
    }
    .ci-opt:hover { border-color: #94a3b8; }
    .ci-opt > mat-icon { grid-area: ic; color: #94a3b8; }
    .ci-opt-t { grid-area: t; font-size: .8rem; font-weight: 700; color: var(--azul); }
    .ci-opt-d { grid-area: d; font-size: .7rem; }
    .ci-opt.on { border-color: var(--azul); background: #eef2ff; }
    .ci-opt.on > mat-icon { color: var(--azul); }

    .ci-instrucciones { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 6px; }
    .ci-instrucciones li {
      display: flex; align-items: flex-start; gap: 6px;
      font-size: .74rem; color: #334155; line-height: 1.35;
    }
    .ci-instrucciones mat-icon {
      width: 16px; height: 16px; font-size: 16px; color: var(--muted); flex: 0 0 auto; margin-top: 1px;
    }
    .ci-driver { display: block; }

    .ci-fino-toggle {
      display: inline-flex; align-items: center; gap: 4px;
      margin-top: 10px; padding: 2px 0;
      border: 0; background: none; cursor: pointer;
      font: inherit; font-size: .74rem; font-weight: 600; color: var(--azul);
    }
    .ci-fino-toggle mat-icon { width: 17px; height: 17px; font-size: 17px; }

    .ci-fino {
      display: flex; align-items: flex-end; flex-wrap: wrap; gap: 10px;
      margin-top: 6px; padding: 10px; border-radius: 10px; background: #fff;
      border: 1px solid var(--linea);
    }
    .ci-fino-ayuda { flex: 1 1 100%; margin: 0; font-size: .72rem; color: var(--muted); }
    .ci-fino label { display: flex; align-items: center; gap: 5px; font-size: .74rem; color: #334155; }
    .ci-fino input {
      width: 68px; padding: 4px 6px; font: inherit; font-size: .78rem;
      border: 1px solid var(--linea); border-radius: 7px; text-align: right;
    }
    .ci-fino small { color: var(--muted); }
    .ci-reset {
      display: inline-flex; align-items: center; gap: 4px;
      border: 0; background: none; cursor: pointer; font: inherit; font-size: .73rem; color: #b45309;
    }
    .ci-reset mat-icon { width: 16px; height: 16px; font-size: 16px; }

    .ci-nota {
      display: flex; align-items: flex-start; gap: 6px;
      margin: 10px 0 0; font-size: .72rem; color: #b45309; line-height: 1.35;
    }
    .ci-nota mat-icon { width: 16px; height: 16px; font-size: 16px; flex: 0 0 auto; margin-top: 1px; }

    @media (max-width: 520px) {
      .ci-opts { grid-template-columns: minmax(0, 1fr); }
    }
  `],
})
export class CarnetImpresionComponent {
  /** Formato(s) que se van a imprimir: cambia el nombre del volteo en el driver. */
  @Input() set formato(v: FormatoCarnet | 'ambos' | null | undefined) {
    this._formato.set(v ?? 'ambos');
  }

  /** Se emite en cada cambio; ya quedó guardado en `localStorage`. */
  @Output() cambio = new EventEmitter<ConfigImpresionCarnet>();

  private readonly _formato = signal<FormatoCarnet | 'ambos'>('ambos');

  readonly cfg = signal<ConfigImpresionCarnet>(leerImpresion());
  readonly verFino = signal(false);

  readonly opciones: readonly OpcionVolteo[] = [
    {
      valor: 'izq-der',
      icono: 'swap_horiz',
      titulo: 'De izquierda a derecha',
      detalle: 'Como pasar la hoja de un libro',
    },
    {
      valor: 'arriba-abajo',
      icono: 'swap_vert',
      titulo: 'De arriba a abajo',
      detalle: 'Como un calendario de pared',
    },
  ];

  readonly ajustado = computed(() => !!this.cfg().ajusteX || !!this.cfg().ajusteY);

  readonly aMano = computed(() => VOLTEO_A_MANO[this.cfg().volteo]);

  /**
   * Nombre del volteo en la impresora, por formato. Se muestran los dos cuando
   * la tanda mezcla temporales: son hojas de orientación distinta, así que el
   * MISMO volteo se llama al revés en cada una.
   */
  readonly enDriver = computed<Array<{ formato: string; nombre: string }>>(() => {
    const v = this.cfg().volteo;
    const nombre = (f: FormatoCarnet) => VOLTEO_EN_IMPRESORA[ORIENTACION_CARNET[f]][v];
    const etiqueta: Record<FormatoCarnet, string> = {
      apoyo: 'Apoyo (hoja horizontal)',
      alianza: 'Tu Alianza (hoja vertical)',
    };
    const cuales: FormatoCarnet[] = this._formato() === 'ambos'
      ? ['apoyo', 'alianza']
      : [this._formato() as FormatoCarnet];
    return cuales.map(f => ({ formato: etiqueta[f], nombre: nombre(f) }));
  });

  elegir(volteo: VolteoHoja): void {
    this.aplicar({ ...this.cfg(), volteo });
  }

  fino(campo: 'ajusteX' | 'ajusteY', ev: Event): void {
    const valor = Number((ev.target as HTMLInputElement).value);
    this.aplicar({ ...this.cfg(), [campo]: Number.isFinite(valor) ? valor : 0 });
  }

  limpiarFino(): void {
    this.aplicar({ ...this.cfg(), ajusteX: 0, ajusteY: 0 });
  }

  private aplicar(cfg: ConfigImpresionCarnet): void {
    const limpio = normalizarImpresion(cfg);
    this.cfg.set(limpio);
    guardarImpresion(limpio);
    this.cambio.emit(limpio);
  }
}
