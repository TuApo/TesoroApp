import {
  ChangeDetectionStrategy, Component, DestroyRef, Input, OnDestroy, OnInit, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { saveAs } from 'file-saver';

import { environment } from '@/environments/environment';
import { DynamicFormService } from '../../services/dynamic-form.service';
import { ApiProblem } from '../../models/dynamic-forms.models';
import { SupportFacet, SupportFile, SupportsGroupBy } from '../../models/placement.models';
import {
  SupportDownloadsData, SupportDownloadsDialogComponent,
} from '../../components/support-downloads-dialog/support-downloads-dialog.component';

/** Categoría visual del archivo, derivada del mime_type (la misma que calcula ms-forms). */
type CategoriaMime = 'imagen' | 'pdf' | 'excel' | 'word' | 'video' | 'otro';

/**
 * SOPORTES — archivos adjuntos de las respuestas de un formulario.
 * Ruta canónica: {ruta_base}/soportes (vía dispatcher) · compat: :formId/soportes.
 *
 * Cada archivo llega ya IDENTIFICADO por el backend: de qué pregunta salió y de quién es
 * (el número de documento de la respuesta). Ese identificador corto —
 * {cédula}-{pregunta}.ext — es el nombre con el que se descarga, para que el archivo
 * siga diciendo qué es después de salir de la plataforma.
 *
 * Se puede bajar de a uno, marcar varios, o llevarse TODO lo que casa con la búsqueda en
 * un ZIP (con carpeta por pregunta o por persona). La descarga NUNCA va directo a
 * ms-documents: pasa por ms-forms, que es quien pone el nombre y deja el registro de
 * actividad. La única excepción son las MINIATURAS, que sí van directas — son vistas
 * previas, no descargas, y auditarlas llenaría el registro de ruido.
 */
@Component({
  selector: 'app-form-supports',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, RouterLink, ReactiveFormsModule,
    MatButtonModule, MatCardModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule,
    MatInputModule, MatMenuModule, MatSelectModule, MatPaginatorModule, MatProgressBarModule,
    MatTooltipModule, MatSnackBarModule,
  ],
  templateUrl: './form-supports.component.html',
  styleUrls: ['./form-supports.component.css'],
})
export class FormSupportsComponent implements OnInit, OnDestroy {
  /**
   * Id inyectado por el DISPATCHER (form-view-host); reacciona también si el host
   * reutiliza el componente para otro formulario. Sin input, se lee de la ruta
   * clásica :formId/soportes.
   */
  @Input() set formIdInput(id: number | undefined) {
    if (id != null && Number.isFinite(id) && id > 0) {
      this.idPorInput = id;
      this.inicializar(id);
    }
  }
  private idPorInput?: number;

  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);
  private formsSvc = inject(DynamicFormService);
  private snack = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  /** Base absoluta del submódulo (para enlazar la respuesta origen a su detalle). */
  readonly baseListado = '/dashboard/gestion-del-programa/formularios-dinamicos';

  // ── Estado ──────────────────────────────────────────────────────────
  readonly formId = signal<number>(0);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly filas = signal<SupportFile[]>([]);
  /** Coincidencias de la búsqueda (no de la página). */
  readonly total = signal(0);
  /** Soportes del formulario sin filtrar: el "de cuántos" real. */
  readonly totalAll = signal(0);
  readonly pagina = signal(0);
  readonly tamano = signal(24);
  readonly parcial = signal(false);

  /** Preguntas con soportes y cuántos tiene cada una (lo calcula el backend). */
  readonly preguntas = signal<SupportFacet[]>([]);
  readonly tipos = signal<Record<string, number>>({});

  // Filtros vigentes (los tres viajan al servidor: la paginación también es suya).
  readonly buscador = new FormControl<string>('', { nonNullable: true });
  readonly filtroPreguntas = signal<string[]>([]);
  readonly filtroTipos = signal<string[]>([]);

  /** Selección viva por clave "submissionId:documentId", entre páginas y filtros. */
  readonly seleccion = signal<Map<string, SupportFile>>(new Map());
  /** Cómo se agrupa el ZIP: plano, carpeta por pregunta o carpeta por persona. */
  readonly agrupacion = signal<SupportsGroupBy>('NONE');

  /** document_id cuya descarga está en vuelo (deshabilita su botón). */
  readonly descargandoId = signal<number | null>(null);
  readonly armandoZip = signal(false);
  /** Miniaturas de imagen ya resueltas: { [document_id]: objectUrl }. */
  readonly miniaturas = signal<Record<number, string>>({});

  /** Object URLs vivos, para revocarlos al destruir (evita fugas de memoria). */
  private objectUrls: string[] = [];

  /** Opciones del filtro de tipo (etiqueta ES). El conteo lo pone la faceta. */
  readonly TIPOS: ReadonlyArray<{ valor: CategoriaMime; etiqueta: string }> = [
    { valor: 'imagen', etiqueta: 'Imágenes' },
    { valor: 'pdf', etiqueta: 'PDF' },
    { valor: 'excel', etiqueta: 'Hojas de cálculo' },
    { valor: 'word', etiqueta: 'Documentos Word' },
    { valor: 'video', etiqueta: 'Videos' },
    { valor: 'otro', etiqueta: 'Otros' },
  ];

  readonly AGRUPACIONES: ReadonlyArray<{ valor: SupportsGroupBy; etiqueta: string; ayuda: string }> = [
    { valor: 'NONE', etiqueta: 'Sin carpetas', ayuda: 'Todos los archivos sueltos dentro del ZIP' },
    { valor: 'FIELD', etiqueta: 'Carpeta por pregunta', ayuda: 'Una carpeta por cada pregunta del formulario' },
    { valor: 'RECORD', etiqueta: 'Carpeta por persona', ayuda: 'Una carpeta por cada número de documento' },
  ];

  readonly seleccionados = computed<number>(() => this.seleccion().size);
  readonly hayFiltros = computed<boolean>(() =>
    !!this.buscador.value.trim() || this.filtroPreguntas().length > 0 || this.filtroTipos().length > 0);

  /** ¿Está toda la página marcada? (gobierna el "seleccionar todo" de la cabecera). */
  readonly paginaCompleta = computed<boolean>(() => {
    const filas = this.filas();
    if (filas.length === 0) return false;
    const sel = this.seleccion();
    return filas.every(f => sel.has(this.clave(f)));
  });

  ngOnInit(): void {
    // Buscador "vivo": una pulsación no puede disparar una consulta, pero tampoco
    // se le va a pedir al usuario que oprima Enter.
    this.buscador.valueChanges
      .pipe(debounceTime(320), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.pagina.set(0);
        this.cargar();
      });

    // Con id del host, el setter ya inicializó: no se lee la ruta.
    if (this.idPorInput != null) return;
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(pm => {
      const id = Number(pm.get('formId'));
      if (!Number.isFinite(id) || id <= 0) return;
      this.inicializar(id);
    });
  }

  ngOnDestroy(): void {
    this.revocarMiniaturas();
  }

  /** Reinicia filtros/selección/miniaturas y carga la primera página del formulario `id`. */
  private inicializar(id: number): void {
    this.formId.set(id);
    this.pagina.set(0);
    this.filtroPreguntas.set([]);
    this.filtroTipos.set([]);
    this.seleccion.set(new Map());
    this.buscador.setValue('', { emitEvent: false });
    this.revocarMiniaturas();
    this.cargar();
  }

  // ── Carga ───────────────────────────────────────────────────────────

  recargar(): void {
    this.cargar();
  }

  private cargar(): void {
    const id = this.formId();
    if (!id) return;
    this.cargando.set(true);
    this.error.set(null);
    this.revocarMiniaturas();
    this.formsSvc.supports(id, {
      q: this.buscador.value,
      fields: this.filtroPreguntas(),
      types: this.filtroTipos(),
      page: this.pagina(),
      size: this.tamano(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: pag => {
          this.filas.set(pag.content ?? []);
          this.total.set(pag.total ?? 0);
          this.totalAll.set(pag.total_all ?? pag.total ?? 0);
          this.preguntas.set(pag.fields ?? []);
          this.tipos.set(pag.types ?? {});
          this.parcial.set(!!pag.partial);
          this.cargando.set(false);
          // Miniaturas solo para imágenes (los binarios grandes no se pre-descargan).
          for (const sf of this.filas()) {
            if (this.esImagen(sf.mime_type)) this.cargarMiniatura(sf);
          }
        },
        error: (err: HttpErrorResponse) => {
          this.cargando.set(false);
          this.filas.set([]);
          this.total.set(0);
          this.error.set(this.mensajeProblema(err, 'No se pudieron cargar los soportes.'));
        },
      });
  }

  onPage(evento: PageEvent): void {
    this.pagina.set(evento.pageIndex);
    this.tamano.set(evento.pageSize);
    this.cargar();
  }

  // ── Filtros ─────────────────────────────────────────────────────────

  onFiltroPreguntas(valores: string[]): void {
    this.filtroPreguntas.set(valores ?? []);
    this.pagina.set(0);
    this.cargar();
  }

  onFiltroTipos(valores: string[]): void {
    this.filtroTipos.set(valores ?? []);
    this.pagina.set(0);
    this.cargar();
  }

  /** Atajo desde la tarjeta: "ver solo esta pregunta". */
  soloEstaPregunta(sf: SupportFile): void {
    this.onFiltroPreguntas([sf.field_key]);
  }

  limpiarFiltros(): void {
    this.buscador.setValue('', { emitEvent: false });
    this.filtroPreguntas.set([]);
    this.filtroTipos.set([]);
    this.pagina.set(0);
    this.cargar();
  }

  conteoTipo(valor: string): number {
    return this.tipos()[valor] ?? 0;
  }

  // ── Selección ───────────────────────────────────────────────────────

  clave(sf: SupportFile): string {
    return `${sf.submission_id}:${sf.document_id}`;
  }

  estaSeleccionado(sf: SupportFile): boolean {
    return this.seleccion().has(this.clave(sf));
  }

  alternarSeleccion(sf: SupportFile): void {
    const mapa = new Map(this.seleccion());
    const k = this.clave(sf);
    if (mapa.has(k)) mapa.delete(k); else mapa.set(k, sf);
    this.seleccion.set(mapa);
  }

  /** Marca (o desmarca) los soportes de la página visible. */
  alternarPagina(): void {
    const mapa = new Map(this.seleccion());
    const completa = this.paginaCompleta();
    for (const sf of this.filas()) {
      const k = this.clave(sf);
      if (completa) mapa.delete(k); else mapa.set(k, sf);
    }
    this.seleccion.set(mapa);
  }

  limpiarSeleccion(): void {
    this.seleccion.set(new Map());
  }

  // ── Descargas ───────────────────────────────────────────────────────

  /**
   * Descarga UN soporte por ms-forms: llega con su nombre corto y queda registrada.
   * No se puede usar <a href> directo — el gateway exige el JWT que pone el interceptor.
   */
  descargar(sf: SupportFile): void {
    if (this.descargandoId() != null) return;
    this.descargandoId.set(sf.document_id);
    this.formsSvc.supportDownload(this.formId(), sf.document_id, sf.submission_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: resp => {
          this.descargandoId.set(null);
          const nombre = this.nombreDeRespuesta(resp)
            || sf.suggested_filename || sf.filename || `soporte-${sf.document_id}`;
          if (resp.body) saveAs(resp.body, nombre);
        },
        error: (err: HttpErrorResponse) => {
          this.descargandoId.set(null);
          this.snack.open(
            this.mensajeProblema(err, 'No se pudo descargar el archivo.'),
            'Cerrar', { duration: 5000 },
          );
        },
      });
  }

  /** ZIP de lo marcado. */
  descargarSeleccion(): void {
    const marcados = [...this.seleccion().keys()];
    if (marcados.length === 0) return;
    this.pedirZip({ document_keys: marcados });
  }

  /**
   * ZIP de TODO lo que casa con la búsqueda, sin marcarlo tarjeta por tarjeta. Los
   * filtros van en el cuerpo: el servidor rehace la misma consulta, así que lo que se
   * baja es exactamente lo que se está viendo.
   */
  descargarTodoLoFiltrado(): void {
    if (this.total() === 0) return;
    this.pedirZip({
      all_matching: true,
      q: this.buscador.value.trim() || undefined,
      fields: this.filtroPreguntas().length ? this.filtroPreguntas() : undefined,
      types: this.filtroTipos().length ? this.filtroTipos() : undefined,
    });
  }

  private pedirZip(base: { document_keys?: string[]; all_matching?: boolean; q?: string; fields?: string[]; types?: string[] }): void {
    if (this.armandoZip()) return;
    this.armandoZip.set(true);
    this.formsSvc.supportsZip(this.formId(), {
      ...base,
      group_by: this.agrupacion(),
      include_manifest: true,
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: resp => {
          this.armandoZip.set(false);
          const nombre = this.nombreDeRespuesta(resp) || `soportes-${this.formId()}.zip`;
          if (resp.body) saveAs(resp.body, nombre);
          this.snack.open('Descarga registrada en la actividad del formulario.',
            'Cerrar', { duration: 4000 });
        },
        error: (err: HttpErrorResponse) => {
          this.armandoZip.set(false);
          this.mensajeDeBlob(err).then(mensaje =>
            this.snack.open(mensaje, 'Cerrar', { duration: 7000 }));
        },
      });
  }

  abrirActividad(): void {
    this.dialog.open<SupportDownloadsDialogComponent, SupportDownloadsData>(
      SupportDownloadsDialogComponent, {
        data: { formId: this.formId() },
        autoFocus: false,
        maxWidth: '92vw',
      });
  }

  // ── Miniaturas ──────────────────────────────────────────────────────

  /**
   * Baja la imagen como blob y publica su object URL como miniatura. Va DIRECTO a
   * ms-documents a propósito: es una vista previa, y pasarla por la descarga auditada
   * escribiría una fila de registro por cada tarjeta pintada.
   */
  private cargarMiniatura(sf: SupportFile): void {
    if (this.miniaturas()[sf.document_id]) return; // ya resuelta (documento repetido)
    this.http.get(this.urlAbsoluta(sf.download_url), { responseType: 'blob' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: blob => {
          const url = URL.createObjectURL(blob);
          this.objectUrls.push(url);
          this.miniaturas.update(prev => ({ ...prev, [sf.document_id]: url }));
        },
        // Sin miniatura: la tarjeta cae al icono por tipo. No molestamos al usuario.
        error: () => { /* noop */ },
      });
  }

  private revocarMiniaturas(): void {
    for (const url of this.objectUrls) {
      try { URL.revokeObjectURL(url); } catch { /* noop */ }
    }
    this.objectUrls = [];
    if (Object.keys(this.miniaturas()).length > 0) this.miniaturas.set({});
  }

  // ── Presentación ────────────────────────────────────────────────────

  esImagen(mime: string | null | undefined): boolean {
    return (mime || '').toLowerCase().startsWith('image/');
  }

  /** Categoría a partir del mime (para icono y badge). */
  categoriaMime(mime: string | null | undefined): CategoriaMime {
    const m = (mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'imagen';
    if (m.includes('pdf')) return 'pdf';
    if (m.includes('spreadsheet') || m.includes('excel') || m.includes('csv')) return 'excel';
    if (m.includes('word') || m.includes('wordprocessing') || m === 'application/msword') return 'word';
    if (m.startsWith('video/')) return 'video';
    return 'otro';
  }

  /** Material Symbol representativo del tipo de archivo. */
  iconoPorMime(mime: string | null | undefined): string {
    switch (this.categoriaMime(mime)) {
      case 'imagen': return 'image';
      case 'pdf': return 'picture_as_pdf';
      case 'excel': return 'table_view';
      case 'word': return 'description';
      case 'video': return 'movie';
      default: return 'draft';
    }
  }

  /** Etiqueta corta del tipo (badge). */
  tipoLegible(mime: string | null | undefined): string {
    switch (this.categoriaMime(mime)) {
      case 'imagen': return 'Imagen';
      case 'pdf': return 'PDF';
      case 'excel': return 'Hoja de cálculo';
      case 'word': return 'Word';
      case 'video': return 'Video';
      default: return 'Archivo';
    }
  }

  /** Tamaño legible: B / KB / MB. */
  tamanoLegible(bytes: number | null | undefined): string {
    if (bytes == null || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  }

  // ── Utilidades ──────────────────────────────────────────────────────

  /**
   * Resuelve download_url a absoluta contra la API. Debe llevar el host de la API
   * (no el del front): una URL relativa iría al origen del documento y el
   * interceptor no le pondría el JWT.
   */
  private urlAbsoluta(u: string): string {
    if (/^https?:\/\//i.test(u)) return u;
    const base = environment.apiUrl.replace(/\/+$/, '');
    return base + (u.startsWith('/') ? u : '/' + u);
  }

  /**
   * Nombre que mandó el servidor. Solo llega si el borde expone Content-Disposition;
   * si no, el llamante usa el nombre corto que ya trae el soporte.
   */
  private nombreDeRespuesta(resp: HttpResponse<Blob>): string | null {
    const cd = resp.headers?.get('content-disposition');
    if (!cd) return null;
    const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    if (utf8?.[1]) {
      try { return decodeURIComponent(utf8[1].trim()); } catch { /* sigue abajo */ }
    }
    const simple = /filename="?([^";]+)"?/i.exec(cd);
    return simple?.[1]?.trim() || null;
  }

  private mensajeProblema(err: HttpErrorResponse, porDefecto: string): string {
    const problema = err?.error as ApiProblem | null;
    if (problema && typeof problema.detail === 'string' && problema.detail.trim()) {
      return problema.detail;
    }
    return porDefecto;
  }

  /**
   * El error de una petición con responseType 'blob' llega como Blob, no como JSON:
   * sin esto, un 400 con motivo ("el ZIP admite hasta 300 archivos") se vería como un
   * fallo genérico y el usuario no sabría qué corregir.
   */
  private async mensajeDeBlob(err: HttpErrorResponse): Promise<string> {
    const porDefecto = 'No se pudo generar el ZIP de soportes.';
    const cuerpo = err?.error;
    if (!(cuerpo instanceof Blob)) return this.mensajeProblema(err, porDefecto);
    try {
      const texto = await cuerpo.text();
      const problema = JSON.parse(texto) as ApiProblem;
      return problema?.detail?.trim() || porDefecto;
    } catch {
      return porDefecto;
    }
  }
}
