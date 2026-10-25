import {
  Component, ElementRef, HostListener, Inject, OnDestroy, OnInit, ViewChild, computed, inject, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subject, Subscription, debounceTime, switchMap, of, catchError } from 'rxjs';

import {
  CampoDisponible, CampoDto, CampoRequest, FuentePersonalizada, MuestraProceso, PaginaPlantilla,
  PlantillaDetalle, PlantillaRequest, TamanoPagina, TextAlign, TipoRender, ValorCampo,
  TAMANOS_PAGINA, FUENTES_ESTANDAR,
} from '../../../models/plantilla-eps.models';
import { PlantillaEpsService } from '../../../services/plantilla-eps.service';
import { OcrService } from '../../../../document-management/service/scanner/ocr.service';

/**
 * Rótulos impresos que el análisis reconoce en un formulario escaneado y el dato que va en su
 * casilla. Se comparan sin tildes ni mayúsculas, línea por línea del OCR; en cada hoja se usa
 * la PRIMERA aparición (la sección del cotizante va antes que cónyuge o beneficiarios).
 */
const PR = String.raw`pr[il1r]*[mn]+[aeo]r`, AP = String.raw`ap[ae]l+[il1]?d[oa]`;
const NO = String.raw`[nh]omb?r[aeo]`, SE = String.raw`s[eo]gund[oa]`;
/**
 * {@code bloque}: 'id' = datos de identidad, solo se aceptan cerca del "Primer apellido" del
 * cotizante (de 8 mm arriba a 30 mm abajo); 'comp' = datos complementarios (hasta 75 mm abajo).
 * Si el OCR no los ve en esa zona no se colocan: mejor un hueco que el dato en la sección de
 * cónyuge o beneficiarios. Las expresiones toleran las confusiones típicas del OCR
 * ("prirmar apallido", "nombra", "calular", "cooreo").
 */
const ROTULOS: { re: RegExp; nombre: string; bloque?: 'id' | 'comp'; dato: Partial<CampoDto> }[] = [
  { re: new RegExp(`${PR}\\s*${AP}`), nombre: 'Primer apellido', bloque: 'id', dato: { placeholder: 'Primer_Apellido', fuente: 'CONTRATACION', campoFuente: 'primer_apellido' } },
  { re: new RegExp(`${SE}\\s*${AP}`), nombre: 'Segundo apellido', bloque: 'id', dato: { placeholder: 'Segundo_Apellido', fuente: 'CONTRATACION', campoFuente: 'segundo_apellido' } },
  { re: new RegExp(`${PR}\\s*${NO}`), nombre: 'Primer nombre', bloque: 'id', dato: { placeholder: 'Primer_Nombre', fuente: 'CONTRATACION', campoFuente: 'primer_nombre' } },
  { re: new RegExp(`${SE}\\s*${NO}`), nombre: 'Segundo nombre', bloque: 'id', dato: { placeholder: 'Segundo_Nombre', fuente: 'CONTRATACION', campoFuente: 'segundo_nombre' } },
  { re: /([nm]u?m[eo]ro|no\.?|n\s*[*°º.])\s*(del?\s*)?(d[oa]cument|identificac)|cedula/, nombre: 'Número de documento', bloque: 'id', dato: { placeholder: 'Cedula', fuente: 'CONTRATACION', campoFuente: 'cedula' } },
  { re: /t[il1]po\s*(de\s*)?d[oa]cument/, nombre: 'Tipo de documento', bloque: 'id', dato: { placeholder: 'Tipo_Documento', fuente: 'CONTRATACION', campoFuente: 'tipo_documento', textAlign: 'CENTER' } },
  { re: /fecha\s*(de\s*)?nac[il1]m/, nombre: 'Fecha de nacimiento', bloque: 'id', dato: { placeholder: 'Fecha_Nacimiento', fuente: 'CONTRATACION', campoFuente: 'fecha_nacimiento', tipoRender: 'FECHA' } },
  { re: /n[ao]c[il1]?[oa]n[ae][lt][il1]?dad/, nombre: 'Nacionalidad', bloque: 'id', dato: { placeholder: 'Nacionalidad', fuente: 'CONTRATACION', campoFuente: 'nacionalidad' } },
  { re: /departamento.*nac[il1]m|nac[il1]m.*departamento/, nombre: 'Departamento de nacimiento', bloque: 'id', dato: { placeholder: 'Departamento_Nacimiento', fuente: 'CONTRATACION', campoFuente: 'departamento_nacimiento' } },
  { re: /municipio.*nac[il1]m|nac[il1]m.*municipio/, nombre: 'Municipio de nacimiento', bloque: 'id', dato: { placeholder: 'Municipio_Nacimiento', fuente: 'CONTRATACION', campoFuente: 'municipio_nacimiento' } },
  { re: /departamento.*residencia|residencia.*departamento/, nombre: 'Departamento de residencia', bloque: 'comp', dato: { placeholder: 'Departamento_Residencia', fuente: 'CONTRATACION', campoFuente: 'departamento' } },
  { re: /(municipio|ciudad).*residencia|residencia.*(municipio|ciudad)/, nombre: 'Municipio de residencia', bloque: 'comp', dato: { placeholder: 'Municipio_Residencia', fuente: 'CONTRATACION', campoFuente: 'municipio' } },
  { re: /d[il1]recc[il1]on/, nombre: 'Dirección', bloque: 'comp', dato: { placeholder: 'Direccion', fuente: 'CONTRATACION', campoFuente: 'direccion' } },
  { re: /c[ae]l+ular|movil/, nombre: 'Celular', bloque: 'comp', dato: { placeholder: 'Numero_Movil', fuente: 'CONTRATACION', campoFuente: 'celular' } },
  { re: /co+r+e+o|e-?mail/, nombre: 'Correo', bloque: 'comp', dato: { placeholder: 'Correo', fuente: 'CONTRATACION', campoFuente: 'correo' } },
  { re: /administradora\s*de\s*pensiones|fondo\s*de\s*pensiones|\bafp\b/, nombre: 'AFP', bloque: 'comp', dato: { placeholder: 'AFP', fuente: 'CONTRATACION', campoFuente: 'afp' } },
  { re: /ingreso\s*base|salario|\bibc\b/, nombre: 'Salario / IBC', bloque: 'comp', dato: { placeholder: 'Salario', fuente: 'CONTRATACION', campoFuente: 'salario', tipoRender: 'NUMERO' } },
  { re: /fecha\s*(de\s*)?(ingreso|inicio|vinculac|novedad)/, nombre: 'Fecha de ingreso', dato: { placeholder: 'Fecha_Ingreso', fuente: 'CONTRATACION', campoFuente: 'fecha_ingreso', tipoRender: 'FECHA' } },
  { re: /firma\s*del?\s*(afiliado|cotizante|trabajador)|firma\s*de\s*cotizante|el\s*cotizante,?\s*cabeza\s*de\s*familia/, nombre: 'Firma', dato: { placeholder: 'Firma', fuente: 'BIOMETRIA', campoFuente: 'firma', tipoRender: 'FIRMA', textAlign: 'CENTER' } },
];

/** Tamaño de hoja por proporción ancho/alto de la imagen (A4 0,707 · Carta 0,773 · Oficio 0,654). */
function tamanoPorProporcion(r: number): TamanoPagina {
  const opciones: [TamanoPagina, number][] = [['A4', 210 / 297], ['CARTA', 215.9 / 279.4], ['OFICIO', 215.9 / 330.2]];
  return opciones.reduce((a, b) => Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a)[0];
}

/** Ancho en px con que se guardan las hojas: ~190 ppp en A4, de sobra para leer y para imprimir. */
const ANCHO_HOJA_PX = 1600;

export interface PlantillaEditorData {
  detalle: PlantillaDetalle | null;
  camposDisponibles: CampoDisponible[];
}

const DIMENSIONES: Record<TamanoPagina, { w: number; h: number }> = {
  CARTA:  { w: 215.9, h: 279.4 },
  OFICIO: { w: 215.9, h: 330.2 },
  A4:     { w: 210,   h: 297   },
};
/** 1 pt = 0,3528 mm: el PDF mide la letra en puntos y el editor en mm. */
const PT_MM = 25.4 / 72;
/** La firma del PDF crece hacia arriba hasta 12 mm aunque el campo mida una línea. */
const ALTO_MIN_FIRMA = 12;
const SNAP_MM = 0.8;
/** Margen interior izquierda/derecha del texto (PdfCanvasService.PAD). */
const PAD_MM = 0.4;

/** Una pieza de lo que pinta el PDF: texto con su línea base o imagen. */
type Dibujo =
  | { tipo: 'txt'; uid: number; x: number; y: number; ancla: 'start' | 'middle' | 'end'; texto: string;
      size: number; fam: string; peso: number; estilo: string; color: string }
  | { tipo: 'img'; uid: number; src: string; x: number; y: number; w: number; h: number; ajuste: string };

type Modo = 'move' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
type PanelIzq = 'campos' | 'capas' | 'paginas' | 'fuentes';

/** Una entrada de la paleta: qué campo crea al soltarla en el formulario. */
interface ItemPaleta {
  clave: string;
  etiqueta: string;
  ejemplo?: string;
  icono: string;
  grupo: string;
  crear: () => Partial<CampoDto>;
  /** Campos hermanos que se crean a la derecha (fecha en 3 partes). */
  extra?: (Partial<CampoDto> & { dx: number })[];
}

interface Guia { eje: 'x' | 'y'; mm: number; }

/**
 * Editor de plantillas EPS a pantalla completa.
 *
 * El formulario escaneado ocupa el centro y cada dato es una caja en milímetros (la misma
 * geometría que dibuja el PDF). La vista previa no imita el formato: pide a ms-hr el valor
 * que pintaría cada campo —fechas, miles, X de las casillas, la firma y la huella que el
 * trabajador registró— con los campos tal como están en pantalla, sin guardar.
 */
@Component({
  selector: 'app-plantilla-editor',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule,
    MatSelectModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule, MatMenuModule,
    MatProgressBarModule, MatSnackBarModule,
  ],
  templateUrl: './plantilla-editor.component.html',
  styleUrls: ['./plantilla-editor.component.css'],
})
export class PlantillaEditorComponent implements OnInit, OnDestroy {
  @ViewChild('lienzo') lienzoRef?: ElementRef<HTMLDivElement>;

  private svc = inject(PlantillaEpsService);
  private ocr = inject(OcrService);
  private snack = inject(MatSnackBar);

  readonly tamanos = TAMANOS_PAGINA;
  readonly fuentesEstandar = FUENTES_ESTANDAR;

  // ── Plantilla ──────────────────────────────────────────────────────────────
  plantillaId: number | null;
  meta = {
    nombrePlantilla: '', epsKey: '', epsNombre: '', temporalKey: null as string | null,
    sexo: null as 'M' | 'F' | null, activa: true, notas: '' as string | null,
    googleDocId: null as string | null, htmlContenido: null as string | null,
  };
  version = 1;

  campos: CampoDto[] = [];
  paginas: PaginaPlantilla[] = [];
  fondos = new Map<number, string>();
  paginasSucias = false;
  sucio = signal(false);
  guardando = signal(false);
  cargandoPaginas = signal(true);

  // ── Vista ──────────────────────────────────────────────────────────────────
  paginaActual = signal(1);
  panelIzq = signal<PanelIzq>('campos');
  panelMeta = signal(false);
  escala = signal(3);            // px por mm
  ajuste: 'ancho' | 'pagina' | null = 'ancho';
  filtroPaleta = '';
  mostrarEtiquetas = true;

  // ── Selección / arrastre ───────────────────────────────────────────────────
  seleccion = signal<Set<number>>(new Set());
  guias: Guia[] = [];
  private arrastre: {
    modo: Modo; x0: number; y0: number;
    orig: Map<number, { x: number; y: number; w: number; h: number }>;
    movido: boolean;
  } | null = null;
  private nextUid = 0;

  // ── Deshacer ───────────────────────────────────────────────────────────────
  private pila: string[] = [];
  private rehacerPila: string[] = [];
  private ultimoCommit = 0;

  // ── Vista previa ───────────────────────────────────────────────────────────
  previa = signal(false);
  muestras = signal<MuestraProceso[]>([]);
  muestra = signal<MuestraProceso | null>(null);   // null = datos de ejemplo
  busqueda = '';
  resultadosBusqueda = signal<MuestraProceso[]>([]);
  valores = new Map<number, ValorCampo>();          // uid → valor
  personaPrevia = signal('');
  avisosPrevia = signal<string[]>([]);
  cargandoPrevia = signal(false);
  private pedirPrevia$ = new Subject<void>();
  private buscar$ = new Subject<string>();
  private subs: Subscription[] = [];

  // ── Fuentes ────────────────────────────────────────────────────────────────
  fuentes: FuentePersonalizada[] = [];
  private fuentesCargadas = new Set<number>();
  nuevaFuente = { nombre: '', cssFamilia: '', archivoB64: null as string | null };

  private resizeObs?: ResizeObserver;
  private medidor = document.createElement('canvas').getContext('2d');

  constructor(
    private ref: MatDialogRef<PlantillaEditorComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: PlantillaEditorData,
  ) {
    const d = data.detalle;
    this.plantillaId = d?.id ?? null;
    if (d) {
      this.meta = {
        nombrePlantilla: d.nombrePlantilla, epsKey: d.epsKey, epsNombre: d.epsNombre,
        temporalKey: d.temporalKey, sexo: d.sexo, activa: d.activa, notas: d.notas,
        googleDocId: d.googleDocId, htmlContenido: d.htmlContenido,
      };
      this.version = d.version;
      this.campos = (d.campos ?? []).map(c => ({ ...c, _uid: ++this.nextUid }));
    } else {
      this.panelMeta.set(true);
    }
    ref.disableClose = true;
    ref.backdropClick().subscribe(() => this.cerrar());
  }

  ngOnInit() {
    this.cargarPaginas();
    this.cargarFuentes();
    if (this.plantillaId) {
      this.svc.muestras(this.plantillaId).subscribe({ next: m => this.muestras.set(m), error: () => {} });
    }
    // Los datos se pintan siempre (de ejemplo o del contrato elegido): el editor muestra lo
    // que sale en el PDF, no solo cajas vacías.
    setTimeout(() => this.pedirPrevia$.next());
    this.subs.push(this.pedirPrevia$.pipe(
      debounceTime(350),
      switchMap(() => {
        if (!this.plantillaId) return of(null);
        this.cargandoPrevia.set(true);
        return this.svc.valores(this.plantillaId, this.muestra()?.procesoId ?? null, this.camposRequest())
          .pipe(catchError(() => { this.snack.open('No se pudo calcular la vista previa', '', { duration: 3000 }); return of(null); }));
      }),
    ).subscribe(r => {
      this.cargandoPrevia.set(false);
      if (!r) return;
      this.valores.clear();
      r.valores.forEach(v => { const c = this.campos[v.indice]; if (c?._uid) this.valores.set(c._uid, v); });
      this.personaPrevia.set(r.persona);
      this.avisosPrevia.set(r.avisos);
    }));
    this.subs.push(this.buscar$.pipe(
      debounceTime(400),
      switchMap(q => q.trim().length < 3 ? of([]) : this.svc.buscarProceso(q).pipe(catchError(() => of([])))),
    ).subscribe(r => this.resultadosBusqueda.set(r)));
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.resizeObs?.disconnect();
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Páginas
  // ═════════════════════════════════════════════════════════════════════════

  private cargarPaginas() {
    if (!this.plantillaId) {
      this.paginas = [{ numero: 1, tamano: 'A4', tieneImagen: false }];
      this.cargandoPaginas.set(false);
      setTimeout(() => this.observarLienzo());
      return;
    }
    this.svc.listarPaginas(this.plantillaId).subscribe({
      next: ps => {
        this.paginas = ps.length ? ps : [{ numero: 1, tamano: 'A4', tieneImagen: false }];
        this.paginaActual.set(this.paginas[0].numero);
        this.cargandoPaginas.set(false);
        this.paginas.filter(p => p.tieneImagen).forEach(p =>
          this.svc.obtenerFondoPagina(this.plantillaId!, p.numero).subscribe({
            next: uri => this.fondos.set(p.numero, uri), error: () => {},
          }));
        setTimeout(() => this.observarLienzo());
      },
      error: () => {
        this.paginas = [{ numero: 1, tamano: 'A4', tieneImagen: false }];
        this.cargandoPaginas.set(false);
        setTimeout(() => this.observarLienzo());
      },
    });
  }

  get pagina(): PaginaPlantilla | undefined {
    return this.paginas.find(p => p.numero === this.paginaActual());
  }
  get dim() { return DIMENSIONES[this.pagina?.tamano ?? 'A4']; }

  irAPagina(n: number) {
    this.paginaActual.set(n);
    this.seleccion.set(new Set());
  }

  agregarPagina() {
    const n = this.paginas.reduce((m, p) => Math.max(m, p.numero), 0) + 1;
    this.paginas.push({ numero: n, tamano: this.pagina?.tamano ?? 'A4', tieneImagen: false });
    this.paginasSucias = true; this.marcarSucio();
    this.irAPagina(n);
  }

  eliminarPagina(n: number) {
    if (this.paginas.length <= 1) { this.snack.open('Debe quedar al menos una página', '', { duration: 2500 }); return; }
    const enEsa = this.campos.filter(c => c.pagina === n).length;
    if (!confirm(`¿Eliminar la página ${n}${enEsa ? ` y sus ${enEsa} campos` : ''}?`)) return;
    this.commit();
    this.campos = this.campos.filter(c => c.pagina !== n);
    this.paginas = this.paginas.filter(p => p.numero !== n);
    const nuevos = new Map<number, string>();
    this.paginas.forEach((p, i) => {
      const fondo = this.fondos.get(p.numero);
      this.campos.filter(c => c.pagina === p.numero).forEach(c => c.pagina = i + 1);
      p.numero = i + 1;
      if (fondo) nuevos.set(i + 1, fondo);
    });
    this.fondos = nuevos;
    this.paginasSucias = true; this.marcarSucio();
    this.irAPagina(1);
  }

  cambiarTamano(t: TamanoPagina) {
    if (!this.pagina) return;
    this.pagina.tamano = t;
    this.paginasSucias = true; this.marcarSucio();
    setTimeout(() => this.reajustar());
  }

  subirFondo(ev: Event, n: number) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      this.snack.open('Sube el formulario como imagen (JPG o PNG); un PDF conviértelo primero a imagen', 'Cerrar', { duration: 6000 });
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      this.fondos.set(n, r.result as string);
      const p = this.paginas.find(x => x.numero === n);
      if (p) p.tieneImagen = true;
      this.paginasSucias = true; this.marcarSucio();
    };
    r.readAsDataURL(f);
  }

  quitarFondo(n: number) {
    this.fondos.delete(n);
    const p = this.paginas.find(x => x.numero === n);
    if (p) p.tieneImagen = false;
    this.paginasSucias = true; this.marcarSucio();
  }

  camposEnPagina(n: number) { return this.campos.filter(c => c.pagina === n).length; }

  // ── Hojas desde archivos: varias fotos o PDF de una o varias páginas ──────

  /** Mensaje de la tarea en curso (convertir PDF, leer el formulario); null = nada. */
  procesando = signal<string | null>(null);
  analizarAlSubir = true;

  /**
   * Cada foto y cada página de cada PDF se vuelve una hoja nueva, en el orden en que se
   * eligieron. Si la plantilla está vacía, la primera ocupa la hoja 1. Después, si está
   * activado, se lee cada hoja y se colocan los datos que se reconozcan.
   */
  async agregarHojasDesdeArchivos(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files ?? []);
    input.value = '';
    if (!archivos.length) return;
    const imagenes: string[] = [];
    try {
      for (const f of archivos) {
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          this.procesando.set(`Convirtiendo ${f.name}…`);
          imagenes.push(...await this.pdfAImagenes(f));
        } else if (f.type.startsWith('image/')) {
          this.procesando.set(`Preparando ${f.name}…`);
          imagenes.push(await this.imagenNormalizada(f));
        }
      }
    } catch (e) {
      console.error('[plantilla-editor] no se pudo leer el archivo', e);
      this.snack.open('No se pudo leer uno de los archivos (¿PDF protegido o dañado?)', 'Cerrar', { duration: 5000 });
    }
    if (!imagenes.length) {
      this.procesando.set(null);
      this.snack.open('No llegó ninguna imagen ni PDF', 'Cerrar', { duration: 3000 });
      return;
    }

    this.commit();
    const nuevas: number[] = [];
    for (const uri of imagenes) {
      const vacia = this.paginas.length === 1 && !this.fondos.size && !this.campos.length;
      let pag: PaginaPlantilla;
      if (!nuevas.length && vacia) pag = this.paginas[0];
      else {
        pag = { numero: this.paginas.reduce((m, p) => Math.max(m, p.numero), 0) + 1, tamano: 'A4', tieneImagen: false };
        this.paginas.push(pag);
      }
      const d = await this.medidasImagen(uri);
      pag.tamano = tamanoPorProporcion(d.w / d.h);
      pag.tieneImagen = true;
      this.fondos.set(pag.numero, uri);
      nuevas.push(pag.numero);
    }
    this.paginasSucias = true;
    this.marcarSucio(false);
    this.irAPagina(nuevas[0]);
    setTimeout(() => this.reajustar());

    let colocados = 0;
    if (this.analizarAlSubir) {
      for (const n of nuevas) colocados += await this.analizarHoja(n, true);
    }
    this.procesando.set(null);
    this.snack.open(`${nuevas.length} hoja(s) agregada(s)` + (this.analizarAlSubir ? ` · ${colocados} dato(s) colocado(s): revísalos y guarda` : ''),
      'Cerrar', { duration: 6000 });
  }

  /** Cada página del PDF como JPEG de ANCHO_HOJA_PX (mismo patrón de pdfjs que hiring-questions). */
  private async pdfAImagenes(f: File): Promise<string[]> {
    const pdfjs = await import('pdfjs-dist');
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(
        // Ruta relativa: el bundler de workers no resuelve especificadores de paquete.
        new URL('../../../../../../../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
        { type: 'module' },
      );
    }
    const tarea = pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) });
    const out: string[] = [];
    try {
      const pdf = await tarea.promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        this.procesando.set(`Convirtiendo ${f.name}: página ${i} de ${pdf.numPages}…`);
        const pagina = await pdf.getPage(i);
        const ancho = pagina.getViewport({ scale: 1 }).width;
        const viewport = pagina.getViewport({ scale: ANCHO_HOJA_PX / ancho });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        if (ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        await pagina.render({ canvas, viewport }).promise;
        out.push(canvas.toDataURL('image/jpeg', 0.88));
      }
    } finally {
      void tarea.destroy();
    }
    return out;
  }

  /** Foto a JPEG de ANCHO_HOJA_PX de ancho sobre fondo blanco (una foto de celular pesa 10 veces más). */
  private imagenNormalizada(f: File): Promise<string> {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        const escala = ANCHO_HOJA_PX / img.naturalWidth;
        const cv = document.createElement('canvas');
        cv.width = ANCHO_HOJA_PX;
        cv.height = Math.round(img.naturalHeight * escala);
        const ctx = cv.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); rej(new Error('sin canvas')); return; }
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        res(cv.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('imagen ilegible')); };
      img.src = url;
    });
  }

  /** La misma imagen ampliada (para el OCR); devuelve PNG. */
  private ampliada(uri: string, factor: number): Promise<string> {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth * factor; cv.height = img.naturalHeight * factor;
        const ctx = cv.getContext('2d');
        if (!ctx) { res(uri); return; }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        res(cv.toDataURL('image/png'));
      };
      img.onerror = () => res(uri);
      img.src = uri;
    });
  }

  private medidasImagen(uri: string): Promise<{ w: number; h: number }> {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res({ w: 210, h: 297 });
      img.src = uri;
    });
  }

  /**
   * Lee el formulario de la hoja con OCR, reconoce los rótulos impresos (ROTULOS) y pone cada
   * dato en la casilla que le corresponde. No toca los campos que ya hay: si la hoja ya tiene
   * ese dato, lo salta. Devuelve cuántos colocó; quedan seleccionados para revisarlos.
   */
  async analizarHoja(n = this.paginaActual(), silencioso = false): Promise<number> {
    const uri = this.fondos.get(n);
    if (!uri) { if (!silencioso) this.snack.open('Esta hoja no tiene formulario de fondo', '', { duration: 2500 }); return 0; }
    this.procesando.set(`Leyendo el formulario de la hoja ${n}… (la primera vez tarda un poco)`);
    let res;
    try {
      // Al doble: a ~190 ppp el OCR no lee los rótulos pequeños de estos formularios.
      res = await this.ocr.recognize(await this.ampliada(uri, 2));
    } catch (e) {
      console.error('[plantilla-editor] OCR falló', e);
      if (!silencioso) this.procesando.set(null);
      this.snack.open('No se pudo leer el formulario (OCR)', 'Cerrar', { duration: 4000 });
      return 0;
    }
    const px = await this.pixelesDe(n);
    const pag = this.paginas.find(p => p.numero === n);
    const dim = DIMENSIONES[pag?.tamano ?? 'A4'];
    const k = res.width / dim.w;                       // px por mm de la imagen leída
    const yMm = (ws: typeof res.words) => Math.min(...ws.map(w => w.bbox.y0)) / k;

    // Palabras → líneas (las de la misma línea comparten línea base en tesseract).
    const lineas = new Map<string, typeof res.words>();
    for (const w of res.words) {
      const b = w.baseline;
      const clave = b ? `${b.x0},${b.y0},${b.x1},${b.y1}` : `${Math.round(w.bbox.y1 / 8)}`;
      lineas.set(clave, [...(lineas.get(clave) ?? []), w]);
    }
    const ordenadas = [...lineas.values()]
      .map(ws => ws.sort((a, b) => a.bbox.x0 - b.bbox.x0))
      .sort((a, b) => a[0].bbox.y0 - b[0].bbox.y0);

    const yaEnHoja = new Set(this.campos.filter(c => c.pagina === n).map(c => c.fuente + ':' + (c.campoFuente ?? c.fuenteConfigCampo)));
    const creados: CampoDto[] = [];
    const sinCasilla: string[] = [];
    const normal = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

    // Ancla del bloque del cotizante: el rótulo de nombre o apellido que aparezca primero en la
    // hoja (los rótulos grises pequeños a veces no se leen; basta con que se lea uno).
    const reNombres = ROTULOS.slice(0, 4).map(r => r.re);
    const ancla = ordenadas.find(ws => { const t = ws.map(w => normal(w.text)).join(' '); return reNombres.some(re => re.test(t)); });
    const yAncla = ancla ? yMm(ancla) : null;
    const enBloque = (r: typeof ROTULOS[number], ws: typeof res.words) => {
      if (!r.bloque || yAncla == null) return true;
      const y = yMm(ws);
      return y >= yAncla - 8 && y <= yAncla + (r.bloque === 'id' ? 30 : 75);
    };

    for (const r of ROTULOS) {
      const clave = r.dato.fuente + ':' + r.dato.campoFuente;
      if (yaEnHoja.has(clave)) continue;
      for (const ws of ordenadas) {
        if (!enBloque(r, ws)) continue;
        // Texto de la línea con el inicio de cada palabra, para saber qué palabras forman el rótulo.
        let texto = '';
        const inicios: number[] = [];
        for (const w of ws) { inicios.push(texto.length); texto += normal(w.text) + ' '; }
        const m = r.re.exec(texto);
        if (!m) continue;
        const desde = inicios.findIndex((ini, i) => ini <= m.index && (i + 1 >= inicios.length || inicios[i + 1] > m.index));
        let hasta = desde;
        while (hasta + 1 < ws.length && inicios[hasta + 1] < m.index + m[0].length) hasta++;
        const sel = ws.slice(Math.max(0, desde), hasta + 1);
        const rot = {
          x0: Math.min(...sel.map(w => w.bbox.x0)) / k, x1: Math.max(...sel.map(w => w.bbox.x1)) / k,
          y0: Math.min(...sel.map(w => w.bbox.y0)) / k, y1: Math.max(...sel.map(w => w.bbox.y1)) / k,
          dosPuntos: texto.slice(m.index + m[0].length).trimStart().startsWith(':'),
        };
        const caja = px ? this.casillaDeRotulo(px, dim, rot) : null;
        if (!caja) { sinCasilla.push(r.nombre); break; }
        const nuevo: CampoDto = {
          id: 0, _uid: ++this.nextUid, placeholder: 'Campo', fuente: 'CONTRATACION', campoFuente: null,
          fuenteConfigCampo: null, valorLiteral: null, formula: null, tipoRender: 'TEXTO', formato: null,
          activo: true, orden: this.campos.length, pagina: n, posX: this.r2(caja.x), posY: this.r2(caja.y),
          ancho: this.r2(caja.w), alto: this.r2(caja.h), fontSize: 10, fontFamily: null, fontColor: '#000000',
          fontBold: false, fontItalic: false, textAlign: 'LEFT', pasoCasilla: null, condicion: null,
          ...r.dato,
        } as CampoDto;
        // Fechas: si la casilla es una tira de cuadros D|D|M|M|A|A|A|A, un dígito por cuadro.
        if (nuevo.tipoRender === 'FECHA' && px) {
          const prueba = { ...nuevo };
          if (this.medirCuadros(px, prueba, dim) >= 6) Object.assign(nuevo, prueba);
        }
        this.campos.push(nuevo);
        creados.push(nuevo);
        yaEnHoja.add(clave);
        break;
      }
    }
    if (creados.length) {
      this.marcarSucio();
      this.irAPagina(n);
      this.seleccion.set(new Set(creados.map(c => c._uid!)));
    }
    if (!silencioso) {
      this.procesando.set(null);
      this.snack.open(creados.length
        ? `Coloqué ${creados.length} dato(s): ${creados.map(c => this.etiqueta(c)).join(', ')}. Revísalos antes de guardar.`
          + (sinCasilla.length ? ` Sin casilla clara: ${sinCasilla.join(', ')}.` : '')
        : 'No reconocí rótulos nuevos en esta hoja', 'Cerrar', { duration: 8000 });
    }
    return creados.length;
  }

  /**
   * Dónde va el dato de un rótulo impreso, en este orden:
   *  1. en la misma casilla, en su franja libre (rótulo arriba, dato abajo);
   *  2. a la derecha del rótulo si este termina en ":" ("Dirección: ______");
   *  3. en la casilla de arriba (formularios con el rótulo DEBAJO de la raya: "Primer apellido");
   *  4. en la de abajo.
   */
  private casillaDeRotulo(px: ImageData, dim: { w: number; h: number },
                          rot: { x0: number; x1: number; y0: number; y1: number; dosPuntos: boolean }) {
    const cx = (rot.x0 + rot.x1) / 2, alto = rot.y1 - rot.y0;
    const probar = (y: number) => this.buscarCasilla(px, { posX: cx - 1, posY: y - 0.5, ancho: 2, alto: 1 } as CampoDto, dim);
    const misma = probar((rot.y0 + rot.y1) / 2);
    if (misma?.franja && !(misma.y < rot.y1 && misma.y + misma.h > rot.y0)) return misma;
    if (rot.dosPuntos && misma) {
      const x = rot.x1 + 1, w = misma.x + misma.w - x;
      if (w >= 12) return { x, y: rot.y0 - alto * 0.2, w, h: alto * 1.4, franja: true };
    }
    const arriba = probar(rot.y0 - 2);
    if (arriba?.franja) return arriba;
    const abajo = probar(rot.y1 + 2);
    if (abajo?.franja) return abajo;
    return misma ?? arriba ?? abajo;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Zoom
  // ═════════════════════════════════════════════════════════════════════════

  private observarLienzo() {
    const el = this.lienzoRef?.nativeElement;
    if (!el || this.resizeObs) { this.reajustar(); return; }
    this.resizeObs = new ResizeObserver(() => this.reajustar());
    this.resizeObs.observe(el);
    this.reajustar();
  }

  private reajustar() {
    const el = this.lienzoRef?.nativeElement;
    if (!el || !this.ajuste) return;
    const w = el.clientWidth - 64, h = el.clientHeight - 64;
    if (w < 100) return;
    const e = this.ajuste === 'ancho' ? w / this.dim.w : Math.min(w / this.dim.w, h / this.dim.h);
    this.escala.set(Math.max(1, Math.min(8, e)));
  }

  zoom(f: number) {
    this.ajuste = null;
    this.escala.set(Math.max(1, Math.min(10, +(this.escala() * f).toFixed(2))));
  }
  ajustar(m: 'ancho' | 'pagina') { this.ajuste = m; this.reajustar(); }
  get zoomPct() { return Math.round(this.escala() / (96 / 25.4) * 100); }

  onWheel(ev: WheelEvent) {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    this.zoom(ev.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Paleta
  // ═════════════════════════════════════════════════════════════════════════

  readonly paleta = computed<ItemPaleta[]>(() => {
    const items: ItemPaleta[] = [
      { clave: 'firma', etiqueta: 'Firma del trabajador', icono: 'draw', grupo: 'Firma y huella',
        ejemplo: 'La registrada en contratación',
        crear: () => ({ placeholder: 'Firma', fuente: 'BIOMETRIA', campoFuente: 'firma', tipoRender: 'FIRMA', ancho: 50, alto: 10, textAlign: 'CENTER' }) },
      { clave: 'huella', etiqueta: 'Huella del trabajador', icono: 'fingerprint', grupo: 'Firma y huella',
        ejemplo: 'Se agrega apagada: enciende "Se imprime" si el formato la pide',
        crear: () => ({ placeholder: 'Huella', fuente: 'BIOMETRIA', campoFuente: 'huella', tipoRender: 'HUELLA', ancho: 14, alto: 17, textAlign: 'CENTER', activo: false }) },
    ];
    for (const cd of this.data.camposDisponibles) {
      const temporal = cd.fuente === 'TEMPORAL_CONFIG';
      if (temporal && /imagen/.test(cd.campo)) continue;
      items.push({
        clave: cd.fuente + ':' + cd.campo, etiqueta: cd.etiqueta, ejemplo: cd.ejemplo,
        icono: temporal ? 'apartment' : /fecha/.test(cd.campo) ? 'event' : 'badge',
        grupo: temporal ? 'Empleador (temporal)' : 'Datos del trabajador',
        crear: () => ({
          placeholder: this.nombrePlaceholder(cd.campo), fuente: cd.fuente, campoFuente: temporal ? null : cd.campo,
          fuenteConfigCampo: temporal ? cd.campo : null,
          tipoRender: /fecha/.test(cd.campo) ? 'FECHA' : cd.campo === 'salario' ? 'NUMERO' : 'TEXTO',
          ancho: /correo|direccion|nombre_completo|empresa_usuaria/.test(cd.campo) ? 60 : 32, alto: 4,
        }),
      });
    }
    items.push(
      { clave: 'fecha-casillas', etiqueta: 'Fecha en casillas (DDMMAAAA)', icono: 'calendar_view_week', grupo: 'Especiales',
        ejemplo: 'Un dígito por cuadro',
        crear: () => ({ placeholder: 'Fecha_Nacimiento', fuente: 'CONTRATACION', campoFuente: 'fecha_nacimiento', tipoRender: 'FECHA', pasoCasilla: 4, ancho: 32, alto: 4 }) },
      { clave: 'fecha-partes', etiqueta: 'Fecha en 3 partes (día · mes · año)', icono: 'date_range', grupo: 'Especiales',
        ejemplo: 'Cada parte en su grupo de casillas',
        crear: () => ({ placeholder: 'Fecha_Nacimiento', fuente: 'CONTRATACION', campoFuente: 'fecha_nacimiento', tipoRender: 'FECHA', formato: 'dd', pasoCasilla: 4, ancho: 8, alto: 4 }),
        extra: [
          { formato: 'MM', pasoCasilla: 4, ancho: 8, dx: 10 },
          { formato: 'yyyy', pasoCasilla: 4, ancho: 16, dx: 20 },
        ] },
      { clave: 'cedula-casillas', etiqueta: 'Documento en casillas', icono: 'pin', grupo: 'Especiales',
        ejemplo: 'Un dígito por cuadro',
        crear: () => ({ placeholder: 'Cedula', fuente: 'CONTRATACION', campoFuente: 'cedula', tipoRender: 'TEXTO', pasoCasilla: 4, ancho: 40, alto: 4 }) },
      { clave: 'marca-f', etiqueta: 'Casilla X: sexo femenino', icono: 'check_box', grupo: 'Especiales',
        crear: () => ({ placeholder: 'Sexo', fuente: 'CONTRATACION', campoFuente: 'sexo', tipoRender: 'MARCA', condicion: 'F', ancho: 3, alto: 3, textAlign: 'CENTER' }) },
      { clave: 'marca-m', etiqueta: 'Casilla X: sexo masculino', icono: 'check_box', grupo: 'Especiales',
        crear: () => ({ placeholder: 'Sexo', fuente: 'CONTRATACION', campoFuente: 'sexo', tipoRender: 'MARCA', condicion: 'M', ancho: 3, alto: 3, textAlign: 'CENTER' }) },
      { clave: 'literal', etiqueta: 'Texto fijo', icono: 'text_fields', grupo: 'Especiales',
        ejemplo: 'Ej.: X en una casilla, un código',
        crear: () => ({ placeholder: 'Texto', fuente: 'LITERAL', valorLiteral: 'X', ancho: 20, alto: 4 }) },
    );
    return items;
  });

  gruposPaleta(): { grupo: string; items: ItemPaleta[] }[] {
    const f = this.filtroPaleta.trim().toLowerCase();
    const grupos = new Map<string, ItemPaleta[]>();
    for (const it of this.paleta()) {
      if (f && !(it.etiqueta + ' ' + (it.ejemplo ?? '')).toLowerCase().includes(f)) continue;
      grupos.set(it.grupo, [...(grupos.get(it.grupo) ?? []), it]);
    }
    return [...grupos.entries()].map(([grupo, items]) => ({ grupo, items }));
  }

  private nombrePlaceholder(campo: string) {
    return campo.split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('_');
  }

  /** Clic en la paleta: el campo aparece en el centro de lo que se está viendo. */
  agregar(it: ItemPaleta, enMm?: { x: number; y: number }) {
    this.commit();
    const base = it.crear();
    const ancho = base.ancho ?? 32, alto = base.alto ?? 4;
    let x: number, y: number;
    if (enMm) { x = enMm.x - ancho / 2; y = enMm.y - alto / 2; }
    else {
      const el = this.lienzoRef?.nativeElement;
      const centroY = el ? (el.scrollTop + el.clientHeight / 2 - 32) / this.escala() : this.dim.h / 2;
      x = this.dim.w / 2 - ancho / 2; y = centroY - alto / 2;
    }
    const nuevo: CampoDto = {
      id: 0, _uid: ++this.nextUid, placeholder: 'Campo', fuente: 'CONTRATACION', campoFuente: null,
      fuenteConfigCampo: null, valorLiteral: null, formula: null, tipoRender: 'TEXTO', formato: null,
      activo: true, orden: this.campos.length, pagina: this.paginaActual(), posX: 0, posY: 0,
      ancho, alto, fontSize: 9, fontFamily: null, fontColor: '#000000', fontBold: false,
      fontItalic: false, textAlign: 'LEFT', pasoCasilla: null, condicion: null,
      ...base,
    } as CampoDto;
    nuevo.posX = this.r2(Math.max(0, Math.min(this.dim.w - ancho, x)));
    nuevo.posY = this.r2(Math.max(0, Math.min(this.dim.h - alto, y)));
    this.campos.push(nuevo);
    const creados = [nuevo];
    for (const e of it.extra ?? []) {
      const { dx, ...resto } = e;
      const h: CampoDto = { ...nuevo, ...resto, _uid: ++this.nextUid, posX: this.r2(Math.min(this.dim.w - (resto.ancho ?? nuevo.ancho), nuevo.posX + dx)) };
      this.campos.push(h); creados.push(h);
    }
    this.seleccion.set(new Set(creados.map(c => c._uid!)));
    this.marcarSucio();
    // Soltado sobre una casilla del formulario: se encaja solo en ella (y en sus cuadros).
    if (enMm && this.ajustarAlSoltar && creados.length === 1 && nuevo.tipoRender !== 'MARCA') {
      this.ajustarACasilla([nuevo], true);
    }
  }

  onDragStartPaleta(ev: DragEvent, it: ItemPaleta) {
    ev.dataTransfer?.setData('text/plain', it.clave);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
  }

  onDropHoja(ev: DragEvent) {
    ev.preventDefault();
    const clave = ev.dataTransfer?.getData('text/plain');
    const it = this.paleta().find(p => p.clave === clave);
    if (!it) return;
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.agregar(it, { x: (ev.clientX - rect.left) / this.escala(), y: (ev.clientY - rect.top) / this.escala() });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Selección y edición
  // ═════════════════════════════════════════════════════════════════════════

  camposPagina() { return this.campos.filter(c => c.pagina === this.paginaActual()); }

  get seleccionados(): CampoDto[] {
    const s = this.seleccion();
    return this.campos.filter(c => s.has(c._uid!));
  }
  get unico(): CampoDto | null { const s = this.seleccionados; return s.length === 1 ? s[0] : null; }
  esSel(c: CampoDto) { return this.seleccion().has(c._uid!); }

  seleccionar(c: CampoDto, ev?: MouseEvent) {
    const s = new Set(ev?.shiftKey || ev?.ctrlKey || ev?.metaKey ? this.seleccion() : []);
    if ((ev?.shiftKey || ev?.ctrlKey || ev?.metaKey) && s.has(c._uid!)) s.delete(c._uid!); else s.add(c._uid!);
    this.seleccion.set(s);
  }

  seleccionarDesdeCapa(c: CampoDto, ev: MouseEvent) {
    if (c.pagina !== this.paginaActual()) this.paginaActual.set(c.pagina);
    this.seleccionar(c, ev);
  }

  deseleccionar() { this.seleccion.set(new Set()); }
  seleccionarTodo() { this.seleccion.set(new Set(this.camposPagina().map(c => c._uid!))); }

  eliminarSeleccion() {
    if (!this.seleccionados.length) return;
    this.commit();
    const s = this.seleccion();
    this.campos = this.campos.filter(c => !s.has(c._uid!));
    this.deseleccionar();
    this.marcarSucio();
  }

  duplicarSeleccion() {
    if (!this.seleccionados.length) return;
    this.commit();
    const nuevos = this.seleccionados.map(c => ({ ...c, id: 0, _uid: ++this.nextUid, posX: this.r2(c.posX + 3), posY: this.r2(c.posY + 3) }));
    this.campos.push(...nuevos);
    this.seleccion.set(new Set(nuevos.map(c => c._uid!)));
    this.marcarSucio();
  }

  mover(dx: number, dy: number) {
    if (!this.seleccionados.length) return;
    this.commitAgrupado();
    for (const c of this.seleccionados) {
      c.posX = this.r2(Math.max(0, Math.min(this.dim.w - c.ancho, c.posX + dx)));
      c.posY = this.r2(Math.max(0, Math.min(this.dim.h - c.alto, c.posY + dy)));
    }
    this.marcarSucio(false);
  }

  /** Cambio desde el panel de propiedades: un paso de deshacer por ráfaga de tecleo. */
  cambioPropiedad(recalcular = true) {
    this.commitAgrupado();
    this.marcarSucio(recalcular);
  }

  alinear(como: 'izq' | 'der' | 'arriba' | 'abajo' | 'centroX' | 'ancho' | 'alto' | 'letra' | 'repartirX') {
    const s = this.seleccionados;
    if (s.length < 2) return;
    this.commit();
    const ref = s[0];
    switch (como) {
      case 'izq':    s.forEach(c => c.posX = ref.posX); break;
      case 'der':    s.forEach(c => c.posX = this.r2(ref.posX + ref.ancho - c.ancho)); break;
      case 'arriba': s.forEach(c => c.posY = ref.posY); break;
      case 'abajo':  s.forEach(c => c.posY = this.r2(ref.posY + ref.alto - c.alto)); break;
      case 'centroX': s.forEach(c => c.posX = this.r2(ref.posX + (ref.ancho - c.ancho) / 2)); break;
      case 'ancho':  s.forEach(c => c.ancho = ref.ancho); break;
      case 'alto':   s.forEach(c => c.alto = ref.alto); break;
      case 'letra':  s.forEach(c => c.fontSize = ref.fontSize); break;
      case 'repartirX': {
        const ord = [...s].sort((a, b) => a.posX - b.posX);
        const ini = ord[0].posX, fin = ord[ord.length - 1].posX;
        ord.forEach((c, i) => c.posX = this.r2(ini + (fin - ini) * i / (ord.length - 1)));
        break;
      }
    }
    this.marcarSucio();
  }

  // ── Arrastre en el lienzo ─────────────────────────────────────────────────

  onMouseDownCampo(ev: MouseEvent, c: CampoDto, modo: Modo = 'move') {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    if (!this.esSel(c)) this.seleccionar(c, ev);
    else if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { this.seleccionar(c, ev); return; }
    const objetivo = modo === 'move' ? this.seleccionados : [c];
    this.arrastre = {
      modo, x0: ev.clientX, y0: ev.clientY, movido: false,
      orig: new Map(objetivo.map(o => [o._uid!, { x: o.posX, y: o.posY, w: o.ancho, h: o.alto }])),
    };
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(ev: MouseEvent) {
    const a = this.arrastre;
    if (!a) return;
    const k = this.escala();
    let dx = (ev.clientX - a.x0) / k, dy = (ev.clientY - a.y0) / k;
    if (!a.movido) {
      if (Math.abs(dx) + Math.abs(dy) < 0.3) return;
      a.movido = true;
      this.commit();
    }
    const libre = ev.altKey;   // Alt = sin imanes
    const objetivo = this.campos.filter(c => a.orig.has(c._uid!));
    const MIN = 1.5, D = this.dim;
    this.guias = [];

    if (a.modo === 'move') {
      // Imán: bordes y centro del grupo contra los demás campos y el centro de la hoja.
      const bb = this.caja([...a.orig.values()].map(o => ({ x: o.x + dx, y: o.y + dy, w: o.w, h: o.h })));
      if (!libre) {
        const sx = this.imantar([bb.x, bb.x + bb.w / 2, bb.x + bb.w], 'x', a.orig);
        const sy = this.imantar([bb.y, bb.y + bb.h / 2, bb.y + bb.h], 'y', a.orig);
        dx += sx.delta; dy += sy.delta;
        this.guias = [...sx.guias, ...sy.guias];
      }
      for (const c of objetivo) {
        const o = a.orig.get(c._uid!)!;
        c.posX = this.r2(Math.max(0, Math.min(D.w - c.ancho, o.x + dx)));
        c.posY = this.r2(Math.max(0, Math.min(D.h - c.alto, o.y + dy)));
      }
    } else {
      const c = objetivo[0], o = a.orig.get(c._uid!)!;
      let x = o.x, y = o.y, w = o.w, h = o.h;
      if (a.modo.includes('e')) w = o.w + dx;
      if (a.modo.includes('s')) h = o.h + dy;
      if (a.modo.includes('w')) { x = o.x + dx; w = o.w - dx; }
      if (a.modo.includes('n')) { y = o.y + dy; h = o.h - dy; }
      if (!libre) {
        if (a.modo.includes('e')) { const s = this.imantar([x + w], 'x', a.orig); w += s.delta; this.guias.push(...s.guias); }
        if (a.modo.includes('w')) { const s = this.imantar([x], 'x', a.orig); x += s.delta; w -= s.delta; this.guias.push(...s.guias); }
        if (a.modo.includes('s')) { const s = this.imantar([y + h], 'y', a.orig); h += s.delta; this.guias.push(...s.guias); }
        if (a.modo.includes('n')) { const s = this.imantar([y], 'y', a.orig); y += s.delta; h -= s.delta; this.guias.push(...s.guias); }
      }
      if (w < MIN) { if (a.modo.includes('w')) x -= MIN - w; w = MIN; }
      if (h < MIN) { if (a.modo.includes('n')) y -= MIN - h; h = MIN; }
      c.posX = this.r2(Math.max(0, x)); c.posY = this.r2(Math.max(0, y));
      c.ancho = this.r2(Math.min(D.w - c.posX, w)); c.alto = this.r2(Math.min(D.h - c.posY, h));
    }
  }

  @HostListener('document:mouseup')
  onMouseUp() {
    if (this.arrastre?.movido) this.marcarSucio(false);
    this.arrastre = null;
    this.guias = [];
  }

  private caja(rs: { x: number; y: number; w: number; h: number }[]) {
    const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
    return { x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y };
  }

  /** Busca la línea más cercana (bordes/centros de los demás campos, centro de hoja) a menos de SNAP_MM. */
  private imantar(puntos: number[], eje: 'x' | 'y', excluir: Map<number, unknown>): { delta: number; guias: Guia[] } {
    const lineas: number[] = [eje === 'x' ? this.dim.w / 2 : this.dim.h / 2];
    for (const c of this.camposPagina()) {
      if (excluir.has(c._uid!)) continue;
      if (eje === 'x') lineas.push(c.posX, c.posX + c.ancho / 2, c.posX + c.ancho);
      else lineas.push(c.posY, c.posY + c.alto / 2, c.posY + c.alto);
    }
    let mejor: { d: number; mm: number } | null = null;
    for (const p of puntos) for (const l of lineas) {
      const d = l - p;
      if (Math.abs(d) <= SNAP_MM && (!mejor || Math.abs(d) < Math.abs(mejor.d))) mejor = { d, mm: l };
    }
    return mejor ? { delta: mejor.d, guias: [{ eje, mm: mejor.mm }] } : { delta: 0, guias: [] };
  }

  // ── Teclado ───────────────────────────────────────────────────────────────

  @HostListener('document:keydown', ['$event'])
  onKey(ev: KeyboardEvent) {
    const t = ev.target as HTMLElement;
    const escribiendo = /INPUT|TEXTAREA|SELECT/.test(t?.tagName) || t?.isContentEditable;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 's') { ev.preventDefault(); this.guardar(); return; }
    if (escribiendo) return;
    if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? this.rehacer() : this.deshacer(); return; }
    if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); this.rehacer(); return; }
    if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); this.duplicarSeleccion(); return; }
    if (mod && ev.key.toLowerCase() === 'a') { ev.preventDefault(); this.seleccionarTodo(); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.eliminarSeleccion(); return; }
    if (ev.key === 'Escape') { this.deseleccionar(); return; }
    const paso = ev.shiftKey ? 2 : ev.altKey ? 0.1 : 0.5;
    const flechas: Record<string, [number, number]> = {
      ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso],
    };
    if (flechas[ev.key]) { ev.preventDefault(); this.mover(...flechas[ev.key]); }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Deshacer / rehacer
  // ═════════════════════════════════════════════════════════════════════════

  private foto() { return JSON.stringify(this.campos); }

  private commit() {
    this.pila.push(this.foto());
    if (this.pila.length > 100) this.pila.shift();
    this.rehacerPila = [];
    this.ultimoCommit = Date.now();
  }

  /** Teclas y tecleo seguidos (menos de 0,8 s) cuentan como un solo paso. */
  private commitAgrupado() {
    if (Date.now() - this.ultimoCommit > 800) this.commit();
    this.ultimoCommit = Date.now();
  }

  get puedeDeshacer() { return this.pila.length > 0; }
  get puedeRehacer() { return this.rehacerPila.length > 0; }

  deshacer() {
    const f = this.pila.pop();
    if (!f) return;
    this.rehacerPila.push(this.foto());
    this.restaurar(f);
  }

  rehacer() {
    const f = this.rehacerPila.pop();
    if (!f) return;
    this.pila.push(this.foto());
    this.restaurar(f);
  }

  private restaurar(f: string) {
    this.campos = JSON.parse(f);
    const vivos = new Set(this.campos.map(c => c._uid));
    this.seleccion.set(new Set([...this.seleccion()].filter(u => vivos.has(u))));
    this.marcarSucio();
  }

  private marcarSucio(recalcular = true) {
    this.sucio.set(true);
    if (recalcular) this.pedirPrevia$.next();
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Vista previa
  // ═════════════════════════════════════════════════════════════════════════

  alternarPrevia() {
    this.previa.set(!this.previa());
    if (this.previa()) {
      if (!this.plantillaId) {
        this.snack.open('Guarda la plantilla una vez para poder previsualizarla', 'Cerrar', { duration: 4000 });
        this.previa.set(false);
        return;
      }
      if (!this.muestra() && this.muestras().length) this.elegirMuestra(this.muestras()[0]);
    }
  }

  elegirMuestra(m: MuestraProceso | null) {
    this.muestra.set(m);
    this.busqueda = '';
    this.resultadosBusqueda.set([]);
    this.pedirPrevia$.next();
  }

  onBuscar(q: string) { this.buscar$.next(q); }

  pdfReal() {
    if (!this.plantillaId) { this.snack.open('Guarda la plantilla primero', '', { duration: 3000 }); return; }
    if (this.paginasSucias) {
      this.snack.open('El PDF usa las páginas guardadas: guarda para ver el formulario nuevo', 'Cerrar', { duration: 5000 });
    }
    this.cargandoPrevia.set(true);
    this.svc.previsualizarPdf(this.plantillaId, this.muestra()?.procesoId ?? null, this.camposRequest()).subscribe({
      next: blob => {
        this.cargandoPrevia.set(false);
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: async err => {
        this.cargandoPrevia.set(false);
        let motivo = 'No se pudo generar el PDF de prueba';
        try { const j = JSON.parse(await (err.error as Blob).text()); if (j?.motivo) motivo = j.motivo; } catch { /* sin cuerpo */ }
        this.snack.open(motivo, 'Cerrar', { duration: 6000 });
      },
    });
  }

  valorDe(c: CampoDto): ValorCampo | undefined { return this.valores.get(c._uid!); }


  // ═════════════════════════════════════════════════════════════════════════
  // Estilos del lienzo (mm → px, pt → px)
  // ═════════════════════════════════════════════════════════════════════════

  estiloCaja(c: CampoDto): Record<string, string> {
    const k = this.escala();
    const firma = this.previa() && c.tipoRender === 'FIRMA' && !!this.valorDe(c)?.imagen;
    const alto = firma ? Math.max(c.alto, ALTO_MIN_FIRMA) : c.alto;
    const top = firma ? c.posY + c.alto - alto : c.posY;
    return {
      left: c.posX * k + 'px', top: top * k + 'px', width: c.ancho * k + 'px', height: alto * k + 'px',
    };
  }

  /**
   * Lo que el PDF dibuja en cada campo de la hoja, calculado con las MISMAS reglas que
   * PdfCanvasService (la caja es la casilla: mayúsculas centradas a lo alto, letra que baja
   * desde el máximo hasta caber). Se pinta en un SVG con viewBox en milímetros, así que no
   * depende del zoom ni de la pantalla.
   */
  renderPagina(): Dibujo[] {
    const out: Dibujo[] = [];
    for (const c of this.camposPagina()) {
      if (!c.activo) continue;
      const v = this.valorDe(c);
      if (!v) continue;
      if (v.imagen) {
        const firma = c.tipoRender === 'FIRMA';
        const alto = firma ? Math.max(c.alto, ALTO_MIN_FIRMA) : c.alto;
        out.push({ tipo: 'img', uid: c._uid!, src: v.imagen, x: c.posX, y: c.posY + c.alto - alto, w: c.ancho, h: alto,
          ajuste: firma ? 'xMidYMax meet' : 'xMidYMid meet' });
        continue;
      }
      const texto = v.texto ?? '';
      if (!texto) continue;
      const fam = this.familiaCss(c), cap = this.capDe(c);
      const peso = c.fontBold ? 700 : 400, estilo = c.fontItalic ? 'italic' : 'normal', color = c.fontColor || '#000';
      const fsMax = Number(c.fontSize) || 9;
      const paso = Number(c.pasoCasilla) || 0;
      if (paso > 0) {
        const anchoMax = Math.max(...texto.split('').map(ch => this.anchoPorPunto(ch, c)));
        const f = this.ajustarLetra(fsMax, anchoMax, paso * 0.88, c.alto, cap);
        const base = c.posY + c.alto / 2 + cap * f * PT_MM / 2;
        texto.split('').forEach((ch, i) => out.push({
          tipo: 'txt', uid: c._uid!, x: c.posX + paso * i + paso / 2, y: base, ancla: 'middle', texto: ch,
          size: f * PT_MM, fam, peso, estilo, color,
        }));
        continue;
      }
      if (c.alto / PT_MM > fsMax * 2.2) {           // párrafo de varias líneas
        const ancho = c.ancho - 2 * PAD_MM;
        let linea = '', y = c.posY + fsMax * 1.5 * PT_MM;   // ColumnText: primera línea a un interlineado
        const paso = fsMax * 1.5 * PT_MM;
        for (const palabra of texto.split(/\s+/)) {
          const prueba = linea ? linea + ' ' + palabra : palabra;
          if (linea && this.anchoPorPunto(prueba, c) * fsMax * PT_MM > ancho) {
            out.push(this.txt(c, linea, c.posX + PAD_MM, y, 'start', fsMax, fam, peso, estilo, color));
            linea = palabra; y += paso;
          } else linea = prueba;
        }
        if (linea) out.push(this.txt(c, linea, c.posX + PAD_MM, y, 'start', fsMax, fam, peso, estilo, color));
        continue;
      }
      const centro = c.textAlign === 'CENTER';
      const pad = centro ? 0 : PAD_MM;
      const f = this.ajustarLetra(fsMax, this.anchoPorPunto(texto, c), c.ancho - 2 * pad, c.alto, cap);
      const base = c.posY + c.alto / 2 + cap * f * PT_MM / 2;
      const x = centro ? c.posX + c.ancho / 2 : c.textAlign === 'RIGHT' ? c.posX + c.ancho - pad : c.posX + pad;
      out.push(this.txt(c, texto, x, base, centro ? 'middle' : c.textAlign === 'RIGHT' ? 'end' : 'start', f, fam, peso, estilo, color));
    }
    return out;
  }

  private txt(c: CampoDto, texto: string, x: number, y: number, ancla: 'start' | 'middle' | 'end', pt: number,
              fam: string, peso: number, estilo: string, color: string): Dibujo {
    return { tipo: 'txt', uid: c._uid!, x, y, ancla, texto, size: pt * PT_MM, fam, peso, estilo, color };
  }

  /** Igual que PdfCanvasService.ajustarLetra (todo en pt; las cajas en mm). */
  private ajustarLetra(fsMax: number, anchoPorPunto: number, anchoMm: number, altoMm: number, cap: number) {
    let f = fsMax;
    const anchoPt = anchoMm / PT_MM, altoPt = altoMm / PT_MM;
    if (anchoPorPunto > 0 && anchoPt > 0 && anchoPorPunto * f > anchoPt) f = anchoPt / anchoPorPunto;
    if (altoPt > 0 && cap * f > altoPt * 0.72) f = altoPt * 0.72 / cap;
    return Math.max(4, f);
  }

  /** Ancho del texto a 1 pt con la letra del campo (Arial = métricas de Helvetica). */
  private anchoPorPunto(texto: string, c: CampoDto): number {
    if (!this.medidor) return texto.length * 0.55;
    this.medidor.font = `${c.fontItalic ? 'italic ' : ''}${c.fontBold ? 'bold ' : ''}100px ${this.familiaCss(c)}`;
    return this.medidor.measureText(texto).width / 100;
  }

  /** Alto de mayúsculas por punto: los valores de las 14 fuentes base del PDF. */
  private capDe(c: CampoDto): number {
    const f = c.fontFamily ?? '';
    if (/times/i.test(f)) return 0.662;
    if (/courier/i.test(f)) return 0.562;
    return f.startsWith('custom:') ? 0.7 : 0.718;
  }

  trackDibujo = (i: number) => i;

  familiaCss(c: CampoDto): string {
    const f = c.fontFamily;
    if (f?.startsWith('custom:')) { this.cargarFuenteCss(+f.slice(7)); return `"fuente-${f.slice(7)}", Helvetica, Arial, sans-serif`; }
    if (f && /times/i.test(f)) return '"Times New Roman", Times, serif';
    if (f && /courier/i.test(f)) return '"Courier New", Courier, monospace';
    return 'Helvetica, Arial, sans-serif';
  }

  /** Etiqueta corta del campo en el lienzo y en capas. */
  etiqueta(c: CampoDto): string {
    if (c.fuente === 'BIOMETRIA') return c.tipoRender === 'HUELLA' ? 'Huella' : 'Firma';
    if (c.fuente === 'LITERAL') return `"${c.valorLiteral ?? ''}"`;
    if (c.tipoRender === 'MARCA') return `X si ${c.campoFuente ?? '?'} = ${c.condicion ?? '?'}`;
    const clave = c.fuente === 'TEMPORAL_CONFIG' ? c.fuenteConfigCampo : c.campoFuente;
    const cd = this.data.camposDisponibles.find(d => d.campo === clave && d.fuente === c.fuente);
    return (cd?.etiqueta ?? clave ?? c.placeholder) + (c.pasoCasilla ? ' ▦' : '');
  }

  claseTipo(c: CampoDto): string {
    if (c.fuente === 'BIOMETRIA') return c.tipoRender === 'HUELLA' ? 't-huella' : 't-firma';
    if (c.tipoRender === 'MARCA') return 't-marca';
    if (c.tipoRender === 'FECHA') return 't-fecha';
    if (c.fuente === 'TEMPORAL_CONFIG') return 't-temporal';
    if (c.fuente === 'LITERAL') return 't-literal';
    return 't-texto';
  }

  fueraDeHoja(c: CampoDto) { return c.posX + c.ancho > this.dim.w + 0.5 || c.posY + c.alto > this.dim.h + 0.5; }

  // ═════════════════════════════════════════════════════════════════════════
  // Propiedades
  // ═════════════════════════════════════════════════════════════════════════

  /** Opciones del selector "Dato" del panel de propiedades. */
  opcionesDato = computed(() => {
    const op = this.data.camposDisponibles.filter(d => !(d.fuente === 'TEMPORAL_CONFIG' && /imagen/.test(d.campo)))
      .map(d => ({ valor: d.fuente + ':' + d.campo, etiqueta: d.etiqueta, grupo: d.fuente === 'TEMPORAL_CONFIG' ? 'Empleador' : 'Trabajador' }));
    return [
      { valor: 'BIOMETRIA:firma', etiqueta: 'Firma del trabajador', grupo: 'Firma y huella' },
      { valor: 'BIOMETRIA:huella', etiqueta: 'Huella del trabajador', grupo: 'Firma y huella' },
      { valor: 'LITERAL:', etiqueta: 'Texto fijo', grupo: 'Otros' },
      ...op,
    ];
  });

  datoDe(c: CampoDto): string {
    if (c.fuente === 'BIOMETRIA') return 'BIOMETRIA:' + (c.tipoRender === 'HUELLA' ? 'huella' : 'firma');
    if (c.fuente === 'LITERAL') return 'LITERAL:';
    if (c.fuente === 'TEMPORAL_CONFIG') return 'TEMPORAL_CONFIG:' + (c.fuenteConfigCampo ?? '');
    return 'CONTRATACION:' + (c.campoFuente ?? '');
  }

  cambiarDato(c: CampoDto, v: string) {
    this.commit();
    const [fuente, campo] = v.split(':');
    c.fuente = fuente as CampoDto['fuente'];
    c.campoFuente = fuente === 'CONTRATACION' ? campo : fuente === 'BIOMETRIA' ? campo : null;
    c.fuenteConfigCampo = fuente === 'TEMPORAL_CONFIG' ? campo : null;
    if (fuente === 'BIOMETRIA') { c.tipoRender = campo === 'huella' ? 'HUELLA' : 'FIRMA'; c.placeholder = campo === 'huella' ? 'Huella' : 'Firma'; }
    else {
      if (c.tipoRender === 'FIRMA' || c.tipoRender === 'HUELLA') c.tipoRender = 'TEXTO';
      if (/fecha/.test(campo)) c.tipoRender = 'FECHA';
      c.placeholder = fuente === 'LITERAL' ? 'Texto' : this.nombrePlaceholder(campo);
      if (fuente === 'LITERAL' && !c.valorLiteral) c.valorLiteral = 'X';
    }
    this.marcarSucio();
  }

  readonly tiposTexto: { valor: TipoRender; etiqueta: string }[] = [
    { valor: 'TEXTO', etiqueta: 'Texto' }, { valor: 'FECHA', etiqueta: 'Fecha' },
    { valor: 'NUMERO', etiqueta: 'Número con miles' }, { valor: 'MARCA', etiqueta: 'Casilla (X si coincide)' },
  ];
  readonly alineaciones: { valor: TextAlign; icono: string }[] = [
    { valor: 'LEFT', icono: 'format_align_left' }, { valor: 'CENTER', icono: 'format_align_center' },
    { valor: 'RIGHT', icono: 'format_align_right' },
  ];

  alternarCasillas(c: CampoDto, on: boolean) {
    this.commit();
    c.pasoCasilla = on ? (c.pasoCasilla || this.r2(c.ancho / 8)) : null;
    this.marcarSucio();
  }

  /** Reparte el ancho entre los caracteres del dato (8 para DDMMAAAA). */
  pasoDesdeAncho(c: CampoDto) {
    const n = Math.max(1, (this.valorDe(c)?.texto ?? '').length || (c.tipoRender === 'FECHA' ? 8 : 10));
    this.commit();
    c.pasoCasilla = this.r2(c.ancho / n);
    this.marcarSucio();
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Encajar en la casilla del formulario escaneado
  // ═════════════════════════════════════════════════════════════════════════

  ajustarAlSoltar = true;
  private pixeles = new Map<string, Promise<ImageData | null>>();

  /** Píxeles del fondo de una hoja (una sola vez por imagen). */
  private pixelesDe(n: number): Promise<ImageData | null> {
    const uri = this.fondos.get(n);
    if (!uri) return Promise.resolve(null);
    const clave = n + ':' + uri.length;
    if (!this.pixeles.has(clave)) {
      this.pixeles.set(clave, new Promise(res => {
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement('canvas');
          cv.width = img.naturalWidth; cv.height = img.naturalHeight;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          if (!ctx) { res(null); return; }
          ctx.drawImage(img, 0, 0);
          res(ctx.getImageData(0, 0, cv.width, cv.height));
        };
        img.onerror = () => res(null);
        img.src = uri;
      }));
    }
    return this.pixeles.get(clave)!;
  }

  /**
   * Encaja cada campo en la casilla impresa que tiene debajo: busca las rayas de arriba/abajo
   * y de los lados (líneas que cruzan casi toda la casilla, no letras) y, dentro, la franja
   * sin tinta más alta —para no pisar el rótulo "10. N° del documento…"—. Si el campo es de
   * casillas, además mide los cuadros.
   */
  async ajustarACasilla(campos = this.seleccionados, silencioso = false) {
    if (!campos.length) return;
    const px = await this.pixelesDe(campos[0].pagina);
    if (!px) { if (!silencioso) this.snack.open('Esta hoja no tiene formulario de fondo', '', { duration: 2500 }); return; }
    this.commit();
    let ok = 0;
    for (const c of campos) {
      // Una tira de cuadros se mide por sus rayas; buscar "la casilla" daría un solo cuadro.
      if (c.pasoCasilla) { if (this.medirCuadros(px, c)) ok++; continue; }
      const r = this.buscarCasilla(px, c);
      if (!r) continue;
      c.posX = this.r2(r.x); c.posY = this.r2(r.y); c.ancho = this.r2(r.w); c.alto = this.r2(r.h);
      ok++;
    }
    this.marcarSucio();
    if (!silencioso) {
      this.snack.open(ok ? `${ok} de ${campos.length} campo(s) encajado(s) en su casilla` : 'No encontré los bordes de la casilla: acerca el campo y vuelve a intentar',
        '', { duration: 3000 });
    }
  }

  /** Mide los cuadros de un campo de casillas (fechas, documento) y reparte un carácter por cuadro. */
  async detectarCasillas(c: CampoDto) {
    const px = await this.pixelesDe(c.pagina);
    if (!px) { this.snack.open('Esta hoja no tiene formulario de fondo', '', { duration: 2500 }); return; }
    this.commit();
    const n = this.medirCuadros(px, c);
    this.marcarSucio();
    this.snack.open(n ? `${n} casillas de ${Number(c.pasoCasilla).toFixed(2)} mm` : 'No encontré cuadros: ajusta la caja sobre la tira de casillas',
      '', { duration: 3000 });
  }

  private oscuro(px: ImageData, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= px.width || y >= px.height) return false;
    const i = (y * px.width + x) * 4, d = px.data;
    return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 170;
  }

  /** Fracción de píxeles oscuros en un tramo horizontal (fila) o vertical (columna). */
  private cobertura(px: ImageData, eje: 'fila' | 'col', fijo: number, desde: number, hasta: number): number {
    let n = 0, t = 0;
    for (let v = Math.round(desde); v <= Math.round(hasta); v++, t++) {
      if (eje === 'fila' ? this.oscuro(px, v, fijo) : this.oscuro(px, fijo, v)) n++;
    }
    return t ? n / t : 0;
  }

  /** {@code franja} = encontró dentro de la casilla una franja sin tinta de al menos 2 mm. */
  private buscarCasilla(px: ImageData, c: CampoDto, dim = this.dim): { x: number; y: number; w: number; h: number; franja: boolean } | null {
    const k = px.width / dim.w;                      // px por mm
    const cx = (c.posX + c.ancho / 2) * k;
    let cy = (c.posY + c.alto / 2) * k;
    const media = Math.max(1, Math.min(4, c.ancho * 0.4)) * k;
    const linea = (y: number) => this.cobertura(px, 'fila', y, cx - media, cx + media) >= 0.75;
    // Caja montada sobre una raya: el dato va en la casilla de arriba (el rótulo suele ir abajo).
    for (let y = Math.floor(c.posY * k); y <= (c.posY + c.alto) * k; y++) if (linea(y)) { cy = y - k; break; }
    let top = -1, bot = -1;
    for (let y = Math.round(cy); y > cy - 30 * k && y > 0; y--) if (linea(y)) { top = y; break; }
    for (let y = Math.round(cy); y < cy + 30 * k && y < px.height; y++) if (linea(y)) { bot = y; break; }
    if (top < 0 || bot < 0 || bot - top < 1.5 * k) return null;
    const col = (x: number) => this.esSeparador(px, x, top, bot, k);
    let izq = -1, der = -1;
    for (let x = Math.round(cx); x > cx - 120 * k && x > 0; x--) if (col(x)) { izq = x; break; }
    for (let x = Math.round(cx); x < cx + 120 * k && x < px.width; x++) if (col(x)) { der = x; break; }
    if (izq < 0 || der < 0 || der - izq < 1.5 * k) return null;
    // Saltar el grosor de las rayas.
    while (top < bot && linea(top + 1)) top++;
    while (bot > top && linea(bot - 1)) bot--;
    while (izq < der && col(izq + 1)) izq++;
    while (der > izq && col(der - 1)) der--;
    const m = 0.35 * k;
    const x0 = izq + m, x1 = der - m;
    let y0 = top + m, y1 = bot - m;
    // Franja sin tinta más alta dentro de la casilla (debajo o encima del rótulo impreso).
    let mejorIni = -1, mejorLen = 0, ini = -1;
    for (let y = Math.round(y0); y <= Math.round(y1) + 1; y++) {
      const vacia = y <= y1 && this.cobertura(px, 'fila', y, x0, x1) < 0.02;
      if (vacia && ini < 0) ini = y;
      if (!vacia && ini >= 0) { if (y - ini > mejorLen) { mejorLen = y - ini; mejorIni = ini; } ini = -1; }
    }
    const franja = mejorLen >= 2 * k;
    if (franja) { y0 = mejorIni + 0.15 * k; y1 = mejorIni + mejorLen - 0.15 * k; }
    return { x: x0 / k, y: y0 / k, w: (x1 - x0) / k, h: (y1 - y0) / k, franja };
  }

  /**
   * Separador vertical de casilla: raya que cubre casi todo el alto o, si no, una raya
   * continua de al menos el 40 % del alto que nace del borde de arriba o del de abajo (las
   * columnas de "Apellidos y nombres" son rayitas así). Una letra no toca los bordes.
   */
  private esSeparador(px: ImageData, x: number, top: number, bot: number, k: number): boolean {
    x = Math.round(x);
    if (x < 0 || x >= px.width) return false;
    const a = Math.round(top), b = Math.round(bot), alto = b - a + 1;
    let n = 0;
    for (let y = a; y <= b; y++) if (this.oscuro(px, x, y)) n++;
    if (n >= 0.7 * alto) return true;
    const tol = 0.6 * k;
    let run = 0;
    for (let y = a; y <= b && this.oscuro(px, x, y); y++) run++;
    if (run >= 0.4 * alto && run > tol) return true;
    run = 0;
    for (let y = b; y >= a && this.oscuro(px, x, y); y--) run++;
    return run >= 0.4 * alto && run > tol;
  }

  /**
   * Busca las rayas verticales que cruzan la tira de casillas y deja el campo empezando en
   * el primer cuadro, con el paso medido y un carácter por cuadro. Devuelve cuántos cuadros.
   */
  private medirCuadros(px: ImageData, c: CampoDto, dim = this.dim): number {
    const k = px.width / dim.w;
    const y0 = (c.posY + c.alto * 0.2) * k, y1 = (c.posY + c.alto * 0.8) * k;
    const xIni = Math.max(0, (c.posX - 3) * k), xFin = Math.min(px.width - 1, (c.posX + c.ancho + 3) * k);
    const lineas: number[] = [];
    let ini = -1;
    for (let x = Math.round(xIni); x <= Math.round(xFin) + 1; x++) {
      const es = x <= xFin && this.cobertura(px, 'col', x, y0, y1) >= 0.6;
      if (es && ini < 0) ini = x;
      if (!es && ini >= 0) { lineas.push((ini + x - 1) / 2); ini = -1; }
    }
    if (lineas.length < 3) return 0;
    const pasos = lineas.slice(1).map((l, i) => l - lineas[i]).sort((a, b) => a - b);
    const paso = pasos[Math.floor(pasos.length / 2)];
    // Solo los cuadros de paso regular (±25 %): descarta rayas de otras casillas vecinas.
    let a = 0, mejor = { a: 0, b: 0 };
    for (let i = 1; i <= lineas.length; i++) {
      const regular = i < lineas.length && Math.abs(lineas[i] - lineas[i - 1] - paso) <= paso * 0.25;
      if (!regular) { if (i - 1 - a > mejor.b - mejor.a) mejor = { a, b: i - 1 }; a = i; }
    }
    const n = mejor.b - mejor.a;
    if (n < 2) return 0;
    const xa = lineas[mejor.a], xb = lineas[mejor.b];
    c.pasoCasilla = this.r2((xb - xa) / n / k);
    c.posX = this.r2(xa / k);
    c.ancho = this.r2(c.pasoCasilla * n);
    // Alto: las rayas horizontales que cierran la tira por arriba y por abajo.
    const cy = (c.posY + c.alto / 2) * k;
    const fila = (y: number) => this.cobertura(px, 'fila', y, xa + 1, xb - 1) >= 0.75;
    let top = -1, bot = -1;
    for (let y = Math.round(cy); y > cy - 10 * k && y > 0; y--) if (fila(y)) { top = y; break; }
    for (let y = Math.round(cy); y < cy + 10 * k && y < px.height; y++) if (fila(y)) { bot = y; break; }
    if (top >= 0 && bot > top + k) {
      while (top < bot && fila(top + 1)) top++;
      while (bot > top && fila(bot - 1)) bot--;
      c.posY = this.r2((top + 0.25 * k) / k);
      c.alto = this.r2((bot - top - 0.5 * k) / k);
    }
    return n;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Fuentes
  // ═════════════════════════════════════════════════════════════════════════

  private cargarFuentes() {
    this.svc.listarFuentes().subscribe({ next: f => this.fuentes = f, error: () => {} });
  }

  private cargarFuenteCss(id: number) {
    if (this.fuentesCargadas.has(id)) return;
    this.fuentesCargadas.add(id);
    this.svc.archivoFuente(id).subscribe({
      next: uri => {
        if (!uri) return;
        const ff = new FontFace(`fuente-${id}`, `url(${uri})`);
        ff.load().then(f => { (document.fonts as FontFaceSet).add(f); this.campos = [...this.campos]; }).catch(() => {});
      },
      error: () => {},
    });
  }

  onArchivoFuente(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      this.nuevaFuente.archivoB64 = r.result as string;
      const base = f.name.replace(/\.(ttf|otf)$/i, '');
      this.nuevaFuente.nombre ||= base;
      this.nuevaFuente.cssFamilia ||= base;
    };
    r.readAsDataURL(f);
  }

  subirFuente() {
    if (!this.nuevaFuente.archivoB64 || !this.nuevaFuente.nombre) return;
    this.svc.crearFuente(this.nuevaFuente).subscribe({
      next: f => { this.fuentes = [...this.fuentes, f]; this.nuevaFuente = { nombre: '', cssFamilia: '', archivoB64: null }; this.snack.open('Fuente agregada', '', { duration: 2000 }); },
      error: () => this.snack.open('No se pudo subir la fuente (usa TTF)', '', { duration: 3000 }),
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Guardar / cerrar
  // ═════════════════════════════════════════════════════════════════════════

  private camposRequest(): CampoRequest[] {
    return this.campos.map((c, i) => ({
      id: c.id || null, placeholder: c.placeholder || 'Campo', fuente: c.fuente,
      campoFuente: c.campoFuente || null, fuenteConfigCampo: c.fuenteConfigCampo || null,
      valorLiteral: c.valorLiteral ?? null, formula: c.formula || null, tipoRender: c.tipoRender,
      formato: c.formato || null, activo: c.activo, orden: i, pagina: c.pagina,
      posX: c.posX, posY: c.posY, ancho: c.ancho, alto: c.alto, fontSize: Number(c.fontSize) || 9,
      fontFamily: c.fontFamily || null, fontColor: c.fontColor || '#000000', fontBold: !!c.fontBold,
      fontItalic: !!c.fontItalic, textAlign: c.textAlign || 'LEFT',
      pasoCasilla: c.pasoCasilla ? Number(c.pasoCasilla) : null, condicion: c.condicion || null,
    }));
  }

  get metaValida() { return !!(this.meta.epsKey?.trim() && this.meta.epsNombre?.trim() && this.meta.nombrePlantilla?.trim()); }

  guardar() {
    if (this.guardando()) return;
    if (!this.metaValida) {
      this.panelMeta.set(true);
      this.snack.open('Completa EPS (clave y nombre) y el nombre de la plantilla', 'Cerrar', { duration: 4000 });
      return;
    }
    this.guardando.set(true);
    const req: PlantillaRequest = {
      ...this.meta, epsKey: this.meta.epsKey.trim().toUpperCase(), campos: this.camposRequest(),
    };
    const obs = this.plantillaId ? this.svc.actualizarPlantilla(this.plantillaId, req) : this.svc.crearPlantilla(req);
    obs.subscribe({
      next: det => {
        const nueva = !this.plantillaId;
        this.plantillaId = det.id;
        this.version = det.version;
        // El servidor devuelve los campos en el mismo orden: así cada caja recupera su id.
        const porOrden = [...(det.campos ?? [])].sort((a, b) => a.orden - b.orden);
        this.campos.forEach((c, i) => { if (porOrden[i]) c.id = porOrden[i].id; });
        if (nueva) this.svc.muestras(det.id).subscribe({ next: m => this.muestras.set(m), error: () => {} });
        if (this.paginasSucias) this.guardarPaginas(); else this.terminarGuardado();
      },
      error: () => { this.guardando.set(false); this.snack.open('No se pudo guardar la plantilla', 'Cerrar', { duration: 4000 }); },
    });
  }

  private guardarPaginas() {
    const reqs = this.paginas.map(p => ({ numero: p.numero, tamano: p.tamano, imagenFondo: this.fondos.get(p.numero) ?? null }));
    this.svc.guardarPaginas(this.plantillaId!, reqs).subscribe({
      next: () => { this.paginasSucias = false; this.terminarGuardado(); },
      error: () => { this.guardando.set(false); this.snack.open('Se guardaron los campos pero no las páginas', 'Cerrar', { duration: 5000 }); },
    });
  }

  private terminarGuardado() {
    this.guardando.set(false);
    this.sucio.set(false);
    this.guardadoAlguna = true;
    this.snack.open('Plantilla guardada', '', { duration: 2000 });
  }

  private guardadoAlguna = false;

  cerrar() {
    if (this.sucio() && !confirm('Hay cambios sin guardar. ¿Salir sin guardar?')) return;
    this.ref.close(this.guardadoAlguna);
  }

  private r2(n: number) { return Math.round(n * 100) / 100; }
  trackUid = (_: number, c: CampoDto) => c._uid;
}
