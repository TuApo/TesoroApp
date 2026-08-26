import {
  Component, Input, OnInit, inject, signal, ElementRef, ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import Swal from 'sweetalert2';

import { PlantillasService } from '../../services/plantillas.service';
import { CampoDiccionario } from '../../models/plantillas.models';

/**
 * Editor de texto para los modos HTML y RICH.
 *
 * POR QUE NO SE USA QUILL / TINYMCE / CKEDITOR: el PDF lo genera flying-saucer,
 * que exige XHTML BIEN FORMADO. Esos editores emiten HTML permisivo —etiquetas
 * sin cerrar, <br>, atributos sueltos— que revienta el render, y el usuario se
 * encontraría con "no se pudo generar el PDF" sin saber por qué. Un editor
 * acotado que solo produce el subconjunto que el motor entiende es aquí una
 * ventaja, no una limitación.
 *
 * Las variables se insertan como {{clave}} y se pintan como fichas mediante
 * CSS, sin nodos especiales: así lo que se guarda es exactamente lo que el
 * motor va a fusionar, sin conversiones intermedias que se puedan desincronizar.
 */
@Component({
  selector: 'app-rich-editor',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatSelectModule, MatTooltipModule, MatTabsModule, MatSnackBarModule,
  ],
  templateUrl: './rich-editor.component.html',
  styleUrl: './rich-editor.component.css',
})
export class RichEditorComponent implements OnInit {
  @Input({ required: true }) versionId!: number;
  @Input({ required: true }) diccionario: CampoDiccionario[] = [];
  @Input() htmlInicial: string | null = null;
  @Input() editable = true;

  @ViewChild('lienzo') lienzo?: ElementRef<HTMLDivElement>;

  private srv = inject(PlantillasService);
  private snack = inject(MatSnackBar);

  readonly guardando = signal(false);
  readonly variable = signal<string | null>(null);
  readonly modoFuente = signal(false);
  readonly fuente = signal('');

  ngOnInit(): void {
    this.fuente.set(this.htmlInicial ?? '');
    queueMicrotask(() => {
      if (this.lienzo) this.lienzo.nativeElement.innerHTML = this.htmlInicial ?? '<p></p>';
    });
  }

  /**
   * Formato básico. `execCommand` está marcado como obsoleto pero sigue siendo
   * lo único que funciona igual en todos los navegadores para contenteditable;
   * su sustituto (la Editing API) no está implementado en ninguno todavía.
   */
  formato(comando: string): void {
    if (!this.editable) return;
    document.execCommand(comando, false);
    this.lienzo?.nativeElement.focus();
  }

  /** Inserta {{clave}} donde esté el cursor. */
  insertarVariable(): void {
    const clave = this.variable();
    if (!clave || !this.editable) return;
    this.lienzo?.nativeElement.focus();
    document.execCommand('insertText', false, `{{${clave}}}`);
    this.variable.set(null);
  }

  alternarFuente(): void {
    if (this.modoFuente()) {
      // Volviendo al editor visual: lo tecleado a mano manda.
      if (this.lienzo) this.lienzo.nativeElement.innerHTML = this.fuente();
      this.modoFuente.set(false);
    } else {
      this.fuente.set(this.lienzo?.nativeElement.innerHTML ?? '');
      this.modoFuente.set(true);
    }
  }

  private htmlActual(): string {
    return this.modoFuente() ? this.fuente() : (this.lienzo?.nativeElement.innerHTML ?? '');
  }

  /** Avisa de variables escritas a mano que no existen en el diccionario. */
  private variablesInvalidas(html: string): string[] {
    const usadas = [...html.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map(m => m[1]);
    const validas = new Set(this.diccionario.map(d => d.clave));
    return [...new Set(usadas.filter(u => !validas.has(u)))];
  }

  guardar(): void {
    const html = this.htmlActual();
    const malas = this.variablesInvalidas(html);
    if (malas.length) {
      // Se avisa ANTES de guardar: una etiqueta mal escrita saldría como hueco
      // en el documento final, sin ningún error visible.
      Swal.fire({
        icon: 'warning',
        title: 'Hay etiquetas que no existen',
        html: `Estas variables no están en la lista de datos disponibles y saldrán vacías:` +
              `<br><br><code>${malas.join('</code><br><code>')}</code>`,
      });
      return;
    }

    this.guardando.set(true);
    this.srv.guardarHtml(this.versionId, html).subscribe({
      next: r => {
        this.guardando.set(false);
        this.snack.open(`Guardado (${r.caracteres} caracteres).`, 'Cerrar', { duration: 4000 });
      },
      error: e => {
        this.guardando.set(false);
        Swal.fire('No se pudo guardar', e?.error?.message ?? 'Revise el contenido.', 'error');
      },
    });
  }

  previsualizar(): void {
    this.srv.previsualizar(this.versionId).subscribe({
      next: blob => window.open(URL.createObjectURL(blob), '_blank'),
      error: e => Swal.fire('No se pudo generar la vista previa',
        // flying-saucer falla con XHTML mal formado: decirlo ahorra buscar a ciegas.
        e?.error?.message ?? 'Suele ser HTML mal formado: alguna etiqueta sin cerrar.', 'error'),
    });
  }
}
