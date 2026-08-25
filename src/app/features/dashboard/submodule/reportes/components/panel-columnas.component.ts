import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDropList, CdkDrag, CdkDragHandle, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ConstructorStore, TRANSFORMACIONES_FECHA } from '../services/constructor.store';
import { ReportesApiService } from '../services/reportes-api.service';
import { CampoCatalogo, FieldSpec, FormatoCampo } from '../models/reportes.models';

/**
 * Configuración de las columnas del reporte (§8).
 *
 * Por columna se puede cambiar: mostrar/ocultar, el nombre visible (alias), el
 * orden, el formato, el ancho, la alineación y la agregación. Nada de esto toca
 * la base: el alias es solo presentación, y así se le dice al usuario en la ayuda.
 *
 * El arrastre reordena la columna en el resultado; es el mismo gesto que ya usa
 * el resto de la app para reordenar.
 */
@Component({
  selector: 'app-panel-columnas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, CdkDropList, CdkDrag, CdkDragHandle,
    MatIconModule, MatButtonModule, MatMenuModule, MatTooltipModule,
    MatSelectModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule],
  template: `
  <div class="cols" cdkDropList (cdkDropListDropped)="soltar($event)">
    @for (f of store.fields(); track f.id) {
      <div class="col" cdkDrag [class.col--oculta]="!f.visible">
        <mat-icon class="col__grip" cdkDragHandle matTooltip="Arrastra para reordenar">drag_indicator</mat-icon>

        <button mat-icon-button type="button" class="col__ojo"
                [matTooltip]="f.visible ? 'Ocultar en la tabla' : 'Mostrar en la tabla'"
                (click)="store.actualizarCampo(f.id, { visible: !f.visible })">
          <mat-icon>{{ f.visible ? 'visibility' : 'visibility_off' }}</mat-icon>
        </button>

        <div class="col__info">
          <input class="col__alias" type="text" [value]="f.alias"
                 (change)="renombrar(f, $any($event.target).value)"
                 [matTooltip]="'Nombre visible. No cambia el nombre del campo en la base de datos.'"
                 aria-label="Nombre visible de la columna">
          <span class="col__origen">
            @if (f.calculado) {
              <mat-icon class="col__calc">calculate</mat-icon> Campo calculado
            } @else {
              {{ etiquetaOrigen(f) }}
            }
            @if (f.agregacion) { <em class="agg">{{ rotuloAgregacion(f.agregacion) }}</em> }
            @if (f.transformacion) { <em class="agg agg--fecha">{{ rotuloTransformacion(f.transformacion) }}</em> }
          </span>
        </div>

        <button mat-icon-button type="button" [matMenuTriggerFor]="menu" matTooltip="Opciones de la columna">
          <mat-icon>tune</mat-icon>
        </button>

        <mat-menu #menu="matMenu" class="menu-col">
          <div class="menu-col__cuerpo" (click)="$event.stopPropagation()">
            <label class="menu-col__lbl">Formato</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-select [value]="f.formato ?? 'text'"
                          (valueChange)="store.actualizarCampo(f.id, { formato: $event })">
                @for (fm of formatos; track fm.valor) {
                  <mat-option [value]="fm.valor">{{ fm.etiqueta }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <label class="menu-col__lbl">Alineación</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-select [value]="f.alineacion ?? 'left'"
                          (valueChange)="store.actualizarCampo(f.id, { alineacion: $event })">
                <mat-option value="left">Izquierda</mat-option>
                <mat-option value="center">Centro</mat-option>
                <mat-option value="right">Derecha</mat-option>
              </mat-select>
            </mat-form-field>

            <label class="menu-col__lbl">Ancho (px)</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <input matInput type="number" min="60" max="600" [value]="f.ancho ?? ''"
                     placeholder="Automático"
                     (change)="store.actualizarCampo(f.id, { ancho: numero($any($event.target).value) })">
            </mat-form-field>

            @if (campoDe(f); as c) {
              @if (c.agregaciones.length) {
                <label class="menu-col__lbl">Cálculo</label>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-select [value]="f.agregacion ?? ''"
                              (valueChange)="cambiarAgregacion(f, $event)">
                    <mat-option value="">Sin cálculo (dimensión)</mat-option>
                    @for (a of c.agregaciones; track a) {
                      <mat-option [value]="a">{{ rotuloAgregacion(a) }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }

              @if (c.tipo === 'FECHA' || c.tipo === 'FECHA_HORA') {
                <label class="menu-col__lbl">Agrupar la fecha</label>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-select [value]="f.transformacion ?? ''"
                              (valueChange)="store.actualizarCampo(f.id, { transformacion: $event || null })">
                    <mat-option value="">Sin agrupar</mat-option>
                    @for (t of transformaciones; track t.valor) {
                      <mat-option [value]="t.valor">{{ t.etiqueta }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }
            }

            <button mat-menu-item class="menu-col__del" (click)="store.quitarCampo(f.id)">
              <mat-icon>delete_outline</mat-icon> Quitar columna
            </button>
          </div>
        </mat-menu>

        <button mat-icon-button type="button" class="col__orden"
                [matTooltip]="tooltipOrden(f.id)"
                (click)="store.alternarOrden(f.id)">
          <mat-icon>{{ iconoOrden(f.id) }}</mat-icon>
        </button>
      </div>
    }

    @if (!store.fields().length) {
      <p class="cols__vacio">
        <mat-icon>touch_app</mat-icon>
        Marca campos en el explorador de la izquierda, o arrástralos hasta aquí.
      </p>
    }
  </div>

  @if (store.tieneAgregaciones()) {
    <p class="nota">
      <mat-icon>info</mat-icon>
      Al usar un cálculo, las demás columnas se convierten en agrupaciones:
      el reporte devolverá una fila por cada combinación distinta.
    </p>
  }
  `,
  styles: [`
    :host { display: block; }
    .cols { display: flex; flex-direction: column; gap: .25rem; }

    .col {
      display: flex; align-items: center; gap: .2rem;
      padding: .25rem .3rem; border-radius: 10px;
      border: 1px solid var(--rp-borde, #e2e8f0); background: var(--rp-fondo, #fff);
    }
    .col--oculta { opacity: .5; }
    .col__grip { color: #cbd5e1; cursor: grab; font-size: 18px; width: 18px; height: 18px; }
    .col__ojo, .col__orden { width: 28px; height: 28px; line-height: 28px; }
    .col__ojo mat-icon, .col__orden mat-icon { font-size: 17px; width: 17px; height: 17px; }

    .col__info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .col__alias {
      border: 0; outline: 0; background: transparent; font-size: .84rem; font-weight: 600;
      color: var(--rp-texto, #0f172a); width: 100%; padding: 0;
    }
    .col__alias:focus { border-bottom: 1px solid #0284c7; }
    .col__origen {
      font-size: .68rem; color: #94a3b8; display: flex; align-items: center; gap: .25rem;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .col__calc { font-size: 12px; width: 12px; height: 12px; color: #7c3aed; }
    .agg {
      font-style: normal; font-weight: 700; font-size: .62rem; text-transform: uppercase;
      background: #ecfdf5; color: #047857; border-radius: 999px; padding: 0 5px;
    }
    .agg--fecha { background: #eff6ff; color: #1d4ed8; }

    .cols__vacio {
      display: flex; align-items: center; gap: .4rem; margin: 0;
      padding: 1rem .6rem; border: 1px dashed #cbd5e1; border-radius: 12px;
      font-size: .8rem; color: #94a3b8;
    }

    .nota {
      display: flex; align-items: flex-start; gap: .35rem; margin: .5rem 0 0;
      font-size: .74rem; color: #0369a1; background: #f0f9ff;
      border: 1px solid #bae6fd; border-radius: 10px; padding: .4rem .5rem;
    }
    .nota mat-icon { font-size: 16px; width: 16px; height: 16px; flex: 0 0 auto; }

    :host-context(.dark-theme) { --rp-borde: #334155; --rp-fondo: #1e293b; --rp-texto: #e2e8f0; }
    :host-context(.dark-theme) .nota { background: #0c2942; border-color: #1e40af; color: #93c5fd; }
  `],
})
export class PanelColumnasComponent {

  readonly store = inject(ConstructorStore);
  private api = inject(ReportesApiService);

  readonly transformaciones = TRANSFORMACIONES_FECHA;

  readonly formatos: { valor: FormatoCampo; etiqueta: string }[] = [
    { valor: 'text', etiqueta: 'Texto' },
    { valor: 'integer', etiqueta: 'Número entero' },
    { valor: 'decimal', etiqueta: 'Número con decimales' },
    { valor: 'currency', etiqueta: 'Moneda' },
    { valor: 'percent', etiqueta: 'Porcentaje' },
    { valor: 'date', etiqueta: 'Fecha' },
    { valor: 'datetime', etiqueta: 'Fecha y hora' },
    { valor: 'badge', etiqueta: 'Etiqueta de estado' },
  ];

  soltar(ev: CdkDragDrop<unknown>): void {
    if (ev.previousIndex === ev.currentIndex) return;
    this.store.moverCampo(ev.previousIndex, ev.currentIndex);
  }

  renombrar(f: FieldSpec, alias: string): void {
    const limpio = (alias ?? '').trim();
    if (!limpio) return;
    this.store.actualizarCampo(f.id, { alias: limpio });
    if (f.calculado) this.store.actualizarCalculado(f.calculado, { alias: limpio });
  }

  campoDe(f: FieldSpec): CampoCatalogo | null {
    return f.campo ? this.api.camposPorClave().get(f.campo) ?? null : null;
  }

  etiquetaOrigen(f: FieldSpec): string {
    if (!f.campo) return '';
    const c = this.api.camposPorClave().get(f.campo);
    const clave = f.campo.split('.').slice(0, -1).join('.');
    const d = this.api.datasetsPorClave().get(clave);
    return `${d?.nombre ?? clave} · ${c?.columna ?? ''}`;
  }

  cambiarAgregacion(f: FieldSpec, agg: string): void {
    const valor = agg ? agg : null;
    const cambios: Partial<FieldSpec> = { agregacion: valor as never };
    // Contar devuelve un entero, aunque el campo de origen sea texto o fecha.
    if (valor === 'COUNT' || valor === 'COUNT_DISTINCT') {
      cambios.formato = 'integer';
      cambios.alineacion = 'right';
    }
    this.store.actualizarCampo(f.id, cambios);
  }

  numero(v: string): number | null {
    const n = Number(v);
    return v === '' || isNaN(n) ? null : Math.max(60, Math.min(600, n));
  }

  iconoOrden(id: string): string {
    const o = this.store.orden().find(x => x.ref === id);
    if (!o) return 'swap_vert';
    return o.direccion === 'ASC' ? 'arrow_upward' : 'arrow_downward';
  }

  tooltipOrden(id: string): string {
    const o = this.store.orden().find(x => x.ref === id);
    if (!o) return 'Ordenar por esta columna';
    return o.direccion === 'ASC' ? 'Ascendente — clic para descendente' : 'Descendente — clic para quitar';
  }

  rotuloAgregacion(a: string): string {
    const mapa: Record<string, string> = {
      COUNT: 'Contar', COUNT_DISTINCT: 'Contar distintos',
      SUM: 'Sumar', AVG: 'Promedio', MIN: 'Mínimo', MAX: 'Máximo',
    };
    return mapa[a] ?? a;
  }

  rotuloTransformacion(t: string): string {
    return TRANSFORMACIONES_FECHA.find(x => x.valor === t)?.etiqueta ?? t;
  }
}
