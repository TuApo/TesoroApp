import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, ViewChild,
  input, output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Editor de texto enriquecido mínimo para el cuerpo de un bloque de texto.
 *
 * <h3>Por qué está escrito a mano</h3>
 * El proyecto no tiene ninguna librería de editor instalada, y meter una
 * (Quill, TinyMCE, CKEditor) por un bloque de párrafo añadiría cientos de KB al
 * bundle y una dependencia más que actualizar. Lo que hace falta aquí es corto:
 * negrita, cursiva, subrayado, enlace, listas y alineación. Eso cabe en un
 * `contenteditable`.
 *
 * <h3>Sobre `document.execCommand`</h3>
 * Está marcado como obsoleto en la especificación, pero **no hay sustituto**:
 * el reemplazo (`EditContext`) todavía no está en todos los navegadores, y
 * `execCommand` sigue funcionando en los cuatro motores. Es lo que usan por
 * dentro las librerías que se habrían instalado. La alternativa real sería
 * manipular Selection/Range a mano, que es mucho más código para el mismo
 * resultado.
 *
 * <h3>El HTML que produce</h3>
 * `<b>`, `<i>`, `<u>`, `<a>`, `<ul>/<ol>` y `<div>` con alineación. Todo eso
 * viaja bien en correo. El backend lo pasa por el saneador antes de guardarlo,
 * y el compilador lo envuelve con el tamaño, color y fuente del tema, así que
 * no hace falta que el usuario toque estilos aquí.
 */
@Component({
  selector: 'app-editor-texto-rico',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="etr">
      <div class="etr__barra">
        <button type="button" mat-icon-button matTooltip="Negrita" (mousedown)="cmd($event, 'bold')">
          <mat-icon>format_bold</mat-icon>
        </button>
        <button type="button" mat-icon-button matTooltip="Cursiva" (mousedown)="cmd($event, 'italic')">
          <mat-icon>format_italic</mat-icon>
        </button>
        <button type="button" mat-icon-button matTooltip="Subrayado" (mousedown)="cmd($event, 'underline')">
          <mat-icon>format_underlined</mat-icon>
        </button>
        <span class="etr__sep"></span>
        <button type="button" mat-icon-button matTooltip="Lista con viñetas" (mousedown)="cmd($event, 'insertUnorderedList')">
          <mat-icon>format_list_bulleted</mat-icon>
        </button>
        <button type="button" mat-icon-button matTooltip="Lista numerada" (mousedown)="cmd($event, 'insertOrderedList')">
          <mat-icon>format_list_numbered</mat-icon>
        </button>
        <span class="etr__sep"></span>
        <button type="button" mat-icon-button matTooltip="Insertar enlace" (mousedown)="enlace($event)">
          <mat-icon>link</mat-icon>
        </button>
        <button type="button" mat-icon-button matTooltip="Quitar formato" (mousedown)="cmd($event, 'removeFormat')">
          <mat-icon>format_clear</mat-icon>
        </button>
      </div>

      <!-- El contenido NO se enlaza con [innerHTML] en cada cambio: reescribir el
           nodo mientras se escribe mueve el cursor al principio. Se siembra una
           vez en ngAfterViewInit y a partir de ahí manda el DOM. -->
      <div #zona class="etr__zona" contenteditable="true" spellcheck="true"
           role="textbox" aria-multiline="true" [attr.aria-label]="etiqueta()"
           (input)="emitir()" (blur)="emitir()"></div>
    </div>
  `,
  styles: [`
    .etr { border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; background: #fff; }
    .etr__barra {
      display: flex; align-items: center; gap: 2px; padding: 2px 4px;
      background: #f8fafc; border-bottom: 1px solid #e5e7eb; flex-wrap: wrap;
    }
    .etr__barra button { width: 32px; height: 32px; line-height: 32px; }
    .etr__barra mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .etr__sep { width: 1px; height: 20px; background: #e5e7eb; margin: 0 4px; }
    .etr__zona { min-height: 90px; padding: 10px 12px; font-size: 14px; line-height: 1.6; outline: none; }
    .etr__zona:focus { background: #fefefe; }
    .etr__zona p { margin: 0 0 8px; }
  `],
})
export class EditorTextoRicoComponent implements AfterViewInit {
  readonly html = input<string>('');
  readonly etiqueta = input<string>('Contenido del bloque');
  readonly htmlChange = output<string>();

  @ViewChild('zona') zona!: ElementRef<HTMLDivElement>;

  ngAfterViewInit(): void {
    this.zona.nativeElement.innerHTML = this.html() || '<p></p>';
  }

  /**
   * `mousedown` y no `click`: al pulsar un botón el `contenteditable` pierde el
   * foco y, con él, la selección. Previniendo el `mousedown` la selección
   * sobrevive y el comando se aplica sobre el texto que el usuario marcó.
   */
  cmd(ev: Event, comando: string, valor?: string): void {
    ev.preventDefault();
    this.zona.nativeElement.focus();
    document.execCommand(comando, false, valor);
    this.emitir();
  }

  enlace(ev: Event): void {
    ev.preventDefault();
    const url = window.prompt('Dirección del enlace (https://… o {{variable}})');
    if (!url) return;
    this.cmd(ev, 'createLink', url);
  }

  emitir(): void {
    this.htmlChange.emit(this.zona.nativeElement.innerHTML);
  }

  /** Repuebla la zona desde fuera (cambio de bloque seleccionado). */
  sembrar(html: string): void {
    if (this.zona) this.zona.nativeElement.innerHTML = html || '<p></p>';
  }
}
