import {
  Component, Input, OnInit, OnDestroy, inject, signal, computed, effect, ElementRef, ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragEnd } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import Swal from 'sweetalert2';

import { PlantillasService } from '../../services/plantillas.service';
import { CampoDiccionario, PlantillaCampo } from '../../models/plantillas.models';

/** Un dato colocado sobre el fondo. Las posiciones se guardan en PUNTOS PDF. */
interface CampoColocado {
  campoClave: string;
  etiqueta: string;
  pagina: number;
  xPt: number;
  yPt: number;
  anchoPt: number;
  fontSize: number;
  esImagen: boolean;
}

/**
 * Editor visual del modo OVERLAY: se arrastran los datos sobre la imagen del
 * formato.
 *
 * COORDENADAS — es donde esto se rompe si uno se despista. Hay TRES escalas:
 *   1. Puntos PDF     — lo que se guarda y lo que entiende PDFBox.
 *   2. Píxeles imagen  — el PNG que devuelve el backend (150 DPI).
 *   3. Píxeles pantalla— la imagen se muestra escalada para caber en el ancho.
 * Convertir solo entre 1 y 2 coloca los campos mal en cuanto la ventana cambia
 * de tamaño. Por eso se mide `naturalWidth / offsetWidth` en cada conversión.
 *
 * Y el origen: el editor piensa desde arriba-izquierda; PDFBox mide desde
 * abajo. Esa inversión la hace el backend (OverlayService), no esta pantalla:
 * repartirla entre las dos garantiza que algún día no cuadren.
 */
@Component({
  selector: 'app-overlay-editor',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DragDropModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatSelectModule, MatInputModule, MatTooltipModule, MatSnackBarModule,
  ],
  templateUrl: './overlay-editor.component.html',
  styleUrl: './overlay-editor.component.css',
})
export class OverlayEditorComponent implements OnInit, OnDestroy {
  @Input({ required: true }) versionId!: number;
  @Input({ required: true }) diccionario: CampoDiccionario[] = [];
  @Input() editable = true;

  @ViewChild('fondo') fondo?: ElementRef<HTMLImageElement>;

  private srv = inject(PlantillasService);
  private snack = inject(MatSnackBar);

  readonly paginas = signal(0);
  readonly paginaActual = signal(1);
  readonly campos = signal<CampoColocado[]>([]);
  readonly seleccionado = signal<CampoColocado | null>(null);
  readonly cargando = signal(true);
  readonly variableAAgregar = signal<string | null>(null);

  /** Object URL del fondo. Se revoca al cambiar de página: cada blob que no se
   *  libera se queda en memoria mientras viva la pestaña. */
  readonly urlFondo = signal<string | null>(null);
  readonly deEstaPagina = computed(() => this.campos().filter(c => c.pagina === this.paginaActual()));

  constructor() {
    // Cada cambio de página trae su imagen y suelta la anterior.
    effect(() => {
      const n = this.paginaActual();
      if (!this.versionId) return;
      this.srv.imagenPagina(this.versionId, n).subscribe({
        next: blob => {
          const previa = this.urlFondo();
          if (previa) URL.revokeObjectURL(previa);
          this.urlFondo.set(URL.createObjectURL(blob));
        },
        error: () => this.snack.open('No se pudo cargar el fondo de la página.', 'Cerrar', { duration: 5000 }),
      });
    });
  }

  ngOnDestroy(): void {
    const u = this.urlFondo();
    if (u) URL.revokeObjectURL(u);
  }

  ngOnInit(): void {
    this.srv.paginasDelFondo(this.versionId).subscribe({
      next: r => { this.paginas.set(r.paginas); this.cargando.set(false); },
      error: () => { this.cargando.set(false); this.snack.open('No se pudo leer el fondo.', 'Cerrar', { duration: 5000 }); },
    });
    this.srv.verMapeo(this.versionId).subscribe({
      next: guardados => this.campos.set(guardados
        .filter(g => g.campo_clave && (g as any).pos_x != null)
        .map(g => this.desdeGuardado(g))),
    });
  }

  private desdeGuardado(g: PlantillaCampo): CampoColocado {
    const def = this.diccionario.find(d => d.clave === g.campo_clave);
    return {
      campoClave: g.campo_clave!,
      etiqueta: def?.etiqueta ?? g.campo_clave!,
      pagina: g.pagina || 1,
      xPt: Number((g as any).pos_x ?? 0),
      yPt: Number((g as any).pos_y ?? 0),
      anchoPt: Number((g as any).ancho ?? 160),
      fontSize: Number((g as any).font_size ?? 10),
      esImagen: def?.tipo === 'IMAGEN' || def?.tipo === 'FIRMA',
    };
  }

  /** Píxeles de pantalla → puntos PDF. Mide la escala real cada vez. */
  private aPuntos(px: number): number {
    const img = this.fondo?.nativeElement;
    if (!img || !img.offsetWidth) return px;
    const escalaPantalla = img.naturalWidth / img.offsetWidth;   // 3 → 2
    const puntosPorPixelImagen = 72 / 150;                        // 2 → 1
    return px * escalaPantalla * puntosPorPixelImagen;
  }

  /** Puntos PDF → píxeles de pantalla, para pintar donde toca. */
  aPantalla(pt: number): number {
    const img = this.fondo?.nativeElement;
    if (!img || !img.offsetWidth) return pt;
    const escalaPantalla = img.naturalWidth / img.offsetWidth;
    return pt / (72 / 150) / escalaPantalla;
  }

  agregar(): void {
    const clave = this.variableAAgregar();
    if (!clave) return;
    const def = this.diccionario.find(d => d.clave === clave);
    // Nace en una esquina visible, no en el centro: en un formato denso el
    // centro suele caer encima de texto y no se ve que ha aparecido.
    this.campos.update(cs => [...cs, {
      campoClave: clave,
      etiqueta: def?.etiqueta ?? clave,
      pagina: this.paginaActual(),
      xPt: 60, yPt: 60, anchoPt: 160, fontSize: 10,
      esImagen: def?.tipo === 'IMAGEN' || def?.tipo === 'FIRMA',
    }]);
    this.variableAAgregar.set(null);
  }

  alSoltar(ev: CdkDragEnd, campo: CampoColocado): void {
    const d = ev.source.getFreeDragPosition();
    this.campos.update(cs => cs.map(c => c !== campo ? c : {
      ...c,
      xPt: this.aPuntos(this.aPantalla(c.xPt) + d.x),
      yPt: this.aPuntos(this.aPantalla(c.yPt) + d.y),
    }));
    ev.source.reset();   // la posición vive en el modelo, no en el transform
  }

  quitar(campo: CampoColocado): void {
    this.campos.update(cs => cs.filter(c => c !== campo));
    if (this.seleccionado() === campo) this.seleccionado.set(null);
  }

  cambiarTamano(campo: CampoColocado, fontSize: number): void {
    this.campos.update(cs => cs.map(c => c !== campo ? c : { ...c, fontSize }));
  }

  guardar(): void {
    const filas = this.campos().map((c, i) => ({
      campo_clave: c.campoClave,
      placeholder: `ov_${i}`,          // destino estable dentro de la versión
      pagina: c.pagina,
      pos_x: c.xPt,
      pos_y: c.yPt,
      ancho: c.anchoPt,
      font_size: c.fontSize,
      tipo_render: c.esImagen ? 'IMAGEN' : 'TEXTO',
      orden: i,
    }));
    this.srv.guardarMapeo(this.versionId, filas as any).subscribe({
      next: r => this.snack.open(`${r.campos_guardados} datos colocados.`, 'Cerrar', { duration: 4000 }),
      error: e => Swal.fire('No se pudo guardar', e?.error?.message ?? 'Revise las variables usadas.', 'error'),
    });
  }

  previsualizar(): void {
    this.srv.previsualizar(this.versionId).subscribe({
      next: blob => window.open(URL.createObjectURL(blob), '_blank'),
      error: () => this.snack.open('No se pudo generar la vista previa.', 'Cerrar', { duration: 5000 }),
    });
  }

  irAPagina(n: number): void {
    if (n >= 1 && n <= this.paginas()) this.paginaActual.set(n);
  }
}
