import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Catalogo, GrupoVariables, Variable } from '../../models/plantilla-correo.model';

/**
 * Panel lateral de variables: el catálogo de lo que se puede escribir entre
 * llaves, agrupado por bloque temático.
 *
 * <h3>Por qué se inserta con un clic y no se teclea</h3>
 * Porque `{{candidato.nombre}}` no existe — la clave real es
 * `candidato.nombre_completo` — y un error así solo se descubre cuando el correo
 * ya salió con el marcador literal en medio del texto. Insertando desde aquí, la
 * clave es correcta por construcción.
 *
 * El buscador filtra por etiqueta y por clave a la vez: quien escribe piensa en
 * "fecha de ingreso", no en `contrato.fecha_ingreso`.
 */
@Component({
  selector: 'app-panel-variables',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, MatExpansionModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatTooltipModule,
  ],
  template: `
    <div class="pvar">
      <div class="pvar__cab">
        <mat-icon>data_object</mat-icon>
        <div>
          <div class="pvar__titulo">Variables disponibles</div>
          <div class="pvar__sub">
            {{ catalogo()?.origen_nombre ?? catalogo()?.origen_codigo ?? 'Sin origen' }}
            · {{ total() }} campos
          </div>
        </div>
      </div>

      <mat-form-field appearance="outline" class="pvar__buscar" subscriptSizing="dynamic">
        <mat-icon matPrefix>search</mat-icon>
        <input matInput placeholder="Buscar variable…" [(ngModel)]="filtroTexto"
               (ngModelChange)="filtro.set($event)" />
      </mat-form-field>

      @if (!total()) {
        <p class="pvar__vacio">
          Esta plantilla no tiene un origen de datos asignado, así que solo puede usar variables
          del sistema. Elige un origen en los ajustes de la plantilla para citar datos de
          contratación.
        </p>
      }

      <mat-accordion multi displayMode="flat" class="pvar__lista">
        @for (g of gruposFiltrados(); track g.grupo) {
          <mat-expansion-panel [expanded]="!!filtro() || $first">
            <mat-expansion-panel-header>
              <mat-panel-title>{{ g.grupo }}</mat-panel-title>
              <mat-panel-description>{{ g.variables.length }}</mat-panel-description>
            </mat-expansion-panel-header>

            @for (v of g.variables; track v.id) {
              <button type="button" class="pvar__item" (click)="insertar.emit(v)"
                      [matTooltip]="tooltip(v)" matTooltipPosition="left">
                <span class="pvar__etiqueta">{{ v.etiqueta }}</span>
                <code class="pvar__clave">{{ marcador(v.clave) }}</code>
                <mat-icon class="pvar__add">add_circle_outline</mat-icon>
              </button>
            }
          </mat-expansion-panel>
        }
      </mat-accordion>
    </div>
  `,
  styles: [`
    .pvar { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; }
    .pvar__cab { display: flex; align-items: center; gap: 10px; }
    .pvar__titulo { font-weight: 600; font-size: 14px; }
    .pvar__sub { font-size: 12px; color: var(--mat-sys-on-surface-variant, #5f6368); }
    .pvar__buscar { width: 100%; }
    .pvar__vacio { font-size: 12.5px; line-height: 1.5; color: #6b7280; margin: 0; }
    .pvar__lista { flex: 1 1 auto; overflow: auto; min-height: 0; }
    .pvar__item {
      display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
      background: none; border: 0; border-radius: 6px; padding: 6px 8px; cursor: pointer; font: inherit;
    }
    .pvar__item:hover { background: rgba(15, 118, 110, .08); }
    .pvar__etiqueta { flex: 1 1 auto; font-size: 13px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pvar__clave { font-size: 10.5px; color: #0f766e; background: rgba(15,118,110,.1); padding: 1px 5px; border-radius: 3px; }
    .pvar__add { font-size: 18px; width: 18px; height: 18px; opacity: .45; }
    .pvar__item:hover .pvar__add { opacity: 1; }
  `],
})
export class PanelVariablesComponent {
  readonly catalogo = input<Catalogo | null>(null);
  /** Clave que el editor debe insertar en el punto donde esté el cursor. */
  readonly insertar = output<Variable>();

  filtroTexto = '';
  readonly filtro = signal('');

  readonly total = computed(() =>
    (this.catalogo()?.grupos ?? []).reduce((n, g) => n + g.variables.length, 0));

  readonly gruposFiltrados = computed<GrupoVariables[]>(() => {
    const grupos = this.catalogo()?.grupos ?? [];
    const q = this.filtro().trim().toLowerCase();
    if (!q) return grupos;
    return grupos
      .map((g) => ({
        grupo: g.grupo,
        // Se busca en etiqueta Y clave: quien redacta piensa en "fecha de
        // ingreso", quien depura piensa en contrato.fecha_ingreso.
        variables: g.variables.filter(
          (v) => v.etiqueta.toLowerCase().includes(q) || v.clave.toLowerCase().includes(q)),
      }))
      .filter((g) => g.variables.length > 0);
  });

  /**
   * El marcador tal como se escribe en la plantilla.
   *
   * Se arma en TypeScript y no en el HTML porque Angular decodifica las
   * entidades (`&#123;`) ANTES de buscar interpolaciones: escribir las llaves
   * escapadas en la plantilla produce una interpolación real y el componente no
   * compila. Es un tropiezo fácil de repetir; de ahí este método.
   */
  marcador(clave: string): string {
    return `{{${clave}}}`;
  }

  tooltip(v: Variable): string {
    const partes = [v.descripcion ?? '', v.ejemplo ? `Ejemplo: ${v.ejemplo}` : ''];
    return partes.filter(Boolean).join(' · ') || v.clave;
  }
}
