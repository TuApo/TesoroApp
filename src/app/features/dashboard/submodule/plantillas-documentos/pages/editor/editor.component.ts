import { Component, OnInit, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { StandardFilterTable } from '@/app/shared/components/standard-filter-table/standard-filter-table';
import { ColumnCellTemplateDirective } from '@/app/shared/directives/column-cell-template.directive';
import { ColumnDefinition } from '@/app/shared/models/advanced-table-interface';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import Swal from 'sweetalert2';

import { OverlayEditorComponent } from './overlay-editor.component';
import { RichEditorComponent } from './rich-editor.component';

import { PlantillasService } from '../../services/plantillas.service';
import {
  Plantilla, PlantillaVersion, PlantillaCampo, CampoDiccionario,
  CampoPdf, Sugerencia, Auditoria, OrigenDato, FilaMapeoGuardar, MODOS,
} from '../../models/plantillas.models';

/** Una fila de la tabla de mapeo: el campo del PDF y la variable que le toca. */
interface FilaMapeo {
  /**
   * Identidad de la fila. NO vale el nombre del campo del PDF: las casillas
   * dibujadas a mano no tienen ninguno.
   */
  id: string;
  campoPdf: string;
  /** Nombre de la casilla dibujada a mano. Nulo en las que trae el formato. */
  placeholder: string | null;
  /** Dibujada encima del formato porque ahí no había casilla. */
  libre: boolean;
  tipoPdf: string;
  pagina: number;
  esperaImagen: boolean;
  /** Rectangulo en puntos PDF, origen arriba-izquierda. Para dibujarlo encima. */
  x: number; y: number; ancho: number; alto: number;
  /**
   * La posición se cambió a mano. Solo entonces se manda al guardar: mandar la
   * de TODAS obligaría al motor a recolocar 243 casillas para dejarlas donde ya
   * estaban, y cualquier redondeo se acumularía.
   */
  movido: boolean;
  fontSize: number | null;
  campoClave: string | null;
  indice: number | null;
  obligatorio: boolean;
  /** De dónde vino: sugerencia automática o decisión de la persona. */
  sugerido: boolean;
  confianza: number;
  /**
   * La fila tal y como está guardada. Al guardar se parte de ella y solo se
   * pisa lo que esta pantalla gestiona.
   *
   * Antes se armaba la fila desde cero con los seis campos que se editan aquí,
   * y todo lo demás se perdía en silencio: guardar desde la interfaz borró las
   * OCHO casillas excluyentes de la Ficha Técnica —las seis de estado civil y
   * el par diestro/zurdo— y el documento pasó a marcarlas todas. No falló nada;
   * se vio en la vista del formato.
   */
  crudo: PlantillaCampo | null;
}

/** Lo que se está arrastrando o redimensionando en la vista del formato. */
interface Arrastre {
  fila: FilaMapeo;
  accion: 'mover' | 'redimensionar';
  xInicial: number; yInicial: number;
  cajaInicial: { x: number; y: number; ancho: number; alto: number };
}

/**
 * Configuración de un documento: su PDF, el mapeo de campos, sus versiones y
 * quién cambió qué.
 *
 * La idea de fondo: nadie debería tener que teclear 243 mapeos. Se proponen y
 * la persona revisa. Pero NADA se guarda hasta que pulsa guardar, y nada afecta
 * a producción hasta que publica y corta el motor.
 */
@Component({
  selector: 'app-plantillas-editor',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatCardModule, MatTabsModule, MatTableModule,
    MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatAutocompleteModule, MatChipsModule, MatTooltipModule, MatCheckboxModule,
    MatProgressSpinnerModule, MatSnackBarModule,
    OverlayEditorComponent, RichEditorComponent,
    StandardFilterTable, ColumnCellTemplateDirective,
  ],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.css',
})
export class EditorComponent implements OnInit {
  private srv = inject(PlantillasService);
  private ruta = inject(ActivatedRoute);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);

  readonly MODOS = MODOS;
  readonly columnasMapeo = ['campoPdf', 'variable', 'indice', 'obligatorio'];

  /** Definicion para la tabla estandar del proyecto (filtros, orden, export). */
  readonly columnasTabla: ColumnDefinition[] = [
    { name: 'campoPdf',    header: 'Campo del PDF',        type: 'custom', filterable: true,  sortable: true,  width: '32%' },
    { name: 'variable',    header: 'Dato que se escribe ahí', type: 'custom', filterable: true, sortable: true, width: '40%' },
    { name: 'indice',      header: 'Fila',                 type: 'custom', filterable: false, sortable: false, width: '12%', align: 'center' },
    { name: 'obligatorio', header: 'Obligatorio',          type: 'custom', filterable: false, sortable: false, width: '16%', align: 'center' },
  ];

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly plantilla = signal<Plantilla | null>(null);
  readonly versiones = signal<PlantillaVersion[]>([]);
  readonly diccionario = signal<CampoDiccionario[]>([]);
  readonly camposPdf = signal<CampoPdf[]>([]);
  readonly filas = signal<FilaMapeo[]>([]);
  readonly auditoria = signal<Auditoria[]>([]);
  readonly filtroCampos = signal('');
  /** Texto tecleado dentro del desplegable de variables (busqueda inteligente). */
  readonly filtroVariable = signal('');
  /** Pagina que se esta mirando en la vista del formato. */
  readonly paginaVista = signal(1);
  /**
   * Fila cuyo buscador esta abierto. Hace falta porque el input muestra la
   * ETIQUETA del dato elegido cuando esta en reposo y el TEXTO TECLEADO
   * mientras se busca; sin distinguirlo, escribir pisaria la etiqueta de todas
   * las filas a la vez.
   */
  readonly editando = signal<string | null>(null);

  /** Campo resaltado: se sincroniza entre la tabla y la vista del formato. */
  readonly resaltado = signal<string | null>(null);
  readonly urlVista = signal<string | null>(null);
  /** Texto exacto que caeria en cada campo, resuelto por el backend. */
  readonly valoresEjemplo = signal<Record<string, string>>({});
  readonly paginasFormato = signal(0);
  readonly soloSinMapear = signal(false);

  // ── Vista del formato: edición sobre la hoja ───────────────────────────────
  /**
   * `ver` solo mira; `mover` deja arrastrar y redimensionar lo que ya hay;
   * `dibujar` crea una casilla nueva arrastrando sobre un hueco del formato.
   */
  readonly modoVista = signal<'ver' | 'mover' | 'dibujar'>('ver');
  readonly seleccion = signal<FilaMapeo | null>(null);
  /** Rectángulo que se está dibujando, en píxeles de pantalla. */
  readonly dibujando = signal<{ x: number; y: number; ancho: number; alto: number } | null>(null);
  readonly origenes = signal<OrigenDato[]>([]);
  readonly filtroOrigen = signal('');
  readonly creandoConcepto = signal(false);
  readonly origenElegido = signal<OrigenDato | null>(null);
  readonly nuevoNombre = signal('');
  readonly nuevaClave = signal('');
  private arrastre: Arrastre | null = null;
  private inicioDibujo: { x: number; y: number } | null = null;

  /** El borrador sobre el que se trabaja. Publicado = no se toca. */
  readonly borrador = computed(() => this.versiones().find(v => v.estado === 'BORRADOR') ?? null);
  readonly publicada = computed(() => this.versiones().find(v => v.estado === 'PUBLICADA') ?? null);

  /** Que editor toca segun el modo del documento. */
  readonly modo = computed(() => this.plantilla()?.modo ?? 'PDF_FORM');
  readonly esOverlay = computed(() => this.modo() === 'OVERLAY');
  readonly esTexto = computed(() => this.modo() === 'HTML' || this.modo() === 'RICH');
  readonly esPdfForm = computed(() => this.modo() === 'PDF_FORM');
  readonly versionEditable = computed(() => !!this.borrador());
  readonly versionActiva = computed(() => this.borrador() ?? this.publicada() ?? this.versiones()[0] ?? null);

  readonly mapeados = computed(() => this.filas().filter(f => f.campoClave).length);
  readonly totalCampos = computed(() => this.filas().length);
  readonly porRevisar = computed(() => this.filas().filter(f => f.sugerido && f.campoClave).length);

  readonly filasVisibles = computed(() => {
    const f = this.filtroCampos().trim().toLowerCase();
    return this.filas().filter(x => {
      if (this.soloSinMapear() && x.campoClave) return false;
      if (!f) return true;
      return x.campoPdf.toLowerCase().includes(f);
    });
  });

  /**
   * Busqueda inteligente del desplegable: filtra por etiqueta, clave, origen y
   * ejemplo, sin tildes ni mayusculas. Con 133 variables y 172 campos, ir
   * desplazando la lista es inviable.
   */
  private sinTildes(t: string): string {
    return (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  readonly variablesFiltradas = computed(() => {
    const f = this.sinTildes(this.filtroVariable().trim());
    const todas = this.diccionario();
    if (!f) return todas;
    const partes = f.split(/\s+/);
    return todas.filter(c => {
      const heno = this.sinTildes(`${c.etiqueta} ${c.clave} ${c.origen} ${c.ejemplo ?? ''}`);
      return partes.every(p => heno.includes(p));
    });
  });

  /** Lo que se ve en el input: el texto que se busca, o la etiqueta ya elegida. */
  textoBuscador(f: FilaMapeo): string {
    if (this.editando() === f.id) return this.filtroVariable();
    return this.definicion(f.campoClave)?.etiqueta ?? '';
  }

  abrirBuscador(f: FilaMapeo): void {
    this.editando.set(f.id);
    this.filtroVariable.set('');
  }

  /**
   * Al salir vuelve a verse la etiqueta del dato elegido: de eso ya se encarga
   * `textoBuscador`, que solo enseña lo tecleado mientras el campo tiene el foco.
   *
   * OJO: aquí NO se limpia el filtro. Hacerlo rompía la elección con el ratón:
   * al pulsar una opción, el input pierde el foco ANTES del clic, el filtro se
   * vaciaba, la lista se rehacía con las 302 variables y el clic terminaba
   * cayendo en otra opción — o en ninguna. El filtro se limpia al abrir el
   * buscador de la siguiente casilla, que es cuando estorba.
   */
  cerrarBuscador(): void {
    this.editando.set(null);
  }

  elegirDelBuscador(f: FilaMapeo, clave: string | null): void {
    this.cambiarVariable(f, clave);
    this.cerrarBuscador();
  }

  /**
   * Lo que el autocompletado escribe en el input al elegir una opción.
   *
   * Sin esto Material mete el VALOR de la opción —la clave técnica, `bio.foto`—
   * y quien mira el campo no sabe si eso es lo que quería. Es propiedad y no
   * método para que no pierda el `this` al pasarla al componente.
   */
  readonly mostrarEtiqueta = (clave: string | null): string =>
    clave ? (this.diccionario().find(c => c.clave === clave)?.etiqueta ?? clave) : '';

  /** Ficha del dato elegido, para enseñar de que va sin abrir el desplegable. */
  definicion(clave: string | null) {
    return clave ? this.diccionario().find(c => c.clave === clave) ?? null : null;
  }

  /**
   * Las casillas de la página que se está mirando.
   *
   * En reposo solo las que ya tienen dato, que es lo que se quiere revisar. En
   * cuanto se entra a editar salen TODAS: si no, no habría forma de ver dónde
   * están las que faltan por asignar, que es justo lo que se viene a hacer.
   */
  readonly enVista = computed(() => {
    const editando = this.modoVista() !== 'ver';
    return this.filas().filter(f =>
      f.pagina === this.paginaVista() && (editando || f.campoClave || f.libre));
  });

  readonly sinAsignarEnVista = computed(() =>
    this.enVista().filter(f => !f.campoClave).length);

  /** Variables agrupadas por origen, para que el desplegable sea navegable. */
  readonly porOrigen = computed(() => {
    const g = new Map<string, CampoDiccionario[]>();
    for (const c of this.diccionario()) {
      if (!g.has(c.origen)) g.set(c.origen, []);
      g.get(c.origen)!.push(c);
    }
    return [...g.entries()].map(([origen, campos]) => ({ origen, campos }));
  });

  ngOnInit(): void {
    // Suscripcion, no snapshot: Angular REUTILIZA este componente cuando solo
    // cambia el :id de la ruta, asi que con snapshot se quedaria mostrando el
    // documento anterior. Se detecto navegando de un documento a otro.
    this.ruta.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = Number(params.get('id'));
      if (!id) { this.router.navigate(['/dashboard/plantillas-documentos']); return; }
      this.reiniciar();
      this.cargarTodo(id);
    });
  }

  /** Limpia el estado del documento anterior antes de cargar otro. */
  private reiniciar(): void {
    this.plantilla.set(null);
    this.versiones.set([]);
    this.camposPdf.set([]);
    this.filas.set([]);
    this.auditoria.set([]);
    this.filtroCampos.set('');
    this.soloSinMapear.set(false);
    this.modoVista.set('ver');
    this.seleccion.set(null);
    this.creandoConcepto.set(false);
    this.cargando.set(true);
  }

  private cargarTodo(id: number): void {
    this.cargando.set(true);
    this.srv.diccionario().subscribe({ next: d => this.diccionario.set(d) });
    this.srv.auditoria(id).subscribe({ next: a => this.auditoria.set(a) });

    this.srv.listar().subscribe({
      next: todas => {
        const p = todas.find(x => x.id === id) ?? null;
        this.plantilla.set(p);
        if (!p) { this.cargando.set(false); return; }
        this.cargarVersiones(id);
      },
      error: () => { this.cargando.set(false); this.error('No se pudo cargar el documento.'); },
    });
  }

  private cargarVersiones(id: number): void {
    this.srv.versiones(id).subscribe({
      next: vs => {
        this.versiones.set(vs);
        const b = vs.find(v => v.estado === 'BORRADOR') ?? vs[0];
        if (b) this.cargarCampos(b.id);
        else this.cargando.set(false);
      },
      error: () => { this.cargando.set(false); this.error('No se pudieron leer las versiones.'); },
    });
  }

  /** Carga los campos del PDF y el mapeo ya guardado, y los cruza. */
  /**
   * Fondo de la vista del formato. Se descarga con la sesion (un <img src> no
   * lleva el token) y se revoca el anterior al cambiar de pagina.
   */
  cargarVista(versionId: number, pagina: number): void {
    this.srv.imagenPagina(versionId, pagina).subscribe({
      next: blob => {
        const previa = this.urlVista();
        if (previa) URL.revokeObjectURL(previa);
        this.urlVista.set(URL.createObjectURL(blob));
      },
      error: () => this.urlVista.set(null),
    });
  }

  irAPaginaVista(n: number): void {
    const v = this.versionActiva();
    if (!v || n < 1 || n > this.paginasFormato()) return;
    this.paginaVista.set(n);
    this.cargarVista(v.id, n);
  }

  /**
   * Prellenado de ejemplo de un campo.
   *
   * Primero el valor que devuelve el backend, que sale del MISMO resolutor que
   * genera el documento: así la fecha se ve en dd/mm/aaaa y la casilla marcada
   * con su X, igual que en el papel. El ejemplo suelto del diccionario queda
   * solo de red de seguridad mientras llega la respuesta.
   */
  ejemploDe(f: FilaMapeo): string {
    const resuelto = this.valoresEjemplo()[f.campoPdf || f.placeholder || ''];
    if (resuelto !== undefined) return resuelto;
    const d = this.definicion(f.campoClave);
    if (!d) return '';
    return d.ejemplo ?? d.etiqueta;
  }

  private cargarValoresEjemplo(versionId: number): void {
    this.srv.valoresDeEjemplo(versionId).subscribe({
      next: v => this.valoresEjemplo.set(v),
      error: () => this.valoresEjemplo.set({}),
    });
  }

  private cargarCampos(versionId: number): void {
    this.srv.camposDelPdf(versionId).subscribe({
      next: campos => {
        this.camposPdf.set(campos);
        // Paginas del formato, para el navegador de la vista.
        this.srv.paginasDelFondo(versionId).subscribe({
          next: r => {
            this.paginasFormato.set(r.paginas);
            if (r.paginas > 0) { this.paginaVista.set(1); this.cargarVista(versionId, 1); }
            this.cargarValoresEjemplo(versionId);
          },
          error: () => this.paginasFormato.set(0),
        });
        this.srv.verMapeo(versionId).subscribe({
          next: guardado => { this.construirFilas(campos, guardado); this.cargando.set(false); },
          error: () => { this.construirFilas(campos, []); this.cargando.set(false); },
        });
      },
      error: () => {
        // Sin PDF base todavía: es un estado normal, no un error que asustar.
        this.camposPdf.set([]);
        this.filas.set([]);
        this.cargando.set(false);
      },
    });
  }

  private construirFilas(campos: CampoPdf[], guardado: PlantillaCampo[]): void {
    const porCampo = new Map(guardado.filter(g => g.campo_pdf).map(g => [g.campo_pdf!, g]));

    const delFormato: FilaMapeo[] = campos.map(c => {
      const g = porCampo.get(c.nombre);
      // Si alguien movió la casilla, manda la posición guardada; si no, la que
      // trae el propio PDF.
      const movido = g?.pos_x != null && g?.pos_y != null;
      return {
        id: `pdf:${c.nombre}`,
        campoPdf: c.nombre,
        placeholder: null,
        libre: false,
        tipoPdf: c.tipo,
        pagina: c.pagina,
        esperaImagen: c.espera_imagen,
        x: movido ? g!.pos_x! : c.x,
        y: movido ? g!.pos_y! : c.y,
        ancho: movido && g!.ancho != null ? g!.ancho! : c.ancho,
        alto: movido && g!.alto != null ? g!.alto! : c.alto,
        movido,
        fontSize: g?.font_size ?? null,
        campoClave: g?.campo_clave ?? null,
        indice: g?.indice ?? null,
        obligatorio: g?.obligatorio ?? false,
        sugerido: false,
        confianza: 0,
        crudo: g ?? null,
      };
    });

    // Las casillas dibujadas a mano no están en el PDF: solo viven en el mapeo.
    const libres: FilaMapeo[] = guardado
      .filter(g => !g.campo_pdf && g.placeholder && g.pos_x != null && g.pos_y != null)
      .map(g => ({
        id: `libre:${g.placeholder}`,
        campoPdf: '',
        placeholder: g.placeholder,
        libre: true,
        tipoPdf: 'TEXTO',
        pagina: g.pagina || 1,
        esperaImagen: false,
        x: g.pos_x!, y: g.pos_y!, ancho: g.ancho ?? 120, alto: g.alto ?? 12,
        movido: true,
        fontSize: g.font_size ?? null,
        campoClave: g.campo_clave ?? null,
        indice: g.indice ?? null,
        obligatorio: g.obligatorio ?? false,
        sugerido: false,
        confianza: 0,
        crudo: g,
      }));

    this.filas.set([...delFormato, ...libres]);
  }

  esLista(clave: string | null): boolean {
    if (!clave) return false;
    return this.diccionario().find(c => c.clave === clave)?.es_lista ?? false;
  }

  maxElementos(clave: string | null): number {
    if (!clave) return 0;
    return this.diccionario().find(c => c.clave === clave)?.max_elementos ?? 0;
  }

  // ── La hoja como editor: mover, redimensionar y dibujar ──────────────────

  /**
   * CONVERSIÓN DE ESCALAS. Hay tres y confundirlas es el fallo clásico aquí:
   *   1. Puntos PDF      — lo que se guarda y lo que entiende PDFBox.
   *   2. Píxeles imagen  — el PNG del backend, a 150 DPI.
   *   3. Píxeles pantalla— la imagen se muestra escalada para caber.
   * Por eso se mide `naturalWidth / offsetWidth` en CADA conversión y no se
   * guarda: cambia con el tamaño de la ventana.
   */
  private factor(img: HTMLImageElement): number {
    const escala = img.naturalWidth / img.offsetWidth;
    return escala > 0 ? (150 / 72) / escala : 1;
  }
  ptsAPx(v: number, img: HTMLImageElement): number { return v * this.factor(img); }
  private pxAPts(v: number, img: HTMLImageElement): number { return v / this.factor(img); }

  cambiarModoVista(modo: 'ver' | 'mover' | 'dibujar'): void {
    this.modoVista.set(modo);
    if (modo === 'ver') this.seleccion.set(null);
  }

  seleccionar(f: FilaMapeo): void {
    this.seleccion.set(f);
  }

  /** Puntos con un decimal: el panel de posición no necesita más. */
  red(v: number): number { return Math.round(v * 10) / 10; }

  /** Arrastre de una casilla, o de su esquina para redimensionarla. */
  empezarArrastre(ev: PointerEvent, f: FilaMapeo, accion: 'mover' | 'redimensionar',
                  img: HTMLImageElement): void {
    if (this.modoVista() !== 'mover' || !this.borrador()) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.seleccion.set(f);
    this.arrastre = {
      fila: f, accion,
      xInicial: ev.clientX, yInicial: ev.clientY,
      cajaInicial: { x: f.x, y: f.y, ancho: f.ancho, alto: f.alto },
    };

    const mover = (e: PointerEvent) => {
      const a = this.arrastre;
      if (!a) return;
      // Un clic para seleccionar mueve el ratón uno o dos píxeles. Sin este
      // umbral, pulsar una casilla la marcaba como "movida" y su posición se
      // guardaba aunque nadie la hubiera tocado.
      if (Math.abs(e.clientX - a.xInicial) < 3 && Math.abs(e.clientY - a.yInicial) < 3) return;
      const dx = this.pxAPts(e.clientX - a.xInicial, img);
      const dy = this.pxAPts(e.clientY - a.yInicial, img);
      const c = a.cajaInicial;
      const caja = a.accion === 'mover'
        ? { x: Math.max(0, c.x + dx), y: Math.max(0, c.y + dy), ancho: c.ancho, alto: c.alto }
        // Mínimos para que una casilla no se pueda dejar en un punto invisible.
        : { x: c.x, y: c.y, ancho: Math.max(8, c.ancho + dx), alto: Math.max(6, c.alto + dy) };
      this.aplicarCaja(a.fila, caja);
    };
    const soltar = () => {
      this.arrastre = null;
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  private aplicarCaja(fila: FilaMapeo, caja: { x: number; y: number; ancho: number; alto: number }): void {
    this.filas.update(fs => fs.map(f => f.id !== fila.id ? f : { ...f, ...caja, movido: true }));
    const sel = this.seleccion();
    if (sel?.id === fila.id) this.seleccion.set({ ...sel, ...caja, movido: true });
  }

  /** Ajuste fino desde el panel, para cuando el ratón no da la precisión. */
  cambiarCaja(fila: FilaMapeo, lado: 'x' | 'y' | 'ancho' | 'alto', valor: number): void {
    if (!Number.isFinite(valor)) return;
    const caja = { x: fila.x, y: fila.y, ancho: fila.ancho, alto: fila.alto, [lado]: Math.max(0, valor) };
    this.aplicarCaja(fila, caja as { x: number; y: number; ancho: number; alto: number });
  }

  devolverASuSitio(fila: FilaMapeo): void {
    const original = this.camposPdf().find(c => c.nombre === fila.campoPdf);
    if (!original) return;
    this.filas.update(fs => fs.map(f => f.id !== fila.id ? f
      : { ...f, x: original.x, y: original.y, ancho: original.ancho, alto: original.alto, movido: false }));
    this.seleccion.set(null);
  }

  // ── Dibujar una casilla donde el formato no trae ninguna ──────────────────

  empezarDibujo(ev: PointerEvent, img: HTMLImageElement): void {
    if (this.modoVista() !== 'dibujar' || !this.borrador()) return;
    ev.preventDefault();
    const caja = img.getBoundingClientRect();
    this.inicioDibujo = { x: ev.clientX - caja.left, y: ev.clientY - caja.top };
    this.dibujando.set({ x: this.inicioDibujo.x, y: this.inicioDibujo.y, ancho: 0, alto: 0 });

    const mover = (e: PointerEvent) => {
      const ini = this.inicioDibujo;
      if (!ini) return;
      const x = e.clientX - caja.left;
      const y = e.clientY - caja.top;
      this.dibujando.set({
        x: Math.min(ini.x, x), y: Math.min(ini.y, y),
        ancho: Math.abs(x - ini.x), alto: Math.abs(y - ini.y),
      });
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      const d = this.dibujando();
      this.dibujando.set(null);
      this.inicioDibujo = null;
      // Un clic suelto no es una casilla: sin este mínimo saldría un cuadro de
      // cero al primer despiste.
      if (!d || d.ancho < 6 || d.alto < 4) return;
      void this.crearCasilla({
        x: this.pxAPts(d.x, img), y: this.pxAPts(d.y, img),
        ancho: this.pxAPts(d.ancho, img), alto: this.pxAPts(d.alto, img),
      });
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  private async crearCasilla(caja: { x: number; y: number; ancho: number; alto: number }): Promise<void> {
    const r = await Swal.fire({
      title: 'Casilla nueva',
      text: 'Qué se escribe aquí. El nombre es solo para reconocerla en la lista.',
      input: 'text',
      inputPlaceholder: 'Por ejemplo: Observaciones del jefe',
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      inputValidator: v => (v && v.trim() ? null : 'Póngale un nombre'),
    });
    if (!r.isConfirmed) return;

    const nombre = String(r.value).trim();
    if (this.filas().some(f => f.placeholder === nombre)) {
      this.error('Ya hay una casilla con ese nombre en este documento.');
      return;
    }
    const fila: FilaMapeo = {
      id: `libre:${nombre}`,
      campoPdf: '', placeholder: nombre, libre: true,
      tipoPdf: 'TEXTO', pagina: this.paginaVista(), esperaImagen: false,
      x: caja.x, y: caja.y, ancho: caja.ancho, alto: caja.alto,
      movido: true, fontSize: 9,
      campoClave: null, indice: null, obligatorio: false, sugerido: false, confianza: 0,
      crudo: null,
    };
    this.filas.update(fs => [...fs, fila]);
    this.seleccion.set(fila);
    this.modoVista.set('mover');
  }

  async borrarCasilla(fila: FilaMapeo): Promise<void> {
    if (!fila.libre) return;
    const r = await Swal.fire({
      title: '¿Quitar esta casilla?',
      text: `«${fila.placeholder}» dejará de escribirse en el documento.`,
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Quitar', cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;
    this.filas.update(fs => fs.filter(f => f.id !== fila.id));
    this.seleccion.set(null);
  }

  cambiarFontSize(fila: FilaMapeo, valor: number): void {
    if (!Number.isFinite(valor)) return;
    const tam = Math.min(48, Math.max(4, valor));
    this.filas.update(fs => fs.map(f => f.id !== fila.id ? f : { ...f, fontSize: tam }));
    const sel = this.seleccion();
    if (sel?.id === fila.id) this.seleccion.set({ ...sel, fontSize: tam });
  }

  // ── Conceptos nuevos: de dónde sale un dato que no estaba ────────────────

  private cargarOrigenes(): void {
    this.srv.origenesDeDatos().subscribe({
      next: o => this.origenes.set(o),
      error: () => this.origenes.set([]),
    });
  }

  /** Orígenes filtrados, agrupados por bloque para poder navegarlos. */
  readonly origenesFiltrados = computed(() => {
    const f = this.sinTildes(this.filtroOrigen().trim());
    const partes = f ? f.split(/\s+/) : [];
    const lista = this.origenes().filter(o => {
      if (!partes.length) return true;
      const heno = this.sinTildes(`${o.etiqueta} ${o.ruta} ${o.bloque} ${o.columna}`);
      return partes.every(p => heno.includes(p));
    });
    const g = new Map<string, OrigenDato[]>();
    for (const o of lista) {
      if (!g.has(o.bloque)) g.set(o.bloque, []);
      g.get(o.bloque)!.push(o);
    }
    return [...g.entries()].map(([bloque, datos]) => ({ bloque, datos }));
  });

  abrirNuevoConcepto(): void {
    this.creandoConcepto.set(true);
    this.origenElegido.set(null);
    this.filtroOrigen.set('');
    this.nuevoNombre.set('');
    this.nuevaClave.set('');
    if (!this.origenes().length) this.cargarOrigenes();
  }

  cerrarNuevoConcepto(): void {
    this.creandoConcepto.set(false);
    this.origenElegido.set(null);
  }

  elegirOrigen(o: OrigenDato): void {
    this.origenElegido.set(o);
    if (!this.nuevoNombre()) this.nuevoNombre.set(o.etiqueta);
    // La clave se propone a partir de la ruta; se puede cambiar antes de crear.
    this.nuevaClave.set(o.ruta.replace('[]', '').toLowerCase().replace(/[^a-z0-9_.]/g, '_'));
  }

  /**
   * Da de alta el concepto y lo asigna a la casilla seleccionada.
   *
   * Crear un dato sin ponerlo en ningún sitio no le sirve a nadie: quien está
   * aquí viene de una casilla vacía.
   */
  crearConcepto(): void {
    const o = this.origenElegido();
    const nombre = this.nuevoNombre().trim();
    const clave = this.nuevaClave().trim();
    if (!o || !nombre || !clave) { this.error('Falta el origen, el nombre o la clave.'); return; }

    this.guardando.set(true);
    this.srv.crearConcepto({
      clave, etiqueta: nombre, ruta: o.ruta, tipo: o.tipo,
      ejemplo: `Ejemplo de ${nombre.toLowerCase()}`,
    }).subscribe({
      next: d => {
        this.guardando.set(false);
        this.diccionario.update(ds => [...ds, d].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta)));
        this.origenes.update(os => os.map(x => x.ruta === o.ruta ? { ...x, ya_tiene_variable: true } : x));
        const sel = this.seleccion();
        if (sel) this.cambiarVariable(sel, d.clave);
        this.cerrarNuevoConcepto();
        this.snack.open(`«${d.etiqueta}» creado y asignado.`, 'Cerrar', { duration: 4000 });
      },
      error: e => {
        this.guardando.set(false);
        Swal.fire('No se pudo crear', e?.error?.message ?? 'Revise la clave y el origen.', 'error');
      },
    });
  }

  // ── Acciones ──────────────────────────────────────────────────────────────

  subirPdf(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo || !this.plantilla()) return;
    if (archivo.type !== 'application/pdf') {
      this.error('El archivo debe ser un PDF.');
      input.value = '';
      return;
    }

    this.guardando.set(true);
    this.srv.subirPdfBase(this.plantilla()!.id, archivo).subscribe({
      next: r => {
        this.guardando.set(false);
        input.value = '';
        if (r.aviso) {
          // Un PDF sin campos no es un fallo: es un formato plano.
          Swal.fire('PDF cargado', r.aviso, 'info');
        } else {
          this.snack.open(`${r.total_campos} campos encontrados.`, 'Cerrar', { duration: 4000 });
        }
        this.cargarVersiones(this.plantilla()!.id);
      },
      error: e => {
        this.guardando.set(false);
        input.value = '';
        Swal.fire('No se pudo subir', e?.error?.message ?? 'Revise el archivo.', 'error');
      },
    });
  }

  /**
   * Trae las propuestas y las aplica SOLO donde no hay nada decidido.
   * Pisar lo que alguien ya mapeó a mano sería perder trabajo suyo.
   */
  proponer(): void {
    const b = this.borrador();
    if (!b) { this.error('Hace falta un borrador abierto.'); return; }

    this.guardando.set(true);
    this.srv.sugerencias(b.id).subscribe({
      next: r => {
        this.guardando.set(false);
        const porCampo = new Map<string, Sugerencia>(r.sugerencias.map(s => [s.campo_pdf, s]));
        let aplicadas = 0;
        this.filas.update(fs => fs.map(f => {
          if (f.campoClave) return f;                 // respeta lo ya decidido
          const s = porCampo.get(f.campoPdf);
          if (!s?.campo_clave) return f;
          aplicadas++;
          return { ...f, campoClave: s.campo_clave, sugerido: true, confianza: s.confianza };
        }));
        Swal.fire({
          icon: 'info',
          title: `${aplicadas} propuestas aplicadas`,
          html: `De ${r.total_campos} campos, se propuso variable para ${r.con_sugerencia}.` +
                `<br><br><b>Revíselas antes de guardar.</b> Las marcadas en ámbar son propuestas ` +
                `automáticas: nada se ha guardado todavía.`,
        });
      },
      error: () => { this.guardando.set(false); this.error('No se pudieron obtener las propuestas.'); },
    });
  }

  /**
   * OJO: se compara por `id`, no por referencia. El panel de la vista del
   * formato trabaja con una COPIA de la fila, así que `f !== fila` no casaría
   * nunca y el cambio se perdería en silencio.
   */
  cambiarVariable(fila: FilaMapeo, clave: string | null): void {
    const cambio = (f: FilaMapeo): FilaMapeo => ({
      ...f,
      campoClave: clave,
      // Elegida a mano deja de ser propuesta, y si no es lista el índice sobra.
      sugerido: false,
      indice: this.esLista(clave) ? (f.indice ?? 0) : null,
    });
    this.filas.update(fs => fs.map(f => f.id !== fila.id ? f : cambio(f)));
    const sel = this.seleccion();
    if (sel?.id === fila.id) this.seleccion.set(cambio(sel));
  }

  cambiarIndice(fila: FilaMapeo, indice: number): void {
    this.filas.update(fs => fs.map(f => f.id !== fila.id ? f : { ...f, indice }));
    const sel = this.seleccion();
    if (sel?.id === fila.id) this.seleccion.set({ ...sel, indice });
  }

  alternarObligatorio(fila: FilaMapeo, valor: boolean): void {
    this.filas.update(fs => fs.map(f => f.id !== fila.id ? f : { ...f, obligatorio: valor }));
    const sel = this.seleccion();
    if (sel?.id === fila.id) this.seleccion.set({ ...sel, obligatorio: valor });
  }

  guardar(): void {
    const b = this.borrador();
    if (!b) { this.error('Hace falta un borrador abierto.'); return; }

    // Se guarda lo que tiene dato y, además, toda casilla dibujada a mano o
    // recolocada: si no, al recargar volverían a su sitio original y el trabajo
    // de colocarlas se habría perdido sin decir nada.
    const filas = this.filas()
      .filter(f => f.campoClave || f.libre || f.movido)
      .map((f, i) => {
        // Se PARTE de la fila guardada y solo se pisa lo que se edita aquí.
        // Armarla desde cero perdía en silencio todo lo que esta pantalla no
        // toca — condiciones de casilla, formato, tipografía —, y así se
        // borraron las ocho casillas excluyentes de la Ficha Técnica.
        const c = f.crudo;
        const base: FilaMapeoGuardar = {
          campo_pdf: f.libre ? null : f.campoPdf,
          placeholder: f.libre ? f.placeholder : null,
          campo_clave: f.campoClave,
          indice: f.indice,
          obligatorio: f.obligatorio,
          valor_condicion: c?.valor_condicion ?? null,
          // Sin tipo explícito lo hereda del diccionario, que es lo que hace
          // que las fechas salgan en dd/mm/aaaa.
          tipo_render: f.esperaImagen ? 'IMAGEN' : (c?.tipo_render ?? null),
          formato: c?.formato ?? null,
          text_align: c?.text_align ?? null,
          pagina: f.pagina || 1,
          orden: i,
        };
        // La posición SOLO viaja si se tocó. Mandarla siempre obligaría al motor
        // a recolocar las 243 casillas para dejarlas donde ya estaban.
        if (f.movido || f.libre) {
          base.pos_x = f.x;
          base.pos_y = f.y;
          base.ancho = f.ancho;
          base.alto = f.alto;
          if (f.fontSize) base.font_size = f.fontSize;
        }
        return base;
      });

    this.guardando.set(true);
    this.srv.guardarMapeo(b.id, filas).subscribe({
      next: r => {
        this.guardando.set(false);
        this.filas.update(fs => fs.map(f => ({ ...f, sugerido: false })));
        this.snack.open(`${r.campos_guardados} campos guardados.`, 'Cerrar', { duration: 4000 });
      },
      error: e => {
        this.guardando.set(false);
        Swal.fire('No se pudo guardar',
          e?.error?.message ?? 'Alguna variable puede no estar habilitada.', 'error');
      },
    });
  }

  async publicar(): Promise<void> {
    const b = this.borrador();
    if (!b) { this.error('No hay borrador que publicar.'); return; }

    const sinRevisar = this.filas().filter(f => f.sugerido && f.campoClave).length;
    const r = await Swal.fire({
      title: '¿Publicar esta versión?',
      html:
        `Quedará fija y no se podrá modificar: para cambiarla se abre una versión nueva.` +
        (sinRevisar ? `<br><br><b>Ojo:</b> hay ${sinRevisar} propuestas automáticas sin guardar ni revisar.` : '') +
        `<br><br>Publicar <u>no</u> cambia nada todavía: el documento seguirá saliendo por el sistema ` +
        `anterior hasta que corte el motor en el catálogo.`,
      icon: sinRevisar ? 'warning' : 'question',
      input: 'text',
      inputPlaceholder: 'Qué cambió (opcional)',
      showCancelButton: true,
      confirmButtonText: 'Publicar',
      cancelButtonText: 'Cancelar',
    });
    if (!r.isConfirmed) return;

    this.srv.publicar(b.id, r.value || undefined).subscribe({
      next: () => {
        this.snack.open('Versión publicada.', 'Cerrar', { duration: 4000 });
        this.cargarVersiones(this.plantilla()!.id);
        this.srv.auditoria(this.plantilla()!.id).subscribe({ next: a => this.auditoria.set(a) });
      },
      error: e => Swal.fire('No se pudo publicar',
        e?.error?.message ?? 'Revise que las variables usadas sigan habilitadas.', 'error'),
    });
  }

  nuevoBorrador(): void {
    const p = this.plantilla();
    if (!p) return;
    this.srv.abrirBorrador(p.id).subscribe({
      next: () => { this.snack.open('Borrador abierto.', 'Cerrar', { duration: 3000 }); this.cargarVersiones(p.id); },
      error: () => this.error('No se pudo abrir el borrador.'),
    });
  }

  volver(): void { this.router.navigate(['/dashboard/plantillas-documentos']); }

  private error(msg: string): void {
    this.snack.open(msg, 'Cerrar', { duration: 6000 });
  }

  describirDiff(a: Auditoria): string {
    if (!a.diff) return '';
    return Object.entries(a.diff)
      .map(([campo, [antes, despues]]) => `${campo}: ${antes ?? '—'} → ${despues ?? '—'}`)
      .join(' · ');
  }
}
