import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy, AfterViewInit,
  HostListener, ChangeDetectionStrategy, ChangeDetectorRef,
  signal, computed, ElementRef, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';

import {
  CampoDto, CampoDisponible, PaginaPlantilla,
  FuentePersonalizada, FuenteRequest,
  TAMANOS_PAGINA, FUENTES_ESTANDAR, CANVAS_SCALE_PX_PER_MM,
} from '../../../models/plantilla-eps.models';
import { PlantillaEpsService } from '../../../services/plantilla-eps.service';

const DIMENSIONES: Record<'CARTA' | 'OFICIO', { w: number; h: number }> = {
  CARTA:  { w: 215.9, h: 279.4 },
  OFICIO: { w: 215.9, h: 330.2 },
};

type DragMode =
  | 'move'
  | 'resize-n' | 'resize-ne' | 'resize-e' | 'resize-se'
  | 'resize-s' | 'resize-sw' | 'resize-w' | 'resize-nw';

@Component({
  selector: 'app-canvas-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatTooltipModule,
    MatSelectModule, MatFormFieldModule, MatInputModule,
    MatSlideToggleModule, MatSnackBarModule, MatDividerModule, MatChipsModule,
  ],
  templateUrl: './canvas-editor.component.html',
  styleUrls: ['./canvas-editor.component.css'],
})
export class CanvasEditorComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('canvasArea') canvasAreaRef!: ElementRef<HTMLDivElement>;

  /** ID de la plantilla. */
  @Input() plantillaId!: number;

  @Input() set campos(val: CampoDto[]) {
    this._campos = val.map(c => ({ ...c, _uid: c._uid ?? ++this.nextUid }));
    this.bumpCampos();
  }
  get campos(): CampoDto[] { return this._campos; }

  @Input() camposDisponibles: CampoDisponible[] = [];
  @Output() camposSaved = new EventEmitter<CampoDto[]>();

  // Estado interno
  _campos: CampoDto[] = [];
  paginas: PaginaPlantilla[] = [];
  fuentes: FuentePersonalizada[] = [];
  paginaActual = signal(1);
  campoSeleccionado = signal<CampoDto | null>(null);

  /** Escala px/mm — actualizada por ResizeObserver para llenar el contenedor. */
  scale = CANVAS_SCALE_PX_PER_MM;

  private nextUid = 0;
  private _camposVersion = signal(0);
  private resizeObserver?: ResizeObserver;

  // Drag / resize
  private dragMode: DragMode | null = null;
  private dragCampo: CampoDto | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOrigX = 0;
  private dragOrigY = 0;
  private dragOrigAncho = 0;
  private dragOrigAlto  = 0;

  // Paneles
  mostrarPanelFuentes = false;
  mostrarAgregarCampo = false;

  // Subida de fuente
  nuevaFuente: FuenteRequest = { nombre: '', cssFamilia: '', archivoB64: null };
  subiendoFuente = false;

  // Imágenes de fondo
  imagenesFondo: Map<number, string> = new Map();

  readonly tamanos = TAMANOS_PAGINA;
  readonly fuentesEstandar = FUENTES_ESTANDAR;

  camposPaginaActual = computed(() => {
    this._camposVersion(); // dependencia reactiva en mutaciones del array
    const pag = this.paginaActual();
    return this._campos.filter(c => c.pagina === pag);
  });

  get dimensiones() {
    const pag = this.paginas.find(p => p.numero === this.paginaActual());
    return DIMENSIONES[pag?.tamano ?? 'CARTA'];
  }

  get canvasWidthPx()  { return this.dimensiones.w * this.scale; }
  get canvasHeightPx() { return this.dimensiones.h * this.scale; }
  get guideGridPx()    { return 10 * this.scale; }

  constructor(
    private svc: PlantillaEpsService,
    private snack: MatSnackBar,
    public cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.cargarPaginas();
    this.cargarFuentes();
  }

  ngAfterViewInit() {
    this.resizeObserver = new ResizeObserver(() => this.updateScale());
    this.resizeObserver.observe(this.canvasAreaRef.nativeElement);
    this.updateScale();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }

  private updateScale() {
    const el = this.canvasAreaRef?.nativeElement;
    if (!el) return;
    const availWidth = el.clientWidth - 16; // 8px padding a cada lado
    if (availWidth < 50) return; // tab oculto o aún no visible
    const newScale = Math.max(1.5, availWidth / 215.9);
    if (Math.abs(newScale - this.scale) > 0.05) {
      this.scale = newScale;
      this.cdr.markForCheck();
    }
  }

  private bumpCampos() {
    this._camposVersion.update(v => v + 1);
    this.cdr.markForCheck();
  }

  // ── Páginas ───────────────────────────────────────────────────────────────

  cargarPaginas() {
    this.svc.listarPaginas(this.plantillaId).subscribe({
      next: ps => {
        this.paginas = ps.length > 0 ? ps : [{ numero: 1, tamano: 'CARTA', tieneImagen: false }];
        this.paginaActual.set(this.paginas[0].numero);
        this.cdr.markForCheck();
        this.paginas.filter(p => p.tieneImagen).forEach(p => this.cargarFondo(p.numero));
      },
      error: () => {
        this.paginas = [{ numero: 1, tamano: 'CARTA', tieneImagen: false }];
        this.cdr.markForCheck();
      }
    });
  }

  cargarFondo(numPagina: number) {
    this.svc.obtenerFondoPagina(this.plantillaId, numPagina).subscribe({
      next: dataUri => { this.imagenesFondo.set(numPagina, dataUri); this.cdr.markForCheck(); },
      error: () => {}
    });
  }

  agregarPagina() {
    const ultimo = this.paginas.reduce((max, p) => Math.max(max, p.numero), 0);
    this.paginas.push({ numero: ultimo + 1, tamano: 'CARTA', tieneImagen: false });
    this.paginaActual.set(ultimo + 1);
    this.cdr.markForCheck();
  }

  eliminarPaginaActual() {
    if (this.paginas.length <= 1) {
      this.snack.open('Debe haber al menos una página', '', { duration: 2000 });
      return;
    }
    const numActual = this.paginaActual();
    this.paginas = this.paginas.filter(p => p.numero !== numActual);
    this.paginas.forEach((p, i) => p.numero = i + 1);
    this._campos.forEach(c => { if (c.pagina === numActual) c.pagina = 1; });
    this.paginaActual.set(this.paginas[0].numero);
    this.bumpCampos();
  }

  onFondoFileChange(event: Event, numPagina: number) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      this.imagenesFondo.set(numPagina, dataUri);
      const pag = this.paginas.find(p => p.numero === numPagina);
      if (pag) { pag.tieneImagen = true; pag.imagenFondo = dataUri; }
      this.cdr.markForCheck();
    };
    reader.readAsDataURL(input.files[0]);
  }

  quitarFondo(numPagina: number) {
    this.imagenesFondo.delete(numPagina);
    const pag = this.paginas.find(p => p.numero === numPagina);
    if (pag) { pag.tieneImagen = false; pag.imagenFondo = null; }
    this.cdr.markForCheck();
  }

  cambiarTamanoPagina(numPagina: number, tamano: 'CARTA' | 'OFICIO') {
    const pag = this.paginas.find(p => p.numero === numPagina);
    if (pag) {
      pag.tamano = tamano;
      this.cdr.markForCheck();
      setTimeout(() => this.updateScale(), 0);
    }
  }

  fondoActual(): string | undefined {
    return this.imagenesFondo.get(this.paginaActual());
  }

  // ── Fuentes ───────────────────────────────────────────────────────────────

  cargarFuentes() {
    this.svc.listarFuentes().subscribe({
      next: fs => { this.fuentes = fs; this.cdr.markForCheck(); },
      error: () => {}
    });
  }

  onFuenteFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      this.nuevaFuente.archivoB64 = reader.result as string;
      if (!this.nuevaFuente.cssFamilia) {
        this.nuevaFuente.cssFamilia = file.name.replace(/\.(ttf|otf)$/i, '');
        this.nuevaFuente.nombre     = this.nuevaFuente.cssFamilia;
      }
      this.cdr.markForCheck();
    };
    reader.readAsDataURL(file);
  }

  subirFuente() {
    if (!this.nuevaFuente.nombre || !this.nuevaFuente.cssFamilia) {
      this.snack.open('Nombre y familia CSS son obligatorios', '', { duration: 2000 });
      return;
    }
    this.subiendoFuente = true;
    this.svc.crearFuente(this.nuevaFuente).subscribe({
      next: f => {
        this.fuentes.push(f);
        this.nuevaFuente = { nombre: '', cssFamilia: '', archivoB64: null };
        this.subiendoFuente = false;
        this.snack.open('Fuente subida', '', { duration: 2000 });
        this.cdr.markForCheck();
      },
      error: () => {
        this.subiendoFuente = false;
        this.snack.open('Error al subir la fuente', '', { duration: 3000 });
        this.cdr.markForCheck();
      }
    });
  }

  eliminarFuente(id: number) {
    this.svc.desactivarFuente(id).subscribe({
      next: () => { this.fuentes = this.fuentes.filter(f => f.id !== id); this.cdr.markForCheck(); },
      error: () => this.snack.open('Error al eliminar fuente', '', { duration: 2000 })
    });
  }

  // ── Campos ────────────────────────────────────────────────────────────────

  /**
   * Agrega un campo al canvas. El mismo campo puede colocarse varias veces:
   * el placeholder se hace único (cedula, cedula_2, cedula_3…)
   * pero campoFuente siempre apunta al campo real (cedula).
   * El PDF renderer usa campoFuente, no placeholder, para buscar el valor.
   */
  agregarCampoDesdeDisponible(cd: CampoDisponible) {
    let placeholder = cd.campo;
    if (this._campos.some(c => c.placeholder === placeholder)) {
      for (let i = 2; i <= 99; i++) {
        const candidate = `${cd.campo}_${i}`;
        if (!this._campos.some(c => c.placeholder === candidate)) {
          placeholder = candidate;
          break;
        }
      }
    }

    const nuevo: CampoDto = {
      id:                0,
      _uid:              ++this.nextUid,
      placeholder,
      fuente:            cd.fuente as any,
      campoFuente:       cd.campo,
      fuenteConfigCampo: cd.fuente === 'TEMPORAL_CONFIG' ? cd.campo : null,
      valorLiteral:      null,
      formula:           null,
      tipoRender:        'TEXTO',
      formato:           null,
      activo:            true,
      orden:             this._campos.length,
      pagina:            this.paginaActual(),
      posX:              10,
      posY:              10,
      ancho:             80,
      alto:              8,
      fontSize:          10,
      fontFamily:        null,
      fontColor:         '#000000',
      fontBold:          false,
      fontItalic:        false,
      textAlign:         'LEFT',
    };
    this._campos.push(nuevo);
    this.campoSeleccionado.set(nuevo);
    this.bumpCampos();
  }

  seleccionarCampo(campo: CampoDto, event: MouseEvent) {
    event.stopPropagation();
    this.campoSeleccionado.set(campo);
  }

  deseleccionar() {
    this.campoSeleccionado.set(null);
  }

  eliminarCampoSeleccionado() {
    const sel = this.campoSeleccionado();
    if (!sel) return;
    this._campos = this._campos.filter(c => c !== sel);
    this.campoSeleccionado.set(null);
    this.bumpCampos();
  }

  duplicarCampoSeleccionado() {
    const sel = this.campoSeleccionado();
    if (!sel) return;
    let placeholder = sel.placeholder + '_copia';
    for (let i = 2; i <= 99 && this._campos.some(c => c.placeholder === placeholder); i++) {
      placeholder = sel.placeholder + '_copia_' + i;
    }
    const copia: CampoDto = { ...sel, id: 0, _uid: ++this.nextUid, placeholder, posX: sel.posX + 5, posY: sel.posY + 5 };
    this._campos.push(copia);
    this.campoSeleccionado.set(copia);
    this.bumpCampos();
  }

  get isEstandar(): boolean {
    const sel = this.campoSeleccionado();
    if (!sel?.fontFamily) return true;
    return this.fuentesEstandar.includes(sel.fontFamily);
  }

  setFontFamily(campo: CampoDto, value: string) {
    campo.fontFamily = value || null;
    this.cdr.markForCheck();
  }

  // ── Drag & Resize ─────────────────────────────────────────────────────────

  private initDrag(campo: CampoDto, mode: DragMode, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.dragMode      = mode;
    this.dragCampo     = campo;
    this.dragStartX    = event.clientX;
    this.dragStartY    = event.clientY;
    this.dragOrigX     = campo.posX;
    this.dragOrigY     = campo.posY;
    this.dragOrigAncho = campo.ancho;
    this.dragOrigAlto  = campo.alto;
    this.campoSeleccionado.set(campo);
  }

  onCampoMouseDown(campo: CampoDto, event: MouseEvent) {
    this.initDrag(campo, 'move', event);
  }

  onResizeMouseDown(campo: CampoDto, mode: DragMode, event: MouseEvent) {
    this.initDrag(campo, mode, event);
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (!this.dragMode || !this.dragCampo) return;
    const c   = this.dragCampo;
    const dx  = (event.clientX - this.dragStartX) / this.scale;
    const dy  = (event.clientY - this.dragStartY) / this.scale;
    const dim = this.dimensiones;
    const MIN = 3;

    switch (this.dragMode) {
      case 'move':
        c.posX = Math.max(0, Math.min(dim.w - c.ancho, this.dragOrigX + dx));
        c.posY = Math.max(0, Math.min(dim.h - c.alto,  this.dragOrigY + dy));
        break;

      case 'resize-e':
        c.ancho = Math.max(MIN, Math.min(dim.w - this.dragOrigX, this.dragOrigAncho + dx));
        break;

      case 'resize-s':
        c.alto = Math.max(MIN, Math.min(dim.h - this.dragOrigY, this.dragOrigAlto + dy));
        break;

      case 'resize-se':
        c.ancho = Math.max(MIN, Math.min(dim.w - this.dragOrigX, this.dragOrigAncho + dx));
        c.alto  = Math.max(MIN, Math.min(dim.h - this.dragOrigY, this.dragOrigAlto  + dy));
        break;

      case 'resize-w': {
        const nx = Math.max(0, Math.min(this.dragOrigX + this.dragOrigAncho - MIN, this.dragOrigX + dx));
        c.ancho = Math.max(MIN, this.dragOrigAncho + (this.dragOrigX - nx));
        c.posX  = nx;
        break;
      }

      case 'resize-n': {
        const ny = Math.max(0, Math.min(this.dragOrigY + this.dragOrigAlto - MIN, this.dragOrigY + dy));
        c.alto = Math.max(MIN, this.dragOrigAlto + (this.dragOrigY - ny));
        c.posY = ny;
        break;
      }

      case 'resize-nw': {
        const nx = Math.max(0, Math.min(this.dragOrigX + this.dragOrigAncho - MIN, this.dragOrigX + dx));
        c.ancho = Math.max(MIN, this.dragOrigAncho + (this.dragOrigX - nx));
        c.posX  = nx;
        const ny = Math.max(0, Math.min(this.dragOrigY + this.dragOrigAlto - MIN, this.dragOrigY + dy));
        c.alto = Math.max(MIN, this.dragOrigAlto + (this.dragOrigY - ny));
        c.posY = ny;
        break;
      }

      case 'resize-ne': {
        c.ancho = Math.max(MIN, Math.min(dim.w - this.dragOrigX, this.dragOrigAncho + dx));
        const ny = Math.max(0, Math.min(this.dragOrigY + this.dragOrigAlto - MIN, this.dragOrigY + dy));
        c.alto = Math.max(MIN, this.dragOrigAlto + (this.dragOrigY - ny));
        c.posY = ny;
        break;
      }

      case 'resize-sw': {
        const nx = Math.max(0, Math.min(this.dragOrigX + this.dragOrigAncho - MIN, this.dragOrigX + dx));
        c.ancho = Math.max(MIN, this.dragOrigAncho + (this.dragOrigX - nx));
        c.posX  = nx;
        c.alto  = Math.max(MIN, Math.min(dim.h - this.dragOrigY, this.dragOrigAlto + dy));
        break;
      }
    }

    c.posX  = Math.round(c.posX  * 100) / 100;
    c.posY  = Math.round(c.posY  * 100) / 100;
    c.ancho = Math.round(c.ancho * 100) / 100;
    c.alto  = Math.round(c.alto  * 100) / 100;
    this.cdr.markForCheck();
  }

  @HostListener('document:mouseup')
  onMouseUp() {
    this.dragMode  = null;
    this.dragCampo = null;
  }

  // ── Guardar ───────────────────────────────────────────────────────────────

  guardar() {
    const paginasReqs = this.paginas.map(p => ({
      numero:      p.numero,
      tamano:      p.tamano,
      imagenFondo: this.imagenesFondo.get(p.numero) ?? null,
    }));
    this.svc.guardarPaginas(this.plantillaId, paginasReqs).subscribe({
      next: () => {
        this.snack.open('Páginas guardadas', '', { duration: 2000 });
        this.camposSaved.emit([...this._campos]);
      },
      error: () => this.snack.open('Error al guardar las páginas', '', { duration: 3000 })
    });
  }

  // ── Helpers de template ───────────────────────────────────────────────────

  /** Etiqueta visual: muestra el campo fuente real (no el placeholder interno). */
  campoLabel(campo: CampoDto): string {
    return campo.campoFuente || campo.placeholder;
  }

  campoStyle(campo: CampoDto): Record<string, string> {
    return {
      left:       `${campo.posX   * this.scale}px`,
      top:        `${campo.posY   * this.scale}px`,
      width:      `${campo.ancho  * this.scale}px`,
      height:     `${campo.alto   * this.scale}px`,
      fontSize:   `${campo.fontSize * this.scale / 3.5}px`,
      fontFamily: campo.fontFamily && !campo.fontFamily.startsWith('custom:')
                   ? campo.fontFamily : 'Helvetica, sans-serif',
      color:      campo.fontColor || '#000000',
      fontWeight: campo.fontBold   ? 'bold'   : 'normal',
      fontStyle:  campo.fontItalic ? 'italic' : 'normal',
      textAlign:  campo.textAlign  ? campo.textAlign.toLowerCase() : 'left',
    };
  }

  trackByCampo(_: number, c: CampoDto): number { return c._uid ?? _; }
  trackByPagina(_: number, p: PaginaPlantilla): number { return p.numero; }
}
