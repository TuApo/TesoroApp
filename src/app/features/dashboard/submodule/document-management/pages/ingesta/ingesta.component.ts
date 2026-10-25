import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Inject, OnInit,
  PLATFORM_ID, ViewChild, computed, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NgxExtendedPdfViewerModule, NgxExtendedPdfViewerService } from 'ngx-extended-pdf-viewer';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';

import { isOfflineQueued } from '@/app/core/utils/offline-response';
import { GestionDocumentalService } from '../../../hiring/service/gestion-documental/gestion-documental.service';
import { DocumentScanDialogComponent } from '../../components/document-scan-dialog/document-scan-dialog.component';
import { DocumentacionService, agruparTiposPorPadre } from '../../service/documentacion/documentacion.service';
import {
  ContextoPersona, EstadoFicha, FichaIngesta, LineaActa, OrigenIngesta,
} from './ingesta.model';
import { IngestaService } from './ingesta.service';
import {
  CONFIANZA_AUTOMATICA, ETIQUETA_ESTADO, analizarTexto, estadoDeFicha, leerNombreArchivo,
  puedeRegistrarse, sugerirTipo, tamanoLegible, vigenteDelTipo,
} from './ingesta.util';

/** Tope por archivo. El mismo que aplicaba la pantalla anterior y el servidor. */
const MAX_BYTES = 10 * 1024 * 1024;
/** Páginas que se leen para el resumen: con las tres primeras ya se reconoce el documento. */
const PAGINAS_A_LEER = 3;
/** Subidas en paralelo. Tres es lo que aguanta el gateway sin encolar peticiones. */
const CONCURRENCIA = 3;

/** Lo que el visor está mostrando: una ficha o el PDF que se está repartiendo. */
type ModoVisor = 'ficha' | 'paquete' | 'nada';

/**
 * Mesa de ingesta documental: los cuatro orígenes en UNA sola vista.
 *
 * El problema de la pantalla anterior no era que faltaran funciones, era que
 * cada una vivía en un sitio distinto (el escáner en un diálogo a pantalla
 * completa, el ZIP en un `Swal` con dos campos, la consulta en otra ruta) y
 * ninguna enseñaba el documento antes de registrarlo. Se firmaba a ciegas: el
 * usuario elegía un tipo documental mirando un nombre de archivo y se enteraba
 * de que había pisado algo —o de que la cédula no existía— cuando ya estaba
 * guardado.
 *
 * Aquí todo converge en una FICHA, y antes de registrar se ve: el documento,
 * de quién es, qué dice, qué desplaza y cómo va a quedar guardado.
 */
@Component({
  selector: 'app-ingesta',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatProgressBarModule, MatSelectModule, MatTooltipModule,
    NgxExtendedPdfViewerModule,
  ],
  templateUrl: './ingesta.component.html',
  styleUrls: ['./ingesta.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IngestaComponent implements OnInit {
  private readonly docSrv = inject(DocumentacionService);
  private readonly gestionSrv = inject(GestionDocumentalService);
  private readonly ingestaSrv = inject(IngestaService);
  private readonly pdfSrv = inject(NgxExtendedPdfViewerService);
  private readonly dialog = inject(MatDialog);
  private readonly titulo = inject(Title);
  private readonly destroyRef = inject(DestroyRef);

  readonly esNavegador: boolean;

  @ViewChild('entradaArchivos') entradaArchivos!: ElementRef<HTMLInputElement>;
  @ViewChild('entradaZip') entradaZip!: ElementRef<HTMLInputElement>;
  @ViewChild('entradaPaquete') entradaPaquete!: ElementRef<HTMLInputElement>;

  // ── Catálogo de tipos ───────────────────────────────────────────────────
  readonly grupos = signal<{ padre: string; hijos: any[] }[]>([]);
  private readonly tiposPorId = new Map<number, any>();
  private tiposPlanos: { id: number; name: string }[] = [];

  // ── Estado de la mesa ───────────────────────────────────────────────────
  readonly origen = signal<OrigenIngesta>('archivos');
  readonly cedulaDestino = signal('');
  readonly fichas = signal<FichaIngesta[]>([]);
  readonly contextos = signal<Record<string, ContextoPersona>>({});
  readonly seleccionadaId = signal<string | null>(null);
  readonly arrastrando = signal(false);

  readonly registrando = signal(false);
  readonly progreso = signal(0);
  readonly acta = signal<LineaActa[] | null>(null);

  // ── Visor ───────────────────────────────────────────────────────────────
  readonly bytesVisor = signal<Uint8Array | null>(null);
  readonly modoVisor = signal<ModoVisor>('nada');
  readonly leyendo = signal(false);
  readonly trabajando = signal('');

  /** El PDF que se está repartiendo en paquetes, mientras dura el análisis. */
  private paqueteEnCurso: File | null = null;

  readonly etiquetaEstado = ETIQUETA_ESTADO;
  readonly tamanoLegible = tamanoLegible;
  readonly confianzaMinima = CONFIANZA_AUTOMATICA;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.esNavegador = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    if (!this.esNavegador) return;
    this.titulo.setTitle('Mesa de ingesta | Gestión Documental');
    this.cargarTipos();
  }

  // ── Derivados ───────────────────────────────────────────────────────────

  readonly seleccionada = computed<FichaIngesta | null>(() => {
    const id = this.seleccionadaId();
    return this.fichas().find(f => f.id === id) ?? null;
  });

  readonly contextoSeleccionado = computed<ContextoPersona | null>(() => {
    const f = this.seleccionada();
    return f ? this.contextos()[f.cedula] ?? null : null;
  });

  /**
   * Las cédulas en juego, con su contexto, para la columna izquierda.
   *
   * Incluye la del encabezado aunque todavía no haya ningún archivo: escribir
   * una cédula y ver al instante quién es y qué tiene cargado ES la consulta
   * individual, y no hace falta mandar a nadie a otra pantalla para hacerla.
   */
  readonly personas = computed<ContextoPersona[]>(() => {
    const ctxs = this.contextos();
    const vistas = new Set(this.fichas().map(f => f.cedula).filter(Boolean));
    const destino = this.cedulaDestino().trim();
    if (destino) vistas.add(destino);
    return [...vistas].map(c => ctxs[c]).filter(Boolean) as ContextoPersona[];
  });

  readonly resumen = computed(() => {
    const fs = this.fichas();
    const cuenta = (e: EstadoFicha) => fs.filter(f => f.estado === e).length;
    return {
      total: fs.length,
      nuevos: cuenta('listo'),
      reemplazos: cuenta('reemplaza'),
      duplicados: cuenta('duplicado'),
      bloqueados: cuenta('sin_persona') + cuenta('sin_tipo'),
      omitidos: cuenta('omitido'),
      registrados: cuenta('registrado'),
      errores: cuenta('error'),
      colaIa: fs.filter(f => f.estado !== 'omitido' && this.iraCola(f)).length,
      registrables: fs.filter(puedeRegistrarse).length,
    };
  });

  // ── Catálogo ────────────────────────────────────────────────────────────

  private cargarTipos(): void {
    this.docSrv.mostrar_jerarquia_anidada()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: arbol => {
          const grupos = agruparTiposPorPadre(arbol);
          this.grupos.set(grupos);
          this.tiposPorId.clear();
          for (const g of grupos) for (const h of g.hijos) this.tiposPorId.set(h.id, h);
          this.tiposPlanos = [...this.tiposPorId.values()].map(t => ({ id: t.id, name: t.name }));
          // Los archivos que entraron antes de que llegara el catálogo también
          // merecen su sugerencia: se recorre lo que ya hay en la mesa.
          this.resugerirTodo();
        },
        error: () => Swal.fire('Error', 'No se pudo cargar el catálogo de tipos documentales.', 'error'),
      });
  }

  nombreTipo(typeId: number | null): string {
    return typeId ? (this.tiposPorId.get(typeId)?.name ?? '') : '';
  }

  requiereContrato(typeId: number | null): boolean {
    return !!(typeId && this.tiposPorId.get(typeId)?.codigo_contrato);
  }

  /**
   * ¿Este documento va a la cola de lectura automática del servidor?
   *
   * ms-documents encola un trabajo de OCR por cada subida salvo que el tipo
   * documental lo tenga apagado (`skip_ocr`). Una factura va igual, y además se
   * marca aparte en la ficha porque es la que el usuario pregunta.
   */
  iraCola(f: FichaIngesta): boolean {
    if (!f.typeId) return false;
    return this.tiposPorId.get(f.typeId)?.skip_ocr !== true;
  }

  // ── Entrada de archivos ─────────────────────────────────────────────────

  /** Consulta el expediente en cuanto la cédula del encabezado tiene pinta de serlo. */
  cambiarDestino(valor: string): void {
    const cedula = (valor ?? '').trim();
    this.cedulaDestino.set(cedula);
    if (cedula.length >= 6 && /^\d+$/.test(cedula)) this.asegurarContexto(cedula);
  }

  elegirOrigen(o: OrigenIngesta): void {
    this.origen.set(o);
    if (o === 'escaner') { this.abrirEscaner(); return; }
    const entrada = o === 'zip' ? this.entradaZip
      : o === 'paquete' ? this.entradaPaquete
        : this.entradaArchivos;
    entrada.nativeElement.value = '';
    entrada.nativeElement.click();
  }

  alSoltar(ev: DragEvent): void {
    ev.preventDefault();
    this.arrastrando.set(false);
    const files = Array.from(ev.dataTransfer?.files ?? []);
    if (!files.length) return;
    const zip = files.find(f => /\.zip$/i.test(f.name));
    if (zip) { this.procesarZip(zip); return; }
    this.agregarArchivos(files, 'archivos');
  }

  alArrastrar(ev: DragEvent, dentro: boolean): void {
    ev.preventDefault();
    this.arrastrando.set(dentro);
  }

  alElegirArchivos(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    this.agregarArchivos(Array.from(input.files ?? []), 'archivos');
    input.value = '';
  }

  alElegirZip(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) this.procesarZip(f);
  }

  alElegirPaquete(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) this.repartirPaquete(f);
  }

  private abrirEscaner(): void {
    const ref = this.dialog.open(DocumentScanDialogComponent, {
      maxWidth: '100vw', maxHeight: '100vh', height: '100%', width: '100%',
      panelClass: 'full-screen-dialog', disableClose: true,
    });
    ref.afterClosed().subscribe((res: File[] | undefined) => {
      if (Array.isArray(res) && res.length) this.agregarArchivos(res, 'escaner');
    });
  }

  /** Mete archivos sueltos en la mesa, ya clasificados por nombre. */
  private agregarArchivos(files: File[], origen: OrigenIngesta, rutas?: string[]): void {
    const nuevas: FichaIngesta[] = [];
    let pesados = 0;
    let noPdf = 0;

    files.forEach((file, i) => {
      if (!/\.pdf$/i.test(file.name)) { noPdf++; return; }
      if (file.size > MAX_BYTES) { pesados++; return; }
      nuevas.push(this.crearFicha(file, origen, rutas?.[i] ?? file.name));
    });

    if (noPdf || pesados) {
      const partes = [
        noPdf ? `${noPdf} no eran PDF` : '',
        pesados ? `${pesados} pasaban de 10 MB` : '',
      ].filter(Boolean).join(' y ');
      Swal.fire({
        toast: true, position: 'top-end', icon: 'warning', timer: 4500,
        showConfirmButton: false, title: 'Archivos omitidos', text: `Se dejaron fuera: ${partes}.`,
      });
    }

    if (!nuevas.length) return;

    this.fichas.update(list => [...list, ...nuevas]);
    for (const c of new Set(nuevas.map(f => f.cedula).filter(Boolean))) this.asegurarContexto(c);
    this.recalcular();
    if (!this.seleccionadaId()) this.seleccionar(nuevas[0]);
  }

  private crearFicha(file: File, origen: OrigenIngesta, ruta: string): FichaIngesta {
    const { cedula, pista, carpeta } = leerNombreArchivo(ruta);
    const sugerencia = sugerirTipo(pista, carpeta, this.tiposPlanos);
    const destino = cedula || this.cedulaDestino().trim();

    return {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      file,
      nombre: file.name,
      tamano: file.size,
      origen,
      procedencia: ruta === file.name ? '' : ruta,
      cedula: destino,
      typeId: sugerencia && sugerencia.confianza >= CONFIANZA_AUTOMATICA ? sugerencia.typeId : null,
      contrato: '',
      titulo: file.name.replace(/\.pdf$/i, ''),
      estado: 'listo',
      motivo: '',
      sugerencia,
      lectura: null,
      reemplazaA: null,
      documentId: null,
      enColaIa: false,
      enColaOffline: false,
    };
  }

  /** Vuelve a proponer tipo en las fichas que aún no lo tienen (llega el catálogo tarde). */
  private resugerirTodo(): void {
    this.fichas.update(list => list.map(f => {
      if (f.typeId || f.estado === 'registrado') return f;
      const { pista, carpeta } = leerNombreArchivo(f.procedencia || f.nombre);
      const sugerencia = sugerirTipo(pista, carpeta, this.tiposPlanos);
      return {
        ...f,
        sugerencia,
        typeId: sugerencia && sugerencia.confianza >= CONFIANZA_AUTOMATICA ? sugerencia.typeId : null,
      };
    }));
    this.recalcular();
  }

  // ── ZIP ─────────────────────────────────────────────────────────────────

  /**
   * Abre el ZIP EN EL NAVEGADOR y lo vuelca a la mesa.
   *
   * Antes el ZIP se mandaba entero al servidor y el usuario recibía un informe
   * de lo que ya había pasado. Leerlo aquí cuesta lo mismo y cambia el orden:
   * primero se ve y se corrige, después se registra.
   */
  private async procesarZip(zip: File): Promise<void> {
    this.trabajando.set(`Abriendo ${zip.name}…`);
    try {
      const JSZip = (await import('jszip')).default;
      const contenido = await JSZip.loadAsync(zip);
      const entradas = Object.values(contenido.files)
        .filter((e: any) => !e.dir && /\.pdf$/i.test(e.name));

      if (!entradas.length) {
        Swal.fire('ZIP sin PDF', 'El comprimido no trae ningún archivo PDF.', 'info');
        return;
      }

      const files: File[] = [];
      const rutas: string[] = [];
      for (const e of entradas as any[]) {
        this.trabajando.set(`Leyendo ${e.name}…`);
        const blob: Blob = await e.async('blob');
        const base = e.name.split('/').pop() || e.name;
        files.push(new File([blob], base, { type: 'application/pdf' }));
        rutas.push(e.name);
      }
      this.agregarArchivos(files, 'zip', rutas);
    } catch {
      Swal.fire('ZIP ilegible', 'No se pudo abrir el comprimido. Puede estar dañado o protegido.', 'error');
    } finally {
      this.trabajando.set('');
    }
  }

  // ── PDF único repartido en paquetes ─────────────────────────────────────

  /**
   * Reparte un PDF grande en un documento por persona.
   *
   * El corte se hace por la cédula que aparece en el texto de cada página: una
   * página sin cédula se queda con el grupo anterior, que es como están hechos
   * estos PDF (carátula + anexos de la misma persona). Si el PDF viene
   * escaneado no hay texto que leer y se dice, en vez de partirlo al azar.
   */
  private repartirPaquete(pdf: File): void {
    if (pdf.size > MAX_BYTES * 6) {
      Swal.fire('Archivo muy pesado', 'El PDF a repartir no debería pasar de 60 MB.', 'warning');
      return;
    }
    this.paqueteEnCurso = pdf;
    this.modoVisor.set('paquete');
    this.seleccionadaId.set(null);
    this.trabajando.set('Abriendo el PDF…');
    pdf.arrayBuffer().then(b => this.bytesVisor.set(new Uint8Array(b)));
  }

  private async analizarPaquete(paginas: number): Promise<void> {
    const pdf = this.paqueteEnCurso;
    if (!pdf) return;

    try {
      const porPagina: string[] = [];
      for (let p = 1; p <= paginas; p++) {
        this.trabajando.set(`Leyendo página ${p} de ${paginas}…`);
        porPagina.push(await this.textoDePagina(p));
      }

      const grupos = this.agruparPaginas(porPagina);
      const conCedula = grupos.filter(g => g.cedula).length;

      if (!conCedula) {
        Swal.fire({
          icon: 'info',
          title: 'No se pudo repartir',
          html: 'No se encontró ninguna cédula en el texto del PDF. '
            + 'Si está escaneado, no tiene capa de texto: súbelo como un solo documento '
            + 'o pásalo por el escáner de la mesa.',
        });
        return;
      }

      const { PDFDocument } = await import('pdf-lib');
      const original = await PDFDocument.load(await pdf.arrayBuffer());
      const files: File[] = [];
      const rutas: string[] = [];

      for (const g of grupos) {
        this.trabajando.set(`Armando el documento de ${g.cedula || 'sin cédula'}…`);
        const nuevo = await PDFDocument.create();
        const copiadas = await nuevo.copyPages(original, g.paginas.map(p => p - 1));
        copiadas.forEach(p => nuevo.addPage(p));
        const bytes = await nuevo.save();
        const nombre = `${g.cedula || 'sin_cedula'}_${g.paginas[0]}-${g.paginas[g.paginas.length - 1]}.pdf`;
        files.push(new File([bytes as BlobPart], nombre, { type: 'application/pdf' }));
        rutas.push(nombre);
      }

      this.agregarArchivos(files, 'paquete', rutas);
      Swal.fire({
        toast: true, position: 'top-end', icon: 'success', timer: 3500, showConfirmButton: false,
        title: `${files.length} documento(s) separados`,
      });
    } catch {
      Swal.fire('No se pudo repartir', 'El PDF no se pudo separar en paquetes.', 'error');
    } finally {
      this.paqueteEnCurso = null;
      this.trabajando.set('');
      this.modoVisor.set('nada');
      this.bytesVisor.set(null);
    }
  }

  /** Agrupa páginas consecutivas bajo la primera cédula que aparece en cada una. */
  private agruparPaginas(textos: string[]): { cedula: string; paginas: number[] }[] {
    const grupos: { cedula: string; paginas: number[] }[] = [];
    textos.forEach((t, i) => {
      const lectura = analizarTexto(t, '', 1);
      const cedula = lectura.cedulasDetectadas[0] ?? '';
      const ultimo = grupos[grupos.length - 1];
      if (cedula && (!ultimo || ultimo.cedula !== cedula)) {
        grupos.push({ cedula, paginas: [i + 1] });
      } else if (ultimo) {
        ultimo.paginas.push(i + 1);
      } else {
        grupos.push({ cedula: '', paginas: [i + 1] });
      }
    });
    return grupos;
  }

  // ── Visor y lectura automática ──────────────────────────────────────────

  seleccionar(f: FichaIngesta): void {
    this.seleccionadaId.set(f.id);
    this.modoVisor.set('ficha');
    this.leyendo.set(!f.lectura);
    f.file.arrayBuffer().then(b => this.bytesVisor.set(new Uint8Array(b)));
  }

  /** Lo dispara el visor cuando el PDF ya está cargado: ahí se puede leer el texto. */
  async alCargarPdf(ev: any): Promise<void> {
    const paginas: number = ev?.pagesCount ?? ev?.pages ?? 0;

    if (this.modoVisor() === 'paquete') {
      await this.analizarPaquete(paginas);
      return;
    }

    const f = this.seleccionada();
    if (!f || f.lectura) { this.leyendo.set(false); return; }

    try {
      const trozos: string[] = [];
      for (let p = 1; p <= Math.min(PAGINAS_A_LEER, paginas || 1); p++) {
        trozos.push(await this.textoDePagina(p));
      }
      const lectura = analizarTexto(trozos.join('\n'), f.nombre, paginas || null);
      this.actualizar(f.id, actual => ({ ...actual, lectura }));
    } finally {
      this.leyendo.set(false);
    }
  }

  private async textoDePagina(p: number): Promise<string> {
    try {
      return (await this.pdfSrv.getPageAsText(p)) ?? '';
    } catch {
      return '';
    }
  }

  /** Toma una cédula que la lectura encontró dentro del documento. */
  usarCedulaDetectada(f: FichaIngesta, cedula: string): void {
    this.actualizar(f.id, a => ({ ...a, cedula }));
    this.asegurarContexto(cedula);
    this.recalcular();
  }

  // ── Edición de la ficha ─────────────────────────────────────────────────

  cambiarCedula(f: FichaIngesta, valor: string): void {
    const cedula = (valor ?? '').trim();
    this.actualizar(f.id, a => ({ ...a, cedula, contrato: '' }));
    if (cedula) this.asegurarContexto(cedula);
    this.recalcular();
  }

  cambiarTipo(f: FichaIngesta, typeId: number | null): void {
    this.actualizar(f.id, a => ({
      ...a,
      typeId,
      contrato: this.requiereContrato(typeId) ? a.contrato : '',
    }));
    this.recalcular();
  }

  cambiarContrato(f: FichaIngesta, contrato: string): void {
    this.actualizar(f.id, a => ({ ...a, contrato }));
    this.recalcular();
  }

  cambiarTitulo(f: FichaIngesta, titulo: string): void {
    this.actualizar(f.id, a => ({ ...a, titulo }));
  }

  aplicarSugerencia(f: FichaIngesta): void {
    if (f.sugerencia) this.cambiarTipo(f, f.sugerencia.typeId);
  }

  alternarOmitido(f: FichaIngesta): void {
    this.actualizar(f.id, a => ({
      ...a,
      estado: a.estado === 'omitido' ? 'listo' : 'omitido',
      motivo: a.estado === 'omitido' ? '' : 'Lo sacaste de esta tanda',
    }));
    this.recalcular();
  }

  quitar(f: FichaIngesta): void {
    this.fichas.update(list => list.filter(x => x.id !== f.id));
    if (this.seleccionadaId() === f.id) {
      this.seleccionadaId.set(null);
      this.bytesVisor.set(null);
      this.modoVisor.set('nada');
    }
    this.recalcular();
  }

  vaciar(): void {
    if (this.registrando()) return;
    this.fichas.set([]);
    this.seleccionadaId.set(null);
    this.bytesVisor.set(null);
    this.modoVisor.set('nada');
    this.acta.set(null);
  }

  /** Aplica la cédula del encabezado a todas las fichas que no traen una propia. */
  aplicarDestinoATodas(): void {
    const cedula = this.cedulaDestino().trim();
    if (!cedula) return;
    this.fichas.update(list => list.map(f => (f.cedula ? f : { ...f, cedula })));
    this.asegurarContexto(cedula);
    this.recalcular();
  }

  /** Mismo tipo para todas las fichas sin tipo: es el caso normal de un ZIP. */
  aplicarTipoAFaltantes(typeId: number): void {
    this.fichas.update(list => list.map(f => (f.typeId || f.estado === 'registrado' ? f : { ...f, typeId })));
    this.recalcular();
  }

  private actualizar(id: string, cambio: (f: FichaIngesta) => FichaIngesta): void {
    this.fichas.update(list => list.map(f => (f.id === id ? cambio(f) : f)));
  }

  // ── Contexto de la persona ──────────────────────────────────────────────

  private asegurarContexto(cedula: string, forzar = false): void {
    const actual = this.contextos()[cedula];
    if (actual && !forzar) return;

    this.contextos.update(m => ({
      ...m,
      [cedula]: {
        cedula, existe: false, nombre: '', finca: '', fechaIngreso: '',
        contratos: [], documentos: [], faltantes: [], aviso: '', cargando: true,
      },
    }));

    this.ingestaSrv.contextoDe(cedula)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ctx => {
          this.contextos.update(m => ({ ...m, [cedula]: ctx }));
          this.recalcular();
        },
        error: () => {
          this.contextos.update(m => ({
            ...m,
            [cedula]: { ...m[cedula], cargando: false, aviso: 'No se pudo consultar el expediente' },
          }));
          this.recalcular();
        },
      });
  }

  /** Vuelve a evaluar qué reemplaza cada ficha y en qué estado queda. */
  private recalcular(): void {
    const ctxs = this.contextos();
    const terminales: EstadoFicha[] = ['registrado', 'error', 'subiendo'];
    this.fichas.update(list => list.map(f => {
      // Lo ya registrado no se vuelve a evaluar: al refrescar el expediente se
      // encontraría a sí mismo y diría que se reemplaza a sí mismo.
      if (terminales.includes(f.estado)) return f;
      const ctx = ctxs[f.cedula] ?? null;
      const reemplazaA = vigenteDelTipo(ctx, f.typeId, f.contrato);
      const { estado, motivo } = estadoDeFicha({ ...f, reemplazaA }, ctx);
      return { ...f, reemplazaA, estado, motivo };
    }));
  }

  contratosDe(cedula: string) {
    return this.contextos()[cedula]?.contratos ?? [];
  }

  // ── Registro ────────────────────────────────────────────────────────────

  get puedeRegistrar(): boolean {
    return !this.registrando() && this.resumen().registrables > 0;
  }

  async registrar(): Promise<void> {
    if (!this.puedeRegistrar) return;

    const r = this.resumen();
    if (r.reemplazos || r.duplicados) {
      const confirma = await Swal.fire({
        icon: 'question',
        title: 'Confirma antes de registrar',
        html: [
          `<p style="text-align:left;margin:0 0 8px">Vas a registrar <b>${r.registrables}</b> documento(s):</p>`,
          '<ul style="text-align:left;padding-left:20px;margin:0">',
          r.nuevos ? `<li><b>${r.nuevos}</b> nuevo(s) en el expediente</li>` : '',
          r.reemplazos ? `<li><b>${r.reemplazos}</b> pasarán a ser el último de su tipo (el anterior queda en el histórico)</li>` : '',
          r.duplicados ? `<li><b>${r.duplicados}</b> ya tienen un documento igual cargado</li>` : '',
          '</ul>',
        ].join(''),
        showCancelButton: true,
        confirmButtonText: 'Registrar',
        cancelButtonText: 'Revisar',
      });
      if (!confirma.isConfirmed) return;
    }

    this.registrando.set(true);
    this.progreso.set(0);
    this.acta.set(null);

    const pendientes = this.fichas().filter(puedeRegistrarse);
    let hechas = 0;
    const cola = [...pendientes];
    const enVuelo: Promise<void>[] = [];

    const siguiente = async (): Promise<void> => {
      const f = cola.shift();
      if (!f) return;
      await this.registrarUna(f);
      hechas++;
      this.progreso.set(Math.round((hechas / pendientes.length) * 100));
      return siguiente();
    };

    for (let i = 0; i < Math.min(CONCURRENCIA, cola.length); i++) enVuelo.push(siguiente());
    await Promise.all(enVuelo);

    this.registrando.set(false);
    this.acta.set(this.armarActa());

    // El expediente de cada persona cambió: se vuelve a pedir para que el
    // "reemplaza a" de lo que quede en la mesa diga la verdad.
    for (const c of new Set(pendientes.map(f => f.cedula))) this.asegurarContexto(c, true);
  }

  private async registrarUna(f: FichaIngesta): Promise<void> {
    this.actualizar(f.id, a => ({ ...a, estado: 'subiendo', motivo: '' }));

    const ctx = this.contextos()[f.cedula] ?? null;
    const proceso = ctx?.contratos.find(c => c.codigoContrato === f.contrato)?.procesoId ?? null;

    try {
      const resp: any = await firstValueFrom(
        this.gestionSrv.guardarDocumento(
          f.titulo || f.nombre,
          f.cedula,
          f.typeId!,
          f.file,
          f.contrato || undefined,
          undefined,
          proceso,
        )
      );
      const enCola = isOfflineQueued(resp);
      this.actualizar(f.id, a => ({
        ...a,
        estado: 'registrado',
        motivo: enCola ? 'Guardado en este equipo; se subirá al volver la conexión' : '',
        documentId: resp?.id ?? resp?.document_id ?? null,
        enColaOffline: enCola,
        enColaIa: this.iraCola(a),
      }));
    } catch (err: any) {
      this.actualizar(f.id, a => ({ ...a, estado: 'error', motivo: this.mensajeError(err) }));
    }
  }

  private mensajeError(err: any): string {
    const body = err?.error;
    if (body?.detail) return body.detail;
    if (body?.message) return body.message;
    if (typeof body === 'string' && body.trim()) return body;
    if (err?.status === 0 || err?.status === 504) return 'Sin conexión con el servidor';
    if (err?.status === 409) return 'El parametrizador no tiene chuleado este tipo para la persona';
    if (err?.status === 413) return 'El servidor rechazó el archivo por tamaño';
    if (err?.status >= 500) return `Error interno del servidor (${err.status})`;
    return `Error ${err?.status ?? 'desconocido'}`;
  }

  private armarActa(): LineaActa[] {
    const ctxs = this.contextos();
    return this.fichas()
      .filter(f => f.estado === 'registrado' || f.estado === 'error')
      .map(f => ({
        nombre: f.titulo || f.nombre,
        cedula: f.cedula,
        persona: ctxs[f.cedula]?.nombre || 'Sin nombre en contratación',
        tipo: this.nombreTipo(f.typeId),
        contrato: f.contrato || 'Sin contrato',
        documentId: f.documentId,
        resultado: f.estado === 'error' ? 'error'
          : f.enColaOffline ? 'cola'
            : f.reemplazaA ? 'reemplazo' : 'registrado',
        detalle: f.estado === 'error' ? f.motivo
          : f.enColaOffline ? 'Pendiente de subir (sin conexión)'
            : f.reemplazaA ? `Desplaza al documento #${f.reemplazaA.documentId} del ${this.fecha(f.reemplazaA.subidoEn)}`
              : 'Nuevo en el expediente',
      } as LineaActa));
  }

  fecha(iso: string | null): string {
    if (!iso) return 'sin fecha';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  async copiarActa(): Promise<void> {
    const lineas = this.acta() ?? [];
    const texto = [
      `ACTA DE REGISTRO DOCUMENTAL — ${new Date().toLocaleString('es-CO')}`,
      ''.padEnd(72, '-'),
      ...lineas.map(l => [
        l.documentId ? `#${l.documentId}` : '—',
        l.cedula, l.persona, l.tipo, l.contrato, l.resultado.toUpperCase(), l.detalle,
      ].join(' | ')),
    ].join('\n');

    try {
      await navigator.clipboard.writeText(texto);
      Swal.fire({
        toast: true, position: 'top-end', icon: 'success', timer: 2200,
        showConfirmButton: false, title: 'Acta copiada',
      });
    } catch {
      Swal.fire('No se pudo copiar', 'El navegador bloqueó el portapapeles.', 'warning');
    }
  }

  cerrarActa(): void {
    this.acta.set(null);
    // Lo registrado ya no es trabajo pendiente; lo que falló se queda para reintentar.
    this.fichas.update(list => list.filter(f => f.estado !== 'registrado'));
    if (!this.fichas().length) {
      this.seleccionadaId.set(null);
      this.bytesVisor.set(null);
      this.modoVisor.set('nada');
    }
  }

  abrirDocumento(url: string | null): void {
    if (url) window.open(url, '_blank', 'noopener');
  }
}
