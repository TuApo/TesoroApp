import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import { MatTooltipModule } from '@angular/material/tooltip';

import { EditorTextoRicoComponent } from '../editor-texto-rico/editor-texto-rico.component';
import { Activo, Bloque } from '../../models/plantilla-correo.model';

/**
 * Propiedades del bloque seleccionado.
 *
 * <h3>Por qué no hay selector de fuente ni de tamaño por bloque</h3>
 * Porque son del **tema**, no del bloque. Un correo en el que cada párrafo elige
 * su tipografía se ve hecho a trozos, y además hace imposible cambiar el aspecto
 * de una plantilla sin repasar bloque por bloque. Lo que sí es por bloque es lo
 * que de verdad cambia entre uno y otro: alineación, relleno y color puntual.
 *
 * <h3>Los cambios salen en cada tecla</h3>
 * Y quien escucha decide cuándo persistir. La página contenedora aplica un
 * retardo antes de llamar al autoguardado: guardar en cada pulsación sería una
 * petición por letra.
 */
@Component({
  selector: 'app-props-bloque',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, EditorTextoRicoComponent,
    MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatSelectModule, MatSliderModule, MatTooltipModule,
  ],
  templateUrl: './props-bloque.component.html',
  styleUrl: './props-bloque.component.css',
})
export class PropsBloqueComponent {
  /**
   * Textos de ayuda que contienen llaves dobles. Viven aquí y no en el HTML
   * porque Angular decodifica `&#123;` antes de parsear, y unas llaves escapadas
   * en la plantilla acaban siendo una interpolación que no compila.
   */
  readonly EJEMPLO_VARIABLE = '{{candidato.primer_nombre}}';
  readonly EJEMPLO_ENLACE = 'https://… o {{variable}}';

  readonly bloque = input<Bloque | null>(null);
  readonly activos = input<Activo[]>([]);

  readonly cambio = output<Bloque>();
  /** Pide a la página que abra la biblioteca de medios para este bloque. */
  readonly elegirMedio = output<{ bloque: Bloque; campo: string; tipo: 'IMAGEN' | 'VIDEO' }>();

  readonly imagenes = computed(() => this.activos().filter((a) => a.tipo === 'IMAGEN'));
  readonly videos = computed(() => this.activos().filter((a) => a.tipo === 'VIDEO'));

  readonly filas = computed<Array<{ etiqueta: string; valor: string }>>(
    () => this.bloque()?.props?.['filas'] ?? []);

  /** Escribe una propiedad y emite el bloque completo (inmutable). */
  set(campo: string, valor: unknown): void {
    const b = this.bloque();
    if (!b) return;
    this.cambio.emit({ ...b, props: { ...b.props, [campo]: valor } });
  }

  setNumero(campo: string, valor: string | number | null): void {
    const n = typeof valor === 'number' ? valor : Number(valor);
    this.set(campo, Number.isFinite(n) ? n : null);
  }

  // ── Tabla de datos ─────────────────────────────────────────────────────────

  agregarFila(): void {
    this.set('filas', [...this.filas(), { etiqueta: '', valor: '' }]);
  }

  editarFila(i: number, campo: 'etiqueta' | 'valor', valor: string): void {
    const copia = this.filas().map((f, idx) => (idx === i ? { ...f, [campo]: valor } : f));
    this.set('filas', copia);
  }

  quitarFila(i: number): void {
    this.set('filas', this.filas().filter((_, idx) => idx !== i));
  }

  urlDe(id: string | null | undefined): string | null {
    if (!id) return null;
    return this.activos().find((a) => a.id === id)?.url ?? null;
  }

  /**
   * Al elegir un vídeo de la biblioteca se copian su enlace y su miniatura de
   * golpe. Dejar que el usuario los seleccione por separado es garantía de que
   * un día se publique una miniatura que enlaza a otro vídeo.
   */
  elegirVideo(activoId: string): void {
    const b = this.bloque();
    const v = this.videos().find((a) => a.id === activoId);
    if (!b || !v) return;
    this.cambio.emit({
      ...b,
      props: { ...b.props, url: v.url_externa ?? '', activoId: v.miniatura_id ?? null, alt: v.nombre },
    });
  }
}
