import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Vista previa del correo.
 *
 * <h3>Por qué un iframe con `sandbox` y no `[innerHTML]`</h3>
 * El cuerpo es HTML escrito por personas: en modo HTML se pega tal cual desde
 * Stripo, con `<style>`, tablas anidadas y comentarios condicionales. Meterlo
 * con `[innerHTML]` tendría dos problemas: Angular sanea y **rompe** justo lo
 * que hace que un correo se vea bien, y el CSS del correo se filtraría al resto
 * del dashboard.
 *
 * El iframe resuelve los dos: aísla los estilos y, con `sandbox` **sin**
 * `allow-scripts`, ningún script del cuerpo se ejecuta. Esa es la contención
 * real del HTML pegado — el saneado del backend es defensa en profundidad, no
 * la única barrera.
 *
 * <h3>Los dos anchos</h3>
 * 600 px es el ancho del lienzo de correo y 360 px el de un móvil. No es un
 * adorno: más de la mitad del correo se abre en el teléfono, y una tabla de
 * datos que se ve perfecta en escritorio se sale de la pantalla ahí. Poder
 * cambiar de uno a otro sin salir del editor es lo que hace que se revise.
 */
@Component({
  selector: 'app-preview-correo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonToggleModule, MatChipsModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="pv">
      <div class="pv__barra">
        <mat-button-toggle-group [value]="ancho()" (change)="ancho.set($event.value)" hideSingleSelectionIndicator>
          <mat-button-toggle value="escritorio" matTooltip="Ancho de escritorio (600 px)">
            <mat-icon>desktop_windows</mat-icon>
          </mat-button-toggle>
          <mat-button-toggle value="movil" matTooltip="Ancho de móvil (360 px)">
            <mat-icon>smartphone</mat-icon>
          </mat-button-toggle>
        </mat-button-toggle-group>

        <span class="pv__asunto" [title]="asunto()">
          <strong>Asunto:</strong> {{ asunto() || '(sin asunto)' }}
        </span>

        @if (!datosReales()) {
          <mat-chip class="pv__chip pv__chip--aviso" matTooltip="No hay un destinatario elegido: se están usando los valores de ejemplo del catálogo">
            <mat-icon matChipAvatar>science</mat-icon> Datos de ejemplo
          </mat-chip>
        } @else {
          <mat-chip class="pv__chip pv__chip--ok">
            <mat-icon matChipAvatar>person</mat-icon> {{ nombreSujeto() || 'Datos reales' }}
          </mat-chip>
        }
      </div>

      @if (preencabezado()) {
        <div class="pv__preheader" matTooltip="Texto gris que la bandeja de entrada muestra detrás del asunto">
          <mat-icon>subtitles</mat-icon> {{ preencabezado() }}
        </div>
      }

      <div class="pv__lienzo" [class.pv__lienzo--movil]="ancho() === 'movil'">
        <iframe
          class="pv__iframe"
          title="Vista previa del correo"
          [srcdoc]="html()"
          sandbox="allow-same-origin"
          referrerpolicy="no-referrer"></iframe>
      </div>

      @if (sinResolver().length) {
        <div class="pv__aviso">
          <mat-icon>report_problem</mat-icon>
          <div>
            <strong>{{ sinResolver().length }} variable(s) sin dato.</strong>
            Aparecen literales en el correo a propósito, para que se vean aquí y no en la bandeja
            de quien lo reciba:
            <code>{{ sinResolver().join(', ') }}</code>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .pv { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
    .pv__barra { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .pv__asunto {
      flex: 1 1 240px; min-width: 0; font-size: 13px; color: var(--mat-sys-on-surface-variant, #5f6368);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pv__chip { font-size: 12px; }
    .pv__chip--aviso { --mdc-chip-elevated-container-color: #fef3c7; }
    .pv__chip--ok { --mdc-chip-elevated-container-color: #d1fae5; }
    .pv__preheader {
      display: flex; align-items: center; gap: 6px; font-size: 12px; font-style: italic;
      color: #6b7280; background: #f8fafc; border-left: 3px solid #cbd5e1; padding: 6px 10px; border-radius: 4px;
    }
    .pv__preheader mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .pv__lienzo {
      flex: 1 1 auto; min-height: 420px; display: flex; justify-content: center;
      background: #e2e8f0; border-radius: 8px; padding: 12px; overflow: auto;
    }
    /* El iframe se lleva el ancho del lienzo de correo, no el del panel: así lo
       que se ve aquí es lo que llega, y no una versión estirada. */
    .pv__iframe { width: 100%; max-width: 640px; height: 100%; min-height: 400px; border: 0; background: #fff; border-radius: 6px; }
    .pv__lienzo--movil .pv__iframe { max-width: 360px; }
    .pv__aviso {
      display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.5;
      background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; padding: 10px 12px; border-radius: 6px;
    }
    .pv__aviso code { background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 3px; word-break: break-all; }
  `],
})
export class PreviewCorreoComponent {
  /** HTML ya renderizado por el backend (variables interpoladas incluidas). */
  readonly html = input.required<string>();
  readonly asunto = input<string>('');
  readonly preencabezado = input<string | null>(null);
  readonly datosReales = input<boolean>(false);
  readonly nombreSujeto = input<string | null>(null);
  readonly sinResolver = input<string[]>([]);

  readonly ancho = signal<'escritorio' | 'movil'>('escritorio');
}
